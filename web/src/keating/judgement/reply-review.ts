import { turnAnalysisQuestions, type JudgementCaller, type JudgementResponse, type CalibrationTable } from "@keating/learner-contracts";
import { subscribeJudgementModelSettings } from "../judgement-model";
import { subscribeWebJudgementCalibration } from "./calibration";
import { sanitizeDiagnosticText } from "../../lib/diagnostics";
import { beginDiagnosticReply, endDiagnosticReply, getJudgementDiagnostics, onJudgementDiagnosticsDisabled } from "./diagnostics";
import { createJudgementOperationCaller } from "./operation";
import { createWebJudgementRuntime } from "./runtime";

type Message = { role?: unknown; content?: unknown; stopReason?: unknown };
function plainText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.filter((part): part is { type: "text"; text: string } => !!part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map(part => part.text).join("\n");
}

/** Per-agent lifecycle: reviews only final visible text, never tools/thinking/system prompts.
 * Reviews are background diagnostics and cannot change any learner state.
 */
export function createReplyJudgementObserver(sessionId: string, makeCaller?: (replyId: string) => JudgementCaller, options: {
  onReview?: (response: JudgementResponse, messages: readonly Message[], replyId: string, calibration: CalibrationTable | undefined, current: () => boolean) => void;
  captureSourceValidity?: () => () => boolean;
} = {}) {
  let replyId: string | undefined;
  let controller: AbortController | undefined;
  let disposed = false;
  let messageStart = 0;
  const cancel = () => { controller?.abort(); controller = undefined; };
  const unsubscribe = onJudgementDiagnosticsDisabled(cancel);
  const unsubscribeModel = subscribeJudgementModelSettings(cancel);
  const unsubscribeCalibration = subscribeWebJudgementCalibration(cancel);
  return {
    start(messageCount = 0) {
      cancel();
      messageStart = messageCount;
      if (replyId) endDiagnosticReply(replyId, true);
      replyId = beginDiagnosticReply(sessionId);
    },
    finish(messages: readonly Message[]) {
      const id = replyId;
      replyId = undefined;
      const last = [...messages.slice(messageStart)].reverse().find(message => message.role === "assistant");
      const cancelled = last?.stopReason === "aborted" || last?.stopReason === "error";
      endDiagnosticReply(id, cancelled);
      if (disposed || !id || cancelled || !getJudgementDiagnostics().enabled || !getJudgementDiagnostics().reviewReplies) return;
      let assistant = -1;
      for (let index = messages.length - 1; index >= 0; index--) if (messages[index]?.role === "assistant") { assistant = index; break; }
      let user: Message | undefined;
      for (let index = assistant - 1; index >= 0; index--) if (messages[index]?.role === "user") { user = messages[index]; break; }
      const reply = last ? sanitizeDiagnosticText(plainText(last), 6000) : "";
      const learner = user ? sanitizeDiagnosticText(plainText(user), 3000) : "";
      if (!reply || !learner) return;
      try {
        controller = new AbortController();
        const signal = controller.signal;
        const source = structuredClone(messages);
        const sourceCurrent = options.captureSourceValidity?.() ?? (() => true);
        const current = () => !disposed && !signal.aborted && controller?.signal === signal && sourceCurrent()
          && getJudgementDiagnostics().enabled && getJudgementDiagnostics().reviewReplies;
        const runtime = makeCaller ? undefined : createWebJudgementRuntime();
        const call = makeCaller?.(id) ?? createJudgementOperationCaller({ runtime: runtime!,
          diagnostics: { origin: "completed-reply-review", sessionId, replyId: id, application: "Developer review only; no learner state changed." },
          accept: response => ["move", "need", "fit"].every(key => response.answers[key]?.type === "choice"),
        });
        // A proposal may be offered for explicit human review; no automatic application.
        void call({ state: { learner, tutor: reply }, questions: turnAnalysisQuestions() }, signal).then(outcome => {
          if (outcome.ok && current()) {
            options.onReview?.(outcome.response, source, id, runtime?.policy.calibration, current);
          }
        }).catch(() => {});
      } catch { cancel(); /* Optional review preparation must never interrupt the teacher. */ }
    },
    dispose() { disposed = true; cancel(); endDiagnosticReply(replyId, true); unsubscribe(); unsubscribeModel(); unsubscribeCalibration(); },
  };
}
