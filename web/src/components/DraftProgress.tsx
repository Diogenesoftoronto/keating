/**
 * Visual pieces for a teaching draft: a stage stepper and time bar shared by
 * both views, the learner's in-chat progress card, and the developer's
 * attention list, timing chart, and check grid. Content-free: only snapshot
 * counts, timings, and check ids are rendered.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, CircleAlert, CircleCheck, Lightbulb, ListChecks, PenLine, ShieldCheck, TriangleAlert, X } from "lucide-react";
import type { TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { css, cx } from "../../styled-system/css";
import { teachingDraftIsActive, type TeachingDraftStatus } from "../keating/judgement/draft-status";
import {
  DRAFT_TIME_BUDGET_MS, checkMatrix, draftStages, learnerDraftGuidance,
  type DiagnosisTone, type DraftDiagnosis, type DraftStageId, type DraftStageState,
} from "../keating/judgement/draft-progress";

const small = css({ fontSize: ".75rem", lineHeight: 1.5, color: "var(--muted-foreground)" });
const toneColor: Record<DiagnosisTone, string> = { ok: "var(--primary)", caution: "var(--amber)", blocked: "var(--destructive)" };
const stageIcon: Record<DraftStageId, typeof Lightbulb> = { plan: Lightbulb, write: PenLine, check: ShieldCheck, choose: ListChecks };
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
  return <ol aria-label="Reply progress" className={css({ display: "flex", alignItems: "flex-start", listStyle: "none", margin: 0, padding: 0, gap: 0, minWidth: 0 })}>
    {stages.map((stage, index) => {
      const Icon = stage.state === "done" ? Check : stage.state === "stopped" ? X : stageIcon[stage.id];
      const size = compact ? "1.5rem" : "1.875rem";
      return <li key={stage.id} aria-current={stage.state === "active" ? "step" : undefined}
        className={css({ display: "flex", flexDirection: "column", alignItems: "center", gap: ".3rem", flex: 1, minWidth: 0, position: "relative" })}>
        {index > 0 && <span aria-hidden="true" className={css({ position: "absolute", right: "50%", width: "100%", height: "2px", marginTop: "-1px", zIndex: 0 })}
          style={{ top: `calc(${size} / 2)`, background: stage.state === "pending" ? "var(--line-soft, var(--border))" : "var(--primary)" }} />}
        <span aria-hidden="true" data-state={stage.state} className={css({
          position: "relative", zIndex: 1, display: "grid", placeItems: "center", borderRadius: "999px", border: "2px solid",
          background: "var(--card, var(--background))", transition: "background .2s, border-color .2s",
          "&[data-state=done]": { background: "var(--primary)", borderColor: "var(--primary)", color: "var(--primary-foreground)" },
          "&[data-state=active]": { borderColor: "var(--primary)", color: "var(--primary)", animation: "draftStagePulse 1.6s ease-in-out infinite",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" } },
          "&[data-state=pending]": { borderColor: "var(--line-soft, var(--border))", color: "var(--muted-foreground)" },
          "&[data-state=stopped]": { background: "var(--destructive)", borderColor: "var(--destructive)", color: "var(--destructive-foreground)" },
        })} style={{ width: size, height: size }}>
          <Icon size={compact ? 13 : 15} strokeWidth={2.25} />
        </span>
        <span className={cx(small, css({ fontWeight: stage.state === "active" ? 600 : 400, color: stage.state === "pending" ? "var(--muted-foreground)" : "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }))}>
          {stage.label}<span className={css({ srOnly: true })}>: {stateLabel[stage.state]}</span>
        </span>
      </li>;
    })}
  </ol>;
}

/** Elapsed against the time budget. Color warms as the limit nears, so time pressure reads at a glance. */
export function DraftTimeBar({ elapsedMs, budgetMs = DRAFT_TIME_BUDGET_MS, label = true }: { elapsedMs: number; budgetMs?: number; label?: boolean }) {
  const ratio = Math.min(1, Math.max(0, elapsedMs / budgetMs));
  const color = ratio >= 0.78 ? "var(--destructive)" : ratio >= 0.45 ? "var(--amber)" : "var(--primary)";
  return <div className={css({ display: "flex", alignItems: "center", gap: ".5rem", minWidth: 0 })}>
    <div role="meter" aria-label="Time used" aria-valuemin={0} aria-valuemax={Math.round(budgetMs / 1_000)} aria-valuenow={Math.round(elapsedMs / 1_000)}
      aria-valuetext={`${Math.round(elapsedMs / 1_000)} of ${Math.round(budgetMs / 1_000)} seconds`}
      className={css({ flex: 1, height: ".375rem", borderRadius: "999px", background: "var(--muted)", overflow: "hidden" })}>
      <div className={css({ height: "100%", borderRadius: "inherit", transition: "width 1s linear, background .4s" })} style={{ width: `${ratio * 100}%`, background: color }} />
    </div>
    {label && <span className={cx(small, css({ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }))}>{Math.round(elapsedMs / 1_000)} s</span>}
  </div>;
}

