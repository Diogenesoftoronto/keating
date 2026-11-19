import type { LearnerMessage, PortableLearnerData } from "@keating/learner-contracts";
import type { NativeQuestionGrade } from "../judgement/submitted-question";

/** Called with a fresh SQLite transaction snapshot. Only the selected assistant receipt and submitted grade change. */
export function commitNativeQuestionGrade(data: PortableLearnerData, grade: NativeQuestionGrade, assistant: LearnerMessage | undefined,
  updatedAt: string): PortableLearnerData {
  const current = data.questionChecks.find(row => row.id === grade.check.id);
  const session = data.sessions.find(row => row.id === grade.check.sessionId);
  const user = session?.messages.findLastIndex(message => message.role === "user") ?? -1;
  if (!session || user < 0 || session.messages[user]!.id !== grade.turnId || grade.current?.() === false
    || !current || current.grading !== "pending" || current.score !== undefined || JSON.stringify(current) !== JSON.stringify(grade.check)) {
    throw new Error("The submitted answer changed before its grade could be saved.");
  }
  if (assistant?.role !== "assistant" || !assistant.agentEvents
    || session.messages.slice(user + 1).some(message => message.id !== assistant.id || message.role !== "assistant")
    || session.messages.slice(0, user + 1).some(message => message.id === assistant.id)) {
    throw new Error("The grading receipt does not belong to the current teaching turn.");
  }
  const events = assistant.agentEvents;
  const result = events.at(-1);
  const call = result?.type === "tool-result" && result.result.status === "success"
    ? events.find(event => event.type === "tool-call" && event.call.id === result.result.toolCallId
      && event.call.idempotencyKey === result.result.idempotencyKey) : undefined;
  if (result?.type !== "tool-result" || call?.type !== "tool-call" || call.call.name !== "grade_question_checks") {
    throw new Error("The grading receipt is missing.");
  }
  const output = JSON.parse(result.result.text);
  if (output?.questionCheckId !== current.id || output?.score !== grade.score || output?.verdict !== grade.verdict
    || output?.question !== current.question || output?.topic !== current.topic) throw new Error("The grading receipt does not match the saved answer.");

  return { ...data,
    questionChecks: data.questionChecks.map(check => check.id === current.id ? { ...check, grading: "model", score: grade.score,
      ...(grade.misconception ? { misconception: grade.misconception } : {}) } : check),
    sessions: data.sessions.map(row => row.id === session.id ? { ...row,
      updatedAt: Date.parse(updatedAt) > Date.parse(row.updatedAt) ? updatedAt : row.updatedAt,
      messages: [...row.messages.slice(0, user + 1), assistant] } : row),
  };
}
