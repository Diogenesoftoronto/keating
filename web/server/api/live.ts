import { createError, defineWebSocketHandler, getHeader, getRequestURL } from "h3";
import { createGptLiveRelay, gptLiveServerConfig, GptLiveRelayError, validateGptLiveOrigin, type GptLiveConnect } from "../utils/gpt-live-relay";

export function createGptLiveHandler(options: { env?: NodeJS.ProcessEnv; connect?: GptLiveConnect } = {}) {
 return defineWebSocketHandler(event => {
  const requestUrl = getRequestURL(event, { xForwardedHost: false, xForwardedProto: true }).href;
  const origin = getHeader(event, "origin");
  let config;
  try {
    validateGptLiveOrigin(requestUrl, origin);
    if (getHeader(event, "sec-websocket-protocol")) throw new GptLiveRelayError("live_protocol_rejected", 400, "Live does not accept WebSocket subprotocol credentials.");
    config = gptLiveServerConfig(options.env);
  } catch (error) {
    const safe = error instanceof GptLiveRelayError ? error : new GptLiveRelayError("live_relay_unavailable", 503, "Live is unavailable.");
    throw createError({ statusCode: safe.status, statusMessage: safe.message, data: { code: safe.code } });
  }
  let relay: ReturnType<typeof createGptLiveRelay> | undefined;
  return {
    open(peer) {
      relay = createGptLiveRelay({ send: text => peer.send(text), close: (code, reason) => peer.close(code, reason),
        bufferedAmount() {
          const socket = peer.websocket as { bufferedAmount?: number; getBufferedAmount?: () => number };
          return typeof socket.bufferedAmount === "number" ? socket.bufferedAmount : socket.getBufferedAmount?.() ?? Infinity;
        } }, { requestUrl, origin, config, connect: options.connect });
    },
    message(_peer, message) { relay?.message(message.rawData); },
    close() { relay?.close(); relay = undefined; },
    error() { relay?.error(); relay = undefined; },
  };
 });
}

export default createGptLiveHandler();
