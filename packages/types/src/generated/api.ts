// Auto-generated from backend schema — do not edit manually

export interface HealthResponse {
  status: string;
  version: string;
  uptime_secs: number;
}

export interface BootstrapResponse {
  status: string;
  version: string;
}

export interface ExchangeRequest {
  bootstrap_token: string;
}

export interface ExchangeResponse {
  session_token: string;
}

export interface RotateResponse {
  session_token: string;
}

export interface ApiError {
  code: string;
  message: string;
  details: unknown | null;
  retryable: boolean;
}

export interface ResizeRequest {
  cols: number;
  rows: number;
}

export interface InputRequest {
  data: string;
}
