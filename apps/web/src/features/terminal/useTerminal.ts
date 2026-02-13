import { useEffect, useRef, useState, type RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ApiError, api } from "../../shared/lib/api";
import { wsClient, type WsEnvelope } from "../../shared/lib/ws";
import { useAppStore } from "../../shared/stores/app-store";

function decodeBase64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    bin += String.fromCharCode(byte);
  }
  return btoa(bin);
}

const THEMES = {
  dark: {
    background: "#242424",
    foreground: "#d4d4d4",
    cursor: "#aeafad",
    selectionBackground: "#264f78",
  },
  light: {
    background: "#ffffff",
    foreground: "#333333",
    cursor: "#000000",
    selectionBackground: "#add6ff",
  },
} as const;

const TERMINAL_SCROLLBACK_LINES = 200_000;
const POINTER_CLICK_MAX_DURATION_MS = 500;
const POINTER_CLICK_MAX_MOVEMENT_PX = 5;

function repeat(sequence: string, count: number): string {
  if (count <= 0) return "";
  return sequence.repeat(count);
}

function arrowSequence(
  direction: "A" | "B" | "C" | "D",
  applicationCursor: boolean,
): string {
  return `\x1b${applicationCursor ? "O" : "["}${direction}`;
}

function moveCursorByPointerSequence(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  cols: number,
  applicationCursor: boolean,
): string {
  if (startX === targetX && startY === targetY) return "";

  // In the normal shell buffer, horizontal movement is safest. It avoids
  // sending up/down, which shells often map to command history.
  if (startY === targetY) {
    const direction = startX > targetX ? "D" : "C";
    return repeat(arrowSequence(direction, applicationCursor), Math.abs(startX - targetX));
  }

  const movingLeft = startY > targetY;
  const rowDifference = Math.abs(startY - targetY);
  const firstSegment = cols - (movingLeft ? targetX : startX);
  const middleSegment = (rowDifference - 1) * cols + 1;
  const lastSegment = (movingLeft ? startX : targetX) - 1;
  const cellsToMove = Math.max(0, firstSegment + middleSegment + lastSegment);

  return repeat(
    arrowSequence(movingLeft ? "D" : "C", applicationCursor),
    cellsToMove,
  );
}

function getPointerCell(
  event: MouseEvent,
  screen: HTMLElement,
  cols: number,
  rows: number,
): { x: number; y: number } | null {
  if (cols <= 0 || rows <= 0) return null;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const cellWidth = rect.width / cols;
  const cellHeight = rect.height / rows;
  const rawX = Math.floor((event.clientX - rect.left) / cellWidth);
  const rawY = Math.floor((event.clientY - rect.top) / cellHeight);
  const x = Math.max(0, Math.min(cols - 1, rawX));
  const y = Math.max(0, Math.min(rows - 1, rawY));

  return { x, y };
}

function isPtySessionNotFoundError(err: unknown): boolean {
  return err instanceof Error && /pty session not found/i.test(err.message);
}

interface AgentSessionStatusResponse {
  status: string;
}

async function isSessionStillRunning(sessionId: string): Promise<boolean> {
  try {
    const session = await api.get<AgentSessionStatusResponse>(`/agents/sessions/${sessionId}`);
    return session.status === "running";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return false;
    }
    return true;
  }
}

