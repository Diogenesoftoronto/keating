import { useState, useSyncExternalStore } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { css } from "../../styled-system/css";
import { clearJudgementDiagnostics, configureJudgementDiagnostics, getJudgementDiagnostics, subscribeJudgementDiagnostics, type JudgementDiagnostic } from "../keating/judgement/diagnostics";
import type { TeachingAdjustmentController } from "../keating/judgement/teaching-adjustment";
import { describeReviewCause } from "../keating/judgement/draft-failure";
import { Switch, EmptyState } from "../design-system/kit";
import { Meter, ChartTable } from "../design-system/charts";
import { ConfirmAction } from "./settings/data/ConfirmAction";
import { DraftCheckHeatmap, ReplyReviewConfidence } from "./MessageDecisionVisuals";
import { MessageDraftDecision } from "./MessageDraftDecision";
import { CopyDiagnosticButton } from "./settings/CopyDiagnosticButton";
import { LearningIntelligenceDiagnostics, LearningOperationDetails } from "./LearningIntelligenceDiagnostics";
import { getLearningDiagnostics, subscribeLearningDiagnostics } from "../keating/learning-intelligence/diagnostics";
import { getLearningNavigationFeedback, subscribeLearningNavigationFeedback } from "../keating/learning-intelligence/source-navigation";
import { summarizeTurnJudgements, TurnJudgementSummary } from "./TurnJudgementSummary";
import { clearTurnLedger, getTurnLedger, subscribeTurnLedger } from "../keating/judgement/turn-ledger";
import { keatingStorage } from "../hooks/keating-storage";

const stack = css({ display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0 });
const row = css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" });
const muted = css({ color: "var(--muted-foreground)", fontSize: ".75rem" });
const mono = css({ fontFamily: "var(--mono-body)", fontSize: ".7rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" });
const summary = css({ cursor: "pointer", fontSize: ".8rem", fontWeight: 600, paddingBlock: ".5rem", _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const panel = css({ borderBlock: "1px solid var(--border)", background: "var(--background)", padding: ".5rem 1rem", flexShrink: 0, minWidth: 0 });
const inlinePanel = css({
  marginBlock: ".5rem",
  minWidth: 0,
  maxWidth: "36rem",
  "&:not([open]) > summary [data-glyph=chev]": { transform: "rotate(-90deg)", _rtl: { transform: "rotate(90deg)" } },
});
const inlineTrigger = css({
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "start",
  width: "fit-content",
  maxWidth: "100%",
  columnGap: ".625rem",
  minHeight: "2rem",
  padding: ".25rem .625rem",
  cursor: "pointer",
  borderRadius: "999px",
  border: "1px solid var(--border)",
  listStyle: "none",
  fontSize: ".8125rem",
  fontWeight: 650,
  "&::-webkit-details-marker": { display: "none" },
  _focusVisible: { outlineOffset: "2px" },
  "@media (hover: hover)": { _hover: { background: "var(--muted)" } },
});
const triggerText = css({
  display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 .625rem", minWidth: 0,
});
const inlineContent = css({
  display: "grid",
  gap: ".75rem",
  minWidth: 0,
  maxBlockSize: "min(30rem, 60dvh)",
  overflowY: "auto",
  overscrollBehaviorY: "contain",
  marginBlockStart: ".375rem",
  padding: ".75rem",
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: ".5rem",
  _focusVisible: { outlineOffset: "2px" },
  "& details > summary": { minHeight: "1.5rem", overflowWrap: "anywhere" },
});
const inlineOutcome = css({ fontWeight: 500, overflowWrap: "anywhere", color: "var(--muted-foreground)" });
const inlineIssue = css({ fontWeight: 650, overflowWrap: "anywhere", color: "var(--foreground)" });
const reason = css({ fontSize: ".8125rem", lineHeight: 1.5, overflowWrap: "anywhere" });
const settingsLink = css({
  minHeight: "1.5rem", marginBlockStart: ".125rem", cursor: "pointer", fontWeight: 600,
  padding: ".125rem 0", border: 0, background: "transparent", fontSize: ".75rem", textAlign: "start",
  textDecoration: "underline", textUnderlineOffset: ".18em", _focusVisible: { outlineOffset: "2px" },
});
const disclosureIcon = css({ marginBlockStart: ".2rem" });
const inspectorOutcome = css({ display: "grid", gap: ".125rem", overflowWrap: "anywhere" });
const inlineFailure = css({ borderInlineStart: "2px solid var(--destructive)", paddingInlineStart: ".625rem" });
const adjustmentBox = css({ background: "var(--accent)", color: "var(--accent-foreground)", padding: ".625rem", borderRadius: ".375rem", display: "grid", gap: ".375rem" });
const adjustmentActions = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".375rem .75rem" });
const adjustmentPrimary = css({
  minHeight: "2rem", paddingInline: ".625rem", background: "var(--primary)", color: "var(--primary-foreground)",
  borderRadius: ".375rem", fontSize: ".8125rem", fontWeight: 650, cursor: "pointer", _focusVisible: { outlineOffset: "2px" },
});
const operationNames = { extraction: "Extraction", forecast: "Forecast", memory: "Memory review" };
const learningRecovery = new Map([
  ["unauthorized", "Reconnect the extraction account in Settings."],
  ["rate-limited", "Wait a moment, then try again."],
]);