/** Filled dots for drafts written so far out of the allowed attempts. */
function AttemptDots({ attempt, max }: { attempt: number; max: number }) {
  if (attempt <= 1 || max <= 1) return null;
  return <span role="img" aria-label={`Draft ${attempt} of ${max}`} className={css({ display: "inline-flex", gap: ".2rem", alignItems: "center" })}>
    {Array.from({ length: Math.min(max, 10) }, (_, index) => <span key={index} className={css({ width: ".4rem", height: ".4rem", borderRadius: "999px" })}
      style={{ background: index < attempt ? "var(--primary)" : "var(--muted)" }} />)}
  </span>;
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
      <AttemptDots attempt={snapshot.attempt} max={snapshot.maxAttempts} />
    </div>
    <DraftStageStepper snapshot={snapshot} compact />
    <DraftTimeBar elapsedMs={elapsed} />
    {guidance.detail && <p className={cx(small, css({ margin: 0, display: "flex", gap: ".375rem", alignItems: "flex-start" }))}>
      {guidance.slow && <TriangleAlert size={14} aria-hidden="true" className={css({ flexShrink: 0, marginTop: ".15rem" })} style={{ color: "var(--amber)" }} />}
      {guidance.detail}
    </p>}
  </div>;
}

const ToneIcon = ({ tone }: { tone: DiagnosisTone }) => {
  const Icon = tone === "ok" ? CircleCheck : tone === "caution" ? TriangleAlert : CircleAlert;
  return <Icon size={16} aria-hidden="true" className={css({ flexShrink: 0, marginTop: ".1rem" })} style={{ color: toneColor[tone] }} />;
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
        {finding.action && <a href={finding.action.href} target="_blank" rel="noopener noreferrer" className={css({ fontSize: ".75rem", color: "var(--primary)", textDecoration: "underline", width: "fit-content" })}>{finding.action.label} →</a>}
      </div>
    </li>)}
  </ul>;
}

const statusColor: Record<string, string> = { pass: "var(--primary)", fail: "var(--destructive)", unknown: "var(--amber)", "generation-error": "var(--destructive)" };

