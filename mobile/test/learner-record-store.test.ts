import { describe, expect, test } from "bun:test";
import {
  createPortableLearnerEnvelope,
  UI_CONTRACT_VERSION,
  type PortableLearnerData,
  type UiAction,
  type UiActionJournal,
  type UiDocument,
} from "@keating/learner-contracts";
import {
  LearnerRecordStore,
  UiActionStore,
  type AsyncSqlDatabase,
  type AsyncSqlExecutor,
  type SqlBindValue,
} from "../src/lib/learner-repository";

interface StoredRow {
  kind: string;
  id: string;
  sort_timestamp: string;
  payload_json: string;
}

interface StoredPriorityRow {
  id: string;
  target_type: "deck" | "goal" | "topic" | "verification";
  target_id: string;
  updated_at: string;
  payload_json: string;
}

class MemoryDatabase implements AsyncSqlDatabase {
  rows = new Map<string, StoredRow>();
  profile: string | null = null;
  priorities = new Map<string, StoredPriorityRow>();
  meta = new Map<string, string>();
  localAttachments = new Map<string, { messageId: string; attachmentId: string; uri: string }>();
  uiActionJournals = new Map<string, { updated_at: string; payload_json: string }>();
  closeCalls = 0;

  async execAsync(_source: string): Promise<void> {}

  async runAsync(source: string, ...params: SqlBindValue[]): Promise<{ changes: number; lastInsertRowId: number }> {
    if (source.startsWith("DELETE FROM learner_records")) this.rows.clear();
    else if (source.startsWith("DELETE FROM learner_profile")) this.profile = null;
    else if (source.startsWith("DELETE FROM study_priorities")) this.priorities.clear();
    else if (source.startsWith("DELETE FROM repository_meta")) this.meta.delete(String(params[0]));
    else if (source.startsWith("DELETE FROM local_message_attachments")) this.localAttachments.clear();
    else if (source.startsWith("DELETE FROM ui_action_journals")) this.uiActionJournals.clear();
    else if (source.startsWith("INSERT INTO learner_records")) {
      const [kind, id, sortTimestamp, payload] = params.map(String);
      const key = `${kind}:${id}`;
      if (this.rows.has(key)) throw new Error("UNIQUE constraint failed: learner_records.kind, learner_records.id");
      this.rows.set(key, { kind, id, sort_timestamp: sortTimestamp, payload_json: payload });
    } else if (source.startsWith("INSERT INTO learner_profile")) {
      this.profile = String(params[0]);
    } else if (source.startsWith("INSERT INTO study_priorities")) {
      const [id, targetType, targetId, updatedAt, payload] = params.map(String);
      if (this.priorities.has(id)) throw new Error("UNIQUE constraint failed: study_priorities.id");
      if ([...this.priorities.values()].some((row) => row.target_type === targetType && row.target_id === targetId)) {
        throw new Error("UNIQUE constraint failed: study_priorities.target_type, study_priorities.target_id");
      }
      this.priorities.set(id, {
        id,
        target_type: targetType as StoredPriorityRow["target_type"],
        target_id: targetId,
        updated_at: updatedAt,
        payload_json: payload,
      });
    } else if (source.startsWith("INSERT INTO repository_meta")) {
      this.meta.set(String(params[0]), String(params[1]));
    } else if (source.startsWith("INSERT INTO local_message_attachments")) {
      const [messageId, attachmentId, uri] = params.map(String);
      this.localAttachments.set(`${messageId}:${attachmentId}`, { messageId, attachmentId, uri });
    } else if (source.startsWith("INSERT INTO ui_action_journals")) {
      const [documentId, updatedAt, payload] = params.map(String);
      this.uiActionJournals.set(documentId, { updated_at: updatedAt, payload_json: payload });
    }
    return { changes: 1, lastInsertRowId: 1 };
  }

