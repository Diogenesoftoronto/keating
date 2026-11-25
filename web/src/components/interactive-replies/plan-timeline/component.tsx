import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { DraggableRenderer, inOrder, lessThan, param, translate, type Draggable } from "dragology";
import "./component.css";
import {
  analyse, spacingText, applyProposal, check, conflictKey, conflictText, criticalData, criticalText, dayName, dayParts, effective, giveText,
  hoursText, listJoin, listSome, noteText, plural, samePlan, settle, shift,
  type Analysis, type Conflict, type Plan, type PlanTimelineConfig, type Ready, type ShareSummary, type TaskKind,
} from "./model";

export type { PlanTimelineConfig, PlanTask, PlanMove, ShareSummary, TaskKind } from "./model";
export { validatePlanTimeline } from "./model";

/* ============================================================================
   PlanTimeline: a study plan as a Gantt timeline with dependencies.
   The learner drags a bar to move a task and drags its ends to change its
   length. Downstream tasks are pushed along live; dashed outlines are the plan
   as last applied, arrows show what moved. Conflicts (lost day, over capacity,
   prerequisite after its dependent, past the deadline) show on the timeline.
   Nothing is committed until Apply. Keating can arrive with a proposal: a set
   of moves drawn the same way, which the learner applies, tweaks or dismisses.
   ========================================================================== */

type Props = { config: PlanTimelineConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void };
type Phase = "proposal" | "tweaking" | "editing" | "applied";
type Change = { task: number; text: string };
/** What the learner shared from: an applied decision, or a draft they have not applied yet. */
type Decision = { kind: "proposal" | "tweaked" | "own"; changes: Change[]; own: Change[]; pushed: Change[]; analysis: Analysis; plan: Plan; dismissed: boolean };

/** SSR-safe: a fixed first width; the ResizeObserver measures the real one after mount. */
function initialWidth() { return 600; }

export function PlanTimeline({ config, onChange, onShare }: Props) {
  const checked = useMemo(() => check(config), [config]);
  if (!checked.ok) {
    return <section className="activity plan-tl is-fallback" aria-label="Plan timeline">
      <p className="pt-fallback">This plan could not be drawn. {checked.reason}</p>
    </section>;
  }
  return <Timeline key={JSON.stringify(config)} r={checked} onChange={onChange} onShare={onShare} />;
}

/* ---------- Geometry ---------- */
type Geo = { W: number; H: number; padX: number; dayW: number; headerH: number; rowH: number; BH: number; rowsTop: number; loadTop: number; loadH: number; compact: boolean };
function geometry(W: number, r: Ready): Geo {
  const padX = 6, compact = W < 440;
  const dayW = (W - 2 * padX) / r.H;
  const headerH = r.startDate ? 34 : 24;
  const rowH = 32, BH = compact ? 15 : 16;
  const rowsTop = headerH + 4;
  const loadTop = rowsTop + r.ids.length * rowH + 12;
  const loadH = 34;
  return { W, H: loadTop + loadH + 40, padX, dayW, headerH, rowH, BH, rowsTop, loadTop, loadH, compact };
}

/** Which tasks differ between two plans, one entry per task, in words. */
function changesBetween(r: Ready, from: Plan, to: Plan): Change[] {
  const out: Change[] = [];
  r.ids.forEach((_, i) => {
    const ds = to.s[i] !== from.s[i], dd = to.d[i] !== from.d[i], dh = to.h[i] !== from.h[i];
    if (!ds && !dd && !dh) return;
    const span = (p: Plan) => (p.d[i] === 1 ? dayName(r, p.s[i]) : `${dayName(r, p.s[i])}–${dayName(r, p.s[i] + p.d[i] - 1)}`);
    let text = r.titles[i];
    if (ds && !dd) text += ` ${dayName(r, from.s[i])} → ${dayName(r, to.s[i])}`;
    else if (dd && !ds) text += ` ${plural(from.d[i], "day")} → ${plural(to.d[i], "day")}`;
    else if (ds && dd) text += ` ${span(from)} → ${span(to)}`;
    if (dh) text += `${ds || dd ? "," : ""} ${hoursText(from.h[i])} → ${hoursText(to.h[i])} a day`;
    out.push({ task: i, text });
  });
  return out;
}
const texts = (cs: Change[]) => cs.map(c => c.text);