/** A waterfall: one row per draft (writing, then review) placed where it ran on one time axis, so the slow step stands out. */
export function DraftTimeline({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const planning = snapshot.planningMs ?? 0;
  const rows = snapshot.attempts;
  const scale = Math.max(1, snapshot.elapsedMs, planning + rows.reduce((sum, attempt) => sum + attempt.generationMs + attempt.judgementMs, 0));
  const offsets = rows.reduce<number[]>((starts, attempt, index) => [...starts, index === 0 ? planning : starts[index - 1]! + rows[index - 1]!.generationMs + rows[index - 1]!.judgementMs], []);
  const gap = (ms: number) => ms > 0 && <span aria-hidden="true" className={css({ display: "block", height: "100%" })} style={{ width: `${(ms / scale) * 100}%` }} />;
  const bar = (ms: number, color: string, title: string, striped = false) => ms > 0 && <span title={`${title}: ${(ms / 1_000).toFixed(1)} s`}
    className={css({ display: "block", height: "100%", minWidth: "2px" })}
    style={{ width: `${(ms / scale) * 100}%`, background: striped ? `repeating-linear-gradient(135deg, ${color} 0 4px, transparent 4px 7px)` : color }} />;
  if (!rows.length && !planning) return <p className={small}>No drafts have finished yet.</p>;
  return <figure aria-label="Where the time went" className={css({ margin: 0, display: "grid", gap: ".375rem" })}>
    {planning > 0 && <div className={css({ display: "grid", gridTemplateColumns: "9rem 1fr 3.5rem", gap: ".5rem", alignItems: "center" })}>
      <span className={small}>Planning</span>
      <span className={css({ display: "flex", height: ".625rem", borderRadius: ".2rem", background: "var(--muted)", overflow: "hidden" })}>{bar(planning, "var(--muted-foreground)", "Planning")}</span>
      <span className={cx(small, css({ textAlign: "right", fontVariantNumeric: "tabular-nums" }))}>{(planning / 1_000).toFixed(1)} s</span>
    </div>}
    {rows.map((attempt, index) => <div key={attempt.attempt} className={css({ display: "grid", gridTemplateColumns: "9rem 1fr 3.5rem", gap: ".5rem", alignItems: "center" })}>
      <span className={cx(small, css({ display: "flex", gap: ".35rem", alignItems: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }))}>
        <span aria-hidden="true" className={css({ width: ".5rem", height: ".5rem", borderRadius: "999px", flexShrink: 0 })} style={{ background: statusColor[attempt.status] }} />
        {attempt.status === "generation-error" ? "Attempt" : "Draft"} {attempt.attempt} · {attempt.status}
        {attempt.variant !== "default" && <span> · {attempt.variant}</span>}
      </span>
      <span className={css({ display: "flex", height: ".625rem", borderRadius: ".2rem", background: "var(--muted)", overflow: "hidden" })}>
        {gap(offsets[index]!)}{bar(attempt.generationMs, "var(--primary)", "Writing")}{bar(attempt.judgementMs, "var(--accent-dim, var(--primary))", "Review", true)}
      </span>
      <span className={cx(small, css({ textAlign: "right", fontVariantNumeric: "tabular-nums" }))}>{((attempt.generationMs + attempt.judgementMs) / 1_000).toFixed(1)} s</span>
    </div>)}
    <figcaption className={cx(small, css({ display: "flex", gap: ".875rem", flexWrap: "wrap" }))}>
      <Legend swatch="var(--primary)">Writing</Legend><Legend swatch="repeating-linear-gradient(135deg, var(--accent-dim, var(--primary)) 0 4px, transparent 4px 7px)">Review</Legend>
      <span>Total {(snapshot.elapsedMs / 1_000).toFixed(1)} s of {Math.round(DRAFT_TIME_BUDGET_MS / 1_000)} s</span>
    </figcaption>
  </figure>;
}

const Legend = ({ swatch, children }: { swatch: string; children: ReactNode }) => <span className={css({ display: "inline-flex", gap: ".3rem", alignItems: "center" })}>
  <span aria-hidden="true" className={css({ width: ".75rem", height: ".5rem", borderRadius: ".15rem", border: "1px solid var(--line-soft, var(--border))" })} style={{ background: swatch }} />{children}
</span>;

const cellGlyph: Record<TeachingPolicyCheck["status"], string> = { pass: "✓", fail: "✕", unknown: "?" };

function CheckCell({ check }: { check: TeachingPolicyCheck | null }) {
  if (!check) return <td className={cx(small, css({ textAlign: "center" }))}>–</td>;
  const probability = check.probability === null ? "no probability" : `P(violation) ${check.probability.toFixed(2)}`;
  return <td className={css({ textAlign: "center", padding: ".15rem" })}>
    <span title={`${check.status} · ${probability}`} aria-label={`${check.status}, ${probability}`}
      className={css({ display: "inline-grid", placeItems: "center", width: "1.5rem", height: "1.5rem", borderRadius: ".3rem", fontSize: ".75rem", fontWeight: 700 })}
      style={{ background: check.status === "pass" ? "transparent" : `color-mix(in srgb, ${statusColor[check.status]} 18%, transparent)`, color: statusColor[check.status] }}>
      {cellGlyph[check.status]}
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
  return <div className={css({ display: "grid", gap: ".375rem" })}>
    {problems.length ? table(problems) : <p className={small}>Every check passed in every draft.</p>}
    {passing.length > 0 && <details>
      <summary className={cx(small, css({ cursor: "pointer" }))}>{passing.length} passing {passing.length === 1 ? "check" : "checks"}</summary>
      {table(passing)}
    </details>}
  </div>;
}
