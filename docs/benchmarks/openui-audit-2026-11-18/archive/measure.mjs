import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tryCompileOpenUISourceToSharedDocument } from "../../../../packages/learner-contracts/src/openui-source.ts";
import { parseOpenUIMessageSegments } from "../../../../web/src/keating/openui/segments.ts";

// Offline replay of one executed benchmark. Run with Bun from any directory.
const runId = "2026-09-21T23-55-00-055Z-2ed0179e";
const earlierRunId = "2026-09-21T23-52-25-863Z-b8f71522";
const root = resolve(import.meta.dir, "../../../..");
const archives = join(root, ".keating/benchmarks/prompt-adherence");
const directory = join(archives, runId);
const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
const targetCases = ["independent-next-checkpoint", "practice-without-prerequisite-lesson"];
const models = manifest.models.map(model => model.id);
const hash = value => createHash("sha256").update(value).digest("hex");

function readTrials(fromDirectory) {
  return readdirSync(fromDirectory).filter(name => /^trial-\d{4}\.json$/.test(name)).sort().map(name => {
    const bytes = readFileSync(join(fromDirectory, name));
    const receipt = JSON.parse(bytes.toString("utf8"));
    assert.equal(name, `trial-${String(receipt.ordinal).padStart(4, "0")}.json`);
    return { receipt, sha256: hash(bytes) };
  });
}

// Use the web message splitter and canonical contract compiler. A mention, invalid
// fence, or empty document contributes no usable node. A markdown node is display-only.
function inspect(generation) {
  const { reply, error, finishReason } = generation;
  if (error || !reply.text.trim() || finishReason !== "stop") return null;
  const types = new Set();
  const errors = [];
  const segments = parseOpenUIMessageSegments(reply.text).filter(segment => segment.type === "openui");
  for (const segment of segments) {
    if (!segment.complete) {
      errors.push("incomplete");
      continue;
    }
    let document = segment.document;
    if (segment.format === "source") {
      const compiled = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
        documentId: segment.metadata.id, createdAt: "2026-01-01T00:00:00.000Z",
      });
      if (compiled.ok) document = compiled.document;
      else errors.push(compiled.message);
    } else if (segment.error) {
      errors.push(segment.error);
    }
    for (const node of document?.nodes ?? []) types.add(node.type);
  }
  const question = types.has("question") || types.has("question-group");
  return {
    any: types.size > 0, question, quiz: types.has("quiz"), responseSurface: question || types.has("quiz"),
    fence: segments.length > 0, errors, types: [...types].sort(),
  };
}

function count(rows, predicate) {
  return rows.filter(predicate).length;
}

function tally(values) {
  const groups = {};
  for (const value of values) groups[value] = (groups[value] ?? 0) + 1;
  return groups;
}

const files = readTrials(directory);
const rows = files.map(({ receipt }) => ({
  ...receipt, ui: inspect(receipt.generation), modelId: receipt.model.id,
}));
const cell = (caseId, modelId, arm) => [caseId, modelId, arm].join("|");
const lookup = new Map(rows.map(row => [cell(row.caseId, row.modelId, row.arm), row]));
assert.equal(manifest.mode, "execute");
assert.equal(manifest.options.repetitions, 1);
assert.equal(manifest.scheduledTrials, 72);
assert.equal(rows.length, manifest.scheduledTrials);
assert.equal(lookup.size, rows.length, "duplicate case/model/arm");
for (const model of models) {
  for (const caseId of manifest.caseIds) {
    for (const arm of manifest.arms) assert.ok(lookup.has(cell(caseId, model, arm)));
  }
}
assert.ok(rows.filter(row => row.ui).every(row => row.generation.resolvedModel === row.model.model));
assert.ok(rows.filter(row => row.arm === "compact").every(row => !row.plan && !row.preJudge));
const governed = rows.filter(row => row.arm === "governed");
assert.ok(governed.every(row => row.plan?.status === "guided" && row.preJudge?.outcome?.ok
  && row.preJudge.outcome.response.backend.backend === "system-one"
  && row.preJudge.outcome.response.backend.model === manifest.judgeModel));

const pairs = [];
for (const caseId of manifest.caseIds) {
  for (const modelId of models) {
    const compact = lookup.get(cell(caseId, modelId, "compact"));
    const guided = lookup.get(cell(caseId, modelId, "governed"));
    pairs.push({ caseId, modelId, compact, guided, usable: !!(compact.ui && guided.ui) });
  }
}

function compare(group, metric) {
  const matched = group.filter(pair => pair.usable);
  const both = count(matched, p => p.compact.ui[metric] && p.guided.ui[metric]);
  const compactOnly = count(matched, p => p.compact.ui[metric] && !p.guided.ui[metric]);
  const governedOnly = count(matched, p => !p.compact.ui[metric] && p.guided.ui[metric]);
  return {
    scheduled: group.length, matched: matched.length, compact: both + compactOnly, governed: both + governedOnly,
    both, compactOnly, governedOnly, neither: matched.length - both - compactOnly - governedOnly,
  };
}

