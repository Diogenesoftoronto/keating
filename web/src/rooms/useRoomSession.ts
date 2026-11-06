import { useCallback, useEffect, useRef, useState } from "react";
import { applyRoomOperation, getEarlierRoomMessages, getRoom, RoomApiError } from "./client";
import type { RoomClientSocketMessage, RoomOperationInput, RoomRealtimeMessage, RoomViewerSnapshot } from "./contracts";
import { INITIAL_ROOM_CLIENT_STATE, roomClientReducer, type RoomClientAction, type RoomClientState } from "./room-state";

export type RoomConnectionStatus = "connecting" | "connected" | "reconnecting";

export interface RoomSession {
  state: RoomClientState;
  status: RoomConnectionStatus;
  error: string;
  loadError: { message: string; status: number } | null;
  setError: (message: string) => void;
  mutate: (operation: RoomOperationInput) => Promise<RoomViewerSnapshot | null>;
  applySnapshot: (snapshot: RoomViewerSnapshot) => void;
  send: (message: RoomClientSocketMessage) => void;
  loadEarlier: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface RoomSessionConnectionDependencies {
  getRoom: typeof getRoom;
  apply: typeof applyRoomOperation;
  getEarlier: typeof getEarlierRoomMessages;
  socket: (roomId: string) => WebSocket;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (timer: number) => void;
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (timer: number) => void;
  now: () => number;
}

interface RoomSessionHandlers {
  onState: (state: RoomClientState) => void;
  onStatus: (status: RoomConnectionStatus) => void;
  onError: (message: string) => void;
  onLoadError: (error: RoomSession["loadError"]) => void;
}

/** One room lifetime. All HTTP/socket callbacks are fenced by this lifetime. */
export function createRoomSessionConnection(
  roomId: string,
  handlers: RoomSessionHandlers,
  overrides: Partial<RoomSessionConnectionDependencies> = {},
) {
  const dependencies: RoomSessionConnectionDependencies = {
    getRoom,
    apply: applyRoomOperation,
    getEarlier: getEarlierRoomMessages,
    socket: (id) => new WebSocket(`${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/rooms/realtime?roomId=${encodeURIComponent(id)}`),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (timer) => window.clearTimeout(timer),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (timer) => window.clearInterval(timer),
    now: Date.now,
    ...overrides,
  };
  let active = true;
  let state: RoomClientState = { ...INITIAL_ROOM_CLIENT_STATE, roomId };
  let socket: WebSocket | null = null;
  let retries = 0;
  let retryTimer: number | undefined;
  let pingTimer: number | undefined;
  let pollTimer: number | undefined;
  let awaitingPong = false;
  let refreshing: Promise<void> | undefined;

  const emit = (action: RoomClientAction) => {
    if (!active) return;
    const next = roomClientReducer(state, action);
    if (next === state) return;
    state = next;
    handlers.onState(state);
    if (state.removed) stop();
  };

  function closeSocket() {
    const old = socket;
    socket = null;
    awaitingPong = false;
    if (pingTimer !== undefined) dependencies.clearInterval(pingTimer);
    pingTimer = undefined;
    try { old?.close(); } catch { /* A failed socket is already disconnected. */ }
  }

  function stop() {
    active = false;
    if (retryTimer !== undefined) dependencies.clearTimeout(retryTimer);
    if (pollTimer !== undefined) dependencies.clearInterval(pollTimer);
    retryTimer = pollTimer = undefined;
    closeSocket();
  }

  const applySnapshot = (snapshot: RoomViewerSnapshot) => {
    if (snapshot.room.id === roomId) emit({ type: "snapshot", snapshot });
  };

  const refresh = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const snapshot = await dependencies.getRoom(roomId);
        if (!active || snapshot.room.id !== roomId) return;
        handlers.onLoadError(null);
        handlers.onError("");
        applySnapshot(snapshot);
      } catch (cause) {
        if (!active) return;
        const status = cause instanceof RoomApiError ? cause.status : 0;
        const message = cause instanceof Error ? cause.message : "The room could not be loaded.";
        if (!state.snapshot) handlers.onLoadError({ message, status });
        else handlers.onError(message);
        if (status === 401 || status === 403 || status === 404) {
          emit({ type: "socket", message: { type: "removed", roomId }, at: dependencies.now() });
        }
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  };

