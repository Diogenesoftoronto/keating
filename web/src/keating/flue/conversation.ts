import {
  createFlueClient,
  FlueExecutionError,
  type FlueClient,
  type AgentConversationObservation,
  type FlueConversationState,
} from "@flue/sdk";
import {
  type AgentOptions,
  type AgentState,
  type AgentEvent,
  type AgentMessage,
  type AgentToolResult,
} from "@earendil-works/pi-agent-core";
import {
  validateToolArguments,
  type AssistantMessage,
  type ImageContent,
  type ToolResultMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { FlueTransport, type FlueConfiguration } from "./transport";

type MutableState = { -readonly [K in keyof AgentState]: AgentState[K] };
type Subscriber = (
  event: AgentEvent,
  signal: AbortSignal,
) => void | Promise<void>;

/** Application conversation controller. UI state comes directly from Flue SDK observation. */
export class FlueConversation {
  readonly chatRuntime = "flue-nodepod";
  readonly context: MutableState;
  private changes = new Set<() => void>();
  private client?: FlueClient;
  private observation?: AgentConversationObservation;
  private native?: FlueConversationState;
  private view = {
    conversation: undefined as FlueConversationState | undefined,
    running: false,
    error: undefined as string | undefined,
  };
  getSnapshot = () => this.view;
  get legacyMessages(): AgentMessage[] {
    return (this.bridge?.legacyMessages ??
      this.initialHistory) as AgentMessage[];
  }
  get localMessages(): AgentMessage[] {
    return this.context.messages.filter(
      (message) => !this.recorded.has(message),
    );
  }
  private initialHistory: AgentMessage[];
  private recorded = new WeakSet<object>();
  private files = new Map<string, string>();
  private loadingFiles = new Set<string>();
  private cancelTimer?: ReturnType<typeof setTimeout>;
  get execution() {
    return {
      state: this.context,
      subscribe: this.observeExecution.bind(this),
      waitForIdle: this.whenIdle.bind(this),
    };
  }
  subscribe = (listener: () => void) => {
    this.changes.add(listener);
    return () => {
      this.changes.delete(listener);
    };
  };
  private notify() {
    const users = this.context.messages
      .slice(this.legacyMessages.length)
      .filter(
        (message) => message.role === "user" && this.recorded.has(message),
      );
    let userIndex = 0;
    const conversation = this.native && {
      ...this.native,
      messages: this.native.messages.map((message) => ({
        ...message,
        ...(message.role === "user"
          ? {
              metadata: {
                ...message.metadata,
                timestamp: (
                  users[userIndex++] as { timestamp?: number } | undefined
                )?.timestamp,
              },
            }
          : {}),
        parts: message.parts.map((part) =>
          part.type === "file" && part.url
            ? { ...part, url: this.files.get(part.url) ?? part.url }
            : part,
        ),
      })),
    };
    this.view = {
      conversation,
      running: this.context.isStreaming,
      error: this.context.errorMessage,
    };
    for (const listener of this.changes) listener();
  }
  readonly sessionId: string;
  getApiKey?: AgentOptions["getApiKey"];
  private streamFunction: AgentOptions["streamFn"];
  private convertToLlm: NonNullable<AgentOptions["convertToLlm"]>;
  private transformContext?: AgentOptions["transformContext"];
  private options: AgentOptions;
  steeringMode = "all";
  followUpMode = "all";
  private subscribers = new Set<Subscriber>();
  private steering: AgentMessage[] = [];
  private followups: AgentMessage[] = [];
  private controller?: AbortController;
  private idle: Promise<void> = Promise.resolve();
  private bridge?: FlueTransport;
  private bridgeReady?: Promise<void>;
  private lastAssistant?: AssistantMessage;
  private turnResults: ToolResultMessage[] = [];
  private toolQueue: Promise<unknown> = Promise.resolve();
  constructor(
    options: AgentOptions,
    private bundleUrl: string,
  ) {
    this.options = options;
    this.initialHistory = structuredClone(options.initialState?.messages ?? []);
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.streamFunction = options.streamFn;
    this.getApiKey = options.getApiKey;
    this.convertToLlm = options.convertToLlm ?? ((messages) => messages as any);
    this.transformContext = options.transformContext;
    if (!options.initialState?.model)
      throw new Error("A model is required for Flue chat");
    this.context = {
      systemPrompt: "",
      tools: [],
      messages: [],
      thinkingLevel: "off",
      ...options.initialState,
      model: options.initialState.model,
      pendingToolCalls: new Set(),
      isStreaming: false,
    };
    this.context.messages = structuredClone(this.initialHistory);
    for (const message of this.context.messages) this.recorded.add(message);
  }
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }
  observeExecution(listener: Subscriber) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
  whenIdle() {
    return this.idle;
  }
  cancel() {
    this.controller?.abort();
    this.clearAllQueues();
    void this.client?.abort().catch(() => {});
    if (this.context.isStreaming && !this.cancelTimer)
      this.cancelTimer = setTimeout(() => {
        void this.bridge?.close();
      }, 5_000);
  }
  steer(message: AgentMessage) {
    this.steering.push(structuredClone(message));
  }
  followUp(message: AgentMessage) {
    this.followups.push(structuredClone(message));
  }
  clearSteeringQueue() {
    this.steering = [];
  }
  clearFollowUpQueue() {
    this.followups = [];
  }
  clearAllQueues() {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }
  hasQueuedMessages() {
    return this.steering.length > 0 || this.followups.length > 0;
  }
  reset() {
    if (this.context.isStreaming)
      throw new Error("Stop the current response before resetting this chat.");
    this.context.messages = [];
    this.context.errorMessage = undefined;
    this.clearAllQueues();
  }
  send(message: AgentMessage | AgentMessage[]): Promise<void>;
  send(input: string, images?: ImageContent[]): Promise<void>;
  send(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): Promise<void> {
    const messages: AgentMessage[] =
      typeof input === "string"
        ? [
            {
              role: "user",
              content: images?.length
                ? [{ type: "text", text: input }, ...images]
                : input,
              timestamp: Date.now(),
            },
          ]
        : Array.isArray(input)
          ? input
          : [input];
    return this.run(messages);
  }
  resume(): Promise<void> {
    const last = this.context.messages.at(-1);
    if (!last || !["user", "toolResult"].includes(last.role))
      return Promise.reject(
        new Error("No unfinished user or tool message to continue."),
      );
    return this.run([]);
  }
  async dispose(): Promise<void> {
    this.cancel();
    await this.whenIdle();
    this.observation?.close();
    this.observation = undefined;
    this.client = undefined;
    await this.bridge?.close();
    this.bridge = undefined;
    this.bridgeReady = undefined;
    for (const url of this.files.values()) URL.revokeObjectURL(url);
    this.files.clear();
  }
  private configuration(): FlueConfiguration {
    return {
      sessionId: this.sessionId ?? "default",
      systemPrompt: this.context.systemPrompt,
      tools: this.context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  }
  private async emit(event: AgentEvent) {
    for (const listener of this.subscribers)
      await listener(event, this.controller!.signal);
  }
  private async append(message: AgentMessage) {
    this.recorded.add(message);
    await this.emit({ type: "message_start", message });
    this.context.messages = [...this.context.messages, message];
    await this.emit({ type: "message_end", message });
  }
  private drain(queue: AgentMessage[], mode: string) {
    return queue.splice(0, mode === "one-at-a-time" ? 1 : queue.length);
  }
  private run(messages: AgentMessage[]): Promise<void> {
    if (this.context.isStreaming)
      return Promise.reject(
        new Error(
          "The agent is already responding. Use steering or wait for it to finish.",
        ),
      );
    this.context.isStreaming = true;
    this.context.errorMessage = undefined;
    this.notify();
    this.controller = new AbortController();
    let settle!: () => void;
    this.idle = new Promise((resolve) => {
      settle = resolve;
    });
    const startIndex = this.context.messages.length;
    return (async () => {
      try {
        await this.emit({ type: "agent_start" });
        for (const message of messages)
          await this.append(structuredClone(message));
        if (!this.bridge) {
          this.bridge = new FlueTransport(
            this.configuration(),
            {
              call: (method, value, _id, send, signal) =>
                method === "model"
                  ? this.modelTurn(send, signal)
                  : this.executeTool(value, signal),
            },
            this.bundleUrl,
            this.initialHistory,
          );
          this.bridgeReady = this.bridge.start();
        }
        await this.bridgeReady;
        this.initialHistory = structuredClone(
          this.bridge.legacyMessages,
        ) as AgentMessage[];
        if (!this.client) {
          this.client = createFlueClient({
            url: `https://flue.local/agents/teacher/${encodeURIComponent(this.sessionId)}`,
            fetch: this.bridge.fetch,
          });
          this.observation = this.client.observe({ live: "sse" });
          this.observation.subscribe(() => {
            const snapshot = this.observation!.getSnapshot();
            if (snapshot.conversation) this.acceptNative(snapshot.conversation);
            this.notify();
          });
        }
        let delivery = messages.length ? messages.at(-1)! : undefined;
        do {
          this.controller!.signal.throwIfAborted();
          this.bridge.configure(this.configuration());
          await this.bridge.beginTurn();
          const content =
            delivery && "content" in delivery ? delivery.content : undefined;
          const body =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("\n")
                : "";
          const attachments = Array.isArray(content)
            ? content.filter((p) => p.type === "image")
            : [];
          const admission = await this.client.send({
            message: delivery
              ? { kind: "user", body, attachments }
              : {
                  kind: "signal",
                  type: "resume",
                  body: "Continue the preserved Keating conversation.",
                },
            idempotencyKey: crypto.randomUUID(),
          });
          try {
            await this.client.read(admission);
          } catch (error) {
            if (
              error instanceof FlueExecutionError &&
              error.failure !== "terminal_event_missing"
            ) {
              await this.bridge.checkpointSettled();
              this.acceptNative(await this.client.history());
            }
            throw error;
          }
          await this.bridge.checkpointSettled();
          this.acceptNative(await this.client.history());
          this.notify();
          this.controller!.signal.throwIfAborted();
          await this.endTurn();
          const queued = this.steering.length
            ? this.drain(this.steering, this.steeringMode)
            : this.drain(this.followups, this.followUpMode);
          if (!queued.length) break;
          for (const message of queued) await this.append(message);
          delivery = queued.at(-1);
        } while (true);
      } catch (error) {
        const aborted = this.controller!.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        this.context.errorMessage = aborted ? "Response stopped" : message;
        const last = this.context.messages.at(-1);
        if (
          last?.role !== "assistant" ||
          !["error", "aborted"].includes(last.stopReason)
        )
          await this.append(
            this.errorMessage(
              aborted ? "aborted" : "error",
              this.context.errorMessage,
            ),
          );
        const failure = this.context.messages.at(-1);
        if (failure) this.recorded.delete(failure);
        this.observation?.close();
        this.observation = undefined;
        this.client = undefined;
        await this.bridge?.close();
        this.bridge = undefined;
        this.bridgeReady = undefined;
      } finally {
        clearTimeout(this.cancelTimer);
        this.cancelTimer = undefined;
        this.context.streamingMessage = undefined;
        this.lastAssistant = undefined;
        this.turnResults = [];
        (this.context.pendingToolCalls as Set<string>).clear();
        try {
          await this.emit({
            type: "agent_end",
            messages: this.context.messages.slice(startIndex),
          });
        } finally {
          this.context.isStreaming = false;
          this.notify();
          settle();
        }
      }
    })();
  }
  private acceptNative(conversation: FlueConversationState) {
    this.native = conversation;
    const bridge = this.bridge;
    if (!bridge) return;
    for (const message of conversation.messages)
      for (const part of message.parts) {
        if (
          part.type !== "file" ||
          !part.url ||
          this.files.has(part.url) ||
          this.loadingFiles.has(part.url)
        )
          continue;
        const url = part.url;
        if (new URL(url, "https://flue.local").origin !== "https://flue.local")
          continue;
        this.loadingFiles.add(url);
        void bridge
          .fetch(new URL(url, "https://flue.local"))
          .then(async (response) => {
            if (!response.ok) return;
            const blob = await response.blob();
            if (this.bridge !== bridge) return;
            this.files.set(url, URL.createObjectURL(blob));
            this.notify();
          })
          .catch(() => {})
          .finally(() => this.loadingFiles.delete(url));
      }
  }
  private errorMessage(
    stopReason: "error" | "aborted",
    errorMessage: string,
  ): AssistantMessage {
    const model = this.context.model;
    return {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      stopReason,
      errorMessage,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
  }
  private async endTurn() {
    if (!this.lastAssistant) return;
    await this.emit({
      type: "turn_end",
      message: this.lastAssistant,
      toolResults: this.turnResults,
    });
    this.lastAssistant = undefined;
    this.turnResults = [];
  }
  private async modelTurn(
    send: (event: unknown) => void,
    remoteSignal: AbortSignal,
  ): Promise<void> {
    const execution = this.controller!;
    const signal = AbortSignal.any([execution.signal, remoteSignal]);
    await this.toolQueue;
    if (this.controller !== execution || !this.context.isStreaming) return;
    await this.endTurn();
    for (const message of this.drain(this.steering, this.steeringMode))
      await this.append(message);
    await this.emit({ type: "turn_start" });
    const model = this.context.model;
    let started = false;
    let finished = false;
    const consume = async (event: AssistantMessageEvent) => {
      if (this.controller !== execution || !this.context.isStreaming) return;
      const snapshot = structuredClone(event);
      if (snapshot.type === "done" || snapshot.type === "error") {
        const message =
          snapshot.type === "done" ? snapshot.message : snapshot.error;
        this.context.streamingMessage = undefined;
        this.context.messages = [...this.context.messages, message];
        this.recorded.add(message);
        this.lastAssistant = message;
        if (message.errorMessage)
          this.context.errorMessage = message.errorMessage;
        if (!started) await this.emit({ type: "message_start", message });
        await this.emit({ type: "message_end", message });
        finished = true;
      } else {
        this.context.streamingMessage = snapshot.partial;
        if (!started) {
          await this.emit({ type: "message_start", message: snapshot.partial });
          started = true;
        }
        await this.emit({
          type: "message_update",
          message: snapshot.partial,
          assistantMessageEvent: snapshot,
        });
      }
      send(snapshot);
    };
    try {
      signal.throwIfAborted();
      const messages = this.transformContext
        ? await this.transformContext([...this.context.messages], signal)
        : [...this.context.messages];
      const stream = await this.streamFunction(
        model,
        {
          systemPrompt: this.context.systemPrompt,
          messages: await this.convertToLlm(messages),
          tools: this.context.tools,
        },
        {
          signal,
          apiKey: await this.getApiKey?.(model.provider),
          sessionId: this.sessionId,
          ...(this.context.thinkingLevel !== "off"
            ? { reasoning: this.context.thinkingLevel }
            : {}),
          thinkingBudgets: this.options.thinkingBudgets,
          transport: this.transportPreference(),
          maxRetryDelayMs: this.options.maxRetryDelayMs,
          onPayload: this.options.onPayload,
          onResponse: this.options.onResponse,
        },
      );
      for await (const event of stream) {
        if (event.type !== "error") signal.throwIfAborted();
        await consume(event);
      }
      if (!finished)
        throw new Error("Model stream ended without a final message");
    } catch (error) {
      if (!finished)
        await consume({
          type: "error",
          reason: signal.aborted ? "aborted" : "error",
          error: this.errorMessage(
            signal.aborted ? "aborted" : "error",
            error instanceof Error ? error.message : String(error),
          ),
        });
    }
  }
  private transportPreference() {
    return this.options.transport;
  }
  private executeTool(
    value: { name: string; args: unknown; toolCallId: string },
    remoteSignal: AbortSignal,
  ): Promise<unknown> {
    const execution = this.controller!;
    const signal = AbortSignal.any([execution.signal, remoteSignal]);
    // Preserve sequential side-effect ordering, including tools marked sequential.
    const run = this.toolQueue.then(async () => {
      if (this.controller !== execution || !this.context.isStreaming)
        throw new Error("Tool request belongs to a finished response");
      const { name: toolName, toolCallId } = value;
      const tool = this.context.tools.find((tool) => tool.name === toolName);
      let result: AgentToolResult<unknown>;
      let isError = false;
      let args: any = value.args;
      let updates = true;
      (this.context.pendingToolCalls as Set<string>).add(toolCallId);
      await this.emit({
        type: "tool_execution_start",
        toolCallId,
        toolName,
        args,
      });
      try {
        signal.throwIfAborted();
        if (!tool) throw new Error(`Tool is no longer available: ${toolName}`);
        const prepared = tool.prepareArguments
          ? tool.prepareArguments(args)
          : args;
        args = validateToolArguments(tool, {
          type: "toolCall",
          id: toolCallId,
          name: toolName,
          arguments: prepared,
        });
        result = await tool.execute(
          toolCallId,
          args,
          signal,
          (partialResult) => {
            if (updates && !signal.aborted)
              void this.emit({
                type: "tool_execution_update",
                toolCallId,
                toolName,
                args,
                partialResult,
              }).catch(() => {});
          },
        );
      } catch (error) {
        isError = true;
        result = {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          details: {},
        };
      } finally {
        updates = false;
        if (this.controller === execution)
          (this.context.pendingToolCalls as Set<string>).delete(toolCallId);
      }
      if (this.controller !== execution || !this.context.isStreaming)
        throw new Error("Tool result belongs to a finished response");
      const message: ToolResultMessage = {
        role: "toolResult",
        toolCallId,
        toolName,
        ...result,
        isError,
        timestamp: Date.now(),
      };
      await this.emit({
        type: "tool_execution_end",
        toolCallId,
        toolName,
        result,
        isError,
      });
      await this.append(message);
      this.turnResults.push(message);
      this.bridge?.configure(this.configuration());
      return {
        result,
        isError,
        message: isError
          ? message.content
              .filter((x) => x.type === "text")
              .map((x) => x.text)
              .join("\n")
          : undefined,
      };
    });
    this.toolQueue = run.catch(() => {});
    return run;
  }
}
