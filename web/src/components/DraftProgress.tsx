/**
 * Visual pieces for a teaching draft: a stage stepper and time bar shared by
 * both views, the learner's in-chat progress card, and the developer's
 * attention list, timing chart, and check grid. Content-free: only snapshot
 * counts, timings, and check ids are rendered.
 */
import { useEffect, useState } from "react";
import { ChartFrame, Meter, Progress, Timeline } from "../design-system/charts";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";
import type { TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { css, cx } from "../../styled-system/css";
import { teachingDraftIsActive, type TeachingDraftStatus } from "../keating/judgement/draft-status";
import {
  DRAFT_TIME_BUDGET_MS, checkMatrix, draftStages, learnerDraftGuidance,
  type DiagnosisTone, type DraftDiagnosis, type DraftStageId, type DraftStageState,
} from "../keating/judgement/draft-progress";

const small = css({ fontSize: ".75rem", lineHeight: 1.5, color: "var(--muted-foreground)" });
const toneColor: Record<DiagnosisTone, string> = { ok: "var(--primary)", caution: "var(--amber)", blocked: "var(--destructive)" };
const stageIcon: Record<DraftStageId, GlyphName> = { plan: "bulb", write: "edit", check: "verified", choose: "checklist" };
const stateLabel: Record<DraftStageState, string> = { done: "done", active: "in progress", pending: "not started", stopped: "stopped" };

/**
 * Elapsed time for the draft shown, ticking between progress events so the
 * clock never freezes while a model is silently working.
 */
export function useDraftElapsed(status: TeachingDraftStatus | null): number {
  const active = teachingDraftIsActive(status);
  const reported = status?.snapshot.elapsedMs ?? 0;
  const [origin, setOrigin] = useState<{ id: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const id = status?.id;
  useEffect(() => {
    if (id === undefined) return;
    setOrigin(current => current?.id === id ? current : { id, at: Date.now() - reported });
  }, [id, reported]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active || !origin || origin.id !== id) return reported;
  return Math.max(reported, now - origin.at);
}

/** Plan → Write → Check → Choose, with icon, label and state; state is also spoken for screen readers. */
export function DraftStageStepper({ snapshot, compact = false }: { snapshot: TeachingDraftSnapshot; compact?: boolean }) {
  const stages = draftStages(snapshot);
  return <div>
    <Progress done={stages.filter(stage => stage.state === "done").length} total={stages.length} label="Completed draft stages" />
    <ol aria-label="Reply progress" style={{ display: "flex", flexWrap: "wrap", gap: ".38rem", listStyle: "none", padding: 0, font: ".57rem/1.4 var(--font-mono, monospace)" }}>
      {stages.map(stage => <li key={stage.id} style={{ display: "inline-flex", alignItems: "center", gap: ".15rem", fontWeight: stage.state === "active" ? 700 : 400 }} aria-current={stage.state === "active" ? "step" : undefined}>
        <KeatingGlyph name={stage.state === "stopped" ? "x" : stage.state === "done" ? "check" : stageIcon[stage.id]} size={compact ? 13 : 15} />
        {stage.label}<span className={css({ srOnly: true })}>: {stateLabel[stage.state]}</span>
      </li>)}
    </ol>
  </div>;
}

export function DraftTimeBar({ elapsedMs, budgetMs = DRAFT_TIME_BUDGET_MS, label = true }: { elapsedMs: number; budgetMs?: number; label?: boolean }) {
  const ratio = elapsedMs / budgetMs;
  const elapsed = Math.round(elapsedMs / 1000);
  const budget = Math.round(budgetMs / 1000);
  return <Meter value={elapsed} max={budget} label="Time used" tone={ratio >= .78 ? "bad" : ratio >= .45 ? "warn" : "ink"}
    valueText={label ? `${elapsed} s` : undefined} aria-valuetext={`${elapsed} of ${budget} seconds`} />;
}

function AttemptProgress({ attempt, max }: { attempt: number; max: number }) {
  if (attempt <= 1 || max <= 1) return null;
  return <Progress done={attempt} total={max} label={`Draft ${attempt} of ${max}`} />;
}

/** The learner's view of a running reply: where it is, how long it has taken, and what they can do. */
export function DraftProgressCard({ status }: { status: TeachingDraftStatus | null }) {
  const elapsed = useDraftElapsed(status);
  if (!status || !teachingDraftIsActive(status)) return null;
  const { snapshot } = status;
  const guidance = learnerDraftGuidance(snapshot, elapsed);
  return <div role="status" aria-live="polite" aria-label="Reply in progress" className={css({
    width: "100%", maxWidth: "36rem", marginInline: "auto", marginBottom: "1rem", padding: ".875rem 1rem", display: "grid", gap: ".75rem",
    border: "1px solid var(--line-soft, var(--border))", borderRadius: ".75rem", background: "var(--card, var(--background))",
  })}>
    <div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: ".75rem" })}>
      <span className={css({ fontSize: ".875rem", fontWeight: 600 })}>{guidance.headline}…</span>
      {!snapshot.pairReviews && <AttemptProgress attempt={snapshot.attempt} max={snapshot.maxAttempts} />}
    </div>
    <DraftStageStepper snapshot={snapshot} compact />
    <DraftTimeBar elapsedMs={elapsed} />
    {guidance.detail && <p className={cx(small, css({ margin: 0, display: "flex", gap: ".375rem", alignItems: "flex-start" }))}>
      {guidance.slow && <KeatingGlyph name="alert" size={14} className={css({ flexShrink: 0, marginTop: ".15rem", color: "var(--amber)" })} />}
      {guidance.detail}
    </p>}
  </div>;
}

