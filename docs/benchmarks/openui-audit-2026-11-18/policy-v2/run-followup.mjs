// From this checkout: rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2/run-followup.mjs
// Prints the frozen request plan by default. --execute uses TypeSafe once per row.
// Set KEATING_AUDIT_RELEASE to a checkout of cohort.oldRelease to verify the source turn hashes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { runTeachingDrafts } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { blocksRelease, reasoningQuestions, standardQuestion } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest, TEACHING_POLICY_VERSION, trimTrailingCheckpointProse } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { encodeSystemOneRequest } from "../../../../packages/learner-contracts/src/judgement/wire.ts";
import { INTERACTION_FEATURE_CASES } from "../../../../packages/learner-contracts/test/fixtures/interaction-features/cases.ts";

const here = import.meta.dir;
const audit = resolve(here, "..");
const root = resolve(audit, "../../..");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const wireHash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const save = (path, value) => {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(path + ".tmp", path);
};
const check = (condition, message) => { if (!condition) throw Error(message); };
const cohort = read(join(here, "cohort.json"));
const scenarios = read(join(audit, "scenarios.json"));
const historical = read(join(root, "scripts/training/benchmarks/teaching-v2/cases.json")).cases;
const model = "jev-1.14.0";
const endpoint = "https://api.typesafe.ai/v1/systemone";
const noReview = { ok: false, error: { code: "backend-unavailable", retryable: false } };
const followupLimitUsd = 0.25, studyLimitUsd = 2, priorUpperUsd = 0.8315, reserveUsd = 0.003;
const pricePerMillionInput = 0.042;
const ledgerPath = join(here, "ledger.json");
const evidencePath = join(here, "evidence.json");
const sourceFiles = [
  "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts", "packages/learner-contracts/src/judgement/interaction-affordances.ts",
  "packages/learner-contracts/src/judgement/teaching-policy.ts", "packages/learner-contracts/src/judgement/teaching-drafts/session.ts",
  "packages/learner-contracts/src/judgement/teaching-drafts/policy.ts",
];
const sourceHashes = Object.fromEntries(sourceFiles.map(p => [p, wireHash(readFileSync(join(root, p), "utf8"))]));
const release = process.env.KEATING_AUDIT_RELEASE;
if (release) {
  const rev = Bun.spawnSync(["rtk", "proxy", "git", "-C", release, "rev-parse", "HEAD"]);
  check(rev.exitCode === 0 && rev.stdout.toString().trim() === cohort.oldRelease, "Wrong historical checkout");
}
const oldPolicy = release && await import(join(release, sourceFiles[2]));
const oldDraft = release && await import(join(release, sourceFiles[4]));
const baseTurn = messages => ({
  learnerMessage: messages.at(-1).content, conversation: messages.slice(0, -1), learnerEvidence: [],
  availableTools: cohort.historicalToolNames, toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown",
});
function planningRequest(turn, policy = { teachingPolicyDecisionRequest }, draft = { reasoningQuestions, standardQuestion }) {
  const request = policy.teachingPolicyDecisionRequest(turn);
  return { ...request, questions: { ...request.questions, ...Object.fromEntries(draft.reasoningQuestions.map(q => [q.id, q.question])), draft_standard: draft.standardQuestion } };
}

async function runSavedGate(test, judge) {
  let reviews = 0;
  const result = await runTeachingDrafts({
    turn: test.turn, maxAttempts: 1, maxReasoning: "off", refinement: "ordinary",
    judgementModel: { id: "jev-latest", requestTokens: 64000, stateQuestionTokens: 32000 },
    judge: async (request, signal) => {
      if (request.questions.learning_task) return { ok: true, response: {
        backend: { backend: "system-one", model: test.plan.model, calibrationSha256: null }, answers: test.plan.answers,
      } };
      check(request.questions.quality_progress && ++reviews === 1, "Unexpected second review or selector");
      check(request.state.reply.text === test.trimmed.text && !request.state.reply.toolCalls.length, "The review must see the exact trimmed candidate");
      return judge(request, signal);
    },
    // Every enrolled candidate has zero calls. This is the exact pass branch of the web tool-schema check.
    check: reply => [{ id: "runtime_tool_schema", source: "deterministic", severity: "critical", status: reply.toolCalls.length ? "fail" : "pass", probability: reply.toolCalls.length ? 1 : 0 }],
    generate: async () => ({ reply: test.raw, value: test.rawSha256 }),
  });
  check(reviews === 1 && result.receipt.attempts[0]?.trimmedCheckpointSuffix, "The gated replay did not review a repaired checkpoint");
  if (result.reply) check(result.reply.text === test.trimmed.text, "Released text differs from reviewed candidate");
  return result;
}

