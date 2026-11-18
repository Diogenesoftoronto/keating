// Default and --verify are offline. --plan-live dispatches the six prelabelled Jev planning probes once.
// To reproduce the earlier v2 run, apply restore-v2.patch only in a disposable copy of this revision,
// then run ../policy-v2/run-followup.mjs --verify there. The original evidence and ledger stay intact.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTeachingDrafts } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { blocksRelease, reasoningQuestions, standardQuestion, uncertainCheckpointRepetition } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest, TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { encodeSystemOneRequest } from "../../../../packages/learner-contracts/src/judgement/wire.ts";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";

const here = import.meta.dir, audit = resolve(here, ".."), root = resolve(audit, "../../..");
const read = f => JSON.parse(readFileSync(f, "utf8"));
const hash = x => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const assert = (v, why) => { if (!v) throw Error(why); };
const save = (f, x) => { writeFileSync(f + ".tmp", JSON.stringify(x, null, 2) + "\n"); renameSync(f + ".tmp", f); };
const stored = read(join(audit, "policy-v2/evidence.json")), oldLedger = read(join(audit, "policy-v2/ledger.json"));
const frozen = read(join(audit, "policy-v2/cohort.json")), probes = read(join(here, "probes.json"));
const fixtureSource = read(join(root, probes.source)).cases;
const find = id => fixtureSource.find(v => v.id === id);
const model = "jev-1.14.0", endpoint = "https://api.typesafe.ai/v1/systemone";
const sourceHashes = Object.fromEntries(Object.keys(stored.sourceHashes).map(f => [f, hash(readFileSync(join(root, f), "utf8"))]));
assert(TEACHING_POLICY_VERSION === "keating-teaching-policy/v2.1" && stored.rows.length === 15 && oldLedger.entries.length === 15, "Unexpected baseline or policy");
function outcome(answers) {
  return { ok: true, response: { backend: { backend: "system-one", model, calibrationSha256: null }, answers } };
}
const reviews = [];
for (const previous of stored.rows.filter(r => r.kind === "review")) {
  const saved = read(join(audit, "policy-v2", previous.originalReceipt));
  const plan = saved.judge.find(j => j.phase === "plan" && j.answers);
  const raw = saved.drafts.find(d => d.attempt === previous.originalAttempt).response;
  assert(!raw.toolNames.length && hash(raw.text) === previous.originalDraftSha256, "Historical candidate changed");
  let matchedRequest = false;
  const result = await runTeachingDrafts({ turn: previous.state.turn, maxAttempts: 1, maxReasoning: "off", refinement: "ordinary",
    judgementModel: { id: model, requestTokens: 64000, stateQuestionTokens: 32000 },
    generate: async () => ({ reply: { text: raw.text, toolCalls: [] }, value: 1 }),
    check: reply => [{ id: "runtime_tool_schema", source: "deterministic", severity: "critical", status: reply.toolCalls.length ? "fail" : "pass", probability: reply.toolCalls.length ? 1 : 0 }],
    judge: async request => {
      if (request.questions.learning_task) return outcome(plan.answers);
      assert(!matchedRequest && hash(encodeSystemOneRequest(request, model)) === previous.requestSha256, "The stored Jev answers are not for this exact review payload");
      matchedRequest = true;
      return outcome(Object.fromEntries(Object.entries(previous.answers).map(([k, value]) => [k, typeof value === "number" ? { type: "noul", noul: value } : value])));
    } });
  const attempt = result.receipt.attempts[0];
  assert(matchedRequest && attempt?.trimmedCheckpointSuffix && (result.status !== "released" || hash(result.reply.text) === previous.trimmedSha256), "Repair replay failed");
  const checks = attempt.checks.filter(c => c.status !== "pass");
  assert(hash(checks) === hash(previous.result.checks), "A review finding or probability changed");
  reviews.push({ id: previous.id, before: previous.result.gate, after: result.status, reviewRequestSha256: previous.requestSha256,
    remainingBlockers: checks.filter(blocksRelease), uncertainRepetition: checks.find(uncertainCheckpointRepetition)?.probability ?? null,
    leakProbability: previous.result.leak.probability });
}
const jobs = probes.cases.map(probe => {
  const messages = structuredClone(find(probe.fixture).messages);
  const last = messages.at(-1);
  assert(last.role === "user" && typeof last.content === "string", "Expected a historical learner message");
  if (probe.replace) {
    assert(last.content.split(probe.replace.before).length === 2 && find(probe.replace.afterSource).messages.some(m => m.content.includes(probe.replace.after)), "Cannot reconstruct paired visual control");
    last.content = last.content.replace(probe.replace.before, probe.replace.after);
  }
  const turn = { learnerMessage: last.content, conversation: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
    learnerEvidence: [], availableTools: frozen.historicalToolNames, toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown" };
  const request = teachingPolicyDecisionRequest(turn);
  Object.assign(request.questions, Object.fromEntries(reasoningQuestions.map(q => [q.id, q.question])), { draft_standard: standardQuestion });
  const payload = encodeSystemOneRequest(request, model);
  const requestSha256 = hash(payload);
  assert(!stored.rows.some(r => r.requestSha256 === requestSha256) && Buffer.byteLength(JSON.stringify(payload)) < 60000, "Duplicate or oversized request");
  return { probe, turn, request, payload, requestSha256 };
});
const transcript = jobs.map(j => ({ id: j.probe.id, sha256: j.requestSha256 }));
const manifestSha256 = hash(transcript);
const planFile = join(here, "planning.json"), ledgerFile = join(here, "ledger.json");
const followupCap = .25, studyCap = 2, pricePerMillionInput = .042, reserveUsd = .003;
const priorStudy = oldLedger.priorAccountedUsd;
const priorFollowup = oldLedger.entries.reduce((sum, e) => sum + e.accountedUsd, 0);
const ledger = existsSync(ledgerFile) ? read(ledgerFile) : { model, endpoint, manifestSha256, priorStudy, priorFollowup,
  priceSource: "https://docs.typesafe.ai/models", pricePerMillionInput, outputPriceUsd: 0, reserveUsd, followupCap, studyCap, entries: [] };
const evidence = existsSync(planFile) ? read(planFile) : { policy: TEACHING_POLICY_VERSION, sourceHashes, manifestSha256,
  notes: "Five historical messages and one minimal pair made solely of archived learner wording. The expected outcomes were frozen before dispatch and withheld from Jev. No new tutor responses.", questions: jobs[0].payload.questions, rows: [] };
// The final local projector change is reported as a post-observation comparison.
// It cannot alter the questions, the completed wire receipts, or the recorded first decisions.
const changedScorers = Object.keys(sourceHashes).filter(k => evidence.sourceHashes[k] !== sourceHashes[k]);
assert(ledger.manifestSha256 === manifestSha256 && evidence.manifestSha256 === manifestSha256
  && changedScorers.every(k => k === "packages/learner-contracts/src/judgement/interaction-affordances.ts"), "Unexpected policy, cohort or ledger change");
const assess = (job, result) => {
  if (!result.ok) return { action: null, offered: null, declined: null, offerMatches: null, decisionMatches: null };
  const plan = projectTeachingPolicyDecision(job.turn, result);
  const offered = plan.interaction.families.flatMap(f => f.components);
  const labels = job.probe.expected;
  const noAssessment = offered.every(name => ["Simulation", "ConceptMap", "LearningImage", "Diagram"].includes(name));
  const offerMatches = labels.mode === "none" ? plan.interaction.action === "none" : labels.mode === "no-assessment" ? noAssessment
    : offered.includes(labels.component) && (labels.mode !== "visual-without-assessment" || noAssessment);
  return { action: plan.interaction.action, offered, declined: plan.decisions.assessment_declined, offerMatches,
    decisionMatches: plan.decisions.assessment_declined === labels.declined };
};
if (process.argv.includes("--plan-live")) {
  if (!process.argv.includes("--locked")) {
    const child = Bun.spawnSync(["rtk", "proxy", "flock", "-n", "-E", "75", join(root, ".keating/benchmarks/openui-audit-2026-11-18/.budget.lock"),
      process.execPath, import.meta.path, "--plan-live", "--locked"], { env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exit(child.exitCode ?? 1);
  }
  let key = process.env.TYPESAFE_API_KEY;
  for (const job of jobs) {
    if (ledger.entries.some(e => e.id === job.probe.id)) continue;
    const spent = ledger.entries.reduce((sum, e) => sum + e.accountedUsd, 0);
    assert(ledger.entries.length < 6 && priorFollowup + spent + reserveUsd <= followupCap && oldLedger.priorUpperUsd + priorFollowup + spent + reserveUsd <= studyCap, "Budget exhausted");
    if (!key) {
      const found = Bun.spawnSync(["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"], { stdout: "pipe", stderr: "pipe" });
      if (found.exitCode === 0) key = found.stdout.toString().trim();
    }
    assert(key, "TypeSafe credential unavailable");
    const entry = { id: job.probe.id, startedAt: new Date().toISOString(), requestSha256: job.requestSha256, reservedUsd: reserveUsd,
      accountedUsd: reserveUsd, measured: false, status: "reserved", http: null, usage: null };
    ledger.entries.push(entry); save(ledgerFile, ledger);
    let dispatches = 0;
    const caller = createSystemOneCaller({ apiKey: key, model, endpoint, requireResolvedModel: true, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
      fetch: async (url, options) => {
        assert(++dispatches === 1 && url === endpoint && options.method === "POST" && hash(options.body) === job.requestSha256
          && !Object.keys(options.headers).some(k => k.toLowerCase().includes("long-context")), "Wire request disagrees with reservation");
        const response = await fetch(url, { ...options, redirect: "error" }); entry.http = response.status; return response;
      } });
    const res = await caller(job.request, AbortSignal.timeout(25000));
    entry.usage = res.ok ? res.response.usage ?? null : null;
    entry.status = res.ok ? "complete" : "unavailable"; entry.finishedAt = new Date().toISOString();
    if (entry.usage && Number.isSafeInteger(entry.usage.inputTokens) && entry.usage.inputTokens >= 0) {
      entry.measured = true; entry.accountedUsd = entry.usage.inputTokens * pricePerMillionInput / 1e6;
    }
    const row = { id: entry.id, requestSha256: job.requestSha256, state: job.payload.state, model: res.ok ? res.response.backend.model : null,
      error: res.ok ? null : res.error.code, answers: res.ok ? res.response.answers : null, result: assess(job, res) };
    evidence.rows.push(row); save(ledgerFile, ledger); save(planFile, evidence);
    assert(entry.accountedUsd <= reserveUsd, "Usage exceeded reservation");
    console.log(JSON.stringify({ id: row.id, result: row.result, usd: entry.accountedUsd }));
    if (!res.ok && [401,403,429].includes(entry.http)) break;
  }
}
if (process.argv.includes("--verify") || process.argv.includes("--plan-live")) {
  assert(evidence.rows.length === jobs.length && ledger.entries.length === jobs.length, "Unresolved planning dispatches");
  const plans = jobs.map(job => {
    const row = evidence.rows.find(r => r.id === job.probe.id);
    assert(row.requestSha256 === job.requestSha256 && hash(row.state) === hash(job.payload.state) && hash(evidence.questions) === hash(job.payload.questions), "Frozen planning receipt mismatch");
    const result = assess(job, row.model ? outcome(row.answers) : { ok: false });
    if (!changedScorers.length) assert(hash(row.result) === hash(result), "Planning assessment changed");
    return { id: row.id, expected: job.probe.expected, original: row.result, ...result, declinedProbability: row.answers?.assessment_declined?.noul ?? null,
      plainReplyProbability: row.answers?.plain_reply_requested?.noul ?? null };
  });
  const spent = ledger.entries.reduce((sum,e) => sum+e.accountedUsd, 0);
  const summary = { policy: TEACHING_POLICY_VERSION, dateUtc: ledger.entries[0].startedAt.slice(0,10), manifestSha256, model,
    checkpointReplay: { reviewed: reviews.length, approvedBefore: reviews.filter(r => r.before === "released").length,
      approvedAfter: reviews.filter(r => r.after === "released").length, heldAfter: reviews.filter(r => r.after === "withheld").length,
      notes: "The incoming nine drafts, their trimmed bytes, the fresh v2 review questions and every Jev probability are identical in both conditions. This is an offline release-policy comparison on a selected synthetic cohort.", rows: reviews },
    freshPlanning: { cases: plans.length, decisionMatches: plans.filter(r => r.decisionMatches).length, offerMatchesBeforeProjectionChange: plans.filter(r => r.original.offerMatches).length,
      offerMatches: plans.filter(r => r.offerMatches).length, postObservationProjection: changedScorers, scoringSourceHashes: sourceHashes,
      rows: plans, notes: "The six fresh Jev answers and original decisions are frozen in planning.json. The final projection was adjusted after seeing the visual-without-assessment case and retested on the same answers. An offer is a planner output. No tutor generation or learner exposure was measured." },
    accounting: { calls: ledger.entries.length, newTutorCalls: 0, newReviewCalls: 0,
      inputTokens: ledger.entries.reduce((s,e) => s+(e.usage?.inputTokens ?? 0),0), outputTokens: ledger.entries.reduce((s,e) => s+(e.usage?.outputTokens ?? 0),0),
      unknownUsageCalls: ledger.entries.filter(e=>!e.measured).length, newListPriceUsd: +spent.toFixed(9), bothFollowupsUsd: +(priorFollowup+spent).toFixed(9),
      cumulativeAccountedUsd: +(priorStudy+priorFollowup+spent).toFixed(9), followupCap, studyCap, priceSource: ledger.priceSource } };
  save(join(here,"summary.json"),summary);
  console.log(JSON.stringify({ before: summary.checkpointReplay.approvedBefore, after: summary.checkpointReplay.approvedAfter,
    freshMatches: summary.freshPlanning.offerMatches, accounting: summary.accounting }));
} else {
  console.log(JSON.stringify({ mode: "offline", before: reviews.filter(r=>r.before==="released").length, after: reviews.filter(r=>r.after==="released").length,
    remainingBlockers: reviews.filter(r=>r.after==="withheld").map(r=>[r.id,r.remainingBlockers.map(c=>c.id)]), planned: transcript, maxAdditionalUsd: reserveUsd * jobs.length }));
}
