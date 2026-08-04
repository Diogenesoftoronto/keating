import { toolResultCardLines } from "../core/cards.js";
import {
  messageText,
  sanitizeDiagnostic,
  transcriptEntriesFromMessages,
  type TranscriptEntry,
  type TuiHeaderState,
} from "./view-model.js";

/**
 * Renderer-free controller for RPC hosts. Translates pi RPC events into
 * calls on a HostSurface, and services extension UI requests (select,
 * confirm, input, editor) by presenting them through the surface and
 * sending extension_ui_response commands back. The OpenTUI host implements
 * HostSurface with real widgets; tests implement it with scripted answers.
 */

export interface HostSurface {
  /** Replace the transcript with hydrated session history. */
  hydrateEntries(entries: TranscriptEntry[]): void;
  /** Append a completed, semantically typed transcript entry. */
  appendEntry(entry: TranscriptEntry): void;
  /** Replace the in-progress streaming assistant entry (null clears it). */
  setStreaming(entry: TranscriptEntry | null): void;
  setStatus(text: string): void;
  setHeaderState(state: Partial<TuiHeaderState>): void;
  setEditorText(text: string): void;
  setWidget(key: string, lines: string[] | undefined, placement?: string): void;
  setTitle(title: string): void;
  /** Resolve with the chosen option string, or undefined when cancelled. */
  presentSelect(title: string, options: string[]): Promise<string | undefined>;
  /** Resolve with the decision, or undefined when cancelled. */
  presentConfirm(title: string, message: string): Promise<boolean | undefined>;
  presentInput(title: string, placeholder?: string): Promise<string | undefined>;
  presentEditor(title: string, prefill?: string): Promise<string | undefined>;
}

export interface HostClientLike {
  onEvent(listener: (event: unknown) => void): unknown;
  getMessages?(): Promise<unknown[]>;
  getState?(): Promise<unknown>;
  cycleModel?(): Promise<{ model: { provider?: string; id?: string }; thinkingLevel?: string } | null>;
  cycleThinkingLevel?(): Promise<{ level: string } | null>;
  newSession?(): Promise<{ cancelled: boolean }>;
  abort?(): Promise<void>;
}

interface UiRequestEvent {
  type: "extension_ui_request";
  id?: string;
  method?: string;
  title?: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
  statusText?: string;
  text?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  document?: unknown;
  notifyType?: "info" | "warning" | "error";
}

function briefArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3)
    .map(([key, value]) => {
      const text = /(?:key|token|secret|password)/i.test(key) ? "[redacted]" : sanitizeDiagnostic(String(value), 80);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    });
  return entries.join(", ");
}

export class HostController {
  private client: HostClientLike;
  private surface: HostSurface;
  /** Serializes UI requests: pi awaits each dialog, but never assume only one is outstanding. */
  private uiQueue: Promise<void> = Promise.resolve();
  private entrySequence = 0;

  constructor(client: HostClientLike, surface: HostSurface) {
    this.client = client;
    this.surface = surface;
  }

  attach(): void {
    this.client.onEvent((event) => this.handleEvent(event));
  }

  async initialize(): Promise<void> {
    const [messages, state] = await Promise.allSettled([
      this.client.getMessages?.() ?? Promise.resolve([]),
      this.client.getState?.() ?? Promise.resolve(undefined),
    ]);
    if (messages.status === "fulfilled") {
      this.surface.hydrateEntries(transcriptEntriesFromMessages(messages.value));
    } else {
      this.appendError("Session history unavailable", messages.reason);
    }
    if (state.status === "fulfilled" && state.value) this.applySessionState(state.value);
    else if (state.status === "rejected") this.appendError("Session state unavailable", state.reason);
  }

  private nextId(prefix: string): string {
    this.entrySequence += 1;
    return `${prefix}-${Date.now()}-${this.entrySequence}`;
  }

  private append(kind: TranscriptEntry["kind"], title: string, body: string, detail?: string): void {
    this.surface.appendEntry({ id: this.nextId(kind), kind, title, body, detail });
  }

  private appendError(title: string, error: unknown): void {
    this.append("error", title, sanitizeDiagnostic(error) || "No diagnostic was provided.");
  }