  async getFirstAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T | null> {
    if (source.includes("FROM learner_profile") && this.profile !== null) {
      return { payload_json: this.profile } as T;
    }
    if (source.includes("FROM repository_meta")) {
      const value = this.meta.get(String(params[0] ?? "portable_generated_at"));
      return value === undefined ? null : { value } as T;
    }
    if (source.includes("FROM ui_action_journals")) {
      const row = this.uiActionJournals.get(String(params[0]));
      return row ? { payload_json: row.payload_json } as T : null;
    }
    return null;
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    if (source.includes("FROM study_priorities")) {
      return [...this.priorities.values()]
        .sort((left, right) => left.updated_at.localeCompare(right.updated_at)
          || left.target_type.localeCompare(right.target_type)
          || left.target_id.localeCompare(right.target_id)) as T[];
    }
    if (source.includes("FROM local_message_attachments")) {
      return [...this.localAttachments.values()] as T[];
    }
    if (!source.includes("FROM learner_records")) return [];
    return [...this.rows.values()]
      .sort((left, right) => left.kind.localeCompare(right.kind)
        || left.sort_timestamp.localeCompare(right.sort_timestamp)
        || left.id.localeCompare(right.id)) as T[];
  }

  async withExclusiveTransactionAsync(task: (transaction: AsyncSqlExecutor) => Promise<void>): Promise<void> {
    const previousRows = this.rows;
    const previousProfile = this.profile;
    const previousPriorities = this.priorities;
    const previousMeta = this.meta;
    const previousLocalAttachments = this.localAttachments;
    const previousUiActionJournals = this.uiActionJournals;
    this.rows = new Map([...previousRows].map(([key, value]) => [key, { ...value }]));
    this.priorities = new Map([...previousPriorities].map(([key, value]) => [key, { ...value }]));
    this.meta = new Map(previousMeta);
    this.localAttachments = new Map(previousLocalAttachments);
    this.uiActionJournals = new Map([...previousUiActionJournals].map(([key, value]) => [key, { ...value }]));
    try {
      await task(this);
    } catch (error) {
      this.rows = previousRows;
      this.profile = previousProfile;
      this.priorities = previousPriorities;
      this.meta = previousMeta;
      this.localAttachments = previousLocalAttachments;
      this.uiActionJournals = previousUiActionJournals;
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    this.closeCalls += 1;
  }
}

const AT = "2026-08-10T00:00:00.000Z";

function uiFixture(): { document: UiDocument; action: UiAction } {
  const document: UiDocument = {
    schemaVersion: UI_CONTRACT_VERSION,
    id: "document-1",
    revision: 0,
    lifecycle: "ready",
    supportedSurfaces: ["mobile", "web"],
    nodes: [{ type: "question", id: "question-1", prompt: "Why does the posterior change?" }],
    createdAt: AT,
    updatedAt: AT,
  };
  return {
    document,
    action: {
      schemaVersion: UI_CONTRACT_VERSION,
      type: "submit-answer",
      documentId: document.id,
      documentRevision: document.revision,
      nodeId: "question-1",
      answer: "The evidence changes the likelihood.",
      idempotencyKey: "action-1",
    },
  };
}

function fixture(): PortableLearnerData {
  return {
    generatedAt: AT,
    sessions: [{
      id: "session-1",
      title: "Bayes",
      createdAt: AT,
      updatedAt: AT,
      activeBranchId: "branch-1",
      branches: [{ id: "branch-1", sessionId: "session-1", createdAt: AT, updatedAt: AT }],
      messages: [{
        id: "message-1",
        role: "user",
        content: "Teach Bayes",
        createdAt: AT,
        attachments: [{ id: "attachment-1", kind: "image", name: "bayes.png", mimeType: "image/png", sizeBytes: 512 }],
      }],
      model: { provider: "openai", id: "gpt-5" },
    }],
    artifacts: [],
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [{
      id: "priority-1",
      targetType: "topic",
      targetId: "Bayes",
      priority: "focus",
      updatedAt: AT,
    }],
    feedbackEvents: [{
      id: "feedback-1",
      sessionId: "session-1",
      messageId: "message-1",
      rating: "helpful",
      createdAt: AT,
    }],
    usageEvents: [{
      id: "usage-1",
      provider: "openai",
      model: "gpt-5",
      createdAt: AT,
      sessionId: "session-1",
      providerReported: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    }],
    topicEvidence: [{
      id: "evidence-1",
      topic: "Bayes",
      createdAt: AT,
      provenance: "session",
      reference: { kind: "session", id: "session-1" },
    }],
    benchmarks: [{
      id: "benchmark-1", createdAt: AT, score: 84, report: "Observed benchmark run", topic: "Bayes",
      sessionId: "session-1", provenance: "benchmark-run",
    }],
    evolutions: [{
      id: "evolution-1", createdAt: AT, bestScore: 88, policy: "Increase retrieval practice",
      report: "Observed policy evolution run", topic: "Bayes", sessionId: "session-1", provenance: "evolution-run",
    }],
    learnerProfile: { topicsExplored: ["Bayes"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: AT },
  };
}

describe("mobile learner record store", () => {
  test("round-trips portable records across a repository reopen", async () => {
    const database = new MemoryDatabase();
    const first = new LearnerRecordStore(database, () => AT);
    await first.replace(fixture());

    const reopened = new LearnerRecordStore(database, () => AT);
    expect(await reopened.snapshot()).toEqual(fixture());
    expect((await reopened.exportPortable()).payload.usageEvents[0]?.providerReported.totalTokens).toBe(30);
    expect(database.rows.has("topic_evidence:evidence-1")).toBe(true);
    expect(database.rows.has("benchmark:benchmark-1")).toBe(true);
    expect(database.rows.has("evolution:evolution-1")).toBe(true);
    expect(database.priorities.get("priority-1")?.target_id).toBe("Bayes");
  });

  test("keeps app-owned attachment locations local and validates their portable references", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    const location = {
      messageId: "message-1",
      attachmentId: "attachment-1",
      uri: "file:///documents/composer-attachments/bayes.png",
    };
    await store.replaceWithLocalAttachments(fixture(), [location]);
    expect(await store.getLocalAttachments()).toEqual([location]);
    expect(JSON.stringify(await store.exportPortable())).not.toContain("file:///documents");
    expect(() => store.replaceWithLocalAttachments(fixture(), [{ ...location, attachmentId: "missing" }]))
      .toThrow("no portable message reference");
  });

  test("imports idempotently without double-counting provider usage", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    const envelope = createPortableLearnerEnvelope(fixture());
    await store.importPortable(envelope);
    await store.importPortable(envelope);

    const snapshot = await store.snapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.usageEvents).toHaveLength(1);
    expect(snapshot.topicEvidence).toHaveLength(1);
  });

