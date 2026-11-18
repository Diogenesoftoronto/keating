// Offline preparation and scoring. This file never calls a provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runTeachingDrafts } from "../../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { blocksRelease, reasoningQuestions, standardQuestion } from "../../../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest, TEACHING_POLICY_VERSION } from "../../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { decodeAnswer, encodeSystemOneRequest } from "../../../../../packages/learner-contracts/src/judgement/wire.ts";

const here = import.meta.dir;
const audit = resolve(here, "../.."), root = resolve(audit, "../../..");
const referenceModel = "jev-1.14.0";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const sha = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const formatted = value => JSON.stringify(value, null, 2) + "\n";
const mode = process.argv[2] ?? "--verify";
assert(["--freeze", "--verify", "--score"].includes(mode) && process.argv.length <= 3, "Use --freeze, --verify or --score.");

const inputs = {};
function source(path) {
  const bytes = readFileSync(path);
  inputs[relative(root, path)] = sha(bytes);
  return JSON.parse(bytes.toString("utf8"));
}
const originalReviews = source(join(audit, "policy-v2/evidence.json"));
const historical = source(join(audit, "policy-v2/cohort.json"));
const probes = source(join(audit, "policy-v2.1/probes.json"));
const originals = source(join(audit, "policy-v2.1/planning.json"));
const prior = source(join(audit, "policy-v2.1/summary.json"));
const fixtureCases = source(join(root, probes.source)).cases;
const policyHashes = prior.freshPlanning.scoringSourceHashes;
assert.equal(TEACHING_POLICY_VERSION, "keating-teaching-policy/v2.1");
assert.equal(prior.model, referenceModel);
for (const [file, digest] of Object.entries(policyHashes)) {
  assert.equal(sha(readFileSync(join(root, file))), digest, "Historical scoring implementation changed: " + file);
}

// The production gate holds backend identity constant across a turn. A local fixture identity
// explicitly identifies this replay of archived planning plus either judge's review. Actual
// decision-provider identities remain on the original receipts and on the reported comparison.
function replayOutcome(answers) {
  return { ok: true, response: { backend: { backend: "fixture", model: "frozen-answer-replay", calibrationSha256: null }, answers } };
}
function validateAnswers(request, answers) {
  assert.deepEqual(Object.keys(answers).sort(), Object.keys(request.questions).sort(), "Answer keys differ from exact request.");
  for (const [id, question] of Object.entries(request.questions)) assert(decodeAnswer(question, answers[id]), "Malformed answer: " + id);
}
function bindRequest(id, stage, request, retained, questions) {
  const wire = encodeSystemOneRequest(request, referenceModel);
  assert.equal(sha(wire), retained.requestSha256, "Jev wire hash differs for " + id);
  assert.deepEqual(wire.questions, questions, "Question bytes differ for " + id);
  assert.deepEqual(wire.state, retained.state, "State differs for " + id);
  assert.equal(retained.model, referenceModel);
  return { id, stage, request, requestSha256: sha(request), jevWireSha256: sha(wire) };
}
function planResult(turn, expected, outcome) {
  const plan = projectTeachingPolicyDecision(turn, outcome);
  const offered = plan.interaction.families.flatMap(family => family.components);
  const noAssessment = offered.every(name => ["Simulation", "ConceptMap", "LearningImage", "Diagram"].includes(name));
  const offerMatches = expected.mode === "none" ? plan.interaction.action === "none" : expected.mode === "no-assessment" ? noAssessment
    : offered.includes(expected.component) && (expected.mode !== "visual-without-assessment" || noAssessment);
  return { action: plan.interaction.action, offered, declined: plan.decisions.assessment_declined, offerMatches,
    decisionMatches: plan.decisions.assessment_declined === expected.declined };
}