function Timeline({ r, onChange, onShare }: { r: Ready; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  const proposed = useMemo(() => (r.proposal ? applyProposal(r, r.base) : undefined), [r]);
  const [applied, setApplied] = useState<Plan>(r.base);
  const [model, setModel] = useState<Plan>(() => proposed ?? r.base);
  const [phase, setPhase] = useState<Phase>(r.proposal ? "proposal" : "editing");
  const [proposalOpen, setProposalOpen] = useState(!!r.proposal);
  const [dismissed, setDismissed] = useState(false);
  const [preview, setPreview] = useState<Plan>();
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [lastEdit, setLastEdit] = useState<{ task: number; before: Plan; after: Plan }>();
  const [decision, setDecision] = useState<Decision>();
  const [shared, setShared] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [remount, setRemount] = useState(0);
  const draggingRef = useRef(false);
  /* Interrupted gesture (pointercancel): discard the preview, keep the last committed plan. */
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => { draggingRef.current = false; setDragging(false); setPreview(undefined); setRemount(k => k + 1); setStatus("Drag interrupted; the plan is unchanged."); };
    document.addEventListener("pointercancel", cancel);
    return () => document.removeEventListener("pointercancel", cancel);
  }, [dragging]);
  const [pick, setPick] = useState(() => r.fixed.findIndex(f => !f));
  /** Tasks the learner moved or resized by hand since the last apply (the rest of a diff is pushes). */
  const [touched, setTouched] = useState<number[]>([]);
  const [history, setHistory] = useState<{ model: Plan; touched: number[]; phase: Phase }[]>([]);
  const [acted, setActed] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    // A width change mid-drag remounts the renderer on the committed plan: the preview is discarded, never dropped.
    const resize = () => {
      const w = Math.max(240, el.clientWidth);
      setWidth(prev => {
        if (prev !== w && draggingRef.current) { draggingRef.current = false; setDragging(false); setPreview(undefined); setRemount(k => k + 1); }
        return w;
      });
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches); sync();
    q.addEventListener("change", sync); return () => q.removeEventListener("change", sync);
  }, []);

  const g = useMemo(() => geometry(width, r), [width, r]);
  const view = preview ?? model;
  const A = useMemo(() => analyse(r, view), [r, view]);
  const modelA = useMemo(() => analyse(r, model), [r, model]);
  const appliedA = useMemo(() => analyse(r, applied), [r, applied]);
  const xAt = (k: number) => g.padX + k * g.dayW;
  const rowY = (i: number) => g.rowsTop + i * g.rowH;
  const barY = (i: number) => rowY(i) + g.rowH - g.BH - 4;
  const midY = (i: number) => barY(i) + g.BH / 2;
  const loadScale = g.loadH / (r.cap * 2);

  /* ---------- The draggable picture ---------- */
  const draggable: Draggable<Plan> = useCallback(({ state, d, draggedId }) => {
    const id = (s: string) => `pt${uid}-${s}`;
    const e = effective(r, state);
    const a = analyse(r, state);
    const n = r.ids.length;
    const orderBad = new Set(a.conflicts.flatMap(c => (c.kind === "order" ? [`${c.pred}-${c.task}`] : [])));
    const taskBad = new Set(a.conflicts.flatMap(c => ("task" in c ? [c.task] : [])));
    const overDay = new Set(a.conflicts.flatMap(c => (c.kind === "capacity" ? [c.day] : [])));
    const constrainEnds = (s: Plan) => { const ee = effective(r, s); return ee.s.map((x, i) => (r.fixed[i] ? -1 : lessThan(x + ee.d[i], r.H))); };
    const rowsBottom = g.rowsTop + n * g.rowH;

    const header = <g>{Array.from({ length: r.H }, (_, k) => {
      const p = dayParts(r, k);
      const cx = xAt(k) + g.dayW / 2;
      const lost = r.blocked?.day === k;
      const top = g.dayW < 26 ? p.top.slice(0, 1) : p.top;
      return <g transform={translate(cx, 0)} className={`pt-day${lost ? " is-lost" : ""}${k < r.today ? " is-past" : ""}${k === r.today && r.today > 0 ? " is-today" : ""}`}>
        {r.startDate && <text transform={translate(0, 12)} textAnchor="middle" className="pt-day-top">{top}</text>}
        <text transform={translate(0, r.startDate ? 27 : 16)} textAnchor="middle" className="pt-day-num">{p.num}</text>
      </g>;
    })}</g>;

    const columns = <g id={id("cols")} dragologyZIndex={-3} className="pt-cols">
      {Array.from({ length: r.H }, (_, k) => {
        const wd = dayParts(r, k).weekday;
        return <rect transform={translate(xAt(k), g.rowsTop - 2)} width={g.dayW} height={rowsBottom - g.rowsTop + 4}
          className={`pt-col${wd === 0 || wd === 6 ? " is-weekend" : ""}`} />;
      })}
      {r.today > 0 && <rect transform={translate(xAt(0), g.rowsTop - 2)} width={r.today * g.dayW} height={g.loadTop + g.loadH - g.rowsTop + 2} className="pt-past" />}
      {Array.from({ length: r.H + 1 }, (_, k) => <line x1={xAt(k)} y1={g.rowsTop - 2} x2={xAt(k)} y2={rowsBottom + 2} className="pt-grid" />)}
      {Array.from({ length: r.H }, (_, k) => <rect transform={translate(xAt(k), g.rowsTop - 2)} width={g.dayW} height={rowsBottom - g.rowsTop + 4}
        className="pt-col-over" opacity={overDay.has(k) ? 1 : 0} />)}
      {r.blocked && (() => {
        const x0 = xAt(r.blocked.day), y0 = g.rowsTop - 2, h = g.loadTop + g.loadH - y0;
        /* 45° hatch clipped to the column by hand (no clipPath ids in the layer tree). */
        const step = 8, W0 = g.dayW; let dd = "";
        for (let c = step; c < W0 + h; c += step) {
          /* line x + y' = c, with x in [0, W0] and y' in [0, h] */
          const xa = Math.max(0, c - h), xb = Math.min(W0, c);
          dd += `M ${x0 + xa} ${y0 + c - xa} L ${x0 + xb} ${y0 + c - xb} `;
        }
        return <g>
          <rect transform={translate(x0, y0)} width={g.dayW} height={h} className="pt-lost-fill" />
          <path d={dd} className="pt-lost-hatch" />
        </g>;
      })()}
    </g>;

    const todayMark = r.today > 0 && <g id={id("today")} dragologyZIndex={-1} className="pt-today" pointerEvents="none">
      <line x1={xAt(r.today)} y1={g.rowsTop - 4} x2={xAt(r.today)} y2={rowsBottom + 2} />
      <text transform={translate(xAt(r.today) + (xAt(r.today) < 40 ? 4 : -4), rowsBottom - 4)} textAnchor={xAt(r.today) < 40 ? "start" : "end"} className="pt-today-label">today</text>
    </g>;

    const deadline = r.deadline !== undefined && <g id={id("deadline")} dragologyZIndex={-1} className="pt-deadline" pointerEvents="none">
      <line x1={xAt(r.deadline)} y1={g.rowsTop - 4} x2={xAt(r.deadline)} y2={rowsBottom + 2} />
      <text transform={translate(Math.min(xAt(r.deadline) - 4, g.W - 4), rowsBottom + 9)} textAnchor="end" className="pt-deadline-label">{r.deadlineLabel}</text>
    </g>;

    /* Ghosts of the applied plan and ghost-to-new arrows, under everything that moves. */
    const ghosts = <g id={id("ghosts")} dragologyZIndex={-2} pointerEvents="none">
      {r.ids.map((_, i) => {
        const moved = Math.abs(e.s[i] - applied.s[i]) > 0.01 || Math.abs(e.d[i] - applied.d[i]) > 0.01;
        const gx = xAt(applied.s[i]) + 1, gw = applied.d[i] * g.dayW - 2;
        const nx = xAt(e.s[i]) + 1, nw = e.d[i] * g.dayW - 2;
        /* Arrow from the ghost's leading edge to the same edge of the new bar: its length is the move. */
        const startMoved = Math.abs(e.s[i] - applied.s[i]) > 0.01;
        const later = startMoved ? e.s[i] > applied.s[i] : e.d[i] > applied.d[i];
        const fx = startMoved ? (later ? gx + 3 : gx + gw - 3) : gx + gw - 3;
        const tx = startMoved ? (later ? nx - 1 : nx + nw + 1) : nx + nw + (later ? -1 : 1);
        const y = midY(i), dir = later ? 1 : -1;
        const head = `M ${tx - dir * 6} ${y - 4} L ${tx} ${y} L ${tx - dir * 6} ${y + 4}`;
        return <g opacity={moved ? 1 : 0}>
          <rect transform={translate(gx, barY(i))} width={Math.max(2, gw)} height={g.BH} rx={4} className="pt-ghost" />
          <path d={`M ${fx} ${y} L ${tx} ${y} ${head}`} className="pt-move" />
        </g>;
      })}
    </g>;

    const deps = <g id={id("deps")} dragologyZIndex={-1} pointerEvents="none">
      {r.preds.flatMap((ps, t) => ps.map(q => {
        const ax = xAt(e.s[q] + e.d[q]) - 1, ay = midY(q);
        const bx = xAt(e.s[t]) + 1, by = midY(t);
        const k = Math.max(10, Math.abs(bx - ax) / 2, bx < ax ? 26 : 0);
        const path = `M ${ax} ${ay} C ${ax + k} ${ay} ${bx - k} ${by} ${bx - 2} ${by}`;
        const head = `M ${bx - 7} ${by - 3.5} L ${bx - 1} ${by} L ${bx - 7} ${by + 3.5}`;
        const bad = orderBad.has(`${q}-${t}`), crit = !bad && a.criticalEdge(q, t);
        return <g>
          <path d={path + " " + head} className="pt-dep" opacity={bad || crit ? 0 : 1} />
          <path d={path + " " + head} className="pt-dep-crit" opacity={crit ? 1 : 0} />
          <path d={path + " " + head} className="pt-dep-bad" opacity={bad ? 1 : 0} />
        </g>;
      }))}
    </g>;

    const tasks = r.ids.map((_, i) => {
      const k = r.kinds[i];
      const x = xAt(e.s[i]) + 1, w = Math.max(4, e.d[i] * g.dayW - 2), y = barY(i);
      const bid = id(`b${i}`);
      const dragged = draggedId === bid || draggedId === id(`l${i}`) || draggedId === id(`r${i}`) || draggedId === id(`n${i}`);
      const slack = Math.max(0, a.slack[i]);
      const slackW = r.fixed[i] ? 0 : slack * g.dayW;
      /* Compact: the fixed look already says "fixed", so only started/done keep a suffix. */
      const title = r.titles[i] + (r.locked[i] ? (e.s[i] + e.d[i] > r.today ? " · started" : " · done") : r.fixed[i] && !g.compact ? (k === "exam" ? "" : " · fixed") : "");
      const est = title.length * (g.compact ? 5.1 : 6.1);
      const lx = Math.max(g.padX, Math.min(x, g.W - g.padX - est));
      const slackLabelX = x + w + slackW + 3;
      const showSlackLabel = !r.fixed[i] && slack > 0 && slackLabelX + 22 < g.W;
      /* Edge grips: a little inside the bar plus a generous invisible margin outside it, so a 20px day is still grabbable. */
      const hw = Math.max(4, Math.min(9, w / 4)), out = g.compact ? 9 : 6, padY = g.compact ? 6 : 4;
      const body = () => d.vary({ ...state, push: i, lead: -1 }, param<Plan>("s", i), {
        constraint: s => [...inOrder([r.today, s.s[i], r.H - s.d[i]]), ...constrainEnds(s)],
      }).onDrop(p => settle(r, p)).withDropTransition(reduced ? false : undefined);
      const rightEdge = () => d.vary({ ...state, push: i, lead: -1 }, param<Plan>("d", i), {
        constraint: s => [...inOrder([0.55, s.d[i], r.H - s.s[i]]), ...constrainEnds(s)],
      }).onDrop(p => settle(r, p)).withDropTransition(reduced ? false : undefined);
      const leftEdge = () => d.vary({ ...state, push: i, lead: i, leadEnd: state.s[i] + state.d[i] }, param<Plan>("s", i), {
        constraint: s => inOrder([r.today, s.s[i], s.leadEnd - 0.55]),
      }).onDrop(p => settle(r, p)).withDropTransition(reduced ? false : undefined);
      return <g id={id(`t${i}`)} className={`pt-task pt-k-${k}`} dragologyZIndex={dragged ? "/1" : false}>
        <rect transform={translate(x + w - 2, y + g.BH / 2 - 2)} width={Math.max(0.01, slackW + 2)} height={4} rx={2} className="pt-slack" opacity={slackW > 0 ? 1 : 0} />
        <text transform={translate(slackLabelX, y + g.BH / 2 + 0.5)} dominantBaseline="central" className="pt-slack-label" opacity={showSlackLabel ? 1 : 0}>{`+${Math.round(slack)}d`}</text>
        <text transform={translate(lx, y - 4)} className="pt-label">{title}</text>
        {!r.fixed[i] && <rect id={id(`n${i}`)} transform={translate(x, y - 13)} width={w} height={13} className={`pt-name-hit pt-k-${k}`} dragologyOnDrag={body} />}
        <rect transform={translate(x, y + g.BH + 2)} width={w} height={2.5} rx={1.2} className="pt-crit" opacity={a.critical[i] ? 1 : 0} />
        <rect id={bid} transform={translate(x, y)} width={w} height={g.BH} rx={4}
          className={`pt-bar pt-k-${k}${r.fixed[i] ? " is-fixed" : " is-grab"}${r.locked[i] ? " is-past" : ""}`}
          {...(r.fixed[i] ? {} : { dragologyOnDrag: body })} />
        <rect id={id(`c${i}`)} transform={translate(x - 1.5, y - 1.5)} width={w + 3} height={g.BH + 3} rx={5} className="pt-bar-bad" dragologyZIndex={1}
          opacity={taskBad.has(i) ? 1 : 0} pointerEvents="none" />
        {!r.fixed[i] && <g id={id(`l${i}`)} transform={translate(x - out, y - padY)} className={`pt-handle pt-k-${k}`} dragologyZIndex={2} dragologyOnDrag={leftEdge}>
          <rect width={hw + out} height={g.BH + 2 * padY} className="pt-handle-hit" />
          <line x1={out + 2.5} y1={padY + 4} x2={out + 2.5} y2={padY + g.BH - 4} className="pt-handle-grip" />
        </g>}
        {!r.fixed[i] && <g id={id(`r${i}`)} transform={translate(x + w - hw, y - padY)} className={`pt-handle pt-k-${k}`} dragologyZIndex={2} dragologyOnDrag={rightEdge}>
          <rect width={hw + out} height={g.BH + 2 * padY} className="pt-handle-hit" />
          <line x1={hw - 2.5} y1={padY + 4} x2={hw - 2.5} y2={padY + g.BH - 4} className="pt-handle-grip" />
        </g>}
      </g>;
    });

    const lt = g.loadTop, lh = g.loadH, capY = lt + lh - r.cap * loadScale;
    const load = <g id={id("load")} dragologyZIndex={-1} pointerEvents="none">
      <line x1={g.padX} y1={lt + lh} x2={g.W - g.padX} y2={lt + lh} className="pt-load-base" />
      {a.load.map((h, k) => {
        const lost = r.blocked?.day === k;
        const okH = lost ? 0 : Math.min(h, r.cap) * loadScale;
        const overH = (lost ? Math.min(h, r.cap * 2) : Math.max(0, Math.min(h, r.cap * 2) - r.cap)) * loadScale;
        const bw = Math.max(3, g.dayW - Math.max(3, g.dayW * 0.22)), bx = xAt(k) + (g.dayW - bw) / 2;
        const over = overH > 0.01;
        return <g>
          <rect transform={translate(bx, lt + lh - okH)} width={bw} height={Math.max(0.01, okH)} rx={1.5} className="pt-load" />
          <rect transform={translate(bx, lt + lh - okH - overH)} width={bw} height={Math.max(0.01, overH)} rx={1.5} className="pt-load-over" />
          <text transform={translate(xAt(k) + g.dayW / 2, lt + lh + 11)} textAnchor="middle" className="pt-load-num" opacity={over || (!g.compact && h > 0) ? 1 : 0}>{g.dayW < 30 ? String(Math.round(h * 10) / 10) : hoursText(h)}</text>
          <text transform={translate(xAt(k) + g.dayW / 2, lt + lh + 11)} textAnchor="middle" className="pt-load-num-over" opacity={over ? 1 : 0}>{g.dayW < 30 ? String(Math.round(h * 10) / 10) : hoursText(h)}</text>
        </g>;
      })}
      <line x1={g.padX} y1={capY} x2={g.W - g.padX} y2={capY} className="pt-cap" />
    </g>;

    const lostLabel = r.blocked && <g transform={translate(xAt(r.blocked.day) + g.dayW / 2, (g.rowsTop + rowsBottom) / 2)} pointerEvents="none">
      <text transform="rotate(-90)" textAnchor="middle" dominantBaseline="central" className="pt-lost-label">{`${r.blocked.label} · lost`}</text>
    </g>;

    return <g>
      {header}
      {columns}
      {lostLabel}
      {deadline}
      {todayMark}
      {ghosts}
      {deps}
      {tasks}
      {load}
    </g>;
  }, [r, g, uid, applied, loadScale, reduced]);

  /* ---------- Commit ---------- */
  function commit(next: Plan, message: string, opts: { task?: number; animate?: boolean } = {}) {
    const before = model;
    setHistory(h => [...h.slice(-30), { model: before, touched, phase }]);
    if (opts.task !== undefined && !touched.includes(opts.task)) setTouched([...touched, opts.task]);
    setActed(true); setHint("");
    setModel(next);
    setPreview(undefined);
    setShared(false);
    if (message) setStatus(message);
    if (opts.task !== undefined) setLastEdit({ task: opts.task, before, after: next });
    if (phase === "proposal") setPhase("tweaking");
    else if (phase === "applied") setPhase("editing");
    if (reduced && opts.animate) setRemount(x => x + 1);
    onChange?.();
  }
  const moveMessage = (i: number, before: Plan, next: Plan) => {
    const ch = changesBetween(r, before, next);
    const own = ch.find(c => c.task === i), pushedN = ch.filter(c => c.task !== i).length;
    const nA = analyse(r, next);
    const head = own ? `${own.text}.` : `${r.titles[i]} unchanged.`;
    const pushed = pushedN ? ` Pushed ${pushedN} later ${pushedN === 1 ? "task" : "tasks"}.` : "";
    const conf = nA.conflicts.length ? ` ${plural(nA.conflicts.length, "conflict")}.` : " No conflicts.";
    return head + pushed + conf;
  };
  function onDrop(raw: Plan) {
    setDragging(false);
    const next = settle(r, raw);
    const i = raw.push;
    if (i < 0 || samePlan(next, model)) { setPreview(undefined); return; }
    commit(next, moveMessage(i, model, next), { task: i });
  }

  const draftDiffers = !samePlan(model, applied);
  const actions = {
    nudge: (ds: number, dd: number) => {
      if (pick < 0) return;
      const next = shift(r, model, pick, ds, dd);
      if (samePlan(next, model)) { setStatus(`${r.titles[pick]} cannot go ${ds < 0 ? "earlier" : ds > 0 ? "later" : dd < 0 ? "shorter" : "longer"}.`); return; }
      commit(next, moveMessage(pick, model, next), { task: pick, animate: true });
    },
    apply: () => {
      const kind = decide(model, modelA).kind;
      setDecision(decide(model, modelA));
      setApplied(model); setHistory([]); setTouched([]); setActed(true);
      setPhase("applied");
      setProposalOpen(false);
      setShared(false);
      setStatus(kind === "proposal" ? "Applied Keating’s plan." : kind === "tweaked" ? "Applied Keating’s plan with your changes." : "Applied your changes.");
      if (reduced) setRemount(x => x + 1);
      onChange?.();
    },
    tweak: () => {
      setPhase("tweaking"); setActed(true);
      setStatus("Tweaking Keating’s plan. Drag a bar to move it or its ends to resize it, then apply.");
      onChange?.();
    },
    dismiss: () => {
      const fromProposal = phase === "proposal" || phase === "tweaking";
      if (fromProposal) { setDismissed(true); setProposalOpen(false); }
      setModel(applied); setPreview(undefined); setLastEdit(undefined); setHistory([]); setTouched([]); setActed(true);
      setPhase(decision ? "applied" : "editing");
      setStatus(fromProposal ? "Dismissed Keating’s suggestion. Your plan is as it was." : "Discarded your changes.");
      if (reduced) setRemount(x => x + 1);
      onChange?.();
    },
    reset: () => {
      setApplied(r.base); setModel(proposed ?? r.base); setPhase(r.proposal ? "proposal" : "editing"); setProposalOpen(!!r.proposal);
      setDismissed(false); setDecision(undefined); setLastEdit(undefined); setShared(false); setPreview(undefined);
      setHistory([]); setTouched([]); setActed(false); setHint("");
      setStatus("Started over."); setRemount(x => x + 1); onChange?.();
    },
    undo: () => {
      const last = history[history.length - 1]; if (!last) return;
      setHistory(history.slice(0, -1)); setModel(last.model); setTouched(last.touched); setPhase(last.phase);
      setPreview(undefined); setLastEdit(undefined); setShared(false); setHint("");
      setStatus(`Undid the last change. ${plural(analyse(r, last.model).conflicts.length, "conflict")}.`);
      if (reduced) setRemount(x => x + 1);
      onChange?.();
    },
  };
  /** Describe a plan relative to what the learner started from: own moves, pushes, and what Keating proposed. */
  function decide(plan: Plan, a: Analysis): Decision {
    const kind: Decision["kind"] = phase === "proposal" ? "proposal" : phase === "tweaking" ? "tweaked" : "own";
    const ref = kind === "tweaked" && proposed ? proposed : applied;
    const diff = kind === "proposal" ? [] : changesBetween(r, ref, plan);
    return {
      kind, changes: changesBetween(r, applied, plan), own: diff.filter(c => touched.includes(c.task)), pushed: diff.filter(c => !touched.includes(c.task)),
      analysis: a, plan, dismissed,
    };
  }

  /* ---------- Test / tooling hook ---------- */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingPlan?: unknown };
    host.keatingPlan = Object.freeze({
      snapshot: () => {
        const byId = (xs: number[]) => Object.fromEntries(r.ids.map((id, i) => [id, xs[i]]));
        return {
          phase, draft: byId(model.s), draftDur: byId(model.d), applied: byId(applied.s), appliedDur: byId(applied.d),
          conflicts: modelA.conflicts.map(c => c.kind), conflictText: modelA.conflicts.map(c => conflictText(r, c)),
          notes: modelA.notes.map(n => n.kind), critical: r.ids.filter((_, i) => modelA.critical[i]), slack: byId(modelA.slack), load: modelA.load,
          deps: Object.fromEntries(r.ids.map((id, i) => [id, r.preds[i].map(q => r.ids[q])])), hint, share: share ?? null,
          decision: decision?.kind, float: byId(modelA.float), chains: criticalData(r, modelA), criticalText: criticalText(r, modelA),
          viewCritical: r.ids.filter((_, i) => A.critical[i]), viewSlack: byId(A.slack), viewConflicts: A.conflicts.map(c => c.kind),
          criticalEdges: [...modelA.crit.edges].map(e => e.split("-").map(Number).map(i => r.ids[i]).join(">")),
        };
      },
      handles: () => {
        const svg = wrap.current?.querySelector("svg")?.getBoundingClientRect(); if (!svg) return null;
        const e = effective(r, model);
        const bar: Record<string, unknown> = {};
        r.ids.forEach((id, i) => {
          const x = svg.left + xAt(e.s[i]) + 1, w = e.d[i] * g.dayW - 2, y = svg.top + midY(i);
          bar[id] = { x: x + w / 2, y, left: x + 2.5, right: x + w - 2.5, x0: x, w };
        });
        return { bar, dayW: g.dayW, dayX: Array.from({ length: r.H + 1 }, (_, k) => svg.left + xAt(k)), svgTop: svg.top };
      },
    });
    return () => { delete host.keatingPlan; };
  });

  /* ---------- Copy ---------- */
  const T = (i: number) => r.titles[i];
  /** Advice for a conflict: name what can move. Never repeats the conflict sentence it follows. */
  const advise = (c: Conflict, a: Analysis): string => {
    if (c.kind === "capacity") {
      const on = r.ids.map((_, i) => i).filter(i => a.s[i] <= c.day && c.day < a.s[i] + a.d[i]);
      const movable = on.filter(i => !r.fixed[i] && a.slack[i] >= 1);
      return movable.length
        ? `${listJoin(on.map(T))} share it. ${T(movable[0])} has ${plural(a.slack[movable[0]], "day")} of slack, so it can move.`
        : `${listJoin(on.map(T))} share it, and none can move later without another clash. Shorten one or move something earlier.`;
    }
    if (c.kind === "order") return r.fixed[c.task] ? `It has to finish by ${dayName(r, a.s[c.task] - 1)}: shorten it or start something before it earlier.` : `Move ${T(c.task)} later or ${T(c.pred)} earlier.`;
    if (c.kind === "blocked") return `Move it off ${dayName(r, c.day)}.`;
    return `It has to finish by ${dayName(r, (r.deadline ?? r.H) - 1)}.`;
  };
  const pushRule = r.blocked ? ` Pushed tasks skip ${dayName(r, r.blocked.day)}; a push that overloads a day turns it amber rather than moving anything else.` : "";

  let instruction = ""; let tone: "plain" | "good" | "warn" = "plain";
  const cs = A.conflicts, ns = A.notes;
  const critLine = criticalText(r, A);
  const before = lastEdit && !dragging ? analyse(r, lastEdit.before) : undefined;
  const fresh = before ? cs.filter(c => !before.conflicts.some(b => conflictKey(b) === conflictKey(c))) : [];
  if (hint && !dragging) {
    instruction = hint; tone = "plain";
  } else if (phase === "proposal") {
    const fixedCount = appliedA.conflicts.length;
    instruction = `Your current plan has ${plural(fixedCount, "conflict")}. Keating’s suggestion is drawn over it: dashed outlines are where things are now, arrows show each move. ${cs.length ? `It still leaves ${plural(cs.length, "conflict")}.` : "It leaves no conflicts."} Apply it, tweak it by dragging, or dismiss it.`;
    tone = "plain";
  } else if (cs.length) {
    const lead = fresh[0] ?? cs[0];
    const pushedNow = lastEdit ? changesBetween(r, lastEdit.before, lastEdit.after).filter(c => c.task !== lastEdit.task).map(c => c.task) : [];
    const verb = lastEdit && lastEdit.before.d[lastEdit.task] !== lastEdit.after.d[lastEdit.task] && lastEdit.before.s[lastEdit.task] === lastEdit.after.s[lastEdit.task] ? "Stretching" : "Moving";
    const cause = lastEdit && fresh.length && pushedNow.length ? `${verb} ${T(lastEdit.task)} pushed ${listJoin(pushedNow.map(T))} along. ` : "";
    instruction = `${cause}${conflictText(r, lead)} ${advise(lead, A)}${cs.length > 1 ? ` (${plural(cs.length - 1, "more conflict")} below.)` : ""}`;
    tone = "warn";
  } else if (draftDiffers) {
    instruction = `No conflicts. ${critLine}${ns.length ? ` ${noteText(r, ns[0])}` : " Apply when you are happy."}`;
    tone = ns.length ? "plain" : "good";
  } else if (phase === "applied") {
    instruction = `Applied. ${critLine} Drag again to try something else.`;
    tone = "good";
  } else {
    instruction = `Drag a bar to move a task; drag its ends to change its length. Later tasks get pushed along, and nothing changes until you apply.${pushRule}${ns.length ? ` ${noteText(r, ns[0])}` : ""}`;
  }

  /* Live readout while dragging. */
  let dragLine = "";
  if (dragging && preview && preview.push >= 0) {
    const i = preview.push;
    const settled = settle(r, preview);
    const pushedN = changesBetween(r, model, settled).filter(c => c.task !== i).length;
    const pa = analyse(r, settled);
    const span = settled.d[i] === 1 ? dayName(r, settled.s[i]) : `${dayName(r, settled.s[i])}–${dayName(r, settled.s[i] + settled.d[i] - 1)}`;
    dragLine = `${T(i)} → ${span}${pushedN ? ` · pushes ${pushedN}` : ""} · ${pa.conflicts.length ? plural(pa.conflicts.length, "conflict") : "no conflicts"}`;
  }

  /* ---------- Share ---------- */
  /* Available once the learner has done anything. An applied plan shares the decision; otherwise the draft as it stands. */
  const isDraft = !(decision && phase === "applied" && !draftDiffers);
  const shareFrom: Decision | undefined = !acted ? undefined : isDraft ? decide(model, modelA) : decision;
  let share: ShareSummary | undefined;
  if (shareFrom) {
    const da = shareFrom.analysis;
    const conf = da.conflicts.map(c => conflictText(r, c));
    const own = texts(shareFrom.own), pushed = texts(shareFrom.pushed);
    const pushTail = pushed.length ? ` That pushed ${listSome(pushed)} along.` : "";
    let learner = "";
    if (isDraft) {
      if (shareFrom.kind === "proposal") learner = "I’m looking at your suggestion and haven’t applied it yet.";
      else if (shareFrom.kind === "tweaked") learner = own.length ? `I’m tweaking your suggestion, not applied yet. ${plural(own.length, "change")} of mine: ${listSome(own)}.${pushTail}` : "I’m tweaking your suggestion but haven’t changed anything yet.";
      else learner = own.length
        ? `${shareFrom.dismissed ? "I dismissed your suggestion. " : ""}I’m trying ${plural(own.length, "change")}, not applied yet: ${listSome(own)}.${pushTail}`
        : shareFrom.dismissed ? "I dismissed your suggestion and kept my plan as it was." : "I haven’t changed my plan.";
    } else if (shareFrom.kind === "proposal") learner = "I applied your plan as it was.";
    else if (shareFrom.kind === "tweaked") learner = own.length ? `I applied your plan with ${plural(own.length, "change")} of mine: ${listSome(own)}.${pushTail}` : `I applied your plan.${pushTail}`;
    else learner = `${shareFrom.dismissed ? "I dismissed your suggestion and changed it myself" : "I changed my plan"}: ${listSome(own.length ? own : texts(shareFrom.changes))}.${own.length ? pushTail : ""}`;
    if (conf.length) learner += ` It still has ${plural(conf.length, "conflict")}.`;
    const parts: string[] = [];
    if (conf.length) {
      parts.push(`One thing to fix before you rely on it. ${conf[0]}`);
      parts.push(advise(da.conflicts[0], da));
    } else {
      parts.push(shareFrom.kind === "tweaked" && own.length ? "Your change still works: no day goes over and every prerequisite comes first." : "That plan holds: no day goes over and every prerequisite comes first.");
      if (r.blocked) parts.push(`Nothing sits on ${dayName(r, r.blocked.day)}.`);
    }
    const ct = criticalText(r, da);
    if (ct) parts.push(da.crit.float > 0 ? ct : `${ct} A slip anywhere on it moves the ${r.kinds.includes("exam") ? "exam prep" : "finish"}, so protect it first.`);
    parts.push(giveText(r, shareFrom.plan, da));
    const bunched = da.notes.find(x => x.kind === "bunched"), eve = da.notes.find(x => x.kind === "eve" || x.kind === "eveTaken");
    if (bunched) parts.push(noteText(r, bunched));
    if (eve) parts.push(noteText(r, eve));
    if (!bunched && !eve && r.kinds.includes("review")) parts.push(spacingText(r, shareFrom.plan));
    if (isDraft && (shareFrom.kind !== "proposal" || draftDiffers)) parts.push(conf.length ? "Nothing is applied yet, so fix that first and then apply." : "Nothing is applied yet; apply it when you are happy.");
    share = {
      learner,
      data: `state=${isDraft ? "draft" : "applied"}; decision=${shareFrom.kind}${shareFrom.dismissed ? " (suggestion dismissed)" : ""}; own=[${own.join("; ")}]; pushed=[${pushed.join("; ")}]; changes=[${texts(shareFrom.changes).join("; ")}]; conflicts=${conf.length ? conf.join(" | ") : "none"}; critical=[${criticalData(r, da).join(" | ")}]; notes=${da.notes.map(x => x.kind).join(",") || "none"}`,
      reply: parts.join(" "),
    };
  }

  const pending = changesBetween(r, applied, model);
  const countText = phase === "proposal" ? "Keating’s suggestion" : phase === "applied" && !draftDiffers ? "Applied" : draftDiffers ? `Draft · ${plural(pending.length, "task")} changed, not applied` : "Your plan";
  const proposalShown = proposalOpen && (phase === "proposal" || phase === "tweaking") && r.proposal;
  const movable = r.ids.map((_, i) => i).filter(i => !r.fixed[i]);
  const movedByProposal = new Set(r.proposal?.moves.map(m => m.task) ?? []);
  const pushedByProposal = proposed ? texts(changesBetween(r, r.base, proposed).filter(c => !movedByProposal.has(c.task))) : [];
  const KINDS_SHOWN: TaskKind[] = (["study", "review", "practice", "exam", "fixed"] as TaskKind[]).filter(k => r.kinds.includes(k));
  /** Pressing a bar that cannot move says why, instead of doing nothing. */
  const onPointerDown = (ev: { target: EventTarget }) => {
    const m = /-b(\d+)$/.exec((ev.target as Element).id ?? "");
    if (!m) return;
    const i = Number(m[1]);
    if (!r.fixed[i]) return;
    const why = r.locked[i] ? `${T(i)} has already started, so it stays where it is.` : `${T(i)} is fixed on ${dayName(r, model.s[i])} and cannot move. Move what comes before it instead.`;
    setHint(why); setStatus(why);
  };

  return <section className="activity plan-tl" data-simulation="plan-timeline" aria-labelledby={`pt${uid}-title`}>
    <div className="pt-header">
      <h3 id={`pt${uid}-title`}>{r.title}</h3>
      <span className={`pt-count${draftDiffers ? " is-draft" : ""}`}>{countText}</span>
    </div>
    {proposalShown && <div className="pt-proposal" aria-label="Keating’s suggestion">
      <p className="pt-rationale"><span className="pt-by">Keating suggests</span> {r.proposal!.rationale}</p>
    </div>}
    <div className={`pt-canvas${dragging ? " is-dragging" : ""}`} ref={wrap} aria-hidden="true" onPointerDown={onPointerDown}>
      <DraggableRenderer key={remount} draggable={draggable} state={model} width={g.W} height={g.H}
        onDropState={onDrop}
        onDragState={s => setPreview(s)}
        onDragStatus={st => { const on = st.type === "dragging"; draggingRef.current = on; setDragging(x => (x === on ? x : on)); if (!on) setPreview(p => (p ? undefined : p)); }} />
      <p className="pt-dragline pt-readout">{dragLine}</p>
    </div>
    <div className="pt-legend" aria-hidden="true">
      {KINDS_SHOWN.map(k => <span key={k} className={`pt-key pt-k-${k}`}><i className="pt-key-bar" />{r.kindNames[k]}</span>)}
      <span className="pt-key"><i className="pt-key-crit" />critical path</span>
      <span className="pt-key"><i className="pt-key-slack" />slack</span>
      <span className="pt-key"><i className="pt-key-ghost" />{phase === "proposal" || phase === "tweaking" ? "now" : "applied"}</span>
      <span className="pt-key"><i className="pt-key-cap" />{hoursText(r.cap)} a day</span>
    </div>
    {proposalShown && <details className="receipt pt-why">
      <summary>{`The ${plural(r.proposal!.moves.length, "move")}${pushedByProposal.length ? ` and ${plural(pushedByProposal.length, "push", "pushes")}` : ""}, and why`}</summary>
      <ul className="pt-moves" aria-label="Suggested moves">
      {r.proposal!.moves.map((m, k) => {
        const i = m.task;
        const only = (xs: number[], ys: number[]) => xs.map((x, j) => (j === i ? ys[i] : x));
        const now = changesBetween(r, r.base, { ...r.base, s: only(r.base.s, proposed!.s), d: only(r.base.d, proposed!.d), h: only(r.base.h, proposed!.h) })[0]?.text ?? r.titles[i];
        return <li key={k} className="pt-move-row"><span className="pt-move-what">{now}</span>{m.why && <span className="pt-move-why">{m.why}</span>}</li>;
      })}
      {pushedByProposal.length > 0 && <li className="pt-move-row is-pushed"><span className="pt-move-why">Pushed along: {listJoin(pushedByProposal)}</span></li>}
      </ul>
    </details>}
    {(cs.length > 0 || ns.length > 0) && <ul className="pt-issues" aria-label="Conflicts">
      {cs.map((c, k) => <li key={`c${k}`} className="pt-issue is-conflict">{conflictText(r, c)}</li>)}
      {ns.map((x, k) => <li key={`n${k}`} className="pt-issue is-note">{noteText(r, x)}</li>)}
    </ul>}
    <p className={`pt-instruction is-${tone}`} aria-live="polite">{instruction}</p>
    <details className="receipt pt-controls">
      <summary>Use buttons instead</summary>
      <div className="pt-control-row">
        <label className="pt-select">Task
          <select aria-label="Task" value={pick} onChange={e => setPick(Number(e.currentTarget.value))}>
            {movable.map(i => <option key={i} value={i}>{r.titles[i]}</option>)}
          </select>
        </label>
        <button type="button" className="pt-chip-btn" onClick={() => actions.nudge(-1, 0)}>A day earlier</button>
        <button type="button" className="pt-chip-btn" onClick={() => actions.nudge(1, 0)}>A day later</button>
        <button type="button" className="pt-chip-btn" onClick={() => actions.nudge(0, -1)}>Shorter</button>
        <button type="button" className="pt-chip-btn" onClick={() => actions.nudge(0, 1)}>Longer</button>
      </div>
    </details>
    <span className="learning-lab__sr-only pt-sr" role="status">{status}</span>
    <div className="actions pt-actions">
      {draftDiffers && <button type="button" className="primary" onClick={actions.apply}>
        {phase === "proposal" ? "Apply" : phase === "tweaking" ? "Apply with my changes" : "Apply changes"}{modelA.conflicts.length && phase !== "proposal" ? ` (${plural(modelA.conflicts.length, "conflict")})` : ""}
      </button>}
      {phase === "proposal" && <button type="button" className="quiet" onClick={actions.tweak}>Tweak</button>}
      {(phase === "proposal" || phase === "tweaking") && <button type="button" className="quiet" onClick={actions.dismiss}>Dismiss</button>}
      {phase === "editing" && draftDiffers && <button type="button" className="quiet" onClick={actions.dismiss}>Discard changes</button>}
      {history.length > 0 && <button type="button" className="quiet" onClick={actions.undo}>Undo</button>}
      {share && <button type="button" className={`${draftDiffers ? "quiet" : "primary"} pt-share`} disabled={shared} onClick={() => { setShared(true); onShare?.(share!); }}>{shared ? "Shared" : "Share with Keating"}</button>}
      {acted && <button type="button" className="quiet" onClick={actions.reset}>Start over</button>}
    </div>
  </section>;
}

