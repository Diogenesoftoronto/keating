import { contextBridge, ipcRenderer } from "electron";
import {
  P2P_IPC_CHANNEL,
  P2P_EVENT_CHANNEL,
  type P2PRpcMethod,
  type P2PRpcResponse,
  type P2PEvent,
} from "@keating/p2p-core";

/**
 * The ONLY surface the renderer sees. No raw ipcRenderer is exposed. Each call
 * round-trips one P2PRpcRequest and unwraps the P2PRpcResponse.
 *
 * web/src/lib/p2p-storage-backend.ts consumes `window.keatingP2P`.
 */
export interface KeatingP2PBridge {
  call<T = unknown>(method: P2PRpcMethod, params?: Record<string, unknown>): Promise<T>;
  onPeerStats(listener: (stats: P2PEvent["payload"]) => void): () => void;
}

let seq = 0;

const bridge: KeatingP2PBridge = {
  async call<T>(method: P2PRpcMethod, params?: Record<string, unknown>): Promise<T> {
    const id = `${Date.now()}-${seq++}`;
    const res = (await ipcRenderer.invoke(P2P_IPC_CHANNEL, {
      id,
      method,
      params,
    })) as P2PRpcResponse<T>;
    if (!res.ok) throw new Error(res.error?.message ?? "P2P RPC failed");
    return res.result as T;
  },
  onPeerStats(listener) {
    const handler = (_e: unknown, evt: P2PEvent) => {
      if (evt.type === "peerstats") listener(evt.payload);
    };
    ipcRenderer.on(P2P_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(P2P_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("keatingP2P", bridge);
