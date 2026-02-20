import { getApiBase } from "./config";
import { useAppStore } from "../stores/app-store";

// Error codes returned by the backend that use HTTP 401 but are NOT
// session-auth failures — the client should surface the real message
// instead of forcing a logout.
const NON_SESSION_AUTH_CODES = new Set([
  "INVALID_TOKEN",
  "PIN_REQUIRED",
  "INVALID_PIN",
  "PIN_LOCKED",
  "INVALID_TRUSTED_DEVICE",
]);

class ApiClient {
  private getToken(): string | null {
    return useAppStore.getState().token;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    const token = this.getToken();
    if (token) {
      h["Authorization"] = `Bearer ${token}`;
    }
    return h;
  }

  private handleError(res: Response, data: Record<string, unknown>): never {
    const code = (data.code as string) ?? "UNKNOWN";
    const message = (data.message as string) ?? res.statusText;

    if (res.status === 401 && !NON_SESSION_AUTH_CODES.has(code)) {
      useAppStore.getState().logout();
    }

    throw new ApiError(code, message, res.status);
  }

  async get<T>(
    path: string,
    params?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    let url = `${getApiBase()}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, { headers: this.headers(), signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      this.handleError(res, body);
    }
    return res.json();
  }

  async post<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (res.status === 204) {
      return undefined as T;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      this.handleError(res, data);
    }
    return res.json();
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = new ApiClient();
