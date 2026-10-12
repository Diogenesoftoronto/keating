import { onlineLearningSummary, type OnlineLearningState } from "../../../shared/online-learning-session";

export function OnlineLearningStatus({ state, evidenceAvailable = true }: { state: OnlineLearningState; evidenceAvailable?: boolean }) {
  const rows = Object.entries(state.results).flatMap(([target, result]) => result?.receipt.status === "active"
    ? result.predictions.map(prediction => ({ ...prediction, target })) : []);
  return <section aria-label="Learning predictions" style={{ marginBlock: "1rem", fontSize: ".875rem" }}>
    <p role="status">{state.running ? "Updating learning predictions… " : ""}{!evidenceAvailable ? "Saved learning history could not be verified. The usual learning rules remain active." : state.error ?? onlineLearningSummary(state.results)}</p>
    {rows.length > 0 && <details><summary>See predictions and checks</summary>
      <p>TabPFN 3.5 · checked against later saved outcomes. These estimates do not change grades or review dates.</p>
      <ul>{rows.slice(0, 12).map(row => <li key={row.key}>{row.topic}: {row.target === "mastery" ? "next-answer correctness" : row.target === "retention" ? "card recall" : "due-deck lapse risk"} {Math.round(row.value * 100)}%</li>)}</ul>
      {rows.length > 12 && <p>Showing 12 of {rows.length} estimates.</p>}
    </details>}
  </section>;
}
