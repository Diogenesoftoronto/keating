import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JudgementRequest, NoulQuestion, TeachingPolicyTurn } from "../../../../packages/learner-contracts/src/index.ts";
import { teachingPolicyState } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { encodeSystemOneRequest } from "../../../../packages/learner-contracts/src/judgement/wire.ts";
import { judgementRequestProblem } from "../../../../packages/learner-contracts/src/judgement/contracts.ts";
import { credential, save } from "../../openui-audit-2026-11-18/final-review/study/common.mjs";

const here = import.meta.dir, root = resolve(here, "../../../..");
const ops = join(root, ".keating/ops/openui-4.2.4/feedback-calibration");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const frozen = "f4ea1fbdc8c93893435848be382361614dec16bbdee9bf7926779c3c4d15fada";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const usd = (value: number) => Number(value.toFixed(9));
const protocolBytes = readFileSync(join(here, "protocol.json"));
assert.equal(digest(protocolBytes), frozen);
const protocol = JSON.parse(protocolBytes.toString());
const bounds = protocol.budget;
assert.equal(protocol.model, "jev-1.14.0");
assert.equal(protocol.endpoint, "https://api.typesafe.ai/v1/systemone");
assert.equal(bounds.previousCumulativeUsd, 6.093290462);
assert.equal(bounds.maximumAdditionalUsd, .25);
assert.equal(bounds.physicalLimit, 65);
assert.equal(usd(bounds.physicalLimit * bounds.fullRequestReserveUsd), .2275);
assert.equal(bounds.maximumInputUsdPerMillionTokens, .042);
assert(bounds.previousCumulativeUsd + bounds.maximumAdditionalUsd <= bounds.maximumCumulativeUsd);

type Wire = { caseId: string; arm: "baseline" | "proposed" | "companion"; sha256: string };
type Entry = { caseId: string; arm: Wire["arm"]; requestSha256: string; status: string; reservedUsd: number; accountedUpperUsd: number;
  http: number | null; returnedModel: string | null; providerError: string | null; usage: { input: number; output: number } | null;
  responseSha256: string | null; answers: Record<string, number> | null; startedUtc: string; finishedUtc: string | null };
type Ledger = { protocolSha256: string; mode: string; status: string; startedUtc: string; finishedUtc: string | null;
  entries: Entry[]; actualRequests: number; previousCumulativeUpperUsd: number; additionalUpperUsd: number; cumulativeUpperUsd: number };
const wires: Wire[] = protocol.wires;
const unpack = (wire: Wire): JudgementRequest => {
  const c = protocol.cases.find((entry: any) => entry.id === wire.caseId);
  assert(c);
  const q = protocol.questions;
  const questions: Record<string, NoulQuestion> = wire.arm === "baseline" ? { assessed_work_completed: q.original }
    : wire.arm === "proposed" ? { assessed_work_completed: q.proposed }
    : { checkpoint_repeated: q.repeat, ...(c.expected.route === "scoped" ? { checkpoint_feedback_unsupported: q.unsupported } : {}) };
  assert(wire.arm !== "proposed" || c.expected.route === "scoped");
  const req = { state: { ...teachingPolicyState(c.turn as TeachingPolicyTurn), reply: c.reply }, questions };
  assert.equal(judgementRequestProblem(req), null);
  const bytes = JSON.stringify(encodeSystemOneRequest(req, protocol.model));
  assert.equal(digest(bytes), wire.sha256);
  assert(Buffer.byteLength(bytes) < 17000 && !bytes.includes("repeatSuppression"));
  return req;
};
const verdict = (p: number | undefined): boolean | null => typeof p !== "number" ? null
  : p <= protocol.decision.passAtMost ? false : p >= protocol.decision.failAtLeast ? true : null;

