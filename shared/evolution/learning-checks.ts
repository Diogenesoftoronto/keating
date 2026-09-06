/** Fixed assessments are independent of candidate prompts and synthetic episode scores. */
export const LEARNING_CHECK_BANK_VERSION = "fractions-loop-bounds-v1";
export const LEARNING_CHECK_STAGES = ["precheck", "immediate", "delayed", "transfer"] as const;
export type LearningCheckStage = typeof LEARNING_CHECK_STAGES[number];
export type LearningCheckTopic = "fractions" | "loop-bounds";
export type LearningCheckAssistance = "none" | "assisted" | "unknown";

export interface LearningCheckSubmission {
  stage: LearningCheckStage;
  answers: Record<string, string>;
  /** Reported by the learner/operator, not verified by the grader. */
  assistance: LearningCheckAssistance;
}
export interface LearningCheckResponse {
  submittedAt: string;
  revisionId: string;
  assistance: LearningCheckAssistance;
  answers: Record<string, string>;
  itemScores: Record<string, number>;
  correct: number;
  total: number;
  score: number;
}
export interface LearningCheckRecord {
  schemaVersion: 1;
  bankVersion: typeof LEARNING_CHECK_BANK_VERSION;
  id: string;
  topic: LearningCheckTopic;
  revisionId: string;
  learnerId: string;
  startedAt: string;
  responses: Partial<Record<LearningCheckStage, LearningCheckResponse>>;
}
export interface LearningCheckItem {
  id: string;
  prompt: string;
  answerFormat: "number-or-fraction";
}
export interface LearningCheckView {
  schemaVersion: 1;
  bankVersion: typeof LEARNING_CHECK_BANK_VERSION;
  id: string;
  topic: LearningCheckTopic;
  revisionId: string;
  learnerId: string;
  startedAt: string;
  evidenceKind: "observed-learner-assessment";
  exposureSource: "operator-recorded";
  stages: Array<{
    stage: LearningCheckStage;
    availableAt: string | null;
    status: "pending-prerequisite" | "scheduled" | "ready" | "answered";
    items: LearningCheckItem[];
    result: LearningCheckResponse | null;
  }>;
  measurements: {
    /** Within-person score difference, not a causal treatment estimate. */
    immediateGain: number | null;
    retentionScore: number | null;
    transferScore: number | null;
    assistanceSource: "self-reported";
    establishesEffectiveness: false;
  };
}

