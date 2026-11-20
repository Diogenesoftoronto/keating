import { useId, useState } from "react";
import { ChartFrame, ChartTable, Meter, useChartTooltip } from "../design-system/charts";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";
import type { TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { describeTeachingCheck } from "../keating/judgement/check-descriptions";
import { comparisonDrafts } from "../keating/judgement/draft-progress";
import type { TurnMemoryDecision, TurnReplyReview } from "../keating/judgement/turn-records";
import { DiagnosticHelp } from "./DiagnosticHelp";

const figure = css({ display: "grid", gap: ".5rem", minWidth: 0, fontSize: ".75rem", lineHeight: 1.4 });
const heading = css({ fontSize: ".8125rem", fontWeight: 650, color: "var(--foreground)" });
const helpLabel = css({ display: "inline-flex", alignItems: "center", verticalAlign: "middle", lineHeight: 1.3 });
const muted = css({ color: "var(--muted-foreground)", overflowWrap: "anywhere" });
const legend = css({ display: "flex", flexWrap: "wrap", gap: ".25rem .75rem", color: "var(--muted-foreground)" });
const scroller = css({ overflowX: "auto", minWidth: 0, _focusVisible: { outlineOffset: "2px" } });
const table = css({
  width: "100%", borderCollapse: "separate", borderSpacing: ".1875rem",
  fontVariantNumeric: "tabular-nums", textAlign: "start",
  "& th": { fontWeight: 600, textAlign: "start" },
  "& th[scope=col]:not(:first-child)": { minWidth: "3.75rem", textAlign: "center" },
});
const labelColumn = css({
  position: "sticky", insetInlineStart: 0, zIndex: 1, minWidth: "7rem", maxWidth: "18rem",
  paddingInlineEnd: ".25rem", background: "var(--card)", overflowWrap: "anywhere",
});
const cell = css({
  display: "flex", justifyContent: "center", alignItems: "center", gap: ".1875rem", width: "100%", minHeight: "1.75rem",
  padding: ".125rem .1875rem", border: "1px solid transparent", borderRadius: ".25rem", color: "var(--foreground)",
  fontFamily: "var(--mono-body)", fontSize: ".6875rem", fontVariantNumeric: "tabular-nums",
  "&[aria-pressed]": { cursor: "pointer" },
  "&[aria-pressed=true]": { borderColor: "currentColor", fontWeight: 700 },
  _focusVisible: { outlineOffset: "-2px", position: "relative", zIndex: 2 },
});
const missingCell = css({ textAlign: "center", color: "var(--muted-foreground)" });
const detail = css({
  minWidth: 0, display: "grid", gap: ".1875rem", padding: ".5rem .625rem",
  borderInlineStart: "2px solid var(--border)", background: "var(--background)", overflowWrap: "anywhere",
});
const toggle = css({
  justifySelf: "start", padding: ".125rem 0", minHeight: "1.5rem", fontSize: ".75rem",
  background: "transparent", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: ".175em",
});
const barList = css({ listStyle: "none", display: "grid", gap: ".375rem", minWidth: 0 });
const barRow = css({
  display: "grid", gridTemplateColumns: "minmax(0, 1fr)",
  gap: ".1875rem .5rem", overflowWrap: "anywhere",
});

const comparisonAxis = css({ display: "flex", justifyContent: "space-between", gap: ".5rem", color: "var(--muted-foreground)" });
const comparisonOutcome = css({ display: "flex", alignItems: "start", gap: ".375rem", "& svg": { flexShrink: 0 } });
const alternatives = css({
  gridColumn: "1 / -1", paddingBlockEnd: ".25rem", minWidth: 0,
  "& > summary": { minHeight: "1.5rem", cursor: "pointer", color: "var(--muted-foreground)", fontSize: ".75rem" },
  "& > ul": { paddingInlineStart: ".75rem", paddingBlock: ".25rem", borderInlineStart: "1px solid var(--border)" },
});
const selectedOption = css({ color: "var(--muted-foreground)", fontSize: ".6875rem" });
const checkStates = {
  pass: { symbol: "check", label: "Passed", tone: "ok", order: 0 },
  fail: { symbol: "x", label: "Failed", tone: "bad", order: 2 },
  unknown: { symbol: "help", label: "Inconclusive", tone: "warn", order: 1 },
} satisfies Record<TeachingPolicyCheck["status"], { symbol: GlyphName; label: string; tone: string; order: number }>;
const reviewQuestions = new Map([
  ["move", {
    label: "Tutor move",
    help: "What Keating did in its reply, such as giving a hint, asking a question, explaining a step, or offering practice.",
  }],
  ["need", {
    label: "Learner need",
    help: "What the reviewer thought would help you at that point. It might be an explanation, some room to reason, or a question to clarify your goal.",
  }],
  ["fit", {
    label: "Response fit",
    help: "How well the tutor’s move matched the inferred need. Overhelp means it gave too much away. Underhelp means it offered too little. Misdirected means it addressed the wrong issue.",
  }],
]);
const INITIAL_ROWS = 4;
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

function violationProbability(check: TeachingPolicyCheck) {
  return check.source !== "deterministic" && check.probability !== null && Number.isFinite(check.probability)
    && check.probability >= 0 && check.probability <= 1 ? check.probability : null;
}

interface DraftRiskChange {
  id: string;
  basis: "earlier" | "parallel draft" | "source of revision";
  earlier: { draft: number; probability: number };
  released: { draft: number; probability: number };
}

function compareDraftRisk(snapshot: TeachingDraftSnapshot, byDraft: readonly ReadonlyMap<string, TeachingPolicyCheck>[]) {
  const releasedIndex = snapshot.attempts.findIndex(attempt => attempt.attempt === snapshot.selectedAttempt);
  if (snapshot.phase !== "released" || releasedIndex < 0) return [];
  const released = snapshot.attempts[releasedIndex]!;
  const earlier = comparisonDrafts(snapshot, released).map(attempt => ({
    draft: attempt.attempt, checks: byDraft[snapshot.attempts.indexOf(attempt)]!,
  }));
  const basis = released.repairSourceAttempt ? "source of revision" : snapshot.parallelAttempts?.includes(released.attempt) ? "parallel draft" : "earlier";
  const changes: DraftRiskChange[] = [];
  for (const check of released.checks) {
    const probability = violationProbability(check);
    if (probability === null) continue;
    for (const attempt of earlier) {
      const prior = attempt.checks.get(check.id);
      const before = prior ? violationProbability(prior) : null;
      if (before === null) continue;
      changes.push({ id: check.id, basis, earlier: { draft: attempt.draft, probability: before }, released: { draft: released.attempt, probability } });
      break;
    }
  }
  const magnitude = (change: DraftRiskChange) => Math.abs(change.released.probability - change.earlier.probability);
  return changes.sort((a, b) => magnitude(b) - magnitude(a));
}

function DraftRiskComparison({ change }: { change: DraftRiskChange }) {
  const headingId = useId();
  const delta = change.released.probability - change.earlier.probability;
  const points = Math.abs(delta) * 100;
  const displayPoints = points > 0 && points < 0.1 ? "Less than 0.1" : Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(points);
  const directionGlyph = delta < 0 ? "left" : delta > 0 ? "right" : "minus";
  const direction = delta < 0 ? "lower" : "higher";
  const comparisonSource = change.basis === "parallel draft" ? "the other draft started in parallel"
    : change.basis === "source of revision" ? "the draft Keating revised" : "the earliest draft with a recorded estimate for this check";
  return <figure aria-labelledby={headingId} className={figure}>
    <figcaption className={heading}><span className={helpLabel}><span id={headingId}>What changed between drafts</span>
      <DiagnosticHelp term="draft comparison" text={`The bars compare ${comparisonSource} with the released draft. A shorter bar means a lower estimated chance of a violation. The heatmap lets you choose another check.`} />
    </span></figcaption>
    <p className={muted}>{describeTeachingCheck(change.id).title} · estimated chance of a violation</p>
    {([{ kind: change.basis, entry: change.earlier, tone: "series1" }, { kind: "released", entry: change.released, tone: "series2" }] as const).map(({ kind, entry, tone }) =>
      <div key={kind}>
        <span>Draft {entry.draft} · {kind}</span>
        <Meter max={1} value={entry.probability} valueText={percent.format(entry.probability)}
          label={`Draft ${entry.draft} · ${kind} estimated risk`} tone={tone} />
      </div>)}
    <div className={comparisonAxis}><span>0% · Lower is better</span><span>100% · Higher risk</span></div>
    <p className={comparisonOutcome}><KeatingGlyph name={directionGlyph} size={14} />
      <strong>{delta === 0 ? "No change in estimated risk" : `${displayPoints} percentage ${displayPoints === "1" ? "point" : "points"} ${direction} in the released draft`}</strong>
    </p>
  </figure>;
}

export function DraftCheckHeatmap({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const detailId = useId();
  const tip = useChartTooltip();
  const tableId = useId();
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<{ id: string; draft: number }>();
  const attempts = snapshot.attempts;
  const byDraft = attempts.map(attempt => new Map(attempt.checks.map(check => [check.id, check])));
  const priority = new Map<string, number>();
  for (const attempt of attempts) {
    for (const check of attempt.checks) {
      priority.set(check.id, Math.max(priority.get(check.id) ?? 0, checkStates[check.status].order));
    }
  }
  const rows = [...priority].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (rows.length === 0) return null;
  const visible = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const selected = active && visible.includes(active.id) ? byDraft[active.draft]?.get(active.id) : undefined;
  const selectedAttempt = active && selected ? attempts[active.draft] : undefined;
  const selectedDescription = selected ? describeTeachingCheck(selected.id) : undefined;
  const selectedProbability = selected ? violationProbability(selected) : null;
  const visibleChecks = visible.flatMap(id => byDraft.map(draft => draft.get(id)));
  const changes = compareDraftRisk(snapshot, byDraft);
  const comparison = selected ? changes.find(change => change.id === selected.id) : changes[0];

  const heatmap = <ChartFrame title="Draft check heatmap"
    reading="Numbers show the estimated probability of a violation. Select a cell to inspect the check.">
    <div className={helpLabel}><DiagnosticHelp term="draft check heatmap" text="Rows are rules applied to drafts. Each column is a draft attempt. Released marks the draft shown in chat. A question mark means the check was inconclusive. A dash means there’s no recorded result for that draft." /></div>
    <ul className={legend} aria-label="Check results">
      {Object.entries(checkStates).map(([status, { symbol, label }]) => <li key={label}><KeatingGlyph name={symbol} size={14} /> {label} {visibleChecks.filter(check => check?.status === status).length}</li>)}
      <li>– No record {visibleChecks.filter(check => !check).length}</li>
    </ul>
    <div className={scroller} tabIndex={0} role="region" aria-label="Scrollable draft check heatmap">
      <table id={tableId} className={table} aria-label="Checks by draft">
        <thead><tr>
          <th scope="col" className={labelColumn}>Check</th>
          {attempts.map(attempt => <th scope="col" key={attempt.attempt}>
            Draft {attempt.attempt}{snapshot.phase === "released" && snapshot.selectedAttempt === attempt.attempt && <div className={muted}>Released</div>}
          </th>)}
        </tr></thead>
        <tbody>{visible.map(id => {
          const { title } = describeTeachingCheck(id);
          return <tr key={id}>
            <th scope="row" className={labelColumn}>{title}</th>
            {attempts.map((attempt, index) => {
              const check = byDraft[index]?.get(id);
              if (!check) return <td key={attempt.attempt} className={missingCell} aria-label="No check recorded">–</td>;
              const state = checkStates[check.status];
              const probability = violationProbability(check);
              const value = probability !== null ? percent.format(probability) : undefined;
              return <td key={attempt.attempt}><button type="button" className={cell} style={{ backgroundColor: "var(--paper-deep)" }}
                {...tip.bind(`Draft ${attempt.attempt}, ${title}, ${state.label}${value ? `, ${value} probability of violation` : ""}`)}
                aria-pressed={active?.id === id && active.draft === index} aria-controls={detailId}
                onClick={() => setActive({ id, draft: index })}>
                <KeatingGlyph name={state.symbol} size={14} className={`kc-state-${state.tone}`} />{value && <span aria-hidden="true">{value}</span>}
              </button></td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {tip.tooltip}
    {rows.length > INITIAL_ROWS && <button type="button" className={toggle} aria-expanded={expanded} aria-controls={tableId}
      onClick={() => setExpanded(value => !value)}>
      {expanded ? `Show first ${INITIAL_ROWS} checks` : `Show all ${rows.length} checks`}
    </button>}
    <div id={detailId} aria-live="polite" className={selected ? detail : undefined}>
      {selected && selectedAttempt && selectedDescription && <>
        <strong>{selectedDescription.title} · Draft {selectedAttempt.attempt}</strong>
        <p>{checkStates[selected.status].label} · <span className={helpLabel}>{selected.severity} severity
          <DiagnosticHelp term="check severity" text="How serious this rule considers a violation. Severity describes the rule’s importance. The probability describes how likely the reviewer thinks the draft broke it." />
        </span>
          {selected.source === "deterministic" ? <> · <span className={helpLabel}>deterministic check
            <DiagnosticHelp term="deterministic check" text="Keating’s code checks an exact rule, such as whether a reply is empty or a tool call matches its schema." />
          </span></> : selectedProbability === null ? " · no probability recorded" : <> · <span className={helpLabel}>{selectedProbability} P(violation)
            <DiagnosticHelp term="probability of violation" text="How likely the reviewer thinks the draft broke this rule. Higher values mean the reviewer saw more evidence of a violation." />
          </span></>}
        </p>
        {selectedDescription.question && <p className={muted}>{selectedDescription.question}</p>}
      </>}
    </div>
  </ChartFrame>;
  return comparison ? <><DraftRiskComparison change={comparison} />{heatmap}</> : heatmap;
}

export function ReplyReviewConfidence({ review }: { review: TurnReplyReview }) {
  const headingId = useId();
  const validScore = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  const answers = review.answers.filter(answer => validScore(answer.confidence)).map(answer => ({
    ...answer,
    question: reviewQuestions.get(answer.id),
    options: answer.probabilities.filter(option => validScore(option.value)).sort((a, b) => b.value - a.value),
  }));
  if (!answers.length) return null;
  const rows = answers.flatMap(answer => {
    const name = answer.question?.label ?? answer.id;
    return [[name, answer.choice + " (selected)", percent.format(answer.confidence)],
      ...answer.options.map(option => [name, option.label, percent.format(option.value)])];
  });
  return <figure aria-labelledby={headingId} className={figure}>
    <figcaption className={heading}>
      <span className={helpLabel}><span id={headingId}>Reply review confidence</span>
        <DiagnosticHelp term="reply review confidence" text="Each bar shows how strongly the reviewer favored its chosen label. Check the label before interpreting the percentage. For example, 90% confidence in overhelp means the reviewer strongly favored that assessment." />
      </span>
    </figcaption>
    <p className={muted}>
      <span className={helpLabel}>{review.calibrated ? "Calibration attached" : "Uncalibrated estimates"}
        <DiagnosticHelp term="review calibration" text={review.calibrated
          ? "A calibration table was available to the reviewer. The effect can vary by question, and individual judgments can still be uncertain."
          : "This review ran without a calibration table. Treat the percentages as rough indicators of which choices the reviewer favored."} />
      </span> · {review.model}
    </p>
    <ul className={barList}>
      {answers.map(answer => {
        const { question, options } = answer;
        const label = question?.label ?? answer.id;
        return <li key={answer.id} className={barRow}>
          <span><span className={helpLabel}><strong>{label}</strong>
            {question && <DiagnosticHelp term={label} text={question.help} />}
          </span> · {answer.choice.replaceAll(/[_-]/g, " ")}</span>
          <Meter max={1} value={answer.confidence} label={`${label} confidence`} valueText={percent.format(answer.confidence)} />
          {options.length > 1 && <details className={alternatives}>
            <summary aria-label={`See other answers for ${label}`}>See other answers</summary>
            <ul className={barList}>{options.map(option => {
              const choice = option.label.replaceAll(/[_-]/g, " ");
              return <li key={option.label} className={barRow}>
                <span>{choice}{option.label === answer.choice && <span className={selectedOption}> · selected</span>}</span>
                <Meter max={1} value={option.value} label={`${label}: ${choice}`} valueText={percent.format(option.value)} />
              </li>;
            })}</ul>
          </details>}
        </li>;
      })}
    </ul>
    {rows.length > 3 && <ChartTable caption="Reply review confidence" columns={["Question", "Answer", "Probability"]} rows={rows} />}
  </figure>;
}

export function MemoryDecisionScore({ probability, threshold }: Pick<TurnMemoryDecision, "probability" | "threshold">) {
  if (probability === null || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
  const cutoff = threshold !== null && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : null;
  return <div className={figure}>
    <div className={comparisonAxis}>
      <span className={helpLabel}>Worth remembering
        <DiagnosticHelp term="memory score" text="The model’s estimate that this passage contains something worth remembering. The cutoff applies to this score. Keating also checks whether the passage can be kept and used." />
      </span>
    </div>
    <Meter max={100} value={probability * 100} valueText={percent.format(probability)}
      label={cutoff === null ? "Estimated worth remembering" : `Estimated worth remembering, cutoff ${percent.format(cutoff)}`}
      threshold={cutoff === null ? undefined : { value: Number((cutoff * 100).toPrecision(12)), label: "Cutoff (%)" }} />
  </div>;
}
