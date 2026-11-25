import { useMemo, useState } from "react";
import type { DagConfig, ShareSummary } from "./config";
import { diagnose, edgeKey, makesCycle, rolesOf, type DagDiagnosis, type Edge, type Graph, type PathInfo } from "./model";
import { Shell, listWords, plural, textWidth, useHistory, useSvgDrag, useWidth, type Tone } from "./shared";

type DagState = { edges: Edge[]; adjusted: string[]; last?: { kind: "add" | "remove" | "reverse" | "adjust" | "unadjust"; from: string; to?: string } };
type Payload = { kind: "node" | "chip"; id: string };
type EdgeAct = { from: string; to: string };
type Action =
  | { kind: "add" | "remove" | "reverse"; from: string; to: string; next: DagState }
  | { kind: "adjust" | "unadjust"; id: string; next: DagState }
  | { kind: "refuse"; why: string }
  | { kind: "none"; why: string };

export function DagLab({ config, onChange, onShare }: { config: DagConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const X = config.exposure, Y = config.outcome;
  const byId = useMemo(() => Object.fromEntries(config.variables.map(v => [v.id, v])), [config]);
  const L = (id: string) => byId[id]?.label ?? id;
  const measured = useMemo(() => config.variables.filter(v => v.measured !== false).map(v => v.id), [config]);
  const story = useMemo(() => config.edges.map(e => ({ from: e.from, to: e.to })), [config]);
  const whyOf = (a: string, b: string) => config.edges.find(e => e.from === a && e.to === b)?.why;
  const start = (): DagState => ({ edges: (config.drawn ?? story).map(e => ({ ...e })), adjusted: [...(config.adjusted ?? [])] });
  const h = useHistory(start);
  const s = h.state;
  const graphOf = (st: DagState): Graph => ({ nodes: config.variables.map(v => v.id), edges: st.edges });
  const diag = useMemo(() => diagnose(graphOf(s), X, Y, new Set(s.adjusted), measured), [s, measured]);
  const storyDiag = useMemo(() => diagnose({ nodes: config.variables.map(v => v.id), edges: story }, X, Y, new Set(), measured), [story, measured]);
  const building = config.drawn !== undefined;
  const has = (st: DagState, a: string, b: string) => st.edges.some(e => e.from === a && e.to === b);
  const missing = story.filter(e => !has(s, e.from, e.to));
  const extra = s.edges.filter(e => !story.some(t => t.from === e.from && t.to === e.to));

  /* ---------- geometry ---------- */
  const { ref, width: W } = useWidth();
  const compact = W < 470;
  const GH = compact ? 290 : 258, ZONE = 60, H = GH + ZONE + (compact ? 30 : 24);
  const geo = useMemo(() => {
    const fs = compact ? 11.5 : 12.5;
    return Object.fromEntries(config.variables.map(v => {
      const words = v.label.split(" ");
      const lines = compact && v.label.length > 11 && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [v.label];
      const w = Math.max(56, Math.max(...lines.map(l => textWidth(l, fs))) + 22), hh = lines.length * 14 + 14;
      const cx = w / 2 + 6 + v.x * (W - w - 12), cy = 14 + hh / 2 + v.y * (GH - 44 - hh);
      return [v.id, { cx, cy, w, h: hh, lines, fs }];
    }));
  }, [config, W, compact]);
  type G = (typeof geo)[string];
  const hitNode = (x: number, y: number, except?: string) => config.variables.find(v => {
    if (v.id === except) return false; const g = geo[v.id]; return Math.abs(x - g.cx) < g.w / 2 + 10 && Math.abs(y - g.cy) < g.h / 2 + 10;
  })?.id;
  const rim = (g: G, toward: { x: number; y: number }, pad: number) => {
    const dx = toward.x - g.cx, dy = toward.y - g.cy;
    if (!dx && !dy) return { x: g.cx, y: g.cy };
    const t = Math.min((g.w / 2 + pad) / Math.abs(dx || 1e-9), (g.h / 2 + pad) / Math.abs(dy || 1e-9));
    return { x: g.cx + dx * t, y: g.cy + dy * t };
  };

  /* ---------- moves ---------- */
  const chipX = (i: number) => 14 + i * (compact ? 98 : 120);
  const zoneChips = s.adjusted;
  const actionFor = (p: Payload, x: number, y: number): Action => {
    if (p.kind === "chip") {
      if (y < GH) return { kind: "unadjust", id: p.id, next: { edges: s.edges, adjusted: s.adjusted.filter(a => a !== p.id), last: { kind: "unadjust", from: p.id } } };
      return { kind: "none", why: `Drag ${L(p.id)} out of the zone to stop adjusting for it` };
    }
    const a = p.id;
    if (y >= GH) {
      if (a === X || a === Y) return { kind: "refuse", why: `${L(a)} is the ${a === X ? "exposure" : "outcome"}; you can't adjust for it` };
      if (!measured.includes(a)) return { kind: "refuse", why: `${L(a)} wasn't measured, so the paper can't adjust for it` };
      if (s.adjusted.includes(a)) return { kind: "none", why: `Already adjusting for ${L(a)}` };
      return { kind: "adjust", id: a, next: { edges: s.edges, adjusted: [...s.adjusted, a], last: { kind: "adjust", from: a } } };
    }
    const b = hitNode(x, y, a);
    if (!b) return { kind: "none", why: "Drop on another variable to draw an arrow, or in Adjusted for" };
    const g = graphOf(s);
    if (has(s, a, b)) return { kind: "remove", from: a, to: b, next: { edges: s.edges.filter(e => !(e.from === a && e.to === b)), adjusted: s.adjusted, last: { kind: "remove", from: a, to: b } } };
    if (has(s, b, a)) {
      const without = { nodes: g.nodes, edges: s.edges.filter(e => !(e.from === b && e.to === a)) };
      if (makesCycle(without, a, b)) return { kind: "refuse", why: `Reversing it would make a loop: ${L(a)} would cause itself` };
      return { kind: "reverse", from: a, to: b, next: { edges: [...without.edges, { from: a, to: b }], adjusted: s.adjusted, last: { kind: "reverse", from: a, to: b } } };
    }
    if (makesCycle(g, a, b)) return { kind: "refuse", why: `${L(a)} → ${L(b)} would make a loop: ${L(b)} already leads to ${L(a)}` };
    return { kind: "add", from: a, to: b, next: { edges: [...s.edges, { from: a, to: b }], adjusted: s.adjusted, last: { kind: "add", from: a, to: b } } };
  };
  const [status, setStatus] = useState("");
  const apply = (act: Action) => {
    if (!("next" in act)) { if (act.kind === "refuse") setStatus(act.why + "."); return; }
    h.commit(act.next); onChange?.();
    setStatus(act.kind === "adjust" ? `Adjusting for ${L(act.id)}.` : act.kind === "unadjust" ? `No longer adjusting for ${L(act.id)}.`
      : act.kind === "remove" ? `Removed ${L((act as EdgeAct).from)} → ${L((act as EdgeAct).to)}.` : act.kind === "reverse" ? `Reversed: now ${L((act as EdgeAct).from)} → ${L((act as EdgeAct).to)}.` : `Drew ${L((act as EdgeAct).from)} → ${L((act as EdgeAct).to)}.`);
  };
  const { svgRef, drag, begin, handlers } = useSvgDrag<Payload>(d => { if (d.moved) apply(actionFor(d.payload, d.x, d.y)); });
  const act = drag && drag.moved ? actionFor(drag.payload, drag.x, drag.y) : null;
  const shown: DagState = act && "next" in act ? act.next : s;
  const shownDiag = useMemo(() => (shown === s ? diag : diagnose(graphOf(shown), X, Y, new Set(shown.adjusted), measured)), [shown, s, diag, measured]);

  /* ---------- words ---------- */
  const pathText = (p: PathInfo) => p.nodes.map((n, i) => (i === 0 ? L(n) : `${p.steps[i - 1].forward ? "→" : "←"} ${L(n)}`)).join(" ");
  const setText = (xs: string[]) => (xs.length ? listWords(xs.map(L)) : "nothing");
  const minText = (sets: string[][]) => sets.length === 0 ? "none exists among the measured variables"
    : sets.map(m => (m.length ? `{${m.map(L).join(", ")}}` : "{ } (no adjustment needed)")).join(" or ");
  const consequence = (before: DagDiagnosis, after: DagDiagnosis) => {
    const keyOf = (p: PathInfo) => p.nodes.join(">");
    const openNon = (d: DagDiagnosis) => [...d.openBackdoor, ...d.collideredBackdoor, ...d.openedNoncausal];
    const was = new Set(openNon(before).map(keyOf)), now = new Set(openNon(after).map(keyOf));
    const um = (p: PathInfo) => (p.nodes.some(n => !measured.includes(n)) ? 0 : 1);
    const byLen = (a: PathInfo, b: PathInfo) => a.nodes.length - b.nodes.length || um(a) - um(b);
    const opened = openNon(after).filter(p => !was.has(keyOf(p))).sort(byLen), closed = openNon(before).filter(p => !now.has(keyOf(p))).sort(byLen);
    const blk = after.blockedCausal.filter(p => !before.blockedCausal.some(q => keyOf(q) === keyOf(p)));
    const unblk = before.blockedCausal.filter(p => !after.blockedCausal.some(q => keyOf(q) === keyOf(p)) && after.paths.some(q => keyOf(q) === keyOf(p)));
    const bits: string[] = [];
    if (closed.length) bits.push(`closes ${pathText(closed[0])}${closed.length > 1 ? ` (+${closed.length - 1} more)` : ""}`);
    if (opened.length) bits.push(`opens ${pathText(opened[0])}${opened[0].openedBy.length ? " (collider bias)" : ""}${opened.length > 1 ? ` (+${opened.length - 1} more)` : ""}`);
    if (blk.length) bits.push(`blocks ${pathText(blk[0])}, part of the effect`);
    if (unblk.length) bits.push(`restores ${pathText(unblk[0])}`);
    if (after.ok && !before.ok) bits.push("now sufficient");
    return bits.length ? `: ${bits.join("; ")}` : ": no path changes";
  };
  const dragLine = (() => {
    if (!act) return "";
    if (act.kind === "none" || act.kind === "refuse") return act.why;
    const c = consequence(diag, shownDiag);
    if (act.kind === "adjust") return `Drop to adjust for ${L(act.id)}${c}`;
    if (act.kind === "unadjust") return `Drop to stop adjusting for ${L(act.id)}${c}`;
    if (act.kind === "remove") return `Drop to erase ${L(act.from)} → ${L(act.to)}${c}`;
    if (act.kind === "reverse") return `Drop to reverse it: ${L(act.from)} → ${L(act.to)}${c}`;
    return `Drop to draw ${L((act as EdgeAct).from)} → ${L((act as EdgeAct).to)}${c}`;
  })();

  const diagnosisLine = (d: DagDiagnosis, adjusted: string[]): { text: string; tone: Tone } => {
    const blocked = d.blockedCausal[0];
    const collider = [...d.openedNoncausal, ...d.collideredBackdoor].sort((p, q) => p.nodes.length - q.nodes.length)[0];
    const conf = d.openBackdoor[0];
    const parts: string[] = []; let tone: Tone = "good";
    if (blocked) { tone = "warn"; parts.push(`Adjusting for ${setText(blocked.blockedBy)} blocks ${pathText(blocked)}: that is part of ${L(X)}'s effect, so the estimate loses it (overadjustment).`); }
    if (collider) {
      tone = "warn";
      const by = collider.openedBy[0];
      const viaDesc = !adjusted.includes(by) ? ` (through its descendant ${setText(adjusted.filter(a => a !== by))})` : "";
      parts.push(`Adjusting for ${L(by)}${viaDesc} opens ${pathText(collider)}. ${L(by)} is a common effect, and conditioning on it links its causes: collider bias.`);
    }
    if (conf) {
      tone = "warn";
      const fix = conf.nodes.slice(1, -1).filter(n => measured.includes(n) && !conf.colliders.includes(n));
      parts.push(`Confounding: ${pathText(conf)} is open, so part of the association runs through it. ${fix.length ? `Adjusting for ${listWords(fix.map(L), "or")} would close it.` : "Nothing on it was measured, so adjustment can't close it."}`);
    }
    if (d.descendantsAdjusted.length && !blocked && !collider) { tone = "warn"; parts.push(`${setText(d.descendantsAdjusted)} is caused by ${L(X)}; the backdoor criterion forbids adjusting for descendants of the exposure.`); }
    if (!parts.length) {
      const bd = d.paths.filter(p => p.kind === "backdoor");
      if (!bd.length) parts.push(`No backdoor paths in this diagram${adjusted.length ? "" : ", so the crude comparison already estimates the total effect, if the diagram is right"}.`);
      else parts.push(`Every backdoor path is closed and nothing causal is blocked: adjusting for ${setText(adjusted)} is sufficient under this diagram (backdoor criterion).`);
      const smaller = d.minimal.find(m => m.length < adjusted.length && m.every(v => adjusted.includes(v)));
      if (smaller && adjusted.length) parts.push(`${smaller.length ? setText(smaller) : "No adjustment"} alone would do.`);
    }
    return { text: parts.join(" "), tone };
  };
  const touched = h.moves > 0;
  const { text: diagText, tone: diagTone } = diagnosisLine(diag, s.adjusted);
  let instruction = diagText, tone: Tone = diagTone;
  const lastEdge = s.last && s.last.to ? { from: s.last.from, to: s.last.to } : null;
  if (building && !touched) {
    instruction = `Only the paper's arrow is drawn. Drag from a variable to whatever it affects; start with what might change both ${L(X)} and ${L(Y)}.`;
    tone = "neutral";
  } else if (lastEdge && (s.last!.kind === "add" || s.last!.kind === "reverse")) {
    const w = whyOf(lastEdge.from, lastEdge.to);
    const back = whyOf(lastEdge.to, lastEdge.from);
    const lead = w ? `Yes: ${w}` : back ? `This one is usually drawn the other way: ${back}` : `That arrow isn't in the usual story for this paper; the paths below now include it.`;
    instruction = `${lead} ${diagText}`;
  } else if (s.last?.kind === "remove" && whyOf(s.last.from, s.last.to!)) {
    instruction = `You erased an arrow the usual story keeps (${whyOf(s.last.from, s.last.to!)}). ${diagText}`;
  }
  /* Removing the study's own design restriction is a what-if on the graph: the study's data hold only the selected people. */
  if (s.last?.kind === "unadjust" && (config.adjusted ?? []).includes(s.last.from)) {
    instruction += ` That shows which paths would close in a population not selected on ${L(s.last.from)}, under this graph. It can't recover the people the study never included.`;
  }
  if (building && touched && missing.length && !diag.blockedCausal.length) {
    const hint = h.moves >= 3 ? ` Think about what else ${L(missing[0].to)} depends on.` : "";
    instruction += ` ${plural(missing.length, "arrow")} of the usual story still missing.${hint}`;
  }

  /* ---------- share ---------- */
  const unchanged = touched && sameState(s, start());
  const share: ShareSummary | undefined = touched ? (() => {
    const min = diag.minimal;
    const learner = unchanged
      ? `I tried some changes and ended back where the diagram started, adjusting for ${setText(s.adjusted)}.`
      : `I drew ${plural(s.edges.length, "arrow")}${building ? (missing.length ? ` (the usual story has ${missing.length} more)` : ", matching the usual story") : ""} and adjusted for ${setText(s.adjusted)}. Is that enough to remove the bias?`;
    const bits: string[] = [];
    if (diag.ok) bits.push(`Under your diagram, yes: adjusting for ${setText(s.adjusted)} closes every backdoor path without blocking ${L(X)}'s effect.`);
    else bits.push(`Not yet. ${diagText}`);
    bits.push(`The minimal sufficient adjustment set${min.length > 1 ? "s are" : " is"} ${minText(min)}.`);
    if (!min.length && diag.minimalAny.length) bits.push(`It would take measuring ${setText(diag.minimalAny[0].filter(v => !measured.includes(v)))}, which this study doesn't have.`);
    if (missing.length) {
      const sm = storyDiag.minimal;
      bits.push(`Your diagram leaves out ${listWords(missing.slice(0, 2).map(e => `${L(e.from)} → ${L(e.to)}`))}${missing.length > 2 ? ` and ${missing.length - 2} more` : ""}; with the usual story the minimal set is ${minText(sm)}. An adjustment is only as good as the diagram behind it.`);
    } else if (extra.length) bits.push(`You added ${listWords(extra.slice(0, 2).map(e => `${L(e.from)} → ${L(e.to)}`))}, which the usual story doesn't have; check that you can defend it.`);
    else bits.push("Even then, residual confounding remains if a confounder is measured crudely (a yes/no for smoking, say).");
    return {
      learner, reply: bits.join(" "),
      data: `dag · arrows ${s.edges.map(edgeKey).join(",")} · adjusted [${s.adjusted.join(",")}] · sufficient ${diag.ok ? "yes" : "no"} · minimal ${min.map(m => `[${m.join(",")}]`).join(" ") || "none"} · story missing ${missing.length} · ${h.moves} moves`,
    };
  })() : undefined;

  /* ---------- drawing ---------- */
  const [focus, setFocus] = useState<number | null>(null);
  /* Causal paths first, then open biasing paths (those through unmeasured variables first: adjustment can't close them), then closed ones. */
  const rank = (p: PathInfo) => (p.kind === "causal" ? 0 : p.open ? 1 : 2);
  const unm = (p: PathInfo) => (p.nodes.some(n => !measured.includes(n)) ? 0 : 1);
  const rows = [...shownDiag.paths].sort((p, q) => rank(p) - rank(q) || p.nodes.length - q.nodes.length || unm(p) - unm(q));
  const focusPath = focus !== null ? rows[focus] : undefined;
  const edgeTone = (e: Edge) => {
    const on = (ps: PathInfo[]) => ps.some(p => p.steps.some(st => (st.forward ? st.from === e.from && st.to === e.to : st.to === e.from && st.from === e.to)));
    if (on([...shownDiag.openBackdoor, ...shownDiag.collideredBackdoor, ...shownDiag.openedNoncausal])) return "is-bias";
    if (on(shownDiag.paths.filter(p => p.kind === "causal" && p.open))) return "is-causal";
    return "";
  };
  const inFocus = (e: Edge) => !!focusPath?.steps.some(st => (st.forward ? st.from === e.from && st.to === e.to : st.to === e.from && st.from === e.to));
  const arrow = (e: Edge, cls: string, keyStr: string) => {
    const a = geo[e.from], b = geo[e.to];
    const adjA = shown.adjusted.includes(e.from) ? 7 : 3, adjB = shown.adjusted.includes(e.to) ? 9 : 5;
    const p = rim(a, { x: b.cx, y: b.cy }, adjA), q = rim(b, { x: a.cx, y: a.cy }, adjB);
    const ang = Math.atan2(q.y - p.y, q.x - p.x), hl = 8;
    const h1 = { x: q.x - hl * Math.cos(ang - 0.42), y: q.y - hl * Math.sin(ang - 0.42) }, h2 = { x: q.x - hl * Math.cos(ang + 0.42), y: q.y - hl * Math.sin(ang + 0.42) };
    return <g key={keyStr} className={`ml-edge ${cls}`} data-edge={edgeKey(e)}>
      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
      <path d={`M ${h1.x} ${h1.y} L ${q.x} ${q.y} L ${h2.x} ${h2.y} Z`} />
    </g>;
  };
  const dragEdgePreview = (() => {
    if (!drag || !drag.moved || drag.payload.kind !== "node" || drag.y >= GH) return null;
    const a = geo[drag.payload.id];
    const target = act && (act.kind === "add" || act.kind === "reverse" || act.kind === "remove") ? geo[act.to] : null;
    const end = target ? rim(target, { x: a.cx, y: a.cy }, 5) : { x: drag.x, y: drag.y };
    const p = rim(a, end, 3);
    const ang = Math.atan2(end.y - p.y, end.x - p.x), hl = 9;
    return <g className={`ml-ghost-edge${act?.kind === "remove" ? " is-remove" : act?.kind === "refuse" ? " is-refuse" : ""}`}>
      <line x1={p.x} y1={p.y} x2={end.x} y2={end.y} />
      <path d={`M ${end.x - hl * Math.cos(ang - 0.45)} ${end.y - hl * Math.sin(ang - 0.45)} L ${end.x} ${end.y} L ${end.x - hl * Math.cos(ang + 0.45)} ${end.y - hl * Math.sin(ang + 0.45)}`} />
    </g>;
  })();
  const roleText = (id: string) => {
    if (id === X) return "exposure"; if (id === Y) return "outcome";
    const r = rolesOf(graphOf(shown), id, X, Y);
    const t = r.filter(x => x === "common cause" || x === "mediator" || x === "collider").join(" · ");
    return `${t}${measured.includes(id) ? "" : `${t ? " · " : ""}unmeasured`}`;
  };
  const zoneHot = act && (act.kind === "adjust");
  const canvas = <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ml-svg" {...handlers} role="img"
    aria-label={`Causal diagram: ${s.edges.map(e => `${L(e.from)} causes ${L(e.to)}`).join("; ")}. Adjusted for ${setText(s.adjusted)}.`}>
    <defs />
    {shown.edges.map(e => arrow(e, `${edgeTone(e)}${inFocus(e) ? " is-focus" : ""}`, `e-${edgeKey(e)}`))}
    {dragEdgePreview}
    {config.variables.map(v => {
      const g = geo[v.id];
      const adj = shown.adjusted.includes(v.id);
      const isTarget = act && "to" in act && act.to === v.id;
      const cls = ["ml-node", v.id === X ? "is-exposure" : v.id === Y ? "is-outcome" : "", v.measured === false ? "is-unmeasured" : "", adj ? "is-adjusted" : "", isTarget ? "is-target" : "", drag?.payload.id === v.id && drag.payload.kind === "node" && drag.moved ? "is-source" : ""].filter(Boolean).join(" ");
      return <g key={v.id} className={cls} data-node={v.id} onPointerDown={e => begin(e, { kind: "node", id: v.id })}>
        <title>{v.note ?? v.label}</title>
        {adj && <rect className="ml-adjbox" x={g.cx - g.w / 2 - 5} y={g.cy - g.h / 2 - 5} width={g.w + 10} height={g.h + 10} rx={3} />}
        <rect className="ml-node-face" x={g.cx - g.w / 2} y={g.cy - g.h / 2} width={g.w} height={g.h} rx={g.h / 2.4} />
        {g.lines.map((ln, i) => <text key={i} className="ml-node-label" x={g.cx} y={g.cy - (g.lines.length - 1) * 7 + i * 14 + 4.5} textAnchor="middle" fontSize={g.fs}>{ln}</text>)}
        <text className="ml-node-role" x={g.cx} y={g.cy + g.h / 2 + (adj ? 17 : 12)} textAnchor="middle">{roleText(v.id)}</text>
      </g>;
    })}
    <g className={`ml-zone${zoneHot ? " is-hot" : ""}`}>
      <rect className="ml-zone-line" x={6} y={GH + 4} width={W - 12} height={ZONE - 10} rx={8} />
      <text className="ml-zone-label" x={14} y={GH + 18}>Adjusted for</text>
      {!zoneChips.length && !zoneHot && <text className="ml-zone-empty" x={14} y={GH + 40}>nothing yet: drag a variable here</text>}
      {zoneChips.map((id, i) => {
        const w = Math.min(compact ? 92 : 112, textWidth(L(id), 12) + 22), x = chipX(i);
        const lifted = drag?.payload.kind === "chip" && drag.payload.id === id && drag.moved;
        const dx = lifted ? drag!.x - drag!.x0 : 0, dy = lifted ? drag!.y - drag!.y0 : 0;
        return <g key={id} className={`ml-chip${lifted ? " is-lifted" : ""}`} data-chip={id} transform={`translate(${dx} ${dy})`} onPointerDown={e => begin(e, { kind: "chip", id })}>
          <rect x={x} y={GH + 25} width={w} height={24} rx={4} />
          <text x={x + w / 2} y={GH + 41} textAnchor="middle">{L(id)}</text>
        </g>;
      })}
      {zoneHot && act?.kind === "adjust" && <g className="ml-chip is-ghost"><rect x={chipX(zoneChips.length)} y={GH + 25} width={Math.min(compact ? 92 : 112, textWidth(L(act.id), 12) + 22)} height={24} rx={4} />
        <text x={chipX(zoneChips.length) + Math.min(compact ? 92 : 112, textWidth(L(act.id), 12) + 22) / 2} y={GH + 41} textAnchor="middle">{L(act.id)}</text></g>}
    </g>
    {drag?.moved && drag.payload.kind === "node" && drag.y >= GH && <circle className="ml-pointer-dot" cx={drag.x} cy={drag.y} r={5} />}
  </svg>;

  /* ---------- paths list ---------- */
  const pathStatus = (p: PathInfo) => {
    if (p.kind === "causal") return p.open ? "open · causal" : `blocked by ${setText(p.blockedBy)} · part of the effect`;
    if (p.open) return p.openedBy.length ? `opened by adjusting ${setText(p.openedBy)} · collider bias` : p.kind === "backdoor" ? "open · backdoor: confounding" : "open";
    if (p.blockedBy.length) return `closed by adjusting ${setText(p.blockedBy)}`;
    return `closed at collider ${setText(p.closedAt)}`;
  };
  const rowEl = (p: PathInfo, i: number) => <li key={p.nodes.join(">")} className={`ml-path is-${p.kind}${p.open ? " is-open" : ""}${p.open && p.kind !== "causal" ? " is-bias" : ""}`}
    onPointerEnter={() => setFocus(i)} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} tabIndex={0}>
    <span className="ml-path-text">{pathText(p)}</span><span className="ml-path-status">{pathStatus(p)}</span>
  </li>;
  const below = <div className="ml-paths">
    <p className="ml-subhead">{plural(rows.length, "path")} between {L(X)} and {L(Y)}</p>
    <ul className="ml-path-list">{rows.slice(0, 4).map(rowEl)}</ul>
    {rows.length > 4 && <details className="receipt ml-more"><summary>Show all {rows.length} paths</summary><ul className="ml-path-list">{rows.slice(4).map((p, i) => rowEl(p, i + 4))}</ul></details>}
  </div>;

  /* ---------- buttons ---------- */
  const ids = config.variables.map(v => v.id);
  const [fromSel, setFrom] = useState(ids.find(i => i !== X && i !== Y) ?? ids[0]);
  const [toSel, setTo] = useState(X);
  const btnAct: Action | null = fromSel === toSel ? null : (() => {
    const g = graphOf(s);
    if (has(s, fromSel, toSel)) return { kind: "remove", from: fromSel, to: toSel, next: { edges: s.edges.filter(e => !(e.from === fromSel && e.to === toSel)), adjusted: s.adjusted, last: { kind: "remove", from: fromSel, to: toSel } } } as Action;
    if (has(s, toSel, fromSel)) {
      const without = { nodes: g.nodes, edges: s.edges.filter(e => !(e.from === toSel && e.to === fromSel)) };
      return makesCycle(without, fromSel, toSel) ? { kind: "refuse", why: "That would make a loop" } as Action
        : { kind: "reverse", from: fromSel, to: toSel, next: { edges: [...without.edges, { from: fromSel, to: toSel }], adjusted: s.adjusted, last: { kind: "reverse", from: fromSel, to: toSel } } } as Action;
    }
    return makesCycle(g, fromSel, toSel) ? { kind: "refuse", why: "That would make a loop" } as Action
      : { kind: "add", from: fromSel, to: toSel, next: { edges: [...s.edges, { from: fromSel, to: toSel }], adjusted: s.adjusted, last: { kind: "add", from: fromSel, to: toSel } } } as Action;
  })();
  const controls = <>
    <div className="ml-control-row">
      <label className="ml-select">Arrow from<select aria-label="Arrow from" value={fromSel} onChange={e => setFrom(e.currentTarget.value)}>{ids.map(i => <option key={i} value={i}>{L(i)}</option>)}</select></label>
      <label className="ml-select">to<select aria-label="Arrow to" value={toSel} onChange={e => setTo(e.currentTarget.value)}>{ids.map(i => <option key={i} value={i}>{L(i)}</option>)}</select></label>
      <button type="button" className="ml-btn" disabled={!btnAct || btnAct.kind === "refuse"} onClick={() => btnAct && apply(btnAct)}>
        {btnAct?.kind === "remove" ? "Erase arrow" : btnAct?.kind === "reverse" ? "Reverse arrow" : "Draw arrow"}</button>
    </div>
    <fieldset className="ml-control-row ml-checks"><legend>Adjust for</legend>
      {ids.filter(i => i !== X && i !== Y).map(i => <label key={i} className="ml-check"><input type="checkbox" disabled={!measured.includes(i)} checked={s.adjusted.includes(i)}
        onChange={e => apply(e.currentTarget.checked
          ? { kind: "adjust", id: i, next: { edges: s.edges, adjusted: [...s.adjusted, i], last: { kind: "adjust", from: i } } }
          : { kind: "unadjust", id: i, next: { edges: s.edges, adjusted: s.adjusted.filter(a => a !== i), last: { kind: "unadjust", from: i } } })} />{L(i)}{measured.includes(i) ? "" : " (unmeasured)"}</label>)}
    </fieldset>
  </>;

  return <Shell mode="dag" title={config.title} count={`${plural(s.edges.length, "arrow")} · adjusted for ${s.adjusted.length ? s.adjusted.length : "nothing"}`}
    canvasRef={ref} dragging={!!drag?.moved} dragLine={dragLine} canvas={canvas} below={below} instruction={instruction} tone={tone}
    controls={controls} status={status} share={share} onShare={onShare} canUndo={h.canUndo} onUndo={() => { h.undo(); onChange?.(); setStatus("Undone."); }}
    acted={touched} onReset={() => { h.reset(); onChange?.(); setStatus("Back to the start."); }}
    caption={config.source ? <SourceLine text={config.source} /> : undefined} />;
}

function sameState(a: DagState, b: DagState) {
  const ka = new Set(a.edges.map(edgeKey)), kb = new Set(b.edges.map(edgeKey));
  return ka.size === kb.size && [...ka].every(k => kb.has(k)) && a.adjusted.length === b.adjusted.length && a.adjusted.every(x => b.adjusted.includes(x));
}

export function SourceLine({ text }: { text: string }) {
  /* First sentence: the first ". " followed by a capital, after at least 40 characters (skips author initials). */
  const m = /^(.{40,}?[a-z0-9)\]]\.)\s+(?=[A-Z(])/.exec(text);
  const first = text.length <= 150 || !m ? text : m[1];
  if (first === text) return <span className="ml-source">{text}</span>;
  return <details className="ml-source-more"><summary className="ml-source">{first} <span className="ml-more-link">More</span></summary><span className="ml-source">{text.slice(first.length).trim()}</span></details>;
}
