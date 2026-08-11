import { toolResultCardLines } from "../core/cards.js";
import {
  messageText,
  sanitizeDiagnostic,
  transcriptEntriesFromMessages,
  type TranscriptEntry,
  type TuiHeaderState,
} from "./view-model.js";
import {
  UI_CONTRACT_VERSION,
  validateUiActionCorrelation,
  type UiAction,
  type UiActionDispatcher,
  type UiActionResult,
  type UiDocument,
  type UiDocumentNode,
  type UiQuestion,
  type UiQuestionGroupResponse,
  type UiQuizResponse,
  type UiStudyPlanItem,
} from "./learner-contracts.js";
import { adaptToolResultToUiDocument, adaptUiDocument } from "./ui/adapter.js";
import { uiDocumentPresentation } from "./ui/render.js";

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
  /** Present the active canonical document and its keyboard-addressable controls. */
  setUiDocument(document: UiDocument | null, controls: readonly UiDocumentControl[]): void;
  /** Resolve with the chosen option string, or undefined when cancelled. */
  presentSelect(title: string, options: string[]): Promise<string | undefined>;
  /** Resolve with the decision, or undefined when cancelled. */
  presentConfirm(title: string, message: string): Promise<boolean | undefined>;
  presentInput(title: string, placeholder?: string): Promise<string | undefined>;
  presentEditor(title: string, prefill?: string): Promise<string | undefined>;
}

/** A deliberately small, renderer-independent terminal control. */
export interface UiDocumentControl {
  id: string;
  label: string;
  description?: string;
  /** Cancelling never dispatches; failures retain the entered action for retry. */
  run(): Promise<void>;
}

export interface HostControllerOptions {
  /**
   * Persistence, exact-once receipts, and transport remain outside the TUI.
   * The injected dispatcher can be a UiActionJournalStore-backed adapter.
   */
  uiActionDispatcher?: UiActionDispatcher;
}

export interface HostClientLike {
  onEvent(listener: (event: unknown) => void): unknown;
  getMessages?(): Promise<unknown[]>;
  respondToExtensionUI?(response: { type: "extension_ui_response"; id: string; value?: string; confirmed?: boolean; cancelled?: true; reason?: string }): Promise<void>;
  getState?(): Promise<unknown>;
  cycleModel?(): Promise<{ model: { provider?: string; id?: string }; thinkingLevel?: string } | null>;
  cycleThinkingLevel?(): Promise<{ level: string } | null>;
  newSession?(): Promise<{ cancelled: boolean }>;
  switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>;
  setSessionName?(name: string): Promise<void>;
  clone?(): Promise<{ cancelled: boolean }>;
  getForkMessages?(): Promise<Array<{ entryId: string; text: string }>>;
  fork?(entryId: string): Promise<{ text: string; cancelled: boolean }>;
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

const PEDAGOGICAL_UI_TOOLS = new Set([
  "animate", "ask_user_question", "deck", "generate_image", "grade_quiz", "map", "plan", "quiz", "scene",
  "set_learner_goal", "verify",
]);

function carriesUiDocument(toolName: string, result: unknown): boolean {
  if (PEDAGOGICAL_UI_TOOLS.has(toolName)) return true;
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const outer = result as Record<string, unknown>;
  if ("uiDocument" in outer || outer.protocol === "keating.ui" || (outer.schemaVersion === 1 && Array.isArray(outer.nodes))) return true;
  const details = outer.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  return ["uiDocument", "goal", "goals", "quiz", "question", "questions", "deck", "cards", "image", "scene", "storyboard"]
    .some((key) => key in (details as Record<string, unknown>));
}

export class HostController {
  private client: HostClientLike;
  private surface: HostSurface;
  /** Serializes UI requests: pi awaits each dialog, but never assume only one is outstanding. */
  private uiQueue: Promise<void> = Promise.resolve();
  private entrySequence = 0;
  private actionSequence = 0;
  private activeDocument: UiDocument | null = null;
  private lastUndeliveredAction: UiAction | null = null;
  private currentSessionPath: string | undefined;
  private readonly uiActionDispatcher?: UiActionDispatcher;