const requests = [], reference = [], jobs = new Map();
for (const probe of probes.cases) {
  const getFixture = id => fixtureCases.find(f => f.id === id);
  const messages = structuredClone(getFixture(probe.fixture).messages);
  const last = messages.at(-1);
  assert.equal(last.role, "user");
  if (probe.replace) {
    assert.equal(last.content.split(probe.replace.before).length, 2);
    assert(getFixture(probe.replace.afterSource).messages.some(m => m.content.includes(probe.replace.after)));
    last.content = last.content.replace(probe.replace.before, probe.replace.after);
  }
  const turn = { learnerMessage: last.content, conversation: messages.slice(0, -1).map(({role, content}) => ({role, content})),
    learnerEvidence: [], availableTools: historical.historicalToolNames, toolResults: [], sources: [],
    assessment: "unknown", improvementRuns: null, domain: "unknown" };
  const request = teachingPolicyDecisionRequest(turn);
  Object.assign(request.questions, Object.fromEntries(reasoningQuestions.map(q => [q.id, q.question])), { draft_standard: standardQuestion });
  const retained = originals.rows.find(row => row.id === probe.id);
  const row = bindRequest(probe.id, "plan", request, retained, originals.questions);
  validateAnswers(request, retained.answers);
  const assess = outcome => planResult(turn, probe.expected, outcome);
  const result = assess(replayOutcome(retained.answers));
  const saved = prior.freshPlanning.rows.find(r => r.id === row.id);
  for (const key of Object.keys(result)) assert.deepEqual(result[key], saved[key], "Prior v2.1 planning result disagrees: " + row.id);
  requests.push(row);
  reference.push({ id: row.id, stage: row.stage, expected: probe.expected, jev: result, answersSha256: sha(retained.answers) });
  jobs.set(row.id, assess);
}

function blockers(checks) {
  return checks.filter(blocksRelease).map(({id,status,probability}) => ({id,status,probability}));
}
for (const retained of originalReviews.rows.filter(row => row.kind === "review")) {
  const actor = source(resolve(audit, "policy-v2", retained.originalReceipt));
  const plan = actor.judge.find(j => j.phase === "plan" && j.answers);
  const raw = actor.drafts.find(d => d.attempt === retained.originalAttempt).response;
  assert.equal(plan.model, referenceModel);
  assert.equal(plan.hash, retained.originalPlanningRequestSha256);
  assert.equal(retained.originalStateHashVerified, true);
  assert.equal(sha(raw.text), retained.originalDraftSha256);
  assert(!raw.errorClass && raw.toolNames.length === 0);
  const saved = prior.checkpointReplay.rows.find(row => row.id === retained.id);
  const answers = Object.fromEntries(Object.entries(retained.answers).map(([id,v]) => [id, typeof v === "number" ? {type:"noul",noul:v} : v]));
  let captured;
  async function assess(outcome) {
    let seen = 0;
    const result = await runTeachingDrafts({
      turn: retained.state.turn, maxAttempts: 1, maxReasoning: "off", refinement: "ordinary",
      judgementModel: { id: referenceModel, requestTokens: 64000, stateQuestionTokens: 32000 },
      generate: async () => ({ reply: { text: raw.text, toolCalls: [] }, value: null }),
      check: reply => [{ id:"runtime_tool_schema", source:"deterministic", severity:"critical", status:reply.toolCalls.length ? "fail" : "pass", probability:reply.toolCalls.length ? 1 : 0 }],
      judge: async request => {
        if (request.questions.learning_task) return replayOutcome(plan.answers);
        seen++;
        assert.equal(sha(request.state.reply.text), retained.trimmedSha256);
        const row = bindRequest(retained.id, "review", request, retained, originalReviews.questionSets[retained.questionSet]);
        if (captured) assert.deepEqual(row, captured);
        else captured = row;
        validateAnswers(request, outcome.response.answers);
        return replayOutcome(outcome.response.answers);
      },
    });
    assert.equal(seen, 1);
    const attempt = result.receipt.attempts[0];
    assert.equal(attempt.trimmedCheckpointSuffix, true);
    if (result.status === "released") assert.equal(sha(result.reply.text), retained.trimmedSha256);
    return { gate: result.status, attempt: attempt.status, blockers: blockers(attempt.checks) };
  }
  const result = await assess(replayOutcome(answers));
  assert.equal(result.gate, saved.after);
  assert.deepEqual(result.blockers, blockers(saved.remainingBlockers));
  requests.push(captured);
  reference.push({ id: retained.id, stage: "review", expected: null, jev: result, answersSha256: sha(answers),
    sourceTurn: actor.id, attempt: retained.originalAttempt, originalDraftSha256: retained.originalDraftSha256, reviewedDraftSha256: retained.trimmedSha256,
    commonHistoricalPlanningResponseSha256: sha(plan.answers) });
  jobs.set(retained.id, assess);
}
assert.equal(requests.length, 15);
assert.equal(jobs.size, requests.length);
assert.equal(new Set(requests.map(row => row.requestSha256)).size, requests.length);

