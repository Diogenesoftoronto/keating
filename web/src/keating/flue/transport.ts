import type { Nodepod, NodepodProcess } from "@scelar/nodepod";
import {
  readCheckpoint,
  writeCheckpoint,
  type FlueCheckpoint,
} from "./persistence";

export interface FlueConfiguration {
  sessionId: string;
  systemPrompt: string;
  tools: { name: string; description: string }[];
}
export interface FlueHostCallbacks {
  call(
    method: "model" | "tool",
    value: any,
    id: string,
    send: (event: unknown) => void,
    signal: AbortSignal,
  ): Promise<unknown>;
}
const PREFIX = "KEATING_FLUE_RPC:";
/** A dedicated pod separates the trusted harness from the learner's mutable source sandbox. */
export class FlueTransport {
  private pod?: Nodepod;
  private process?: NodepodProcess;
  private sequence = 0;
  private buffer = "";
  private pending = new Map<
    string,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private hostCalls = new Map<string, AbortController>();
  private checkpoint?: FlueCheckpoint;
  private releaseLock?: () => void;
  private closePromise?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private failure?: Error;
  readonly diagnostics: string[] = [];
  private http = new Map<
    string,
    {
      resolve(response: Response): void;
      reject(error: Error): void;
      stream?: ReadableStreamDefaultController<Uint8Array>;
      cleanup(): void;
    }
  >();
  constructor(
    private config: FlueConfiguration,
    private callbacks: FlueHostCallbacks,
    private bundleUrl: string,
    private initialHistory: unknown[] = [],
  ) {}
  get legacyMessages() {
    return this.checkpoint?.legacyMessages ?? this.initialHistory;
  }
  async start(): Promise<void> {
    if (!navigator.locks)
      throw new Error("Flue chat requires browser Web Locks support.");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request(
          `keating-flue:${this.config.sessionId}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              reject(
                new Error(
                  "This chat is open in another tab. Close that chat before continuing here.",
                ),
              );
              return;
            }
            await new Promise<void>((release) => {
              this.releaseLock = release;
              resolve();
            });
          },
        )
        .catch(reject);
    });
    try {
      const [{ Nodepod }, response] = await Promise.all([
        import("@scelar/nodepod"),
        fetch(this.bundleUrl),
      ]);
      if (!response.ok)
        throw new Error(
          "Unable to load the Flue chat runtime. Reload after updating Keating.",
        );
      const source = await response.text();
      if (this.failure) throw this.failure;
      this.checkpoint = await readCheckpoint(this.config.sessionId);
      this.checkpoint ??= {
        bytes: new Uint8Array(),
        savedAt: Date.now(),
        interrupted: false,
        legacyMessages: this.initialHistory,
      };
      this.pod = await Nodepod.boot({
        workdir: "/workspace",
        serviceWorker: false,
        enableSnapshotCache: false,
      });
      if (this.failure) {
        this.pod.teardown();
        throw this.failure;
      }
      await this.pod.fs.mkdir("/workspace", { recursive: true });
      await this.pod.fs.writeFile("/workspace/runtime.cjs", source);
      if (this.checkpoint?.bytes.length)
        await this.pod.fs.writeFile(
          "/workspace/flue.sqlite",
          this.checkpoint.bytes,
        );
      const ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
      this.process = await this.pod.spawn("node", ["/workspace/runtime.cjs"], {
        cwd: "/workspace",
      });
      this.process.on("output", (chunk) => this.receive(chunk));
      this.process.on("error", (text) => {
        this.diagnostics.push(text);
        this.diagnostics.splice(0, Math.max(0, this.diagnostics.length - 10));
      });
      this.process.on("exit", (code) =>
        this.fail(
          new Error(
            `Flue runtime stopped (exit ${code}). Retry the message to start a new runtime.`,
          ),
        ),
      );
      const timer = setTimeout(
        () => this.fail(new Error("Flue runtime startup timed out")),
        30_000,
      );
      try {
        await ready;
      } finally {
        clearTimeout(timer);
      }
      await this.request("start", this.config, 30_000);
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  configure(config: FlueConfiguration) {
    this.config = config;
    this.send({ kind: "configure", value: config });
  }
  async beginTurn(): Promise<void> {
    await writeCheckpoint(this.config.sessionId, {
      bytes: this.checkpoint?.bytes ?? new Uint8Array(),
      savedAt: Date.now(),
      interrupted: true,
      legacyMessages: this.legacyMessages,
    });
  }
  async checkpointSettled(): Promise<void> {
    if (this.failure || !this.pod)
      throw this.failure ?? new Error("Flue runtime unavailable");
    const raw: unknown = await this.pod.fs.readFile("/workspace/flue.sqlite");
    if (!(raw instanceof Uint8Array))
      throw new Error("Flue checkpoint is not binary");
    this.checkpoint = {
      bytes: raw,
      savedAt: Date.now(),
      interrupted: false,
      legacyMessages: this.legacyMessages,
    };
    await writeCheckpoint(this.config.sessionId, this.checkpoint);
  }
  readonly fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== "https://flue.local")
      throw new Error("Invalid local Flue URL");
    request.signal.throwIfAborted();
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();
    const id = `http-${++this.sequence}`;
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        const entry = this.http.get(id);
        this.http.delete(id);
        entry?.cleanup();
        if (!this.failure) this.send({ kind: "cancel-http", id });
        const error = new DOMException("Request aborted", "AbortError");
        entry?.stream?.error(error);
        reject(error);
      };
      request.signal.addEventListener("abort", abort, { once: true });
      this.http.set(id, {
        resolve,
        reject,
        cleanup: () => request.signal.removeEventListener("abort", abort),
      });
      if (request.signal.aborted) {
        abort();
        return;
      }
      try {
        this.send({
          kind: "http",
          id,
          url: request.url,
          method: request.method,
          headers: [...request.headers],
          body,
        });
      } catch (error) {
        this.http.get(id)?.cleanup();
        this.http.delete(id);
        reject(error);
      }
    });
  }) as typeof fetch;
  private send(message: unknown) {
    if (this.failure) throw this.failure;
    this.process?.write(JSON.stringify(message) + "\n");
  }
  private request(
    method: string,
    value: unknown,
    timeout: number,
  ): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    const id = `browser-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(`Flue ${method} timed out`)),
        timeout,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, value });
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }
  private receive(chunk: string) {
    this.buffer += chunk;
    for (let end; (end = this.buffer.indexOf("\n")) >= 0; ) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.startsWith(PREFIX)) continue;
      try {
        this.message(JSON.parse(line.slice(PREFIX.length)));
      } catch (error) {
        this.fail(error as Error);
      }
    }
  }
  private message(message: any) {
    if (message.kind === "diagnostic") {
      this.diagnostics.push(message.error);
      this.diagnostics.splice(0, this.diagnostics.length - 10);
      return;
    }
    if (message.kind.startsWith("http-")) {
      const entry = this.http.get(message.id);
      if (!entry) return;
      if (message.kind === "http-head") {
        const body = [204, 205, 304].includes(message.status)
          ? null
          : new ReadableStream<Uint8Array>({
              start: (controller) => {
                entry.stream = controller;
              },
              cancel: () => {
                if (!this.failure)
                  this.send({ kind: "cancel-http", id: message.id });
                entry.cleanup();
                this.http.delete(message.id);
              },
            });
        entry.resolve(
          new Response(body, {
            status: message.status,
            headers: message.headers,
          }),
        );
      } else if (message.kind === "http-chunk") {
        entry.stream?.enqueue(
          Uint8Array.from(atob(message.data), (character) =>
            character.charCodeAt(0),
          ),
        );
      } else {
        if (message.kind === "http-error") {
          const error = new Error(message.error);
          entry.stream?.error(error);
          entry.reject(error);
        } else entry.stream?.close();
        entry.cleanup();
        this.http.delete(message.id);
      }
      return;
    }
    if (message.kind === "ready") {
      this.readyResolve?.();
      return;
    }
    if (message.kind === "fatal") {
      this.fail(new Error(message.error));
      return;
    }
    if (message.kind === "cancel") {
      this.hostCalls.get(message.id)?.abort();
      return;
    }
    if (message.kind === "reply") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.value);
      return;
    }
    if (message.kind !== "call" || !["model", "tool"].includes(message.method))
      throw new Error("Invalid Flue bridge request");
    const controller = new AbortController();
    this.hostCalls.set(message.id, controller);
    void this.callbacks
      .call(
        message.method,
        message.value,
        message.id,
        (event) => this.send({ kind: "stream", id: message.id, event }),
        controller.signal,
      )
      .then((value) => {
        if (!this.failure && message.method !== "model")
          this.send({ kind: "reply", id: message.id, value });
      })
      .catch((error) => {
        if (this.failure) return;
        if (message.method === "model")
          this.fail(error instanceof Error ? error : new Error(String(error)));
        else
          this.send({
            kind: "reply",
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
      })
      .finally(() => this.hostCalls.delete(message.id));
  }
  private fail(error: Error) {
    this.failure ??= error;
    this.readyReject?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const entry of this.http.values()) {
      entry.stream?.error(error);
      entry.reject(error);
      entry.cleanup();
    }
    this.http.clear();
    for (const controller of this.hostCalls.values()) controller.abort();
  }
  close(): Promise<void> {
    return (this.closePromise ??= (async () => {
      try {
        if (this.process && !this.failure)
          await this.request("stop", {}, 5_000);
      } catch {
        /* Killing a failed harness never replays its work. */
      } finally {
        this.fail(new Error("Flue runtime closed"));
        this.process?.kill();
        this.pod?.teardown();
        this.releaseLock?.();
      }
    })());
  }
}
