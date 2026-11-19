import type { SubmittedComprehensionAnswer, TeachingPolicyTurn } from "@keating/learner-contracts";
import type { Context } from "@earendil-works/pi-ai";
import type { DraftSubmissionEvidence } from "./draft-evidence";

export type SubmittedGradeTarget = SubmittedComprehensionAnswer & { readonly sessionId: string };
type Verdict = NonNullable<TeachingPolicyTurn["confirmedQuestionGrade"]>["verdict"];
interface ReleasedGrade { readonly callId: string; readonly grade: string; readonly target: SubmittedGradeTarget;
  readonly onCommitted?: (result: CommittedGrade) => void }
export interface CommittedGrade { readonly callId: string; readonly target: SubmittedGradeTarget; readonly verdict: Verdict; readonly score: number; readonly grade: string }

// These capabilities follow one local model RPC and its tool RPC. Neither key nor value enters a model request or persisted transcript.
const releases = new WeakMap<AbortSignal, ReleasedGrade>();
const executions = new WeakMap<AbortSignal, ReleasedGrade>();

function gradeProposal(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("topic" in value) || typeof value.topic !== "string"
    || !("results" in value) || !Array.isArray(value.results) || value.results.length !== 1) return;
  const item: unknown = value.results[0];
  if (!item || typeof item !== "object" || !("question" in item) || typeof item.question !== "string" || !("verdict" in item)
    || !["correct","partial","incorrect"].some(verdict => verdict === item.verdict)) return;
  return JSON.stringify([value.topic, item.question, item.verdict, "misconception" in item ? item.misconception : null]);
}

export function matchesSubmittedGrade(call: { name: string; arguments: unknown }, target: SubmittedComprehensionAnswer): boolean {
  const args = call.arguments;
  return call.name === "grade_question_checks" && !!gradeProposal(args) && !!args && typeof args === "object"
    && "topic" in args && args.topic === target.topic && "results" in args && Array.isArray(args.results) && args.results[0].question === target.question;
}

/** Bind only the tool call in the released, host-checked candidate. */
export function releaseSubmittedGrade(signal: AbortSignal | undefined, call: { id: string; name: string; arguments: unknown }, target: SubmittedGradeTarget,
  onCommitted?: (result: CommittedGrade) => void): void {
  const grade = gradeProposal(call.arguments);
  if (!signal || call.name !== "grade_question_checks" || !grade) throw new Error("Cannot bind the saved grading request.");
  releases.set(signal, { callId: call.id, grade, target: { ...target }, onCommitted });
}

/** Called only after the conditional write for the bound target completes. A proposed grade or a provider string cannot arm feedback. */
export function submittedGradeCommitted(signal: AbortSignal | undefined, verdict: Verdict, score: number): void {
  const release = signal && executions.get(signal);
  if (release) release.onCommitted?.({ callId: release.callId, target: release.target, grade: release.grade, verdict, score });
}

export function currentGradeFeedback(committed: CommittedGrade, submittedAt: number, messages: Context["messages"],
  row: DraftSubmissionEvidence["recordedComprehension"]): TeachingPolicyTurn["confirmedQuestionGrade"] {
  const [learner, assistant, result] = messages.slice(-3);
  if (learner?.role !== "user" || learner.timestamp !== submittedAt || assistant?.role !== "assistant" || result?.role !== "toolResult"
    || result.toolName !== "grade_question_checks" || result.toolCallId !== committed.callId || result.isError) return;
  const calls = assistant.content.filter(part => part.type === "toolCall");
  if (calls.length !== 1 || calls[0]?.name !== result.toolName || calls[0].id !== result.toolCallId
    || gradeProposal(calls[0].arguments) !== committed.grade) return;
  const { target, verdict, score } = committed;
  if (!row || row.id !== target.id || row.topic !== target.topic || row.question !== target.question || row.answer !== target.answer || row.score !== score) return;
  return { topic: row.topic, question: row.question, answer: row.answer, verdict, score };
}

/** The invocation still passes through the ordinary validated, authorized tool executor. */
export function prepareSubmittedGradeExecution(model: AbortSignal | undefined, execution: AbortSignal, name: string, callId: string, args: unknown): void {
  const release = model && releases.get(model);
  if (!release) return;
  if (name !== "grade_question_checks" || callId !== release.callId || gradeProposal(args) !== release.grade)
    throw new Error("The grading request differs from the reviewed submission.");
  executions.set(execution, release);
}

export function submittedGradeTarget(signal: AbortSignal | undefined, args: unknown): SubmittedGradeTarget | undefined {
  const release = signal && executions.get(signal);
  if (release && release.grade !== gradeProposal(args)) throw new Error("The grading request changed after review.");
  return release?.target;
}