/* ---------- Presets ---------- */
export const presets: Record<string, PlanTimelineConfig> = {
  lostWednesday: {
    title: "Biology exam plan",
    startDate: "2026-11-23",
    today: "2026-11-24",
    horizon: 12,
    capacityPerDay: 3,
    disruption: { day: "2026-11-25", label: "shift" },
    tasks: [
      { id: "cells", title: "Cell biology notes", kind: "study", start: 0, duration: 2, hours: 2 },
      { id: "cellsR1", title: "Review cells", kind: "review", start: 2, duration: 1, hours: 1, dependsOn: ["cells"] },
      { id: "gen", title: "Genetics notes", kind: "study", start: 2, duration: 2, hours: 2 },
      { id: "genP", title: "Genetics problems", kind: "practice", start: 4, duration: 1, hours: 2, dependsOn: ["gen"] },
      { id: "eco", title: "Ecology notes", kind: "study", start: 5, duration: 2, hours: 2 },
      { id: "cellsR2", title: "Review cells again", kind: "review", start: 6, duration: 1, hours: 1, dependsOn: ["cellsR1"] },
      { id: "genR", title: "Review genetics", kind: "review", start: 7, duration: 1, hours: 1, dependsOn: ["genP"] },
      { id: "paper", title: "Past paper", kind: "practice", start: 8, duration: 1, hours: 3, dependsOn: ["cellsR2", "genR", "eco"] },
      { id: "fix", title: "Go over mistakes", kind: "practice", start: 9, duration: 1, hours: 2, dependsOn: ["paper"] },
      { id: "light", title: "Light review", kind: "review", start: 10, duration: 1, hours: 1, dependsOn: ["fix"] },
      { id: "exam", title: "Biology exam", kind: "exam", start: 11, duration: 1, hours: 2, dependsOn: ["light"] },
    ],
    proposal: {
      rationale: "Wednesday’s two sessions move to Thursday. Genetics problems and ecology each slide a day so no day goes over 3 hours. The past paper, the light day before the exam and the exam itself stay where they are.",
      moves: [
        { task: "gen", start: 3, why: "Thu–Fri instead of Wed–Thu" },
        { task: "cellsR1", start: 3, why: "a day’s gap after the notes still works" },
        { task: "eco", start: 6, why: "Saturday would be 4h once genetics problems land there" },
      ],
    },
  },
  spacedTest: {
    title: "Statistics test: spaced reviews",
    horizon: 14,
    capacityPerDay: 2,
    tasks: [
      { id: "l1", title: "Learn hypothesis tests", kind: "study", start: 0, duration: 2, hours: 2 },
      { id: "l2", title: "Learn regression", kind: "study", start: 2, duration: 2, hours: 1 },
      { id: "r1", title: "Review tests (+1 day)", kind: "review", start: 3, duration: 1, hours: 1, dependsOn: ["l1"] },
      { id: "q1", title: "Regression problems", kind: "practice", start: 4, duration: 2, hours: 1.5, dependsOn: ["l2"] },
      { id: "r2", title: "Review tests (+3 days)", kind: "review", start: 7, duration: 1, hours: 1, dependsOn: ["r1"] },
      { id: "r3", title: "Review regression", kind: "review", start: 8, duration: 1, hours: 1, dependsOn: ["q1"] },
      { id: "mock", title: "Mock test", kind: "practice", start: 10, duration: 1, hours: 2, dependsOn: ["r2", "r3"] },
      { id: "r4", title: "Review mistakes", kind: "review", start: 11, duration: 1, hours: 1, dependsOn: ["mock"] },
      { id: "test", title: "Statistics test", kind: "exam", start: 13, duration: 1, hours: 1.5, dependsOn: ["r4"] },
    ],
  },
  groupPoster: {
    title: "Group poster: four people, one deadline",
    startDate: "2026-03-02",
    horizon: 15,
    capacityPerDay: 8,
    deadline: 14,
    deadlineLabel: "poster due",
    kindNames: { study: "research", practice: "making", fixed: "booked" },
    tasks: [
      { id: "q", title: "Agree the question", kind: "study", start: 0, duration: 1, hours: 4 },
      { id: "lit", title: "Background reading", kind: "study", start: 1, duration: 3, hours: 3, dependsOn: ["q"] },
      { id: "survey", title: "Run the survey", kind: "practice", start: 1, duration: 4, hours: 3, dependsOn: ["q"] },
      { id: "analyse", title: "Analyse results", kind: "practice", start: 5, duration: 2, hours: 6, dependsOn: ["survey"] },
      { id: "draft", title: "Draft the poster", kind: "practice", start: 7, duration: 3, hours: 6, dependsOn: ["lit", "analyse"] },
      { id: "tutor", title: "Tutor feedback", kind: "fixed", start: 10, duration: 1, hours: 1, dependsOn: ["draft"] },
      { id: "revise", title: "Revise poster", kind: "practice", start: 11, duration: 1, hours: 6, dependsOn: ["tutor"] },
      { id: "print", title: "Print slot", kind: "fixed", start: 12, duration: 1, hours: 1, dependsOn: ["revise"] },
    ],
  },
};

