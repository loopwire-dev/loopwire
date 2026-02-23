import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import "@xterm/xterm/css/xterm.css";

import { useAppStore } from "../../../shared/stores/app-store";
import type { TerminalChannel } from "../channel/TerminalChannel";
import {
	TerminalPagingController,
	binaryStringToBytes,
	inputStringToBytes,
} from "../channel/TerminalPagingController";
import { setupTerminalChannel } from "../channel/setupTerminalChannel";
import { createTerminalWheelHandler } from "../lib/terminalEventHandlers";

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

export function useTerminal(
	sessionId: string,
	theme: "dark" | "light",
	onScrollPastTop?: () => void,
): {
	ref: RefObject<HTMLDivElement>;
	isLoading: boolean;
	connectionError: string | null;
	sendInput: (data: string) => boolean;
} {
	const containerRef = useRef<HTMLDivElement>(null);
	const channelRef = useRef<TerminalChannel | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	const pagingControllerRef = useRef<TerminalPagingController>(
		new TerminalPagingController(),
	);
	const onScrollPastTopRef = useRef(onScrollPastTop);
	onScrollPastTopRef.current = onScrollPastTop;

	const token = useAppStore((s) => s.token);

	const [isLoading, setIsLoading] = useState(false);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [terminal, setTerminal] = useState<XTerm | null>(null);
	const gotFirstOutputRef = useRef(false);

	useEffect(() => {
		setIsLoading(Boolean(sessionId));
	}, [sessionId]);

	const sendInput = useCallback((data: string) => {
		return channelRef.current?.sendInputUtf8(data) ?? false;
	}, []);

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
		const serialize = new SerializeAddon();
		term.loadAddon(fit);
		term.loadAddon(serialize);
		term.loadAddon(new WebLinksAddon());
		try {
			term.loadAddon(new WebglAddon());
		} catch {
			// WebGL fallback to default renderer.
		}

		term.open(wrapper);
		fit.fit();
		setTerminal(term);
		requestAnimationFrame(() => term.focus());

		const paging = pagingControllerRef.current;
		paging.setTerminal(term);

		const viewport =
			term.element?.querySelector<HTMLElement>(".xterm-viewport");
		viewportRef.current = viewport ?? null;

		let disposed = false;
		const observer = new ResizeObserver(() => {
			if (!disposed) {
				fit.fit();
			}
		});
		observer.observe(container);

		const dataSub = term.onData((data) => {
			if (paging.isInputSuppressed) return;
			channelRef.current?.sendInputBytes(inputStringToBytes(data));
		});

		const binarySub = term.onBinary((data) => {
			if (paging.isInputSuppressed) return;
			channelRef.current?.sendInputBytes(binaryStringToBytes(data));
		});

		const resizeSub = term.onResize(({ cols, rows }) => {
			channelRef.current?.sendResize(cols, rows);
		});

		// Always consume wheel events to prevent xterm.js from forwarding them
		// as mouse input to the agent (which causes input-history scrolling).
		// When the viewport has scrollback content, scroll it directly.
		// When scrolled to the very top and scrolling up further, trigger
		// the scrollback overlay via onScrollPastTop.
		term.attachCustomWheelEventHandler((event) => {
			return createTerminalWheelHandler({
				viewport: viewportRef.current,
				terminal: term,
				onScrollPastTop: onScrollPastTopRef.current,
			})(event);
		});

		return () => {
			disposed = true;
			observer.disconnect();
			dataSub.dispose();
			binarySub.dispose();
			resizeSub.dispose();
			channelRef.current?.disconnect();
			channelRef.current = null;
			paging.dispose();
			viewportRef.current = null;
			setTerminal(null);
			wrapper.remove();
			setTimeout(() => {
				try {
					term.dispose();
				} catch {
					// no-op
				}
			}, 0);
		};
	}, [sessionId, theme]);

	useEffect(() => {
		const paging = pagingControllerRef.current;
		const cleanup = setupTerminalChannel({
			sessionId,
			token,
			terminal,
			paging,
			gotFirstOutputRef,
			channelRef,
			setIsLoading,
			setConnectionError,
		});
		return cleanup ?? undefined;
	}, [sessionId, terminal, token]);

	useEffect(() => {
		if (!terminal) return;
		terminal.options.theme = THEMES[theme];
	}, [terminal, theme]);

	return { ref: containerRef, isLoading, connectionError, sendInput };
}