  test("applies a semantic mutation atomically without dropping unrelated portable records", async () => {
    const database = new MemoryDatabase();
    const nextAt = "2026-08-11T00:00:00.000Z";
    const store = new LearnerRecordStore(database, () => nextAt);
    await store.replace(fixture());

    const updated = await store.mutatePortable((current, now) => ({
      ...current,
      learnerProfile: {
        ...current.learnerProfile,
        strengths: ["Bayes"],
        lastSessionAt: now,
      },
    }));

    expect(updated.generatedAt).toBe(nextAt);
    expect(updated.learnerProfile.strengths).toEqual(["Bayes"]);
    expect(updated.sessions).toEqual(fixture().sessions);
    expect(updated.usageEvents).toEqual(fixture().usageEvents);
    expect(await store.snapshot()).toEqual(updated);
  });

  test("rolls back an invalid semantic mutation and does not mutate the callback snapshot", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    const original = fixture();
    await store.replace(original);
    let callbackSnapshot: PortableLearnerData | undefined;

    await expect(store.mutatePortable((current) => {
      callbackSnapshot = current;
      current.learnerProfile.sessionsCount = -1;
      return current;
    })).rejects.toThrow("invalid portable learner data");

    expect(callbackSnapshot?.learnerProfile.sessionsCount).toBe(-1);
    expect(original.learnerProfile.sessionsCount).toBe(1);
    expect(await store.snapshot()).toEqual(original);
  });

  test("rolls back an equal-time import conflict", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    const original = fixture();
    await store.replace(original);
    const conflicting = fixture();
    conflicting.sessions[0] = { ...conflicting.sessions[0]!, title: "Different title" };

    await expect(store.importPortable(createPortableLearnerEnvelope(conflicting))).rejects.toThrow("conflict");
    expect((await store.snapshot()).sessions[0]?.title).toBe("Bayes");
  });

  test("rejects an individually oversized valid record without changing the prior snapshot", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    const original = fixture();
    await store.replace(original);
    const oversized = structuredClone(original);
    oversized.sessions[0]!.messages.push(...Array.from({ length: 33 }, (_, index) => ({
      id: `large-message-${index}`,
      role: "assistant" as const,
      content: "x".repeat(65_536),
      createdAt: AT,
    })));

    await expect(store.replace(oversized)).rejects.toThrow("quota exceeded by record session-1");
    expect(await store.snapshot()).toEqual(original);
  });

  test("fails closed for corrupt indexed JSON and clears atomically", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    await store.replace(fixture());
    database.rows.get("session:session-1")!.payload_json = "{not json";
    await expect(store.snapshot()).rejects.toThrow("invalid JSON");

    await store.clear();
    expect(await store.snapshot()).toEqual({
      ...fixture(),
      sessions: [],
      usageEvents: [],
      feedbackEvents: [],
      topicEvidence: [],
      studyPriorities: [],
      benchmarks: [],
      evolutions: [],
      learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    });
  });

  test("journals a cross-store clear until the matching operation completes", async () => {
    const database = new MemoryDatabase();
    const store = new LearnerRecordStore(database, () => AT);
    await store.replace(fixture());
    const intent = { id: "clear-1", createdAt: AT };

    await store.beginClear(intent);
    await store.beginClear(intent);
    expect(await store.pendingClear()).toEqual(intent);
    await expect(store.beginClear({ id: "clear-2", createdAt: AT })).rejects.toThrow("already pending");

    await store.clear();
    expect(await store.pendingClear()).toEqual(intent);
    expect((await store.snapshot()).sessions).toHaveLength(0);
    await expect(store.completeClear("clear-2")).rejects.toThrow("does not match");
    await store.completeClear(intent.id);
    expect(await store.pendingClear()).toBeNull();
  });

  test("commits an OpenUI learner mutation and replay receipt atomically", async () => {
    const database = new MemoryDatabase();
    const records = new LearnerRecordStore(database, () => AT);
    const uiActions = new UiActionStore(database, () => AT);
    await records.replace(fixture());
    const { document, action } = uiFixture();
    let mutations = 0;
    const apply = (current: PortableLearnerData) => {
      mutations += 1;
      return {
        data: { ...current, learnerProfile: { ...current.learnerProfile, strengths: ["Bayes evidence"] } },
        resultingDocument: { ...document, revision: 1, lifecycle: "completed" as const, updatedAt: AT },
      };
    };

    const first = await uiActions.dispatch(action, document, apply);
    const replay = await uiActions.dispatch(action, document, apply);
    expect(replay).toEqual(first);
    expect(mutations).toBe(1);
    expect((await records.snapshot()).learnerProfile.strengths).toEqual(["Bayes evidence"]);
    const journal: UiActionJournal = await uiActions.getJournal(document.id);
    expect(journal.receipts).toHaveLength(1);
    expect(journal.receipts[0]?.state).toBe("completed");

    await expect(uiActions.dispatch({ ...action, answer: "A different action" }, document, apply))
      .rejects.toThrow("different action");
  });

  test("rolls back OpenUI state when its completion document is invalid", async () => {
    const database = new MemoryDatabase();
    const records = new LearnerRecordStore(database, () => AT);
    const uiActions = new UiActionStore(database, () => AT);
    await records.replace(fixture());
    const { document, action } = uiFixture();

    await expect(uiActions.dispatch(action, document, (current) => ({
      data: { ...current, learnerProfile: { ...current.learnerProfile, strengths: ["should roll back"] } },
      resultingDocument: { ...document, revision: 0 },
    }))).rejects.toThrow("invalid completion result");
    expect((await records.snapshot()).learnerProfile.strengths).toEqual([]);
    expect((await uiActions.getJournal(document.id)).receipts).toHaveLength(0);
  });
});
