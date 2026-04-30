/**
 * Mastery Assessment Engine
 *
 * Generates multi-level diagnostic questions, scores learner responses,
 * and produces a mastery report with per-dimension breakdown.
 */

import { TopicDefinition } from "./types.js";
import { resolveTopic } from "./topics.js";
import { clamp } from "./util.js";

export interface DiagnosticQuestion {
  id: string;
  level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
  question: string;
  rubric: string;
  maxPoints: number;
}

export interface MasteryDimension {
  name: string;
  score: number;
  maxScore: number;
  questions: DiagnosticQuestion[];
  recommendations: string[];
}

export interface MasteryAssessment {
  topic: string;
  overallScore: number;
  maxScore: number;
  level: "novice" | "beginner" | "competent" | "proficient" | "expert";
  dimensions: MasteryDimension[];
  gaps: string[];
  strengths: string[];
  nextSteps: string[];
}

export function generateDiagnosticQuestions(topic: TopicDefinition): DiagnosticQuestion[] {
  const questions: DiagnosticQuestion[] = [];

  // Recall level (Blooms taxonomy L1)
  questions.push({
    id: `${topic.slug}-q1`,
    level: "recall",
    question: `State the definition of "${topic.title}" in your own words.`,
    rubric: `1pt: attempts definition. 2pts: core elements present. 3pts: precise, recognizes nuance. Max ${3} points.`,
    maxPoints: 3
  });

  // Recall from formal core
  questions.push({
    id: `${topic.slug}-q2`,
    level: "recall",
    question: `What are the key prerequisites needed before a learner can grasp ${topic.title}?`,
    rubric: `1pt: mentions prerequisites. 2pts: explains connection. 3pts: correct full list. Max ${3} points.`,
    maxPoints: 3
  });

  // Comprehension (Bloom L2)
  const intuitionHook = topic.intuition[0] ?? "the core idea";
  questions.push({
    id: `${topic.slug}-q3`,
    level: "comprehension",
    question: `Explain why "${intuitionHook}" is a useful way to think about ${topic.title}.`,
    rubric: `1pt: repeats hook. 2pts: connects to structure. 3pts: sees limitations and when it breaks. Max ${3} points.`,
    maxPoints: 3
  });

  // Common misconception
  const misconception = topic.misconceptions[0] ?? "the common error";
  questions.push({
    id: `${topic.slug}-q4`,
    level: "comprehension",
    question: `Many learners think: "${misconception}". Explain why this is incorrect.`,
    rubric: `1pt: says it is wrong. 2pts: identifies the subtle issue. 3pts: gives a counterexample. Max ${3} points.`,
    maxPoints: 3
  });

  // Application (Bloom L3)
  const example = topic.examples[0] ?? "a basic scenario";
  questions.push({
    id: `${topic.slug}-q5`,
    level: "application",
    question: `Apply ${topic.title} to a new situation: ${example}`,
    rubric: `1pt: attempts application. 2pts: correct mechanics, minor gaps. 3pts: fully correct with explanation. Max ${3} points.`,
    maxPoints: 3
  });

  // Transfer (Bloom L5)
  const hook = topic.interdisciplinaryHooks[0] ?? "another field";
  questions.push({
    id: `${topic.slug}-q6`,
    level: "transfer",
    question: `How might ${topic.title} be relevant in ${hook}? Construct an analogy.`,
    rubric: `1pt: mentions connection. 2pts: coherent analogy. 3pts: analogy holds under scrutiny. Max ${3} points.`,
    maxPoints: 3
  });

  return questions;
}

function classifyLevel(score: number, max: number): "novice" | "beginner" | "competent" | "proficient" | "expert" {
  const ratio = score / max;
  if (ratio >= 0.9) return "expert";
  if (ratio >= 0.7) return "proficient";
  if (ratio >= 0.5) return "competent";
  if (ratio >= 0.3) return "beginner";
  return "novice";
}

/**
 * Score an answer heuristically (0–maxPoints).
 * In practice an LLM should do this, but this provides deterministic defaults.
 */
export function scoreAnswer(question: DiagnosticQuestion, answer: string): number {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return 0;
  if (trimmed.length < 20) return 1; // Very short
  // Medium-fidelity heuristic: longer + key topic words = higher
  const topicWords = question.question.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  const matches = topicWords.filter(w => trimmed.toLowerCase().includes(w)).length;
  const ratio = matches / Math.max(1, topicWords.length);
  if (ratio > 0.5 && trimmed.length > 100) return question.maxPoints;
  if (ratio > 0.3 && trimmed.length > 50) return Math.min(question.maxPoints, 2);
  return Math.min(question.maxPoints, 2);
}

