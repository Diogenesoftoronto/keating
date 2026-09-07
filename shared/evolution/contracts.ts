/** Portable teaching experiments. Synthetic episodes never establish human learning. */
export type EpisodeSplit = "train" | "validation" | "holdout";
export interface EpisodeMessage {
  role: "user" | "assistant";
  content: string;
}
export interface TeachingCriterion {
  id: string;
  description: string;
  critical: boolean;
}
export interface TeachingCase {
  id: string;
  family: string;
  domain: "mathematics" | "programming";
  split: EpisodeSplit;
  messages: EpisodeMessage[];
  rubric: TeachingCriterion[];
}
export interface TeachingSkill {
  id: string;
  title: string;
  instructions: string;
  hypothesis: string;
  evidenceIds: string[];
  /** Persistent wiki patterns motivating this procedure; absent on legacy revisions. */
  patternIds?: string[];
}
export interface TeachingRevision {
  schemaVersion: 1;
  id: string;
  parentId: string | null;
  createdAt: string;
  basePrompt: string;
  skills: TeachingSkill[];
}
export interface EpisodeToolCall {
  name: string;
  arguments: unknown;
  result?: string;
}
export interface EpisodeExecution {
  messages: EpisodeMessage[];
  toolCalls: EpisodeToolCall[];
  model: string;
  runtime: string;
}
export type EpisodeRunner = (input: {
  caseId: string;
  systemPrompt: string;
  messages: EpisodeMessage[];
  signal: AbortSignal;
}) => Promise<EpisodeExecution>;
export interface CriterionJudgment {
  criterionId: string;
  passed: boolean;
  rationale: string;
}
/** The judge receives the fixed case and actual execution, never candidate instructions. */
export type EpisodeJudge = (input: {
  testCase: TeachingCase;
  execution: EpisodeExecution;
  signal: AbortSignal;
}) => Promise<CriterionJudgment[]>;
export interface EpisodeResult {
  id: string;
  caseId: string;
  family: string;
  split: EpisodeSplit;
  repeat: number;
  revisionId: string;
  status: "ok" | "runner-error" | "judge-error";
  score: number | null;
  criticalPassed: boolean;
  judgments: CriterionJudgment[];
  execution?: EpisodeExecution;
  /** Stable diagnostic codes; provider text can contain private payloads. */
  errorCode?: string;
}
export interface EpisodeBenchmark {
  schemaVersion: 1;
  runId: string;
  suiteDigest: string;
  revisionId: string;
  split: EpisodeSplit;
  evidenceKind: "synthetic";
  metric: "fixed-rubric-behavior-v1";
  repeats: number;
  /** Only this split; the training benchmark must never disclose holdout cases. */
  caseManifest: TeachingCase[];
  results: EpisodeResult[];
  meanScore: number | null;
  errorCount: number;
}
export interface PromotionDecision {
  accepted: boolean;
  scope: "experimental-teaching-behavior";
  reasons: string[];
  pairedCases: number;
  wins: number;
  losses: number;
  ties: number;
  meanDelta: number | null;
  /** One predeclared, one-sided paired sign test, clustered by case family. */
  pValue: number | null;
}
export interface TeachingHypothesis {
  id: string;
  statement: string;
  evidenceIds: string[];
  status: "proposed" | "supported-offline" | "rejected";
}
export interface SkillProposal {
  skill: TeachingSkill;
  hypothesis: TeachingHypothesis;
}
export type SkillProposer = (input: {
  incumbent: TeachingRevision;
  training: EpisodeBenchmark;
  hypotheses: TeachingHypothesis[];
  wiki?: import("./wiki.js").WikiAccess;
  signal: AbortSignal;
}) => Promise<SkillProposal>;
