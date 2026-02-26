import { stopAgentSession } from "../../../shared/lib/daemon/rest";
import { useAppStore } from "../../../shared/stores/app-store";
import type { TerminalOutputKind } from "../channel/TerminalChannel";
import type { TerminalPagingController } from "../channel/TerminalPagingController";

interface WheelTerminalLike {
	cols: number;
	rows: number;
	options: { fontSize?: number; lineHeight?: number };
	reset(): void;
	focus(): void;
	writeln(text: string): void;
}

interface ChannelTerminalLike {
	cols: number;
	rows: number;
	reset(): void;
	focus(): void;
	writeln(text: string): void;
}

interface WheelViewportLike {
	scrollHeight: number;
	clientHeight: number;
	scrollTop: number;
}

interface WheelEventLike {
	deltaMode: number;
	deltaY: number;
	preventDefault(): void;
	stopPropagation(): void;
}

interface WheelHandlerParams {
	viewport: WheelViewportLike | null;
	terminal: WheelTerminalLike;
	onScrollPastTop?: () => void;
}

interface ChannelHandlersParams {
	sessionId: string;
	terminal: ChannelTerminalLike;
	paging: TerminalPagingController;
	sendResize: (cols: number, rows: number) => void;
	setIsLoading: (value: boolean) => void;
	setConnectionError: (value: string | null) => void;
	gotFirstOutputRef: { current: boolean };
}

function computeWheelDeltaPx(
	event: WheelEventLike,
	viewport: WheelViewportLike,
	terminal: WheelTerminalLike,
): number {
	const fontSize = terminal.options.fontSize ?? 14;
	const lineHeightScale = terminal.options.lineHeight ?? 1;
	const lineHeight = Math.ceil(fontSize * lineHeightScale);
	if (event.deltaMode === 1) return event.deltaY * lineHeight;
	if (event.deltaMode === 2) return event.deltaY * viewport.clientHeight;
	return event.deltaY;
}

export function createTerminalWheelHandler(params: WheelHandlerParams) {
	const { viewport, terminal, onScrollPastTop } = params;
	return (event: WheelEventLike) => {
		if (!viewport) return false;

		if (viewport.scrollHeight > viewport.clientHeight) {
			const deltaPx = computeWheelDeltaPx(event, viewport, terminal);
			if (viewport.scrollTop === 0 && deltaPx < 0) {
				onScrollPastTop?.();
			} else if (deltaPx !== 0) {
				viewport.scrollTop += deltaPx;
			}
		} else if (event.deltaY < 0) {
			onScrollPastTop?.();
		}

		event.preventDefault();
		event.stopPropagation();
		return false;
	};
}

export function createTerminalChannelHandlers(params: ChannelHandlersParams) {
	const {
		sessionId,
		terminal,
		paging,
		sendResize,
		setIsLoading,
		setConnectionError,
		gotFirstOutputRef,
	} = params;

	return {
		onConnectionChange: (connected: boolean) => {
			if (!connected) {
				setIsLoading(true);
				paging.reset();
			}
		},
		onReady: ({ sessionId: readySessionId }: { sessionId: string }) => {
			if (readySessionId !== sessionId) return;
			gotFirstOutputRef.current = false;
			paging.reset();
			terminal.reset();
			setConnectionError(null);
			terminal.focus();
			if (terminal.cols > 0 && terminal.rows > 0) {
				sendResize(terminal.cols, terminal.rows);
			}
		},
		onOutput: (
			meta: { sessionId: string; seq: number },
			kind: TerminalOutputKind,
			bytes: Uint8Array,
		) => {
			if (meta.sessionId !== sessionId) return;
			if (!gotFirstOutputRef.current) {
				gotFirstOutputRef.current = true;
				setIsLoading(false);
				useAppStore.getState().setAgentLaunchOverlay(false);
			}
			paging.checkSequence(meta.seq);
			paging.processFrame(kind, bytes);
		},
		onExit: (_exitCode: number | null) => {
			setIsLoading(false);
			useAppStore.getState().setAgentLaunchOverlay(false);
			useAppStore.getState().removeSessionById(sessionId);
			stopAgentSession(sessionId).catch(() => {});
		},
		onError: (message: string) => {
			paging.reset();
			setIsLoading(false);
			useAppStore.getState().setAgentLaunchOverlay(false);
			setConnectionError(message);
			console.warn("[terminal] channel error:", message);
			terminal.writeln(`\r\n[terminal] ${message}`);
		},
	};
}
