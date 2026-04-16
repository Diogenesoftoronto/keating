import {
  BenchmarkResult,
  BenchmarkTopicTrace,
  LearnerProfile,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicBenchmark,
  TopicDefinition
} from "./types.js";
import { Prng } from "./random.js";
import { benchmarkTopics } from "./topics.js";
import { clamp, mean } from "./util.js";
import { DEFAULT_WEIGHTS, clampWeights } from "./policy.js";

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

import { piCompleteJson } from "./pi-agent.js";

export async function simulateTeaching(
  cwd: string,
  policy: TeacherPolicy,
  topic: TopicDefinition,
  learner: LearnerProfile,
  weights: SimulationWeights = DEFAULT_WEIGHTS
): Promise<TeachingSimulation> {
  // Use pure math to calculate initial constraints as baseline context
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
      breakdown: {
        intuitionFit,
        rigorFit,
        dialogueFit,
        diagramFit,
        practiceFit,
        reflectionFit,
        overload
      },
      explanation: evaluation.explanation
    };
  } catch (error) {
    console.error("LLM simulation failed, falling back to algebraic baseline", error);
    const masteryGain = clamp(0.14 + intuitionFit * 0.18 + rigorFit * 0.2 + dialogueFit * 0.12 + diagramFit * 0.09 + practiceFit * 0.12 + (1 - overload) * 0.18);
    const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
    const engagement = clamp(0.12 + intuitionFit * 0.16 + dialogueFit * 0.16 + diagramFit * 0.1 + reflectionFit * 0.14 + (1 - overload) * 0.18);
    const transfer = clamp(masteryGain * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2));
    const confusion = clamp(0.04 + overload * 0.55 + Math.abs(policy.formalism - learner.abstractionComfort) * 0.18 + Math.abs(policy.challengeRate - learner.persistence) * 0.12);
    const score = clamp(
      masteryGain * weights.masteryGain +
      retention * weights.retention +
      engagement * weights.engagement +
      transfer * weights.transfer -
      confusion * weights.confusion,
      0, 1
    );
    
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
      explanation: ["Fallback deterministic explanation."]
    };
  }
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

export async function runBenchmarkSuite(
  cwd: string,
  policy: TeacherPolicy,
  focusTopic?: string,
  seed = 20260401,
  traceLimit = 3,
  weights: SimulationWeights = DEFAULT_WEIGHTS
): Promise<BenchmarkResult> {
  const topics = benchmarkTopics(focusTopic);
  const topicTraces: BenchmarkTopicTrace[] = [];
  // Reduce learner count to 3 instead of 18 to save LLM tokens and time
  const NUM_LEARNERS = 3;
  
  const topicBenchmarks = await Promise.all(
    topics.map(async (topic, index) => {
      const learners = buildLearnerPopulation(seed + index * 97, NUM_LEARNERS);
      const simulations = await Promise.all(
        learners.map((learner) => simulateTeaching(cwd, policy, topic, learner, weights))
      );
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

  return {
    policy,
    suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
    topicBenchmarks,
    overallScore: mean(overallScores),
    weakestTopic: weakest?.topic.title ?? "n/a",
    trace: {
      seed,
      learnerCountPerTopic: NUM_LEARNERS,
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
