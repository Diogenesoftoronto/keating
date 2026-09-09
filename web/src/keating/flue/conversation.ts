import {
  createFlueClient,
  FlueApiError,
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
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { FlueTransport, type FlueConfiguration } from "./transport";
import { toModelMessages } from "./model-messages";

type MutableState = { -readonly [K in keyof AgentState]: AgentState[K] };
type Subscriber = (
  event: AgentEvent,
  signal: AbortSignal,
) => void | Promise<void>;

export interface KeatingAudioContent {
  type: "audio";
  data: string;
  mimeType: string;
  filename?: string;
  /** Preserve locally for playback, without sending bytes to the model. */
  sendToModel?: boolean;
}

function audioContent(part: unknown): part is KeatingAudioContent {
  if (!part || typeof part !== "object") return false;
  const value = part as Record<string, unknown>;
  return value.type === "audio" && typeof value.data === "string" && typeof value.mimeType === "string";
}

export function supportsAudioProviderRoute(model: Pick<Model<Api>, "api">, mimeType: string): boolean {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (model.api === "google-generative-ai" || model.api === "google-vertex") return ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/aac", "audio/flac", "audio/ogg", "audio/webm", "audio/mp4", "audio/aiff"].includes(mime);
  return model.api === "openai-completions" && ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"].includes(mime);
}

/** Pi and Flue currently type their inputs as text/image only. Audio stays audio
 * in saved messages; only the provider request copy gets native audio parts. */
export function prepareAudioModelInput(messages: AgentMessage[], model: Pick<Model<Api>, "api">) {
  const attachments = new Map<string, KeatingAudioContent>();
  const prepared = messages.map((message) => {
    if (message.role !== "user" || !("content" in message) || !Array.isArray(message.content)) return message;
    const content = (message.content as unknown[]).flatMap((part): unknown[] => {
      if (!audioContent(part)) return [part];
      if (part.sendToModel === false) return [];
      if (!supportsAudioProviderRoute(model, part.mimeType)) throw new Error(`This model transport cannot receive ${part.mimeType} audio. Use a supported audio model or send the transcript while keeping the recording for playback.`);
      if (!part.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)) throw new Error("The recording contains invalid audio data.");
      const marker = `[keating-audio-${crypto.randomUUID()}]`;
      attachments.set(marker, part);
      return [{ type: "text", text: marker }];
    });
    return { ...message, content } as AgentMessage;
  });
  return {
    messages: prepared,
    applyPayload(payload: unknown): unknown {
      if (!attachments.size) return payload;
      if (!payload || typeof payload !== "object") throw new Error("The selected provider did not create an audio-capable request.");
      const next = structuredClone(payload) as Record<string, any>;
      const google = model.api === "google-generative-ai" || model.api === "google-vertex";
      const userMessages = google ? next.contents : next.messages;
      if (!Array.isArray(userMessages)) throw new Error("The selected provider did not create an audio-capable request.");
      const replaced = new Set<string>();
      const audioPart = (audio: KeatingAudioContent) => google
        ? { inlineData: { mimeType: audio.mimeType.split(";")[0].trim(), data: audio.data } }
        : { type: "input_audio", input_audio: { data: audio.data, format: /wav/i.test(audio.mimeType) ? "wav" : "mp3" } };
      for (const message of userMessages) {
        if (message.role !== "user") continue;
        const original = google ? message.parts : message.content;
        const parts = typeof original === "string" ? [{ type: "text", text: original }] : original;
        if (!Array.isArray(parts)) continue;
        const output: unknown[] = [];
        for (const part of parts) {
          if (typeof part.text !== "string") { output.push(part); continue; }
          let text = part.text;
          while (text) {
            const match = [...attachments.keys()].map((marker) => ({ marker, index: text.indexOf(marker) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index)[0];
            if (!match) { output.push({ ...part, text }); break; }
            if (match.index) output.push({ ...part, text: text.slice(0, match.index) });
            output.push(audioPart(attachments.get(match.marker)!));
            replaced.add(match.marker);
            text = text.slice(match.index + match.marker.length);
          }
        }
        if (google) message.parts = output;
        else message.content = output;
      }
      if (replaced.size !== attachments.size) throw new Error("The provider dropped an audio attachment before sending. No audio request was sent.");
      return next;
    },
  };
}

export function audioPlaybackParts(message: AgentMessage | undefined) {
  const content = message && "content" in message ? message.content : undefined;
  return Array.isArray(content) ? (content as unknown[]).filter(audioContent).map((part) => ({
    type: "file" as const,
    mediaType: part.mimeType,
    filename: part.filename,
    url: `data:${part.mimeType};base64,${part.data}`,
  })) : [];
}

/** Application conversation controller. UI state comes directly from Flue SDK observation. */
export class FlueConversation {
  readonly chatRuntime = "flue-nodepod";
  readonly context: MutableState;
  private changes = new Set<() => void>();
  private client?: FlueClient;
  private observation?: AgentConversationObservation;
  private native?: FlueConversationState;
  private pendingDelivery?: { message: AgentMessage; knownUserIds: Set<string> };
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
      messages: this.native.messages.map((message) => {
        const user = message.role === "user" ? users[userIndex++] : undefined;
        return {
          ...message,
          ...(user ? { metadata: { ...message.metadata, timestamp: (user as { timestamp?: number }).timestamp } } : {}),
          parts: [
            ...message.parts.map((part) => part.type === "file" && part.url ? { ...part, url: this.files.get(part.url) ?? part.url } : part),
            ...audioPlaybackParts(user),
          ],
        };
      }),
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
    this.convertToLlm = options.convertToLlm ?? toModelMessages;
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
  /** Publish the learner turn before credential checks or workspace preparation. */
  sendPrepared(message: AgentMessage, prepare: (signal: AbortSignal) => Promise<void>): Promise<void> {
    return this.run([message], prepare);
  }
  resume(prepare?: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const last = this.context.messages.at(-1);
    if (!last || !["user", "toolResult"].includes(last.role))
      return Promise.reject(
        new Error("No unfinished user or tool message to continue."),
      );
    return this.run([], prepare);
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
  private run(messages: AgentMessage[], prepare?: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.context.isStreaming)
      return Promise.reject(
        new Error(
          "The agent is already responding. Use steering or wait for it to finish.",
        ),
      );
    const startIndex = this.context.messages.length;
    messages = structuredClone(messages);
    this.context.messages = [...this.context.messages, ...messages];
    this.context.isStreaming = true;
    this.context.errorMessage = undefined;
    this.controller = new AbortController();
    this.notify();
    let settle!: () => void;
    this.idle = new Promise((resolve) => {
      settle = resolve;
    });
    return (async () => {
      try {
        await this.emit({ type: "agent_start" });
        for (const message of messages) {
          await this.emit({ type: "message_start", message });
          await this.emit({ type: "message_end", message });
        }
        this.controller!.signal.throwIfAborted();
        if (prepare) {
          const signal = this.controller!.signal;
          let onAbort!: () => void;
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
          });
          try {
            await Promise.race([prepare(signal), aborted]);
          } finally {
            signal.removeEventListener("abort", onAbort);
          }
        }
        this.controller!.signal.throwIfAborted();
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
        // Establish the restored native history before matching this delivery.
        // Otherwise an older user turn arriving in the first observation could
        // incorrectly acknowledge the new, still-local message.
        try {
          this.acceptNative(await this.client.history());
        } catch (error) {
          // Flue creates a conversation stream on its first submission. A new
          // chat (including a first turn restored after OAuth) has no history yet.
          if (!(error instanceof FlueApiError && error.status === 404
            && (error.body as { error?: { type?: string } })?.error?.type === "stream_not_found")) throw error;
        }
        this.notify();
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
          if (delivery?.role === "user") {
            this.pendingDelivery = {
              message: delivery,
              knownUserIds: new Set(this.native?.messages.filter(message => message.role === "user").map(message => message.id) ?? []),
            };
          }
          const admission = await this.client.send({
            message: delivery
              ? { kind: "user", body: body || (Array.isArray(content) && content.some(audioContent) ? "[Audio recording]" : ""), attachments }
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
        this.pendingDelivery = undefined;
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
    const pending = this.pendingDelivery;
    if (pending && conversation.messages.some(message => message.role === "user" && !pending.knownUserIds.has(message.id))) {
      this.recorded.add(pending.message);
      this.pendingDelivery = undefined;
    }
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
      const audioInput = prepareAudioModelInput(messages, model);
      const stream = await this.streamFunction(
        model,
        {
          systemPrompt: this.context.systemPrompt,
          messages: await this.convertToLlm(audioInput.messages),
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
          onPayload: async (payload, payloadModel) => audioInput.applyPayload(await this.options.onPayload?.(payload, payloadModel) ?? payload),
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