export const scenario = {
  tab: "Plan",
  prompt: "I lost Wednesday to a shift. Can you move my study plan?",
  intro: "Yes. Two sessions were on Wednesday, and moving them pushes a couple of things later, so here is the whole week with my suggestion drawn over it. The dashed outlines are your plan now; the bars are where I would put things. Nothing changes until you apply it, and you can drag anything first.",
  receiptLabel: "Plan change review",
  receiptText: "The learner lost a day. Keating proposed moves on the learner’s own timeline; the learner can apply, tweak by dragging or dismiss, and the timeline checks prerequisites, daily hours and the exam date.",
  preset: "lostWednesday",
};

/** Per-preset chat framing (the catalogue and harness import this). */
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  lostWednesday: { label: scenario.tab, prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  spacedTest: {
    label: "Spaced reviews",
    prompt: "I want to start regression a few days later. Is that OK before my stats test?",
    intro: "Maybe. Regression problems feed a review, the mock test and the review of its mistakes, and the test date does not move. Drag “Learn regression” to where you would start it and watch what gets pushed toward the test.",
    receiptLabel: "Plan change review", receiptText: "The learner asked whether delaying a topic is safe. The timeline pushes dependent reviews along and flags when they crowd or pass the test date.",
  },
  groupPoster: {
    label: "Group project",
    prompt: "Our survey is running late. Does that wreck the poster deadline?",
    intro: "It depends on whether the survey is on the critical path. It is: the underline marks survey → analysis → draft → feedback. Stretch the survey by its right end and see what the fixed tutor meeting and print slot do.",
    receiptLabel: "Project schedule review", receiptText: "The learner asked whether a slipping task threatens a deadline. The timeline shows the critical path, slack and the fixed meetings that cannot move.",
  },
};
