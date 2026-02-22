import { useEffect } from "react";
import { onDaemonWsEvent } from "../lib/daemon/ws";
import type { WsEnvelope } from "../lib/ws";

export function useWebSocket(
	type: string,
	handler: (envelope: WsEnvelope) => void,
) {
	useEffect(() => {
		return onDaemonWsEvent(type, handler);
	}, [type, handler]);
}
