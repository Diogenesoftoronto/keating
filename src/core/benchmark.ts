import {
  BenchmarkResult,
  BenchmarkTopicTrace,
  LearnerProfile,
  TeacherPolicy,
  TeachingSimulation,
  TopicBenchmark,
  TopicDefinition
} from "./types.js";
import { Prng } from "./random.js";
import { benchmarkTopics } from "./topics.js";
import { clamp, mean } from "./util.js";

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

export function simulateTeaching(
  policy: TeacherPolicy,
  topic: TopicDefinition,
  learner: LearnerProfile
): TeachingSimulation {
  const intuitionFit = 1 - Math.abs(policy.analogyDensity - learner.analogyNeed);
  const rigorTarget = clamp((topic.formalism + learner.abstractionComfort) / 2);
  const rigorFit = 1 - Math.abs(policy.formalism - rigorTarget);
  const dialogueFit = 1 - Math.abs(policy.socraticRatio - learner.dialoguePreference);
  const diagramTarget = topic.visualizable ? learner.diagramAffinity : 0.2;
  const diagramFit = 1 - Math.abs(policy.diagramBias - diagramTarget);
  const practiceNeed = clamp(1 - learner.priorKnowledge + learner.anxiety * 0.2);
  const practiceFit = 1 - Math.abs(policy.exerciseCount / 5 - practiceNeed);
  const reflectionFit = 1 - Math.abs(policy.reflectionBias - learner.transferDesire);
  const overload = clamp(
    policy.formalism * 0.35 +
      (policy.exerciseCount / 5) * 0.15 +
      policy.challengeRate * 0.3 -
      learner.persistence * 0.2 +
      learner.anxiety * 0.25 -
      learner.priorKnowledge * 0.15
  );

  const masteryGain = clamp(
    0.14 +
      intuitionFit * 0.18 +
      rigorFit * 0.2 +
      dialogueFit * 0.12 +
      diagramFit * 0.09 +
      practiceFit * 0.12 +
      (1 - overload) * 0.18
  );
  const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
  const engagement = clamp(
    0.12 +
      intuitionFit * 0.16 +
      dialogueFit * 0.16 +
      diagramFit * 0.1 +
      reflectionFit * 0.14 +
      (1 - overload) * 0.18
  );
  const transfer = clamp(
    retention * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2)
  );
  const confusion = clamp(
    0.04 +
      overload * 0.55 +
      Math.abs(policy.formalism - learner.abstractionComfort) * 0.18 +
      Math.abs(policy.challengeRate - learner.persistence) * 0.12
  );

  const score = clamp(
    masteryGain * 0.34 +
      retention * 0.2 +
      engagement * 0.16 +
      transfer * 0.18 -
      confusion * 0.18,
    0,
    1
  );

  const explanation: string[] = [];
  if (intuitionFit >= 0.8) explanation.push("analogy pacing matched the learner well");
  if (rigorFit >= 0.8) explanation.push("formal depth fit the learner's abstraction comfort");
  if (practiceFit >= 0.75) explanation.push("exercise load matched the learner's need for repetition");
  if (reflectionFit >= 0.75) explanation.push("reflection and transfer demands aligned with the learner");
  if (overload >= 0.55) explanation.push("challenge and formal load pushed the learner toward overload");
  if (diagramFit <= 0.45) explanation.push("diagram emphasis mismatched the learner's visual preference");
  if (explanation.length === 0) explanation.push("the lesson was balanced but not strongly optimized for this learner");

  return {
    learner,
    topic,
    masteryGain,
    retention,
    engagement,
    transfer,
    confusion,
    score,
    breakdown: {
      intuitionFit,
      rigorFit,
      dialogueFit,
      diagramFit,
      practiceFit,
      reflectionFit,
      overload
    },
    explanation
  };
}