function EventDetails({ event, open }: { event: JudgementDiagnostic; open?: boolean }) {
  return <details open={open}>
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
          <Meter label={`${question.id}: ${probability.label}`} max={1} value={probability.value} valueText={probability.value.toFixed(4)} />
        </div>)}
        {question.probabilities && question.probabilities.length > 3 && <ChartTable caption={question.id} columns={["Choice", "Probability"]} rows={question.probabilities.map(p => [p.label, p.value.toFixed(4)])}/>}
      </div>)}
      {event.evidence && <details><summary className={summary}>Redacted evidence preview</summary><pre className={mono}>{event.evidence}</pre></details>}
      {event.usage && <p className={mono}>Tokens: {event.usage.inputTokens} input / {event.usage.outputTokens} output</p>}
      {event.application && <p className={muted}>{event.application}</p>}
      <p className={muted}>Raw probabilities and ordinal proxies do not establish learning or authorize an application decision.</p>
    </div>
  </details>;
}

/** Latest turn first; each turn shows its judgements in the order they ran. */
function TurnJudgementTimeline({ sessionId }: { sessionId?: string | null }) {
  const ledger = useSyncExternalStore(subscribeTurnLedger, getTurnLedger, getTurnLedger);
  const turns = ledger.filter(turn => !sessionId || turn.sessionId === sessionId).slice(-8).reverse();
  if (!turns.length) return <p className={muted}>Turns appear here as the tutor answers. Each one lists its draft checks, reply review, extraction and memory decisions.</p>;
  return <div aria-label="Judgements by turn" className={stack}>
    {turns.map((turn, index) => <TurnJudgementSummary key={turn.key} open={index === 0} status={turn.status}
      draft={turn.draft ? { snapshot: turn.draft } : undefined} record={turn} />)}
  </div>;
}

function SaveForReviewControls() {
  const [deleted, setDeleted] = useState<"idle" | "deleting" | "done" | "failed">("idle");
  return <>
    <ConfirmAction label="Delete saved judgement records" disabled={deleted === "deleting"}
      description="Delete saved judgement records and your labels on this device. Draft receipts stay with their conversations."
      onConfirm={() => { setDeleted("deleting"); void keatingStorage.deleteSessionJudgements().then(() => setDeleted("done"), () => setDeleted("failed")); }}/>
    {deleted === "done" && <p role="status" className={muted}>Saved judgement records and your labels were deleted. Draft receipts stay with their conversations.</p>}
    {deleted === "failed" && <p role="status" className={muted}>Saved records could not be deleted. Try again.</p>}
  </>;
}