// Answer keys stay in the grader. Neither saved records nor public item projections contain them.
type BankEntry = readonly [prompt: string, expected: number];
const BANK: Record<LearningCheckTopic, Record<LearningCheckStage, readonly BankEntry[]>> = {
  fractions: {
    precheck: [
      ["Which is larger, 1/5 or 1/8? Enter the larger fraction.", 1 / 5],
      ["What is 2/3 of 18?", 12],
      ["Write 3/4 as a decimal.", 0.75],
    ],
    immediate: [
      ["Which is larger, 1/4 or 1/7? Enter the larger fraction.", 1 / 4],
      ["What is 3/5 of 20?", 12],
      ["Write 5/8 as a decimal.", 0.625],
    ],
    delayed: [
      ["Which is larger, 1/6 or 1/10? Enter the larger fraction.", 1 / 6],
      ["What is 2/7 of 21?", 6],
      ["Write 3/5 as a decimal.", 0.6],
    ],
    transfer: [
      ["Two identical pizzas are cut into 8 and 12 equal slices. What fraction of a whole pizza is the larger single slice?", 1 / 8],
      ["A tank holds 35 liters when full. How many liters are in it when it is 3/5 full?", 21],
      ["A ribbon uses 0.375 of a spool. Enter that share as a fraction.", 3 / 8],
    ],
  },
  "loop-bounds": {
    precheck: [
      ["What number is printed? let total = 0; for (let i = 0; i < 4; i++) total += i; console.log(total);", 6],
      ["How many times does the body run? for (let i = 1; i <= 4; i++) { work(); }", 4],
      ["An array has 3 entries. A loop reads items[i] for i = 0 through i <= items.length. What is the first invalid index?", 3],
    ],
    immediate: [
      ["What number is printed? let total = 0; for (let i = 0; i < 5; i++) total += i; console.log(total);", 10],
      ["How many times does the body run? for (let i = 2; i <= 5; i++) { work(); }", 4],
      ["An array has 4 entries. A loop reads items[i] for i = 0 through i <= items.length. What is the first invalid index?", 4],
    ],
    delayed: [
      ["What number is printed? let total = 0; for (let i = 1; i < 5; i++) total += i; console.log(total);", 10],
      ["How many times does the body run? for (let i = 3; i <= 7; i++) { work(); }", 5],
      ["An array has 5 entries. A loop reads items[i] for i = 0 through i <= items.length. What is the first invalid index?", 5],
    ],
    transfer: [
      ["Six bins are numbered 0 through 5. A machine adds every bin number once to a running total starting at zero. What is the total?", 15],
      ["A page scanner starts at page = 3, processes while page < 8, and increments page by 1 each time. How many pages are processed?", 5],
      ["Seven seats are stored at zero-based array indices. A reservation script requests indices 1 through 7 inclusive. Which requested index is invalid?", 7],
    ],
  },
};
const DAY_MS = 24 * 60 * 60 * 1000;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error("Invalid learning-check timestamp.");
  return parsed;
}
function identifier(value: string, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid learning-check ${label}.`);
  }
  return value;
}
function entries(record: LearningCheckRecord, stage: LearningCheckStage) {
  return BANK[record.topic][stage].map(([prompt, expected], index) => ({
    id: `${record.topic}-${stage}-${index + 1}`, prompt, expected,
  }));
}
function availableAt(record: LearningCheckRecord, stage: LearningCheckStage): string | null {
  if (stage === "precheck") return record.startedAt;
  if (stage === "immediate") return record.responses.precheck?.submittedAt ?? null;
  const post = record.responses.immediate?.submittedAt;
  return post ? new Date(timestamp(post) + DAY_MS * (stage === "delayed" ? 1 : 7)).toISOString() : null;
}
function numericAnswer(answer: string): number | null {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)))?$/.exec(answer);
  if (!match) return null;
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  const value = Number(match[1]) / denominator;
  return denominator !== 0 && Number.isFinite(value) ? value : null;
}

export function createLearningCheck(input: {
  id: string; topic: LearningCheckTopic; revisionId: string; learnerId?: string; startedAt: string;
}): LearningCheckRecord {
  if (input.topic !== "fractions" && input.topic !== "loop-bounds") throw new Error("Learning checks support fractions and loop-bounds.");
  timestamp(input.startedAt);
  return {
    schemaVersion: 1,
    bankVersion: LEARNING_CHECK_BANK_VERSION,
    id: identifier(input.id, "id"),
    topic: input.topic,
    revisionId: identifier(input.revisionId, "revision id"),
    learnerId: identifier(input.learnerId ?? "local-learner", "learner id"),
    startedAt: input.startedAt,
    responses: {},
  };
}

export function submitLearningCheckResponse(
  record: LearningCheckRecord,
  submission: LearningCheckSubmission,
  submittedAt: string,
): LearningCheckRecord {
  if (!LEARNING_CHECK_STAGES.includes(submission.stage)) throw new Error("Invalid learning-check stage.");
  if (!["none", "assisted", "unknown"].includes(submission.assistance)) throw new Error("Assistance must be none, assisted, or unknown.");
  const items = entries(record, submission.stage);
  if (!submission.answers || typeof submission.answers !== "object" || Array.isArray(submission.answers)
    || Object.keys(submission.answers).length !== items.length) throw new Error("Submit exactly one answer for every stage item.");
  const answers: Record<string, string> = {};
  for (const item of items) {
    const answer = submission.answers[item.id];
    if (typeof answer !== "string" || !answer.trim() || answer.length > 200) throw new Error("Each item requires an answer of 1 to 200 characters.");
    answers[item.id] = answer.trim();
  }
  const prior = record.responses[submission.stage];
  if (prior) {
    if (prior.assistance === submission.assistance && JSON.stringify(prior.answers) === JSON.stringify(answers)) return record;
    throw new Error("Learning-check response conflict: this stage already has an immutable submission.");
  }
  const due = availableAt(record, submission.stage);
  if (due === null) throw new Error("Complete the prerequisite assessment first.");
  if (timestamp(submittedAt) < timestamp(due)) throw new Error(`This learning check is not available until ${due}.`);
  const itemScores = Object.fromEntries(items.map((item) => {
    const value = numericAnswer(answers[item.id]!);
    return [item.id, value !== null && Math.abs(value - item.expected) <= 1e-9 ? 1 : 0];
  }));
  const correct = Object.values(itemScores).reduce((sum, value) => sum + value, 0);
  return {
    ...record,
    responses: {
      ...record.responses,
      [submission.stage]: {
        submittedAt, revisionId: record.revisionId, assistance: submission.assistance,
        answers, itemScores, correct, total: items.length, score: correct / items.length,
      },
    },
  };
}

/** Validate persisted data by replaying submissions through the independent grader. */
export function parseLearningCheckRecord(value: unknown): LearningCheckRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid learning-check record.");
  const raw = value as LearningCheckRecord;
  if (raw.schemaVersion !== 1 || raw.bankVersion !== LEARNING_CHECK_BANK_VERSION || !raw.responses
    || typeof raw.responses !== "object" || Array.isArray(raw.responses)
    || Object.keys(raw.responses).some((key) => !LEARNING_CHECK_STAGES.includes(key as LearningCheckStage))) {
    throw new Error("Unsupported or invalid learning-check record.");
  }
  let restored = createLearningCheck(raw);
  for (const stage of LEARNING_CHECK_STAGES) {
    const response = raw.responses[stage];
    if (!response) continue;
    restored = submitLearningCheckResponse(restored, { stage, answers: response.answers, assistance: response.assistance }, response.submittedAt);
    const graded = restored.responses[stage]!;
    if (response.revisionId !== raw.revisionId || response.score !== graded.score || response.correct !== graded.correct
      || response.total !== graded.total || !response.itemScores
      || Object.keys(response.itemScores).length !== Object.keys(graded.itemScores).length
      || Object.entries(graded.itemScores).some(([id, score]) => response.itemScores[id] !== score)) {
      throw new Error("Learning-check record does not match its recorded revision or assessment grade.");
    }
  }
  return restored;
}

export function presentLearningCheck(record: LearningCheckRecord, now: string): LearningCheckView {
  const nowMs = timestamp(now);
  const unaided = (stage: LearningCheckStage) => {
    const response = record.responses[stage];
    return response?.assistance === "none" ? response.score : null;
  };
  const pre = unaided("precheck");
  const post = unaided("immediate");
  return {
    schemaVersion: record.schemaVersion, bankVersion: record.bankVersion, id: record.id,
    topic: record.topic, revisionId: record.revisionId, learnerId: record.learnerId, startedAt: record.startedAt,
    evidenceKind: "observed-learner-assessment", exposureSource: "operator-recorded",
    stages: LEARNING_CHECK_STAGES.map((stage) => {
      const due = availableAt(record, stage);
      const response = record.responses[stage] ?? null;
      const status = response ? "answered" : due === null ? "pending-prerequisite" : nowMs < timestamp(due) ? "scheduled" : "ready";
      return {
        stage, availableAt: due, status,
        items: status === "ready" || status === "answered"
          ? entries(record, stage).map(({ id, prompt }) => ({ id, prompt, answerFormat: "number-or-fraction" as const })) : [],
        result: response ? structuredClone(response) : null,
      };
    }),
    measurements: {
      immediateGain: pre === null || post === null ? null : post - pre,
      retentionScore: unaided("delayed"), transferScore: unaided("transfer"),
      assistanceSource: "self-reported", establishesEffectiveness: false,
    },
  };
}
