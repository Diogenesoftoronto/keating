/**
 * IPC contract between the Electron renderer (preload bridge) and the main
 * process. Mirrors the request/response shape of
 * packages/browser-agent-runtime/src/rpc.ts. The desktop app implements the
 * main-side handlers (desktop/src/ipc.ts) and the preload bridge
 * (desktop/src/preload.ts) against these types — there is no `ipcRenderer`
 * passthrough.
 */

export const P2P_IPC_CHANNEL = "keating:p2p:rpc" as const;
export const P2P_EVENT_CHANNEL = "keating:p2p:event" as const;

/** Each method maps to a P2PStore-backed StorageBackend operation. */
export type P2PRpcMethod =
  | "get"
  | "set"
  | "delete"
  | "keys"
  | "getAllFromIndex"
  | "clear"
  | "has"
  | "batch"
  | "stats"
  | "quota"
  | "requestPersistence";

export interface P2PRpcRequest {
  id: string;
  method: P2PRpcMethod;
  params?: Record<string, unknown>;
}

export interface P2PRpcResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: { message: string; code?: string };
}

/** Pushed from main → renderer when peer/replication state changes. */
export interface P2PEvent {
  type: "peerstats";
  payload: import("./types.js").PeerStats;
}
