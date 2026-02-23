import type { Terminal as XTerm } from "@xterm/xterm";
import type { TerminalOutputKind } from "./TerminalChannel";

export function binaryStringToBytes(data: string): Uint8Array {
	const bytes = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) {
		bytes[i] = data.charCodeAt(i) & 0xff;
	}
	return bytes;
}

export function inputStringToBytes(data: string): Uint8Array {
	let isSingleByteStream = true;
	for (let i = 0; i < data.length; i++) {
		if (data.charCodeAt(i) > 0xff) {
			isSingleByteStream = false;
			break;
		}
	}
	if (isSingleByteStream) {
		return binaryStringToBytes(data);
	}
	return new TextEncoder().encode(data);
}

export class TerminalPagingController {
	private terminal: XTerm | null = null;
	private suppressInput = false;
	private queuedFrames: Array<{ kind: TerminalOutputKind; bytes: Uint8Array }> =
		[];
	private historyWriteInProgress = false;
	private lastOutputSeq: number | null = null;

	get isInputSuppressed(): boolean {
		return this.suppressInput;
	}

	setTerminal(terminal: XTerm | null): void {
		this.terminal = terminal;
	}

	reset(): void {
		this.queuedFrames = [];
		this.suppressInput = false;
		this.historyWriteInProgress = false;
		this.lastOutputSeq = null;
	}

	dispose(): void {
		this.queuedFrames = [];
		this.suppressInput = false;
		this.historyWriteInProgress = false;
		this.lastOutputSeq = null;
		this.terminal = null;
	}

	checkSequence(seq: number): void {
		const prev = this.lastOutputSeq;
		if (prev !== null && seq <= prev) {
			console.debug(
				"[terminal] non-monotonic frame sequence",
				"prev=",
				prev,
				"curr=",
				seq,
			);
		}
		this.lastOutputSeq = prev === null ? seq : Math.max(prev, seq);
	}

	processFrame(kind: TerminalOutputKind, bytes: Uint8Array): void {
		const terminal = this.terminal;
		if (!terminal) return;

		if (kind === "history") {
			this.historyWriteInProgress = true;
			this.suppressInput = true;
			terminal.write(bytes, () => {
				this.historyWriteInProgress = false;
				this.suppressInput = false;
				// Drain any live frames that arrived during history write
				const queued = this.queuedFrames;
				this.queuedFrames = [];
				for (const frame of queued) {
					this.processFrame(frame.kind, frame.bytes);
				}
			});
			return;
		}

		// "live" frame
		if (this.historyWriteInProgress) {
			this.queuedFrames.push({ kind, bytes: new Uint8Array(bytes) });
			return;
		}

		terminal.write(bytes);
	}
}
