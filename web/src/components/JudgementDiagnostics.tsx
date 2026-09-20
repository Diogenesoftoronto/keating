import { useSyncExternalStore } from "react";
import { css } from "../../styled-system/css";
import { clearJudgementDiagnostics, configureJudgementDiagnostics, getJudgementDiagnostics, subscribeJudgementDiagnostics, type JudgementDiagnostic } from "../keating/judgement/diagnostics";
import type { TeachingAdjustmentController } from "../keating/judgement/teaching-adjustment";
import { Toggle } from "./Toggle";

const stack = css({ display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0 });
const row = css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" });
const muted = css({ color: "var(--muted-foreground)", fontSize: ".75rem" });
const mono = css({ fontFamily: "var(--mono-body)", fontSize: ".7rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" });
const summary = css({ cursor: "pointer", fontSize: ".8rem", fontWeight: 600, paddingBlock: ".5rem", _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const panel = css({ borderBlock: "1px solid var(--border)", background: "var(--background)", padding: ".5rem 1rem", flexShrink: 0, minWidth: 0 });

function EventDetails({ event }: { event: JudgementDiagnostic }) {
  return <details>
    <summary className={summary}>{event.origin} · {event.status}{event.elapsedMs !== undefined ? ` · ${event.elapsedMs} ms` : ""}</summary>
    <div className={stack}>
      <div className={muted}>{event.backend ?? "No backend dispatched"}{event.model ? ` / ${event.model}` : ""} · {event.calibration ? "Calibration attached" : "Uncalibrated estimate"}</div>
      {event.answerSource && <div className={muted}>Latest returned numbers: {event.answerSource.backend} / {event.answerSource.model} · {event.answerSource.calibration ? "calibration attached" : "uncalibrated"}. A later fallback may have failed.</div>}
      <div className={mono}>Session: {event.sessionId ?? "not supplied"} · Reply: {event.replyId ?? "not correlated"}</div>
      {event.reasons.length > 0 && <ol className={muted}>{event.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ol>}
      {event.questions.map((question, index) => <div key={index} className={stack}>
        <strong className={mono}>{question.id} · {question.type} · {question.options} options</strong>
        {question.details ? <pre className={mono}>{question.details}</pre> : <p className={muted}>Question details hidden. Enable redacted details in Diagnostics to inspect future calls.</p>}
        {question.value !== undefined && <span className={mono}>{question.type === "noul" ? "P(yes)" : "Ordinal score proxy"}: {question.value.toFixed(4)}</span>}
        {question.selected && <span className={mono}>Selected: {question.selected}</span>}
        {question.confidence !== undefined && <span className={mono}>Confidence: {question.confidence.toFixed(4)}</span>}
        {question.probabilities?.map((probability, i) => <div key={i} className={row}>
          <span className={mono}>{probability.label}</span>
          <meter aria-label={`${question.id}: ${probability.label}`} min={0} max={1} value={probability.value} />
          <span className={mono}>{probability.value.toFixed(4)}</span>
        </div>)}
      </div>)}
      {event.evidence && <details><summary className={summary}>Redacted evidence preview</summary><pre className={mono}>{event.evidence}</pre></details>}
      {event.usage && <p className={mono}>Tokens: {event.usage.inputTokens} input / {event.usage.outputTokens} output</p>}
      {event.application && <p className={muted}>{event.application}</p>}
      <p className={muted}>Raw probabilities and ordinal proxies do not establish learning or authorize an application decision.</p>
    </div>
  </details>;
}

/** Settings controls and a compact inspector share the same ephemeral store. */
export function JudgementDiagnostics({ controls = false, sessionId, teachingAdjustment }: { controls?: boolean; sessionId?: string | null; teachingAdjustment?: TeachingAdjustmentController | null }) {
  const state = useSyncExternalStore(subscribeJudgementDiagnostics, getJudgementDiagnostics, getJudgementDiagnostics);
  if (!controls && !state.enabled) return null;
  const reply = [...state.replies].reverse().find(item => !sessionId || item.sessionId === sessionId);
  const correlated = reply ? state.events.filter(event => event.replyId === reply.id) : [];
  const events = state.events.filter(event => !event.sessionId || !sessionId || event.sessionId === sessionId).slice(-20).reverse();
  const status = !reply ? "No reply observed since capture was enabled." : correlated.length
    ? `${correlated.length} judgement ${correlated.length === 1 ? "call" : "calls"} for ${reply.id}.`
    : "No judgement ran for this reply.";
  return <section aria-label="Judgement diagnostics" className={controls ? stack : panel}>
    {controls && <>
      <div className={row}><h3>Judgement diagnostics</h3><Toggle aria-label="Capture judgement diagnostics" checked={state.enabled} onChange={enabled => configureJudgementDiagnostics({ enabled })} /></div>
      <p className={muted}>Developer tools. Captured records stay in this tab. Turning capture off clears the buffer. Optional hosted reviews below send the stated input.</p>
      <div className={row}><span>Include redacted question details</span><Toggle aria-label="Include redacted question details" checked={state.details} onChange={details => configureJudgementDiagnostics({ details })} /></div>
      <p className={muted}>Future instructions, criteria and evidence previews may contain sensitive learning content. Known emails and credentials are redacted; review before sharing.</p>
      <div className={row}><span>Review completed replies</span><Toggle aria-label="Review completed replies" checked={state.reviewReplies} onChange={reviewReplies => configureJudgementDiagnostics({ reviewReplies })} /></div>
      <p className={muted}>Run a background move / learner need / response fit review using your independent judgement model setting. Hosted mode sends bounded, redacted turn text to the selected account service. These reviews never update learner grades.</p>
      <div className={row}><span>Review live transcripts</span><Toggle aria-label="Review live transcripts" checked={state.reviewLiveTranscripts} onChange={reviewLiveTranscripts => configureJudgementDiagnostics({ reviewLiveTranscripts })} /></div>
      <p className={muted}>Review paired learner and tutor transcript text after a short pause. Hosted mode sends bounded, redacted text to your judgement service. Reviews appear in the live inspector and never interrupt speech or change learning records.</p>
    </>}
    {state.enabled && <details open={controls}>
      <summary className={summary}>Judgements · {reply?.status ?? "idle"} · {events.length} recent {events.length === 1 ? "call" : "calls"}</summary>
      <div className={css({ maxHeight: "22rem", overflowY: "auto", paddingBlock: ".5rem", display: "flex", flexDirection: "column", gap: ".75rem" })}>
        <p role="status" className={muted}>{status} Judgements evaluate explicit questions, not every generated token.</p>
        {reply && <span className={mono}>{reply.sessionId} / {reply.id}</span>}
        {!controls && teachingAdjustment && sessionId && <TeachingAdjustmentReview controller={teachingAdjustment} sessionId={sessionId} />}
        {events.map(event => <EventDetails key={event.id} event={event} />)}
        {!events.length && <p className={muted}>Waiting for a judgement operation. Enable completed-reply reviews or run a course, prompt, or assessment review.</p>}
        <button type="button" onClick={clearJudgementDiagnostics} className={css({ alignSelf: "flex-start", padding: ".5rem .75rem", border: "1px solid var(--border)", borderRadius: ".375rem", fontSize: ".75rem", cursor: "pointer" })}>Clear captured calls</button>
      </div>
    </details>}
  </section>;
}

/** Only the active Chat passes application authority; Settings and Live remain observers. */
function TeachingAdjustmentReview({ controller, sessionId }: { controller: TeachingAdjustmentController; sessionId: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (state.sessionId !== sessionId || !state.proposal || !state.id || state.status === "empty") return null;
  const proposal = state.proposal;
  const labels = { "give-room-to-reason": "Give room to reason", "explain-next-step": "Explain the next step", "clarify-the-goal": "Clarify the learner's goal" };
  return <section aria-label="Teaching adjustment review" className={stack}>
    <strong>{labels[proposal.adjustment]}</strong>
    <p className={muted}>Proposed from the completed reply: {proposal.summary.move.replaceAll("_", " ")} / {proposal.summary.need.replaceAll("_", " ")} / {proposal.summary.fit}.</p>
    <p className={muted}>{proposal.calibration === "matched" ? "Matched calibration thresholds. Human review is still required." : proposal.calibration === "below-threshold" ? "Below calibrated thresholds. This suggestion is uncertain." : "Uncalibrated suggestion. These probabilities are estimates."} This changes only the next reply after you send a message. The teacher writes the response; grades and saved teaching policy stay unchanged.</p>
    <details><summary className={summary}>Review model evidence</summary>
      <p className={mono}>{proposal.backend.backend} / {proposal.backend.model}</p>
      {Object.entries(proposal.answers).map(([id, answer]) => <div key={id} className={stack}>
        <strong className={mono}>{id}: {answer.choice} · confidence {answer.confidence.toFixed(4)}</strong>
        {Object.entries(answer.probabilities).map(([label, probability]) => <span key={label} className={mono}>{label}: {probability.toFixed(4)}</span>)}
      </div>)}
    </details>
    {state.status === "review" ? <button type="button" onClick={() => controller.accept(state.id!)}>Apply to next reply</button>
      : <p role="status" className={muted}>{state.status === "queued" ? "Queued for your next message." : "Applied to this reply."}</p>}
    <button type="button" onClick={controller.cancel}>{state.status === "review" ? "Dismiss suggestion" : "Cancel adjustment"}</button>
  </section>;
}