const ToneIcon = ({ tone }: { tone: DiagnosisTone }) => {
  const glyph = tone === "ok" ? "check" : "alert";
  return <span style={{ color: toneColor[tone], display: "contents" }}><KeatingGlyph name={glyph} size={16} className={css({ flexShrink: 0, marginTop: ".1rem" })} /></span>;
};

/** Developer findings, most severe first, each with a reason and where to fix it. */
export function DraftAttentionList({ findings }: { findings: readonly DraftDiagnosis[] }) {
  return <ul aria-label="Needs attention" className={css({ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: ".5rem" })}>
    {findings.map(finding => <li key={finding.title} className={css({ display: "flex", gap: ".625rem", padding: ".625rem .75rem", borderRadius: ".5rem", borderLeft: "3px solid", background: "var(--muted)" })}
      style={{ borderLeftColor: toneColor[finding.tone] }}>
      <ToneIcon tone={finding.tone} />
      <div className={css({ minWidth: 0, display: "grid", gap: ".2rem" })}>
        <strong className={css({ fontSize: ".8rem", fontWeight: 600 })}>
          <span className={css({ srOnly: true })}>{finding.tone === "blocked" ? "Blocking: " : finding.tone === "caution" ? "Warning: " : ""}</span>{finding.title}
        </strong>
        <span className={small}>{finding.detail}</span>
        {finding.action && <a href={finding.action.href} target="_blank" rel="noopener noreferrer" className={css({ fontSize: ".75rem", color: "var(--primary)", textDecoration: "underline", width: "fit-content" })}>{finding.action.label} <KeatingGlyph name="right" size={13} /></a>}
      </div>
    </li>)}
  </ul>;
}

const statusColor: Record<string, string> = { pass: "var(--primary)", fail: "var(--destructive)", unknown: "var(--amber)", "generation-error": "var(--destructive)" };

