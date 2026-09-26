import { STATE_SECTION_KEYS, type StateSectionKey, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";

const copy = css({ fontSize: ".75rem", lineHeight: 1.5, color: "var(--foreground)", overflowWrap: "anywhere" });
const detail = css({ cursor: "pointer", fontSize: ".75rem", paddingBlock: ".5rem", _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const row = css({ paddingBlock: ".25rem", fontWeight: 400, textAlign: "left" });
const labels: Record<StateSectionKey, string> = { learnerMessage: "Current request", conversation: "Conversation", learnerEvidence: "Learner evidence", availableTools: "Available tools", toolResults: "Tool results", sources: "Sources", pendingSubmissions: "Pending submissions", activeWork: "Active work", reply: "Draft reply", candidates: "Selection candidates", other: "Metadata & structure" };
const format = (value: number) => Math.round(value).toLocaleString();

/** Developer-only disclosure: no conversation, source, or reply content is rendered. */
export function JudgementStateInspector({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const state = snapshot.state;
  if (!state) return <p className={copy}>No judgement request dispatched yet.</p>;
  return <section aria-label="Judgement state" className={css({ marginBlock: ".75rem", minWidth: 0 })}>
    <div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" })}>
      <strong className={copy}>State + longest question</strong>
      <span className={copy}>{format(state.estimatedStateQuestionTokens)}{state.budgetTokens === null ? " estimated tokens · budget unknown" : ` / ${format(state.budgetTokens)} estimated tokens`}</span>
    </div>
    {state.fillRatio !== null && <><meter aria-label="Estimated judgement context usage" min={0} max={1} low={0.65} high={0.8} optimum={0} value={Math.min(1, state.fillRatio)} className={css({ display: "block", width: "100%", height: ".75rem", marginBlock: ".375rem", accentColor: "var(--primary)" })} />
      <p className={copy}>{Math.round(state.fillRatio * 100)}% filled. At 80%, oldest conversation turns are removed toward 65%.</p></>}
    <p className={copy}>{format(state.totalBytes)} state bytes · {format(state.estimatedStateTokens)} estimated state tokens · {format(state.estimatedRequestTokens)} estimated request tokens. Request estimates include overhead; these are not tokenizer measurements.</p>
    <details><summary className={detail}>State sections & pinned context</summary>
      <table className={css({ width: "100%", fontSize: ".75rem", borderCollapse: "collapse", textAlign: "left" })}>
        <thead><tr><th scope="col">Section</th><th scope="col">Entries</th><th scope="col">Bytes</th></tr></thead>
        <tbody>{STATE_SECTION_KEYS.map(key => <tr key={key}><th scope="row" className={row}>{labels[key]}</th><td>{format(state.sections[key].entries)}</td><td>{format(state.sections[key].bytes)}</td></tr>)}</tbody>
      </table>
      <p className={copy}>Pinned context present: {([ ["Plan", state.pinned.plan], ["Focus", state.pinned.focus], ["Open activities", state.pinned.openInteractions], ["Pending submissions", state.pinned.pendingSubmissions] ] as const).filter(([, present]) => present).map(([label]) => label).join(", ") || "None"}. Only conversation turns can be removed by the window.</p>
    </details>
    <details><summary className={detail}>Window evictions ({snapshot.slides?.length ?? 0})</summary>
      {!snapshot.slides?.length ? <p className={copy}>No conversation turns removed during this review.</p> : <ul className={copy}>{snapshot.slides.map((slide, index) => <li key={index}>{slide.phase}, draft {slide.attempt}: {slide.turnsDropped} {slide.turnsDropped === 1 ? "turn" : "turns"} removed · {format(slide.before.estimatedStateQuestionTokens)} → {slide.after ? format(slide.after.estimatedStateQuestionTokens) : "request unavailable"} estimated tokens</li>)}</ul>}
    </details>
    <details><summary className={detail}>Request samples ({snapshot.stateHistory?.length ?? 0})</summary>
      <p className={copy}>Latest 64 dispatched requests, including separate question batches. Sizes only.</p>
      <ol className={copy}>{snapshot.stateHistory?.map(sample => <li key={sample.requestIndex}>#{sample.requestIndex} · {sample.phase}, draft {sample.attempt} · {(sample.elapsedMs / 1000).toFixed(1)} s · {format(sample.state.estimatedStateQuestionTokens)} estimated tokens · {sample.state.sections.conversation.entries} conversation messages</li>)}</ol>
    </details>
  </section>;
}
