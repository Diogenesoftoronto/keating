import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BenchmarkResult,
  BenchmarkTopicTrace,
  LearnerProfile,
  LearnerState,
  RealLearnerOutcome,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicBenchmark,
  TopicDefinition
} from "./types.js";
import { Prng } from "./random.js";
import { benchmarkTopics, resolveTopic } from "./topics.js";
import { clamp, mean } from "./util.js";
import { DEFAULT_WEIGHTS, clampWeights } from "./policy.js";
import { piCompleteJson } from "./pi-agent.js";
import {
  MIN_REAL_OUTCOMES,
  hasEnoughRealData,
  computeRealOutcomeScore,
  feedbackToOutcomeScore,
  simulateDeterministicTeaching
} from "./benchmark-real.js";
import { sessionsDir } from "./paths.js";
import { inferLearnerTurnSignal, learnerTurnSignalToOutcome } from "./learner-turn-analysis.js";

// ---------------------------------------------------------------------------
// Real learner outcome extraction: convert stored student data into
// scoreable outcome records that replace synthetic simulations.
// ---------------------------------------------------------------------------

export function extractRealOutcomes(state: LearnerState): RealLearnerOutcome[] {
  const outcomes: RealLearnerOutcome[] = [];

  for (const fb of state.feedback) {
    const topicSlug = resolveTopic(fb.topic).slug;
    const covered = state.coveredTopics.find((ct) => ct.slug === topicSlug || ct.slug === fb.topic);
    const session =
      state.sessions.find((s) => s.topicsCovered.includes(topicSlug)) ?? null;

    let sessionDurationMs: number | null = null;
    if (session?.startedAt && session?.endedAt) {
      sessionDurationMs =
        new Date(session.endedAt).getTime() -
        new Date(session.startedAt).getTime();
    }

    outcomes.push({
      learnerId: state.profile.id,
      topic: topicSlug,
      feedbackSignal: fb.signal,
      quizScore: null,
      sessionDurationMs,
      masteryEstimate: covered?.masteryEstimate ?? 0.5,
      outcomeScore: feedbackToOutcomeScore(fb.signal),
    });
  }

  return outcomes;
}

export async function extractHarnessOutcomes(cwd: string, state: LearnerState): Promise<RealLearnerOutcome[]> {
  const outcomes = extractRealOutcomes(state);
  const fallbackTopic =
    state.coveredTopics.at(-1)?.slug ??
    state.feedback.at(-1)?.topic ??
    "general";

  for (const message of await readLearnerMessages(cwd)) {
    const signal = inferLearnerTurnSignal(message, fallbackTopic);
    if (!signal || signal.topic === "general") continue;
    outcomes.push(learnerTurnSignalToOutcome(signal, state.profile.id));
  }

  return outcomes;
}

async function readLearnerMessages(cwd: string): Promise<string[]> {
  const dir = sessionsDir(cwd);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const messages: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = join(dir, entry.name);
    try {
      const parsed = JSON.parse(await readFile(fullPath, "utf8")) as { messages?: unknown[] };
      for (const message of parsed.messages ?? []) {
        if (!message || typeof message !== "object") continue;
        const role = (message as { role?: unknown }).role;
        if (role !== "user" && role !== "user-with-attachments") continue;
        const text = messageText(message);
        if (text) messages.push(text);
      }
    } catch {
      continue;
    }
  }

  return messages;
}

