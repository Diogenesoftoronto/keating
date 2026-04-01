export type Domain = "math" | "science" | "philosophy" | "general";

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
