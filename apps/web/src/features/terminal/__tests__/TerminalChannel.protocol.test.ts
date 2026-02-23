import { describe, expect, it } from "vitest";

// We test the pure functions from TerminalChannel by reimplementing them here
// since they're not exported. This tests the wire protocol logic.

const TERM_WIRE_VERSION = 1;
const TERM_FRAME_HEADER_SIZE = 30;
const TERM_FRAME_HISTORY = 1;
const TERM_FRAME_LIVE = 2;

type TerminalOutputKind = "history" | "live";

interface ParsedFrame {
	sessionId: string;
	seq: number;
	kind: TerminalOutputKind;
	payload: Uint8Array;
}

function decodeUint64LeToSafeNumber(
	view: DataView,
	offset: number,
): number | null {
	const lo = view.getUint32(offset, true);
	const hi = view.getUint32(offset + 4, true);
	const value = hi * 2 ** 32 + lo;
	if (!Number.isSafeInteger(value)) return null;
	return value;
}

function formatUuid(bytes: Uint8Array): string {
	if (bytes.length !== 16) return "";
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

function parseOutputFrame(frame: Uint8Array): ParsedFrame | null {
	if (frame.length < TERM_FRAME_HEADER_SIZE) return null;
	if (frame[0] !== TERM_WIRE_VERSION) return null;

	const kindCode = frame[1];
	const kind =
		kindCode === TERM_FRAME_HISTORY
			? "history"
			: kindCode === TERM_FRAME_LIVE
				? "live"
				: null;
	if (!kind) return null;

	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const sessionId = formatUuid(frame.subarray(2, 18));
	const seq = decodeUint64LeToSafeNumber(view, 18);
	if (seq === null) return null;
	const payloadLength = view.getUint32(26, true);
	if (TERM_FRAME_HEADER_SIZE + payloadLength > frame.length) {
		return null;
	}

	const payload = frame.slice(
		TERM_FRAME_HEADER_SIZE,
		TERM_FRAME_HEADER_SIZE + payloadLength,
	);

	return { sessionId, seq, kind, payload };
}

function buildFrame(
	version: number,
	kind: number,
	uuidBytes: Uint8Array,
	seq: bigint,
	payload: Uint8Array,
): Uint8Array {
	const frame = new Uint8Array(30 + payload.length);
	frame[0] = version;
	frame[1] = kind;
	frame.set(uuidBytes, 2);
	const seqView = new DataView(frame.buffer, 18, 8);
	seqView.setBigUint64(0, seq, true);
	const lenView = new DataView(frame.buffer, 26, 4);
	lenView.setUint32(0, payload.length, true);
	frame.set(payload, 30);
	return frame;
}

const NIL_UUID_BYTES = new Uint8Array(16);
const TEST_UUID_BYTES = new Uint8Array([
	0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x12, 0x34, 0x12, 0x34, 0x12, 0x34, 0x56,
	0x78, 0x9a, 0xbc,
]);

describe("parseOutputFrame", () => {
	it("parses valid history frame", () => {
		const payload = new TextEncoder().encode("hello");
		const frame = buildFrame(
			1,
			TERM_FRAME_HISTORY,
			NIL_UUID_BYTES,
			0n,
			payload,
		);
		const result = parseOutputFrame(frame);

		expect(result).not.toBeNull();
		expect(result?.kind).toBe("history");
		expect(result?.seq).toBe(0);
		expect(result?.payload).toEqual(payload);
	});

	it("parses valid live frame", () => {
		const payload = new Uint8Array([1, 2, 3]);
		const frame = buildFrame(1, TERM_FRAME_LIVE, TEST_UUID_BYTES, 42n, payload);
		const result = parseOutputFrame(frame);

		expect(result).not.toBeNull();
		expect(result?.kind).toBe("live");
		expect(result?.seq).toBe(42);
		expect(result?.sessionId).toBe("12345678-1234-1234-1234-123456789abc");
	});

	it("rejects frame with unknown kind code", () => {
		const frame = buildFrame(
			1,
			3,
			NIL_UUID_BYTES,
			7n,
			new Uint8Array([10, 20]),
		);
		const result = parseOutputFrame(frame);
		expect(result).toBeNull();
	});

	it("rejects truncated frames (too short)", () => {
		const frame = new Uint8Array(10); // less than 30 bytes
		expect(parseOutputFrame(frame)).toBeNull();
	});

	it("rejects wrong version", () => {
		const frame = buildFrame(
			99,
			TERM_FRAME_LIVE,
			NIL_UUID_BYTES,
			0n,
			new Uint8Array(0),
		);
		expect(parseOutputFrame(frame)).toBeNull();
	});

	it("rejects unknown frame kind", () => {
		const frame = buildFrame(1, 255, NIL_UUID_BYTES, 0n, new Uint8Array(0));
		expect(parseOutputFrame(frame)).toBeNull();
	});

	it("rejects frame with payload length exceeding buffer", () => {
		const frame = buildFrame(
			1,
			TERM_FRAME_LIVE,
			NIL_UUID_BYTES,
			0n,
			new Uint8Array(5),
		);
		// Corrupt the payload length to be larger than actual
		const lenView = new DataView(frame.buffer, 26, 4);
		lenView.setUint32(0, 100, true);
		expect(parseOutputFrame(frame)).toBeNull();
	});

	it("parses frame with empty payload", () => {
		const frame = buildFrame(
			1,
			TERM_FRAME_LIVE,
			NIL_UUID_BYTES,
			0n,
			new Uint8Array(0),
		);
		const result = parseOutputFrame(frame);
		expect(result).not.toBeNull();
		expect(result?.payload.length).toBe(0);
	});
});

describe("formatUuid", () => {
	it("formats nil UUID", () => {
		expect(formatUuid(NIL_UUID_BYTES)).toBe(
			"00000000-0000-0000-0000-000000000000",
		);
	});

	it("formats a known UUID", () => {
		expect(formatUuid(TEST_UUID_BYTES)).toBe(
			"12345678-1234-1234-1234-123456789abc",
		);
	});

	it("returns empty string for wrong length", () => {
		expect(formatUuid(new Uint8Array(8))).toBe("");
		expect(formatUuid(new Uint8Array(0))).toBe("");
	});

	it("roundtrips UUID bytes", () => {
		const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
		const hexPairs = uuid.replace(/-/g, "").match(/.{2}/g) ?? [];
		const bytes = new Uint8Array(hexPairs.map((h) => Number.parseInt(h, 16)));
		expect(formatUuid(bytes)).toBe(uuid);
	});
});

describe("decodeUint64LeToSafeNumber", () => {
	it("decodes zero", () => {
		const buf = new ArrayBuffer(8);
		const view = new DataView(buf);
		expect(decodeUint64LeToSafeNumber(view, 0)).toBe(0);
	});

	it("decodes small value", () => {
		const buf = new ArrayBuffer(8);
		const view = new DataView(buf);
		view.setUint32(0, 42, true);
		view.setUint32(4, 0, true);
		expect(decodeUint64LeToSafeNumber(view, 0)).toBe(42);
	});

	it("decodes value with hi bits", () => {
		const buf = new ArrayBuffer(8);
		const view = new DataView(buf);
		view.setUint32(0, 0, true);
		view.setUint32(4, 1, true);
		expect(decodeUint64LeToSafeNumber(view, 0)).toBe(2 ** 32);
	});

	it("returns null for unsafe integers", () => {
		const buf = new ArrayBuffer(8);
		const view = new DataView(buf);
		view.setUint32(0, 0xffffffff, true);
		view.setUint32(4, 0x00200000, true);
		expect(decodeUint64LeToSafeNumber(view, 0)).toBeNull();
	});

	it("handles MAX_SAFE_INTEGER", () => {
		const buf = new ArrayBuffer(8);
		const view = new DataView(buf);
		view.setUint32(0, 0xffffffff, true);
		view.setUint32(4, 0x001fffff, true);
		expect(decodeUint64LeToSafeNumber(view, 0)).toBe(Number.MAX_SAFE_INTEGER);
	});
});