function classifyDominantSignal(simulations: TeachingSimulation[], kind: "strength" | "weakness"): string {
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

function summarizeTopic(topic: TopicDefinition, simulations: TeachingSimulation[], traceLimit: number): TopicBenchmark {
  const ranked = [...simulations].sort((left, right) => right.score - left.score);
  return {
    topic,
    learnerCount: simulations.length,
    meanScore: mean(simulations.map((entry) => entry.score)) * 100,
    meanMasteryGain: mean(simulations.map((entry) => entry.masteryGain)),
    meanRetention: mean(simulations.map((entry) => entry.retention)),
    meanEngagement: mean(simulations.map((entry) => entry.engagement)),
    meanTransfer: mean(simulations.map((entry) => entry.transfer)),
    meanConfusion: mean(simulations.map((entry) => entry.confusion)),
    topLearners: ranked.slice(0, traceLimit),
    strugglingLearners: ranked.slice(-traceLimit).reverse(),
    dominantStrength: classifyDominantSignal(simulations, "strength"),
    dominantWeakness: classifyDominantSignal(simulations, "weakness")
  };
}

export function runBenchmarkSuite(
  policy: TeacherPolicy,
  focusTopic?: string,
  seed = 20260401,
  traceLimit = 3
): BenchmarkResult {
  const topics = benchmarkTopics(focusTopic);
  const topicTraces: BenchmarkTopicTrace[] = [];
  const topicBenchmarks = topics.map((topic, index) => {
    const learners = buildLearnerPopulation(seed + index * 97, 18);
    const simulations = learners.map((learner) => simulateTeaching(policy, topic, learner));
    const summary = summarizeTopic(topic, simulations, traceLimit);
    topicTraces.push({
      topic: topic.title,
      topLearners: summary.topLearners.map((entry) => ({
        learnerId: entry.learner.id,
        score: entry.score,
        explanation: entry.explanation
      })),
      strugglingLearners: summary.strugglingLearners.map((entry) => ({
        learnerId: entry.learner.id,
        score: entry.score,
        explanation: entry.explanation
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
  });

  const weakest = [...topicBenchmarks].sort((left, right) => left.meanScore - right.meanScore)[0];

  return {
    policy,
    suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
    topicBenchmarks,
    overallScore: mean(topicBenchmarks.map((entry) => entry.meanScore)),
    weakestTopic: weakest?.topic.title ?? "n/a",
    trace: {
      seed,
      learnerCountPerTopic: 18,
      topicTraces
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
        `  - ${learner.learner.id}: ${(learner.score * 100).toFixed(1)} because ${learner.explanation.join("; ")}`
      );
    }
    lines.push("- Struggling learners:");
    for (const learner of benchmark.strugglingLearners) {
      lines.push(
        `  - ${learner.learner.id}: ${(learner.score * 100).toFixed(1)} because ${learner.explanation.join("; ")}`
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

export interface SimulationWeights {
  masteryGain: number;
  retention: number;
  engagement: number;
  transfer: number;
  confusion: number;
}

const BASE_WEIGHTS: SimulationWeights = {
  masteryGain: 0.34,
  retention: 0.20,
  engagement: 0.16,
  transfer: 0.18,
  confusion: 0.18
};

export function applyFeedbackBias(
  feedback: FeedbackSummary
): SimulationWeights {
  if (feedback.sampleSize < 5) return { ...BASE_WEIGHTS };

  const weights = { ...BASE_WEIGHTS };
  // High confusion from real users → increase confusion penalty weight
  weights.confusion = clamp(weights.confusion + feedback.confusionRate * 0.08);
  // High satisfaction → slightly increase engagement weight
  weights.engagement = clamp(weights.engagement + feedback.satisfactionRate * 0.04);

  // Renormalize positive weights to sum to ~0.88 (1 - confusion weight)
  const positiveSum = weights.masteryGain + weights.retention + weights.engagement + weights.transfer;
  const targetPositive = 1 - weights.confusion;
  const scale = targetPositive / positiveSum;
  weights.masteryGain *= scale;
  weights.retention *= scale;
  weights.engagement *= scale;
  weights.transfer *= scale;

  return weights;
}
