import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RpcTransport {
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: string | number }) => void): Disposable;
  write(data: string): void;
  kill(): void;
}

type SpawnTransport = (options: KeatingPtyRpcClientOptions) => RpcTransport | Promise<RpcTransport>;

export interface KeatingPtyRpcClientOptions {
  cliPath: string;
  relayPath: string;
  cwd: string;
  /** Pi is a Node program even when Keating itself was launched through Bun. */
  nodePath?: string;
  env?: Record<string, string>;
  args?: string[];
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
  spawnTransport?: SpawnTransport;
}

export type KeatingRpcExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true; reason?: string };

interface RpcResponse {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve(response: RpcResponse): void;
  reject(error: Error): void;
}

interface Disposable {
  dispose(): void;
}

/**
 * Pi 0.80.2 does not reliably remain interactive over an ordinary child-process
 * pipe in every supported runtime. This client keeps Pi's public JSONL protocol
 * unchanged while hosting it in the pseudo-terminal it expects.
 */
export class KeatingPtyRpcClient {
  private readonly options: KeatingPtyRpcClientOptions;
  private readonly listeners: Array<(event: unknown) => void> = [];
  private readonly pending = new Map<string, PendingRequest>();
  private process: RpcTransport | null = null;
  private dataSubscription: Disposable | null = null;
  private exitSubscription: Disposable | null = null;
  private requestId = 0;
  private readBuffer = "";
  private diagnostics = "";
  private exitError: Error | null = null;
  private stopping = false;

  constructor(options: KeatingPtyRpcClientOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.process) throw new Error("Client already started");
    this.stopping = false;
    this.exitError = null;
    this.readBuffer = "";
    this.diagnostics = "";
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let didBecomeReady = false;

