import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JudgementRequest, NoulQuestion, TeachingPolicyTurn } from "../../../../../packages/learner-contracts/src/index.ts";
import { teachingPolicyState } from "../../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { createSystemOneCaller } from "../../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { encodeSystemOneRequest } from "../../../../../packages/learner-contracts/src/judgement/wire.ts";
import { judgementRequestProblem } from "../../../../../packages/learner-contracts/src/judgement/contracts.ts";
import { credential, save } from "../../../openui-audit-2026-11-18/final-review/study/common.mjs";

const here = import.meta.dir, root = resolve(here, "../../../../..");
const ops = join(root, ".keating/ops/openui-4.2.4/feedback-calibration/independent");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const frozen = "0175df6177604c9ecd2dc021f1def468c0f7d1763d4d4a5887bf62919d7c6e10";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const usd = (value: number) => Number(value.toFixed(9));
const protocolBytes = readFileSync(join(here, "protocol.json"));
assert.equal(digest(protocolBytes), frozen);
const protocol = JSON.parse(protocolBytes.toString());
const bounds = protocol.budget;
assert.equal(protocol.model, "jev-1.14.0");
assert.equal(protocol.endpoint, "https://api.typesafe.ai/v1/systemone");
assert.equal(bounds.previousCumulativeUsd, 6.095914496);
assert.equal(bounds.maximumAdditionalUsd, .30);
assert.equal(bounds.physicalLimit, 84);
assert.equal(usd(bounds.physicalLimit * bounds.fullRequestReserveUsd), .294);
assert.equal(bounds.maximumInputUsdPerMillionTokens, .042);
assert(bounds.previousCumulativeUsd + bounds.maximumAdditionalUsd <= bounds.maximumCumulativeUsd);

type Wire = { caseId: string; arm: "baseline" | "firstCandidate" | "proposed" | "companion"; sha256: string };
type Entry = { caseId: string; arm: Wire["arm"]; requestSha256: string; status: string; reservedUsd: number; accountedUpperUsd: number;
  http: number | null; returnedModel: string | null; providerError: string | null; usage: { input: number; output: number } | null;
  responseSha256: string | null; answers: Record<string, number> | null; startedUtc: string; finishedUtc: string | null };
type Ledger = { protocolSha256: string; mode: string; status: string; startedUtc: string; finishedUtc: string | null;
  entries: Entry[]; actualRequests: number; previousCumulativeUpperUsd: number; additionalUpperUsd: number; cumulativeUpperUsd: number };
const wires: Wire[] = protocol.wires;
const firstProtocol = read(join(here, "../protocol.json"));
assert.equal(digest(readFileSync(join(here, "../protocol.json"))), protocol.provenance.earlierProtocolSha256);
assert.equal(digest(readFileSync(join(here, "../results.json"))), protocol.provenance.earlierResultSha256);
assert.equal(new Set(wires.map(w => w.sha256)).size, bounds.physicalLimit);
assert(wires.every(w => !firstProtocol.wires.some((prior: Wire) => prior.sha256 === w.sha256)));
assert(protocol.cases.every((c: any) => !firstProtocol.cases.some((old: any) =>
  JSON.stringify(c.reply) === JSON.stringify(old.reply) || JSON.stringify(c.turn) === JSON.stringify(old.turn))));
for (const name of new Set(protocol.cases.map((c: any) => c.match).filter(Boolean))) {
  const pair = protocol.cases.filter((c: any) => c.match === name);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair[0].turn, pair[1].turn);
  assert.deepEqual(pair.map((c: any) => c.expected.assessed).sort(), [false, true]);
}

const unpack = (wire: Wire): JudgementRequest => {
  const c = protocol.cases.find((entry: any) => entry.id === wire.caseId);
  assert(c);
  const q = protocol.questions;
  const questions: Record<string, NoulQuestion> = wire.arm === "baseline" ? { assessed_work_completed: q.original }
    : wire.arm === "firstCandidate" ? { assessed_work_completed: q.firstCandidate }
    : wire.arm === "proposed" ? { assessed_work_completed: q.proposed }
    : { checkpoint_repeated: q.repeat, ...(c.expected.route === "scoped" ? { checkpoint_feedback_unsupported: q.unsupported } : {}) };
  assert(!["proposed", "firstCandidate"].includes(wire.arm) || c.expected.route === "scoped");
  const req = { state: { ...teachingPolicyState(c.turn as TeachingPolicyTurn), reply: c.reply }, questions };
  assert.equal(judgementRequestProblem(req), null);
  const bytes = JSON.stringify(encodeSystemOneRequest(req, protocol.model));
  assert.equal(digest(bytes), wire.sha256);
  assert(Buffer.byteLength(bytes) < 8000 && !bytes.includes("repeatSuppression"));
  return req;
};
const verdict = (p: number | null | undefined): boolean | null => typeof p !== "number" ? null
  : p <= protocol.decision.passAtMost ? false : p >= protocol.decision.failAtLeast ? true : null;

