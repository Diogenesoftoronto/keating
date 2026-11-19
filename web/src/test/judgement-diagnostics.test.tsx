import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgementBackendKey, JudgementCaller, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import { JudgementDiagnostics, MessageDiagnostics } from "../components/JudgementDiagnostics";
import { recordLearningDiagnostic } from "../keating/learning-intelligence/diagnostics";
import { beginTurn, finishTurn, noteTurnExtraction } from "../keating/judgement/turn-ledger";
import { beginDiagnosticReply, beginJudgementDiagnostic, clearJudgementDiagnostics, configureJudgementDiagnostics, endDiagnosticReply, getJudgementDiagnostics, observeJudgementCaller } from "../keating/judgement/diagnostics";
import { createJudgementOperationCaller } from "../keating/judgement/operation";
import { createReplyJudgementObserver } from "../keating/judgement/reply-review";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const local: JudgementBackendKey = { backend: "local", model: "local-v1", calibrationSha256: null };
const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-v1", calibrationSha256: null };
const privateText = "A learner's private misconception";
const request: JudgementRequest = { state: { learner: privateText, token: "sk-secretsecretsecret" }, questions: {
  fit: { type: "choice", instructions: privateText, criteria: { [privateText]: "private rubric", unknown: null } },
} };
const response = (backend = hosted): JudgementOutcome => ({ ok: true, response: { backend, usage: { inputTokens: 42, outputTokens: 3 },
  answers: { fit: { type: "choice", choice: privateText, confidence: .8, probabilities: { [privateText]: .8, unknown: .2 } } },
} });
const runtime = (tiers: WebJudgementRuntime["policy"]["tiers"], backend: "hosted" | "local" | "off" = "hosted"): WebJudgementRuntime => ({
  settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } },
});
afterEach(() => configureJudgementDiagnostics({ enabled: false, details: false, reviewReplies: false }));

test("default capture is off; ordinary judgements retain no diagnostic content", async () => {
  await createJudgementOperationCaller({ runtime: runtime([{ key: hosted, call: async () => response() }]), accept: () => true })(request);
  expect(getJudgementDiagnostics().events).toEqual([]);
  expect(renderToStaticMarkup(<JudgementDiagnostics />)).toBe("");
});

test("real fallback records backend, probabilities, usage and caller abstention without raw text", async () => {
  configureJudgementDiagnostics({ enabled: true });
  const call = createJudgementOperationCaller({ runtime: runtime([
    { key: local, call: async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }) },
    { key: hosted, call: async () => response() },
  ]), diagnostics: { origin: "prompt-evaluation", application: "Evaluation only; source unchanged" }, accept: () => false });
  expect((await call(request)).ok).toBe(false);
  const event = getJudgementDiagnostics().events[0]!;
  expect(event.status).toBe("abstained");
  expect(event.model).toBe("jev-v1");
  expect(event.questions[0]?.probabilities).toEqual([{ label: "option 1", value: .8 }, { label: "option 2", value: .2 }]);
  expect(event.questions[0]?.selected).toBe("option 1");
  expect(event.usage).toEqual({ inputTokens: 42, outputTokens: 3 });
  expect(event.reasons.join(" ")).toContain("Fallback");
  expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(event)).not.toContain(privateText);
  expect(JSON.stringify(event)).not.toContain("sk-secret");
});

test("details are explicit, bounded and redacted; revoking them erases earlier previews", () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  beginJudgementDiagnostic({ state: "email=owner@example.com Bearer abcsecret password=hidden " + "x".repeat(6000), questions: request.questions });
  const event = getJudgementDiagnostics().events[0]!;
  expect(event.questions[0]?.details).toContain(privateText);
  expect(event.evidence!.length).toBeLessThanOrEqual(1600);
  expect(event.evidence).not.toContain("owner@example.com");
  expect(event.evidence).not.toContain("abcsecret");
  expect(event.evidence).not.toContain("hidden");
  configureJudgementDiagnostics({ details: false });
  expect(getJudgementDiagnostics().events).toEqual([]);
  beginJudgementDiagnostic(request);
  expect(getJudgementDiagnostics().events[0]?.evidence).toBeUndefined();
  configureJudgementDiagnostics({ enabled: false });
  expect(getJudgementDiagnostics().events).toEqual([]);
});

test("a failed fallback cannot misattribute retained local numbers to hosted inference", async () => {
  configureJudgementDiagnostics({ enabled: true });
  await createJudgementOperationCaller({ runtime: runtime([
    { key: local, call: async () => response(local) },
    { key: hosted, call: async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }) },
  ]), accept: () => false })(request);
  const event = getJudgementDiagnostics().events[0]!;
  expect(event.model).toBe("jev-v1");
  expect(event.answerSource).toEqual({ backend: "local", model: "local-v1", calibration: null });
  expect(event.questions[0]?.probabilities?.[0]?.value).toBe(.8);
});