/** Settings controls and a compact inspector share the same ephemeral store. */
export function JudgementDiagnostics({ controls = false, sessionId }: { controls?: boolean; sessionId?: string | null }) {
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
      <div className={row}><h3 id="sd-capture-switch">Capture judgement diagnostics</h3><Switch labelledBy="sd-capture-switch" checked={state.enabled} onChange={enabled => configureJudgementDiagnostics({ enabled })} /></div>
      <p className={muted}>Developer tools. Captured records stay in this tab. Turning capture off clears the buffer. Optional hosted reviews below send the stated input.</p>
      <div className={row}><span id="sd-include-redacted-question-details">Include redacted question details</span><Switch labelledBy="sd-include-redacted-question-details" checked={state.details} onChange={details => configureJudgementDiagnostics({ details })} /></div>
      <p className={muted}>Future instructions, criteria and evidence previews may contain sensitive learning content. Known emails and credentials are redacted; review before sharing.</p>
      <div className={row}><span id="sd-review-completed-replies">Review completed replies</span><Switch labelledBy="sd-review-completed-replies" checked={state.reviewReplies} onChange={reviewReplies => configureJudgementDiagnostics({ reviewReplies })} /></div>
      <p className={muted}>Run a background move / learner need / response fit review using your independent judgement model setting. Hosted mode sends bounded, redacted turn text to the selected account service. These reviews never update learner grades.</p>
      <div className={row}><span id="sd-review-live-transcripts">Review live transcripts</span><Switch labelledBy="sd-review-live-transcripts" checked={state.reviewLiveTranscripts} onChange={reviewLiveTranscripts => configureJudgementDiagnostics({ reviewLiveTranscripts })} /></div>
      <p className={muted}>Review paired learner and tutor transcript text after a short pause. Hosted mode sends bounded, redacted text to your judgement service. Reviews appear in the live inspector and never interrupt speech or change learning records.</p>
      <SaveForReviewControls />
    </>}
    {!controls && <TurnJudgementTimeline sessionId={sessionId} />}
    <LearningIntelligenceDiagnostics controls={controls} sessionId={sessionId} />
    {state.enabled && <details>
      <summary className={summary}>{controls ? "Judgements" : "All judgement calls (raw)"} · {reply?.status ?? "idle"} · {events.length} recent {events.length === 1 ? "call" : "calls"}</summary>
      <div className={css({ maxHeight: "22rem", overflowY: "auto", paddingBlock: ".5rem", display: "flex", flexDirection: "column", gap: ".75rem" })}>
        <p role="status" className={muted}>{status} Judgements evaluate explicit questions, not every generated token.</p>
        {reply && <span className={mono}>{reply.sessionId} / {reply.id}</span>}
        {events.map(event => <EventDetails key={event.id} event={event} />)}
        {!events.length && <EmptyState heading="No captured calls yet">Enable completed-reply reviews or run a course, prompt, or assessment review.</EmptyState>}
        <ConfirmAction label="Clear captured calls" description="Remove the captured calls, reply diagnostics and turn ledger from this tab’s memory." onConfirm={() => { clearJudgementDiagnostics(); clearTurnLedger(); }}/>
      </div>
    </details>}
  </section>;
}

