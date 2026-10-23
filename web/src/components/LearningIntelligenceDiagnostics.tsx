import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { css } from "../../styled-system/css";
import { Toggle } from "./Toggle";
import { getJudgementDiagnostics, subscribeJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { clearLearningDiagnostics, discardLearningDiagnosticAnchor, getLearningDiagnostics, subscribeLearningDiagnostics } from "../keating/learning-intelligence/diagnostics";
import { learningIntelligenceAccount, learningIntelligenceEnabled, setLearningIntelligenceEnabled, subscribeLearningIntelligence, connectLearningIntelligence } from "../keating/learning-intelligence/account";
import { clearLearningPassage, getLearningNavigationFeedback, getLearningPassage, learningPassageExcerpt, navigateLearningSource, setLearningNavigationFeedback, subscribeLearningNavigationFeedback, subscribeLearningPassage } from "../keating/learning-intelligence/source-navigation";
import type { LearningEvidenceAnchor } from "@keating/learner-contracts";
import { sanitizeDiagnosticText } from "../lib/diagnostics";

const stack = css({ display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0 });
const muted = css({ color: "var(--muted-foreground)", fontSize: ".75rem", overflowWrap: "anywhere" });
const mono = css({ fontFamily: "var(--mono-body)", fontSize: ".75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
const button = css({ alignSelf: "flex-start", padding: ".5rem .75rem", border: "1px solid var(--border)", borderRadius: ".375rem", fontSize: ".75rem", cursor: "pointer", _hover: { background: "var(--muted)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" }, _disabled: { opacity: .5, cursor: "wait" } });
const summary = css({ cursor: "pointer", fontSize: ".8rem", fontWeight: 600, paddingBlock: ".5rem" });
const forecastStatus = (status: string) => ({
  "insufficient-history": "Not enough recorded outcomes.",
  "unvalidated-model-proposal": "Model proposal, not validated against this learner's outcomes.",
  "abstained": "No model forecast was accepted. The usual learning rules remain available.",
}[status] ?? status.replaceAll("-", " "));
function ReviewDueDate({ dueAt }: { dueAt: number }) {
  const date = new Date(dueAt);
  return Number.isFinite(date.getTime()) ? <p className={muted}>Scheduled review: <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>. This date comes from spaced repetition.</p> : null;
}

function SourceLink({ anchor }: { anchor: LearningEvidenceAnchor }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const quoteId = useId();
  return <div className={stack}>
    <q id={quoteId} className={mono}>{sanitizeDiagnosticText(anchor.quote, 4000)}</q>
    <p className={muted}>Source conversation: {anchor.sessionId}. Opens the source conversation.</p>
    <button type="button" className={button} aria-describedby={quoteId} aria-busy={busy} aria-disabled={busy} onClick={async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const result = await navigateLearningSource(anchor);
        if (result === "stale") {
          discardLearningDiagnosticAnchor(anchor);
          const selected = getLearningPassage()?.anchor;
          if (selected?.sessionId === anchor.sessionId && selected.messageId === anchor.messageId && selected.sourceHash === anchor.sourceHash) clearLearningPassage();
        }
      } catch { setLearningNavigationFeedback("The original message could not be opened."); }
      finally { inFlight.current = false; setBusy(false); }
    }}>{busy ? "Opening source conversation…" : "Open original passage in source conversation"}</button>
  </div>;
}

export function LearningIntelligenceDiagnostics({ controls = false, sessionId }: { controls?: boolean; sessionId?: string | null }) {
  const capture = useSyncExternalStore(subscribeJudgementDiagnostics, getJudgementDiagnostics, getJudgementDiagnostics);
  const events = useSyncExternalStore(subscribeLearningDiagnostics, getLearningDiagnostics, getLearningDiagnostics);
  const enabled = useSyncExternalStore(subscribeLearningIntelligence, learningIntelligenceEnabled, () => false);
  const [account, setAccount] = useState(learningIntelligenceAccount);
  const [connection, setConnection] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connectPending = useRef(false);
  const navigationStatus = useSyncExternalStore(subscribeLearningNavigationFeedback, getLearningNavigationFeedback, () => "");
  useEffect(() => subscribeLearningIntelligence(() => setAccount(learningIntelligenceAccount())), []);
  const recent = events.filter(event => !sessionId || event.sessionId === sessionId).slice(-12).reverse();
  if (!controls && !capture.enabled) return null;
  return <section aria-label="Learning extraction and forecasts" className={stack}>
    {controls && <>
      <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" })}>
        <h4>Learning extraction and forecasts</h4>
        <Toggle aria-label="Enable learning extraction and forecasts" checked={enabled} onChange={setLearningIntelligenceEnabled} />
      </div>
      <p className={muted}>Use bounded lesson and learner passages to ground feedback, quizzes, constraints and memory. Forecasts estimate the next recorded answer or card self-rating, which does not establish objective mastery. Review dates come from spaced repetition. Hosted requests use your Not Organic account.</p>
      {!account.authorized && <button type="button" className={button} aria-busy={connecting} aria-disabled={connecting || !account.configured} onClick={async () => {
        if (connectPending.current || !account.configured) return;
        connectPending.current = true;
        setConnecting(true); setConnection("");
        try { window.location.assign(await connectLearningIntelligence(window.location.href)); }
        catch { setConnection("The extraction account could not be connected. Try again when the account service is available."); setConnecting(false); connectPending.current = false; }
      }}>{connecting ? "Connecting account…" : "Connect extraction account"}</button>}
      <p role="status" aria-live="polite" className={muted}>{connection}</p>
      {!account.configured && <p className={muted}>Account connection is unavailable in this build.</p>}
    </>}
    {capture.enabled && <details open={controls}>
      <summary className={summary}>Extraction and forecasts · {recent.length} recent operations</summary>
      <div className={css({ display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0, maxHeight: "min(22rem, 40dvh)", overflowY: "auto", paddingBlock: ".5rem" })}>
        {recent.length === 0 && <p className={muted}>Operations appear here after learning extraction or a forecast runs. Enable details to retain exact source links for future operations.</p>}
        {recent.map(event => <details key={event.id}>
          <summary className={summary}>{event.kind} · {event.status}{event.model ? ` · ${event.model}` : ""}{event.elapsedMs !== undefined ? ` · ${Math.round(event.elapsedMs)} ms` : ""}</summary>
          <div className={stack}>
            <p className={muted}>Source conversation: {event.sessionId} · Recorded <time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleString()}</time></p>
            {event.reasons.length > 0 && <ul className={muted}>{event.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
            {event.forecast?.map((forecast, index) => <div key={index} className={mono}>
              <strong>{forecast.target}</strong>
              {forecast.probability !== undefined && <span>: {Math.round(forecast.probability * 100)}% estimated probability</span>}
              {forecast.median !== undefined && <span>: median {forecast.median.toFixed(2)}{forecast.p10 !== undefined && forecast.p90 !== undefined ? `, central 80% range ${forecast.p10.toFixed(2)}–${forecast.p90.toFixed(2)}` : ""}</span>}
              {forecast.observedCount !== undefined && <span> · {forecast.observedCount} observations</span>}
              {forecast.baseline !== undefined && <p className={muted}>Usual estimate from recorded outcomes: {forecast.baseline.toFixed(2)}.</p>}
              {forecast.dueAt !== undefined && <ReviewDueDate dueAt={forecast.dueAt} />}
              {forecast.horizonHours !== undefined && <p className={muted}>Forecast horizon: {forecast.horizonHours} hours.</p>}
              {forecast.status && <p className={muted}>{forecastStatus(forecast.status)}</p>}
            </div>)}
            {event.evidence?.map((anchor, index) => <SourceLink key={`${anchor.messageId}:${anchor.start}:${index}`} anchor={anchor} />)}
            {!event.evidence?.length && <p className={muted}>No source passages retained. Exact quotes are captured only while diagnostic details are enabled.</p>}
          </div>
        </details>)}
        {recent.length > 0 && <button type="button" className={button} onClick={clearLearningDiagnostics}>Clear learning operations</button>}
      </div>
    </details>}
    <p role="status" aria-live="polite" className={muted}>{navigationStatus}</p>
  </section>;
}

/** Rich lesson markup can hide source characters. Show the verified original rather than inventing rendered offsets. */
export function LearningSourcePassage({ sessionId, sourceIds }: { sessionId?: string; sourceIds: readonly string[] }) {
  const selected = useSyncExternalStore(subscribeLearningPassage, getLearningPassage, () => null);
  if (!selected || selected.anchor.sessionId !== sessionId || !sourceIds.includes(selected.anchor.messageId)) return null;
  const { anchor, source } = selected;
  const excerpt = learningPassageExcerpt(source.text, anchor.start, anchor.end);
  return <section aria-label="Original source passage" data-learning-passage={anchor.messageId} className={css({ marginBlock: ".75rem", padding: ".75rem", border: "1px solid var(--border)", borderRadius: ".375rem", background: "var(--background)", minWidth: 0 })}>
    <details open>
      <summary className={summary}>Original message</summary>
      <p className={mono}>{excerpt.before}<mark data-learning-exact-passage tabIndex={-1}>{excerpt.quote}</mark>{excerpt.after}</p>
    </details>
    <button type="button" className={button} onClick={event => {
      const row = event.currentTarget.closest<HTMLElement>("[data-learning-message-ids]");
      row?.focus({ preventScroll: true });
      clearLearningPassage();
    }}>Close source passage</button>
  </section>;
}
