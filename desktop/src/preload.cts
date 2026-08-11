import { contextBridge, ipcRenderer } from "electron";
import type {
  P2PRpcMethod,
  P2PRpcResponse,
  P2PEvent,
} from "@keating/p2p-core";

// Sandboxed Electron preloads execute in a restricted CommonJS environment.
// Keep runtime dependencies limited to Electron while sharing only types with
// the ESM P2P package.
const P2P_IPC_CHANNEL = "keating:p2p:rpc";
const P2P_EVENT_CHANNEL = "keating:p2p:event";
const CREDENTIAL_IPC_CHANNEL = "keating:credentials:rpc";
const OAUTH_CALLBACK_IPC_CHANNEL = "keating:oauth-callback";
const OAUTH_CALLBACK_ORIGIN = "http://127.0.0.1:1455";
const OAUTH_CALLBACK_PATH = "/auth/callback";
const MAX_OAUTH_CALLBACK_URL_LENGTH = 4 * 1024;

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

export interface KeatingCredentialBridge {
  get(id: string): Promise<string | null>;
  set(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
  has(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export interface KeatingDesktopBridge {
  onOAuthCallback(listener: (callbackUrl: string) => void): () => void;
}

let seq = 0;

function jsonCompatibleParams(
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (params === undefined) return undefined;
  const serialized = JSON.stringify(params);
  if (serialized === undefined) {
    throw new Error("P2P RPC parameters must be JSON-compatible");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

const bridge: KeatingP2PBridge = {
  async call<T>(method: P2PRpcMethod, params?: Record<string, unknown>): Promise<T> {
    const id = `${Date.now()}-${seq++}`;
    const res = (await ipcRenderer.invoke(P2P_IPC_CHANNEL, {
      id,
      method,
      params: jsonCompatibleParams(params),
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

async function credentialCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const id = `credential-${Date.now()}-${seq++}`;
  const response = (await ipcRenderer.invoke(CREDENTIAL_IPC_CHANNEL, {
    id,
    method,
    params: jsonCompatibleParams(params),
  })) as { ok: boolean; result?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(response.error?.message ?? "Secure credential storage failed");
  return response.result as T;
}

const credentialBridge: KeatingCredentialBridge = {
  get: (id) => credentialCall("get", { id }),
  set: (id, value) => credentialCall("set", { id, value }),
  delete: (id) => credentialCall("delete", { id }),
  keys: () => credentialCall("keys"),
  has: (id) => credentialCall("has", { id }),
  clear: () => credentialCall("clear"),
};

contextBridge.exposeInMainWorld("keatingCredentials", credentialBridge);

const oauthCallbackListeners = new Set<(callbackUrl: string) => void>();
let pendingOAuthCallback: string | null = null;

function acceptedOAuthCallbackUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_OAUTH_CALLBACK_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== OAUTH_CALLBACK_ORIGIN || parsed.pathname !== OAUTH_CALLBACK_PATH) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

ipcRenderer.on(OAUTH_CALLBACK_IPC_CHANNEL, (_event: unknown, value: unknown) => {
  const callbackUrl = acceptedOAuthCallbackUrl(value);
  if (!callbackUrl) return;
  if (oauthCallbackListeners.size === 0) {
    pendingOAuthCallback = callbackUrl;
    return;
  }
  for (const listener of oauthCallbackListeners) listener(callbackUrl);
});

const desktopBridge: KeatingDesktopBridge = {
  onOAuthCallback(listener) {
    oauthCallbackListeners.add(listener);
    const pending = pendingOAuthCallback;
    if (pending) {
      pendingOAuthCallback = null;
      queueMicrotask(() => {
        if (oauthCallbackListeners.has(listener)) listener(pending);
      });
    }
    return () => oauthCallbackListeners.delete(listener);
  },
};

contextBridge.exposeInMainWorld("keatingDesktop", desktopBridge);
