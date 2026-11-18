import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runTeachingDrafts, blocksRelease } from "../src/judgement/teaching-drafts.js";
import { followsSingleFeedbackQuestion, teachingPolicyDecisionRequest, teachingPolicyState } from "../src/judgement/teaching-policy.js";
import type { TeachingPolicyCheck, TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import { teachingDraftAnswers, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const previous = "A wheel has six equal sectors, four red and two blue. Which color is more likely on one spin?";
const turn: TeachingPolicyTurn = { ...teachingDraftTurn, learnerMessage: "Red, since four sectors are red.",
  conversation: [{ role: "user", content: "Let me predict the wheel color." }, { role: "assistant", content: previous }] };
const positive = { checkpoint_attempt_state: "answered", checkpoint_feedback_support: "grounded_confirmation" };
const raw = { checkpoint_answer_leaked: .84, checkpoint_continued: .62 };
const model = { id: "fixture-v1", requestTokens: 64000, stateQuestionTokens: 32000 };

async function exercise(actual: TeachingPolicyTurn, text: string, scores: Record<string, number | string>, options: {
  toolCalls?: TeachingPolicyReply["toolCalls"]; host?: TeachingPolicyCheck; missing?: string; omitDecision?: boolean; smallWindow?: boolean;
} = {}) {
  const requests: JudgementRequest[] = [];
  const judge: JudgementCaller = async request => {
    requests.push(request);
    if (options.omitDecision) return { ok: false, error: { code: "request-invalid", retryable: false } };
    const answers = teachingDraftAnswers(request, request.questions.learning_task ? { learning_task: .99, attempt_present: .99, learner_response_due: .99 } : scores);
    if (options.missing) delete answers[options.missing];
    return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
  };
  const result = await runTeachingDrafts({ turn: actual, judge, judgementModel: options.smallWindow ? { ...model, stateQuestionTokens: 12000 } : model,
    maxAttempts: 1, generate: async () => ({ reply: { text, toolCalls: options.toolCalls ?? [] }, value: text }), check: () => options.host ? [options.host] : [] });
  return { result, attempt: result.receipt.attempts[0], review: requests.find(r => r.questions.quality_scope) };
}

test("full historical tile candidate reached the old gate on these exact bytes and only its two conditional rules blocked", async () => {
  const archive = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/addendum/", import.meta.url);
  const read = (name: string) => JSON.parse(readFileSync(new URL(name, archive), "utf8"));
  const old = read("receipts/tile-bag-confirm--minimax--jev.json");
  const saved = read("ledger.json").entries.find((entry: {id:string}) => entry.id === old.id + "/review/3");
  expect(createHash("sha256").update(JSON.stringify(saved.request)).digest("hex")).toBe("c0ae3be2c386b3e16c02aea157fbeef3f05db1f586069d89e8cb0908d0c180c5");
  const { turn: original, reply } = saved.request.state;
  expect(old.policy).toBe("keating-teaching-policy/v2.3.5");
  expect(old.disposition).toBe("withheld");
  expect(old.attempts[2].checks.filter(blocksRelease).map((c: TeachingPolicyCheck) => [c.id,c.probability])).toEqual(Object.entries(raw));
  const { result, attempt, review } = await exercise(original, reply.text, { ...raw, ...positive });
  expect(review?.state).toEqual(saved.request.state);
  expect(result.status).toBe("released");
  expect(attempt?.attemptedCheckpointFeedback?.feedback?.choice).toBe("grounded_confirmation");
  expect(attempt?.checks.filter(c => c.applicability).map(c => [c.id,c.probability,c.status])).toEqual([
    ["checkpoint_answer_leaked", .84, "fail"], ["checkpoint_continued", .62, "fail"]]);
  expect(result.value).toBe(reply.text);
});

test("a wrong attempted answer can receive an accurate grounded correction, without a grading call", async () => {
  const wrong = { ...turn, learnerMessage: "Blue, since there are two blue sectors." };
  const text = "Red is more likely. Four of the six equal sectors are red; two are blue.";
  const { result, attempt } = await exercise(wrong, text, { ...raw, ...positive, checkpoint_feedback_support: "grounded_correction" });
  expect(result.status).toBe("released");
  expect(result.value).toBe(text);
  expect(attempt?.checks.filter(c => c.applicability)).toHaveLength(2);
  expect(wrong.availableTools).toEqual([]);
});

test("false confirmation, unsupported correction, invented grade and an unanswered new item cannot enter through best effort", async () => {
  const wrong = { ...turn, learnerMessage: "Blue is more likely." };
  for (const text of ["Exactly, blue is more likely.", "Actually green is certain.", "Correct; your grade is now recorded.",
    "On a second spin which color is certain? It must be red."]) {
    const { result, attempt } = await exercise(wrong, text, { ...positive, checkpoint_feedback_support: "unsupported" });
    expect(result.status).toBe("withheld");
    expect(attempt?.checks.find(c => c.id === "checkpoint_feedback_unsupported")?.status).toBe("fail");
    expect(attempt?.checks.some(c => c.applicability)).toBe(false);
  }
});

test("a hint may leave the item open; an explicit request to keep thinking defeats even conflicting positive scope answers", async () => {
  const waiting = { ...turn, learnerMessage: "I'm still thinking. Don't tell me yet." };
  expect((await exercise(waiting, "Take your time.", { checkpoint_attempt_state: "open", checkpoint_feedback_support: "other" })).result.status).toBe("released");
  for (const answers of [positive, { ...positive, checkpoint_attempt_state: "open" },
    { ...positive, checkpoint_attempt_state: "unrelated" }, { ...positive, checkpoint_feedback_support: "uncertain" }]) {
    const { result, attempt } = await exercise(waiting, "Red is more likely.", answers);
    expect(result.status).toBe("withheld");
    expect(attempt?.checks.some(c => c.applicability)).toBe(false);
  }
  const { result, attempt } = await exercise(turn, "Which shape comes next? A circle.", { ...positive, ...raw });
  expect(result.status).toBe("withheld");
  expect(attempt?.checks.some(c => c.applicability)).toBe(false);
});

test("an unobserved, weak or incompatible decision, contradictory independent check or host failure cannot scope a checkpoint", async () => {
  const host: TeachingPolicyCheck = { id: "runtime_tool_schema", source: "deterministic", severity: "critical", status: "fail", probability: 1 };
  for (const item of [{ scores: { ...raw, ...positive }, options: { missing: "checkpoint_attempt_state" } },
    { scores: { ...raw, ...positive }, options: { missing: "checkpoint_feedback_support" } },
    { scores: { ...raw, ...positive, checkpoint_attempt_state: "uncertain" }, options: {} },
    { scores: { ...positive, gap_ignored: .81 }, options: {} },
    { scores: { ...positive, mastery_overclaimed: .92 }, options: {} },
    { scores: { ...positive }, options: { host } }]) {
    const { result, attempt } = await exercise(turn, "Red is more likely.", item.scores as Record<string, string | number>, item.options);
    expect(result.status).toBe("withheld");
    expect(attempt?.checks.some(c => c.applicability)).toBe(false);
  }
  const { result } = await exercise(turn, "Red is more likely.", positive, { omitDecision: true });
  expect(result.status).toBe("withheld"); expect(result.receipt.attempts).toHaveLength(0);
});

test("multipart, interrupted or quoted context, pending/assessed work, and nontext tutor drafts stay on the ordinary gate", async () => {
  const groups = "```openui\nroot = LearningSurface([q], \"Answer both\")\nq = Question([{header:\"One\", question:\"Which color?\", type:\"text\"}, {header:\"Two\",question:\"Which shape?\",type:\"text\"}])\n```";
  const prev = (content: string): TeachingPolicyTurn => ({ ...turn, conversation: [turn.conversation[0]!, { role: "assistant", content }] });
  for (const actual of [prev(groups),prev("Which color? And which shape?"), { ...turn, learnerMessage: "“My friend said red.”" },
    { ...turn, conversation: [...turn.conversation, { role: "tool" as const, content: "unrelated" }] },
    { ...turn, assessment: "assessed" as const }, { ...turn, assessment: "practice" as const },
    { ...turn, pendingSubmissions: [{ kind: "comprehension" as const, id: "s", questionIds: ["q"] }] },
    { ...turn, activeWork: { plan: null, focus: null, truncated: true, openInteractions: [] } },
    { ...turn, learnerEvidence: [{ kind: "pending-quiz", content: "Awaiting a grade" }] }]) {
    expect(followsSingleFeedbackQuestion(actual)).toBe(false);
    const { result, attempt } = await exercise(actual, "Red.", { ...raw, ...positive });
    expect(result.status).toBe("withheld");
    expect(attempt?.attemptedCheckpointFeedback).toBeUndefined();
  }
  const originalDue = teachingPolicyDecisionRequest(teachingDraftTurn).questions.learner_response_due;
  expect(teachingPolicyDecisionRequest(turn).questions.learner_response_due?.instructions).toContain("AFTER their latest message");
  expect(originalDue?.instructions).not.toContain("AFTER their latest message");
  const oldHistory = { ...turn, conversation: [{ role: "user" as const, content: "earlier ".repeat(24000) }, ...turn.conversation] };
  const trimmed = await exercise(oldHistory, "Red.", { ...raw, ...positive }, { smallWindow: true });
  expect(trimmed.result.receipt.slides?.length).toBeGreaterThan(0);
  expect(trimmed.attempt?.attemptedCheckpointFeedback).toBeUndefined();
  for (const [text, toolCalls] of [[groups, []], ["I graded your quiz.", [{ name: "grade_quiz", arguments: { result_id: "fake" } }]]] as const) {
    const res = await exercise(turn, text, { ...raw, ...positive }, { toolCalls });
    expect(res.attempt?.attemptedCheckpointFeedback).toBeUndefined();
    expect(res.result.status).toBe("withheld");
  }
});

test("a typed answer can refer to the sole still-mounted preceding Question without submitting or grading its card", async () => {
  const base = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/addendum/", import.meta.url);
  const old = JSON.parse(readFileSync(new URL("ledger.json",base),"utf8")).entries.find((r:{id:string})=>r.id==="tile-bag-confirm--minimax--jev/review/3");
  const unlinked:TeachingPolicyTurn = old.request.state.turn;
  const file = readFileSync(new URL("../../../classroom/final-prediction/typed-active-work.json",base));
  expect(createHash("sha256").update(file).digest("hex")).toBe("78b238cc38c822aefa48f072cb1a3ad8f7bc4d3219ad907db56d1707d09da24c");
  const observed = JSON.parse(file.toString());
  expect(observed.beforeTyping).toEqual(observed.afterTyping);
  expect(observed).toMatchObject({afterTyping:{pendingSubmissions:0},questionSubmits:0,followupDispatches:0});
  const record = {...observed.afterTyping.openInteractions[0],presentedAt:1,itemId:null};
  const link = {assistantTurnIndex:1,documentId:record.documentId,nodeId:record.nodeId};
  const work = {plan:null,focus:null,truncated:false,openInteractions:[record]};
  const actual:TeachingPolicyTurn = {...unlinked,activeWork:work,previousQuestionPresentation:link};
  expect(followsSingleFeedbackQuestion(actual)).toBe(true);
  const timeNote = "[Keating time note: sent Friday, August 12, 2022 at 2:04 PM EDT; 45 minutes after the previous message.]\n";
  expect(followsSingleFeedbackQuestion({...actual,learnerMessage:timeNote+actual.learnerMessage})).toBe(true);
  expect(followsSingleFeedbackQuestion({...actual,learnerMessage:timeNote})).toBe(false);
  const result = await exercise(actual,old.request.state.reply.text,{...raw,...positive});
  expect(result.result.status).toBe("released");
  expect(result.review?.state).toHaveProperty("turn.previousQuestionPresentation",link);
  expect(result.review?.questions.checkpoint_attempt_state?.instructions).toContain("Awaiting refers to a form submission");
  expect(result.attempt?.attemptedCheckpointFeedback?.attempt?.choice).toBe("answered");
  expect(actual.activeWork?.openInteractions[0]?.state).toBe("awaiting");
  expect(actual.pendingSubmissions).toBeUndefined();
  expect(teachingPolicyState(unlinked)).not.toHaveProperty("turn.previousQuestionPresentation");
  const advanced:TeachingPolicyTurn = {...actual,conversation:[...actual.conversation,{role:"user",content:"What about a wheel?"},{role:"assistant",content:previous}]};
  for (const other of [
    {...actual,previousQuestionPresentation:undefined}, {...actual,previousQuestionPresentation:{...link,documentId:"other-session"}},
    {...actual,previousQuestionPresentation:{...link,nodeId:"another-node"}}, {...actual,previousQuestionPresentation:{...link,assistantTurnIndex:0}},
    {...actual,activeWork:{...work,openInteractions:[{...record,component:"quiz"}]}},
    {...actual,activeWork:{...work,openInteractions:[{...record,state:"graded" as const}]}},
    {...actual,activeWork:{...work,openInteractions:[{...record,state:"pending-grade" as const}]}},
    {...actual,activeWork:{...work,openInteractions:[record,{...record,nodeId:"second",documentId:"another"}]}},
    {...actual,pendingSubmissions:[{kind:"comprehension" as const,id:"real",questionIds:["question-1"]}]}, advanced,
  ]) {
    expect(followsSingleFeedbackQuestion(other)).toBe(false);
    const held = await exercise(other,old.request.state.reply.text,{...raw,...positive});
    expect(held.result.status).toBe("withheld");
    expect(held.attempt?.attemptedCheckpointFeedback).toBeUndefined();
  }
});