  const reconnect = () => {
    if (!active) return;
    closeSocket();
    handlers.onStatus("reconnecting");
    if (retryTimer !== undefined) return;
    retries += 1;
    retryTimer = dependencies.setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, Math.min(1_000 * 2 ** Math.min(retries - 1, 4), 15_000));
  };

  function connect() {
    if (!active) return;
    handlers.onStatus(retries === 0 ? "connecting" : "reconnecting");
    let current: WebSocket;
    try { current = dependencies.socket(roomId); } catch { reconnect(); return; }
    socket = current;
    const isCurrent = () => active && socket === current;
    current.addEventListener("open", () => {
      if (!isCurrent()) return;
      retries = 0;
      handlers.onStatus("connected");
      // Reconnection always fetches the authoritative tail, including missed edits.
      void refresh();
      pingTimer = dependencies.setInterval(() => {
        if (!isCurrent()) return;
        if (awaitingPong || current.readyState !== 1) { reconnect(); return; }
        try { current.send("ping"); awaitingPong = true; } catch { reconnect(); }
      }, 25_000);
    });
    current.addEventListener("message", (event) => {
      if (!isCurrent()) return;
      if (event.data === "pong") { awaitingPong = false; return; }
      try {
        const message = JSON.parse(String(event.data)) as RoomRealtimeMessage;
        const revision = state.snapshot?.room.revision;
        emit({ type: "socket", message, at: dependencies.now() });
        if (message.type === "room.patch" && revision !== undefined && message.revision > revision + 1) void refresh();
      } catch {
        // Ignore non-contract frames from proxies and stale deployments.
      }
    });
    current.addEventListener("close", () => { if (isCurrent()) reconnect(); });
    current.addEventListener("error", () => { if (isCurrent()) reconnect(); });
  }

  const mutate = async (operation: RoomOperationInput): Promise<RoomViewerSnapshot | null> => {
    if (!active) return null;
    try {
      const result = await dependencies.apply(roomId, operation);
      if (!active) return null;
      handlers.onError("");
      if ("removed" in result) {
        emit({ type: "socket", message: { type: "removed", roomId }, at: dependencies.now() });
        return null;
      }
      if (result.room.id !== roomId) return null;
      applySnapshot(result);
      return result;
    } catch (cause) {
      if (active) handlers.onError(cause instanceof Error ? cause.message : "That change could not be saved.");
      throw cause;
    }
  };

  const send = (message: RoomClientSocketMessage) => {
    if (!active || socket?.readyState !== 1) return;
    try { socket.send(JSON.stringify(message)); } catch { reconnect(); }
  };

  const loadEarlier = async () => {
    const snapshot = state.snapshot;
    const first = snapshot?.room.messages[0];
    if (!active || !snapshot || !first) return;
    try {
      const page = await dependencies.getEarlier(roomId, first.seq);
      emit({ type: "earlier", ...page, roomId, revision: snapshot.room.revision });
    } catch (cause) {
      if (active) handlers.onError(cause instanceof Error ? cause.message : "Earlier messages could not be loaded.");
    }
  };

  handlers.onState(state);
  handlers.onError("");
  handlers.onLoadError(null);
  void refresh();
  connect();
  // HTTP remains a catch-up path when a proxy cannot carry websockets or drops frames.
  if (active) pollTimer = dependencies.setInterval(() => { void refresh(); }, 10_000);
  return { roomId, stop, refresh, mutate, send, loadEarlier, applySnapshot };
}

export function useRoomSession(roomId: string, enabled: boolean): RoomSession {
  const [state, setState] = useState<RoomClientState>(INITIAL_ROOM_CLIENT_STATE);
  const [status, setStatus] = useState<RoomConnectionStatus>("connecting");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<RoomSession["loadError"]>(null);
  const connectionRef = useRef<ReturnType<typeof createRoomSessionConnection> | null>(null);

  useEffect(() => {
    setState({ ...INITIAL_ROOM_CLIENT_STATE, roomId });
    setStatus("connecting");
    setError("");
    setLoadError(null);
    if (!enabled) return;
    const connection = createRoomSessionConnection(roomId, {
      onState: setState, onStatus: setStatus, onError: setError, onLoadError: setLoadError,
    });
    connectionRef.current = connection;
    return () => {
      connection.stop();
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [enabled, roomId]);

  const current = useCallback(() => enabled && connectionRef.current?.roomId === roomId ? connectionRef.current : null, [enabled, roomId]);
  const mutate = useCallback((operation: RoomOperationInput) => current()?.mutate(operation) ?? Promise.resolve(null), [current]);
  const applySnapshot = useCallback((snapshot: RoomViewerSnapshot) => current()?.applySnapshot(snapshot), [current]);
  const send = useCallback((message: RoomClientSocketMessage) => current()?.send(message), [current]);
  const loadEarlier = useCallback(() => current()?.loadEarlier() ?? Promise.resolve(), [current]);
  const refresh = useCallback(() => current()?.refresh() ?? Promise.resolve(), [current]);
  return {
    state: enabled && state.roomId === roomId ? state : { ...INITIAL_ROOM_CLIENT_STATE, roomId },
    status, error, loadError, setError, mutate, applySnapshot, send, loadEarlier, refresh,
  };
}