test("buffer is bounded; off and unavailable operations honestly abstain without dispatch", async () => {
  configureJudgementDiagnostics({ enabled: true });
  for (let index = 0; index < 70; index++) beginJudgementDiagnostic(request);
  expect(getJudgementDiagnostics().events.length).toBe(60);
  clearJudgementDiagnostics();
  let calls = 0;
  await createJudgementOperationCaller({ runtime: runtime([{ key: hosted, call: async () => { calls++; return response(); } }], "off"), accept: () => true })(request);
  expect(calls).toBe(0);
  expect(getJudgementDiagnostics().events[0]).toMatchObject({ status: "abstained", reasons: ["Judgement is off; no model called.", "backend-unavailable"] });
});

test("in-flight cancellation is terminal and cannot be overwritten by late provider results", async () => {
  configureJudgementDiagnostics({ enabled: true });
  let finish!: (outcome: JudgementOutcome) => void;
  const call = createJudgementOperationCaller({ runtime: runtime([{ key: hosted, call: () => new Promise(resolve => { finish = resolve; }) }]), accept: () => true });
  const controller = new AbortController();
  const pending = call(request, controller.signal);
  expect(getJudgementDiagnostics().events[0]?.status).toBe("running");
  controller.abort();
  expect(await pending).toMatchObject({ ok: false, error: { code: "cancelled" } });
  finish(response());
  await Promise.resolve(); await Promise.resolve();
  expect(getJudgementDiagnostics().events[0]).toMatchObject({ status: "failed", reasons: expect.arrayContaining(["cancelled"]) });
  expect(getJudgementDiagnostics().events[0]?.questions[0]?.probabilities).toBeUndefined();
});

test("runtime and operation capture deduplicate, then reused requests remain observable", async () => {
  configureJudgementDiagnostics({ enabled: true });
  const observed = observeJudgementCaller(async () => response(), hosted);
  await createJudgementOperationCaller({ runtime: runtime([{ key: hosted, call: observed }]), accept: () => true })(request);
  expect(getJudgementDiagnostics().events.length).toBe(1);
  await observed(request);
  expect(getJudgementDiagnostics().events.length).toBe(2);
  expect(getJudgementDiagnostics().events[1]?.origin).toBe("calibrated-router");
});

test("reply reviews are explicit, correlated, bounded text only, cancellable on next turn", async () => {
  configureJudgementDiagnostics({ enabled: true });
  const requests: JudgementRequest[] = [];
  const signals: AbortSignal[] = [];
  const ids: string[] = [];
  const observer = createReplyJudgementObserver("session-one", id => { ids.push(id); return async (input, signal) => {
    requests.push(input); signals.push(signal!); return response();
  }; });
  const messages = [{ role: "user", content: "owner@example.com wants a hint" }, { role: "toolResult", content: "SECRET TOOL CONTENT" },
    { role: "assistant", timestamp: 320, content: [{ type: "thinking", thinking: "SECRET REASONING" }, { type: "text", text: "Try the first step " + "x".repeat(7000) }] }];
  observer.start(); observer.finish(messages);
  expect(requests).toEqual([]);
  configureJudgementDiagnostics({ reviewReplies: true });
  observer.start(); observer.finish(messages);
  expect(requests.length).toBe(1);
  expect(Object.keys(requests[0]!.questions)).toEqual(["move", "need", "fit"]);
  expect(JSON.stringify(requests[0]!.state)).not.toContain("SECRET");
  expect(JSON.stringify(requests[0]!.state)).not.toContain("owner@example.com");
  expect((requests[0]!.state as { tutor: string }).tutor.length).toBeLessThanOrEqual(6000);
  expect(getJudgementDiagnostics().replies.at(-1)?.id).toBe(ids[0]);
  expect(getJudgementDiagnostics().replies.at(-1)?.assistantTimestamp).toBe(320);
  expect(signals[0]?.aborted).toBe(false);
  observer.start(); expect(signals[0]?.aborted).toBe(true);
  observer.finish([...messages, { role: "assistant", content: "Interrupted", stopReason: "aborted" }]);
  expect(requests.length).toBe(1);
  observer.start(messages.length); observer.finish(messages);
  expect(requests.length).toBe(1);
  observer.dispose();
});

