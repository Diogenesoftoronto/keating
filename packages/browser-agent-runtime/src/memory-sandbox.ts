import { SandboxCapabilityError } from "./errors";
import { basename, dirname, directChildName, normalizeSandboxPath } from "./path";
import type {
  AgentSandbox,
  ExecResult,
  SandboxCapabilities,
  SandboxFileInfo,
  SandboxSnapshot,
  SessionExecResult,
} from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface EntryMeta {
  modTime: string;
}

export interface InMemoryBrowserSandboxOptions {
  id?: string;
  workDir?: string;
  files?: Record<string, string | Uint8Array>;
}

export function createInMemoryBrowserSandbox(options: InMemoryBrowserSandboxOptions = {}): AgentSandbox {
  const id = options.id ?? `browser-memory-${Math.random().toString(36).slice(2)}`;
  const workDir = normalizeSandboxPath(options.workDir ?? "/workspace", "/");
  const files = new Map<string, Uint8Array>();
  const fileMeta = new Map<string, EntryMeta>();
  const dirs = new Set<string>(["/", workDir]);
  const dirMeta = new Map<string, EntryMeta>([["/", { modTime: nowIso() }], [workDir, { modTime: nowIso() }]]);
  const sessions = new Set<string>();

  const touchDir = (path: string) => {
    dirs.add(path);
    dirMeta.set(path, { modTime: nowIso() });
  };

  const ensureDir = (path: string) => {
    const normalized = normalizeSandboxPath(path, workDir);
    let current = "/";
    touchDir(current);
    for (const part of normalized.split("/").filter(Boolean)) {
      current = current === "/" ? `/${part}` : `${current}/${part}`;
      touchDir(current);
    }
  };

  const write = (path: string, data: string | Uint8Array) => {
    const normalized = normalizeSandboxPath(path, workDir);
    ensureDir(dirname(normalized));
    files.set(normalized, typeof data === "string" ? encoder.encode(data) : data);
    fileMeta.set(normalized, { modTime: nowIso() });
  };

  const infoFor = (path: string): SandboxFileInfo => {
    const normalized = normalizeSandboxPath(path, workDir);
    if (dirs.has(normalized)) {
      return {
        name: basename(normalized) || "/",
        path: normalized,
        isDir: true,
        size: 0,
        modTime: dirMeta.get(normalized)?.modTime ?? nowIso(),
      };
    }
    const data = files.get(normalized);
    if (!data) throw new Error(`No such file or directory: ${normalized}`);
    return {
      name: basename(normalized),
      path: normalized,
      isDir: false,
      size: data.byteLength,
      modTime: fileMeta.get(normalized)?.modTime ?? nowIso(),
    };
  };

  for (const [path, data] of Object.entries(options.files ?? {})) {
    write(path, data);
  }

  const capabilities: SandboxCapabilities = {
    browserLocal: true,
    secureIsolation: false,
    nativeBinaries: false,
    filesystem: true,
    process: true,
    sessions: true,
    preview: false,
    snapshots: true,
    packageInstall: false,
    outboundNetwork: false,
    inboundNetwork: false,
    secrets: "none",
    persistence: "memory",
  };

  const executeCommand = async (command: string): Promise<ExecResult> => {
    try {
      const stdout = runMemoryCommand(command, workDir, files, dirs);
      return { exitCode: 0, stdout, stderr: "", result: stdout };
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      return { exitCode: 127, stdout: "", stderr, result: stderr };
    }
  };

  return {
    id,
    kind: "browser-memory",
    workDir,
    capabilities,
    fs: {
      async readFile(path: string, encoding?: "utf8") {
        const normalized = normalizeSandboxPath(path, workDir);
        const data = files.get(normalized);
        if (!data) throw new Error(`No such file: ${normalized}`);
        return encoding === "utf8" ? decoder.decode(data) : data;
      },
      async writeFile(path: string, data: string | Uint8Array) {
        write(path, data);
      },
      async listFiles(path = workDir) {
        const normalized = normalizeSandboxPath(path, workDir);
        if (!dirs.has(normalized)) throw new Error(`No such directory: ${normalized}`);
        const seen = new Set<string>();
        const children: SandboxFileInfo[] = [];
        for (const dir of dirs) {
          const child = directChildName(normalized, dir);
          if (child && !seen.has(dir)) {
            seen.add(dir);
            children.push(infoFor(dir));
          }
        }
        for (const file of files.keys()) {
          const child = directChildName(normalized, file);
          if (child && !seen.has(file)) {
            seen.add(file);
            children.push(infoFor(file));
          }
        }
        return children.sort((a, b) => a.name.localeCompare(b.name));
      },
      async getFileDetails(path: string) {
        return infoFor(path);
      },
      async createFolder(path: string) {
        ensureDir(path);
      },
      async deleteFile(path: string, recursive = false) {
        const normalized = normalizeSandboxPath(path, workDir);
        if (files.delete(normalized)) {
          fileMeta.delete(normalized);
          return;
        }
        if (!dirs.has(normalized)) throw new Error(`No such file or directory: ${normalized}`);
        const hasChildren = [...files.keys(), ...dirs].some((candidate) => directChildName(normalized, candidate));
        if (hasChildren && !recursive) throw new Error(`Directory is not empty: ${normalized}`);
        for (const file of [...files.keys()]) {
          if (file === normalized || file.startsWith(`${normalized}/`)) files.delete(file);
        }
        for (const dir of [...dirs]) {
          if (dir !== "/" && (dir === normalized || dir.startsWith(`${normalized}/`))) dirs.delete(dir);
        }
      },
    },
    process: {
      executeCommand,
      async createSession(sessionId: string) {
        sessions.add(sessionId);
      },
      async executeSessionCommand(sessionId: string, request): Promise<SessionExecResult> {
        if (!sessions.has(sessionId)) sessions.add(sessionId);
        const result = await executeCommand(request.command);
        return {
          ...result,
          cmdId: `${sessionId}-${Date.now().toString(36)}`,
          output: result.stdout || result.stderr,
        };
      },
    },
    snapshots: {
      async create(name = "snapshot"): Promise<SandboxSnapshot> {
        return {
          id: name,
          createdAt: nowIso(),
          data: {
            files: [...files.entries()].map(([path, value]) => [path, Array.from(value)]),
            fileMeta: [...fileMeta.entries()],
            dirs: [...dirs],
            dirMeta: [...dirMeta.entries()],
          },
        };
      },
      async restore(snapshot: SandboxSnapshot) {
        const data = snapshot.data as {
          files: Array<[string, number[]]>;
          fileMeta: Array<[string, EntryMeta]>;
          dirs: string[];
          dirMeta: Array<[string, EntryMeta]>;
        };
        files.clear();
        fileMeta.clear();
        dirs.clear();
        dirMeta.clear();
        for (const [path, value] of data.files) files.set(path, Uint8Array.from(value));
        for (const [path, meta] of data.fileMeta) fileMeta.set(path, meta);
        for (const dir of data.dirs) dirs.add(dir);
        for (const [path, meta] of data.dirMeta) dirMeta.set(path, meta);
      },
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function runMemoryCommand(
  command: string,
  workDir: string,
  files: Map<string, Uint8Array>,
  dirs: Set<string>
): string {
  const trimmed = command.trim();
  if (trimmed === "pwd") return `${workDir}\n`;
  if (trimmed === "ls") {
    const names = [...files.keys(), ...dirs]
      .map((path) => directChildName(workDir, path))
      .filter((name): name is string => Boolean(name))
      .sort();
    return `${names.join("\n")}${names.length ? "\n" : ""}`;
  }
  if (trimmed.startsWith("echo ")) {
    return `${trimmed.slice(5).replace(/^["']|["']$/g, "")}\n`;
  }
  if (trimmed.startsWith("cat ")) {
    const target = normalizeSandboxPath(trimmed.slice(4).trim(), workDir);
    const data = files.get(target);
    if (!data) throw new Error(`No such file: ${target}`);
    return decoder.decode(data);
  }
  throw new SandboxCapabilityError(
    `browser-memory only supports pwd, ls, echo, and cat. Command was: ${command}`,
    ["nativeBinaries"],
    "browser-memory"
  );
}