/** Chat draws captured diagnostics only on rows that own their source messages. */
export function MessageDiagnostics({ sessionId, sourceIds, timestamps, role, teachingAdjustment }: {
  sessionId?: string;
  sourceIds?: readonly string[];
  timestamps?: readonly number[];
  role: "learner" | "tutor";
  teachingAdjustment?: TeachingAdjustmentController | null;
}) {
  const capture = useSyncExternalStore(subscribeJudgementDiagnostics, getJudgementDiagnostics, getJudgementDiagnostics);
  const ledger = useSyncExternalStore(subscribeTurnLedger, getTurnLedger, getTurnLedger);
  const learning = useSyncExternalStore(subscribeLearningDiagnostics, getLearningDiagnostics, getLearningDiagnostics);
  const navigation = useSyncExternalStore(subscribeLearningNavigationFeedback, getLearningNavigationFeedback, () => "");
  if (!capture.enabled || !sessionId) return null;
  const matchesTimestamp = (timestamp?: number) => timestamp !== undefined && timestamps?.includes(timestamp);
  const turn = ledger.findLast(row => row.sessionId === sessionId && matchesTimestamp(role === "tutor" ? row.assistantTimestamp : row.learnerTimestamp));
  const replies = role === "tutor" ? capture.replies.filter(reply => reply.sessionId === sessionId && matchesTimestamp(reply.assistantTimestamp)) : [];
  const events = capture.events.filter(event => event.sessionId === sessionId && replies.some(reply => reply.id === event.replyId));
  const operations = learning.filter(event => event.sessionId === sessionId && event.messageId && sourceIds?.includes(event.messageId));
  const extraction = turn?.extraction.find(row => row.role === role);
  const draft = role === "tutor" && turn?.draft ? { snapshot: turn.draft } : undefined;
  const hasJudgements = role === "tutor"
    ? !!(draft || turn?.replyReview || turn?.memory.length || extraction)
    : !!extraction;
  if (!hasJudgements && !events.length && !operations.length) return null;
  const failedCall = events.find(event => event.status === "failed");
  const failedOperation = operations.find(event => event.status === "failed" || event.status === "unavailable");
  const extractionIssue = extraction && (extraction.status === "failed" || extraction.status === "unavailable") ? extraction : undefined;
  const issue = [
    draft?.snapshot.phase === "withheld" && {
      label: "Draft withheld",
      reason: draft.snapshot.reason ? describeReviewCause(draft.snapshot.reason) : undefined,
    },
    role === "tutor" && turn?.status === "cancelled" && { label: "Reply cancelled" },
    failedCall && {
      label: "Judgement failed",
      reason: failedCall.reasons.map(describeReviewCause).find(Boolean) ?? failedCall.reasons[0],
    },
    failedOperation && {
      label: `${operationNames[failedOperation.kind]} ${failedOperation.status}`,
      reason: learningRecovery.get(failedOperation.reasons[0] ?? "") ?? failedOperation.reasons[0],
      openSettings: failedOperation.kind === "extraction" && failedOperation.status === "unavailable",
    },
    extractionIssue && { label: `Extraction ${extractionIssue.status}`, reason: extractionIssue.reasons[0] },
  ].find(entry => !!entry);
  const snapshot = draft?.snapshot;
  const flaggedCount = snapshot?.attempts.reduce((count, attempt) => count + attempt.checks.filter(check => check.status !== "pass").length, 0) ?? 0;
  const running = turn?.status === "running" || events.some(event => event.status === "running" || event.status === "queued");
  const released = snapshot?.phase === "released";
  const statusGlyph = issue || flaggedCount ? "alert" : running ? "clock" : released ? "check"
    : operations.length && operations.every(event => event.status === "abstained") ? "minus" : "scan";
  const outcome = hasJudgements && turn ? summarizeTurnJudgements({ draft, record: turn, role, status: turn.status })
    : operations.length ? `${operations.length} learning ${operations.length === 1 ? "operation" : "operations"}`
      : `${events.length} judgement ${events.length === 1 ? "call" : "calls"}`;
  const releasedDraft = released && snapshot.selectedAttempt != null ? `Released draft ${snapshot.selectedAttempt}` : undefined;
  const replyIds = replies.map(reply => reply.id);
  const timestamp = role === "learner" ? turn?.learnerTimestamp : turn?.assistantTimestamp ?? replies[0]?.assistantTimestamp;
  const date = timestamp === undefined ? undefined : new Date(timestamp);
  const identifiers = [
    ["Session", sessionId],
    ["Replies", replyIds.length ? replyIds.join(", ") : undefined],
    ["Message time", date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined],
  ].flatMap(([label, value]) => value === undefined ? [] : [`${label}: ${value}`]);
  return <details className={inlinePanel} data-quote-exclude="">
    <summary className={inlineTrigger}>
      <KeatingGlyph name={statusGlyph} className={disclosureIcon} size={15} />
      <span className={triggerText}>
        <span>Diagnostics</span>
        <span className={issue ? inlineIssue : inlineOutcome}>{issue?.label ?? (flaggedCount ? `${flaggedCount} flagged ${flaggedCount === 1 ? "check" : "checks"}` : running ? "Checks in progress" : releasedDraft ?? outcome)}</span>
      </span>
      <KeatingGlyph name="chev" className={disclosureIcon} size={15} />
    </summary>
    <div className={inlineContent} role="region" aria-label="Message diagnostics details" tabIndex={0}>
      <div className={inspectorOutcome}>
        <strong>{releasedDraft && snapshot ? `${releasedDraft} of ${snapshot.attempts.length}` : issue?.label ?? outcome}</strong>
        {flaggedCount > 0 && <p className={muted}>{flaggedCount} {flaggedCount === 1 ? "check flagged" : "checks flagged"} during draft review.</p>}
        {snapshot && <p className={muted}>{snapshot.judgeModel ?? "No reviewer dispatched"} · {snapshot.standard} response · {(snapshot.elapsedMs / 1000).toFixed(1)} s</p>}
      </div>
      {issue?.reason && <div className={inlineFailure}>
        {released && <strong>{issue.label}</strong>}
        <div className={reason}>
          <p>{issue.reason}</p>
          {issue.openSettings && <button type="button" className={settingsLink} onClick={() =>
            window.dispatchEvent(new CustomEvent("keating:open-settings", { detail: { tab: "diagnostics", section: "extraction-privacy" } }))
          }>Open Diagnostics settings</button>}
        </div>
      </div>}
      {teachingAdjustment && replies.length > 0 && <TeachingAdjustmentReview controller={teachingAdjustment}
        sessionId={sessionId} replyIds={replyIds} />}
      {snapshot && <MessageDraftDecision snapshot={snapshot} />}
      {snapshot && <DraftCheckHeatmap snapshot={snapshot} />}
      {role === "tutor" && turn?.replyReview && <ReplyReviewConfidence review={turn.replyReview} />}
      {hasJudgements && turn && <TurnJudgementSummary embedded role={role} status={turn.status}
        draft={draft} record={turn} />}
      {operations.length > 0 && <div>
        {operations.map(event => <LearningOperationDetails key={event.id} event={event} open={event.status === "failed" || event.status === "unavailable"} />)}
        <p role="status" className={muted}>{navigation}</p>
      </div>}
      {events.length > 0 && <details open={!!failedCall}>
        <summary className={summary}>Raw judgement calls · {events.length}</summary>
        {events.map(event => <EventDetails key={event.id} event={event} open={event.status === "failed"} />)}
      </details>}
      {events.length > 0 && <p className={muted}>Raw calls are captured in this tab. Check redacted details before sharing.</p>}
      <details>
        <summary className={summary}>Diagnostic IDs</summary>
        <pre className={mono}>{identifiers.join("\n")}</pre>
        <CopyDiagnosticButton label="Copy IDs" showLabel text={identifiers.join("\n")} />
      </details>
    </div>
  </details>;
}

