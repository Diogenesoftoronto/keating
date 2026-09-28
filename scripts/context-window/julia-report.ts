#!/usr/bin/env bun
/** Compare one new CPU tape against retained baselines; performs no model calls. */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { digest, type Trial } from "./cases.js";
import { completeSchedule, summarize, type Receipt } from "./benchmark.js";

const [originalArg, juliaArg, reportArg, compactArg] = process.argv.slice(2);
if (!originalArg || !juliaArg || !reportArg) throw Error("Usage: bun scripts/context-window/julia-report.ts original-plan julia-directory output-json");
const original = JSON.parse(await readFile(originalArg, "utf8"));
const originalBody = { ...original }; delete originalBody.sha256;
if (digest(originalBody) !== original.sha256) throw Error("original-plan-integrity-failed");
const juliaDirectory = resolve(juliaArg), plan = JSON.parse(await readFile(join(juliaDirectory, "plan.json"), "utf8"));
const planBody = { ...plan }; delete planBody.sha256;
if (digest(planBody) !== plan.sha256 || plan.parentPlanSha256 !== original.sha256) throw Error("comparison-plan-integrity-failed");
const trials: Trial[] = plan.trials;
if (digest(trials) !== digest(original.trials)) throw Error("frozen-trials-changed");
const tape = async (path: string): Promise<Receipt[]> => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const baselineDirectory = join(resolve(originalArg, ".."), "execution");
const saved: Receipt[] = [], inputIntegrity: { provider: string; receipts: number; fileSha256: string }[] = [];
const scorePolicyProviders: Record<string, { successfulScoreOutputs: number; nonModalValues: number; receiptsSha256: string }> = {};
const trialLookup = new Map(trials.map(trial => [trial.id, trial]));
for (const provider of original.providers) {
  const path = join(baselineDirectory, provider.id, "receipts.jsonl"), contents = await readFile(path, "utf8");
  const rows: Receipt[] = contents.split("\n").filter(Boolean).map(line => JSON.parse(line));
  if (rows.some(row => row.providerId !== provider.id)) throw Error("baseline-provider-mismatch");
  saved.push(...rows);
  const fileSha256 = new Bun.CryptoHasher("sha256").update(contents).digest("hex");
  inputIntegrity.push({ provider: provider.id, receipts: rows.length, fileSha256 });
  let successfulScoreOutputs = 0, nonModalValues = 0;
  for (const row of rows) if (row.outcome.status === "ok") {
    const trial = trialLookup.get(row.trialId);
    if (!trial) throw Error("baseline-trial-mismatch");
    for (const [key, question] of Object.entries(trial.request.questions)) if (question.type === "score") {
      const answer = row.outcome.answers[key]!;
      if (!answer?.probabilities) throw Error("baseline-score-probabilities-missing");
      successfulScoreOutputs++;
      nonModalValues += Number(answer.probabilities[String(answer.value)] !== Math.max(...Object.values(answer.probabilities)));
    }
  }
  scorePolicyProviders[provider.id] = { successfulScoreOutputs, nonModalValues, receiptsSha256: fileSha256 };
}
const scorePolicyAudit = { originalPlanSha256: original.sha256,
  totalSuccessfulScoreOutputs: Object.values(scorePolicyProviders).reduce((n, provider) => n + provider.successfulScoreOutputs, 0),
  nonModalValues: Object.values(scorePolicyProviders).reduce((n, provider) => n + provider.nonModalValues, 0), providers: scorePolicyProviders,
  boundary: "Audits retained probability values as saved; raw expected-score metadata does not determine benchmark decoding." };
