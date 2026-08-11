import {
  UI_ACTION_JOURNAL_KIND,
  canonicalUiAction,
  receiptForUiAction,
  validateUiAction,
  validateUiActionCorrelation,
  validateUiActionJournal,
  validateUiActionResult,
  validateUiActionAgainstDocument,
  type UiAction,
  type UiActionDispatcher,
  type UiActionJournal,
  type UiActionReceipt,
  type UiDocument,
} from "../learner-contracts.js";

import type { UiActionDispatchOutcome, UiRecovery } from "./types.js";

export interface UiActionJournalStorage {
  load(documentId: string): Promise<UiActionJournal | undefined>;
  save(journal: UiActionJournal): Promise<void>;
  /**
   * Optional cross-instance/process transaction boundary. Filesystem-backed
   * stores use this to cover load, side-effect dispatch, and final receipt save.
   */
  withDocumentLock?<T>(documentId: string, operation: () => Promise<T>): Promise<T>;
}

export interface UiActionJournalStoreDependencies {
  storage: UiActionJournalStorage;
  dispatcher: UiActionDispatcher;
  now?: () => string;
}

function recovery(
  code: UiRecovery["code"],
  message: string,
  retryable: boolean,
  suggestedAction: UiRecovery["suggestedAction"],
): UiActionDispatchOutcome {
  return { ok: false, recovery: { code, message, retryable, preserveEnteredWork: true, suggestedAction } };
}

function retryRecovery(result: Extract<UiActionDispatchOutcome, { ok: true }> ["result"]): UiRecovery | undefined {
  if (result.status !== "rejected" && result.status !== "retryable") return undefined;
  return {
    code: result.status === "retryable" ? "dispatch_failed" : "stale_document",
    message: result.message || (result.status === "retryable" ? "The action can be retried. Your entered work is preserved." : "This action was rejected. Review the current document and retry."),
    retryable: result.status === "retryable",
    preserveEnteredWork: true,
    suggestedAction: result.status === "retryable" ? "retry" : "correct-input",
  };
}

function emptyJournal(documentId: string): UiActionJournal {
  return { kind: UI_ACTION_JOURNAL_KIND, schemaVersion: 1, documentId, receipts: [] };
}