export function useTerminal(
  sessionId: string,
  theme: "dark" | "light",
): { ref: RefObject<HTMLDivElement>; isLoading: boolean } {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminal, setTerminal] = useState<XTerm | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const removeSessionById = useAppStore((s) => s.removeSessionById);

  useEffect(() => {
    setIsLoading(Boolean(sessionId));
  }, [sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;

    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    container.appendChild(wrapper);

    const term = new XTerm({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: 'Monaco, Menlo, "Courier New", monospace',
      fontSize: 14,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: THEMES[theme],
    });

    const fit = new FitAddon();
    fitAddonRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(wrapper);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available — falls back to default renderer
    }

    let disposed = false;
    const observer = new ResizeObserver(() => {
      if (!disposed) fit.fit();
    });
    observer.observe(container);

    fit.fit();
    setTerminal(term);

    return () => {
      disposed = true;
      observer.disconnect();
      setTerminal(null);
      fitAddonRef.current = null;
      // Detach the wrapper immediately so the next mount gets a clean
      // container, but keep it in memory so xterm.js internal callbacks
      // can still access the renderer. The Viewport constructor
      // schedules setTimeout(() => syncScrollArea()), so we defer
      // dispose with setTimeout to run after it (FIFO ordering).
      wrapper.remove();
      setTimeout(() => {
        try { term.dispose(); } catch { /* WebGL context already lost */ }
      }, 0);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!terminal || !sessionId) return;
    let active = true;
    let subscribed = false;
    let inputEnabled = false;
    let replaying = false;
    let receivedOutput = false;
    let notFoundHandled = false;
    setIsLoading(true);

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const sendSubscribe = async () => {
      try {
        inputEnabled = false;
        await wsClient.sendAndWait("pty:subscribe", { session_id: sessionId });
        if (!active) return;
        subscribed = true;
        for (let remaining = 12; active && remaining > 0; remaining--) {
          fitAddonRef.current?.fit();
          if (terminal.cols > 0 && terminal.rows > 0) {
            sendResize(terminal.cols, terminal.rows, true);
            terminal.refresh(0, Math.max(0, terminal.rows - 1));
            break;
          }
          await wait(50);
        }
        await nextFrame();
        await nextFrame();
        if (!active) return;
        await wsClient.sendAndWait("pty:ready", { session_id: sessionId });
        if (!active) return;
        inputEnabled = true;
        if (!replaying) {
          setIsLoading(false);
        }
      } catch (e) {
        if (!active) return;
        if (isPtySessionNotFoundError(e)) {
          if (notFoundHandled) return;
          notFoundHandled = true;
          const stillRunning = await isSessionStillRunning(sessionId);
          if (!active) return;
          if (!stillRunning) {
            removeSessionById(sessionId);
          }
          setIsLoading(false);
          terminal.reset();
          terminal.options.disableStdin = true;
          terminal.options.cursorBlink = false;
          terminal.write(
            stillRunning
              ? "Session is still running, but terminal attachment was lost after daemon restart.\r\nStop and restart this session to continue interactively.\r\n"
              : "Session no longer exists.\r\n",
          );
          terminal.write("\x1b[?25l");
          return;
        }
        console.warn("[terminal] subscribe failed:", e);
        subscribed = false;
      }
    };

    const sendResize = (cols: number, rows: number, force = false) => {
      if (cols <= 0 || rows <= 0) return;
      if (!force && !subscribed) return;
      wsClient.send(
        "pty:resize",
        { session_id: sessionId, cols, rows },
        { queueWhenDisconnected: false },
      );
    };

    const dataSub = terminal.onData((data) => {
      if (!subscribed || replaying || !inputEnabled) return;
      wsClient.send(
        "pty:input",
        { session_id: sessionId, data },
        { queueWhenDisconnected: false },
      );
    });
    const binarySub = terminal.onBinary((data) => {
      if (!subscribed || replaying || !inputEnabled) return;
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      wsClient.send("pty:input", {
        session_id: sessionId,
        data_b64: encodeBytesToBase64(bytes),
      }, { queueWhenDisconnected: false });
    });
    const resizeSub = terminal.onResize(({ cols, rows }) =>
      sendResize(cols, rows),
    );

    const unsubOutput = wsClient.on("pty:output", (env: WsEnvelope) => {
      if (env.payload.session_id !== sessionId) return;
      const raw = env.payload.data as string;
      const decoded = decodeBase64ToBytes(raw);
      if (decoded.length > 0) {
        terminal.write(decoded);
        if (!receivedOutput && active) {
          receivedOutput = true;
          setIsLoading(false);
        }
      }
    });

    const unsubExit = wsClient.on("pty:exit", (env: WsEnvelope) => {
      if (env.payload.session_id !== sessionId) return;
      // Session lifecycle is handled centrally in useDaemon to avoid duplicate
      // status polling on reconnect/reattach churn.
    });

    const unsubReplayStart = wsClient.on("pty:replay_start", (env: WsEnvelope) => {
      if (env.payload.session_id !== sessionId) return;
      replaying = true;
      inputEnabled = false;
      setIsLoading(true);
    });

    const unsubReplayEnd = wsClient.on("pty:replay_end", (env: WsEnvelope) => {
      if (env.payload.session_id !== sessionId) return;
      replaying = false;
      if (inputEnabled || receivedOutput) {
        setIsLoading(false);
      }
    });

    const unsubReconnect = wsClient.onReconnect(() => {
      subscribed = false;
      inputEnabled = false;
      replaying = false;
      void sendSubscribe();
    });

    void sendSubscribe();

    let pointerDown:
      | { clientX: number; clientY: number; startedAt: number }
      | null = null;
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (terminal.options.disableStdin) return;
      if (terminal.modes.mouseTrackingMode !== "none") return;
      pointerDown = {
        clientX: event.clientX,
        clientY: event.clientY,
        startedAt: Date.now(),
      };
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!pointerDown) return;
      const down = pointerDown;
      pointerDown = null;
      if (event.button !== 0) return;
      const elapsed = Date.now() - down.startedAt;
      const moved =
        Math.abs(event.clientX - down.clientX) > POINTER_CLICK_MAX_MOVEMENT_PX ||
        Math.abs(event.clientY - down.clientY) > POINTER_CLICK_MAX_MOVEMENT_PX;
      if (elapsed > POINTER_CLICK_MAX_DURATION_MS || moved) return;
      if (terminal.options.disableStdin) return;
      if (terminal.modes.mouseTrackingMode !== "none") return;
      if (!screen) return;

      const cell = getPointerCell(event, screen, terminal.cols, terminal.rows);
      if (!cell) return;

      const activeBuffer = terminal.buffer.active;
      const sequence = moveCursorByPointerSequence(
        activeBuffer.cursorX,
        activeBuffer.cursorY,
        cell.x,
        cell.y,
        terminal.cols,
        terminal.modes.applicationCursorKeysMode,
      );
      if (!sequence) return;

      if (!subscribed || replaying || !inputEnabled) return;
      wsClient.send(
        "pty:input",
        { session_id: sessionId, data: sequence },
        { queueWhenDisconnected: false },
      );
      terminal.focus();
      event.preventDefault();
    };
    if (screen) {
      screen.addEventListener("mousedown", onMouseDown);
      screen.addEventListener("mouseup", onMouseUp);
    }

    sendResize(terminal.cols, terminal.rows);

    return () => {
      active = false;
      subscribed = false;
      dataSub.dispose();
      binarySub.dispose();
      resizeSub.dispose();
      unsubOutput();
      unsubExit();
      unsubReplayStart();
      unsubReplayEnd();
      unsubReconnect();
      if (screen) {
        screen.removeEventListener("mousedown", onMouseDown);
        screen.removeEventListener("mouseup", onMouseUp);
      }
      wsClient.send(
        "pty:unsubscribe",
        { session_id: sessionId },
        { queueWhenDisconnected: false },
      );
    };
  }, [removeSessionById, terminal, sessionId]);

  useEffect(() => {
    if (!terminal) return;
    terminal.options.theme = THEMES[theme];
  }, [theme, terminal]);

  return { ref: containerRef, isLoading };
}