const jobs = [];
for (const [file, attempt] of cohort.reviewCandidates) {
  const saved = read(join(audit, "evidence", file + ".json"));
  const scenario = scenarios.find(s => s.id === saved.scenario);
  const generated = saved.drafts.find(d => d.attempt === attempt).response;
  const original = saved.checks.find(d => d.attempt === attempt);
  const plan = saved.judge.find(j => j.phase === "plan" && j.answers);
  check(plan?.model === model && !generated.errorClass && !generated.toolNames.length, "Unexpected historical candidate");
  check(original.checks.some(c => c.id === "stop_after_checkpoint" && c.status === "fail"), "Candidate was not suffix blocked");
  const turn = baseTurn([{ role: "user", content: scenario.prompt }]);
  if (release) check(wireHash(planningRequest(turn, oldPolicy, oldDraft)) === plan.hash, "Reconstructed state disagrees with original planning request");
  const raw = { text: generated.text, toolCalls: [] };
  const test = { turn, raw, rawSha256: wireHash(raw.text), trimmed: trimTrailingCheckpointProse(raw), plan };
  check(test.trimmed, "Candidate no longer qualifies for structural repair");
  let request;
  await runSavedGate(test, async req => { request = req; return noReview; });
  jobs.push({ id: file + "/" + attempt, kind: "review", request, detail: {
    originalReceipt: "../evidence/" + file + ".json", originalAttempt: attempt,
    originalPlanningRequestSha256: plan.hash, originalStateHashVerified: !!release, originalDraftSha256: test.rawSha256,
    trimmedSha256: wireHash(test.trimmed.text), originalLeak: original.checks.find(c => c.id === "checkpoint_answer_leaked") ?? null,
  }, assess: async outcome => {
    const result = await runSavedGate(test, async req => { check(wireHash(req) === wireHash(request), "Gate payload changed"); return outcome; });
    const a = result.receipt.attempts[0];
    return { gate: result.status, review: a.status, reason: result.receipt.reason, selected: result.receipt.selectedAttempt,
      leak: a.checks.find(c => c.id === "checkpoint_answer_leaked"), checks: a.checks.filter(c => c.status !== "pass"),
      publishedTextHashInReplay: result.reply ? wireHash(result.reply.text) : null };
  } });
}
for (const c of cohort.planningCases) {
  const ref = c.source === "teaching-v2" ? historical.find(x => x.id === c.id) : INTERACTION_FEATURE_CASES.find(x => x.id === c.id);
  check(ref, "Historical planning case missing");
  const turn = ref.messages ? baseTurn(ref.messages) : baseTurn([...ref.turn.conversation, { role: "user", content: ref.turn.learnerMessage }]);
  jobs.push({ id: c.id, kind: "planning", request: planningRequest(turn), detail: { fixture: c.source, expected: c.expected }, assess: async outcome => {
    if (!outcome.ok) return { action: null, offered: null, match: null, signalMatches: null };
    const plan = projectTeachingPolicyDecision(turn, outcome);
    const offered = plan.interaction.families.flatMap(f => f.components);
    const match = c.expected.component === null ? plan.interaction.action === "none" : offered.includes(c.expected.component);
    const signalMatches = Object.fromEntries(Object.entries(c.expected.signals).map(([id, expected]) => [id, (plan.decisions[id] ?? plan.features[id]) === expected]));
    return { action: plan.interaction.action, offered, match, signalMatches };
  } });
}
check(TEACHING_POLICY_VERSION === "keating-teaching-policy/v2" && jobs.length === 15, "Unexpected study design");
const payloadFor = job => encodeSystemOneRequest(job.request, model);
const manifest = jobs.map(job => ({ id: job.id, kind: job.kind, requestSha256: wireHash(payloadFor(job)), bytes: Buffer.byteLength(JSON.stringify(payloadFor(job))) }));
check(manifest.every(r => r.bytes < 60_000) && new Set(manifest.map(x => x.requestSha256)).size === manifest.length, "Unexpected or duplicate payload");
const inputsHash = wireHash(manifest);
if (process.argv.includes("--verify")) {
  // Rebuild every wire envelope and release decision from the observed answers.
  // No credential or network operation is available in this branch.
  const e = read(evidencePath), l = read(ledgerPath);
  check(e.rows.length === jobs.length && l.entries.length === jobs.length && e.inputsHash === inputsHash
    && wireHash(e.sourceHashes) === wireHash(sourceHashes), "Evidence or policy changed");
  const reviews = [], plans = [];
  for (const job of jobs) {
    const row = e.rows.find(r => r.id === job.id);
    const entry = l.entries.find(en => en.id === job.id);
    const payload = payloadFor(job);
    check(entry && entry.requestSha256 === row.requestSha256 && wireHash(payload) === row.requestSha256
      && wireHash(payload.state) === wireHash(row.state) && wireHash(payload.questions) === wireHash(e.questionSets[row.questionSet]), "Request metadata mismatch");
    const outcome = row.model ? { ok: true, response: { backend: { backend: "system-one", model: row.model, calibrationSha256: null },
      answers: Object.fromEntries(Object.entries(row.answers).map(([id, answer]) => [id, typeof answer === "number" ? { type: "noul", noul: answer } : answer])),
      usage: entry.usage } } : { ok: false, error: { code: row.error, retryable: false } };
    const replay = await job.assess(outcome);
    check(wireHash(replay) === wireHash(row.result), "Offline assessment no longer matches evidence");
    if (job.kind === "review") reviews.push({ id: job.id, gate: replay.gate, leakProbability: replay.leak.probability,
      blocking: replay.checks.filter(blocksRelease).map(c => ({ id: c.id, status: c.status, probability: c.probability })) });
    else plans.push({ id: job.id, target: job.detail.expected.component, offered: replay.offered, match: replay.match,
      signalMatches: replay.signalMatches, probabilities: Object.fromEntries([...new Set(["plain_reply_requested", "learner_response_due", "hands_on_requested",
        ...Object.keys(job.detail.expected.signals)])].map(id => [id, row.answers?.[id] ?? null])) });
  }
  const accepted = reviews.filter(r => r.gate === "released");
  const controls = plans.filter(r => r.target === null);
  const cost = l.entries.reduce((sum, x) => sum + x.accountedUsd, 0);
  const summary = { study: "Blind Jev review of archived candidates under Keating teaching policy v2",
    dateUtc: l.entries[0].startedAt.slice(0, 10), policy: e.policy, modelIds: [...new Set(e.rows.map(r => r.model))],
    manifestSha256: inputsHash, calls: l.entries.length, tutorCalls: 0,
    reviews: { structurallyAdmissible: reviews.length, verifiedReleasesInReplay: accepted.length,
      withheld: reviews.filter(r => r.gate === "withheld").length,
      distinctHistoricalTurns: new Set(reviews.map(r => r.id.split("/")[0])).size,
      turnsWithAnApprovedCandidate: new Set(accepted.map(r => r.id.split("/")[0])).size,
      primaryAccepted: accepted.filter(r => !r.id.includes("--repeat-")).length, primaryReviewed: reviews.filter(r => !r.id.includes("--repeat-")).length,
      repeatAccepted: accepted.filter(r => r.id.includes("--repeat-")).length, repeatReviewed: reviews.filter(r => r.id.includes("--repeat-")).length, details: reviews },
    planning: { matches: plans.filter(p => p.match).length, cases: plans.length,
      requestedActivitiesOffered: plans.filter(p => p.target !== null && p.match).length, activityCases: plans.length - controls.length,
      noOfferOnTextControls: controls.filter(p => p.match).length, textControls: controls.length,
      allExpectedSignalsMatched: plans.filter(p => p.signalMatches && Object.values(p.signalMatches).every(Boolean)).length,
      definition: "A positive match includes the expected component among the offers. A text control requires no offer. No tutor received these offers.", details: plans },
    accounting: { providerInputTokens: l.entries.reduce((sum, x) => sum + (x.usage?.inputTokens ?? 0), 0),
      providerOutputTokens: l.entries.reduce((sum, x) => sum + (x.usage?.outputTokens ?? 0), 0),
      missingUsageCalls: l.entries.filter(x => !x.measured).length, followupListPriceUsd: +cost.toFixed(9), followupLimitUsd,
      priorAccountedUsd: l.priorAccountedUsd, cumulativeAccountedUsd: +(l.priorAccountedUsd + cost).toFixed(9), studyLimitUsd,
      priceSource: l.priceSource, amountBasis: "Provider-reported input tokens times published list price; output is free. Earlier study accounting includes reservations on unknown usage." },
    scope: "The nine inputs span six historical turns and were selected because each previously failed the suffix rule. They are not independent draws from production. The gate used frozen planning answers and fresh blind semantic reviews of the actual trimmed text. The six selected planning probes predate this change. No tutor generated a new response, and no learner saw these replays." };
  save(join(here, "summary.json"), summary);
  console.log(JSON.stringify({ verified: jobs.length, released: accepted.length, planningMatches: summary.planning.matches, usd: summary.accounting.followupListPriceUsd }));
  process.exit(0);
}
if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify({ mode: "dry-run", count: manifest.length, inputsHash, maxAllCallsUsd: reserveUsd * jobs.length, manifest }, null, 2));
  process.exit(0);
}
if (!process.argv.includes("--locked")) {
  const locked = Bun.spawnSync(["rtk", "proxy", "flock", "-n", "-E", "75",
    join(root, ".keating/benchmarks/openui-audit-2026-11-18/.budget.lock"), process.execPath, import.meta.path, "--execute", "--locked"],
    { env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(locked.exitCode ?? 1);
}
const priorAccountedUsd = read(join(audit, "evidence/budget.json")).reduce((sum, c) => sum + c.accountedUsd, 0);
check(priorAccountedUsd <= priorUpperUsd, "Previous study accounting changed");
const ledger = existsSync(ledgerPath) ? read(ledgerPath) : { inputsHash, model, endpoint,
  priceSource: "https://docs.typesafe.ai/models", pricePerMillionInput, outputPriceUsd: 0, defaultContext: "64k",
  reservedPerCallUsd: reserveUsd, followupLimitUsd, studyLimitUsd, priorAccountedUsd, priorUpperUsd, entries: [] };
const evidence = existsSync(evidencePath) ? read(evidencePath) : { policy: TEACHING_POLICY_VERSION, sourceHashes, inputsHash,
  method: "Single fresh blind Jev review through the shared gate for each archived candidate. Archived planning controls the review scope. Planning probes are separately frozen historical synthetic messages. No tutor generation or live learner exposure.",
  questionSets: {}, rows: [] };
check(ledger.inputsHash === inputsHash && evidence.inputsHash === inputsHash && wireHash(evidence.sourceHashes) === wireHash(sourceHashes), "Existing follow-up uses a different policy or manifest");
let key;
function credential() {
  if (key) return key;
  key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    const found = Bun.spawnSync(["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"], { stdout: "pipe", stderr: "pipe" });
    if (found.exitCode === 0) key = found.stdout.toString().trim();
  }
  check(!!key, "TypeSafe credential unavailable");
  return key;
}
for (const job of jobs) {
  if (ledger.entries.some(x => x.id === job.id)) continue; // Budget a lost response in full; never retry.
  const payload = payloadFor(job);
  const row = { id: job.id, kind: job.kind, ...job.detail, requestSha256: wireHash(payload),
    questionSet: wireHash(payload.questions), state: payload.state };
  evidence.questionSets[row.questionSet] = payload.questions;
  const sum = ledger.entries.reduce((s, x) => s + x.accountedUsd, 0);
  check(ledger.entries.length < 15 && sum + reserveUsd <= followupLimitUsd && priorUpperUsd + sum + reserveUsd <= studyLimitUsd, "Budget exhausted");
  const token = credential();
  const entry = { id: job.id, requestSha256: row.requestSha256, startedAt: new Date().toISOString(), reservedUsd: reserveUsd,
    accountedUsd: reserveUsd, measured: false, status: "reserved", http: null, usage: null };
  ledger.entries.push(entry);
  evidence.rows.push(row);
  save(ledgerPath, ledger);
  save(evidencePath, evidence);
  let calls = 0;
  const caller = createSystemOneCaller({ apiKey: token, model, endpoint, requireResolvedModel: true,
    retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, fetch: async (url, opts) => {
      check(++calls === 1 && url === endpoint && opts.method === "POST" && wireHash(opts.body) === row.requestSha256
        && !Object.keys(opts.headers).some(k => k.toLowerCase().includes("long-context")), "Unexpected wire request");
      const res = await fetch(url, { ...opts, redirect: "error" });
      entry.http = res.status;
      return res;
    } });
  const outcome = await caller(job.request, AbortSignal.timeout(25_000));
  entry.status = outcome.ok ? "complete" : "unavailable";
  entry.finishedAt = new Date().toISOString();
  entry.usage = outcome.ok ? outcome.response.usage ?? null : null;
  if (entry.usage && Number.isSafeInteger(entry.usage.inputTokens) && entry.usage.inputTokens >= 0) {
    entry.accountedUsd = entry.usage.inputTokens * pricePerMillionInput / 1e6;
    entry.measured = true;
  }
  row.model = outcome.ok ? outcome.response.backend.model : null;
  row.error = outcome.ok ? null : outcome.error.code;
  row.answers = outcome.ok ? Object.fromEntries(Object.entries(outcome.response.answers).map(([id, answer]) =>
    [id, answer.type === "noul" ? answer.noul : answer])) : null;
  row.result = await job.assess(outcome);
  save(ledgerPath, ledger);
  save(evidencePath, evidence);
  check(entry.accountedUsd <= reserveUsd, "Usage exceeded reservation");
  console.log(JSON.stringify({ id: row.id, status: entry.status, result: row.result.gate ?? row.result.action, model: row.model, usd: entry.accountedUsd }));
  if (!outcome.ok && [401, 403, 429].includes(entry.http)) break;
}
console.log(JSON.stringify({ dispatches: ledger.entries.length, dollars: ledger.entries.reduce((s, x) => s + x.accountedUsd, 0), missingUsage: ledger.entries.filter(x => !x.measured).length }));