function analysis(ledger: Ledger) {
  assert.equal(ledger.protocolSha256, frozen);
  const allWires = ledger.status === "complete" && ledger.entries.length === wires.length
    && ledger.entries.every(e => e.status === "received" && e.http === 200 && e.returnedModel === protocol.model && !!e.answers);
  const cases = protocol.cases.map((c: any) => {
    const entries = ledger.entries.filter(r => r.caseId === c.id);
    const get = (arm: Wire["arm"], key: string) => entries.find(r => r.arm === arm)?.answers?.[key];
    const scores = { baselineAssessment: get("baseline","assessed_work_completed") ?? null,
      firstAssessment: get("firstCandidate","assessed_work_completed") ?? null, proposedAssessment: get("proposed","assessed_work_completed") ?? null,
      unsupported: get("companion","checkpoint_feedback_unsupported") ?? null, repetition: get("companion","checkpoint_repeated") ?? null };
    const scoped = c.expected.route === "scoped";
    const routesMatch = scoped ? entries.length === 4 && typeof scores.proposedAssessment === "number" && typeof scores.firstAssessment === "number" && typeof scores.unsupported === "number"
      : entries.length === 2 && scores.proposedAssessment === null && scores.firstAssessment === null && scores.unsupported === null;
    const agrees = (value: number | null, label: boolean | null) => label === null ? null : verdict(value) === label;
    const suppression = scoped && !/[?？]/u.test(c.reply.text) && typeof scores.repetition === "number"
      && verdict(scores.proposedAssessment) === false && verdict(scores.unsupported) === false;
    return { id: c.id, group: c.group, match: c.match, expected: c.expected, routesMatch, scores,
      agreement: { baseline: agrees(scores.baselineAssessment, c.expected.assessed), first: scoped ? agrees(scores.firstAssessment, c.expected.assessed) : null,
        proposed: scoped ? agrees(scores.proposedAssessment, c.expected.assessed) : null, unsupported: agrees(scores.unsupported, c.expected.unsupported), repeat: agrees(scores.repetition, c.expected.repeat) },
      modeledRepetitionSuppression: suppression, repetitionApplicabilityMatches: suppression === c.expected.suppress };
  });
  const scoped = cases.filter((c: any) => c.expected.route === "scoped"), ordinary = cases.filter((c: any) => c.expected.route === "ordinary");
  const grounded = scoped.filter((c: any) => c.group === "grounded"), assignments = scoped.filter((c: any) => c.group === "assigns only");
  const supplies = scoped.filter((c: any) => c.group === "supplies assessed work"), other = scoped.filter((c: any) => c.group === "unsupported without assessment completion");
  const unsafe = scoped.filter((c: any) => c.expected.unsupported);
  const correctlyClassified = (c: any) => c.agreement.proposed === true && c.agreement.unsupported === true;
  const count = (group: any[], key: string) => group.filter(c => c.agreement[key] === true).length;
  const matched = { total: scoped.length, shippedCorrect: count(scoped,"baseline"), firstCandidateCorrect: count(scoped,"first"),
    proposedCorrect: count(scoped,"proposed"), assignmentOnlyTotal: assignments.length, assignmentOnlyFirstCorrect: count(assignments,"first"),
    assignmentOnlyProposedCorrect: count(assignments,"proposed"),
    improvedOverFirst: scoped.filter((c: any) => !c.agreement.first && c.agreement.proposed).map((c: any) => c.id),
    regressedFromFirst: scoped.filter((c: any) => c.agreement.first && !c.agreement.proposed).map((c: any) => c.id) };
  const clears = (c: any, field: string) => verdict(c.scores[field]) === false && verdict(c.scores.unsupported) === false;
  const unexpectedClearances = unsafe.filter((c: any) => clears(c, "proposedAssessment")).map((c: any) => c.id);
  const newlyClearedUnsafe = unsafe.filter((c: any) => !clears(c, "baselineAssessment") && clears(c, "proposedAssessment")).map((c: any) => c.id);
  const checks = [
    { id: "all-84-requests", passed: allWires }, { id: "grounded-feedback", passed: grounded.length === 8 && grounded.every(correctlyClassified) },
    { id: "assignment-only-attribution", passed: assignments.length === 4 && assignments.every(correctlyClassified) },
    { id: "supplied-assessed-work", passed: supplies.length === 4 && supplies.every(correctlyClassified) },
    { id: "other-unsupported-feedback", passed: other.length === 2 && other.every(correctlyClassified) },
    { id: "untrusted-and-ordinary-boundaries", passed: ordinary.length === 6 && ordinary.every((c: any) => c.routesMatch && !c.modeledRepetitionSuppression && c.agreement.baseline !== false && c.agreement.repeat !== false) },
    { id: "repetition-applicability", passed: cases.every((c: any) => c.routesMatch && c.repetitionApplicabilityMatches) },
    { id: "no-unsafe-clearance", passed: unsafe.length === 10 && !unexpectedClearances.length && !newlyClearedUnsafe.length },
    { id: "additional-matched-benefit", passed: matched.proposedCorrect > matched.shippedCorrect && matched.assignmentOnlyProposedCorrect > matched.assignmentOnlyFirstCorrect },
  ];
  return { protocolSha256: frozen, status: ledger.status, actualRequests: ledger.actualRequests, gate: { passed: checks.every(g => g.passed), checks },
    budget: { previousCumulativeUpperUsd: bounds.previousCumulativeUsd, additionalUpperUsd: ledger.additionalUpperUsd, cumulativeUpperUsd: ledger.cumulativeUpperUsd },
    matched, unexpectedClearances, newlyClearedUnsafe, cases, scope: "Prospective synthetic comparison of three assessed-work questions and one unchanged companion. No tutor generation or end-to-end publication occurred." };
}

