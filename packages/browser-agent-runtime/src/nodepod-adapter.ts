import { unsupportedCapability } from "./errors";
import type {
  AgentSandbox,
  ExecResult,
  SandboxCapabilities,
  SandboxFileInfo,
  SandboxSnapshot,
} from "./types";

export interface NodePodLike {
  fs?: {
    readFile?: (path: string, encoding?: string) => Promise<string | Uint8Array> | string | Uint8Array;
    writeFile?: (path: string, data: string | Uint8Array) => Promise<void> | void;
    readdir?: (path: string) => Promise<Array<string | SandboxFileInfo>> | Array<string | SandboxFileInfo>;
    mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void> | void;
    rm?: (path: string, options?: { recursive?: boolean }) => Promise<void> | void;
    unlink?: (path: string) => Promise<void> | void;
    stat?: (path: string) => Promise<Partial<SandboxFileInfo> & { isDirectory?: () => boolean }> | Partial<SandboxFileInfo> & { isDirectory?: () => boolean };
  };
  exec?: (command: string, options?: Record<string, unknown>) => Promise<unknown> | unknown;
  spawn?: (command: string, args?: string[], options?: Record<string, unknown>) => Promise<unknown> | unknown;
  port?: (port: number) => string;
  snapshot?: () => Promise<unknown> | unknown;
  restore?: (snapshot: unknown) => Promise<void> | void;
  dispose?: () => Promise<void> | void;
}

export interface NodePodSandboxOptions {
  id?: string;
  workDir?: string;
  capabilities?: Partial<SandboxCapabilities>;
}

export async function bootNodePodSandbox(options: NodePodSandboxOptions & { boot?: Record<string, unknown> } = {}): Promise<AgentSandbox> {
  const mod = await import("@scelar/nodepod");
  const factory = (mod as any).Nodepod ?? (mod as any).NodePod ?? (mod as any).default ?? mod;
  const pod = typeof factory.boot === "function"
    ? await factory.boot(options.boot ?? {})
    : await (mod as any).boot(options.boot ?? {});
  return createNodePodSandbox(pod as NodePodLike, options);
}

export function createNodePodSandbox(pod: NodePodLike, options: NodePodSandboxOptions = {}): AgentSandbox {
  const capabilities: SandboxCapabilities = {
    browserLocal: true,
    secureIsolation: false,
    nativeBinaries: false,
    filesystem: true,
    process: true,
    sessions: false,
    preview: typeof pod.port === "function",
    snapshots: typeof pod.snapshot === "function" && typeof pod.restore === "function",
    packageInstall: true,
    outboundNetwork: "limited",
    inboundNetwork: false,
    secrets: "browser-byok",
    persistence: "indexeddb",
    ...options.capabilities,
  };

  return {
    id: options.id ?? `browser-nodepod-${Math.random().toString(36).slice(2)}`,
    kind: "browser-nodepod",
    workDir: options.workDir ?? "/workspace",
    capabilities,
    fs: {
      async readFile(path: string, encoding?: "utf8") {
        assertFs(pod, "readFile");
        const value = await pod.fs!.readFile!(path, encoding);
        if (encoding === "utf8" && value instanceof Uint8Array) return new TextDecoder().decode(value);
        return value as any;
      },
      async writeFile(path: string, data: string | Uint8Array) {
        assertFs(pod, "writeFile");
        await pod.fs!.writeFile!(path, data);
      },
      async listFiles(path = ".") {
        assertFs(pod, "readdir");
        const entries = await pod.fs!.readdir!(path);
        return entries.map((entry) => {
          if (typeof entry !== "string") return entry;
          return {
            name: entry,
            path: path.endsWith("/") ? `${path}${entry}` : `${path}/${entry}`,
            isDir: false,
            size: 0,
            modTime: new Date().toISOString(),
          };
        });
      },
      async getFileDetails(path: string) {
        if (!pod.fs?.stat) {
          return {
            name: path.split("/").filter(Boolean).at(-1) ?? path,
            path,
            isDir: false,
            size: 0,
            modTime: new Date().toISOString(),
          };
        }
        const stat = await pod.fs.stat(path);
        return {
          name: stat.name ?? path.split("/").filter(Boolean).at(-1) ?? path,
          path,
          isDir: typeof stat.isDirectory === "function" ? stat.isDirectory() : stat.isDir ?? false,
          size: stat.size ?? 0,
          modTime: stat.modTime ?? new Date().toISOString(),
        };
      },
      async createFolder(path: string) {
        assertFs(pod, "mkdir");
        await pod.fs!.mkdir!(path, { recursive: true });
      },
      async deleteFile(path: string, recursive = false) {
        if (pod.fs?.rm) {
          await pod.fs.rm(path, { recursive });
          return;
        }
        assertFs(pod, "unlink");
        await pod.fs!.unlink!(path);
      },
    },
    process: {
      async executeCommand(command: string, options = {}): Promise<ExecResult> {
        if (pod.exec) return normalizeExecResult(await pod.exec(command, options as Record<string, unknown>));
        if (!pod.spawn) throw unsupportedCapability("browser-nodepod", ["process"]);
        const [bin, ...args] = splitCommand(command);
        return normalizeExecResult(await pod.spawn(bin!, args, options as Record<string, unknown>));
      },
    },
    preview: capabilities.preview && pod.port
      ? { getPreviewLink: async (port: number) => ({ url: pod.port!(port) }) }
      : undefined,
    snapshots: capabilities.snapshots && pod.snapshot && pod.restore
      ? {
          create: async (name = "nodepod-snapshot"): Promise<SandboxSnapshot> => ({
            id: name,
            createdAt: new Date().toISOString(),
            data: await pod.snapshot!(),
          }),
          restore: async (snapshot: SandboxSnapshot) => {
            await pod.restore!(snapshot.data);
          },
        }
      : undefined,
    dispose: pod.dispose ? async () => { await pod.dispose!(); } : undefined,
  };
}

function assertFs(pod: NodePodLike, method: keyof NonNullable<NodePodLike["fs"]>): void {
  if (!pod.fs || typeof pod.fs[method] !== "function") {
    throw unsupportedCapability("browser-nodepod", ["filesystem"]);
  }
}

function normalizeExecResult(value: unknown): ExecResult {
  if (typeof value === "string") {
    return { exitCode: 0, stdout: value, stderr: "", result: value };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const stdout = String(record.stdout ?? record.result ?? record.output ?? "");
    const stderr = String(record.stderr ?? "");
    const exitCode = Number(record.exitCode ?? record.code ?? 0);
    return { exitCode, stdout, stderr, result: stdout || stderr };
  }
  return { exitCode: 0, stdout: "", stderr: "", result: "" };
}

function splitCommand(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}