function labelAgreement(group) {
  const labels = [];
  for (const row of group) {
    for (const [key, target] of Object.entries(row.decisionLabels)) {
      const actual = row.plan.decisions[key];
      assert.ok(actual === true || actual === false || actual == null);
      labels.push(actual == null ? "unresolved" : actual === target ? "agree" : "disagree");
    }
  }
  return {
    total: labels.length, agree: count(labels, value => value === "agree"),
    disagree: count(labels, value => value === "disagree"), unresolved: count(labels, value => value === "unresolved"),
  };
}

function inspectArm(arm) {
  const group = rows.filter(row => row.arm === arm);
  const usable = group.filter(row => row.ui);
  return {
    scheduled: group.length, usable: usable.length, valid: count(usable, row => row.ui.any),
    question: count(usable, row => row.ui.question), quiz: count(usable, row => row.ui.quiz),
    invalidFence: count(usable, row => row.ui.errors.length), noFence: count(usable, row => !row.ui.fence),
    generationErrors: tally(group.map(row => row.generation.error).filter(Boolean)),
    finalAssessment: tally(group.map(row => row.status)), releaseFlag: tally(group.map(row => row.release)),
  };
}

function outputFor(row) {
  if (!row.ui) return row.generation.error ?? row.generation.finishReason;
  if (row.ui.any) return row.ui.types.join(" + ");
  return row.ui.errors.length ? row.ui.errors.join(" / ") : "prose";
}

const targets = pairs.filter(pair => targetCases.includes(pair.caseId));
const practiceDirective = "Provide one requested OpenUI practice activity now, without requiring a lesson first or attaching a study plan.";
const requested = targets.map(({ caseId, modelId, compact, guided }) => {
  const drafted = lookup.get(cell(caseId, modelId, "drafted"));
  const privateGenerations = drafted.draft.generations.map(trial => inspect(trial.result));
  return {
    caseId, modelId, compactOrdinal: compact.ordinal, compact: outputFor(compact),
    governedOrdinal: guided.ordinal, governed: outputFor(guided), governedFinal: guided.release,
    governedFailedChecks: guided.assessment.failed, governedUncertainChecks: guided.assessment.uncertain,
    jevRequestedPractice: guided.plan.decisions.practice_requested,
    jevPracticeProbability: guided.preJudge.outcome.response.answers.practice_requested.noul,
    practiceDirectivePresent: guided.plan.directives.includes(practiceDirective),
    draftedOrdinal: drafted.ordinal, draftedAttempts: privateGenerations.length,
    privateAttemptsWithResponseSurface: count(privateGenerations, ui => ui?.responseSurface),
    draftSelectedAttempt: drafted.draft.diagnostics.selectedAttempt, drafted: outputFor(drafted),
    internalDraftStatus: drafted.draft.status, blindFinal: drafted.release,
  };
});
const earlier = readTrials(join(archives, earlierRunId)).map(({ receipt }) => receipt);
const finalTexts = rows.filter(row => row.ui).map(row => hash(row.generation.reply.text));
const drafted = rows.filter(row => row.arm === "drafted");
const report = {
  runId, createdAt: manifest.createdAt, judgeModel: manifest.judgeModel, policyVersion: manifest.policyVersion,
  corpusSha256: manifest.selectedCorpusSha256, manifestSha256: hash(readFileSync(join(directory, "manifest.json"))),
  trialBundleSha256: hash(files.map(row => row.sha256).join("\n")),
  cases: manifest.caseIds, models, scheduled: rows.length, repetitions: manifest.options.repetitions,
  duplicateCells: rows.length - lookup.size, completeFinalTexts: finalTexts.length,
  duplicateCompleteFinalTexts: finalTexts.length - new Set(finalTexts).size,
  arms: Object.fromEntries(manifest.arms.map(arm => [arm, inspectArm(arm)])),
  matchedAll: Object.fromEntries(["any", "question", "quiz", "responseSurface"].map(key => [key, compare(pairs, key)])),
  matchedAnyByModel: Object.fromEntries(models.map(model => [model, compare(pairs.filter(p => p.modelId === model), "any")])),
  matchedPractice: compare(targets, "responseSurface"),
  matchedPracticeByModel: Object.fromEntries(models.map(model => [model, compare(targets.filter(p => p.modelId === model), "responseSurface")])),
  exclusionsFromMatching: pairs.filter(pair => !pair.usable).map(({ caseId, modelId, compact, guided }) => ({
    caseId, modelId, compact: outputFor(compact), governed: outputFor(guided),
  })),
  governedDecisions: { guided: governed.length, labels: labelAgreement(governed), practiceDirective },
  privateDrafts: {
    internal: tally(drafted.map(row => row.draft.status)), blindFinal: tally(drafted.map(row => row.release)),
    totalPrivateGenerations: drafted.reduce((sum, row) => sum + row.draft.generations.length, 0),
    targetTurnsWithAnyPrivateResponseSurface: count(requested, row => row.privateAttemptsWithResponseSurface > 0),
    targetInternalReleases: count(requested, row => row.internalDraftStatus === "released"),
    targetBlindFinalWouldRelease: count(requested, row => row.blindFinal === "would-release"),
  },
  requestedPractice: requested,
  excludedEarlierRun: { runId: earlierRunId, total: earlier.length, statuses: tally(earlier.map(row => row.status)),
    generationErrors: tally(earlier.map(row => row.generation.error)) },
};
console.log(JSON.stringify(report, null, 2));
