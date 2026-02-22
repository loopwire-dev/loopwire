import { useAppStore } from "../../stores/app-store";
import { getApiBase } from "../config";

const NON_SESSION_AUTH_CODES = new Set([
	"INVALID_TOKEN",
	"PIN_REQUIRED",
	"INVALID_PIN",
	"PIN_LOCKED",
	"INVALID_TRUSTED_DEVICE",
]);

function getToken(): string | null {
	return useAppStore.getState().token;
}

function headers(extra?: Record<string, string>): Record<string, string> {
	const h: Record<string, string> = {
		"Content-Type": "application/json",
		...extra,
	};
	const token = getToken();
	if (token) {
		h.Authorization = `Bearer ${token}`;
	}
	return h;
}

function handleError(res: Response, data: Record<string, unknown>): never {
	const code = (data.code as string) ?? "UNKNOWN";
	const message = (data.message as string) ?? res.statusText;

	if (res.status === 401 && !NON_SESSION_AUTH_CODES.has(code)) {
		useAppStore.getState().logout();
	}

	throw new ApiError(code, message, res.status);
}

/**
 * Error thrown by HTTP helpers when backend requests fail.
 */
export class ApiError extends Error {
	/**
	 * Creates a typed API error with backend error code and HTTP status.
	 */
	constructor(
		public code: string,
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** Performs a GET request against the daemon API base URL. */
export async function get<T>(
	path: string,
	params?: Record<string, string>,
	signal?: AbortSignal,
): Promise<T> {
	let url = `${getApiBase()}${path}`;
	if (params) {
		const qs = new URLSearchParams(params).toString();
		url += `?${qs}`;
	}
	const res = await fetch(url, { headers: headers(), signal });
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		handleError(res, body);
	}
	return res.json();
}

/** Performs a POST request against the daemon API base URL. */
export async function post<T>(
	path: string,
	body?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	const res = await fetch(`${getApiBase()}${path}`, {
		method: "POST",
		headers: headers(),
		body: body ? JSON.stringify(body) : undefined,
		signal,
	});
	if (res.status === 204) {
		return undefined as T;
	}
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		handleError(res, data);
	}
	return res.json();
}