async function execute(live: boolean) {
  const ledgerFile = join(ops, "ledger.json");
  const key = live ? credential("TYPESAFE_API_KEY", "typesafe_api_key") : "offline-placeholder";
  assert(typeof key === "string" && key.length > 10);
  const ledger: Ledger = { protocolSha256: frozen, mode: live ? "real-provider" : "temporary-offline-harness", status: "running",
    startedUtc: new Date().toISOString(), finishedUtc: null, entries: [], actualRequests: 0, previousCumulativeUpperUsd: bounds.previousCumulativeUsd,
    additionalUpperUsd: 0, cumulativeUpperUsd: bounds.previousCumulativeUsd };
  if (live) {
    assert.equal(process.argv[3], frozen);
    assert.equal(digest(readFileSync(join(ops, "protocol.json"))), frozen);
    writeFileSync(ledgerFile, JSON.stringify(ledger) + "\n", { flag: "wx", mode: 0o600 });
  }
  const persist = () => {
    ledger.additionalUpperUsd = usd(ledger.entries.reduce((sum, e) => sum + e.accountedUpperUsd, 0));
    ledger.cumulativeUpperUsd = usd(bounds.previousCumulativeUsd + ledger.additionalUpperUsd);
    assert(ledger.additionalUpperUsd <= bounds.maximumAdditionalUsd && ledger.cumulativeUpperUsd <= bounds.maximumCumulativeUsd);
    assert(!JSON.stringify(ledger).includes(key));
    if (live) save(ledgerFile, ledger);
  };
  for (const wire of wires) {
    const request = unpack(wire);
    let dispatched = false;
    const e: Entry = { caseId: wire.caseId, arm: wire.arm, requestSha256: wire.sha256, status: "reserved", reservedUsd: bounds.fullRequestReserveUsd,
      accountedUpperUsd: bounds.fullRequestReserveUsd, http: null, returnedModel: null, providerError: null, usage: null, responseSha256: null,
      answers: null, startedUtc: new Date().toISOString(), finishedUtc: null };
    const caller = createSystemOneCaller({ endpoint: protocol.endpoint, model: protocol.model, apiKey: key, requireResolvedModel: true,
      retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, fetch: async (url, init) => {
        assert(!dispatched && url === protocol.endpoint && init.method === "POST" && init.headers.authorization === "Bearer " + key);
        assert.equal(digest(init.body), wire.sha256);
        assert(!init.body.includes(key) && !ledger.entries.some(old => old.requestSha256 === wire.sha256));
        assert(ledger.entries.length < bounds.physicalLimit && usd(ledger.additionalUpperUsd + bounds.fullRequestReserveUsd) <= bounds.maximumAdditionalUsd);
        dispatched = true;
        ledger.entries.push(e);
        if (live) ledger.actualRequests++;
        persist();
        const response = live ? await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(40000) })
          : Response.json({ model: protocol.model, usage: { input_tokens: 100, output_tokens: 8 },
            answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: .5 }])) });
        e.http = response.status;
        const body = await response.text();
        e.responseSha256 = digest(body);
        let decoded: any = {};
        try { decoded = JSON.parse(body); } catch { /* malformed or non-JSON response remains unavailable */ }
        e.returnedModel = typeof decoded?.model === "string" && /^jev-[\d.]+$/u.test(decoded.model) ? decoded.model : null;
        if (Number.isSafeInteger(decoded?.usage?.input_tokens) && decoded.usage.input_tokens > 0 && Number.isSafeInteger(decoded.usage.output_tokens) && decoded.usage.output_tokens >= 0) {
          e.usage = { input: decoded.usage.input_tokens, output: decoded.usage.output_tokens };
          if (response.ok) {
            const cost = usd(e.usage.input * bounds.maximumInputUsdPerMillionTokens / 1e6);
            assert(cost <= e.reservedUsd);
            e.accountedUpperUsd = cost;
          }
        }
        persist();
        return Response.json(response.ok ? decoded : {}, { status: response.status });
      } });
    const result = await caller(request);
    assert(dispatched);
    if (result.ok && e.http === 200 && e.returnedModel === protocol.model && result.response.backend.model === protocol.model) {
      const values: Record<string, number> = {};
      for (const id of Object.keys(request.questions)) {
        const answer = result.response.answers[id];
        if (answer?.type === "noul" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1) values[id] = answer.noul;
      }
      if (Object.keys(values).length === Object.keys(request.questions).length) e.answers = values;
    }
    e.status = e.answers ? "received" : "unavailable";
    if (!result.ok) e.providerError = result.error.code;
    else if (!e.answers) e.providerError = "unexpected-model-or-result";
    e.finishedUtc = new Date().toISOString();
    persist();
    if (!e.answers) break;
  }
  ledger.status = ledger.entries.length === wires.length && ledger.entries.every(e => e.status === "received") ? "complete" : "partial";
  ledger.finishedUtc = new Date().toISOString();
  persist();
  if (!live) {
    assert.equal(ledger.actualRequests, 0);
    assert.equal(ledger.status, "complete");
    assert(!analysis(ledger).gate.passed); // All mock scores are uncertain; the harness must not pass its own preflight.
  } else {
    const result = analysis(ledger);
    const resultPath = join(ops, "results.json");
    assert(!existsSync(resultPath));
    save(resultPath, result);
    for (const name of ["ledger.json", "results.json"]) writeFileSync(join(here, name), readFileSync(join(ops, name)), { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ mode: ledger.mode, verifiedWires: ledger.entries.length, actualRequests: ledger.actualRequests,
    state: ledger.status, gatePassed: live ? analysis(ledger).gate.passed : null, additionalUpperUsd: live ? ledger.additionalUpperUsd : 0 }));
}

