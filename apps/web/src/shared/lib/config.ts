import { discoverDaemon } from "./discovery";

const ENV_DAEMON_URL = import.meta.env.VITE_DAEMON_URL ?? "";
const BACKEND_OVERRIDE_KEY = "loopwire_backend_override";
const DISCOVERED_URL_KEY = "loopwire_discovered_url";
const DISCOVERY_ENABLED_KEY = "loopwire_discovery_enabled";

let discoveredUrl: string | null = null;

function normalizeDaemonUrl(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
}

function parseHexOrBytes(input: string): Uint8Array {
	const trimmed = input.trim();
	if (
		trimmed.length > 0 &&
		trimmed.length % 2 === 0 &&
		/^[a-f0-9]+$/i.test(trimmed)
	) {
		const out = new Uint8Array(trimmed.length / 2);
		for (let i = 0; i < out.length; i += 1) {
			out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
		}
		return out;
	}

	return new TextEncoder().encode(trimmed);
}

function streamKeyByte(
	index: number,
	inviteKey: Uint8Array,
	nonce: Uint8Array,
): number {
	const invite = inviteKey[index % inviteKey.length] ?? 0;
	const salt = nonce[index % nonce.length] ?? 0;
	return (invite ^ salt ^ ((index * 31) & 0xff)) & 0xff;
}

function decodeTargetParam(target: string, invite: string): string | null {
	const [nonceHex, cipherHex] = target.split(".", 2);
	if (!nonceHex || !cipherHex) return null;

	const nonce = parseHexOrBytes(nonceHex);
	const cipher = parseHexOrBytes(cipherHex);
	const inviteKey = parseHexOrBytes(invite);
	if (!nonce.length || !cipher.length || !inviteKey.length) return null;

	const plain = new Uint8Array(cipher.length);
	for (let i = 0; i < cipher.length; i += 1) {
		plain[i] = (cipher[i] ?? 0) ^ streamKeyByte(i, inviteKey, nonce);
	}

	const decoded = new TextDecoder().decode(plain);
	return normalizeDaemonUrl(decoded);
}

function readBackendParam(): string | null {
	try {
		const params = new URL(window.location.href).searchParams;

		const target = params.get("target");
		const invite = params.get("invite");
		if (target && invite) {
			const decoded = decodeTargetParam(target, invite);
			if (decoded) return decoded;
		}

		// Backward compatibility for pre-obfuscation links.
		const raw = params.get("backend");
		if (raw) {
			return normalizeDaemonUrl(raw);
		}

		return null;
	} catch {
		return null;
	}
}

export async function initDaemonDiscovery(): Promise<void> {
	if (!isManualDiscoveryEnabled()) {
		return;
	}

	// Only run discovery when no explicit URL is configured
	const hasEnvUrl = !!normalizeDaemonUrl(ENV_DAEMON_URL);
	const hasQueryParam = !!readBackendParam();
	const hasSessionOverride = !!sessionStorage.getItem(BACKEND_OVERRIDE_KEY);

	if (hasEnvUrl || hasQueryParam || hasSessionOverride) {
		return;
	}

	const result = await discoverDaemon();
	if (result) {
		discoveredUrl = result;
		sessionStorage.setItem(DISCOVERED_URL_KEY, result);
	}
}

export function isManualDiscoveryEnabled(): boolean {
	return sessionStorage.getItem(DISCOVERY_ENABLED_KEY) === "1";
}

export function enableManualDiscovery(): void {
	sessionStorage.setItem(DISCOVERY_ENABLED_KEY, "1");
}

export function getDaemonUrl(): string {
	const fromQuery = readBackendParam();
	if (fromQuery) {
		sessionStorage.setItem(BACKEND_OVERRIDE_KEY, fromQuery);
		return fromQuery;
	}

	const fromSession = sessionStorage.getItem(BACKEND_OVERRIDE_KEY);
	if (fromSession) {
		const normalized = normalizeDaemonUrl(fromSession);
		if (normalized) {
			return normalized;
		}
		sessionStorage.removeItem(BACKEND_OVERRIDE_KEY);
	}

	const envUrl = normalizeDaemonUrl(ENV_DAEMON_URL);
	if (envUrl) return envUrl;

	// Fallback to discovered URL
	if (discoveredUrl) return discoveredUrl;

	const cachedDiscovered = sessionStorage.getItem(DISCOVERED_URL_KEY);
	if (cachedDiscovered) {
		const normalized = normalizeDaemonUrl(cachedDiscovered);
		if (normalized) {
			discoveredUrl = normalized;
			return normalized;
		}
		sessionStorage.removeItem(DISCOVERED_URL_KEY);
	}

	return "";
}

export function getApiBase(): string {
	return `${getDaemonUrl()}/api/v1`;
}

export function getWsBase(): string {
	const daemonUrl = getDaemonUrl();
	if (daemonUrl) {
		return daemonUrl.replace(/^http/i, "ws");
	}

	if (import.meta.env.DEV) {
		return "ws://localhost:9400";
	}

	const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${wsProtocol}//${window.location.host}`;
}

export function getWsUrl(): string {
	return `${getWsBase()}/api/v1/ws`;
}
