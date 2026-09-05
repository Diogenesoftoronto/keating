export type Domain =
  | "math"
  | "science"
  | "philosophy"
  | "code"
  | "law"
  | "politics"
  | "psychology"
  | "medicine"
  | "arts"
  | "history"
  | "general";

export interface TopicDefinition {
  slug: string;
  title: string;
  domain: Domain;
  summary: string;
  intuition: string[];
  formalCore: string[];
  prerequisites: string[];
  misconceptions: string[];
  examples: string[];
  exercises: string[];
  reflections: string[];
  diagramNodes: string[];
  formalism: number;
  visualizable: boolean;
  interdisciplinaryHooks: string[];
}

export interface TeacherPolicy {
  name: string;
  analogyDensity: number;
  socraticRatio: number;
  formalism: number;
  retrievalPractice: number;
  exerciseCount: number;
  diagramBias: number;
  reflectionBias: number;
  interdisciplinaryBias: number;
  challengeRate: number;
}

export interface SimulationWeights {
  masteryGain: number;
  retention: number;
  engagement: number;
  transfer: number;
  confusion: number;
}

export interface LearnerProfile {
  id: string;
  priorKnowledge: number;
  abstractionComfort: number;
  analogyNeed: number;
  dialoguePreference: number;
  diagramAffinity: number;
  persistence: number;
  transferDesire: number;
  anxiety: number;
}

export interface TeachingSimulation {
  learner: LearnerProfile;
  topic: TopicDefinition;
  masteryGain: number;
  retention: number;
  engagement: number;
  transfer: number;
  confusion: number;
  score: number;
  breakdown: {
    intuitionFit: number;
    rigorFit: number;
    dialogueFit: number;
    diagramFit: number;
    practiceFit: number;
    reflectionFit: number;
    overload: number;
  };
  explanation: string[];
}

export interface TopicBenchmark {
  topic: TopicDefinition;
  learnerCount: number;
  meanScore: number;
  meanMasteryGain: number;
  meanRetention: number;
  meanEngagement: number;
  meanTransfer: number;
  meanConfusion: number;
  topLearners: TeachingSimulation[];
  strugglingLearners: TeachingSimulation[];
  dominantStrength: string;
  dominantWeakness: string;
}

export interface BenchmarkTopicTrace {
  topic: string;
  topLearners: Array<{
    learnerId: string;
    score: number;
    explanation: string[];
  }>;
  strugglingLearners: Array<{
    learnerId: string;
    score: number;
    explanation: string[];
  }>;
  metricMeans: {
    masteryGain: number;
    retention: number;
    engagement: number;
    transfer: number;
    confusion: number;
  };
  dominantStrength: string;
  dominantWeakness: string;
}

export interface BenchmarkTrace {
  seed: number;
  learnerCountPerTopic: number;
  topicTraces: BenchmarkTopicTrace[];
  realOutcomeCount: number;
  syntheticFallback: boolean;
  dataSource?: "learner-feedback" | "learner-feedback-sparse" | "synthetic" | "no-learner-feedback";
}

export interface BenchmarkResult {
  policy: TeacherPolicy;
  suiteName: string;
  topicBenchmarks: TopicBenchmark[];
  overallScore: number;
  weakestTopic: string;
  trace: BenchmarkTrace;
}

export interface LessonPhase {
  id: string;
  title: string;
  purpose: string;
  bullets: string[];
}

export interface LessonPlan {
  topic: TopicDefinition;
  policy: TeacherPolicy;
  phases: LessonPhase[];
}

export interface CandidateDecision {
  improves: boolean;
  safe: boolean;
  novelEnough: boolean;
  scoreDelta: number;
  weakestTopicDelta: number;
  reasons: string[];
}

export interface PolicyDelta {
  field: keyof TeacherPolicy;
  before: number | string;
  after: number | string;
  delta: number;
}

export interface EvolutionCandidate {
  policy: TeacherPolicy;
  benchmark: BenchmarkResult;
  counterfactualBenchmark?: BenchmarkResult;
  parentName: string | null;
  iteration: number;
  novelty: number;
  accepted: boolean;
  decision: CandidateDecision;
  parameterDelta: PolicyDelta[];
  preferenceScore?: number;
}

export interface PromptObjectiveVector {
  voice_divergence: number;
  diagnosis: number;
  verification: number;
  retrieval: number;
  transfer: number;
  structure: number;
}

export interface EngagementPolicy {
  name: string;
  /** Retention half-life in days at mastery=1.0. */
  retentionHalfLifeDays: number;
  /** Threshold below which a topic is due for review. */
  dueThreshold: number;
  /** Minimum days between reviews even if retention is low. */
  minReviewIntervalDays: number;
  /** Urgency tiers: critical, high, moderate, and low day thresholds. */
  urgencyTiers: [number, number, number, number];
}

export interface MapElitesCell {
  policy: TeacherPolicy;
  weights: SimulationWeights;
  score: number;
  benchmark: BenchmarkResult;
  iteration: number;
}

export interface MapElitesGrid {
  descriptors: string[];
  resolution: number;
  cells: Map<string, MapElitesCell | null>;
}

export interface MapElitesRun {
  baseline: BenchmarkResult;
  best: BenchmarkResult;
  grid: MapElitesGrid;
  filledCellCount: number;
  totalCells: number;
  exploredCandidates: EvolutionCandidate[];
}

export interface LearnerTurnSignal {
  topic: string;
  signal: "thumbs-up" | "thumbs-down" | "confused";
  masteryEstimate: number;
  evidence: string;
}

export interface PolicyJudgementCandidate {
  label: string;
  policy: TeacherPolicy;
  benchmark: BenchmarkResult;
  counterfactualBenchmark?: BenchmarkResult;
  preferenceScore: number;
}

export interface QuizLimits {
  questionChars: number;
  answerChars: number;
  explanationChars: number;
  rubricChars: number;
  optionChars: number;
}

export interface QuizReview {
  status: "passed" | "revised";
  issues: string[];
  duplicatesRemoved: number;
  maxQuestionChars: number;
  maxAnswerChars: number;
  maxExplanationChars: number;
  maxRubricChars: number;
  maxOptionChars: number;
  limits: QuizLimits;
}