function messageText(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          return (item as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Synthetic learner population (fallback when real data is insufficient)
// ---------------------------------------------------------------------------

function buildLearnerPopulation(seed: number, count: number): LearnerProfile[] {
  const prng = new Prng(seed);
  const learners: LearnerProfile[] = [];
  for (let index = 0; index < count; index += 1) {
    learners.push({
      id: `learner-${seed}-${index}`,
      priorKnowledge: prng.next(),
      abstractionComfort: prng.next(),
      analogyNeed: prng.next(),
      dialoguePreference: prng.next(),
      diagramAffinity: prng.next(),
      persistence: prng.next(),
      transferDesire: prng.next(),
      anxiety: prng.next()
    });
  }
  return learners;
}

export async function simulateTeaching(
  cwd: string,
  policy: TeacherPolicy,
  topic: TopicDefinition,
  learner: LearnerProfile,
  weights: SimulationWeights = DEFAULT_WEIGHTS
): Promise<TeachingSimulation> {
  const baseline = simulateDeterministicTeaching(policy, topic, learner, weights);
  const deterministicBaseline = (): TeachingSimulation => {
    return baseline;
  };

  if (process.env.KEATING_LLM_BENCHMARK !== "1") {
    return deterministicBaseline();
  }

  const prompt = `Simulate an educational interaction based on the following context.
Teacher Policy: ${JSON.stringify(policy, null, 2)}
Topic: ${topic.title} (${topic.domain}) - ${topic.summary}
Learner Traits: ${JSON.stringify(learner, null, 2)}

Evaluate the teaching outcomes from 0.0 to 1.0 (masteryGain, retention, engagement, transfer, confusion). Also provide an overall 'score' (0.0=failure to 1.0=mastery) computed as: score = masteryGain*${weights.masteryGain.toFixed(2)} + retention*${weights.retention.toFixed(2)} + engagement*${weights.engagement.toFixed(2)} + transfer*${weights.transfer.toFixed(2)} - confusion*${weights.confusion.toFixed(2)}
Provide 1 to 3 string sentences explaining the outcome in the 'explanation' array. 
Respond ONLY as a JSON matching:
{
  "masteryGain": number,
  "retention": number,
  "engagement": number,
  "transfer": number,
  "confusion": number,
  "score": number,
  "explanation": string[]
}`;

  try {
    const evaluation = await piCompleteJson<{
      masteryGain: number;
      retention: number;
      engagement: number;
      transfer: number;
      confusion: number;
      score: number;
      explanation: string[];
    }>(cwd, prompt, { thinking: "low" });

    if (typeof evaluation.masteryGain !== "number" || Number.isNaN(evaluation.masteryGain)) {
      throw new Error("LLM returned invalid evaluation metrics");
    }

    return {
      learner,
      topic,
      masteryGain: clamp(evaluation.masteryGain, 0, 1),
      retention: clamp(evaluation.retention, 0, 1),
      engagement: clamp(evaluation.engagement, 0, 1),
      transfer: clamp(evaluation.transfer, 0, 1),
      confusion: clamp(evaluation.confusion, 0, 1),
      score: clamp(evaluation.score, 0, 1),
      breakdown: baseline.breakdown,
      explanation: evaluation.explanation
    };
  } catch (error) {
    console.error("LLM simulation failed, falling back to algebraic baseline", error);
    return deterministicBaseline();
  }
}

function classifyDominantSignal(simulations: TeachingSimulation[], kind: "strength" | "weakness"): string {
  if (simulations.length === 0) return "no learner feedback";
  const metrics = {
    intuitionFit: mean(simulations.map((entry) => entry.breakdown.intuitionFit)),
    rigorFit: mean(simulations.map((entry) => entry.breakdown.rigorFit)),
    dialogueFit: mean(simulations.map((entry) => entry.breakdown.dialogueFit)),
    diagramFit: mean(simulations.map((entry) => entry.breakdown.diagramFit)),
    practiceFit: mean(simulations.map((entry) => entry.breakdown.practiceFit)),
    reflectionFit: mean(simulations.map((entry) => entry.breakdown.reflectionFit)),
    overload: mean(simulations.map((entry) => entry.breakdown.overload))
  };
  const ordered = Object.entries(metrics).sort((left, right) =>
    kind === "strength" ? right[1] - left[1] : left[1] - right[1]
  );
  const [name] = ordered[0] ?? ["unknown"];
  return name;
}

export function summarizeTopic(topic: TopicDefinition, simulations: TeachingSimulation[], traceLimit: number): TopicBenchmark {
  const ranked = [...simulations].sort((left, right) => right.score - left.score);
  
  const scores = simulations.map((entry) => entry.score).filter(s => !Number.isNaN(s));
  const meanScore = mean(scores) * 100;

  return {
    topic,
    learnerCount: simulations.length,
    meanScore,
    meanMasteryGain: mean(simulations.map((entry) => entry.masteryGain).filter(m => !Number.isNaN(m))),
    meanRetention: mean(simulations.map((entry) => entry.retention).filter(r => !Number.isNaN(r))),
    meanEngagement: mean(simulations.map((entry) => entry.engagement).filter(e => !Number.isNaN(e))),
    meanTransfer: mean(simulations.map((entry) => entry.transfer).filter(t => !Number.isNaN(t))),
    meanConfusion: mean(simulations.map((entry) => entry.confusion).filter(c => !Number.isNaN(c))),
    topLearners: ranked.slice(0, traceLimit),
    strugglingLearners: ranked.slice(-traceLimit).reverse(),
    dominantStrength: classifyDominantSignal(simulations, "strength"),
    dominantWeakness: classifyDominantSignal(simulations, "weakness")
  };
}

// ---------------------------------------------------------------------------
// Main benchmark suite. If learner state is supplied, user-facing benchmarks
// use gathered learner feedback only. Synthetic learners remain available only
// for internal optimizer/test calls that provide no learner state.
// ---------------------------------------------------------------------------

export async function runBenchmarkSuite(
  cwd: string,
  policy: TeacherPolicy,
  focusTopic?: string,
  seed = 20260401,
  traceLimit = 3,
  weights: SimulationWeights = DEFAULT_WEIGHTS,
  learnerState?: LearnerState
): Promise<BenchmarkResult> {
  const topics = benchmarkTopics(focusTopic);
  const topicTraces: BenchmarkTopicTrace[] = [];
  const realOutcomes = learnerState ? await extractHarnessOutcomes(cwd, learnerState) : [];
  const hasLearnerContext = learnerState !== undefined;
  const hasFeedback = realOutcomes.length > 0;
  const hasEnoughFeedback = hasEnoughRealData(realOutcomes);
  const NUM_SYNTHETIC_LEARNERS = 3;
  const benchmarkedTopics = hasLearnerContext && hasFeedback && !focusTopic
    ? [...new Set(realOutcomes.map((outcome) => outcome.topic))].map((topic) => resolveTopic(topic))
    : topics;

  const topicBenchmarks = await Promise.all(
    benchmarkedTopics.map(async (topic, index) => {
      const topicReal = realOutcomes.filter((o) => o.topic === topic.slug);

      let simulations: TeachingSimulation[];

      if (hasLearnerContext) {
        simulations = topicReal.length > 0
          ? [computeRealOutcomeScore(topicReal, policy, topic, weights)]
          : [];
      } else {
        const synthLearners = buildLearnerPopulation(seed + index * 97, NUM_SYNTHETIC_LEARNERS);
        simulations = await Promise.all(
          synthLearners.map((learner) =>
            simulateTeaching(cwd, policy, topic, learner, weights)
          )
        );
      }

      const summary = summarizeTopic(topic, simulations, traceLimit);
      topicTraces.push({
        topic: topic.title,
        topLearners: summary.topLearners.map((entry) => ({
          learnerId: entry.learner.id,
          score: entry.score,
          explanation: entry.explanation || ["unknown"]
        })),
        strugglingLearners: summary.strugglingLearners.map((entry) => ({
          learnerId: entry.learner.id,
          score: entry.score,
          explanation: entry.explanation || ["unknown"]
        })),
        metricMeans: {
          masteryGain: summary.meanMasteryGain,
          retention: summary.meanRetention,
          engagement: summary.meanEngagement,
          transfer: summary.meanTransfer,
          confusion: summary.meanConfusion
        },
        dominantStrength: summary.dominantStrength,
        dominantWeakness: summary.dominantWeakness
      });
      return summary;
    })
  );

  const weakest = [...topicBenchmarks].sort((left, right) => left.meanScore - right.meanScore)[0];

  const overallScores = topicBenchmarks.map((entry) => entry.meanScore).filter(s => !Number.isNaN(s));
  const dataSource = hasLearnerContext
    ? hasFeedback
      ? hasEnoughFeedback
        ? "learner-feedback"
        : "learner-feedback-sparse"
      : "no-learner-feedback"
    : "synthetic";

  return {
    policy,
    suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
    topicBenchmarks,
    overallScore: mean(overallScores),
    weakestTopic: weakest?.topic.title ?? "n/a",
    trace: {
      seed,
      learnerCountPerTopic: hasLearnerContext ? (hasFeedback ? 1 : 0) : NUM_SYNTHETIC_LEARNERS,
      topicTraces,
      realOutcomeCount: realOutcomes.length,
      syntheticFallback: !hasLearnerContext,
      dataSource,
    }
  };
}

export function benchmarkToMarkdown(result: BenchmarkResult): string {
  const lines = [
    `# Benchmark Report: ${result.policy.name}`,
    "",
    `- Suite: ${result.suiteName}`,
    `- Overall score: ${result.overallScore.toFixed(2)}`,
    `- Weakest topic: ${result.weakestTopic}`,
    `- Learner feedback outcomes: ${result.trace.realOutcomeCount}`,
    `- Data source: ${result.trace.dataSource ?? (result.trace.syntheticFallback ? "synthetic" : "learner-feedback")}`,
    "",
    "| Topic | Score | Mastery | Retention | Engagement | Transfer | Confusion |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const benchmark of result.topicBenchmarks) {
    lines.push(
      `| ${benchmark.topic.title} | ${benchmark.meanScore.toFixed(2)} | ${benchmark.meanMasteryGain.toFixed(2)} | ${benchmark.meanRetention.toFixed(2)} | ${benchmark.meanEngagement.toFixed(2)} | ${benchmark.meanTransfer.toFixed(2)} | ${benchmark.meanConfusion.toFixed(2)} |`
    );
  }

  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push(
    `- The policy currently underperforms most on ${result.weakestTopic}, which is a useful anchor for mutation and curriculum repair.`
  );
  if (result.trace.dataSource === "learner-feedback") {
    lines.push(
      `- Benchmark uses **learner feedback only** (${result.trace.realOutcomeCount} data points). This is ready for policy evolution.`
    );
  } else if (result.trace.dataSource === "learner-feedback-sparse") {
    lines.push(
      `- Benchmark uses **learner feedback only**, but the corpus is sparse (${result.trace.realOutcomeCount}/${MIN_REAL_OUTCOMES} minimum signals). Treat this as directional and do not evolve policy yet.`
    );
  } else if (result.trace.dataSource === "no-learner-feedback") {
    lines.push(
      `- Benchmark has no learner feedback yet. Teach first, collect at least ${MIN_REAL_OUTCOMES} feedback signals for this learner, then benchmark/evolve.`
    );
  } else {
    lines.push(
      `- Benchmark uses the deterministic synthetic fallback because no learner-state corpus was supplied. User-facing harness benchmarks should supply learner state.`
    );
  }
  lines.push(
    "- Invariants tracked here favor durable learning signals: mastery, retention, engagement, transfer, and bounded confusion."
  );
  lines.push("- Debug traces below explain which learners the policy helped most, where it struggled, and which signal dominated.");
  lines.push("");
  lines.push("## Debug Trace");
  lines.push("");
  for (const benchmark of result.topicBenchmarks) {
    lines.push(`### ${benchmark.topic.title}`);
    lines.push(`- Dominant strength: ${benchmark.dominantStrength}`);
    lines.push(`- Dominant weakness: ${benchmark.dominantWeakness}`);
    lines.push("- Top learners:");
    for (const learner of benchmark.topLearners) {
      lines.push(
        `  - ${learner.learner.id}: ${(learner.score * 100).toFixed(1)} because ${(learner.explanation || ["unknown"]).join("; ")}`
      );
    }
    lines.push("- Struggling learners:");
    for (const learner of benchmark.strugglingLearners) {
      lines.push(
        `  - ${learner.learner.id}: ${(learner.score * 100).toFixed(1)} because ${(learner.explanation || ["unknown"]).join("; ")}`
      );
    }
    lines.push("");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export interface FeedbackSummary {
  confusionRate: number;
  satisfactionRate: number;
  sampleSize: number;
}

export function applyFeedbackBias(
  feedback: FeedbackSummary
): SimulationWeights {
  if (feedback.sampleSize < 5) return { ...DEFAULT_WEIGHTS };

  const weights = { ...DEFAULT_WEIGHTS };
  weights.confusion = clamp(weights.confusion + feedback.confusionRate * 0.08);
  weights.engagement = clamp(weights.engagement + feedback.satisfactionRate * 0.04);

  const positiveSum = weights.masteryGain + weights.retention + weights.engagement + weights.transfer;
  const targetPositive = 1 - weights.confusion;
  const scale = targetPositive / positiveSum;
  weights.masteryGain *= scale;
  weights.retention *= scale;
  weights.engagement *= scale;
  weights.transfer *= scale;

  return clampWeights(weights);
}