  constructor(client: HostClientLike, surface: HostSurface, options: HostControllerOptions = {}) {
    this.client = client;
    this.surface = surface;
    this.uiActionDispatcher = options.uiActionDispatcher;
  }

  /** Allows a host to expose the currently focused canonical document. */
  getActiveUiDocument(): UiDocument | null {
    return this.activeDocument;
  }

  getCurrentSessionPath(): string | undefined {
    return this.currentSessionPath;
  }

  attach(): void {
    this.client.onEvent((event) => this.handleEvent(event));
  }

  async initialize(): Promise<void> {
    await this.reloadSession(false);
  }

  private async reloadSession(clearDocument: boolean): Promise<void> {
    const [messages, state] = await Promise.allSettled([
      this.client.getMessages?.() ?? Promise.resolve([]),
      this.client.getState?.() ?? Promise.resolve(undefined),
    ]);
    this.surface.setStreaming(null);
    if (clearDocument) this.clearActiveDocument();
    if (messages.status === "fulfilled") {
      this.surface.hydrateEntries(transcriptEntriesFromMessages(messages.value));
    } else {
      this.appendError("Session history unavailable", messages.reason);
    }
    if (state.status === "fulfilled" && state.value) this.applySessionState(state.value);
    else if (state.status === "rejected") this.appendError("Session state unavailable", state.reason);
  }

  private clearActiveDocument(): void {
    this.activeDocument = null;
    this.lastUndeliveredAction = null;
    this.surface.setUiDocument(null, []);
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
    this.currentSessionPath = state.sessionFile;
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
      this.clearActiveDocument();
      this.surface.setHeaderState({ session: "new session", busy: false });
      this.append("notice", "Fresh session", "Ready for a new learning goal.");
      if (this.client.getState) this.applySessionState(await this.client.getState());
    } catch (error) {
      this.appendError("Could not start a new session", error);
    }
  }

  async resumeSession(sessionPath: string): Promise<boolean> {
    if (!this.client.switchSession) {
      this.appendError("Session resume unavailable", "This Pi runtime does not support switching sessions.");
      return false;
    }
    try {
      if (sessionPath !== this.currentSessionPath) {
        const result = await this.client.switchSession(sessionPath);
        if (result.cancelled) {
          this.append("notice", "Session switch cancelled", "The current session is still active.");
          return false;
        }
      }
      await this.reloadSession(true);
      this.append("notice", "Session resumed", "The selected transcript and its saved state are active.");
      return true;
    } catch (error) {
      this.appendError("Could not resume session", error);
      return false;
    }
  }

  async renameCurrentSession(name: string): Promise<boolean> {
    const nextName = name.trim();
    if (!nextName) {
      this.append("error", "Session name unchanged", "Enter a non-empty name. The current session remains active.");
      return false;
    }
    if (!this.client.setSessionName) {
      this.appendError("Session rename unavailable", "This Pi runtime does not support session names.");
      return false;
    }
    try {
      await this.client.setSessionName(nextName);
      if (this.client.getState) this.applySessionState(await this.client.getState());
      this.append("notice", "Session renamed", nextName);
      return true;
    } catch (error) {
      this.appendError("Could not rename session", error);
      return false;
    }
  }

  async cloneCurrentSession(): Promise<boolean> {
    if (!this.client.clone) {
      this.appendError("Session fork unavailable", "This Pi runtime does not support cloning the active branch.");
      return false;
    }
    try {
      const result = await this.client.clone();
      if (result.cancelled) {
        this.append("notice", "Session fork cancelled", "The original session remains active.");
        return false;
      }
      await this.reloadSession(true);
      this.append("notice", "Session forked", "A new session now contains the complete active branch. The original remains saved.");
      return true;
    } catch (error) {
      this.appendError("Could not fork session", error);
      return false;
    }
  }

