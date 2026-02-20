// Auto-generated terminal wire types — do not edit manually

export interface TerminalReadyEvent {
  type: "ready";
  session_id: string;
  history_source: "tmux" | "ring";
  history_truncated: boolean;
}

export interface TerminalExitEvent {
  type: "exit";
  session_id: string;
  exit_code: number | null;
}

export interface TerminalErrorEvent {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

export type TerminalServerEvent =
  | TerminalReadyEvent
  | TerminalExitEvent
  | TerminalErrorEvent;

export interface TerminalResizeCommand {
  type: "resize";
  cols: number;
  rows: number;
}

export interface TerminalInputUtf8Command {
  type: "input_utf8";
  data: string;
}

export type TerminalClientCommand =
  | TerminalResizeCommand
  | TerminalInputUtf8Command;

export const TERMINAL_WIRE_VERSION = 1;
export const TERMINAL_BINARY_FRAME_HISTORY = 1;
export const TERMINAL_BINARY_FRAME_LIVE = 2;
export const TERMINAL_BINARY_INPUT_OPCODE = 1;