if (process.argv[2] === "--preflight") await execute(false);
else if (process.argv[2] === "--live") await execute(true);
else {
  assert.equal(process.argv[2], "--verify");
  const ledger: Ledger = read(join(here, "ledger.json"));
  assert.equal(ledger.protocolSha256, frozen);
  assert.equal(ledger.mode, "real-provider");
  assert.equal(ledger.entries.length, ledger.actualRequests);
  for (const [index, entry] of ledger.entries.entries()) {
    const wire = wires[index]!;
    unpack(wire);
    assert.equal(entry.requestSha256, wire.sha256);
    assert.equal(entry.caseId, wire.caseId);
    assert.equal(entry.arm, wire.arm);
    assert.equal(entry.reservedUsd, bounds.fullRequestReserveUsd);
    assert.equal(entry.accountedUpperUsd, entry.http === 200 && entry.usage ? usd(entry.usage.input * bounds.maximumInputUsdPerMillionTokens / 1e6) : entry.reservedUsd);
  }
  assert.equal(ledger.additionalUpperUsd, usd(ledger.entries.reduce((sum, e) => sum + e.accountedUpperUsd, 0)));
  assert.equal(ledger.cumulativeUpperUsd, usd(bounds.previousCumulativeUsd + ledger.additionalUpperUsd));
  assert.deepEqual(analysis(ledger), read(join(here, "results.json")));
  console.log(JSON.stringify({ verified: true, recordedRequests: ledger.actualRequests, gate: analysis(ledger).gate, newPaidRequests: 0 }));
}