  private applySessionState(raw: unknown): void {
    const state = raw as {
      model?: { provider?: string; id?: string };
      thinkingLevel?: string;
      sessionName?: string;
      sessionId?: string;
      sessionFile?: string;
      isStreaming?: boolean;
    };
    const provider = state.model?.provider;
    const modelId = state.model?.id;
    const model = [provider, modelId].filter(Boolean).join("/") || "model unavailable";
    const sessionFileName = state.sessionFile?.split(/[\\/]/).at(-1)?.replace(/\.jsonl$/, "");
    this.surface.setHeaderState({
      model,
      thinking: state.thinkingLevel || "off",
      session: state.sessionName || sessionFileName || state.sessionId || "new session",
      busy: Boolean(state.isStreaming),
    });
  }

  async cycleModel(): Promise<void> {
    if (!this.client.cycleModel) return this.appendError("Model change unavailable", "This Pi runtime does not support model cycling.");
    try {
      const result = await this.client.cycleModel();
      if (!result) {
        this.append("notice", "Model unchanged", "No other configured model is available.");
        return;
      }
      const model = [result.model.provider, result.model.id].filter(Boolean).join("/");
      this.surface.setHeaderState({ model, ...(result.thinkingLevel ? { thinking: result.thinkingLevel } : {}) });
      this.append("notice", "Model changed", model);
    } catch (error) {
      this.appendError("Could not change model", error);
    }
  }

  async cycleThinking(): Promise<void> {
    if (!this.client.cycleThinkingLevel) return this.appendError("Thinking change unavailable", "This Pi runtime does not support thinking controls.");
    try {
      const result = await this.client.cycleThinkingLevel();
      if (!result) {
        this.append("notice", "Thinking unchanged", "The current model does not expose another thinking level.");
        return;
      }
      this.surface.setHeaderState({ thinking: result.level });
      this.append("notice", "Thinking changed", result.level);
    } catch (error) {
      this.appendError("Could not change thinking", error);
    }
  }

  async newSession(): Promise<void> {
    if (!this.client.newSession) return this.appendError("New session unavailable", "This Pi runtime does not support session reset.");
    try {
      const result = await this.client.newSession();
      if (result.cancelled) {
        this.append("notice", "New session cancelled", "The current session is still active.");
        return;
      }
      this.surface.setStreaming(null);
      this.surface.hydrateEntries([]);
      this.surface.setHeaderState({ session: "new session", busy: false });
      this.append("notice", "Fresh session", "Ready for a new learning goal.");
      if (this.client.getState) this.applySessionState(await this.client.getState());
    } catch (error) {
      this.appendError("Could not start a new session", error);
    }
  }

  async abort(): Promise<void> {
    if (!this.client.abort) return this.appendError("Stop unavailable", "This Pi runtime does not support aborting a response.");
    try {
      await this.client.abort();
      this.surface.setStreaming(null);
      this.surface.setHeaderState({ busy: false });
      this.append("notice", "Response stopped", "Your draft and conversation are preserved.");
    } catch (error) {
      this.appendError("Could not stop the response", error);
    }
  }

  private async sendUiResponse(requestId: string, response: Record<string, unknown>): Promise<void> {
    const internal = this.client as unknown as { send?: (command: Record<string, unknown>) => Promise<unknown> };
    if (!internal.send) throw new Error("The Pi runtime cannot answer extension UI requests.");
    await internal.send({ type: "extension_ui_response", id: requestId, ...response });
  }