export function computeMasteryAssessment(
  topicName: string,
  answers: Record<string, string>
): MasteryAssessment {
  const topic = resolveTopic(topicName);
  const questions = generateDiagnosticQuestions(topic);

  const dimensions: MasteryDimension[] = [];
  const gaps: string[] = [];
  const strengths: string[] = [];

  let totalScore = 0;
  let totalMax = 0;

  // Group by level
  const levelGroups = {
    recall: "Factual Recall",
    comprehension: "Conceptual Understanding",
    application: "Application",
    analysis: "Analysis",
    transfer: "Transfer"
  } as const;

  for (const [level, dimName] of Object.entries(levelGroups)) {
    const levelQs = questions.filter(q => q.level === level);
    if (levelQs.length === 0) continue;

    let dimScore = 0;
    let dimMax = 0;
    const dimQuestions: DiagnosticQuestion[] = [];

    for (const q of levelQs) {
      const answer = answers[q.id] ?? "";
      const score = scoreAnswer(q, answer);
      dimScore += score;
      dimMax += q.maxPoints;
      dimQuestions.push(q);
    }

    totalScore += dimScore;
    totalMax += dimMax;

    const recs: string[] = [];
    const ratio = dimMax > 0 ? dimScore / dimMax : 0;
    if (ratio < 0.5) {
      recs.push(`Strengthen ${dimName.toLowerCase()} through targeted practice.`);
      gaps.push(dimName);
    } else if (ratio >= 0.8) {
      strengths.push(dimName);
    }

    dimensions.push({
      name: dimName,
      score: dimScore,
      maxScore: dimMax,
      questions: dimQuestions,
      recommendations: recs
    });
  }

  const overall = clamp(totalScore / Math.max(1, totalMax), 0, 1);

  const nextSteps: string[] = [];
  if (gaps.length > 0) {
    nextSteps.push(`Focus on: ${gaps.join(", ")}.`);
  }
  if (strengths.length > 0) {
    nextSteps.push(`Your strengths (${strengths.join(", ")}) are solid — leverage them for harder transfer problems.`);
  }
  if (gaps.length === 0 && strengths.length === dimensions.length) {
    nextSteps.push("You score highly across all dimensions. Try synthesis-level questions or teach the topic to someone else.");
  }

  return {
    topic: topic.title,
    overallScore: totalScore,
    maxScore: totalMax,
    level: classifyLevel(totalScore, totalMax),
    dimensions,
    gaps,
    strengths,
    nextSteps
  };
}

export function masteryAssessmentToMarkdown(ass: MasteryAssessment): string {
  const lines: string[] = [
    `# Mastery Assessment: ${ass.topic}`,
    "",
    `**Level**: ${ass.level.toUpperCase()} (${((ass.overallScore / ass.maxScore) * 100).toFixed(1)}%)`,
    `**Score**: ${ass.overallScore} / ${ass.maxScore}`,
    ""
  ];

  lines.push("## Dimension Breakdown");
  lines.push("");
  for (const d of ass.dimensions) {
    const pct = ((d.score / d.maxScore) * 100).toFixed(0);
    lines.push(`### ${d.name}: ${d.score}/${d.maxScore} (${pct}%)`);
    for (const q of d.questions) {
      lines.push(`- **${q.id}** (${q.level}): ${q.question}`);
      lines.push(`  - Rubric: ${q.rubric}`);
    }
    if (d.recommendations.length > 0) {
      lines.push(`  - *Recommendation:* ${d.recommendations[0]}`);
    }
    lines.push("");
  }

  if (ass.gaps.length > 0) {
    lines.push("## Gaps Identified");
    for (const g of ass.gaps) lines.push(`- ${g}`);
    lines.push("");
  }

  if (ass.strengths.length > 0) {
    lines.push("## Strengths");
    for (const s of ass.strengths) lines.push(`- ${s}`);
    lines.push("");
  }

  lines.push("## Next Steps");
  for (const ns of ass.nextSteps) lines.push(`- ${ns}`);
  lines.push("");

  return lines.join("\n");
}
