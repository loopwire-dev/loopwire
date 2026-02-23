import { createTerminalChannelHandlers } from "../lib/terminalEventHandlers";
import { TerminalChannel } from "./TerminalChannel";
import type { TerminalPagingController } from "./TerminalPagingController";

type TerminalLike = {
	cols: number;
	rows: number;
	reset(): void;
	focus(): void;
	writeln(text: string): void;
};

type TerminalChannelCtor = new (
	options: ConstructorParameters<typeof TerminalChannel>[0],
) => TerminalChannel;

interface SetupTerminalChannelArgs {
	sessionId: string;
	token: string | null;
	terminal: TerminalLike | null;
	paging: TerminalPagingController;
	gotFirstOutputRef: { current: boolean };
	channelRef: { current: TerminalChannel | null };
	setIsLoading: (value: boolean) => void;
	setConnectionError: (value: string | null) => void;
	ChannelClass?: TerminalChannelCtor;
}

export function setupTerminalChannel({
	sessionId,
	token,
	terminal,
	paging,
	gotFirstOutputRef,
	channelRef,
	setIsLoading,
	setConnectionError,
	ChannelClass = TerminalChannel,
}: SetupTerminalChannelArgs): (() => void) | null {
	if (!terminal || !sessionId) return null;
	if (!token) {
		setIsLoading(false);
		setConnectionError("Not authenticated. Reconnect to Loopwire.");
		return null;
	}

	setIsLoading(true);
	setConnectionError(null);
	gotFirstOutputRef.current = false;
	const initialCols = terminal.cols > 0 ? terminal.cols : undefined;
	const initialRows = terminal.rows > 0 ? terminal.rows : undefined;

	const channel = new ChannelClass({
		sessionId,
		token,
		initialCols,
		initialRows,
		handlers: createTerminalChannelHandlers({
			sessionId,
			terminal,
			paging,
			sendResize: (cols, rows) => channel.sendResize(cols, rows),
			setIsLoading,
			setConnectionError,
			gotFirstOutputRef,
		}),
	});

	channelRef.current = channel;
	channel.connect();

	return () => {
		if (channelRef.current === channel) {
			channelRef.current = null;
		}
		channel.disconnect();
	};
}
