import { unsupportedCapability } from "./errors";
import type {
  AgentSandbox,
  ExecResult,
  PreviewLink,
  SandboxCapabilities,
  SandboxFileInfo,
  SandboxSnapshot,
  SessionExecResult,
} from "./types";

export type SandboxRpcMethod =
  | "meta.capabilities"
  | "fs.readFile"
  | "fs.writeFile"
  | "fs.listFiles"
  | "fs.getFileDetails"
  | "fs.createFolder"
  | "fs.deleteFile"
  | "process.executeCommand"
  | "process.createSession"
  | "process.executeSessionCommand"
  | "preview.getPreviewLink"
  | "snapshot.create"
  | "snapshot.restore";

export interface SandboxRpcRequest {
  id: string;
  method: SandboxRpcMethod;
  params?: Record<string, unknown>;
}

export interface SandboxRpcResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: {
    name: string;
    message: string;
    missing?: string[];
  };
}

export type SandboxRpcTransport = (request: SandboxRpcRequest) => Promise<SandboxRpcResponse>;

export function createSandboxRpcHandler(sandbox: AgentSandbox): SandboxRpcTransport {
  return async (request) => {
    try {
      const result = await dispatchSandboxRpc(sandbox, request.method, request.params ?? {});
      return { id: request.id, ok: true, result };
    } catch (error) {
      const maybeMissing = (error as { missing?: unknown }).missing;
      return {
        id: request.id,
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          missing: Array.isArray(maybeMissing) ? maybeMissing.map(String) : undefined,
        },
      };
    }
  };
}

export function createRpcSandboxClient(
  transport: SandboxRpcTransport,
  options: {
    id?: string;
    kind?: AgentSandbox["kind"];
    workDir?: string;
    capabilities?: SandboxCapabilities;
  } = {}
): AgentSandbox {
  const call = async <T>(method: SandboxRpcMethod, params?: Record<string, unknown>): Promise<T> => {
    const response = await transport({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      method,
      params,
    });
    if (!response.ok) throw new Error(response.error?.message ?? `Sandbox RPC ${method} failed`);
    return response.result as T;
  };

  const capabilities: SandboxCapabilities = options.capabilities ?? {
    browserLocal: false,
    secureIsolation: false,
    nativeBinaries: false,
    filesystem: true,
    process: true,
    sessions: true,
    preview: true,
    snapshots: true,
    packageInstall: false,
    outboundNetwork: "limited",
    inboundNetwork: false,
    secrets: "none",
    persistence: "memory",
  };

  return {
    id: options.id ?? "relay",
    kind: options.kind ?? "relay",
    workDir: options.workDir ?? "/workspace",
    capabilities,
    fs: {
      readFile: (path: string, encoding?: "utf8") => call<string | Uint8Array>("fs.readFile", { path, encoding }),
      writeFile: (path: string, data: string | Uint8Array) => call<void>("fs.writeFile", { path, data }),
      listFiles: (path?: string) => call<SandboxFileInfo[]>("fs.listFiles", { path }),
      getFileDetails: (path: string) => call<SandboxFileInfo>("fs.getFileDetails", { path }),
      createFolder: (path: string, mode?: string) => call<void>("fs.createFolder", { path, mode }),
      deleteFile: (path: string, recursive?: boolean) => call<void>("fs.deleteFile", { path, recursive }),
    },
    process: {
      executeCommand: (command, execOptions) =>
        call<ExecResult>("process.executeCommand", { command, options: execOptions }),
      createSession: (sessionId) => call<void>("process.createSession", { sessionId }),
      executeSessionCommand: (sessionId, request, timeoutSeconds) =>
        call<SessionExecResult>("process.executeSessionCommand", { sessionId, request, timeoutSeconds }),
    },
    preview: {
      getPreviewLink: (port) => call<PreviewLink>("preview.getPreviewLink", { port }),
    },
    snapshots: {
      create: (name?: string) => call<SandboxSnapshot>("snapshot.create", { name }),
      restore: (snapshot: SandboxSnapshot) => call<void>("snapshot.restore", { snapshot }),
    },
  };
}

async function dispatchSandboxRpc(
  sandbox: AgentSandbox,
  method: SandboxRpcMethod,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case "meta.capabilities":
      return sandbox.capabilities;
    case "fs.readFile":
      return sandbox.fs.readFile(String(params.path), params.encoding === "utf8" ? "utf8" : undefined);
    case "fs.writeFile":
      return sandbox.fs.writeFile(String(params.path), params.data as string | Uint8Array);
    case "fs.listFiles":
      return sandbox.fs.listFiles(params.path ? String(params.path) : undefined);
    case "fs.getFileDetails":
      return sandbox.fs.getFileDetails(String(params.path));
    case "fs.createFolder":
      return sandbox.fs.createFolder(String(params.path), params.mode ? String(params.mode) : undefined);
    case "fs.deleteFile":
      return sandbox.fs.deleteFile(String(params.path), params.recursive === true);
    case "process.executeCommand":
      return sandbox.process.executeCommand(String(params.command), params.options as any);
    case "process.createSession":
      if (!sandbox.process.createSession) throw unsupportedCapability(sandbox.kind, ["sessions"]);
      return sandbox.process.createSession(String(params.sessionId));
    case "process.executeSessionCommand":
      if (!sandbox.process.executeSessionCommand) throw unsupportedCapability(sandbox.kind, ["sessions"]);
      return sandbox.process.executeSessionCommand(
        String(params.sessionId),
        params.request as any,
        typeof params.timeoutSeconds === "number" ? params.timeoutSeconds : undefined
      );
    case "preview.getPreviewLink":
      if (!sandbox.preview) throw unsupportedCapability(sandbox.kind, ["preview"]);
      return sandbox.preview.getPreviewLink(Number(params.port));
    case "snapshot.create":
      if (!sandbox.snapshots) throw unsupportedCapability(sandbox.kind, ["snapshots"]);
      return sandbox.snapshots.create(params.name ? String(params.name) : undefined);
    case "snapshot.restore":
      if (!sandbox.snapshots) throw unsupportedCapability(sandbox.kind, ["snapshots"]);
      return sandbox.snapshots.restore(params.snapshot as SandboxSnapshot);
  }
}

