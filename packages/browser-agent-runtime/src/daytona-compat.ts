import type {
  AgentSandbox,
  ExecResult,
  PreviewLink,
  SandboxFileInfo,
  SessionExecuteRequest,
} from "./types";

export interface DaytonaCompatFs {
  listFiles(path?: string): Promise<SandboxFileInfo[]>;
  getFileDetails(path: string): Promise<SandboxFileInfo>;
  createFolder(path: string, mode?: string): Promise<void>;
  uploadFile(content: string | Uint8Array, path: string): Promise<void>;
  uploadFiles(files: Array<{ source: string | Uint8Array; destination: string }>): Promise<void>;
  downloadFile(path: string): Promise<Uint8Array>;
  deleteFile(path: string, recursive?: boolean): Promise<void>;
}

export interface DaytonaCompatProcess {
  executeCommand(command: string, cwd?: string, timeoutSeconds?: number): Promise<{
    exitCode: number;
    result: string;
    artifacts: { stdout: string; stderr: string };
  }>;
  createSession(sessionId: string): Promise<void>;
  executeSessionCommand(sessionId: string, request: SessionExecuteRequest, timeoutSeconds?: number): Promise<{
    cmdId: string;
    output: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface DaytonaCompatSandbox {
  id: string;
  fs: DaytonaCompatFs;
  process: DaytonaCompatProcess;
  getWorkDir(): Promise<string>;
  getPreviewLink(port: number): Promise<PreviewLink>;
  _experimental_createSnapshot(name: string): Promise<void>;
  restoreSnapshot(name: string): Promise<void>;
  underlying: AgentSandbox;
}

export function createDaytonaCompatSandbox(sandbox: AgentSandbox): DaytonaCompatSandbox {
  const snapshots = new Map<string, unknown>();

  return {
    id: sandbox.id,
    underlying: sandbox,
    fs: {
      listFiles: (path?: string) => sandbox.fs.listFiles(path),
      getFileDetails: (path: string) => sandbox.fs.getFileDetails(path),
      createFolder: (path: string, mode = "755") => sandbox.fs.createFolder(path, mode),
      uploadFile: (content: string | Uint8Array, path: string) => sandbox.fs.writeFile(path, content),
      uploadFiles: async (files) => {
        for (const file of files) await sandbox.fs.writeFile(file.destination, file.source);
      },
      downloadFile: async (path: string) => {
        const data = await sandbox.fs.readFile(path);
        return typeof data === "string" ? new TextEncoder().encode(data) : data;
      },
      deleteFile: (path: string, recursive?: boolean) => sandbox.fs.deleteFile(path, recursive),
    },
    process: {
      executeCommand: async (command: string, cwd?: string, timeoutSeconds?: number) => {
        const result = await sandbox.process.executeCommand(command, { cwd, timeoutSeconds });
        return toDaytonaExec(result);
      },
      createSession: async (sessionId: string) => {
        if (sandbox.process.createSession) {
          await sandbox.process.createSession(sessionId);
          return;
        }
      },
      executeSessionCommand: async (sessionId: string, request: SessionExecuteRequest, timeoutSeconds?: number) => {
        if (sandbox.process.executeSessionCommand) {
          return sandbox.process.executeSessionCommand(sessionId, request, timeoutSeconds);
        }
        const result = await sandbox.process.executeCommand(request.command, { cwd: request.cwd, timeoutSeconds });
        return {
          cmdId: `${sessionId}-${Date.now().toString(36)}`,
          output: result.stdout || result.stderr,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          result: result.result,
        };
      },
    },
    getWorkDir: async () => sandbox.workDir,
    getPreviewLink: async (port: number) => {
      if (!sandbox.preview) throw new Error(`Sandbox ${sandbox.kind} has no preview adapter.`);
      return sandbox.preview.getPreviewLink(port);
    },
    _experimental_createSnapshot: async (name: string) => {
      if (!sandbox.snapshots) throw new Error(`Sandbox ${sandbox.kind} has no snapshot adapter.`);
      snapshots.set(name, await sandbox.snapshots.create(name));
    },
    restoreSnapshot: async (name: string) => {
      if (!sandbox.snapshots) throw new Error(`Sandbox ${sandbox.kind} has no snapshot adapter.`);
      const snapshot = snapshots.get(name);
      if (!snapshot) throw new Error(`No snapshot named ${name}`);
      await sandbox.snapshots.restore(snapshot as any);
    },
  };
}

function toDaytonaExec(result: ExecResult): {
  exitCode: number;
  result: string;
  artifacts: { stdout: string; stderr: string };
} {
  return {
    exitCode: result.exitCode,
    result: result.result,
    artifacts: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}
