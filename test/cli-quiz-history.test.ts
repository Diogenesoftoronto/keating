import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENUI_JSON_PARITY_FIXTURE, type UiAction, type UiDocument } from "@keating/learner-contracts";
import { loadCommittedTuiQuizHistory, saveCommittedTuiQuizHistory } from "../src/judgement/cli-quiz-history.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import { UiActionJournalStore } from "../src/tui/ui/journal.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function document(): UiDocument {
  const doc = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  doc.nodes = [{ type: "quiz", id: "quiz", title: "Bayes", questions: [
    { id: "item", kind: "multiple_choice", prompt: "Before evidence?", choices: [{ id: "prior", label: "Prior" }, { id: "posterior", label: "Posterior" }], correctAnswer: "prior" },
  ] }]; return doc;
}
function action(doc = document(), answer = "prior"): Extract<UiAction, { type: "complete-quiz" }> {
  return { schemaVersion: 1, type: "complete-quiz", documentId: doc.id, documentRevision: doc.revision, nodeId: "quiz", resultId: "result",
    answers: [{ questionId: "item", answer }], score: 1, partialCreditPoints: 1, partialCredits: { item: 1 },
    timing: { totalMs: 10, perQuestionMs: { item: 10 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [], idempotencyKey: "submit" };
}
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-quiz-history-")); directories.push(cwd);
  const journal = new FileUiActionJournalStorage(cwd);
  let time = Date.now() - 1000;
  const dispatcher = new UiActionJournalStore({ storage: journal, now: () => new Date(time++).toISOString(), dispatcher: {
    dispatch: async (input, doc) => ({ schemaVersion: 1, documentId: doc.id, sourceRevision: doc.revision,
      actionIdempotencyKey: input.idempotencyKey, status: "completed", documentLifecycle: "completed",
      resultingDocument: { ...doc, revision: doc.revision + 1, lifecycle: "completed", nodes: [
        { type: "callout", id: "result", tone: "check", title: "Quiz submitted", markdown: "Objective score: 1/1" },
      ] } }),
  } });
  return { cwd, journal, dispatcher, setTime: (value: number) => { time = value; } };
}

test("completed terminal work bootstraps prior history without any prediction or legacy grading record", async () => {
  const { cwd, dispatcher } = await setup(); const doc = document(); const input = action(doc, "posterior");
  expect(await saveCommittedTuiQuizHistory(cwd, input, doc)).toBe(0);
  expect((await dispatcher.dispatch(input, doc)).ok).toBe(true);
  expect(await saveCommittedTuiQuizHistory(cwd, input, doc)).toBe(1);
  const loaded = await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now());
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({ question: "Before evidence?", answer: "posterior", correct: false });
  expect(loaded[0]!.source).toContain("hints and outside help unknown");
  expect(await saveCommittedTuiQuizHistory(cwd, input, doc)).toBe(0);
  expect(await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now())).toEqual(loaded);
  const directory = join(cwd, ".keating/state/tui-quiz-history");
  expect((await stat(join(directory, (await readdir(directory))[0]!))).mode & 0o777).toBe(0o600);
});

test("history excludes current cutoff, expired work and unrelated topic", async () => {
  const { cwd, dispatcher } = await setup(); const doc = document(); const input = action(doc);
  await dispatcher.dispatch(input, doc); await saveCommittedTuiQuizHistory(cwd, input, doc);
  const history = await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now());
  expect(await loadCommittedTuiQuizHistory(cwd, "Bayes", history[0]!.assessedAt)).toEqual([]);
  expect(await loadCommittedTuiQuizHistory(cwd, "Bayes", history[0]!.assessedAt + 91 * 86_400_000)).toEqual([]);
  expect(await loadCommittedTuiQuizHistory(cwd, "Linear algebra", Date.now())).toEqual([]);
});

test("uncommitted, changed action, blank and pending work cannot become historical objective outcomes", async () => {
  for (const kind of ["blank", "pending", "changed"] as const) {
    const { cwd, dispatcher } = await setup(); const doc = document(); const input = action(doc, kind === "blank" ? "" : "prior");
    if (kind === "pending") { input.pendingGradeQuestionIds = ["item"]; input.partialCredits = {}; input.partialCreditPoints = 0; input.score = 0; }
    await dispatcher.dispatch(input, doc);
    if (kind === "changed") input.answers[0]!.answer = "posterior";
    expect(await saveCommittedTuiQuizHistory(cwd, input, doc)).toBe(0);
    expect(await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now())).toEqual([]);
  }
});

test("saved source tampering and removed completion receipt fail closed on read", async () => {
  for (const kind of ["source", "journal"] as const) {
    const { cwd, dispatcher, journal } = await setup(); const doc = document(); const input = action(doc);
    await dispatcher.dispatch(input, doc); await saveCommittedTuiQuizHistory(cwd, input, doc);
    if (kind === "source") {
      const dir = join(cwd, ".keating/state/tui-quiz-history"); const path = join(dir, (await readdir(dir))[0]!);
      const value = JSON.parse(await readFile(path, "utf8")); value.records[0].sourceDocument.nodes[0].questions[0].correctAnswer = "posterior";
      await writeFile(path, JSON.stringify(value));
    } else {
      const value = (await journal.load(doc.id))!; value.receipts = []; await journal.save(value);
    }
    await expect(loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now())).rejects.toThrow("quiz_history_invalid");
  }
});

test("symlink history files are rejected and receipt chronology cannot be refreshed by replay", async () => {
  const { cwd, dispatcher, journal } = await setup(); const doc = document(); const input = action(doc);
  await dispatcher.dispatch(input, doc); await saveCommittedTuiQuizHistory(cwd, input, doc);
  const original = (await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now()))[0]!;
  const saved = (await journal.load(doc.id))!; saved.receipts[0]!.updatedAt = new Date(original.assessedAt + 10).toISOString(); await journal.save(saved);
  await expect(loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now())).rejects.toThrow("quiz_history_invalid");
  const dir = join(cwd, ".keating/state/tui-quiz-history"); const path = join(dir, (await readdir(dir))[0]!);
  const target = join(cwd, "redirect.json"); await writeFile(target, await readFile(path)); await rm(path); await symlink(target, path);
  await expect(loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now())).rejects.toThrow();
});

test("concurrent duplicate collection stays idempotent and history returns only twelve newest items", async () => {
  const { cwd, dispatcher } = await setup(); const doc = document();
  const node = doc.nodes[0]!; if (node.type !== "quiz") throw new Error("fixture");
  const question = node.questions[0]!;
  node.questions = Array.from({ length: 15 }, (_, index) => ({ ...question, id: `item-${index}` }));
  const input = action(doc);
  input.answers = node.questions.map(question => ({ questionId: question.id, answer: "prior" }));
  input.partialCredits = Object.fromEntries(node.questions.map(question => [question.id, 1]));
  input.partialCreditPoints = 15;
  input.timing.perQuestionMs = Object.fromEntries(node.questions.map(question => [question.id, 1]));
  expect((await dispatcher.dispatch(input, doc)).ok).toBe(true);
  expect((await Promise.all([saveCommittedTuiQuizHistory(cwd, input, doc), saveCommittedTuiQuizHistory(cwd, input, doc)])).sort((a, b) => a - b)).toEqual([0, 15]);
  const history = await loadCommittedTuiQuizHistory(cwd, "Bayes", Date.now());
  expect(history).toHaveLength(12); expect(new Set(history.map(row => row.id)).size).toBe(12);
});
