import { useEffect } from "react";
import { wsClient, type WsEnvelope } from "../lib/ws";

export function useWebSocket(
  type: string,
  handler: (envelope: WsEnvelope) => void,
) {
  useEffect(() => {
    return wsClient.on(type, handler);
  }, [type, handler]);
}
