import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

const model = "gemini-decision-1";
const endpoint = "https://generativelanguage.googleapis.com/v1beta/decisions";
function rate(values) {
  const measured = values.filter(value => value !== null), numerator = measured.filter(Boolean).length, denominator = measured.length;
  return { numerator, denominator, unknown: values.length - denominator, rate: denominator ? numerator / denominator : null };
}
function pair(rows, property) {
  let both = 0, jevOnly = 0, geminiOnly = 0, neither = 0, unknown = 0;
  for (const row of rows) {
    if (!row.gemini) { unknown++; continue; }
    const a = property(row.jev), b = property(row.gemini);
    if (a && b) both++;
    else if (a) jevOnly++;
    else if (b) geminiOnly++;
    else neither++;
  }
  return { measured: rows.length - unknown, unknown, both, jevOnly, geminiOnly, neither };
}
function rates(rows, predicate) {
  return { jev: rate(rows.map(r => predicate(r.jev))), gemini: rate(rows.map(r => r.gemini ? predicate(r.gemini) : null)), paired: pair(rows, predicate) };
}

function nativeWire(request) {
  const questions = {};
  for (const [id, q] of Object.entries(request.questions)) {
    const wire = { type: q.type, instructions: q.instructions };
    if (q.type === "noul" && q.criteria) wire.criteria = { true_description: q.criteria.true, false_description: q.criteria.false };
    if (q.type === "choice") wire.criteria = Object.fromEntries(Object.entries(q.criteria).map(([key, value]) => [key, value ?? ""]));
    if (q.type === "score") wire.criteria = q.criteria;
    questions[id] = wire;
  }
  return { model, input: typeof request.state === "string" ? request.state : JSON.stringify(request.state), questions };
}

/** Bind each returned projection to the same-input cache that the paid runner wrote; all reads are local. */
export function observe(row, provider, hash, read) {
  if (!provider) return { status: "not-observed", error: null, reportedModel: null };
  assert.equal(provider.requestSha256, row.requestSha256, "Returned request hash differs: " + row.id);
  const prefix = "decision-cache/" + row.requestSha256;
  const cacheFile = provider.cacheFile;
  assert([prefix + ".json", prefix + ".quota-recovery.json"].includes(cacheFile), "Unexpected decision-cache mapping.");
  if (cacheFile.endsWith(".quota-recovery.json")) {
    const first = read(join(import.meta.dir, "..", prefix + ".json"));
    assert.equal(first.requestSha256, row.requestSha256);
    assert.equal(first.http, 429, "Recovery can replace only an observed first-pass quota rejection.");
  }
  const filename = join(import.meta.dir, "..", cacheFile);
  const raw = existsSync(filename) ? read(filename) : null;
  if (raw) {
    assert.equal(raw.requestSha256, hash(row.request));
    assert.equal(raw.wireSha256, hash(nativeWire(row.request)), "Native Google payload differs from shared case semantics.");
    assert.equal(raw.requestedModel, model);
    assert.equal(raw.endpoint, endpoint);
  }
  const result = provider.outcome;
  if (!result.ok) {
    assert(typeof result.error?.code === "string");
    return { status: raw?.http ? "unavailable" : "not-observed", error: result.error.code, reportedModel: provider.reportedModel ?? null,
      http: raw?.http ?? null, cacheFile: raw ? cacheFile : null, wireSha256: raw?.wireSha256 ?? null };
  }
  assert(raw && raw.http >= 200 && raw.http < 300 && raw.payload?.answers, "Successful outcome lacks a successful recorded HTTP response.");
  assert.equal(result.response.backend.model, model);
  assert.equal(raw.payload.usage?.total_input_tokens, result.response.usage.inputTokens);
  assert.equal(raw.payload.usage?.total_output_tokens, result.response.usage.outputTokens);
  assert.deepEqual(Object.keys(result.response.answers).sort(), Object.keys(row.request.questions).sort());
  assert.deepEqual(Object.keys(raw.payload.answers).sort(), Object.keys(row.request.questions).sort());
  for (const [id, answer] of Object.entries(result.response.answers)) {
    assert.equal(answer.type, row.request.questions[id].type);
    // The native API additionally reports Noul confidence. The shared outcome retains P(yes).
    for (const [key, value] of Object.entries(answer)) assert.deepEqual(raw.payload.answers[id][key], value, "Reported answer differs from native receipt.");
  }
  const rawModel = raw.payload.model ?? raw.payload.model_version ?? raw.payload.modelVersion ?? null;
  assert.equal(provider.reportedModel ?? null, rawModel);
  return { status: "measured", error: null, http: raw.http, reportedModel: rawModel, cacheFile, wireSha256: raw.wireSha256,
    responseSha256: raw.responseSha256, usage: result.response.usage };
}

export async function score({ requests, reference, jobs, outcomeFile, hash, read, policy, manifestFileSha256, googleFileSha256 }) {
  assert.equal(outcomeFile.version, 1);
  assert(Array.isArray(outcomeFile.cases));
  const byId = new Map();
  for (const row of outcomeFile.cases) {
    assert(jobs.has(row.caseId) && !byId.has(row.caseId), "Unknown or repeated Gemini case ID.");
    byId.set(row.caseId, row);
  }
  const cases = [];
  for (const row of requests) {
    const ref = reference.find(r => r.id === row.id), returned = byId.get(row.id);
    const observation = observe(row, returned, hash, read);
    const gemini = observation.status === "measured" ? await jobs.get(row.id)(returned.outcome) : null;
    cases.push({ id: row.id, stage: row.stage, requestSha256: row.requestSha256, jevWireSha256: row.jevWireSha256,
      expected: ref.expected, jev: ref.jev, gemini, observation });
  }
  const plans = cases.filter(r => r.stage === "plan"), reviews = cases.filter(r => r.stage === "review");
  const coverage = rows => ({ scheduled: rows.length, measured: rows.filter(r => r.gemini).length,
    unavailable: rows.filter(r => r.observation.status === "unavailable").length, notObserved: rows.filter(r => r.observation.status === "not-observed").length });
  const planning = { ...coverage(plans), assessmentPreference: rates(plans, r => r.decisionMatches), offerFit: rates(plans, r => r.offerMatches),
    exactPreferenceAgreement: rate(plans.map(r => r.gemini ? r.jev.declined === r.gemini.declined : null)),
    actionAndOfferedTypesAgreement: rate(plans.map(r => r.gemini
      ? r.jev.action === r.gemini.action && [...r.jev.offered].sort().join(",") === [...r.gemini.offered].sort().join(",") : null)) };
  const review = { ...coverage(reviews), released: rates(reviews, r => r.gate === "released"),
    dispositionAgreement: rate(reviews.map(r => r.gemini ? r.jev.gate === r.gemini.gate : null)),
    sameBlockingRules: rate(reviews.map(r => r.gemini
      ? r.jev.blockers.map(b => b.id).sort().join(",") === r.gemini.blockers.map(b => b.id).sort().join(",") : null)) };
  return { version: 1, policy, models: {jev:"jev-1.14.0", gemini:model}, manifestFileSha256, googleFileSha256,
    planning, review, cases };
}
