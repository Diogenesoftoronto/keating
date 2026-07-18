import { toolResultCardLines } from "../core/cards.js";

/**
 * Renderer-free controller for RPC hosts. Translates pi RPC events into
 * calls on a HostSurface, and services extension UI requests (select,
 * confirm, input, editor) by presenting them through the surface and
 * sending extension_ui_response commands back. The OpenTUI host implements
 * HostSurface with real widgets; tests implement it with scripted answers.
 */

export interface HostSurface {
  /** Append a completed transcript entry (user turn, assistant turn, notice, or card). */
  appendTurn(text: string): void;
  /** Replace the in-progress streaming assistant text (null clears it). */
  setStreaming(text: string | null): void;
  setStatus(text: string): void;
  setBusy(busy: boolean): void;
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
}

function messageText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: string; text?: string };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function briefArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3)
    .map(([key, value]) => {
      const text = String(value);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    });
  return entries.join(", ");
}

export class HostController {
  private client: HostClientLike;
  private surface: HostSurface;
  /** Serializes UI requests: pi awaits each dialog, but never assume only one is outstanding. */
  private uiQueue: Promise<void> = Promise.resolve();

  constructor(client: HostClientLike, surface: HostSurface) {
    this.client = client;
    this.surface = surface;
  }

  attach(): void {
    this.client.onEvent((event) => this.handleEvent(event));
  }

  private async sendUiResponse(requestId: string, response: Record<string, unknown>): Promise<void> {
    const internal = this.client as unknown as { send(command: Record<string, unknown>): Promise<unknown> };
    await internal.send({ type: "extension_ui_response", id: requestId, ...response });
  }

  handleEvent(event: unknown): void {
    const candidate = event as { type?: string } | null;
    if (!candidate || typeof candidate !== "object") return;

    switch (candidate.type) {
      case "message_update": {
        const message = (event as { message?: { role?: string } }).message;
        if (message?.role === "assistant") {
          const text = messageText(message);
          if (text) this.surface.setStreaming(`Keating\n${text}`);
        }
        return;
      }
      case "message_end": {
        const message = (event as { message?: { role?: string } }).message;
        if (message?.role === "assistant") {
          this.surface.setStreaming(null);
          const text = messageText(message);
          if (text) this.surface.appendTurn(`Keating\n${text}`);
        }
        return;
      }
      case "tool_execution_start": {
        const { toolName, args } = event as { toolName?: string; args?: unknown };
        if (toolName) {
          const summary = briefArgs(args);
          this.surface.appendTurn(`→ ${toolName}${summary ? `(${summary})` : ""}`);
        }
        return;
      }
      case "tool_execution_end": {
        const { toolName, result, isError } = event as { toolName?: string; result?: unknown; isError?: boolean };
        if (!toolName) return;
        if (isError) return;
        const card = toolResultCardLines(toolName, result);
        if (card) this.surface.appendTurn(card.join("\n"));
        return;
      }
      case "agent_start":
        this.surface.setBusy(true);
        return;
      case "agent_end":
        this.surface.setBusy(false);
        return;
      case "extension_ui_request":
        this.handleUiRequest(event as UiRequestEvent);
        return;
      case "ui_document": {
        const { document } = event as { document?: unknown };
        const card = toolResultCardLines("ui_document", document);
        if (card) this.surface.appendTurn(card.join("\n"));
        return;
      }
      default:
        return;
    }
  }

  private handleUiRequest(request: UiRequestEvent): void {
    switch (request.method) {
      case "notify":
        if (request.message) this.surface.appendTurn(`[Keating] ${request.message}`);
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
        this.surface.appendTurn(`[Keating] Unsupported Pi UI request${request.method ? `: ${request.method}` : ""}. The request was cancelled explicitly.`);
        if (request.id) {
          void this.sendUiResponse(request.id, { cancelled: true, reason: "unsupported_ui_request" }).catch((error) => {
            this.surface.appendTurn(`[Keating] Could not answer UI request: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        return;
    }
  }

  private enqueueDialog(request: UiRequestEvent & { id: string }): void {
    this.uiQueue = this.uiQueue
      .then(() => this.presentDialog(request))
      .catch((error) => {
        this.surface.appendTurn(`[Keating] UI request failed: ${error instanceof Error ? error.message : String(error)}`);
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
