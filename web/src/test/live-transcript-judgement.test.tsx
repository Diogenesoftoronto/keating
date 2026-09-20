import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import { JudgementDiagnostics } from "../components/JudgementDiagnostics";
import { appendLiveTranscript, emptyLiveTranscript } from "../keating/live-transcript";
import { createLiveTranscriptJudgementObserver } from "../keating/judgement/live-review";
import { configureJudgementDiagnostics, getJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { createJudgementOperationCaller } from "../keating/judgement/operation";
import { JUDGEMENT_MODEL_CHANGED_EVENT } from "../keating/judgement-model";

const key = { backend: "local" as const, model: "transcript-fixture", calibrationSha256: null };
const observers: Array<ReturnType<typeof createLiveTranscriptJudgementObserver>> = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.dispose();
  configureJudgementDiagnostics({ enabled: false, details: false, reviewLiveTranscripts: false, reviewReplies: false });
});
const settle = () => Bun.sleep(15);
const pair = (tutor = "Try drawing equal-sized parts.") => ({ turns: [], draft: { user: "Why are these fractions equal?", assistant: tutor } });
function fixture(deferred = false) {
  const requests: JudgementRequest[] = [];
  const signals: AbortSignal[] = [];
  const finish: Array<() => void> = [];
  const observer = createLiveTranscriptJudgementObserver("live-session", { debounceMs: 2,
    makeCaller: replyId => createJudgementOperationCaller({
      runtime: { settings: { backend: "local", localModelId: key.model, gatewayPath: "/api/judgement" },
        policy: { calibration: { entries: {} }, tiers: [{ key, call: (request, signal) => {
          requests.push(request); signals.push(signal!);
          const outcome: JudgementOutcome = { ok: true, response: { backend: key, answers: Object.fromEntries(
            Object.entries(request.questions).map(([id, question]) => {
              const labels = Object.keys(question.criteria ?? {});
              return [id, { type: "choice", choice: labels[0], confidence: 1,
                probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])) }];
            }),
          ) } };
          return deferred ? new Promise(resolve => finish.push(() => resolve(outcome))) : Promise.resolve(outcome);
        } }] } },
      diagnostics: { origin: "live-transcript-review", sessionId: "live-session", replyId },
      accept: () => true,
    }),
  });
  observers.push(observer);
  return { observer, requests, signals, finish };
}

test("live transcript review requires its own opt-in and both speakers", async () => {
  const { observer, requests } = fixture();
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  observer.update(pair());
  await settle();
  expect(requests).toHaveLength(0);
  configureJudgementDiagnostics({ reviewLiveTranscripts: true });
  observer.update({ turns: [], draft: { user: "My question", assistant: "" } });
  await settle();
  expect(requests).toHaveLength(0);
  observer.update(pair());
  await settle();
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]!.questions)).toEqual(["move", "need", "fit"]);
  expect(renderToStaticMarkup(<JudgementDiagnostics sessionId="live-session" />)).toContain("live-transcript-review");
  expect(getJudgementDiagnostics().events[0]?.evidence).toBeUndefined();
});

test("provider fragments coalesce, final markers deduplicate, repeated turns remain distinct", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
  const { observer, requests } = fixture();
  let transcript = appendLiveTranscript(emptyLiveTranscript(), "user", "email me at learner@example.com", true);
  observer.update(transcript);
  for (const text of ["Try ", "drawing ", "parts."]) {
    transcript = appendLiveTranscript(transcript, "assistant", text, false);
    observer.update(transcript);
  }
  const source = JSON.stringify(transcript);
  await settle();
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0]!.state)).not.toContain("learner@example.com");
  expect(JSON.stringify(requests[0]!.state)).toContain("Try drawing parts.");
  expect(JSON.stringify(transcript)).toBe(source);
  transcript = appendLiveTranscript(transcript, "assistant", "", true);
  observer.update(transcript);
  await settle();
  expect(requests).toHaveLength(1);
  observer.update({ turns: transcript.turns, draft: transcript.turns[0]! });
  await settle();
  expect(requests).toHaveLength(2);
});

test("new text cancels an in-flight review and rejects a noncooperative late result", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
  const { observer, requests, signals, finish } = fixture(true);
  observer.update(pair());
  await settle();
  expect(requests).toHaveLength(1);
  observer.update(pair("Actually, draw two rectangles first."));
  expect(signals[0]!.aborted).toBe(true);
  finish[0]!();
  await settle();
  expect(requests).toHaveLength(2);
  expect(getJudgementDiagnostics().events[0]).toMatchObject({ status: "failed" });
  expect(getJudgementDiagnostics().events[0]!.questions[0]!.probabilities).toBeUndefined();
  finish[1]!();
  await settle();
  expect(getJudgementDiagnostics().events[1]!.status).toBe("completed");
});

test("a new unpaired learner turn cancels old review rather than borrowing its tutor reply", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
  const { observer, requests, signals, finish } = fixture(true);
  observer.update({ turns: [pair().draft], draft: { user: "", assistant: "" } });
  await settle();
  observer.update({ turns: [pair().draft], draft: { user: "A new question", assistant: "" } });
  expect(signals[0]!.aborted).toBe(true);
  finish[0]!();
  await settle();
  expect(requests).toHaveLength(1);
});

test("revocation clears queued work immediately and disposing cancels active work", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
  const { observer, requests, signals, finish } = fixture(true);
  observer.update(pair());
  configureJudgementDiagnostics({ reviewLiveTranscripts: false });
  await settle();
  expect(requests).toHaveLength(0);
  configureJudgementDiagnostics({ reviewLiveTranscripts: true });
  observer.update(pair("Draw another rectangle."));
  await settle();
  observer.dispose();
  expect(signals[0]!.aborted).toBe(true);
  finish[0]!();
  observer.update(pair("Ignored after end."));
  await settle();
  expect(requests).toHaveLength(1);
});

test("model or calibration invalidation cancels a running transcript review", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  try {
    configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
    const { observer, requests, signals, finish } = fixture(true);
    observer.update(pair());
    await settle();
    window.dispatchEvent(new CustomEvent(JUDGEMENT_MODEL_CHANGED_EVENT));
    expect(signals[0]!.aborted).toBe(true);
    finish[0]!();
    await settle();
    expect(requests).toHaveLength(1);
    expect(getJudgementDiagnostics().events[0]!.status).toBe("failed");
    observer.dispose();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("the live connection abort owns review lifetime and inputs remain bounded", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewLiveTranscripts: true });
  const lifetime = new AbortController();
  const requests: JudgementRequest[] = [];
  let activeSignal: AbortSignal | undefined;
  const observer = createLiveTranscriptJudgementObserver("bounded-live", { signal: lifetime.signal, debounceMs: 2,
    makeCaller: () => async (request, signal) => {
      requests.push(request); activeSignal = signal;
      return { ok: false, error: { code: "backend-unavailable", retryable: false } };
    },
  });
  observers.push(observer);
  observer.update({ turns: [], draft: { user: "u".repeat(5000), assistant: "a".repeat(10000) } });
  await settle();
  expect(JSON.stringify(requests[0]!.state).length).toBeLessThan(9100);
  observer.update(pair());
  lifetime.abort();
  await settle();
  expect(requests).toHaveLength(1);
  expect(activeSignal).toBeDefined();
});