  handleEvent(event: unknown): void {
    const candidate = event as { type?: string } | null;
    if (!candidate || typeof candidate !== "object") return;

    switch (candidate.type) {
      case "message_update": {
        const message = (event as { message?: { role?: string } }).message;
        if (message?.role === "assistant") {
          const hydrated = transcriptEntriesFromMessages([message]);
          const entry = hydrated.find((item) => item.kind === "assistant");
          if (entry) this.surface.setStreaming({ ...entry, id: "assistant-streaming" });
        }
        return;
      }
      case "message_end": {
        const message = (event as { message?: { role?: string } }).message;
        if (message?.role === "assistant") {
          this.surface.setStreaming(null);
          const entries = transcriptEntriesFromMessages([message]);
          for (const entry of entries) this.surface.appendEntry({ ...entry, id: this.nextId(entry.kind) });
        }
        return;
      }
      case "tool_execution_start": {
        const { toolName, args } = event as { toolName?: string; args?: unknown };
        if (toolName) {
          const summary = briefArgs(args);
          this.append("tool", toolName, summary || "Running…");
        }
        return;
      }
      case "tool_execution_end": {
        const { toolName, result, isError } = event as { toolName?: string; result?: unknown; isError?: boolean };
        if (!toolName) return;
        if (isError) {
          this.appendError(`${toolName} failed`, result);
          return;
        }
        const card = toolResultCardLines(toolName, result);
        if (card) this.append("artifact", `${toolName} result`, card.join("\n"));
        else this.append("tool", `${toolName} completed`, messageText(result) || "Completed");
        return;
      }
      case "agent_start":
        this.surface.setHeaderState({ busy: true });
        return;
      case "agent_end":
        this.surface.setHeaderState({ busy: false });
        return;
      case "extension_ui_request":
        this.handleUiRequest(event as UiRequestEvent);
        return;
      case "ui_document": {
        const { document } = event as { document?: unknown };
        const card = toolResultCardLines("ui_document", document);
        if (card) this.append("artifact", "Interactive result", card.join("\n"));
        return;
      }
      default:
        return;
    }
  }

  private handleUiRequest(request: UiRequestEvent): void {
    switch (request.method) {
      case "notify":
        if (request.message) this.append(request.notifyType === "error" ? "error" : "notice", "Keating", sanitizeDiagnostic(request.message));
        return;
      case "setStatus":
        this.surface.setStatus(request.statusText || "Ready");
        return;
      case "set_editor_text":
        if (typeof request.text === "string") this.surface.setEditorText(request.text);
        return;
      case "setWidget":
        if (request.widgetKey) this.surface.setWidget(request.widgetKey, request.widgetLines, request.widgetPlacement);
        return;
      case "setTitle":
        if (request.title) this.surface.setTitle(request.title);
        return;
      case "select":
      case "confirm":
      case "input":
      case "editor":
        if (request.id) this.enqueueDialog(request as UiRequestEvent & { id: string });
        return;
      default:
        this.append("error", "Unsupported Pi UI request", `${request.method || "unknown"}. The request was cancelled explicitly.`);
        if (request.id) {
          void this.sendUiResponse(request.id, { cancelled: true, reason: "unsupported_ui_request" }).catch((error) => {
            this.appendError("Could not answer UI request", error);
          });
        }
        return;
    }
  }

  private enqueueDialog(request: UiRequestEvent & { id: string }): void {
    this.uiQueue = this.uiQueue
      .then(() => this.presentDialog(request))
      .catch((error) => {
        this.appendError("UI request failed", error);
      });
  }

  private async presentDialog(request: UiRequestEvent & { id: string }): Promise<void> {
    const title = request.title ?? "";
    try {
      switch (request.method) {
        case "select": {
          const value = await this.surface.presentSelect(title, request.options ?? []);
          await this.sendUiResponse(request.id, value === undefined ? { cancelled: true } : { value });
          return;
        }
        case "confirm": {
          const confirmed = await this.surface.presentConfirm(title, request.message ?? "");
          await this.sendUiResponse(request.id, confirmed === undefined ? { cancelled: true } : { confirmed });
          return;
        }
        case "input": {
          const value = await this.surface.presentInput(title, request.placeholder);
          await this.sendUiResponse(request.id, value === undefined ? { cancelled: true } : { value });
          return;
        }
        case "editor": {
          const value = await this.surface.presentEditor(title, request.prefill);
          await this.sendUiResponse(request.id, value === undefined ? { cancelled: true } : { value });
          return;
        }
        default:
          await this.sendUiResponse(request.id, { cancelled: true });
      }
    } catch (error) {
      await this.sendUiResponse(request.id, { cancelled: true }).catch(() => {});
      throw error;
    }
  }
}