function analysis(ledger: Ledger) {
  assert.equal(ledger.protocolSha256, frozen);
  const complete = ledger.status === "complete" && ledger.entries.length === wires.length && ledger.entries.every(e => e.status === "received" && e.http === 200 && e.returnedModel === protocol.model && e.answers);
  const cases = protocol.cases.map((c: any) => {
    const entries = ledger.entries.filter(e => e.caseId === c.id);
    const get = (arm: Wire["arm"], id: string) => entries.find(e => e.arm === arm)?.answers?.[id];
    const baseline = get("baseline", "assessed_work_completed"), proposed = get("proposed", "assessed_work_completed");
    const unsupported = get("companion", "checkpoint_feedback_unsupported"), repeated = get("companion", "checkpoint_repeated");
    const routesMatch = c.expected.route === "scoped"
      ? entries.length === 3 && typeof proposed === "number" && typeof unsupported === "number"
      : entries.length === 2 && proposed === undefined && unsupported === undefined;
    const suppressRepetition = c.expected.route === "scoped" && !/[?？]/u.test(c.reply.text) && typeof repeated === "number"
      && verdict(unsupported) === false && verdict(proposed) === false;
    return { id: c.id, cohort: c.cohort, group: c.group, expected: c.expected, routesMatch,
      scores: { baselineAssessment: baseline ?? null, proposedAssessment: proposed ?? null, unsupported: unsupported ?? null, repetition: repeated ?? null },
      agreement: { baselineAssessment: c.expected.assessed === null ? null : verdict(baseline) === c.expected.assessed,
        proposedAssessment: c.expected.route === "scoped" && c.expected.assessed !== null ? verdict(proposed) === c.expected.assessed : null,
        unsupported: c.expected.unsupported === null ? null : verdict(unsupported) === c.expected.unsupported,
        repetition: c.expected.repeated === null ? null : verdict(repeated) === c.expected.repeated },
      modeledRepetitionSuppression: suppressRepetition, expectedRepetitionSuppressionMatches: c.expected.repeatSuppression === suppressRepetition };
  });
  const scoped = cases.filter((c: any) => c.expected.route === "scoped"), ordinary = cases.filter((c: any) => c.expected.route === "ordinary");
  const dev = scoped.filter((c: any) => c.cohort === "development");
  const positives = scoped.filter((c: any) => c.cohort === "prospective" && !c.expected.unsupported);
  const trueAssessed = scoped.filter((c: any) => c.expected.assessed === true);
  const otherUnsafe = scoped.filter((c: any) => c.expected.assessed === false && c.expected.unsupported === true);
  const right = (c: any) => c.agreement.proposedAssessment === true && c.agreement.unsupported === true;
  const improvements = scoped.filter((c: any) => !c.agreement.baselineAssessment && c.agreement.proposedAssessment);
  const regressions = scoped.filter((c: any) => c.agreement.baselineAssessment && !c.agreement.proposedAssessment);
  const baselineCorrect = scoped.filter((c: any) => c.agreement.baselineAssessment).length;
  const proposedCorrect = scoped.filter((c: any) => c.agreement.proposedAssessment).length;
  const checks = [
    { id: "all-wires", passed: complete }, { id: "known-confirmations", passed: dev.length === 2 && dev.every(right) },
    { id: "new-grounded-feedback", passed: positives.length === 6 && positives.every(right) },
    { id: "outstanding-assessed-work", passed: trueAssessed.length === 4 && trueAssessed.every(right) },
    { id: "unsupported-feedback", passed: otherUnsafe.length === 5 && otherUnsafe.every(right) },
    { id: "ordinary-boundaries", passed: ordinary.length === 7 && ordinary.every((c: any) => c.routesMatch && !c.modeledRepetitionSuppression
      && c.agreement.baselineAssessment !== false && c.agreement.repetition !== false) },
    { id: "repetition-applicability", passed: cases.every((c: any) => c.routesMatch && c.expectedRepetitionSuppressionMatches) },
    { id: "matched-incremental-benefit", passed: proposedCorrect > baselineCorrect && trueAssessed.every((c: any) => verdict(c.scores.proposedAssessment) !== false) },
  ];
  return { protocolSha256: frozen, status: ledger.status, actualRequests: ledger.actualRequests,
    gate: { passed: checks.every(c => c.passed), checks }, budget: { previousCumulativeUpperUsd: bounds.previousCumulativeUsd,
      additionalUpperUsd: ledger.additionalUpperUsd, cumulativeUpperUsd: ledger.cumulativeUpperUsd },
    matchedAssessment: { total: scoped.length, baselineCorrect, proposedCorrect, improvements: improvements.map((c: any) => c.id), regressions: regressions.map((c: any) => c.id) },
    cases, scope: "Synthetic single-question/companion calibration. Production development replies are exact; their review state is reconstructed. No tutor generations or actual end-to-end releases occur in this study." };
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
