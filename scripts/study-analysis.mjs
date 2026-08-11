import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { runBenchmarkSuite } from "../src/core/benchmark.ts";
import { mapElitesEvolve } from "../src/core/map-elites.ts";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, clampPolicy } from "../src/core/policy.ts";

const SCORE_KEYS = ["mastery", "engagement", "clarity"];
const GENERATED_DIR = join(process.cwd(), "docs", "generated");
const TRACE_DIR = join(process.cwd(), "test", "traces");
const SNAPSHOT_PATH = join(process.cwd(), "test", "final_dataset.json");
const EVALUATED_POLICY_PATH = join(process.cwd(), "docs", "study", "evaluated-policy.json");
const STUDY_SOFTWARE_VERSION = "3.3.0";
const BENCHMARK_SEED_COUNT = 200;
const EVOLUTION_RUN_COUNT = 30;
const EVOLUTION_ITERATIONS = 24;
const EVOLUTION_FOCUS_TOPIC = "derivative";

// The paper evaluates the deterministic fallback even when the caller's shell
// enables optional provider judging for interactive benchmark work.
process.env.KEATING_LLM_BENCHMARK = "0";

const ROLE_CONTAMINATION_PATTERNS = [
  { label: "teacherly_opener", pattern: /^(great|excellent)\b/i },
  { label: "teacherly_transition", pattern: /^let'?s\b/i },
  { label: "teacher_label", pattern: /^(\*\*)?teacher[:*]/i },
  { label: "assistant_disclaimer", pattern: /\bto the best of my knowledge\b/i },
  { label: "assistant_closure", pattern: /\bi'?m here to help\b/i },
  { label: "summary_recitation", pattern: /\bhere'?s a quick recap\b/i },
  { label: "completeness_disclaimer", pattern: /\bcomprehensive response\b/i }
];

const REDIRECTION_PATTERNS = [
  /\bin your own words\b/i,
  /\byour turn\b/i,
  /\bapply\b/i,
  /\bwalk through\b/i,
  /\bwhat do you notice\b/i,
  /\btell me\b/i,
  /\bwithout looking\b/i
];

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * probability))
  );
  return sortedValues[index];
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bootstrapSummary(values, seed, resamples = 5000) {
  const generator = lcg(seed);
  const n = values.length;
  const estimates = [];
  for (let sampleIndex = 0; sampleIndex < resamples; sampleIndex += 1) {
    let total = 0;
    for (let draw = 0; draw < n; draw += 1) {
      const idx = Math.floor(generator() * n);
      total += values[idx];
    }
    estimates.push(total / n);
  }
  estimates.sort((left, right) => left - right);
  return {
    mean: round(mean(values)),
    ciLow: round(quantile(estimates, 0.025)),
    ciHigh: round(quantile(estimates, 0.975))
  };
}

function summarizeNumberSeries(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: round(mean(values)),
    min: round(sorted[0] ?? 0),
    p025: round(quantile(sorted, 0.025)),
    median: round(quantile(sorted, 0.5)),
    p975: round(quantile(sorted, 0.975)),
    max: round(sorted[sorted.length - 1] ?? 0)
  };
}