/** A waterfall: one row per draft (writing, then review) placed where it ran on one time axis, so the slow step stands out. */
export function DraftTimeline({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const planning = snapshot.planningMs ?? 0;
  const rows = snapshot.attempts;
  if (!rows.length && !planning) return <p className={small}>No drafts have finished yet.</p>;
  const seconds = (ms: number) => ms / 1000;
  let cursor = seconds(planning);
  const lanes = rows.map(attempt => {
    const start = snapshot.pairReviews ? 0 : cursor;
    const written = start + seconds(attempt.generationMs);
    const end = written + seconds(attempt.judgementMs);
    cursor = end;
    const name = attempt.status === "generation-error" ? "Attempt" : "Draft";
    const variant = attempt.variant === "default" ? "" : ` · ${attempt.variant}`;
    return {
      label: `${name} ${attempt.attempt} · ${attempt.status}${variant} · ${(end - start).toFixed(1)} s`,
      bands: [
        { label: "Writing", start, end: written },
        { label: "Review", start: written, end },
      ].filter(band => band.end > band.start),
    };
  });
  if (planning) lanes.unshift({ label: `Planning · ${seconds(planning).toFixed(1)} s`, bands: [{ label: "Planning", start: 0, end: seconds(planning) }] });
  const end = Math.max(.001, seconds(snapshot.elapsedMs), ...lanes.flatMap(lane => lane.bands.map(band => band.end)));
  return <figure aria-label="Where the time went">
    <Timeline label="Draft phase times in seconds" lanes={lanes} domain={[0, end]} />
    <figcaption className={small}>Total {seconds(snapshot.elapsedMs).toFixed(1)} s of {seconds(DRAFT_TIME_BUDGET_MS)} s.{snapshot.pairReviews && " Drafts run concurrently."}</figcaption>
  </figure>;
}

const cellGlyph: Record<TeachingPolicyCheck["status"], GlyphName> = { pass: "check", fail: "x", unknown: "help" };

function CheckCell({ check }: { check: TeachingPolicyCheck | null }) {
  if (!check) return <td className={cx(small, css({ textAlign: "center" }))}>–</td>;
  const probability = check.probability === null ? "no probability" : `P(violation) ${check.probability.toFixed(2)}`;
  return <td className={css({ textAlign: "center", padding: ".15rem" })}>
    <span title={`${check.status} · ${probability}`} aria-label={`${check.status}, ${probability}`}
      className={css({ display: "inline-grid", placeItems: "center", width: "1.5rem", height: "1.5rem", borderRadius: ".3rem", fontSize: ".75rem", fontWeight: 700 })}
      style={{ background: check.status === "pass" ? "transparent" : `color-mix(in srgb, ${statusColor[check.status]} 18%, transparent)`, color: statusColor[check.status] }}>
      <KeatingGlyph name={cellGlyph[check.status]} size={14} />
    </span>
  </td>;
}

/** Checks down, drafts across. Problems sort to the top; passing rows fold away. */
export function DraftCheckGrid({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const { attempts, rows } = checkMatrix(snapshot);
  if (!rows.length) return <p className={small}>No checks have run yet.</p>;
  const problems = rows.filter(row => !row.allPassed);
  const passing = rows.filter(row => row.allPassed);
  const table = (subset: typeof rows) => <div className={css({ overflowX: "auto", maxWidth: "100%" })}>
    <table className={css({ width: "100%", borderCollapse: "collapse", fontSize: ".75rem" })}>
      <thead><tr>
        <th scope="col" className={cx(small, css({ textAlign: "left", fontWeight: 600, paddingBlock: ".25rem" }))}>Check</th>
        {attempts.map(attempt => <th key={attempt} scope="col" className={cx(small, css({ fontWeight: 600, width: "2.25rem" }))}>D{attempt}</th>)}
      </tr></thead>
      <tbody>{subset.map(row => <tr key={row.id} className={css({ borderTop: "1px solid var(--line-soft, var(--border))" })}>
        <th scope="row" className={css({ textAlign: "left", fontWeight: 400, paddingBlock: ".3rem", paddingRight: ".5rem" })}>
          <span className={css({ display: "flex", gap: ".375rem", alignItems: "baseline", flexWrap: "wrap" })}>
            <span>{row.title}</span>
            {row.blocking && <span className={css({ fontSize: ".65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" })} style={{ color: "var(--destructive)" }}>blocks</span>}
            <span className={cx(small, css({ fontFamily: "var(--mono-body, monospace)", fontSize: ".68rem" }))}>{row.id} · {row.severity} · {row.source === "jev" ? "judge" : "runtime"}</span>
          </span>
        </th>
        {row.cells.map((cell, index) => <CheckCell key={index} check={cell} />)}
      </tr>)}</tbody>
    </table>
  </div>;
  return <ChartFrame title="Draft checks" reading={`${rows.length} checks across ${attempts.length} drafts. A dash means the check did not run.`}>
    {problems.length ? table(problems) : <p className={small}>Every check passed in every draft.</p>}
    {passing.length > 0 && <details>
      <summary className={cx(small, css({ cursor: "pointer" }))}>{passing.length} passing {passing.length === 1 ? "check" : "checks"}</summary>
      {table(passing)}
    </details>}
  </ChartFrame>;
}
