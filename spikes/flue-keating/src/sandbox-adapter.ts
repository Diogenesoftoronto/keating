import { sandboxFromDriver, type SandboxDriver, type SandboxFactory } from "@flue/runtime";
import type { AgentSandbox } from "@keating/browser-agent-runtime";

export type AgentSandboxResolver = (options: { id: string }) => Promise<AgentSandbox>;

export function createFlueSandboxFactory(resolve: AgentSandboxResolver): SandboxFactory {
  return {
    async createSandbox({ id }) {
      const sandbox = await resolve({ id });
      return sandboxFromDriver(toFlueDriver(sandbox), sandbox.workDir);
    },
  };
}

export function toFlueDriver(sandbox: AgentSandbox): SandboxDriver {
  return {
    async exec(command, options) {
      const timeoutSeconds =
        options?.timeoutMs === undefined
          ? undefined
          : Math.max(1, Math.ceil(options.timeoutMs / 1000));
      if (options?.signal?.aborted) throw abortError(options.signal);
      const result = await sandbox.process.executeCommand(command, {
        cwd: options?.cwd,
        env: options?.env,
        timeoutSeconds,
      });
      if (options?.signal?.aborted) throw abortError(options.signal);
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
    async readFile(path) {
      const value = await sandbox.fs.readFile(path, "utf8");
      return typeof value === "string" ? value : new TextDecoder().decode(value);
    },
    async readFileBuffer(path) {
      const value = await sandbox.fs.readFile(path);
      return typeof value === "string" ? new TextEncoder().encode(value) : value;
    },
    writeFile: (path, content) => sandbox.fs.writeFile(path, content),
    async stat(path) {
      const info = await sandbox.fs.getFileDetails(path);
      return {
        isFile: !info.isDir,
        isDirectory: info.isDir,
        size: info.size,
        mtime: new Date(info.modTime),
      };
    },
    async readdir(path) {
      return (await sandbox.fs.listFiles(path)).map((entry) => entry.name);
    },
    async exists(path) {
      try {
        await sandbox.fs.getFileDetails(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: (path) => sandbox.fs.createFolder(path),
    async rm(path, options) {
      try {
        await sandbox.fs.deleteFile(path, options?.recursive ?? false);
      } catch (error) {
        if (!options?.force) throw error;
      }
    },
  };
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(
    typeof signal.reason === "string" ? signal.reason : "The operation was aborted.",
    "AbortError"
  );
}