    const child = await (this.options.spawnTransport ?? createRelayTransport)(this.options);
    this.process = child;
    this.dataSubscription = child.onData((data) => {
      this.readBuffer += data;
      let newline = this.readBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.readBuffer.slice(0, newline).replace(/\r$/, "");
        this.readBuffer = this.readBuffer.slice(newline + 1);
        const parsed = this.parseLine(line);
        if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "keating_rpc_ready") {
          if (!didBecomeReady) {
            didBecomeReady = true;
            resolveReady();
          }
        } else if (parsed !== undefined) {
          this.handleMessage(parsed);
        }
        newline = this.readBuffer.indexOf("\n");
      }
    });
    this.exitSubscription = child.onExit(({ exitCode, signal }) => {
      const error = new Error(`Agent process exited (code=${exitCode} signal=${signal ?? "none"}). Diagnostics: ${this.diagnostics}`.trim());
      if (!this.stopping) this.exitError = error;
      this.rejectPending(error);
      if (!didBecomeReady) rejectReady(error);
    });

    const timeout = setTimeout(() => {
      rejectReady(new Error(`Timed out waiting for Pi RPC readiness. Diagnostics: ${this.diagnostics}`.trim()));
    }, this.options.readyTimeoutMs ?? 15_000);
    try {
      await ready;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.stopping = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      const subscription = child.onExit(() => {
        subscription.dispose();
        finish();
      });
      timeout = setTimeout(() => {
        subscription.dispose();
        finish();
      }, 1_000);
      try {
        child.kill();
      } catch {
        subscription.dispose();
        finish();
      }
    });
    this.dataSubscription?.dispose();
    this.exitSubscription?.dispose();
    this.dataSubscription = null;
    this.exitSubscription = null;
    this.process = null;
    this.rejectPending(new Error("Pi RPC client stopped."));
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  getStderr(): string {
    return this.diagnostics;
  }

  async prompt(message: string, images?: unknown[]): Promise<void> { await this.send({ type: "prompt", message, images }); }
  async steer(message: string, images?: unknown[]): Promise<void> { await this.send({ type: "steer", message, images }); }
  async followUp(message: string, images?: unknown[]): Promise<void> { await this.send({ type: "follow_up", message, images }); }
  async abort(): Promise<void> { await this.send({ type: "abort" }); }
  async newSession(parentSession?: string): Promise<{ cancelled: boolean }> { return this.data(await this.send({ type: "new_session", parentSession })); }
  async getState(): Promise<Record<string, unknown>> { return this.data(await this.send({ type: "get_state" })); }
  async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> { return this.data(await this.send({ type: "set_model", provider, modelId })); }
  async cycleModel(): Promise<{ model: { provider: string; id: string }; thinkingLevel?: string } | null> { return this.data(await this.send({ type: "cycle_model" })); }
  async getAvailableModels(): Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>> {
    return this.data<{ models: Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }> }>(await this.send({ type: "get_available_models" })).models;
  }
  async setThinkingLevel(level: string): Promise<void> { await this.send({ type: "set_thinking_level", level }); }
  async cycleThinkingLevel(): Promise<{ level: string } | null> { return this.data(await this.send({ type: "cycle_thinking_level" })); }
  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> { await this.send({ type: "set_steering_mode", mode }); }
  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> { await this.send({ type: "set_follow_up_mode", mode }); }
  async compact(customInstructions?: string): Promise<unknown> { return this.data(await this.send({ type: "compact", customInstructions })); }
  async setAutoCompaction(enabled: boolean): Promise<void> { await this.send({ type: "set_auto_compaction", enabled }); }
  async setAutoRetry(enabled: boolean): Promise<void> { await this.send({ type: "set_auto_retry", enabled }); }
  async abortRetry(): Promise<void> { await this.send({ type: "abort_retry" }); }
  async bash(command: string): Promise<unknown> { return this.data(await this.send({ type: "bash", command })); }
  async abortBash(): Promise<void> { await this.send({ type: "abort_bash" }); }
  async getSessionStats(): Promise<unknown> { return this.data(await this.send({ type: "get_session_stats" })); }
  async exportHtml(outputPath?: string): Promise<{ path: string }> { return this.data(await this.send({ type: "export_html", outputPath })); }
  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> { return this.data(await this.send({ type: "switch_session", sessionPath })); }
  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> { return this.data(await this.send({ type: "fork", entryId })); }
  async clone(): Promise<{ cancelled: boolean }> { return this.data(await this.send({ type: "clone" })); }
  async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    return this.data<{ messages: Array<{ entryId: string; text: string }> }>(await this.send({ type: "get_fork_messages" })).messages;
  }
  async getLastAssistantText(): Promise<string | null> { return this.data<{ text: string | null }>(await this.send({ type: "get_last_assistant_text" })).text; }
  async setSessionName(name: string): Promise<void> { await this.send({ type: "set_session_name", name }); }
  async getMessages(): Promise<unknown[]> { return this.data<{ messages: unknown[] }>(await this.send({ type: "get_messages" })).messages; }
  async getCommands(): Promise<Array<{ name: string; description?: string; source?: string }>> {
    return this.data<{ commands: Array<{ name: string; description?: string; source?: string }> }>(await this.send({ type: "get_commands" })).commands;
  }

  async respondToExtensionUI(response: KeatingRpcExtensionUiResponse): Promise<void> {
    this.write(response);
  }

  waitForIdle(timeout = 60_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for agent to become idle. Diagnostics: ${this.diagnostics}`));
      }, timeout);
      const unsubscribe = this.onEvent((event) => {
        if ((event as { type?: string } | null)?.type !== "agent_end") return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  collectEvents(timeout = 60_000): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const events: unknown[] = [];
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout collecting events. Diagnostics: ${this.diagnostics}`));
      }, timeout);
      const unsubscribe = this.onEvent((event) => {
        events.push(event);
        if ((event as { type?: string } | null)?.type !== "agent_end") return;
        clearTimeout(timer);
        unsubscribe();
        resolve(events);
      });
    });
  }

  async promptAndWait(message: string, images?: unknown[], timeout = 60_000): Promise<unknown[]> {
    const events = this.collectEvents(timeout);
    await this.prompt(message, images);
    return events;
  }

  private parseLine(line: string): unknown | undefined {
    if (!line) return undefined;
    try {
      return JSON.parse(line);
    } catch {
      this.diagnostics = `${this.diagnostics}${line}\n`.slice(-32_768);
      return undefined;
    }
  }

  private handleMessage(message: unknown): void {
    const candidate = message as Partial<RpcResponse> | null;
    if (candidate?.type === "response" && typeof candidate.id === "string") {
      const pending = this.pending.get(candidate.id);
      if (pending) {
        this.pending.delete(candidate.id);
        pending.resolve(candidate as RpcResponse);
        return;
      }
    }
    for (const listener of [...this.listeners]) listener(message);
  }

  private async send(command: Record<string, unknown>): Promise<RpcResponse> {
    if (!this.process) throw new Error("Client not started");
    if (this.exitError) throw this.exitError;
    const id = `req_${++this.requestId}`;
    return await new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${String(command.type)}. Diagnostics: ${this.diagnostics}`));
      }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.write({ ...command, id });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.process) throw new Error("Client not started");
    if (this.exitError) throw this.exitError;
    this.process.write(`${JSON.stringify(message)}\n`);
  }

  private data<T>(response: RpcResponse): T {
    if (!response.success) throw new Error(response.error ?? "Pi RPC request failed.");
    return response.data as T;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function createRelayTransport(options: KeatingPtyRpcClientOptions): Promise<RpcTransport> {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const socketDirectory = process.platform === "win32" ? undefined : mkdtempSync(join(tmpdir(), "keating-pi-rpc-"));
  if (socketDirectory) chmodSync(socketDirectory, 0o700);
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\keating-pi-rpc-${process.pid}-${randomUUID()}`
    : join(socketDirectory!, "rpc.sock");
  const server = createServer();
  let socket: Socket | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    server.close();
    socket?.destroy();
    if (socketDirectory) rmSync(socketDirectory, { recursive: true, force: true });
  };
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const child = spawn(options.nodePath ?? process.env.KEATING_NODE_BINARY ?? "node", [
    options.relayPath,
    socketPath,
    options.cliPath,
    "--mode",
    "rpc",
    ...(options.args ?? []),
  ], {
    cwd: options.cwd,
    env,
    // Bun's child-process pipes are not a stable carrier for nested PTYs.
    // The owner-only local socket carries JSONL; stdio is deliberately inert.
    stdio: "ignore",
  });
  let stderr = "";
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number; signal?: string | number }) => void>();
  const bufferedData: string[] = [];
  let exitedEvent: { exitCode: number; signal?: string | number } | undefined;
  child.once("exit", (code, signal) => {
    const event = { exitCode: code ?? 0, signal: signal ?? undefined };
    exitedEvent = event;
    for (const listener of [...exitListeners]) listener(event);
    cleanup();
  });
  child.once("error", (error) => {
    stderr = `${stderr}${error.message}`.slice(-32_768);
    exitedEvent = { exitCode: 1, signal: "spawn-error" };
    for (const listener of [...exitListeners]) listener(exitedEvent);
    cleanup();
  });
  try {
    socket = await new Promise<Socket>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the local Pi PTY relay socket.")), 10_000);
      server.once("connection", (connection) => {
        clearTimeout(timeout);
        resolve(connection);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Pi PTY relay exited before connecting (code=${code ?? 0} signal=${signal ?? "none"}).`));
      });
    });
  } catch (error) {
    child.kill("SIGTERM");
    cleanup();
    throw error;
  }
  server.close();
  socket.on("data", (data: Buffer) => {
    const text = data.toString();
    if (dataListeners.size === 0) bufferedData.push(text);
    else for (const listener of [...dataListeners]) listener(text);
  });
  socket.on("error", (error) => {
    stderr = `${stderr}${error.message}`.slice(-32_768);
  });
  return {
    onData(listener) {
      dataListeners.add(listener);
      for (const data of bufferedData.splice(0)) listener(data);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (exitedEvent) queueMicrotask(() => listener(exitedEvent!));
      return { dispose: () => exitListeners.delete(listener) };
    },
    write(data) {
      if (!socket || !socket.writable || socket.destroyed) throw new Error(`Pi RPC relay socket is unavailable. ${stderr}`.trim());
      socket.write(data);
    },
    kill() {
      socket?.end();
      child.kill("SIGTERM");
    },
  };
}
