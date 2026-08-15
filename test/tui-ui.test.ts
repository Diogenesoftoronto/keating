import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENUI_JSON_PARITY_FIXTURE,
  UI_ACTION_JOURNAL_KIND,
  canonicalUiAction,
  type UiAction,
  type UiActionJournal,
  type UiActionResult,
  type UiDocument,
} from "@keating/learner-contracts";

import {
  UiActionJournalStore,
  FileUiActionJournalStorage,
  adaptToolResultToUiDocument,
  adaptUiDocument,
  uiDocumentPresentation,
  uiNodePresentation,
  tuiUiActionJournalDir,
} from "../src/tui/ui/index.js";

const NOW = "2026-08-11T00:00:00.000Z";

function document(): UiDocument {
  const value = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  if (!value.nodes.some((node) => node.type === "question-group" && node.id === "group")) {
    value.nodes.splice(5, 0, {
      type: "question-group",
      id: "group",
      title: "Diagnostic",
      questions: [{ id: "group-question", kind: "text", prompt: "Explain the prior." }],
    });
  }
  return value;
}

function actionBase(source = document()): Pick<UiAction, "schemaVersion" | "documentId" | "documentRevision"> {
  return { schemaVersion: 1, documentId: source.id, documentRevision: source.revision };
}

function actions(source = document()): UiAction[] {
  const base = actionBase(source);
  return [
    { ...base, type: "submit-answer", nodeId: "question-text", answer: "Evidence changes belief.", idempotencyKey: "answer" },
    { ...base, type: "choose-option", nodeId: "question-choice", optionIds: ["evidence"], idempotencyKey: "choice" },
    { ...base, type: "submit-question-group", nodeId: "group", responses: [{ questionId: "group-question", type: "text", answer: "Belief before evidence." }], idempotencyKey: "group" },
    { ...base, type: "complete-quiz", nodeId: "quiz", resultId: "quiz-result", answers: [{ questionId: "quiz-question", answer: "prior" }], score: 1, partialCreditPoints: 1, partialCredits: { "quiz-question": 1 }, timing: { totalMs: 1, perQuestionMs: { "quiz-question": 1 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [], idempotencyKey: "quiz" },
    { ...base, type: "complete-goal-step", nodeId: "goal", stepId: "goal-step", idempotencyKey: "goal" },
    { ...base, type: "complete-plan-item", nodeId: "study-plan", itemId: "plan-foundation", completed: true, idempotencyKey: "plan" },
    { ...base, type: "update-notes", nodeId: "notes", value: "Evidence changes the prior.", idempotencyKey: "notes" },
    { ...base, type: "rate-card", nodeId: "deck", cardId: "card", rating: 3, idempotencyKey: "rate" },
    { ...base, type: "complete-deck", nodeId: "deck", ratings: [{ cardId: "card", rating: 3, appliedIntervalDays: 2, easeAfter: 2.5 }], summary: { reviewed: 1, lapses: 0 }, idempotencyKey: "deck" },
    { ...base, type: "save-artifact", nodeId: "artifact", idempotencyKey: "artifact" },
    { ...base, type: "open-handoff", nodeId: "handoff", idempotencyKey: "handoff" },
  ];
}

describe("shared terminal UI document adapter and presentation", () => {
  test("accepts the full current versioned fixture and presents every canonical node safely", () => {
    const adapted = adaptUiDocument(JSON.stringify(OPENUI_JSON_PARITY_FIXTURE));
    expect(adapted).toMatchObject({ ok: true, source: "canonical" });
    if (!adapted.ok) return;
    const presentation = uiDocumentPresentation(adapted.document);
    const output = presentation.body.join("\n");
    const nodeHeadings = OPENUI_JSON_PARITY_FIXTURE.nodes.map((node) => uiNodePresentation(node).heading);
    expect(nodeHeadings).toEqual([
      "Explanation", "WARNING: Check the claim", "Question", "Question", "Question",
      "Grouped retrieval", "Quiz: Retrieval check", "Goal: Explain Bayesian updating", "Deck: Bayes cards", "Bayes plan",
      "Artifact", "Bayes map", "Notes: Learner notes", "Image: Update diagram",
      "Audio: Bayes narration", "Video: Bayes video", "Animation: Bayes animation", "Continue on web",
    ]);
    for (const heading of nodeHeadings) expect(output).toContain(`— ${heading} —`);
    expect(output).toContain("Mermaid source (not executed in terminal):");
    expect(output).toContain("https://example.com/bayes.mp3");
    expect(output).toContain("Handoff target: web");
  });

  test("imports legacy keating.ui tool results and recovers malformed or browser-program input without evaluation", () => {
    const legacy = adaptToolResultToUiDocument("quiz", {
      protocol: "keating.ui", version: 1, id: "legacy-quiz", revision: 0, kind: "quiz",
      payload: { topic: "Bayes", questions: [{ prompt: "What is a prior?" }] },
    });
    expect(legacy).toMatchObject({ ok: true, source: "legacy" });
    const openUi = adaptUiDocument('root = LearningSurface([explanation], "Terminal")\nexplanation = Explanation("Safe source")');
    expect(openUi).toMatchObject({ ok: true, document: { title: "Terminal", supportedSurfaces: expect.arrayContaining(["terminal"]) } });
    expect(adaptUiDocument("root = Question([])")).toMatchObject({ ok: false, recovery: { preserveEnteredWork: true } });
    expect(adaptUiDocument("{")).toMatchObject({ ok: false, recovery: { code: "invalid_json", retryable: true } });
    expect(adaptUiDocument({ schemaVersion: 1, nodes: [] })).toMatchObject({ ok: false, recovery: { code: "invalid_document" } });
  });

  test("preserves real tool artifact paths and legacy multiple-choice semantics", () => {
    const plan = adaptToolResultToUiDocument("plan", { details: { topic: "Bayes", planPath: "/tmp/bayes.md" } });
    expect(plan).toMatchObject({ ok: true, document: { nodes: [{ type: "artifact", resource: { content: "Local artifact: /tmp/bayes.md" } }] } });
    const quiz = adaptToolResultToUiDocument("quiz", { details: { topic: "Bayes", questions: [{ prompt: "Prior?", options: ["Before", "After"] }] } });
    expect(quiz).toMatchObject({ ok: true, document: { nodes: [{ type: "quiz", questions: [{ choices: [{ label: "Before" }, { label: "After" }] }] }] } });
  });
});

describe("durable shared UI action journal", () => {
  test("validates all practical action families, preserves retry work, and returns completed revision/lifecycle results", async () => {
    const source = document();
    const journals = new Map<string, UiActionJournal>();
    const calls: UiAction[] = [];
    const store = new UiActionJournalStore({
      storage: {
        async load(id) { return journals.get(id); },
        async save(journal) { journals.set(journal.documentId, structuredClone(journal)); },
      },
      dispatcher: {
        async dispatch(action, input) {
          calls.push(action);
          const resultingDocument = structuredClone(input);
          resultingDocument.revision += 1;
          resultingDocument.lifecycle = "completed";
          resultingDocument.updatedAt = "2026-08-11T00:01:00.000Z";
          return {
            schemaVersion: 1, documentId: action.documentId, sourceRevision: action.documentRevision,
            actionIdempotencyKey: action.idempotencyKey, status: "completed", documentLifecycle: "completed", resultingDocument,
          };
        },
      },
      now: () => NOW,
    });
    for (const action of actions(source)) {
      const outcome = await store.dispatch(action, source);
      expect(outcome).toMatchObject({ ok: true, replayed: false, result: { status: "completed", documentLifecycle: "completed", resultingDocument: { revision: 1 } } });
    }
    expect(calls).toHaveLength(actions(source).length);

    const failed = structuredClone(source);
    failed.lifecycle = "failed";
    const retry: UiAction = { ...actionBase(failed), type: "retry", idempotencyKey: "retry" };
    const retryOutcome = await store.dispatch(retry, failed);
    expect(retryOutcome).toMatchObject({ ok: true, result: { status: "completed" } });
  });

  test("replays an exact receipt and turns key reuse with changed work into a recoverable conflict", async () => {
    const source = document();
    const journals = new Map<string, UiActionJournal>();
    let callCount = 0;
    const dispatcher = {
      async dispatch(action: UiAction, input: UiDocument): Promise<UiActionResult> {
        callCount++;
        const resultingDocument = structuredClone(input);
        resultingDocument.revision += 1;
        resultingDocument.lifecycle = "completed";
        resultingDocument.updatedAt = "2026-08-11T00:01:00.000Z";
        return { schemaVersion: 1, documentId: input.id, sourceRevision: input.revision, actionIdempotencyKey: action.idempotencyKey, status: "completed", documentLifecycle: "completed", resultingDocument };
      },
    };
    const store = new UiActionJournalStore({
      storage: { async load(id) { return journals.get(id); }, async save(journal) { journals.set(journal.documentId, structuredClone(journal)); } },
      dispatcher,
      now: () => NOW,
    });
    const original = actions(source)[0]!;
    const first = await store.dispatch(original, source);
    expect(first).toMatchObject({ ok: true, replayed: false, result: { status: "completed" } });
    const laterRevision = first.ok ? first.result.resultingDocument! : source;
    expect(await store.dispatch(structuredClone(original), laterRevision)).toMatchObject({ ok: true, replayed: true, result: { status: "completed" } });
    expect(callCount).toBe(1);
    const conflict = await store.dispatch({ ...original, answer: "Different answer" }, source);
    expect(conflict).toMatchObject({ ok: false, recovery: { code: "idempotency_conflict", preserveEnteredWork: true } });
  });

  test("resumes an exact durable pending receipt after restart, then replays its final result", async () => {
    const source = document();
    const original = actions(source)[0]!;
    const pending: UiActionJournal = {
      kind: UI_ACTION_JOURNAL_KIND,
      schemaVersion: 1,
      documentId: source.id,
      receipts: [{
        schemaVersion: 1,
        action: structuredClone(original),
        actionFingerprint: canonicalUiAction(original),
        state: "pending",
        createdAt: NOW,
        updatedAt: NOW,
      }],
    };
    const journals = new Map([[source.id, structuredClone(pending)]]);
    let callCount = 0;
    const storage = {
      async load(id: string) { return journals.get(id); },
      async save(journal: UiActionJournal) { journals.set(journal.documentId, structuredClone(journal)); },
    };
    const dispatcher = {
      async dispatch(action: UiAction, input: UiDocument): Promise<UiActionResult> {
        callCount++;
        const resultingDocument = structuredClone(input);
        resultingDocument.revision += 1;
        resultingDocument.lifecycle = "completed";
        resultingDocument.updatedAt = "2026-08-11T00:01:00.000Z";
        return {
          schemaVersion: 1,
          documentId: input.id,
          sourceRevision: input.revision,
          actionIdempotencyKey: action.idempotencyKey,
          status: "completed",
          documentLifecycle: "completed",
          resultingDocument,
        };
      },
    };

    const restarted = new UiActionJournalStore({ storage, dispatcher, now: () => NOW });
    expect(await restarted.dispatch(original, source)).toMatchObject({ ok: true, replayed: false, result: { status: "completed" } });
    expect(callCount).toBe(1);

    const restartedAgain = new UiActionJournalStore({ storage, dispatcher, now: () => NOW });
    expect(await restartedAgain.dispatch(original, source)).toMatchObject({ ok: true, replayed: true, result: { status: "completed" } });
    expect(callCount).toBe(1);
  });

  test("re-dispatches an exact retryable receipt, then durably replays the accepted result", async () => {
    const source = document();
    const journals = new Map<string, UiActionJournal>();
    let calls = 0;
    const store = new UiActionJournalStore({
      storage: {
        async load(id) { return journals.get(id) ? structuredClone(journals.get(id)!) : undefined; },
        async save(journal) { journals.set(journal.documentId, structuredClone(journal)); },
      },
      dispatcher: {
        async dispatch(action, input): Promise<UiActionResult> {
          calls += 1;
          return calls === 1
            ? { schemaVersion: 1, documentId: input.id, sourceRevision: input.revision, actionIdempotencyKey: action.idempotencyKey, status: "retryable", documentLifecycle: input.lifecycle, retryAfterMs: 0 }
            : { schemaVersion: 1, documentId: input.id, sourceRevision: input.revision, actionIdempotencyKey: action.idempotencyKey, status: "accepted", documentLifecycle: input.lifecycle };
        },
      },
      now: () => NOW,
    });
    const action = actions(source)[0]!;
    expect(await store.dispatch(action, source)).toMatchObject({ ok: true, replayed: false, result: { status: "retryable" } });
    expect(await store.dispatch(structuredClone(action), source)).toMatchObject({ ok: true, replayed: false, result: { status: "accepted" } });
    expect(await store.dispatch(structuredClone(action), source)).toMatchObject({ ok: true, replayed: true, result: { status: "accepted" } });
    expect(calls).toBe(2);
  });

  test("returns recovery rather than dropping invalid or stale entered work", async () => {
    const source = document();
    const store = new UiActionJournalStore({
      storage: { async load() { return undefined; }, async save() {} },
      dispatcher: { async dispatch() { throw new Error("not reached"); } },
      now: () => NOW,
    });
    const stale = { ...actions(source)[0]!, documentRevision: 99 };
    expect(await store.dispatch(stale, source)).toMatchObject({ ok: false, recovery: { code: "stale_document", preserveEnteredWork: true } });
  });

  test("serializes sibling actions for one document without losing either receipt", async () => {
    const source = document();
    const journals = new Map<string, UiActionJournal>();
    let active = 0;
    let maxActive = 0;
    const store = new UiActionJournalStore({
      storage: {
        async load(id) { return journals.get(id) ? structuredClone(journals.get(id)!) : undefined; },
        async save(journal) { journals.set(journal.documentId, structuredClone(journal)); },
      },
      dispatcher: {
        async dispatch(action, input): Promise<UiActionResult> {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return {
            schemaVersion: 1,
            documentId: input.id,
            sourceRevision: input.revision,
            actionIdempotencyKey: action.idempotencyKey,
            status: "accepted",
            documentLifecycle: input.lifecycle,
          };
        },
      },
      now: () => NOW,
    });

    const [first, second] = actions(source);
    const outcomes = await Promise.all([store.dispatch(first!, source), store.dispatch(second!, source)]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(maxActive).toBe(1);
    expect(journals.get(source.id)?.receipts.map((receipt) => receipt.action.idempotencyKey)).toEqual(["answer", "choice"]);
  });

  test("surfaces storage failures as recoverable outcomes before delivery", async () => {
    const source = document();
    let calls = 0;
    const action = actions(source)[0]!;
    const unreadable = new UiActionJournalStore({
      storage: { async load() { throw new Error("disk unavailable"); }, async save() {} },
      dispatcher: { async dispatch() { calls += 1; throw new Error("not reached"); } },
    });
    expect(await unreadable.dispatch(action, source)).toMatchObject({
      ok: false,
      recovery: { code: "dispatch_failed", retryable: true, preserveEnteredWork: true },
    });

    const unwritable = new UiActionJournalStore({
      storage: { async load() { return undefined; }, async save() { throw new Error("disk full"); } },
      dispatcher: { async dispatch() { calls += 1; throw new Error("not reached"); } },
    });
    expect(await unwritable.dispatch(action, source)).toMatchObject({
      ok: false,
      recovery: { code: "dispatch_failed", retryable: true, preserveEnteredWork: true },
    });
    expect(calls).toBe(0);
  });

  test("persists owner-only receipts atomically and replays them after a process restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-journal-"));
    try {
      const source = document();
      const action = actions(source)[0]!;
      let calls = 0;
      const dispatcher = {
        async dispatch(current: UiAction, input: UiDocument): Promise<UiActionResult> {
          calls += 1;
          return {
            schemaVersion: 1,
            documentId: input.id,
            sourceRevision: input.revision,
            actionIdempotencyKey: current.idempotencyKey,
            status: "accepted",
            documentLifecycle: input.lifecycle,
          };
        },
      };
      const first = new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), dispatcher, now: () => NOW });
      expect(await first.dispatch(action, source)).toMatchObject({ ok: true, replayed: false, result: { status: "accepted" } });

      const restarted = new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), dispatcher, now: () => NOW });
      expect(await restarted.dispatch(structuredClone(action), source)).toMatchObject({ ok: true, replayed: true, result: { status: "accepted" } });
      expect(calls).toBe(1);

      const directory = tuiUiActionJournalDir(cwd);
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
      if (process.platform !== "win32") {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("serializes two filesystem store instances across the complete dispatch transaction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-journal-race-"));
    try {
      const source = document();
      let active = 0;
      let maxActive = 0;
      const dispatcher = {
        async dispatch(current: UiAction, input: UiDocument): Promise<UiActionResult> {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return {
            schemaVersion: 1,
            documentId: input.id,
            sourceRevision: input.revision,
            actionIdempotencyKey: current.idempotencyKey,
            status: "accepted",
            documentLifecycle: input.lifecycle,
          };
        },
      };
      const firstStore = new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), dispatcher, now: () => NOW });
      const secondStore = new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), dispatcher, now: () => NOW });
      const [first, second] = actions(source);

      const outcomes = await Promise.all([firstStore.dispatch(first!, source), secondStore.dispatch(second!, source)]);
      expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
      expect(maxActive).toBe(1);
      const journal = await new FileUiActionJournalStorage(cwd).load(source.id);
      expect(journal?.receipts.map((receipt) => receipt.action.idempotencyKey).sort()).toEqual(["answer", "choice"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("tightens pre-existing directory permissions and rejects symlinked journals", async () => {
    if (process.platform === "win32") return;
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-journal-safety-"));
    try {
      const directory = tuiUiActionJournalDir(cwd);
      await mkdir(directory, { recursive: true, mode: 0o777 });
      await chmod(directory, 0o777);
      const storage = new FileUiActionJournalStorage(cwd);
      expect(await storage.load(document().id)).toBeUndefined();
      expect((await stat(directory)).mode & 0o777).toBe(0o700);

      const victim = join(cwd, "victim.json");
      await writeFile(victim, "{}", { mode: 0o600 });
      const expectedName = `${createHash("sha256").update(document().id).digest("hex")}.json`;
      const journalPath = join(directory, expectedName);
      await symlink(victim, journalPath);
      await expect(storage.load(document().id)).rejects.toThrow();
      expect((await lstat(journalPath)).isSymbolicLink()).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