test("inline diagnostics stay collapsed and belong to the specific message and session", () => {
  const sessionId = "inline-session";
  const messages = [{ role: "user", timestamp: 100 }, { role: "assistant", timestamp: 200 }];
  configureJudgementDiagnostics({ enabled: true });
  beginTurn(sessionId, messages.slice(0, 1));
  finishTurn(sessionId, messages);
  noteTurnExtraction(sessionId, 100, { role: "learner", status: "failed", items: [], reasons: ["Learner extraction failed"] });
  const replyId = beginDiagnosticReply(sessionId);
  endDiagnosticReply(replyId, false, 200);
  beginJudgementDiagnostic(request, { origin: "reply-review", sessionId, replyId });
  recordLearningDiagnostic({ kind: "extraction", status: "unavailable", sessionId, messageId: "tutor-200", reasons: ["Extraction account unavailable"] });
  recordLearningDiagnostic({ kind: "forecast", status: "failed", sessionId: "other-session", messageId: "tutor-200", reasons: ["Unrelated forecast"] });
  recordLearningDiagnostic({ kind: "forecast", status: "failed", sessionId, reasons: ["Unscoped forecast"] });

  const tutor = renderToStaticMarkup(<MessageDiagnostics role="tutor" sessionId={sessionId} sourceIds={["tutor-200"]} timestamps={[200]} />);
  expect(tutor).toContain("Extraction unavailable");
  expect(tutor).toMatch(/<p[^>]*>Extraction account unavailable<\/p>/);
  expect(tutor).toContain("Open Diagnostics settings");
  expect(tutor).toContain("Raw judgement calls · 1");
  expect(tutor.match(/^<details[^>]*>/)?.[0]).not.toContain(" open=");
  expect(tutor).toMatch(/<details open=""><summary[^>]*>extraction · unavailable/);
  expect(tutor).toContain(`Session: ${sessionId}\nReplies: ${replyId}`);
  expect(tutor).toContain('aria-label="Copy IDs"');
  expect(tutor).not.toContain("Learner extraction failed");
  expect(tutor).not.toContain("Unrelated forecast");
  expect(tutor).not.toContain("Unscoped forecast");
  const learner = renderToStaticMarkup(<MessageDiagnostics role="learner" sessionId={sessionId} timestamps={[100]} />);
  expect(learner).toContain("Learner extraction failed");
  expect(learner).not.toContain("Extracted from this message");
  expect(learner).not.toContain("Raw judgement calls");
  expect(renderToStaticMarkup(<MessageDiagnostics role="tutor" sessionId={sessionId} timestamps={[201]} />)).toBe("");
  configureJudgementDiagnostics({ enabled: false });
  expect(renderToStaticMarkup(<MessageDiagnostics role="tutor" sessionId={sessionId} sourceIds={["tutor-200"]} timestamps={[200]} />)).toBe("");
});

test("turning capture off aborts background review and prevents hidden late capture", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  let signal: AbortSignal | undefined;
  let finish!: (outcome: JudgementOutcome) => void;
  const observer = createReplyJudgementObserver("session", replyId => createJudgementOperationCaller({
    runtime: runtime([{ key: hosted, call: async (_request, abort) => { signal = abort; return new Promise(resolve => { finish = resolve; }); } }]),
    diagnostics: { origin: "completed-reply-review", sessionId: "session", replyId }, accept: () => true,
  }));
  observer.start(); observer.finish([{ role: "user", content: "Question" }, { role: "assistant", content: "Reply" }]);
  configureJudgementDiagnostics({ enabled: false });
  expect(signal?.aborted).toBe(true);
  finish(response()); await Promise.resolve(); await Promise.resolve();
  expect(getJudgementDiagnostics().events).toEqual([]);
  observer.dispose();
});

test("UI identifies unjudged replies, developer-only controls and inspectable real results", async () => {
  configureJudgementDiagnostics({ enabled: true });
  const replyId = beginDiagnosticReply("session-one")!;
  let html = renderToStaticMarkup(<JudgementDiagnostics sessionId="session-one" />);
  expect(html).toContain("No judgement ran for this reply.");
  expect(html).toContain("streaming");
  endDiagnosticReply(replyId);
  await createJudgementOperationCaller({ runtime: runtime([{ key: hosted, call: async () => response() }]), diagnostics: {
    origin: "completed-reply-review", sessionId: "session-one", replyId, application: "Developer review only; no learner state changed.",
  }, accept: () => true })(request);
  html = renderToStaticMarkup(<JudgementDiagnostics controls sessionId="session-one" />);
  expect(html).toContain("1 judgement call for");
  expect(html).toContain("Review completed replies");
  expect(html).toContain("jev-v1");
  expect(html).toContain("0.8000");
  expect(html).toContain("Developer review only");
  expect(html).not.toContain(privateText);
  expect(html).toContain("meter");
});