function wordCount(text) {
  return (text.match(/\S+/g) ?? []).length;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function sha256TraceCorpus() {
  const names = (await readdir(TRACE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const hash = createHash("sha256");
  for (const name of names) {
    hash.update(name);
    hash.update("\0");
    hash.update(await readFile(join(TRACE_DIR, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function normalizeScores(record) {
  const normalized = deepClone(record);
  const corrections = [];
  for (const metric of SCORE_KEYS) {
    const original = normalized.scores[metric];
    if (original > 1 && original <= 10) {
      normalized.scores[metric] = original / 10;
      corrections.push({
        metric,
        before: original,
        after: normalized.scores[metric],
        rule: "divide_by_10_if_score_in_(1,10]"
      });
    }
  }
  return { normalized, corrections };
}

function deriveConversationFeatures(record) {
  const teacherTurns = record.conversation.filter((turn) => turn.role === "teacher");
  const studentTurns = record.conversation.filter((turn) => turn.role === "student");
  const contaminationMatches = [];

  for (const turn of studentTurns) {
    for (const { label, pattern } of ROLE_CONTAMINATION_PATTERNS) {
      if (pattern.test(turn.content)) {
        contaminationMatches.push(label);
      }
    }
  }

  const teacherRedirections = teacherTurns.flatMap((turn) =>
    REDIRECTION_PATTERNS.filter((pattern) => pattern.test(turn.content)).map((pattern) => pattern.source)
  );

  return {
    turnCount: record.conversation.length,
    teacherTurns: teacherTurns.length,
    studentTurns: studentTurns.length,
    emptyTurns: record.conversation.filter((turn) => turn.content.trim().length === 0).length,
    teacherWordCount: teacherTurns.reduce((total, turn) => total + wordCount(turn.content), 0),
    studentWordCount: studentTurns.reduce((total, turn) => total + wordCount(turn.content), 0),
    roleContaminationCount: contaminationMatches.length,
    roleContaminationLabels: [...new Set(contaminationMatches)].sort(),
    redirectionCueCount: teacherRedirections.length
  };
}

function compositeScore(record) {
  return mean(SCORE_KEYS.map((metric) => record.scores[metric]));
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadTraceRecords() {
  const names = (await readdir(TRACE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const records = [];
  for (const name of names) {
    const filePath = join(TRACE_DIR, name);
    records.push({
      fileName: name,
      ...(await loadJson(filePath))
    });
  }
  return records;
}

function selectLatestTracePerPair(records) {
  const grouped = groupBy(records, (record) => `${record.topic}::${record.learner}`);
  const retained = [];
  const excluded = [];
  for (const entries of grouped.values()) {
    const ordered = [...entries].sort((left, right) => left.timestamp - right.timestamp);
    const latest = ordered[ordered.length - 1];
    retained.push(latest);
    excluded.push(
      ...ordered.slice(0, -1).map((record) => ({
        topic: record.topic,
        learner: record.learner,
        fileName: record.fileName,
        timestamp: record.timestamp
      }))
    );
  }
  retained.sort((left, right) =>
    `${left.topic}::${left.learner}`.localeCompare(`${right.topic}::${right.learner}`)
  );
  excluded.sort((left, right) => left.timestamp - right.timestamp);
  return { retained, excluded };
}

function compareSnapshotAgainstRetained(snapshotRecords, retainedRecords) {
  const snapshotMap = new Map(
    snapshotRecords.map((record) => [`${record.topic}::${record.learner}`, record])
  );
  const retainedMap = new Map(
    retainedRecords.map((record) => {
      const { fileName: _fileName, ...traceContent } = record;
      return [`${record.topic}::${record.learner}`, traceContent];
    })
  );
  const mismatches = [];
  const keys = [...new Set([...snapshotMap.keys(), ...retainedMap.keys()])].sort();
  for (const key of keys) {
    const snapshotRecord = snapshotMap.get(key);
    const retainedRecord = retainedMap.get(key);
    if (canonicalJson(snapshotRecord) !== canonicalJson(retainedRecord)) {
      mismatches.push({
        pair: key,
        snapshotTimestamp: snapshotRecord?.timestamp ?? null,
        retainedTimestamp: retainedRecord?.timestamp ?? null,
        contentMatches: false
      });
    }
  }
  return {
    snapshotCount: snapshotRecords.length,
    retainedCount: retainedRecords.length,
    matchesLatestTraceSelection: mismatches.length === 0,
    mismatches
  };
}

function summarizeExternalEvaluation(records) {
  const normalizedRecords = [];
  const scoreCorrections = [];

  for (const rawRecord of records) {
    const { normalized, corrections } = normalizeScores(rawRecord);
    const features = deriveConversationFeatures(normalized);
    normalized.features = features;
    normalized.overall = compositeScore(normalized);
    normalizedRecords.push(normalized);
    if (corrections.length > 0) {
      scoreCorrections.push({
        topic: rawRecord.topic,
        learner: rawRecord.learner,
        timestamp: rawRecord.timestamp,
        corrections
      });
    }
  }

  const overallBootstrap = bootstrapSummary(
    normalizedRecords.map((record) => record.overall),
    20260403
  );

  const topicSummary = [...groupBy(normalizedRecords, (record) => record.topic).entries()]
    .map(([topic, entries], index) => ({
      topic,
      n: entries.length,
      overall: bootstrapSummary(
        entries.map((record) => record.overall),
        20260403 + index
      ),
      mastery: bootstrapSummary(
        entries.map((record) => record.scores.mastery),
        20260503 + index
      ),
      engagement: bootstrapSummary(
        entries.map((record) => record.scores.engagement),
        20260603 + index
      ),
      clarity: bootstrapSummary(
        entries.map((record) => record.scores.clarity),
        20260703 + index
      )
    }))
    .sort((left, right) => right.overall.mean - left.overall.mean);

  const learnerSummary = [...groupBy(normalizedRecords, (record) => record.learner).entries()]
    .map(([learner, entries], index) => ({
      learner,
      n: entries.length,
      overall: bootstrapSummary(
        entries.map((record) => record.overall),
        20260803 + index
      ),
      mastery: bootstrapSummary(
        entries.map((record) => record.scores.mastery),
        20260903 + index
      ),
      engagement: bootstrapSummary(
        entries.map((record) => record.scores.engagement),
        20261003 + index
      ),
      clarity: bootstrapSummary(
        entries.map((record) => record.scores.clarity),
        20261103 + index
      )
    }))
    .sort((left, right) => right.overall.mean - left.overall.mean);

  const contaminationGroups = {
    noContamination: normalizedRecords.filter((record) => record.features.roleContaminationCount === 0),
    anyContamination: normalizedRecords.filter((record) => record.features.roleContaminationCount > 0)
  };

  return {
    recordCount: normalizedRecords.length,
    scoreCorrections,
    overall: overallBootstrap,
    topicSummary,
    learnerSummary,
    contaminationContrast: {
      noContamination: {
        n: contaminationGroups.noContamination.length,
        masteryMean: round(mean(contaminationGroups.noContamination.map((record) => record.scores.mastery))),
        overallMean: round(mean(contaminationGroups.noContamination.map((record) => record.overall)))
      },
      anyContamination: {
        n: contaminationGroups.anyContamination.length,
        masteryMean: round(mean(contaminationGroups.anyContamination.map((record) => record.scores.mastery))),
        overallMean: round(mean(contaminationGroups.anyContamination.map((record) => record.overall)))
      }
    },
    records: normalizedRecords
      .map((record) => ({
        topic: record.topic,
        learner: record.learner,
        timestamp: record.timestamp,
        overall: round(record.overall),
        mastery: round(record.scores.mastery),
        engagement: round(record.scores.engagement),
        clarity: round(record.scores.clarity),
        features: record.features
      }))
      .sort((left, right) => right.overall - left.overall)
  };
}

function summarizeSyntheticRuns(runs) {
  return {
    defaultOverall: summarizeNumberSeries(runs.map((run) => run.defaultOverall)),
    currentOverall: summarizeNumberSeries(runs.map((run) => run.currentOverall)),
    deltaOverall: {
      ...summarizeNumberSeries(runs.map((run) => run.deltaOverall)),
      wins: runs.filter((run) => run.deltaOverall > 0).length
    },
    derivativeDelta: summarizeNumberSeries(runs.map((run) => run.derivativeDelta)),
    nonDerivativeDelta: summarizeNumberSeries(runs.map((run) => run.nonDerivativeDelta))
  };
}

async function runSyntheticBenchmarkAnalysis(currentPolicy) {
  const runs = [];
  const topicDeltas = new Map();

  for (let seed = 1; seed <= BENCHMARK_SEED_COUNT; seed += 1) {
    const baseline = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, undefined, seed);
    const current = await runBenchmarkSuite(process.cwd(), currentPolicy, undefined, seed);

    const derivativeDelta =
      current.topicBenchmarks.find((entry) => entry.topic.slug === "derivative")?.meanScore -
      baseline.topicBenchmarks.find((entry) => entry.topic.slug === "derivative")?.meanScore;
    const nonDerivativeEntries = current.topicBenchmarks
      .map((entry, index) => entry.meanScore - baseline.topicBenchmarks[index].meanScore)
      .filter((_, index) => baseline.topicBenchmarks[index].topic.slug !== "derivative");

    runs.push({
      seed,
      defaultOverall: round(baseline.overallScore),
      currentOverall: round(current.overallScore),
      deltaOverall: round(current.overallScore - baseline.overallScore),
      derivativeDelta: round(derivativeDelta),
      nonDerivativeDelta: round(mean(nonDerivativeEntries))
    });

    for (let topicIndex = 0; topicIndex < baseline.topicBenchmarks.length; topicIndex += 1) {
      const topicTitle = baseline.topicBenchmarks[topicIndex].topic.title;
      const delta = current.topicBenchmarks[topicIndex].meanScore - baseline.topicBenchmarks[topicIndex].meanScore;
      if (!topicDeltas.has(topicTitle)) topicDeltas.set(topicTitle, []);
      topicDeltas.get(topicTitle).push(delta);
    }
  }

  const topicSummary = [...topicDeltas.entries()]
    .map(([topic, deltas]) => {
      const sorted = [...deltas].sort((left, right) => left - right);
      return {
        topic,
        meanDelta: round(mean(deltas)),
        p025: round(quantile(sorted, 0.025)),
        p975: round(quantile(sorted, 0.975)),
        wins: deltas.filter((delta) => delta > 0).length
      };
    })
    .sort((left, right) => left.meanDelta - right.meanDelta);

  const ablationFields = [
    "analogyDensity",
    "socraticRatio",
    "formalism",
    "retrievalPractice",
    "exerciseCount",
    "diagramBias",
    "reflectionBias",
    "interdisciplinaryBias",
    "challengeRate"
  ];

  const ablations = (await Promise.all(
    ablationFields.map(async (field) => {
      const deltas = [];
      const ablatedPolicy = {
        ...DEFAULT_POLICY,
        [field]: currentPolicy[field],
        name: `ablate-${field}`
      };
      for (let seed = 1; seed <= BENCHMARK_SEED_COUNT; seed += 1) {
        deltas.push(
          (await runBenchmarkSuite(process.cwd(), ablatedPolicy, undefined, seed)).overallScore -
          (await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, undefined, seed)).overallScore
        );
      }
      const sorted = [...deltas].sort((left, right) => left - right);
      return {
        field,
        meanDelta: round(mean(deltas)),
        p025: round(quantile(sorted, 0.025)),
        p975: round(quantile(sorted, 0.975))
      };
    })
  )).sort((left, right) => right.meanDelta - left.meanDelta);

  const evolutionRuns = [];
  for (let seed = 1; seed <= EVOLUTION_RUN_COUNT; seed += 1) {
    const tempDir = await mkdtemp(join(tmpdir(), "keating-study-"));
    try {
      const meRun = await mapElitesEvolve(process.cwd(), DEFAULT_POLICY, {
        iterations: EVOLUTION_ITERATIONS,
        focusTopic: EVOLUTION_FOCUS_TOPIC,
        seed,
        gridPath: join(tempDir, "map-elites-grid.json")
      });
      // Search candidates co-evolve policy coordinates and scoring weights, and
      // each candidate is sampled on a different seed. Re-evaluate the selected
      // policy on the baseline seed and DEFAULT_WEIGHTS before comparing scalar
      // scores; the raw search score is retained only as search provenance.
      const selected = await runBenchmarkSuite(
        process.cwd(),
        meRun.best.policy,
        EVOLUTION_FOCUS_TOPIC,
        seed,
        3,
        DEFAULT_WEIGHTS
      );
      const selectedCandidate = meRun.exploredCandidates.find((candidate) => candidate.accepted);
      evolutionRuns.push({
        seed,
        selectedIteration: selectedCandidate?.iteration ?? 0,
        baseline: round(meRun.baseline.overallScore),
        selected: round(selected.overallScore),
        delta: round(selected.overallScore - meRun.baseline.overallScore),
        rawSearchScore: round(meRun.best.overallScore)
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return {
    seedCount: BENCHMARK_SEED_COUNT,
    policyDeltaFromDefault: {
      analogyDensity: round(currentPolicy.analogyDensity - DEFAULT_POLICY.analogyDensity),
      socraticRatio: round(currentPolicy.socraticRatio - DEFAULT_POLICY.socraticRatio),
      formalism: round(currentPolicy.formalism - DEFAULT_POLICY.formalism),
      retrievalPractice: round(currentPolicy.retrievalPractice - DEFAULT_POLICY.retrievalPractice),
      exerciseCount: round(currentPolicy.exerciseCount - DEFAULT_POLICY.exerciseCount),
      diagramBias: round(currentPolicy.diagramBias - DEFAULT_POLICY.diagramBias),
      reflectionBias: round(currentPolicy.reflectionBias - DEFAULT_POLICY.reflectionBias),
      interdisciplinaryBias: round(
        currentPolicy.interdisciplinaryBias - DEFAULT_POLICY.interdisciplinaryBias
      ),
      challengeRate: round(currentPolicy.challengeRate - DEFAULT_POLICY.challengeRate)
    },
    benchmarkSummary: summarizeSyntheticRuns(runs),
    runs,
    topicDeltaSummary: topicSummary,
    oneAtATimeAblations: ablations,
    derivativeEvolutionStability: {
      comparison: "selected policy and default policy reevaluated on the same seed with DEFAULT_WEIGHTS",
      runCount: evolutionRuns.length,
      deltaSummary: summarizeNumberSeries(evolutionRuns.map((run) => run.delta)),
      selectedIterationSummary: summarizeNumberSeries(
        evolutionRuns.map((run) => run.selectedIteration)
      ),
      wins: evolutionRuns.filter((run) => run.delta > 0).length,
      runs: evolutionRuns
    }
  };
}

function toMarkdownReport(data) {
  const evolutionRuns = data.syntheticBenchmark.derivativeEvolutionStability.runs;
  const evolutionTies = evolutionRuns.filter((run) => run.delta === 0).length;
  const evolutionRegressions = evolutionRuns.filter((run) => run.delta < 0).length;
  const lines = [
    "# Study Analysis",
    "",
    "## Protocol",
    "",
    `- Keating version: ${data.protocol.softwareVersion}`,
    `- Evaluated policy: ${data.syntheticBenchmark.policyName} (${data.protocol.evaluatedPolicyPath})`,
    `- Benchmark mode: ${data.protocol.benchmarkMode}`,
    `- Synthetic learners per topic: ${data.protocol.syntheticLearnersPerTopic}`,
    `- Trace corpus SHA-256: \`${data.protocol.inputHashes.traceCorpusSha256}\``,
    `- Curated snapshot SHA-256: \`${data.protocol.inputHashes.snapshotSha256}\``,
    `- Evaluated policy SHA-256: \`${data.protocol.inputHashes.evaluatedPolicySha256}\``,
    "",
    "## Data Integrity",
    "",
    `- Raw trace files: ${data.dataIntegrity.rawTraceCount}`,
    `- Latest trace records retained: ${data.dataIntegrity.latestTraceCount}`,
    `- Older duplicate traces excluded: ${data.dataIntegrity.excludedDuplicateTraceCount}`,
    `- Snapshot matches latest-trace protocol: ${String(
      data.dataIntegrity.snapshotComparison.matchesLatestTraceSelection
    )}`,
    `- Score corrections applied: ${data.externalEvaluation.scoreCorrections.length}`,
    "",
    "## External Evaluation",
    "",
    `- Records: ${data.externalEvaluation.recordCount}`,
    `- Overall normalized score mean (95% bootstrap CI): ${data.externalEvaluation.overall.mean} (${data.externalEvaluation.overall.ciLow}, ${data.externalEvaluation.overall.ciHigh})`,
    `- Highest-scoring topic: ${data.externalEvaluation.topicSummary[0]?.topic}`,
    `- Lowest-scoring topic: ${data.externalEvaluation.topicSummary[data.externalEvaluation.topicSummary.length - 1]?.topic}`,
    "",
    "## Synthetic Benchmark",
    "",
    `- Policy under analysis: ${data.syntheticBenchmark.policyName}`,
    `- Full-suite delta versus default across ${data.syntheticBenchmark.seedCount} seeds: ${data.syntheticBenchmark.benchmarkSummary.deltaOverall.mean} (${data.syntheticBenchmark.benchmarkSummary.deltaOverall.p025}, ${data.syntheticBenchmark.benchmarkSummary.deltaOverall.p975})`,
    `- Positive delta seeds: ${data.syntheticBenchmark.benchmarkSummary.deltaOverall.wins}/${data.syntheticBenchmark.seedCount}`,
    `- Evolution comparison: ${data.syntheticBenchmark.derivativeEvolutionStability.comparison}`,
    `- Isolated derivative evolution: ${data.syntheticBenchmark.derivativeEvolutionStability.wins} wins, ${evolutionTies} ties, ${evolutionRegressions} regressions across ${data.syntheticBenchmark.derivativeEvolutionStability.runCount} runs`,
    `- Evolution mean delta (observed range): ${data.syntheticBenchmark.derivativeEvolutionStability.deltaSummary.mean} (${data.syntheticBenchmark.derivativeEvolutionStability.deltaSummary.min}, ${data.syntheticBenchmark.derivativeEvolutionStability.deltaSummary.max})`,
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const [
    traceRecords,
    snapshotRecords,
    currentPolicy,
    traceCorpusSha256,
    snapshotSha256,
    evaluatedPolicySha256
  ] = await Promise.all([
    loadTraceRecords(),
    loadJson(SNAPSHOT_PATH),
    loadJson(EVALUATED_POLICY_PATH).then((policy) => clampPolicy(policy)),
    sha256TraceCorpus(),
    sha256File(SNAPSHOT_PATH),
    sha256File(EVALUATED_POLICY_PATH)
  ]);

  const latestTraceSelection = selectLatestTracePerPair(traceRecords);
  const snapshotComparison = compareSnapshotAgainstRetained(
    snapshotRecords,
    latestTraceSelection.retained
  );
  const externalEvaluation = summarizeExternalEvaluation(latestTraceSelection.retained);
  const syntheticBenchmark = await runSyntheticBenchmarkAnalysis(currentPolicy);

  const payload = {
    generatedAt: new Date().toISOString(),
    protocol: {
      softwareVersion: STUDY_SOFTWARE_VERSION,
      evaluatedPolicyPath: "docs/study/evaluated-policy.json",
      benchmarkMode: "deterministic-synthetic-fallback",
      syntheticLearnersPerTopic: 3,
      benchmarkSeedCount: BENCHMARK_SEED_COUNT,
      evolutionRunCount: EVOLUTION_RUN_COUNT,
      evolutionIterationsPerRun: EVOLUTION_ITERATIONS,
      evolutionFocusTopic: EVOLUTION_FOCUS_TOPIC,
      isolatedEvolutionGrids: true,
      inputHashes: {
        traceCorpusSha256,
        snapshotSha256,
        evaluatedPolicySha256
      }
    },
    dataIntegrity: {
      rawTraceCount: traceRecords.length,
      latestTraceCount: latestTraceSelection.retained.length,
      excludedDuplicateTraceCount: latestTraceSelection.excluded.length,
      excludedDuplicateTraces: latestTraceSelection.excluded,
      snapshotComparison
    },
    externalEvaluation,
    syntheticBenchmark: {
      policyName: currentPolicy.name,
      ...syntheticBenchmark
    }
  };

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(join(GENERATED_DIR, "study-analysis.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(join(GENERATED_DIR, "study-analysis.md"), `${toMarkdownReport(payload)}\n`);
}

await main();
