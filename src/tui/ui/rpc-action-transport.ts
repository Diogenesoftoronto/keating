import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyReview,
  initialSrsState,
  UI_CONTRACT_VERSION,
  validateUiAction,
  validateUiActionCorrelation,
  validateUiActionAgainstDocument,
  validateUiActionResult,
  validateUiDocument,
  type UiAction,
  type UiActionDispatcher,
  type UiActionResult,
  type UiDocument,
  type UiStudyPlanItem,
} from "../learner-contracts.js";

import { FileUiActionJournalStorage } from "./filesystem-journal.js";
import { UiActionJournalStore } from "./journal.js";

export const PI_UI_ACTION_COMMAND = "keating-ui-action-v1";
export const PI_UI_ACTION_RESULT_PREFIX = "KEATING_UI_ACTION_RESULT_V1:";
const MAX_RPC_ENVELOPE_BYTES = 512 * 1024;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

interface UiActionEnvelope {
  action: UiAction;
  sourceDocument: UiDocument;
}

export interface UiActionRpcClient {
  onEvent(listener: (event: unknown) => void): (() => void) | void;
  getCommands(): Promise<Array<{ name: string; source?: string }>>;
  getState?(): Promise<{ isStreaming?: boolean }>;
  prompt(message: string): Promise<void>;
}

function boundedBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_RPC_ENVELOPE_BYTES) {
    throw new Error("The terminal UI action envelope exceeds its transport limit.");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

function parseBoundedBase64UrlJson(encoded: string): unknown {
  if (!encoded || encoded.length > Math.ceil(MAX_RPC_ENVELOPE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("The terminal UI action envelope is not bounded base64url data.");
  }
  const raw = Buffer.from(encoded, "base64url");
  if (raw.byteLength > MAX_RPC_ENVELOPE_BYTES) throw new Error("The terminal UI action envelope exceeds its transport limit.");
  return JSON.parse(raw.toString("utf8"));
}

export function encodeUiActionEnvelope(action: UiAction, sourceDocument: UiDocument): string {
  if (!validateUiActionAgainstDocument(action, sourceDocument)) {
    throw new Error("Refusing to transport an action that does not apply to its source document.");
  }
  return boundedBase64UrlJson({ action, sourceDocument });
}

export function decodeUiActionEnvelope(encoded: string): UiActionEnvelope {
  const candidate = parseBoundedBase64UrlJson(encoded) as Partial<UiActionEnvelope> | null;
  if (!candidate || !validateUiAction(candidate.action) || !validateUiDocument(candidate.sourceDocument)
    || !validateUiActionAgainstDocument(candidate.action, candidate.sourceDocument)) {
    throw new Error("The terminal UI action envelope failed shared-contract validation.");
  }
  return { action: candidate.action, sourceDocument: candidate.sourceDocument };
}

export function encodeUiActionResultNotification(result: UiActionResult): string {
  return `${PI_UI_ACTION_RESULT_PREFIX}${boundedBase64UrlJson(result)}`;
}

export function decodeUiActionResultNotification(message: string): UiActionResult | undefined {
  if (!message.startsWith(PI_UI_ACTION_RESULT_PREFIX)) return undefined;
  const candidate = parseBoundedBase64UrlJson(message.slice(PI_UI_ACTION_RESULT_PREFIX.length));
  return validateUiActionResult(candidate) ? candidate : undefined;
}

function retryableResult(action: UiAction, sourceDocument: UiDocument, message: string): UiActionResult {
  return {
    schemaVersion: UI_CONTRACT_VERSION,
    documentId: action.documentId,
    sourceRevision: action.documentRevision,
    actionIdempotencyKey: action.idempotencyKey,
    status: "retryable",
    documentLifecycle: sourceDocument.lifecycle,
    message,
    retryAfterMs: 0,
  };
}

/** Public-RpcClient-only action transport. Business ACKs arrive via notify events. */
export class RpcUiActionDispatcher implements UiActionDispatcher {
  private readonly pending = new Map<string, { action: UiAction; sourceDocument: UiDocument; resolve(result: UiActionResult): void }>();
  private readonly unsubscribe?: () => void;

  constructor(private readonly client: UiActionRpcClient, private readonly timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    this.unsubscribe = client.onEvent((event) => this.handleEvent(event)) ?? undefined;
  }

  dispose(): void {
    this.unsubscribe?.();
    for (const entry of this.pending.values()) {
      entry.resolve(retryableResult(entry.action, entry.sourceDocument, "The Pi action transport closed before acknowledging the action."));
    }
    this.pending.clear();
  }

  async dispatch(action: UiAction, sourceDocument: UiDocument): Promise<UiActionResult> {
    if (!validateUiActionAgainstDocument(action, sourceDocument)) {
      return retryableResult(action, sourceDocument, "The action no longer applies to the active document. Refresh and retry.");
    }
    const commands = await this.client.getCommands();
    if (!commands.some((command) => command.name === PI_UI_ACTION_COMMAND && command.source === "extension")) {
      return retryableResult(action, sourceDocument, "The Pi runtime does not expose Keating's UI action receiver. Rebuild the extension and retry.");
    }
    if ((await this.client.getState?.())?.isStreaming) {
      return retryableResult(action, sourceDocument, "Keating is still responding. Retry this action when the current response finishes.");
    }
    if (this.pending.has(action.idempotencyKey)) {
      return retryableResult(action, sourceDocument, "This action is already awaiting a Pi acknowledgement.");
    }

    const encoded = encodeUiActionEnvelope(action, sourceDocument);
    return await new Promise<UiActionResult>((resolve) => {
      let settled = false;
      const finish = (result: UiActionResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.pending.delete(action.idempotencyKey);
        resolve(result);
      };
      const timeout = setTimeout(() => finish(retryableResult(action, sourceDocument, "Pi did not acknowledge the action in time. Your exact action is preserved for retry.")), this.timeoutMs);
      this.pending.set(action.idempotencyKey, { action, sourceDocument, resolve: finish });
      void this.client.prompt(`/${PI_UI_ACTION_COMMAND} ${encoded}`).catch(() => {
        finish(retryableResult(action, sourceDocument, "The action could not be sent to Pi. Your exact action is preserved for retry."));
      });
    });
  }

  private handleEvent(event: unknown): void {
    const candidate = event as { type?: string; method?: string; message?: string } | null;
    if (!candidate || candidate.type !== "extension_ui_request" || candidate.method !== "notify" || typeof candidate.message !== "string") return;
    let result: UiActionResult | undefined;
    try {
      result = decodeUiActionResultNotification(candidate.message);
    } catch {
      return;
    }
    if (!result) return;
    const pending = this.pending.get(result.actionIdempotencyKey);
    if (!pending || !validateUiActionCorrelation(pending.action, result, pending.sourceDocument)) return;
    pending.resolve(result);
  }
}

function updatePlanItems(items: UiStudyPlanItem[] | undefined, itemId: string, completed: boolean): boolean {
  if (!items) return false;
  for (const item of items) {
    if (item.id === itemId) {
      item.status = completed ? "done" : "not_started";
      return true;
    }
    if (updatePlanItems(item.children, itemId, completed)) return true;
  }
  return false;
}

function normalizedAnswer(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function appendResultCallout(document: UiDocument, nodeId: string, title: string, markdown: string): void {
  const index = document.nodes.findIndex((node) => node.id === nodeId);
  const callout = { type: "callout" as const, id: `${nodeId}-result-${document.revision + 1}`, tone: "check" as const, title, markdown };
  if (index >= 0) document.nodes.splice(index, 1, callout);
  else document.nodes.push(callout);
}

async function saveArtifactNode(cwd: string, node: Extract<UiDocument["nodes"][number], { type: "artifact" | "image" | "media" }> | undefined): Promise<string | undefined> {
  if (!node) return undefined;
  const directory = join(cwd, ".keating", "outputs", "tui-artifacts");
  await mkdir(directory, { recursive: true });
  const extension = node.resource.format === "json" ? "json" : node.resource.format === "uri" ? "url" : "md";
  const filename = `${node.resource.id.replace(/[^A-Za-z0-9._-]/g, "-")}.${extension}`;
  const path = join(directory, filename);
  await writeFile(path, node.resource.content ?? node.resource.uri ?? "", { encoding: "utf8", mode: 0o600 });
  return path;
}

async function materializeUiAction(action: UiAction, sourceDocument: UiDocument, cwd: string): Promise<UiActionResult> {
  const resultingDocument = structuredClone(sourceDocument);
  let changed = false;
  const node = "nodeId" in action ? resultingDocument.nodes.find((candidate) => candidate.id === action.nodeId) : undefined;
  if (action.type === "update-notes" && node?.type === "notes") {
    node.value = action.value;
    changed = true;
  } else if (action.type === "complete-goal-step" && node?.type === "goal") {
    const step = node.steps.find((candidate) => candidate.id === action.stepId);
    if (step) {
      step.status = "done";
      node.status = node.steps.every((candidate) => candidate.status === "done") ? "completed" : node.status;
      changed = true;
    }
  } else if (action.type === "complete-plan-item" && node?.type === "study-plan") {
    changed = updatePlanItems(node.items, action.itemId, action.completed);
  } else if ((action.type === "submit-answer" || action.type === "choose-option") && node?.type === "question") {
    const answer = action.type === "choose-option" ? action.optionIds.join(", ") : Array.isArray(action.answer) ? action.answer.join("\n") : String(action.answer);
    const expected = node.correctAnswers ?? (node.correctAnswer ? [node.correctAnswer] : []);
    const correct = expected.length > 0 && expected.some((value) => normalizedAnswer(value) === normalizedAnswer(answer));
    appendResultCallout(resultingDocument, node.id, expected.length ? (correct ? "Answer recorded: correct" : "Answer recorded: check this") : "Answer recorded", [
      `Your answer: ${answer}`,
      expected.length ? `Expected: ${expected.join(", ")}` : "This response requires tutor review.",
      node.explanation ?? "",
    ].filter(Boolean).join("\n\n"));
    changed = true;
  } else if (action.type === "submit-question-group" && node?.type === "question-group") {
    appendResultCallout(resultingDocument, node.id, "Question group submitted", `${action.responses.length} response${action.responses.length === 1 ? "" : "s"} recorded for tutor review.`);
    changed = true;
  } else if (action.type === "complete-quiz" && node?.type === "quiz") {
    let graded = 0;
    let correct = 0;
    const pending: string[] = [];
    for (const response of action.answers) {
      const question = node.questions.find((candidate) => candidate.id === response.questionId);
      const expected = question?.correctAnswers ?? (question?.correctAnswer ? [question.correctAnswer] : []);
      if (expected.length === 0) pending.push(response.questionId);
      else {
        graded += 1;
        if (expected.some((value) => normalizedAnswer(value) === normalizedAnswer(response.answer))) correct += 1;
      }
    }
    appendResultCallout(resultingDocument, node.id, "Quiz submitted", [
      graded ? `Objective score: ${correct}/${graded}` : "No objective answers were available for local grading.",
      pending.length ? `${pending.length} response${pending.length === 1 ? "" : "s"} pending tutor review.` : "All answers graded locally.",
    ].join("\n\n"));
    resultingDocument.lifecycle = pending.length ? "submitted" : "completed";
    changed = true;
  } else if (action.type === "rate-card" && node?.type === "deck") {
    const card = node.cards.find((candidate) => candidate.id === action.cardId);
    if (card) {
      const reviewedAt = new Date().toISOString();
      const outcome = applyReview(initialSrsState(reviewedAt), action.rating, reviewedAt);
      node.cards = node.cards.filter((candidate) => candidate.id !== action.cardId);
      resultingDocument.nodes.push({
        type: "callout",
        id: `${action.cardId}-rating-${resultingDocument.revision + 1}`,
        tone: "check",
        title: `Card rated ${action.rating}`,
        markdown: `${card.front}\n\nNext review: ${outcome.next.dueAt} · ease ${outcome.next.ease.toFixed(2)}`,
      });
      changed = true;
    }
  } else if (action.type === "complete-deck" && node?.type === "deck") {
    appendResultCallout(resultingDocument, node.id, "Deck completed", `${action.summary.reviewed} reviewed · ${action.summary.lapses} lapse${action.summary.lapses === 1 ? "" : "s"}`);
    changed = true;
  } else if (action.type === "save-artifact") {
    const artifactNode = node && (node.type === "artifact" || node.type === "image" || node.type === "media") ? node : undefined;
    const path = await saveArtifactNode(cwd, artifactNode);
    if (artifactNode && path) {
      appendResultCallout(resultingDocument, artifactNode.id, "Artifact saved", path);
      changed = true;
    }
  } else if (action.type === "open-handoff" && node?.type === "handoff") {
    appendResultCallout(resultingDocument, node.id, `Handoff prepared for ${node.target}`, `${node.reason}\n\n${node.context}`);
    changed = true;
  }

  if (changed) {
    resultingDocument.revision += 1;
    resultingDocument.updatedAt = new Date().toISOString();
    return {
      schemaVersion: UI_CONTRACT_VERSION,
      documentId: action.documentId,
      sourceRevision: action.documentRevision,
      actionIdempotencyKey: action.idempotencyKey,
      status: "completed",
      documentLifecycle: resultingDocument.lifecycle,
      resultingDocument,
      message: "The terminal document was updated.",
    };
  }
  return {
    schemaVersion: UI_CONTRACT_VERSION,
    documentId: action.documentId,
    sourceRevision: action.documentRevision,
    actionIdempotencyKey: action.idempotencyKey,
    status: "rejected",
    documentLifecycle: sourceDocument.lifecycle,
    message: "This action is not implemented by the terminal receiver. No state was changed.",
  };
}

/** Register the receiver in the Pi extension without exposing action data to the model. */
export function registerPiUiActionCommand(pi: { registerCommand(name: string, command: { description: string; handler(args: string | string[], ctx: any): Promise<void> }): void }): void {
  pi.registerCommand(PI_UI_ACTION_COMMAND, {
    description: "Internal versioned receiver for canonical Keating UI actions.",
    handler: async (args, ctx) => {
      let envelope: UiActionEnvelope;
      try {
        const encoded = (Array.isArray(args) ? args.join("") : String(args ?? "")).trim();
        envelope = decodeUiActionEnvelope(encoded);
      } catch {
        ctx.ui.notify("Keating rejected an invalid terminal UI action envelope.", "error");
        return;
      }
      const store = new UiActionJournalStore({
        storage: new FileUiActionJournalStorage(ctx.cwd, "receiver"),
        dispatcher: { async dispatch(action, sourceDocument) { return await materializeUiAction(action, sourceDocument, ctx.cwd); } },
      });
      const outcome = await store.dispatch(envelope.action, envelope.sourceDocument);
      const result = outcome.ok
        ? outcome.result
        : retryableResult(envelope.action, envelope.sourceDocument, outcome.recovery.message);
      ctx.ui.notify(encodeUiActionResultNotification(result), result.status === "retryable" ? "warning" : "info");
    },
  });
}
