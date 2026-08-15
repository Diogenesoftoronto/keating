import type {
  BenchmarkResult,
  Domain,
  LearnerProfile,
  SimulationWeights,
  TeacherPolicy,
  TopicDefinition,
} from "../../shared/pedagogy/types.js";

export type {
  BenchmarkResult,
  BenchmarkTopicTrace,
  BenchmarkTrace,
  Domain,
  LearnerProfile,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicBenchmark,
  TopicDefinition,
} from "../../shared/pedagogy/types.js";

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

export interface QuizResultRecord {
  topic: string;
  timestamp: string;
  /** Points earned; partial credit allowed, so may be fractional. */
  correct: number;
  total: number;
  /** correct / total, clamped to [0, 1]. */
  score: number;
}

export interface RealLearnerOutcome {
  learnerId: string;
  topic: string;
  feedbackSignal: "thumbs-up" | "thumbs-down" | "confused";
  quizScore: number | null;
  sessionDurationMs: number | null;
  masteryEstimate: number;
  outcomeScore: number;
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
    comment?: string;
  }>;
  quizResults?: QuizResultRecord[];
  sessions: Array<{
    startedAt: string;
    endedAt?: string;
    topicsCovered: string[];
  }>;
  engagementPolicy?: EngagementPolicy;
  profile: LearnerProfile;
}
