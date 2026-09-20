import { turnAnalysisQuestions, type JudgementCaller } from "@keating/learner-contracts";
import { sanitizeDiagnosticText } from "../../lib/diagnostics";
import type { LiveTranscriptState } from "../live-transcript";
import { subscribeJudgementModelSettings } from "../judgement-model";
import { beginDiagnosticReply, endDiagnosticReply, getJudgementDiagnostics, onLiveTranscriptReviewDisabled } from "./diagnostics";
import { createJudgementOperationCaller } from "./operation";
import { createWebJudgementRuntime } from "./runtime";

/** Transcript-only observation. No callback can apply a grade, interrupt audio,
 * send a tutor message, or persist an inferred learner fact. */
export function createLiveTranscriptJudgementObserver(sessionId: string, options: {
  signal?: AbortSignal;
  debounceMs?: number;
  makeCaller?: (replyId: string) => JudgementCaller;
} = {}) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let replyId: string | undefined;
  let lastKey = "";
  const enabled = () => getJudgementDiagnostics().enabled && getJudgementDiagnostics().reviewLiveTranscripts;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    if (replyId) endDiagnosticReply(replyId, true);
    replyId = undefined;
  };
  const unsubscribeCapture = onLiveTranscriptReviewDisabled(cancel);
  // Calibration replacement emits the same event, including unchanged settings.
  const unsubscribeModel = subscribeJudgementModelSettings(cancel);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    unsubscribeCapture();
    unsubscribeModel();
    options.signal?.removeEventListener("abort", dispose);
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return {
    update(state: LiveTranscriptState) {
      if (disposed || !enabled()) { cancel(); return; }
      const drafting = !!(state.draft.user.trim() || state.draft.assistant.trim());
      const turn = drafting ? state.draft : state.turns.at(-1);
      // A new learner fragment invalidates the previous pair immediately.
      if (!turn?.user.trim() || !turn.assistant.trim()) { cancel(); return; }
      const learner = sanitizeDiagnosticText(turn.user, 3000);
      const tutor = sanitizeDiagnosticText(turn.assistant, 6000);
      const key = JSON.stringify([drafting ? state.turns.length : state.turns.length - 1, learner, tutor]);
      // A final marker with unchanged text does not pay for the same review twice.
      if (key === lastKey) return;
      lastKey = key;
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || !enabled()) return;
        const id = beginDiagnosticReply(sessionId);
        if (!id) return;
        replyId = id;
        const active = new AbortController();
        controller = active;
        // Defer invocation so a throwing adapter cannot escape the audio callback.
        void Promise.resolve().then(() => {
          if (active.signal.aborted || disposed || !enabled()) return;
          const call = options.makeCaller?.(id) ?? createJudgementOperationCaller({
            runtime: createWebJudgementRuntime(),
            diagnostics: { origin: "live-transcript-review", sessionId, replyId: id,
              application: "Provisional transcript review only; speech and learning records unchanged." },
            accept: response => ["move", "need", "fit"].every(key => response.answers[key]?.type === "choice"),
          });
          return call({ state: { learner, tutor }, questions: turnAnalysisQuestions() }, active.signal);
        }).catch(() => {}).finally(() => {
          if (controller !== active) return;
          endDiagnosticReply(id, active.signal.aborted);
          controller = undefined;
          replyId = undefined;
        });
      }, Math.max(0, options.debounceMs ?? 700));
    },
    dispose,
  };
}
