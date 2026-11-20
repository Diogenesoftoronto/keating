import { Meter } from "../design-system/charts";
import { EmptyState } from "../design-system/kit";
import { STATE_SECTION_KEYS, type StateComposition, type StateSectionKey, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";

const copy = css({ fontSize: ".75rem", lineHeight: 1.5, color: "var(--foreground)", overflowWrap: "anywhere" });
const detail = css({ cursor: "pointer", fontSize: ".75rem", paddingBlock: ".5rem", _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const row = css({ paddingBlock: ".25rem", fontWeight: 400, textAlign: "left" });
const labels: Record<StateSectionKey, string> = { learnerMessage: "Current request", conversation: "Conversation", earlierLearnerExcerpts: "Earlier learner excerpts", learnerEvidence: "Learner evidence", availableTools: "Available tools", toolResults: "Tool results", sources: "Sources", pendingSubmissions: "Pending submissions", activeWork: "Active work", reply: "Draft reply", candidates: "Selection candidates", other: "Metadata & structure" };
const format = (value: number) => Math.round(value).toLocaleString();

function retainedExcerpts(state: StateComposition | null): string {
  const section = state?.sections.earlierLearnerExcerpts;
  if (!section?.entries) return "";
  return ` · ${format(section.entries)} earlier learner ${section.entries === 1 ? "excerpt" : "excerpts"} retained (${format(section.bytes)} serialized bytes)`;
}

function sourceChanges(before: StateComposition, after: StateComposition | null): string {
  const from = before.sections.sources, to = after?.sections.sources;
  if (!from || !to) return "";
  const entries = from.entries === to.entries ? "" : ` · Source entries ${format(from.entries)} → ${format(to.entries)}`;
  const size = from.bytes === to.bytes ? "" : ` · Source size ${format(from.bytes)} → ${format(to.bytes)} serialized bytes`;
  return entries + size;
}

/** Developer-only disclosure: no conversation, source, or reply content is rendered. */
export function JudgementStateInspector({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const state = snapshot.state;
  if (!state) return <EmptyState heading="Judgement request size is unavailable for this review." />;
  return <section aria-label="Judgement state" className={css({ marginBlock: ".75rem", minWidth: 0 })}>
    <div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" })}>
      <strong className={copy}>State + longest question</strong>
      <span className={copy}>{format(state.estimatedStateQuestionTokens)}{state.budgetTokens === null ? " estimated tokens · budget unknown" : ` / ${format(state.budgetTokens)} estimated tokens`}</span>
    </div>
    {state.fillRatio !== null && <Meter label="Estimated judgement context usage" value={state.fillRatio * 100} max={100}
      valueText={`${(state.fillRatio * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% of the recorded token budget`} />}
    <p className={copy}>{format(state.totalBytes)} state bytes · {format(state.estimatedStateTokens)} estimated state tokens · {format(state.estimatedRequestTokens)} estimated request tokens{retainedExcerpts(state)}. Token estimates use serialized text.</p>
    <details><summary className={detail}>State sections & pinned context</summary>
      <table className={css({ width: "100%", fontSize: ".75rem", borderCollapse: "collapse", textAlign: "left" })}>
        <thead><tr><th scope="col">Section</th><th scope="col">Entries</th><th scope="col">Bytes</th></tr></thead>
        <tbody>{STATE_SECTION_KEYS.map(key => {
          const section = state.sections[key];
          if (!section || (key === "earlierLearnerExcerpts" && !section.entries)) return null;
          return <tr key={key}><th scope="row" className={row}>{labels[key]}</th><td>{format(section.entries)}</td><td>{format(section.bytes)}</td></tr>;
        })}</tbody>
      </table>
      <p className={copy}>Pinned context present: {([ ["Plan", state.pinned.plan], ["Focus", state.pinned.focus], ["Open activities", state.pinned.openInteractions], ["Pending submissions", state.pinned.pendingSubmissions] ] as const).filter(([, present]) => present).map(([label]) => label).join(", ") || "None"}.</p>
    </details>
    <details><summary className={detail}>Context trims{snapshot.slides && ` (${snapshot.slides.length})`}</summary>
      <p className={copy}>Current reviews keep the full conversation and search passages while they fit. If a request exceeds a token or character limit, Keating can shorten passages and remove the fewest whole turns needed, starting with the oldest.</p>
      {!snapshot.slides?.length ? <EmptyState heading={snapshot.slides ? "This review recorded no context trims." : "Context-trim data is unavailable for this receipt."} />
        : <ul className={copy}>{snapshot.slides.map((slide, index) => <li key={index}>
          {slide.phase}, draft {slide.attempt} · {slide.turnsDropped} {slide.turnsDropped === 1 ? "turn" : "turns"} removed · {format(slide.before.estimatedStateQuestionTokens)} estimated tokens before
          {slide.after ? `, ${format(slide.after.estimatedStateQuestionTokens)} after` : ", next estimate unavailable"}{sourceChanges(slide.before, slide.after)}{retainedExcerpts(slide.after)}
        </li>)}</ul>}
    </details>
    <details><summary className={detail}>Request samples{snapshot.stateHistory && ` (${snapshot.stateHistory.length})`}</summary>
      <p className={copy}>{snapshot.stateHistory ? "Latest 64 dispatched requests, including separate question batches. Sizes only." : "Request samples are unavailable for this receipt."}</p>
      <ol className={copy}>{snapshot.stateHistory?.map(sample => <li key={sample.requestIndex}>#{sample.requestIndex} · {sample.phase}, draft {sample.attempt} · {(sample.elapsedMs / 1000).toFixed(1)} s · {format(sample.state.estimatedStateQuestionTokens)} estimated tokens · {sample.state.sections.conversation.entries} conversation messages{retainedExcerpts(sample.state)}</li>)}</ol>
    </details>
  </section>;
}