/** Only the active Chat passes application authority; Settings and Live remain observers. */
function TeachingAdjustmentReview({ controller, sessionId, replyIds }: { controller: TeachingAdjustmentController; sessionId: string; replyIds: readonly string[] }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (state.sessionId !== sessionId || !state.proposal || !state.id || !replyIds.includes(state.id) || state.status === "empty") return null;
  const proposal = state.proposal;
  const labels = { "give-room-to-reason": "Give room to reason", "explain-next-step": "Explain the next step", "clarify-the-goal": "Clarify the learner's goal" };
  return <section aria-label="Teaching adjustment review" className={adjustmentBox}>
    <strong>Suggested for the next reply · {labels[proposal.adjustment]}</strong>
    <p className={muted}>Proposed from the completed reply: {proposal.summary.move.replaceAll("_", " ")} / {proposal.summary.need.replaceAll("_", " ")} / {proposal.summary.fit}.</p>
    <p className={muted}>{proposal.calibration === "matched" ? "Matched calibration thresholds. Human review is still required." : proposal.calibration === "below-threshold" ? "Below calibrated thresholds. This suggestion is uncertain." : "Uncalibrated suggestion. These probabilities are estimates."} This changes only the next reply after you send a message. The teacher writes the response; grades and saved teaching policy stay unchanged.</p>
    <div className={adjustmentActions}>
      {state.status === "review" && <button type="button" className={adjustmentPrimary} onClick={() => controller.accept(state.id!)}>Apply to next reply</button>}
      <button type="button" className={settingsLink} onClick={controller.cancel}>{state.status === "review" ? "Dismiss suggestion" : "Cancel adjustment"}</button>
    </div>
    <p role="status" className={muted}>{state.status === "queued" ? "Queued for your next message." : state.status === "applying" ? "Applying to the next reply." : ""}</p>
    <details><summary className={summary}>Review model evidence</summary>
      <p className={mono}>{proposal.backend.backend} / {proposal.backend.model}</p>
      {Object.entries(proposal.answers).map(([id, answer]) => <div key={id} className={stack}>
        <strong className={mono}>{id}: {answer.choice} · confidence {answer.confidence.toFixed(4)}</strong>
        {Object.entries(answer.probabilities).map(([label, probability]) => <span key={label} className={mono}>{label}: {probability.toFixed(4)}</span>)}
      </div>)}
    </details>
  </section>;
}
