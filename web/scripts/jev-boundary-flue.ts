import { createFlueClient } from "@flue/sdk";
import { createAssistantMessageEventStream, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
  estimatedRequestTokens, estimatedStateQuestionTokens, stateCharacterCount, type JudgementCaller,
  type JudgementRequest, type TeachingDraftSnapshot, type TeachingPolicyTurn,
} from "@keating/learner-contracts";
import { init, setProvider, useModel } from "../../spikes/flue-host/node_modules/@flue/runtime/dist/index.mjs";
import { start } from "../../spikes/flue-host/node_modules/@flue/runtime/dist/node/index.mjs";
import { createAgentRouter } from "../../spikes/flue-host/node_modules/@flue/runtime/dist/routing.mjs";
import { shouldRenderFlueMessage } from "../src/components/assistant-chat-messages";
import { toModelMessagesWithTime } from "../src/keating/flue/model-messages";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS } from "../src/keating/judgement-model";
import { withTeachingDraftGate } from "../src/keating/judgement/draft-gate";
import { parseReviewNotice } from "../src/keating/judgement/review-notice";
import { createWebJudgementRuntime } from "../src/keating/judgement/runtime";
import { correctAnswer, digest, REVIEW_MODEL, sha, studyPrompt, type CaseFixture } from "./jev-boundary-cases";
import { assistant, completedStream, type ProofModels } from "./jev-boundary-transport";

function checkedRequest(request: JudgementRequest, fixture: CaseFixture) {
  const state = request.state as { turn: TeachingPolicyTurn; reply?: { text: string }; candidates?: Record<string, { text: string }> };
  const history = state.turn.conversation.map(digest);
  const original = fixture.full.orderedMessageHashes;
  const droppedMessages = original.length - history.length;
  return { phase: state.candidates ? "selecting" : state.reply ? "checking" : "planning", requestHash: digest(request),
    questionHash: digest(request.questions), questionCount: Object.keys(request.questions).length,
    estimatedStateQuestionTokens: estimatedStateQuestionTokens(request), estimatedRequestTokens: estimatedRequestTokens(request),
    replyHash: state.reply ? sha(state.reply.text) : null,
    candidateHashes: Object.fromEntries(Object.entries(state.candidates ?? {}).map(([id, reply]) => [id, sha(reply.text)])),
    stateCharacters: stateCharacterCount(state), stateHash: digest(state), orderedMessageHashes: history,
    currentHash: sha(state.turn.learnerMessage), currentIntact: sha(state.turn.learnerMessage) === fixture.full.currentHash,
    droppedMessages, suffixInOrder: droppedMessages >= 0 && history.every((hash, index) => hash === original[index + droppedMessages]),
    prefixHashes: (state.turn.earlierLearnerExcerpts ?? []).map(sha) };
}

