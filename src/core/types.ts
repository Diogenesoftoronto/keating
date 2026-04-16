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

export interface BenchmarkResult {
  policy: TeacherPolicy;
  suiteName: string;
  topicBenchmarks: TopicBenchmark[];
  overallScore: number;
  weakestTopic: string;
  trace: BenchmarkTrace;
}

export interface EvolutionCandidate {
  policy: TeacherPolicy;
  benchmark: BenchmarkResult;
  parentName: string | null;
  iteration: number;
  novelty: number;
  accepted: boolean;
  decision: CandidateDecision;
  parameterDelta: PolicyDelta[];
}

export interface PolicyDelta {
  field: keyof TeacherPolicy;
  before: number | string;
  after: number | string;
  delta: number;
}

export interface CandidateDecision {
  improves: boolean;
  safe: boolean;
  novelEnough: boolean;
  scoreDelta: number;
  weakestTopicDelta: number;
  reasons: string[];
}

export interface BenchmarkTrace {
  seed: number;
  learnerCountPerTopic: number;
  topicTraces: BenchmarkTopicTrace[];
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

export interface VerifiedClaim {
  claim: string;
  status: "confirmed" | "unconfirmed" | "corrected";
  source?: string;
  correction?: string;
}

export interface VerificationResult {
  topic: string;
  contentHash: string;
  claims: VerifiedClaim[];
  overallConfidence: number;
  checkedAt: string;
}

export interface EngagementPolicy {
  name: string;
  /** Retention half-life in days at mastery=1.0 */
  retentionHalfLifeDays: number;
  /** Threshold below which a topic is "due" for review */
  dueThreshold: number;
  /** Minimum days between reviews even if retention is low */
  minReviewIntervalDays: number;
  /** Urgency tiers: [critical, high, moderate, low] day thresholds */
  urgencyTiers: [number, number, number, number];
}

export interface TopicEngagement {
  slug: string;
  title: string;
  domain: Domain;
  lastSeen: string;
  daysSinceLastSeen: number;
  masteryEstimate: number;
  estimatedRetention: number;
  isDue: boolean;
  /** 0–1, higher = more urgent */
  urgency: number;
  urgencyLabel: "critical" | "high" | "moderate" | "low" | "fresh";
  sessionCount: number;
  /** ISO date of recommended next review */
  nextReviewAt: string;
}

export interface EngagementTimeline {
  generatedAt: string;
  policy: EngagementPolicy;
  topics: TopicEngagement[];
  summary: {
    totalTopics: number;
    dueCount: number;
    criticalCount: number;
    averageRetention: number;
    oldestUnreviewedDays: number;
  };
}

export interface SimulationWeights {
  masteryGain: number;
  retention: number;
  engagement: number;
  transfer: number;
  confusion: number;
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

export interface LearnerState {
  id: string;
  coveredTopics: Array<{
    slug: string;
    domain: Domain;
    lastSeen: string;
    masteryEstimate: number;
    sessionCount: number;
  }>;
  identifiedMisconceptions: Array<{
    topic: string;
    misconception: string;
    addressed: boolean;
  }>;
  feedback: Array<{
    topic: string;
    timestamp: string;
    signal: "thumbs-up" | "thumbs-down" | "confused";
  }>;
  sessions: Array<{
    startedAt: string;
    endedAt?: string;
    topicsCovered: string[];
  }>;
  engagementPolicy?: EngagementPolicy;
  profile: LearnerProfile;
}
