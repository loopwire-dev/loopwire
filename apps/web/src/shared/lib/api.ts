import { API_BASE } from "./config";
import { useAppStore } from "../stores/app-store";

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

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${API_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 401) {
      useAppStore.getState().logout();
      throw new ApiError("UNAUTHORIZED", "Authentication required", 401);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        body.code ?? "UNKNOWN",
        body.message ?? res.statusText,
        res.status,
      );
    }
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      useAppStore.getState().logout();
      throw new ApiError("UNAUTHORIZED", "Authentication required", 401);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(
        data.code ?? "UNKNOWN",
        data.message ?? res.statusText,
        res.status,
      );
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