const requestFile = { version: 1, policy: TEACHING_POLICY_VERSION, cases: requests };
const referenceFile = { version: 1, model: referenceModel, cases: reference };
const manifest = { version: 1, policy: TEACHING_POLICY_VERSION, planCases: 6, reviewCases: 9,
  requestsFileSha256: sha(formatted(requestFile)), referenceFileSha256: sha(formatted(referenceFile)), inputs, policyHashes,
  design: "Six prelabelled planning probes and nine previously suffix-blocked MiniMax candidates across six historical turns. Both decision providers receive the identical shared request per case. Runtime changes, tutor sampling, production prevalence and human learning are outside this fixed-input comparison.",
  endpoints: { planning: "Compare assessment-declined correctness and offered-family match against the frozen expected values. The historical v2.1 projector was refined on one of these six cases.",
    review: "Compare release/withhold and blocking rule IDs on each identical trimmed candidate, holding its historical planning answers, local gate and deterministic checks fixed. Review reference outcomes establish agreement, not semantic correctness.",
    unknown: "A missing, failed or malformed provider observation contributes no measured provider decision; keep it in scheduled coverage." },
};
function artifact(name, value, create) {
  const file = join(here, name), bytes = formatted(value);
  if (create && !existsSync(file)) writeFileSync(file, bytes, {flag:"wx"});
  assert.equal(readFileSync(file, "utf8"), bytes, "Frozen artifact differs: " + name);
}
artifact("requests.json", requestFile, mode === "--freeze");
artifact("reference.json", referenceFile, mode === "--freeze");
artifact("manifest.json", manifest, mode === "--freeze");
console.log(JSON.stringify({ policy: manifest.policy, planning: 6, reviews: 9, requestsFileSha256: manifest.requestsFileSha256,
  referenceFileSha256: manifest.referenceFileSha256 }));
if (mode === "--score" || (mode === "--verify" && existsSync(join(here, "comparison.json")))) {
  const { score } = await import("./score.mjs");
  const compute = async name => {
    const content = readFileSync(join(here, name)), outcomeFile = JSON.parse(content.toString("utf8"));
    assert.equal(outcomeFile.sourceSha256, manifest.requestsFileSha256, "Google's outcome file references different inputs.");
    return score({ requests, reference, jobs, outcomeFile, hash: sha, read, policy: manifest.policy,
      manifestFileSha256: sha(formatted(manifest)), googleFileSha256: sha(content) });
  };
  const firstPass = await compute("first-pass-google-outcomes.json");
  artifact("first-pass-comparison.json", firstPass, false);
  const comparison = await compute("google-outcomes.json");
  const path = join(here, "comparison.json");
  if (mode === "--score" && comparison.googleFileSha256 !== firstPass.googleFileSha256 && existsSync(path)
    && readFileSync(path, "utf8") === formatted(firstPass)) {
    // The first-pass bytes are permanently preserved above. Replace only this original working copy.
    const incoming = path + ".tmp";
    writeFileSync(incoming, formatted(comparison), { flag:"wx" });
    renameSync(incoming, path);
  }
  artifact("comparison.json", comparison, mode === "--score");
  console.log(JSON.stringify({ measuredPlanning: comparison.planning.measured, measuredReview: comparison.review.measured }));
}
