import { useSyncExternalStore } from "react";
import { css } from "../../styled-system/css";
const summary = css({ cursor: "pointer", fontWeight: 600, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const note = css({ marginTop: ".5rem", color: "var(--muted-foreground)", lineHeight: 1.5 });
const draftText = css({ marginTop: ".5rem", maxHeight: "20rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderRadius: ".375rem", background: "var(--background)", padding: ".75rem", fontFamily: "inherit", lineHeight: 1.5 });
const draft = css({ marginTop: ".75rem", minWidth: 0 });
import { getTeachingDraftContent, getTeachingDraftStatus, subscribeTeachingDraftStatus, type TeachingDraftInspectedCandidate } from "../keating/judgement/draft-status";

/** Developer-only, inert answer-text inspection. Never render draft OpenUI or execute tools. */
export function DraftContentInspection({ sessionId, enabled = false }: { sessionId: string | null | undefined; enabled?: boolean }) {
  const candidates = useSyncExternalStore(subscribeTeachingDraftStatus,
    () => enabled ? getTeachingDraftContent(sessionId) : null, () => null);
  const status = useSyncExternalStore(subscribeTeachingDraftStatus,
    () => enabled ? getTeachingDraftStatus(sessionId) : null, () => null);
  return <DraftContentInspectionView enabled={enabled} candidates={candidates}
    selectedAttempt={status?.snapshot.phase === "released" ? status.snapshot.selectedAttempt : null} />;
}

export function DraftContentInspectionView({ enabled = false, candidates, selectedAttempt: selected }: {
  enabled?: boolean; candidates: readonly TeachingDraftInspectedCandidate[] | null; selectedAttempt: number | null;
}) {
  if (!enabled || !candidates?.length) return null;
  const unselected = candidates.filter(candidate => candidate.attempt !== selected);
  const selectedDraft = candidates.find(candidate => candidate.attempt === selected);
  return <details className={css({ border: "1px solid var(--border)", borderRadius: ".5rem", background: "var(--muted)", padding: ".75rem", fontSize: ".75rem", minWidth: 0 })}>
    <summary className={summary}>Unselected drafts ({unselected.length})</summary>
    <p className={note}>Developer inspection of generated answer text for this turn. These drafts may contain mistakes or content left out of the selected response. This is not model reasoning. Text is shown without running activities or tools and is cleared when inspection is disabled or a new turn starts.</p>
    {selected === null && <p className={note}>No response has been selected for release yet.</p>}
    {selectedDraft && <details className={draft}>
      <summary className={summary}>Selected response · Draft {selectedDraft.attempt} · {selectedDraft.variant}</summary>
      <pre className={draftText}>{selectedDraft.text}</pre>
      {selectedDraft.truncated && <p>Inspection text truncated at 64,000 characters.</p>}
    </details>}
    {unselected.map(candidate => <details key={candidate.attempt} className={draft}>
      <summary className={summary}>Draft {candidate.attempt} · {candidate.variant} · Unselected</summary>
      <pre className={draftText}>{candidate.text || "No answer text; tool arguments are not included."}</pre>
      {candidate.truncated && <p>Inspection text truncated at 64,000 characters.</p>}
    </details>)}
  </details>;
}
