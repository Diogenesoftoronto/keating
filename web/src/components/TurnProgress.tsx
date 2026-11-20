/**
 * The learner's view of how a tutor turn is going and how it went: a stage
 * rail with one plain sentence on top, the step timeline underneath (closed by
 * default), and the same timeline folded into chips under the finished reply.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useAuiState, type ThreadMessage } from "@assistant-ui/react";
import { KeatingGlyph } from "../design-system/glyphs";
import { Progress, Timeline } from "../design-system/charts";
import { KeatingBot } from "./KeatingBot";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { keatingStorage } from "../hooks/keating-storage";
import { teachingDraftIsActive, type TeachingDraftStatus } from "../keating/judgement/draft-status";
import { hasShownTurnReceipt, turnGuidance, turnStages, turnSteps, turnSummary, type TurnStage, type TurnStep } from "../keating/judgement/turn-progress";
import { useTurnReceipt } from "../keating/judgement/turn-receipts";
import { useDraftElapsed } from "./DraftProgress";
import { citationsFromCalls, isWebSearchToolName, type WebSearchCall } from "./web-search-result";
import { useTurnSearchCalls } from "./WebSearchPart";
import "./turn-progress.css";

const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)}s`;
const stateWord: Record<TurnStage["state"], string> = { done: "done", active: "in progress", pending: "not started", stopped: "stopped" };

export function TurnRail({ stages }: { stages: readonly TurnStage[] }) {
  return <div className="turn-rail">
    <ol className="turn-stages" aria-label="Reply stages">
      {stages.map(stage => <li key={stage.id} data-state={stage.state} aria-current={stage.state === "active" ? "step" : undefined}>
        {stage.label}{stage.badge && <small>{stage.badge}</small>}
        <span className="turn-sr">: {stateWord[stage.state]}</span>
      </li>)}
    </ol>
    <Progress done={stages.filter(stage => stage.state === "done").length} total={stages.length} label="Reply progress" />
  </div>;
}

export function TurnTimeline({ steps, id }: { steps: readonly TurnStep[]; id?: string }) {
  if (!steps.length) return null;
  const lanes = steps.map((step, index) => ({
    label: step.title,
    bands: [{ label: step.state === "warn" ? "Needs attention" : step.state === "active" ? "In progress" : "Done", start: index, end: index + 1 }],
  }));
  return <div id={id} className="turn-step-list">
    <Timeline lanes={lanes} label="Reply events in step order" />
    <ol className="turn-timeline" aria-label="Step details">
    {steps.map(step => <li key={step.id} data-state={step.state}>
      <div className="turn-timeline__head">
        <b>{step.title}</b>
        {step.durationMs !== undefined && step.durationMs > 0 && <span className="turn-mono">{seconds(step.durationMs)}</span>}
      </div>
      {step.queries ? <ul className="turn-timeline__queries">
        {step.queries.map(query => <li key={query.id} data-state={query.state}>
          {query.state === "running" && <KeatingGlyph name="spin" size={10} className="k-glyph-working" />}
          <span>{query.query}</span>
          <span className="turn-mono">{query.state === "error" ? "failed" : query.state === "success" ? `${query.sources} ${query.sources === 1 ? "source" : "sources"}` : ""}</span>
        </li>)}
      </ul> : step.detail && <p className="turn-timeline__detail" data-tone={step.tone}>{step.detail}</p>}
    </li>)}
  </ol></div>;
}

/** Live detail inside the current assistant message. */
export function TurnProgressCard({ status, prefill }: { status: TeachingDraftStatus | null; prefill?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const calls = useTurnSearchCalls("thread");
  const elapsed = useDraftElapsed(status);
  const draftActive = teachingDraftIsActive(status);
  const [started] = useState(Date.now);
  const [now, setNow] = useState(started);
  useEffect(() => {
    if (draftActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [draftActive]);
  const elapsedMs = draftActive ? elapsed : Math.max(0, now - started);
  const snapshot = draftActive ? status!.snapshot : null;
  const detailed = turnStages(snapshot, calls);
  const stages: TurnStage[] = [
    { id: "write", label: "Draft", parts: detailed.filter(stage => ["plan", "research", "write"].includes(stage.id)) },
    { id: "check", label: "Review", parts: detailed.filter(stage => stage.id === "check") },
    { id: "choose", label: "Reply", parts: detailed.filter(stage => stage.id === "choose") },
  ].map(({ id, label, parts }) => ({
    id: id as TurnStage["id"], label,
    state: parts.some(part => part.state === "active") ? "active" : parts.some(part => part.state === "stopped") ? "stopped"
      : parts.every(part => part.state === "done") ? "done" : "pending",
  }));
  if (!snapshot && !stages.some(stage => stage.state === "active")) stages[0] = { ...stages[0]!, state: "active" };
  const steps = turnSteps(snapshot, calls);
  const guidance = turnGuidance(snapshot, calls, elapsed);
  const latest = steps[steps.length - 1];
  return <section className="turn-thinking" aria-label="Reply in progress" data-quote-exclude="">
    <div className="turn-thinking__who">
      <KeatingBot state="thinking" size={24} label="" />
      <b>Keating</b><span className="turn-thinking__dots" aria-hidden="true">···</span>
    </div>
    <p role="status">{snapshot || calls.length ? guidance.headline : "Keating is thinking"}</p>
    <TurnRail stages={stages} />
    <div className="turn-thinking__detail">
      {guidance.slow && <KeatingGlyph name="alert" size={13} />}
      {(guidance.detail || prefill) && <span>{guidance.detail || prefill}</span>}
      <span className="turn-mono">{Math.round(elapsedMs / 1_000)}s</span>
    </div>
    {steps.length > 0 && <>
      <button type="button" className="turn-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <KeatingGlyph name="chev" size={13} className="turn-toggle__chev" />
        {open ? "Hide steps" : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
        {!open && latest && <span className="turn-toggle__tail">· {latest.title}</span>}
      </button>
      {open && <TurnTimeline steps={steps} id={panelId} />}
    </>}
  </section>;
}

const loadReceipts = (sessionId: string) => keatingStorage.getTeachingDraftReceipts(sessionId);

function receiptTimestamps(message: ThreadMessage): readonly number[] {
  const sources = message.metadata.custom?.keatingDiagnosticTimestamps;
  // The receipt store checks the most recent source first when rows combine.
  if (Array.isArray(sources) && sources.length) {
    return sources.filter((timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp));
  }
  // Native capture and display timestamps cannot identify a review receipt.
  if (message.id.startsWith("entry_")) return [];
  const legacy = /^assistant-(?:\d+-)?(\d+)$/.exec(message.id);
  const timestamp = Number(legacy?.[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? [timestamp] : message.createdAt ? [message.createdAt.getTime()] : [];
}

function receiptIsVisible(message: ThreadMessage, snapshot: TeachingDraftSnapshot): boolean {
  const status = message.status;
  if (snapshot.phase === "cancelled") {
    return status?.type !== "running" && hasShownTurnReceipt(snapshot);
  }
  return status?.type === "complete" && hasShownTurnReceipt(snapshot);
}

function SummaryChips({ snapshot, calls }: { snapshot: TeachingDraftSnapshot; calls: readonly WebSearchCall[] }) {
  const summary = turnSummary(snapshot, calls, citationsFromCalls(calls).length);
  return <span className="turn-chips">
    {snapshot.phase === "cancelled"
      ? <span className="turn-chip"><KeatingGlyph name="stop" size={12} />You stopped after the opening</span>
      : snapshot.reason === "remaining-part-unresolved"
      ? <span className="turn-chip"><KeatingGlyph name="alert" size={12} />Requested part still open</span>
      : summary.checked
      ? <span className="turn-chip" data-tone="ok"><KeatingGlyph name="check" size={12} />Checked</span>
      : summary.checks > 0
      ? <span className="turn-chip"><KeatingGlyph name="alert" size={12} />Review concerns</span>
      : <span className="turn-chip" data-tone="bad"><KeatingGlyph name="x" size={12} />No check results</span>}
    {summary.searches > 0 && <span className="turn-chip">{summary.searches} {summary.searches === 1 ? "search" : "searches"} · {summary.sources} {summary.sources === 1 ? "source" : "sources"}</span>}
    {summary.drafts > 1 && <span className="turn-chip">{summary.drafts} drafts{summary.fixes ? ` · ${summary.fixes} ${summary.fixes === 1 ? "revision" : "revisions"}` : ""}</span>}
    {summary.checks > 0 && <span className="turn-chip">{snapshot.phase === "cancelled"
      ? `${summary.passed} passed, ${summary.failed} failed, ${summary.inconclusive} inconclusive`
      : <>{summary.passed < summary.checks ? `${summary.passed} of ` : ""}{summary.checks} {summary.checks === 1 ? "check" : "checks"} passed</>}</span>}
  </span>;
}

/** Folded "how this reply was made" row below a finished, gate-reviewed reply. */
export function TurnProcessSummary({ sessionId }: { sessionId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const message = useAuiState(({ message }) => message);
  const snapshot = useTurnReceipt(sessionId, receiptTimestamps(message), loadReceipts);
  const calls = useTurnSearchCalls("message");
  const steps = useMemo(() => snapshot ? turnSteps(snapshot, calls) : [], [snapshot, calls]);
  if (!snapshot || !receiptIsVisible(message, snapshot)) return null;
  return <section className="turn-summary" aria-label="How this reply was made" data-quote-exclude="">
    <button type="button" className="turn-toggle turn-summary__toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <span>How this reply was made</span>
      <SummaryChips snapshot={snapshot} calls={calls} />
      {snapshot.elapsedMs > 0 && <span className="turn-mono">{Math.round(snapshot.elapsedMs / 1_000)}s</span>}
      <KeatingGlyph name="chev" size={13} className="turn-toggle__chev" />
    </button>
    {open && <TurnTimeline steps={steps} id={panelId} />}
  </section>;
}

type PartLike = { type: string; text?: string; toolName?: string };

/** True when a message is only web searches (reasoning and blank text aside). */
export function isSearchOnlyStep(parts: readonly PartLike[]): boolean {
  let searches = 0;
  for (const part of parts) {
    if (part.type === "tool-call" && part.toolName && isWebSearchToolName(part.toolName)) searches += 1;
    else if (!(part.type === "reasoning" || (part.type === "text" && !part.text?.trim()))) return false;
  }
  return searches > 0;
}

/**
 * Whether the turn view already shows this message's searches, so the message
 * itself can step aside: live, while the progress card is up for the current
 * turn; afterwards, when the turn's reply carries the folded summary.
 */
export function useSearchStepCovered(sessionId: string | undefined): boolean {
  const searchOnly = useAuiState(({ message }) => message.role === "assistant" && isSearchOnlyStep(message.content as readonly PartLike[]));
  const lastReply = useAuiState(({ thread, message }) => {
    if (!sessionId || !searchOnly) return undefined;
    const messages = thread.messages;
    const index = messages.findIndex(candidate => candidate.id === message.id);
    if (index < 0) return undefined;
    let end = index;
    while (end + 1 < messages.length && messages[end + 1]!.role !== "user") end += 1;
    return messages[end];
  });
  const live = useAuiState(({ thread }) => thread.isRunning && thread.messages.at(-1)?.id === lastReply?.id);
  const ownId = useAuiState(({ message }) => message.id);
  const receipt = useTurnReceipt(lastReply?.role === "assistant" ? sessionId : undefined,
    lastReply?.role === "assistant" ? receiptTimestamps(lastReply) : [], loadReceipts);
  if (!lastReply) return false;
  if (live) return true;
  return lastReply.id !== ownId && Boolean(receipt && receiptIsVisible(lastReply, receipt));
}
