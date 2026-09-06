import type {
  BenchmarkResult,
  Domain,
  EngagementPolicy,
  EvolutionCandidate,
  LearnerProfile,
  MapElitesGrid,
  MapElitesRun,
  SimulationWeights,
  TeacherPolicy,
  TopicDefinition,
} from "../../shared/pedagogy/types.js";

export type {
  BenchmarkResult,
  BenchmarkTopicTrace,
  BenchmarkTrace,
  CandidateDecision,
  Domain,
  EngagementPolicy,
  EvolutionCandidate,
  LearnerProfile,
  LessonPhase,
  LessonPlan,
  MapElitesCell,
  MapElitesGrid,
  MapElitesRun,
  PolicyDelta,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicBenchmark,
  TopicDefinition,
} from "../../shared/pedagogy/types.js";

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