export async function runFlueCase(fixture: CaseFixture, engines: ProofModels) {
  const name = "jev-boundary-" + crypto.randomUUID();
  const requests: (ReturnType<typeof checkedRequest> & { sequence: number; attempt: number | null; ok: boolean | null; code: string | null;
    resolvedReviewer: string | null; choice: string | null })[] = [];
  const tutorResponses: { call: number; requestHash: string; textHash: string | null; stopReason: string | null; startedMs: number; finishedMs: number | null }[] = [];
  const pending = new Set<Promise<unknown>>();
  function tracked<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    return operation.finally(() => pending.delete(operation));
  }
  let receipt: TeachingDraftSnapshot | undefined;
  let progress: TeachingDraftSnapshot | undefined;
  let returned = "";
  const judge: JudgementCaller = async (request, signal) => {
    const entry: typeof requests[number] = { ...checkedRequest(request, fixture), sequence: requests.length + 1, attempt: progress?.stateHistory?.at(-1)?.attempt ?? null,
      ok: null, code: null, resolvedReviewer: null, choice: null };
    requests.push(entry);
    const outcome = await tracked(engines.judge(request, signal));
    entry.ok = outcome.ok;
    if (outcome.ok) {
      if (engines.mode === "live") entry.resolvedReviewer = outcome.response.backend.model;
      const choice = outcome.response.answers.draft_choice;
      if (choice?.type === "choice" && /^draft_\d+$/.test(choice.choice)) entry.choice = choice.choice;
    }
    else entry.code = outcome.error.code;
    return outcome;
  };
  const key = engines.reviewerKey ?? { backend: "system-one" as const, model: REVIEW_MODEL, calibrationSha256: null };
  const managed = key.model === "judgement" || key.model.startsWith("judgement-jev/");
  const baseRuntime = createWebJudgementRuntime({ settings: { ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, backend: "hosted",
    ...(managed ? {} : { hostedProvider: "typesafe", customModel: REVIEW_MODEL }) },
    hosted: { model: key.model, fetch: async () => { throw new Error("unconfigured-review-transport"); } } });
  const configured = baseRuntime.teachingTiers![0]!;
  const runtime = { ...baseRuntime, teachingTiers: [{ ...configured, key }],
    policy: { ...baseRuntime.policy, tiers: [{ key, call: judge }] } };
  const gate = withTeachingDraftGate(async (_model, context, options) => {
    const entry: typeof tutorResponses[number] = { call: tutorResponses.length + 1, requestHash: digest(context), stopReason: null, textHash: null,
      startedMs: performance.now(), finishedMs: null };
    tutorResponses.push(entry);
    const message = await tracked(engines.tutor(context, options));
    entry.finishedMs = performance.now();
    entry.stopReason = message.stopReason;
    entry.textHash = sha(message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n"));
    return completedStream(message);
  }, {
    // The proof measures the recorded paired-review protocol, not the app's focused default.
    triage: false, breadth: "broad", sessionId: name, basePrompt: () => studyPrompt, makeRuntime: () => runtime,
    maxAttempts: 3, timeoutMs: 180_000, maxReasoning: "off",
    onProgress: snapshot => { progress = snapshot; }, onReceipt: event => { receipt = event.snapshot; } });
  // Flue drives this bridge and consumes its reviewed stream. As in the web app, the browser-side gate owns
  // restored history and the actual tutor provider. Take the current message from Flue's dispatched transcript.
  const stream = (_model: unknown, transcript: { messages: readonly { role: string; content?: unknown }[] }, options?: SimpleStreamOptions) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const user = transcript.messages.findLast(message => message.role === "user");
      const current = typeof user?.content === "string" ? user.content : Array.isArray(user?.content)
        ? user.content.flatMap(part => part?.type === "text" ? [part.text] : []).join("\n") : "";
      if (sha(current) !== fixture.full.currentHash) throw new Error("flue-current-message-mismatch");
      const history: Context["messages"] = fixture.turn.conversation.map(({ role, content }, index) => role === "user"
        ? { role, content, timestamp: index + 1 } : assistant(content, engines.model, index + 1));
      const messages = toModelMessagesWithTime([...history, { role: "user", content: current, timestamp: history.length + 1 }], "UTC");
      const reviewed = await gate(engines.model, { messages, systemPrompt: studyPrompt, tools: [] }, { signal: options?.signal });
      for await (const event of reviewed) output.push(event);
      const terminal = await reviewed.result();
      returned = terminal.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
      output.end(terminal);
    })().catch(() => {
      const failure = { ...assistant("", engines.model), stopReason: "error" as const, errorMessage: "proof-flue-bridge-failed" };
      output.push({ type: "error", reason: "error", error: failure }); output.end(failure);
    });
    return output;
  };
  const provider = { id: name, name, auth: { apiKey: { name, resolve: async () => ({ auth: {} }) } },
    getModels: () => [{ ...engines.model, id: "teacher", provider: name }], stream, streamSimple: stream } as unknown as Parameters<typeof setProvider>[0];
  setProvider(provider);
  function Teacher() { useModel(name + "/teacher", { compaction: false }); return studyPrompt; }
  Teacher.agentName = name;
  const host = await start({ agents: [Teacher], providers: [provider], env: {} });
  try {
    const teacher = init(Teacher, { id: fixture.kind });
    const result = await teacher.read(await teacher.dispatch(fixture.turn.learnerMessage));
    const router = createAgentRouter(Teacher);
    const client = createFlueClient({ url: "http://local.invalid/" + fixture.kind, fetch: ((input, options) => router.request(input, options)) as typeof fetch });
    const history = await client.history();
    // A private alternative may finish after a timeout releases another. Settle its bounded transport receipt too.
    await Promise.allSettled([...pending]);
    const delivered = history.messages.filter(message => message.role === "assistant" && shouldRenderFlueMessage(message))
      .flatMap(message => message.parts).flatMap(part => part.type === "text" ? [part.text] : []).join("");
    const final = receipt ?? progress;
    const slides = (final?.slides ?? []).map(slide => ({ phase: slide.phase, attempt: slide.attempt, reason: slide.reason ?? null, turnsDropped: slide.turnsDropped,
      before: slide.before.estimatedStateQuestionTokens, after: slide.after?.estimatedStateQuestionTokens ?? null }));
    const plans = requests.filter(call => call.phase === "planning");
    const firstPlanSlide = slides.find(slide => slide.phase === "planning");
    const fullPlans = plans.filter(call => call.stateHash === fixture.full.stateHash);
    const rawPlanSize = fullPlans.length ? Math.max(...fullPlans.map(call => call.estimatedStateQuestionTokens)) : firstPlanSlide?.before ?? null;
    const visible = { textHash: sha(delivered), chars: delivered.length, correct: correctAnswer(delivered),
      notice: parseReviewNotice(delivered)?.kind ?? null, suggestsShorterRequest: /short(?:er|en)\b[^.!?]{0,60}\brequest\b/i.test(delivered) };
    const pair = tutorResponses.slice(0, 2);
    const openingHash = fixture.turn.conversation[0] ? sha(fixture.turn.conversation[0].content) : null;
    const bothReviewed = pair.length === 2 && pair.every(candidate => candidate.stopReason === "stop" && candidate.textHash &&
      requests.some(request => request.phase === "checking" && request.attempt === candidate.call && request.ok && request.replyHash === candidate.textHash));
    const selection = requests.find(request => request.phase === "selecting" && request.ok &&
      pair.every(candidate => request.candidateHashes["draft_" + candidate.call] === candidate.textHash) && request.choice === "draft_" + final?.selectedAttempt);
    const pinnedOverflow = fixture.kind === "current", wireOverflow = fixture.kind === "wire";
    const withheld = pinnedOverflow || wireOverflow;
    const untouchedUntilRejected = requests.every((call, index) => {
      if (call.droppedMessages === 0 && call.prefixHashes.length === 0) return true;
      return requests.slice(0, index).some(prior => prior.phase === call.phase && prior.attempt === call.attempt
        && prior.code === "context-limit-exceeded" && prior.droppedMessages === 0);
    });
    const checked = { expectedWireSize: wireOverflow ? fixture.full.stateCharacters === fixture.full.limits.stateCharacters + 1
        : fixture.full.stateCharacters < fixture.full.limits.stateCharacters,
      actualPlanningMatchesCalibration: wireOverflow ? plans.length === 0 : rawPlanSize === fixture.full.estimatedStateQuestionTokens,
      historyInOrder: requests.every(call => call.suffixInOrder && call.currentIntact),
      untouchedUntilRejected,
      planningBoundary: wireOverflow ? requests.length === 0 && tutorResponses.length === 0 && final?.reason === "request-invalid"
        : pinnedOverflow ? requests.length === 2 && fullPlans.length === 2 && fullPlans.every(call => call.code === "context-limit-exceeded")
          && fullPlans[0]!.questionCount > 1 && fullPlans[1]!.questionCount === 1 && final?.reason === "context-limit-exceeded"
        : fixture.kind === "dense" ? fullPlans.some(call => call.code === "context-limit-exceeded")
          && slides.some(slide => slide.reason === "provider-context-limit" && slide.turnsDropped > 0)
          && plans.some(call => call.ok && call.droppedMessages > 0 && call.prefixHashes[0] === openingHash)
        : fullPlans.some(call => call.ok) && plans.every(call => call.stateHash === fixture.full.stateHash && call.prefixHashes.length === 0),
      twoCandidatesReviewed: withheld ? tutorResponses.length === 0 : bothReviewed,
      selectedBetweenBoth: withheld ? !selection : Boolean(selection && final?.parallelAttempts?.length === 2),
      flueDeliveredReturnedMessage: delivered.length > 0 && delivered === returned && delivered === result.text,
      expectedOutcome: withheld ? final?.phase === "withheld" && visible.notice === "withheld" && (wireOverflow || visible.suggestsShorterRequest)
        : final?.phase === "released" && visible.correct && visible.notice === null && (final.selectedAttempt ?? 0) > 0,
    };
    return { case: fixture.kind, mode: engines.mode, full: fixture.full, rawPlanSize, requests, tutorResponses,
      final: final ? { phase: final.phase, reason: final.reason, judgeModel: final.judgeModel, parallelAttempts: final.parallelAttempts,
        selectedAttempt: final.selectedAttempt, attempts: final.attempts.map(attempt => ({ attempt: attempt.attempt, status: attempt.status,
          checks: attempt.checks.map(({ id, status, probability }) => ({ id, status, probability })) })), slides } : null,
      returned: { textHash: sha(returned), chars: returned.length }, flueReadHash: sha(result.text ?? ""), delivered: visible, checked,
      passed: Object.values(checked).every(Boolean) };
  } finally { await host.stop(); }
}