  async forkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    if (!this.client.getForkMessages) {
      this.appendError("Turn fork unavailable", "This Pi runtime cannot enumerate forkable turns.");
      return [];
    }
    try {
      return await this.client.getForkMessages();
    } catch (error) {
      this.appendError("Could not load forkable turns", error);
      return [];
    }
  }

  async forkFromMessage(entryId: string): Promise<boolean> {
    if (!this.client.fork) {
      this.appendError("Turn fork unavailable", "This Pi runtime does not support forking from an earlier turn.");
      return false;
    }
    try {
      const result = await this.client.fork(entryId);
      if (result.cancelled) {
        this.append("notice", "Turn fork cancelled", "The current branch remains active.");
        return false;
      }
      await this.reloadSession(true);
      this.surface.setEditorText(result.text);
      this.append("notice", "Fork ready", "The earlier prompt is restored in the composer. Edit it, then send to create the new branch.");
      return true;
    } catch (error) {
      this.appendError("Could not fork from turn", error);
      return false;
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
    if (!this.client.respondToExtensionUI) throw new Error("The Pi runtime cannot answer extension UI requests.");
    await this.client.respondToExtensionUI({ type: "extension_ui_response", id: requestId, ...response });
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
        if (carriesUiDocument(toolName, result)) {
          const adapted = adaptToolResultToUiDocument(toolName, result);
          if (adapted.ok) {
            this.activateUiDocument(adapted.document);
            return;
          }
          this.append("error", "Interactive document needs attention", adapted.recovery.message);
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
        this.activateUiDocument(document);
        return;
      }
      default:
        return;
    }
  }

  private activateUiDocument(candidate: unknown): void {
    const adapted = adaptUiDocument(candidate);
    if (!adapted.ok) {
      this.append("error", "Interactive document needs attention", adapted.recovery.message);
      return;
    }
    this.activeDocument = adapted.document;
    this.lastUndeliveredAction = null;
    const presentation = uiDocumentPresentation(adapted.document);
    this.append("artifact", presentation.heading, presentation.body.join("\n"));
    this.surface.setUiDocument(adapted.document, this.documentControls(adapted.document));
  }

  private actionKey(document: UiDocument, nodeId: string, type: UiAction["type"]): string {
    this.actionSequence += 1;
    return `tui-ui-${document.id}-${document.revision}-${nodeId}-${type}-${this.actionSequence}`;
  }

  private action(document: UiDocument, nodeId: string, type: UiAction["type"], fields: Record<string, unknown>): UiAction {
    return {
      schemaVersion: UI_CONTRACT_VERSION,
      type,
      documentId: document.id,
      documentRevision: document.revision,
      nodeId,
      idempotencyKey: this.actionKey(document, nodeId, type),
      ...fields,
    } as UiAction;
  }

  private refreshDocumentControls(): void {
    if (this.activeDocument) this.surface.setUiDocument(this.activeDocument, this.documentControls(this.activeDocument));
  }

  private async dispatchUiAction(action: UiAction): Promise<void> {
    const document = this.activeDocument;
    if (!document || document.id !== action.documentId || document.revision !== action.documentRevision) {
      this.append("error", "Document changed", "The action was not sent because the displayed document is no longer current. Your entered work is preserved.");
      this.lastUndeliveredAction = action;
      this.refreshDocumentControls();
      return;
    }
    if (!this.uiActionDispatcher) {
      this.append("error", "Action delivery unavailable", "This OpenTUI host has no injected action dispatcher. Your entered work is preserved for retry on a capable host.");
      this.lastUndeliveredAction = action;
      this.refreshDocumentControls();
      return;
    }
    try {
      const result = await this.uiActionDispatcher.dispatch(action, document);
      if (!validateUiActionCorrelation(action, result, document)) {
        throw new Error("The action response did not correlate with the active document.");
      }
      this.applyUiActionResult(action, result);
    } catch (error) {
      this.lastUndeliveredAction = action;
      this.appendError("Interactive action was not delivered", error);
      this.append("notice", "Entered work preserved", "Use “Retry last entered action” from document actions after the delivery issue is resolved.");
      this.refreshDocumentControls();
    }
  }

  private applyUiActionResult(action: UiAction, result: UiActionResult): void {
    if (result.status === "completed" && result.resultingDocument) {
      this.activeDocument = result.resultingDocument;
      this.lastUndeliveredAction = null;
      const presentation = uiDocumentPresentation(result.resultingDocument);
      this.append("artifact", presentation.heading, presentation.body.join("\n"));
      this.surface.setUiDocument(result.resultingDocument, this.documentControls(result.resultingDocument));
      return;
    }
    if (result.status === "accepted") {
      this.lastUndeliveredAction = null;
      this.append("notice", "Action accepted", result.message || "Keating accepted this action and will update the document when ready.");
      this.refreshDocumentControls();
      return;
    }
    this.lastUndeliveredAction = action;
    this.append(result.status === "rejected" ? "error" : "notice", result.status === "rejected" ? "Action rejected" : "Action can be retried", result.message || "Your entered work is preserved.");
    this.refreshDocumentControls();
  }

  private control(id: string, label: string, run: () => Promise<void>, description?: string): UiDocumentControl {
    return { id, label, ...(description ? { description } : {}), run };
  }

  private documentControls(document: UiDocument): UiDocumentControl[] {
    const controls: UiDocumentControl[] = [];
    if (document.lifecycle === "failed" || document.lifecycle === "cancelled") {
      controls.push(this.control(`retry-${document.id}`, "Retry document", async () => {
        await this.dispatchUiAction(this.action(document, document.nodes[0]?.id || document.id, "retry", {}));
      }, "Retry the failed or cancelled document without losing entered work."));
    }
    if (this.lastUndeliveredAction && this.lastUndeliveredAction.documentId === document.id && this.lastUndeliveredAction.documentRevision === document.revision) {
      controls.push(this.control(`retry-last-${this.lastUndeliveredAction.idempotencyKey}`, "Retry last entered action", async () => {
        await this.dispatchUiAction(this.lastUndeliveredAction!);
      }, "Replays the exact saved action and idempotency key."));
    }
    if (document.lifecycle !== "ready") return controls;
    for (const node of document.nodes) controls.push(...this.nodeControls(document, node));
    return controls;
  }

  private nodeControls(document: UiDocument, node: UiDocumentNode): UiDocumentControl[] {
    switch (node.type) {
      case "question":
        return [this.control(`question-${node.id}`, node.choices?.length ? "Answer question" : "Write answer", async () => {
          const action = await this.questionAction(document, node);
          if (action) await this.dispatchUiAction(action);
        }, node.prompt)];
      case "question-group":
        return [this.control(`question-group-${node.id}`, "Submit question group", async () => {
          const action = await this.questionGroupAction(document, node);
          if (action) await this.dispatchUiAction(action);
        }, node.title || "Answer every question, then submit once.")];
      case "quiz":
        return [this.control(`quiz-${node.id}`, `Take quiz: ${node.title}`, async () => {
          const action = await this.quizAction(document, node);
          if (action) await this.dispatchUiAction(action);
        })];
      case "goal":
        return node.steps.filter((step) => step.status !== "done").map((step) => this.control(`goal-${node.id}-${step.id}`, `Complete goal step: ${step.title}`, async () => {
          await this.dispatchUiAction(this.action(document, node.id, "complete-goal-step", { stepId: step.id }));
        }));
      case "study-plan":
        return this.planItems(node.items ?? []).map((item) => this.control(`plan-${node.id}-${item.id}`, `${item.status === "done" ? "Reopen" : "Complete"} plan item: ${item.title}`, async () => {
          await this.dispatchUiAction(this.action(document, node.id, "complete-plan-item", { itemId: item.id, completed: item.status !== "done" }));
        }));
      case "notes":
        return [this.control(`notes-${node.id}`, `Edit notes: ${node.title}`, async () => {
          const value = await this.surface.presentEditor(node.title, node.value);
          if (value === undefined) return;
          await this.dispatchUiAction(this.action(document, node.id, "update-notes", { value }));
        }, "Esc keeps the typed text in the composer.")];
      case "deck":
        return [
          ...node.cards.map((card) => this.control(`deck-rate-${node.id}-${card.id}`, `Rate card: ${card.front}`, async () => {
            const action = await this.deckRateAction(document, node.id, card.id, card.front);
            if (action) await this.dispatchUiAction(action);
          })),
          this.control(`deck-complete-${node.id}`, `Complete deck: ${node.title}`, async () => {
            const action = await this.deckCompletionAction(document, node);
            if (action) await this.dispatchUiAction(action);
          }),
        ];
      case "artifact":
      case "image":
      case "media":
        return [this.control(`save-${node.id}`, `Save ${node.type}: ${node.resource.title}`, async () => {
          await this.dispatchUiAction(this.action(document, node.id, "save-artifact", {}));
        })];
      case "handoff":
        return [this.control(`handoff-${node.id}`, `Open handoff: ${node.target}`, async () => {
          await this.dispatchUiAction(this.action(document, node.id, "open-handoff", {}));
        }, node.context)];
      case "concept-map":
        return [this.control(`map-handoff-${node.id}`, "Map handoff", async () => {
          this.append("notice", "Mermaid map handoff", `The terminal preserved this Mermaid source without executing it. Open on web or desktop to render it.\n\n${node.source}`);
        }, "The original source remains available; terminal never executes Mermaid.")];
      default:
        return [];
    }
  }

  private planItems(items: readonly UiStudyPlanItem[]): UiStudyPlanItem[] {
    return items.flatMap((item) => [{ id: item.id, title: item.title, status: item.status }, ...this.planItems(item.children ?? [])]);
  }

  private async questionAction(document: UiDocument, question: UiQuestion): Promise<UiAction | undefined> {
    if (question.choices?.length) {
      const selection = await this.selectQuestionChoices(question, question.prompt);
      if (!selection) return undefined;
      return this.action(document, question.id, "choose-option", { optionIds: selection });
    }
    const value = await this.surface.presentEditor(question.header || "Answer question", question.prompt ? "" : undefined);
    if (value === undefined) return undefined;
    if (question.kind === "blanks" || question.kind === "fill_in") {
      const answers = value.split("\n").map((part) => part.trim());
      if (answers.length !== question.blanks?.length) {
        this.append("error", "Answer not sent", `Enter one line for each of the ${question.blanks?.length ?? 0} blanks. Your text remains in the composer.`);
        this.surface.setEditorText(value);
        return undefined;
      }
      return this.action(document, question.id, "submit-answer", { answer: answers });
    }
    return this.action(document, question.id, "submit-answer", { answer: value });
  }

  private async selectQuestionChoices(question: UiQuestion, title: string): Promise<string[] | undefined> {
    const choices = question.choices ?? [];
    if (!question.multiSelect) {
      const chosen = await this.surface.presentSelect(title, choices.map((choice) => `${choice.id} · ${choice.label}`));
      if (chosen === undefined) return undefined;
      const option = choices.find((choice) => chosen.startsWith(`${choice.id} ·`));
      return option ? [option.id] : undefined;
    }
    const selected: string[] = [];
    while (true) {
      const options = [...choices.filter((choice) => !selected.includes(choice.id)).map((choice) => `${choice.id} · ${choice.label}`), "Submit selected choices"];
      const chosen = await this.surface.presentSelect(`${title} (${selected.length} selected)`, options);
      if (chosen === undefined) return undefined;
      if (chosen === "Submit selected choices") return selected;
      const option = choices.find((choice) => chosen.startsWith(`${choice.id} ·`));
      if (option) selected.push(option.id);
    }
  }

  private async questionGroupAction(document: UiDocument, node: Extract<UiDocumentNode, { type: "question-group" }>): Promise<UiAction | undefined> {
    const responses: UiQuestionGroupResponse[] = [];
    for (const question of node.questions) {
      if (question.choices?.length) {
        const optionIds = await this.selectQuestionChoices(question, question.prompt);
        if (!optionIds) return undefined;
        let text: string | undefined;
        if (question.allowText) {
          const value = await this.surface.presentInput(`${question.prompt} (optional detail)`);
          if (value === undefined) return undefined;
          text = value || undefined;
        }
        responses.push({ questionId: question.id, type: "choice", optionIds, ...(text ? { text } : {}) });
      } else if (question.kind === "blanks" || question.kind === "fill_in") {
        const value = await this.surface.presentEditor(question.prompt);
        if (value === undefined) return undefined;
        const answers = value.split("\n").map((part) => part.trim());
        if (answers.length !== question.blanks?.length) { this.surface.setEditorText(value); return undefined; }
        responses.push({ questionId: question.id, type: "blanks", answers });
      } else if (question.kind === "classification" || question.kind === "matching") {
        const rows = [] as Array<{ item: string; optionId: string; reason?: string }>;
        for (const item of question.items ?? []) {
          const optionIds = await this.selectQuestionChoices({ ...question, multiSelect: false }, `${question.prompt}: ${item}`);
          if (!optionIds?.[0]) return undefined;
          const reason = question.requireReasons ? await this.surface.presentInput(`Reason for ${item}`) : undefined;
          if (question.requireReasons && reason === undefined) return undefined;
          rows.push({ item, optionId: optionIds[0], ...(reason ? { reason } : {}) });
        }
        responses.push({ questionId: question.id, type: "rows", rows });
      } else {
        const answer = await this.surface.presentEditor(question.prompt);
        if (answer === undefined) return undefined;
        responses.push({ questionId: question.id, type: "text", answer });
      }
    }
    return this.action(document, node.id, "submit-question-group", { responses });
  }

  private async quizAction(document: UiDocument, node: Extract<UiDocumentNode, { type: "quiz" }>): Promise<UiAction | undefined> {
    const answers: UiQuizResponse[] = [];
    const partialCredits: Record<string, number> = {};
    const perQuestionMs: Record<string, number> = {};
    for (const question of node.questions) {
      const answer = question.choices?.length
        ? await this.selectQuestionChoices(question, question.prompt).then((selection) => selection?.join(", "))
        : await this.surface.presentEditor(question.prompt);
      if (answer === undefined) return undefined;
      answers.push({ questionId: question.id, answer });
      partialCredits[question.id] = 0;
      perQuestionMs[question.id] = 0;
    }
    return this.action(document, node.id, "complete-quiz", {
      resultId: `tui-quiz-${document.id}-${node.id}-${this.actionSequence + 1}`,
      answers,
      score: 0,
      partialCreditPoints: 0,
      partialCredits,
      timing: { totalMs: 0, perQuestionMs },
      flaggedQuestionIds: [],
      pendingGradeQuestionIds: node.questions.map((question) => question.id),
      skippedQuestionIds: [],
    });
  }

  private async deckRateAction(document: UiDocument, nodeId: string, cardId: string, title: string): Promise<UiAction | undefined> {
    const selected = await this.surface.presentSelect(`Rate: ${title}`, ["0 · Again", "1 · Hard", "2 · Good", "3 · Easy"]);
    if (selected === undefined) return undefined;
    const rating = Number(selected[0]);
    if (rating !== 0 && rating !== 1 && rating !== 2 && rating !== 3) return undefined;
    return this.action(document, nodeId, "rate-card", { cardId, rating });
  }

  private async deckCompletionAction(document: UiDocument, node: Extract<UiDocumentNode, { type: "deck" }>): Promise<UiAction | undefined> {
    const ratings = [] as Array<{ cardId: string; rating: 0 | 1 | 2 | 3; appliedIntervalDays: number; easeAfter: number }>;
    for (const card of node.cards) {
      const selected = await this.surface.presentSelect(`Rate: ${card.front}`, ["0 · Again", "1 · Hard", "2 · Good", "3 · Easy"]);
      if (selected === undefined) return undefined;
      const rating = Number(selected[0]);
      if (rating !== 0 && rating !== 1 && rating !== 2 && rating !== 3) return undefined;
      ratings.push({ cardId: card.id, rating, appliedIntervalDays: [1, 2, 6, 15][rating]!, easeAfter: rating === 0 ? 2.3 : 2.5 });
    }
    return this.action(document, node.id, "complete-deck", {
      ratings,
      summary: { reviewed: ratings.length, lapses: ratings.filter((rating) => rating.rating === 0).length },
    });
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