if (scorePolicyAudit.nonModalValues) throw Error("baseline-score-policy-mismatch");
const scorePolicyPath = join(juliaDirectory, "baseline-score-policy-audit.json");
try { if (digest(JSON.parse(await readFile(scorePolicyPath, "utf8"))) !== digest(scorePolicyAudit)) throw Error("saved-score-policy-audit-mismatch"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(scorePolicyPath, JSON.stringify(scorePolicyAudit, null, 2), { flag: "wx", mode: 0o600 }); }
const juliaRows = await tape(join(juliaDirectory, "receipts.jsonl")); saved.push(...juliaRows);
let identityAmendment: { recordedModelId: string; canonicalModelId: string; encoderVersion: string; maxLength: number; headLength: number; threads?: number; runnerSha256: string } | null = null;
try { identityAmendment = JSON.parse(await readFile(join(juliaDirectory, "identity-amendment.json"), "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
try { identityAmendment = JSON.parse(await readFile(join(juliaDirectory, "identity-amendment-v2.json"), "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (identityAmendment) {
  const run = JSON.parse(await readFile(join(juliaDirectory, "run.json"), "utf8"));
  if (identityAmendment.recordedModelId !== run.provider.model || identityAmendment.encoderVersion !== run.provider.nativeProvenance.encoderVersion
    || identityAmendment.maxLength !== run.provider.nativeProvenance.maxLength || identityAmendment.headLength !== run.provider.nativeProvenance.headLength
    || identityAmendment.runnerSha256 !== run.runnerSha256 || identityAmendment.threads !== undefined && identityAmendment.threads !== run.provider.nativeProvenance.threads
    || identityAmendment.canonicalModelId !== `${identityAmendment.recordedModelId}/${identityAmendment.encoderVersion}/context${identityAmendment.maxLength}-head${identityAmendment.headLength}${identityAmendment.threads === undefined ? "" : `/threads${identityAmendment.threads}`}`) throw Error("identity-amendment-mismatch");
}
const strict = completeSchedule(trials, plan.providers, plan.repetitions, saved);
const fixed = structuredClone(strict);
for (const row of fixed) if (row.outcome.status === "ok") for (const answer of Object.values(row.outcome.answers)) {
  if (answer.probabilities && Object.keys(answer.probabilities).length === 2
    && Object.hasOwn(answer.probabilities, "false") && Object.hasOwn(answer.probabilities, "true")) answer.value = answer.probabilities.true! > 0.5;
}
const languages = original.languages as string[];
const subset = (test: (trial: Trial) => boolean, rows: Receipt[]) => {
  const selected = trials.filter(test), ids = new Set(selected.map(trial => trial.id));
  return summarize(selected, rows.filter(row => ids.has(row.trialId)));
};
const labelledSubset = (test: (key: string, trial: Trial) => boolean, rows: Receipt[]) => summarize(trials.map(trial => ({ ...trial,
  expected: Object.fromEntries(Object.entries(trial.expected).filter(([key]) => test(key, trial))),
  fullExpected: Object.fromEntries(Object.entries(trial.fullExpected).filter(([key]) => test(key, trial))) })), rows);
const errors = Object.fromEntries(plan.providers.map((provider: { id: string }) => [provider.id,
  strict.filter(row => row.providerId === provider.id && row.outcome.status === "error").map(row => ({ trialId: row.trialId,
    error: row.outcome.status === "error" ? row.outcome.error : null, status: row.status }))]));
const timings = Object.fromEntries(plan.providers.map((provider: { id: string }) => {
  const rows = strict.filter(row => row.providerId === provider.id), times = rows.filter(row => row.outcome.status === "ok").map(row => row.outcome.latencyMs).sort((a, b) => a - b);
  const summedAttemptMs = rows.reduce((n, row) => n + row.outcome.latencyMs, 0);
  const questions = rows.reduce((n, row) => n + (row.outcome.status === "ok" ? Object.keys(row.outcome.answers).length : 0), 0);
  return [provider.id, { successfulBatches: times.length, completedQuestions: questions, summedAttemptMs,
    medianBatchMs: times.length ? (times[Math.floor((times.length - 1) / 2)]! + times[Math.floor(times.length / 2)]!) / 2 : null,
    p95BatchMs: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
    questionsPerSummedAttemptSecond: summedAttemptMs ? questions / (summedAttemptMs / 1000) : null,
    boundary: provider.id === "julia-1-onnx-cpu" ? "local CPU FP32 ONNX + strict encoding" : provider.id === "jev" ? "retained hosted HTTP" : "retained historical native GPU/HTTP; see original provenance" }];
}));
const byKey = new Map(fixed.map(row => [`${row.providerId}|${row.trialId}`, row]));
const juliaId = "julia-1-onnx-cpu";
const paired = Object.fromEntries(original.providers.map((provider: { id: string }) => {
  const families = new Map<string, { labels: number; delta: number }>();
  for (const trial of trials) {
    const family = families.get(trial.family) ?? { labels: 0, delta: 0 };
    for (const [question, expected] of Object.entries(trial.expected)) {
      const correct = (id: string) => { const row = byKey.get(`${id}|${trial.id}`); return Number(row?.outcome.status === "ok" && row.outcome.answers[question]?.value === expected); };
      family.labels++; family.delta += correct(juliaId) - correct(provider.id);
    }
    families.set(trial.family, family);
  }
  const groups = [...families.values()], draws: number[] = [];
  let seed = 20260928;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let iteration = 0; iteration < 5000; iteration++) {
    let labels = 0, delta = 0;
    for (let i = 0; i < groups.length; i++) { const family = groups[Math.floor(random() * groups.length)]!; labels += family.labels; delta += family.delta; }
    draws.push(delta / labels);
  }
  draws.sort((a, b) => a - b);
  return [provider.id, { accuracyDifference: groups.reduce((n, group) => n + group.delta, 0) / groups.reduce((n, group) => n + group.labels, 0),
    descriptiveFamilyBootstrap95: [draws[124], draws[4874]], independentFamilies: groups.length, draws: 5000, seed: 20260928 }];
}));
const evidenceTrials = trials.filter(trial => Object.hasOwn(trial.expected, "evidence"));
const firstEvidenceCorrect = evidenceTrials.filter(trial => {
  const question = trial.request.questions.evidence!;
  return question.type === "choice" && Object.keys(question.criteria)[0] === trial.expected.evidence;
}).length;
const result = { originalPlanSha256: original.sha256, comparisonPlanSha256: plan.sha256,
  identityAmendment,
  plannedTrialsPerModel: trials.length, requestedQuestionsPerModel: trials.reduce((n, trial) => n + Object.keys(trial.request.questions).length, 0),
  authoredLabelsPerModel: trials.reduce((n, trial) => n + Object.keys(trial.expected).length, 0), independentFamilies: 25, languages,
  retainedBaselineIntegrity: inputIntegrity,
  notices: ["All 300 original trials, 9,132 questions, 972 authored labels, evidence and request hashes are unchanged. The 12 historical tapes were replayed, not rerun.",
    "Strict Noul policy: false at p<=0.2, true at p>=0.8, otherwise abstain. Fixed diagnostic: false at p<=0.5, true at p>0.5. Choice/Score modal selections unchanged. Failures and abstentions remain in planned-label denominators.",
    "972 labels are authored synthetic fixture assertions. The other 8,160 outputs have no accuracy claim. Agreement with prior models is not truth or human learning effectiveness.",
    "Six language variants share 25 source families, not 150 independent families. Family bootstrap intervals are descriptive and unadjusted for multiple comparisons.",
    "Evidence selection is exact authored sentence-choice accuracy, separate from ordinal grading and boolean decisions. It is not validated citation-grounding or learning efficacy.",
    "Julia's shipped FP32 ONNX/Rust-compatible serialization differs from original Python JSON encoding. No original-Python prediction parity or mobile speed is claimed.",
    "CPU Julia and historical GPU/HTTP baselines have different hardware and transport. Latency includes tokenization/preflight plus inference, excludes downloads, and is not saturation throughput. Julia's first batch also includes lazy tokenizer/session loading; historical baseline loading boundaries differ.",
    "Vendor benchmark figures are external claims, not measurements from this frozen Keating comparison.",
    "Historical baseline probability precision remains exactly as saved; rounding lost in those tapes cannot be recovered. New Julia probabilities are unrounded."],
  strict: summarize(trials, strict), fixedCutoff: summarize(trials, fixed),
  byLanguage: Object.fromEntries(languages.map(language => [language, {
    strict: subset(trial => (trial as Trial & { language: string }).language === language, strict),
    fixedCutoff: subset(trial => (trial as Trial & { language: string }).language === language, fixed) }])),
  byStage: Object.fromEntries(["planning", "adherence", "grading"].map(stage => [stage, {
    strict: subset(trial => trial.stage === stage, strict), fixedCutoff: subset(trial => trial.stage === stage, fixed) }])),
  booleanLabels: { strict: labelledSubset((key, trial) => trial.request.questions[key]!.type === "noul", strict), fixedCutoff: labelledSubset((key, trial) => trial.request.questions[key]!.type === "noul", fixed) },
  gradingLabels: labelledSubset((key, trial) => key === "score" && trial.stage === "grading", fixed),
  evidenceSelection: { summary: labelledSubset((key, trial) => key === "evidence" && trial.stage === "grading", fixed),
    firstCandidateCorrect: firstEvidenceCorrect, planned: evidenceTrials.length,
    uniformRandomExpectedCorrect: evidenceTrials.reduce((n, trial) => { const question = trial.request.questions.evidence!; return n + (question.type === "choice" ? 1 / Object.keys(question.criteria).length : 0); }, 0) },
  timings, errors, pairedJuliaMinusBaseline: paired,
  juliaContextProof: { successfulTrials: juliaRows.filter(row => row.outcome.status === "ok").length,
    strictEncodedQuestions: juliaRows.reduce((n, row) => n + (row.outcome.status === "ok" ? Object.keys(row.outcome.answers).length : 0), 0) } };
const fullJson = JSON.stringify(result, null, 2);
await writeFile(reportArg, fullJson, { flag: "wx", mode: 0o600 });
if (compactArg) {
  const files = ["plan.json", "gold-free-input.json", "run.json", "runner.mjs", "receipts.jsonl", "completion.json", "audit.json", "context-audit.json", "baseline-score-policy-audit.json"];
  const artifacts = [];
  for (const name of [...files, "identity-amendment.json", "identity-amendment-v2.json"]) {
    try {
      const contents = await readFile(join(juliaDirectory, name));
      artifacts.push({ path: relative(process.cwd(), join(juliaDirectory, name)), bytes: contents.byteLength,
        sha256: new Bun.CryptoHasher("sha256").update(contents).digest("hex") });
    } catch (error) { if (!name.startsWith("identity-amendment") || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const run = JSON.parse(await readFile(join(juliaDirectory, "run.json"), "utf8"));
  const compact = {
    schemaVersion: 1, originalPlanSha256: original.sha256, comparisonPlanSha256: plan.sha256,
    plannedTrialsPerModel: result.plannedTrialsPerModel, requestedQuestionsPerModel: result.requestedQuestionsPerModel,
    authoredLabelsPerModel: result.authoredLabelsPerModel, sharedSourceFamilies: 25, languages,
    identityAmendment, execution: run, notices: result.notices,
    providerProvenance: plan.providers.map(({ id, kind, model, expectedModel, nativeProvenance, headRevision, encoderRevision }: {
      id: string; kind: string; model: string; expectedModel?: string; nativeProvenance?: unknown; headRevision?: string; encoderRevision?: string;
    }) => ({ id, kind, model, expectedModel, nativeProvenance, headRevision, encoderRevision })),
    models: Object.fromEntries(plan.providers.map((provider: { id: string; model: string }) => {
      const id = provider.id, s = result.strict.models[id]!, f = result.fixedCutoff.models[id]!;
      return [id, { requestedModel: provider.model, planned: s.planned, completed: s.completed, errors: s.errors, undispatched: s.undispatched,
        plannedLabels: s.labelled, strictCorrect: s.correct, strictAbstentions: s.abstentions, strictAccuracy: s.accuracyAllPlannedLabels,
        fixedCorrect: f.correct, fixedAccuracy: f.accuracyAllPlannedLabels,
        boolean: { planned: result.booleanLabels.fixedCutoff.models[id]!.labelled,
          correct: result.booleanLabels.fixedCutoff.models[id]!.correct,
          balancedAccuracy: result.booleanLabels.fixedCutoff.models[id]!.balancedAccuracy,
          brier: result.booleanLabels.fixedCutoff.models[id]!.brier },
        gradingCorrect: result.gradingLabels.models[id]!.correct, evidenceCorrect: result.evidenceSelection.summary.models[id]!.correct,
        languages: Object.fromEntries(languages.map(language => [language, {
          plannedLabels: result.byLanguage[language]!.strict.models[id]!.labelled,
          strictCorrect: result.byLanguage[language]!.strict.models[id]!.correct,
          strictAbstentions: result.byLanguage[language]!.strict.models[id]!.abstentions,
          fixedCorrect: result.byLanguage[language]!.fixedCutoff.models[id]!.correct }])),
        timing: result.timings[id] }];
    })), evidenceSelectionControl: { firstCandidateCorrect: result.evidenceSelection.firstCandidateCorrect,
      planned: result.evidenceSelection.planned, uniformRandomExpectedCorrect: result.evidenceSelection.uniformRandomExpectedCorrect },
    pairedJuliaMinusBaseline: paired, errors, baselineScorePolicyAudit: scorePolicyAudit,
    audit: JSON.parse(await readFile(join(juliaDirectory, "audit.json"), "utf8")),
    contextAudit: JSON.parse(await readFile(join(juliaDirectory, "context-audit.json"), "utf8")),
    retainedBaselineArtifacts: inputIntegrity.map(input => ({ ...input, path: relative(process.cwd(), join(baselineDirectory, input.provider, "receipts.jsonl")) })),
    artifacts, fullReport: { path: relative(process.cwd(), resolve(reportArg)), sha256: new Bun.CryptoHasher("sha256").update(fullJson).digest("hex") },
  };
  await writeFile(compactArg, JSON.stringify(compact, null, 2), { flag: "wx", mode: 0o644 });
}
console.log(JSON.stringify({ output: reportArg, models: plan.providers.length, plannedReceipts: strict.length, savedReceipts: saved.length, newModelCalls: 0 }));