function pendingReceipt(action: UiAction, now: string): UiActionReceipt {
  return {
    schemaVersion: 1,
    action,
    actionFingerprint: canonicalUiAction(action),
    state: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function finalReceipt(receipt: UiActionReceipt, result: Extract<UiActionDispatchOutcome, { ok: true }> ["result"], now: string): UiActionReceipt {
  return { ...receipt, state: result.status, updatedAt: now, result };
}

/**
 * Durable action boundary shared by terminal, browser, desktop, and native
 * adapters. Storage and side effects are injected; this module has no UI or
 * filesystem dependency. A persisted receipt makes an exact replay return the
 * original result and turns a changed action with the same key into a conflict.
 */
export class UiActionJournalStore {
  private readonly now: () => string;
  private readonly inFlight = new Set<string>();
  private readonly documentQueues = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: UiActionJournalStoreDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async dispatch(action: UiAction, sourceDocument: UiDocument): Promise<UiActionDispatchOutcome> {
    const untrustedAction: unknown = action;
    if (!validateUiAction(untrustedAction)) {
      return recovery("invalid_action", "The action has an invalid shared-contract shape. Your entered work was not discarded.", true, "correct-input");
    }

    const inFlightKey = `${action.documentId}:${action.idempotencyKey}`;
    if (this.inFlight.has(inFlightKey)) {
      return recovery("dispatch_failed", "This action is already pending. Keep your entered work and retry after the prior request resolves.", true, "retry");
    }

    this.inFlight.add(inFlightKey);
    try {
      return await this.withDocumentLock(action.documentId, () => this.dispatchExclusive(action, sourceDocument));
    } catch {
      return recovery("dispatch_failed", "The durable action lock could not be acquired. Your entered work is preserved; repair storage and retry.", true, "retry");
    } finally {
      this.inFlight.delete(inFlightKey);
    }
  }

  private async withDocumentLock<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.documentQueues.get(documentId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.documentQueues.set(documentId, tail);
    await previous;
    try {
      if (this.dependencies.storage.withDocumentLock) {
        return await this.dependencies.storage.withDocumentLock(documentId, operation);
      }
      return await operation();
    } finally {
      release();
      if (this.documentQueues.get(documentId) === tail) this.documentQueues.delete(documentId);
    }
  }

  private async dispatchExclusive(action: UiAction, sourceDocument: UiDocument): Promise<UiActionDispatchOutcome> {
    let loaded: UiActionJournal | undefined;
    try {
      loaded = await this.dependencies.storage.load(action.documentId);
    } catch {
      return recovery("dispatch_failed", "The saved action journal could not be read. Your entered work is preserved; repair storage and retry.", true, "retry");
    }
    const journal = loaded ?? emptyJournal(action.documentId);
    if (!validateUiActionJournal(journal)) {
      return recovery("idempotency_conflict", "The saved action journal is invalid and cannot be replayed safely. Your entered work is preserved.", false, "open-capable-surface");
    }

    let receipt: UiActionReceipt | undefined;
    try {
      const prior = receiptForUiAction(journal, action);
      if (prior?.result && prior.result.status !== "retryable") {
        return { ok: true, result: prior.result, replayed: true, recovery: retryRecovery(prior.result) };
      }
      receipt = prior;
    } catch {
      return recovery("idempotency_conflict", "This idempotency key was already used for different entered work. Choose a new action key; nothing was overwritten.", false, "correct-input");
    }

    // A prior exact receipt deliberately replays before current-snapshot
    // validation: a completed action commonly advances the caller to a newer
    // document revision, but must still return its original durable result.
    const isRetryAction = action.type === "retry";
    if (!validateUiActionAgainstDocument(action, sourceDocument)) {
      const retryable = isRetryAction && (sourceDocument.lifecycle === "failed" || sourceDocument.lifecycle === "cancelled");
      return recovery("stale_document", "This action does not apply to the current document revision or lifecycle. Refresh, keep your entered work, and retry.", retryable, retryable ? "retry" : "correct-input");
    }

    if (!receipt) {
      receipt = pendingReceipt(action, this.now());
      journal.receipts.push(receipt);
      try {
        await this.dependencies.storage.save(journal);
      } catch {
        return recovery("dispatch_failed", "The pending action could not be saved, so it was not delivered. Your entered work is preserved.", true, "retry");
      }
    }

    let result: Extract<UiActionDispatchOutcome, { ok: true }> ["result"];
    try {
      result = await this.dependencies.dispatcher.dispatch(action, sourceDocument, receipt);
    } catch {
      result = {
        schemaVersion: 1,
        documentId: action.documentId,
        sourceRevision: action.documentRevision,
        actionIdempotencyKey: action.idempotencyKey,
        status: "retryable",
        documentLifecycle: sourceDocument.lifecycle,
        message: "The action could not be delivered. Your entered work is preserved for retry.",
        retryAfterMs: 0,
      };
    }

    if (!validateUiActionResult(result) || !validateUiActionCorrelation(action, result, sourceDocument)) {
      result = {
        schemaVersion: 1,
        documentId: action.documentId,
        sourceRevision: action.documentRevision,
        actionIdempotencyKey: action.idempotencyKey,
        status: "retryable",
        documentLifecycle: sourceDocument.lifecycle,
        message: "The action response could not be verified. Your entered work is preserved for retry.",
        retryAfterMs: 0,
      };
    }

    const index = journal.receipts.findIndex((candidate) => candidate.action.idempotencyKey === action.idempotencyKey);
    journal.receipts[index] = finalReceipt(receipt, result, this.now());
    try {
      await this.dependencies.storage.save(journal);
    } catch {
      return recovery("dispatch_failed", "The action response arrived, but its final receipt could not be saved. Your entered work remains visible; repair storage before retrying.", false, "open-capable-surface");
    }
    return { ok: true, result, replayed: false, recovery: retryRecovery(result) };
  }
}
