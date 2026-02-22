import { useEffect } from "react";
import { type WsEnvelope, wsClient } from "../lib/ws";

export function useWebSocket(
	type: string,
	handler: (envelope: WsEnvelope) => void,
) {
	useEffect(() => {
		return wsClient.on(type, handler);
	}, [type, handler]);
}
