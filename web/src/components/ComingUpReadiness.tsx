import { useEffect, useMemo, useRef, useState } from "react";
import { css } from "../../styled-system/css";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";
import { loadDeclaredProfile, subscribeDeclaredProfile } from "../keating/learner-profile-store";
import { loadLearnerContext, subscribeLearnerContext } from "../keating/learner-context";
import { createComingUpReadinessSession, loadComingUpReadiness, READINESS_HISTORY_SCOPE,
  type ComingUpReadinessSource, type ComingUpReadinessView as ReadinessViewState } from "../keating/judgement/coming-up-readiness";

const styles = {
  section: css({ mt: "1rem", py: "1rem", borderBottom: "1px solid var(--ink)", color: "var(--ink)" }),
  row: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
  title: css({ fontFamily: "var(--mono-display)", fontSize: "0.875rem", fontWeight: 700 }),
  copy: css({ mt: "0.375rem", maxW: "70ch", fontSize: "0.75rem", lineHeight: "1.3rem", color: "var(--ink-soft)", overflowWrap: "anywhere" }),
  button: css({ minH: "2.75rem", border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--card)", color: "var(--ink)", px: "0.875rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
    _hover: { bg: "var(--ink)", color: "var(--paper)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" }, _disabled: { cursor: "not-allowed", opacity: 0.6 } }),
};
const blockedLabels = {
  "not-due": "Not due yet.", "not-covered": "No recorded exposure to this topic.",
  "unknown-prerequisites": "Prerequisite graph unavailable for this topic.",
  "unmet-prerequisite": "Some prerequisites still need recorded exposure or plan completion.", "no-work": "No saved question answers to review.",
};

export function ComingUpReadinessView({ view, hasDueDecks, onReview, onStart }: {
  view: ReadinessViewState; hasDueDecks: boolean; onReview: () => void; onStart: (deckId: string) => void;
}) {
  const { result } = view;
  const review = result?.review;
  const selected = review?.status === "selected" ? result?.input.items.find(item => item.id === review.selectedId) : null;
  const title = (id: string) => result?.input.items.find(item => item.id === id)?.title ?? "Study item";
  const reason = result?.reason === "input-budget" ? "This queue exceeds the review limit of 20 due decks, 100 due cards per deck, or complete source text. Ordinary review is still available."
    : result?.reason === "stale" || view.stale ? "Your study evidence or settings changed. Request a fresh review."
    : result?.reason === "cancelled" ? "Readiness review stopped. You can request it again."
    : result?.reason === "unavailable" || review?.status === "unavailable" ? "Readiness review unavailable. Check judgement settings or account access."
    : review?.status === "no-ready-candidate" ? "No next-study recommendation from the available evidence. You can still choose a due deck below."
    : null;
  return <section className={styles.section} aria-labelledby="study-readiness-title">
    <div className={styles.row}>
      <h2 id="study-readiness-title" className={styles.title}>Readiness for your due decks</h2>
      <button type="button" className={styles.button} disabled={!hasDueDecks || view.pending} onClick={onReview}>
        {view.pending ? "Checking readiness…" : "Check study readiness"}
      </button>
    </div>
    <p className={styles.copy}>Uses saved answers and prerequisites from known topics or a bound saved study plan. Hosted review sends this evidence using your <a href="/chat?settings=judgement" style={{ textDecoration: "underline" }}>judgement settings</a>.</p>
    <p className={styles.copy}>{READINESS_HISTORY_SCOPE} Your queue order and review dates stay as set.</p>
    <div aria-live="polite" aria-busy={view.pending}>
      {view.pending ? <p className={styles.copy} role="status">Checking saved evidence. Your due review is available above.</p> : null}
      {reason ? <p className={styles.copy} role="status">{reason}</p> : null}
      {review?.status === "uncalibrated" ? <p className={styles.copy}><strong>Uncalibrated readiness estimates.</strong> These model probabilities have not been validated for your learning, so no next-study recommendation is selected.</p> : null}
      {selected ? <div className={styles.copy}><p><strong>Suggested next review: {selected.title}</strong></p>
        <p>Prerequisite checks and calibrated model gates passed. This is a planning suggestion, not measured mastery.</p>
        <button type="button" className={styles.button} onClick={() => onStart(selected.targetId)}>Review {selected.title}</button>
      </div> : null}
      {review?.estimates.length ? <ul className={styles.copy} style={{ paddingLeft: "1.25rem" }}>{review.estimates.map(estimate => <li key={estimate.id}>
        {title(estimate.id)}: {Math.round(estimate.probability * 100)}% model readiness probability ({estimate.backend.model}).
      </li>)}</ul> : null}
      {review?.blocked.length ? <ul className={styles.copy} style={{ paddingLeft: "1.25rem" }}>{review.blocked.map(blocked => <li key={blocked.id}>
        {title(blocked.id)}: {result?.input.candidates.find(candidate => candidate.id === blocked.id)?.prerequisiteGraphKnown === false
          ? blockedLabels["unknown-prerequisites"] : blockedLabels[blocked.reason]}
      </li>)}</ul> : null}
    </div>
  </section>;
}

/** Only button activation dispatches. Source, profile, settings and page lifecycle revoke old results. */
export function ComingUpReadiness({ source, contextVersion, hasDueDecks, onStart }: {
  source: ComingUpReadinessSource; contextVersion: string; hasDueDecks: boolean; onStart: (deckId: string) => void;
}) {
  const [view, setView] = useState<ReadinessViewState>({ pending: false, result: null, stale: false });
  const contextRef = useRef(contextVersion); contextRef.current = contextVersion;
  const publishedContext = useRef(contextVersion);
  const session = useMemo(() => createComingUpReadinessSession({
    load: () => loadComingUpReadiness(source),
    contextKey: () => JSON.stringify([contextRef.current, loadDeclaredProfile(), loadLearnerContext()]),
    settings: loadJudgementModelSettings, publish: next => { publishedContext.current = contextRef.current; setView(next); },
  }), [source]);
  useEffect(() => { session.invalidate(false); }, [session, contextVersion]);
  useEffect(() => {
    session.activate();
    const invalidate = () => session.invalidate();
    const refresh = () => { void session.refresh(); };
    const unsubscribeSettings = subscribeJudgementModelSettings(invalidate);
    const unsubscribeProfile = subscribeDeclaredProfile(invalidate);
    const unsubscribeContext = subscribeLearnerContext(invalidate);
    const timer = window.setInterval(refresh, 2_000);
    const events = ["keating:artifacts-changed", "keating:sessions-changed", "keating:question-answered", "keating:question-judgement-changed", "storage"];
    for (const event of events) window.addEventListener(event, invalidate);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribeSettings(); unsubscribeProfile(); unsubscribeContext(); window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, invalidate);
      window.removeEventListener("focus", refresh); session.dispose();
    };
  }, [session]);
  const currentView = publishedContext.current === contextVersion ? view : { pending: false, result: null, stale: true };
  return <ComingUpReadinessView view={currentView} hasDueDecks={hasDueDecks} onReview={() => void session.review()} onStart={id => void session.openSelected(id, onStart)} />;
}
