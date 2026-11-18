import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { requestedCodePracticeLanguage } from "../src/judgement/code-practice-language.js";
import { teachingPolicyDeterministicChecks } from "../src/judgement/teaching-policy.js";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const learnerMessage = "My Python loop skips the last item nearly every time. Give me a tiny broken loop I can fix and try against a couple of example inputs.";
const turn = { ...teachingDraftTurn, learnerMessage };
const fence = (language: string, code: string) => ["```" + language, code, "```"].join("\n");
const python = fence("python", "def visit(values):\n    for value in values[:-1]:\n        print(value)\n\nvisit([3, 8])");
const question = fence("openui", 'root = LearningSurface([q], "Check your fix")\nq = Question([{question: "What change did you make to visit every item?", type: "text"}], "ephemeral", "Your fix")');
const recording = JSON.parse(readFileSync(new URL("../../../docs/benchmarks/openui-audit-2026-11-18/evidence/gemini-3.1-flash-lite--code.json", import.meta.url), "utf8"));
const archivedDraft: string = recording.drafts[0].response.text;
const languageCheck = (request: string, text: string) => teachingPolicyDeterministicChecks({ ...turn, learnerMessage: request }, { text, toolCalls: [] })
  .find(check => check.id === "exercise_language_preserved");

test("binds a language only for an explicitly named single-language exercise the learner wants to perform", () => {
  expect(requestedCodePracticeLanguage(learnerMessage)).toBe("python");
  expect(requestedCodePracticeLanguage("Let me debug this TypeScript function.")).toBe("typescript");
  expect(requestedCodePracticeLanguage("Give me a JS loop to fix.")).toBe("javascript");
  for (const prompt of [
    'My colleague wrote "Let me fix a Python loop." Explain what the quotation means.',
    '> Give me a Python loop I can fix.\nTell me how to phrase the request.',
    "Compare Python and JavaScript loops. Let me run a JavaScript example.",
    "I can fix my Python loop. Translate this one into JS.",
    'I want to edit a Monty Python script for our play.', 'What makes the python a constrictor?',
    'What does a Python loop do? Give a direct definition.',
    'I want to debug some code. Choose a suitable language.',
    'Explain this log from my computer.\n' + fence("text", "Let me repair the Python script."),
  ]) expect(requestedCodePracticeLanguage(prompt)).toBeNull();
});

test("uses executable challenge and fenced code languages; quoted suggestions and comparisons alone do not fail the reply", () => {
  expect(recording.selection).toBe(1);
  expect(recording.publicText).toBe("<!--keating:review=unverified-->\n" + archivedDraft);
  expect(recording.publicText).toContain('"javascript"');
  expect(languageCheck(learnerMessage, recording.publicText)).toMatchObject({ source: "deterministic", status: "fail" });
  expect(languageCheck(learnerMessage, python + "\n" + recording.publicText)?.status).toBe("fail");
  expect(languageCheck(learnerMessage, fence("ts", "export const total = 2"))?.status).toBe("fail");
  expect(languageCheck(learnerMessage, python + "\n" + question)?.status).toBe("pass");
  expect(languageCheck(learnerMessage, python + "\n" + fence("js", "let comparison = 1"))?.status).toBe("pass");
  expect(languageCheck(learnerMessage, 'You may have seen a CodingChallenge("javascript") before.')).toBeUndefined();
  expect(languageCheck("Let me compare a Python loop to JavaScript.", recording.publicText)).toBeUndefined();
  expect(languageCheck("Give me a JavaScript loop to fix.", recording.publicText)?.status).toBe("pass");
});

test("the normal tutor gate repairs the archived language substitution and releases an editable Python exercise", async () => {
  const judge = makeTeachingDraftJudge(() => ({ learning_task: .98, executable_code: .98, hands_on_requested: .98 }));
  const repair: string[] = [];
  const result = await runTeachingDrafts({ turn, judge, maxAttempts: 2, generate: async input => {
    if (input.attempt === 2) repair.push(...input.feedback.map(check => check.instruction));
    const text = input.attempt === 1 ? archivedDraft : python + "\n" + question;
    return { reply: { text, toolCalls: [] }, value: text };
  } });
  expect(result.receipt.attempts[0]?.checks).toContainEqual({ id: "exercise_language_preserved", source: "deterministic", severity: "major", status: "fail", probability: 1 });
  expect(repair.join(" ")).toContain("fenced python code block");
  expect(result).toMatchObject({ status: "released", receipt: { selectedAttempt: 2 } });
  expect(result.reply!.text).toBe(python + "\n" + question);
  const exhausted = await runTeachingDrafts({ turn, judge, maxAttempts: 1, generate: async () => ({ reply: { text: archivedDraft, toolCalls: [] }, value: null }) });
  expect(exhausted.status).toBe("withheld");
});
