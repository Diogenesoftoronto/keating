import { useMemo, useState } from "react";
import type { ShareSummary, SurvivalConfig, SurvivalPatient } from "./config";
import { coxBinary, kaplanMeier, logRank, medianSurvival, survivalAt, type KmRow, type SurvObs } from "./model";
import { SourceLine } from "./dag";
import { Shell, clamp, fmt, plural, useHistory, useSvgDrag, useWidth, type Tone } from "./shared";

type Last =
  | { kind: "time"; id: string; from: number; to: number }
  | { kind: "type"; id: string; event: boolean; time: number; from?: { time: number; event: boolean } }
  | { kind: "arm"; id: string; to: string }
  | { kind: "switch"; id: string; at?: number }
  | { kind: "analysis" }
  | { kind: "randomise" };
type SvState = { patients: SurvivalPatient[]; analysis: "itt" | "pp"; seed: number; last?: Last };
type Payload = { kind: "end" | "grip" | "switch"; id: string } | { kind: "tok"; tok: "event" | "censor" | "switch" };

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const pFmt = (p: number) => (p < 0.001 ? "< 0.001" : `= ${p.toFixed(3)}`).replace(/^= /, "");
export function SurvivalLab({ config, onChange, onShare }: { config: SurvivalConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const [ctl, exp] = config.arms;
  const armLabel = (id: string) => (id === ctl.id ? ctl.label : exp.label);
  const other = (id: string) => (id === ctl.id ? exp.id : ctl.id);
  const start = (): SvState => ({ patients: config.patients.map(p => ({ ...p })), analysis: "itt", seed: 1 });
  const h = useHistory(start);
  const s = h.state;
  const [status, setStatus] = useState("");
  const u = config.unit, ev = config.endpoint, anEv = `${/^[aeiou]/i.test(ev) ? "an" : "a"} ${ev}`;
  const anySwitch = (st: SvState) => st.patients.some(p => p.switchAt !== undefined);

  const analyse = (st: SvState) => {
    const use = st.analysis === "pp" ? st.patients.filter(p => p.switchAt === undefined) : st.patients;
    const obs = (arm: string): SurvObs[] => use.filter(p => p.arm === arm).map(p => ({ time: p.time, event: p.event }));
    const oc = obs(ctl.id), oe = obs(exp.id);
    const kc = kaplanMeier(oc), ke = kaplanMeier(oe);
    const cox = oc.length >= 1 && oe.length >= 1 ? coxBinary(oc, oe) : null;
    const lr = oc.length && oe.length ? logRank(oc, oe) : null;
    return { use, oc, oe, kc, ke, mc: medianSurvival(kc), me: medianSurvival(ke), cox, lr, excluded: st.patients.length - use.length };
  };
  const A = useMemo(() => analyse(s), [s]);

  /* ---------- geometry ---------- */
  const { ref, width: W } = useWidth();
  const compact = W < 470;
  const n = s.patients.length, dense = n > 20;
  const side = W >= 560; // arms side by side: halves the height of the timelines
  const rh = side ? (dense ? 9 : 17) : dense ? 7 : 17;
  const LX = dense ? 28 : 40, gap = 16;
  const colW = side ? (W - gap) / 2 : W;
  const trayH = 32, headH = 18;
  const order = (st: SvState, arm: string) => st.patients.filter(p => p.arm === arm);
  type Block = { x: number; w: number; top: number; bottom: number };
  const layout = (st: SvState) => {
    const rows: Record<string, number> = {}; const blocks: Record<string, Block> = {};
    let y = trayH + 6;
    [ctl.id, exp.id].forEach((arm, i) => {
      const bx = side ? i * (colW + gap) : 0, top = side ? trayH + 6 : y;
      let yy = top + headH;
      for (const p of order(st, arm)) { rows[p.id] = yy + rh / 2; yy += rh; }
      if (!order(st, arm).length) yy += rh;
      blocks[arm] = { x: bx, w: colW, top, bottom: yy };
      y = yy + 6;
    });
    const end = Math.max(...Object.values(blocks).map(bk => bk.bottom));
    return { rows, blocks, end };
  };
  const L0 = layout(s);
  const x0 = LX + 10, x1 = W - 16;
  const tx = (t: number) => x0 + (t / config.horizon) * (x1 - x0);
  const bx0 = (arm: string) => L0.blocks[arm].x + LX + 10, bx1 = (arm: string) => L0.blocks[arm].x + L0.blocks[arm].w - 14;
  const txA = (arm: string, t: number) => bx0(arm) + (t / config.horizon) * (bx1(arm) - bx0(arm));
  const tOfA = (arm: string, x: number) => clamp(Math.round(((x - bx0(arm)) / (bx1(arm) - bx0(arm))) * config.horizon), 1, config.horizon);
  const axisY = L0.end + 10;
  const kmTop = axisY + 46, KH = side ? 128 : 150, kmBottom = kmTop + KH;
  const H = kmBottom + 58;
  const ky = (sv: number) => kmTop + (1 - sv) * KH;

  /* ---------- moves ---------- */
  const rowAt = (x: number, y: number, lay = L0) => { const arm = armAt(x, y); return s.patients.filter(p => !side || p.arm === arm).find(p => Math.abs(lay.rows[p.id] - y) <= Math.max(rh / 2 + 1, 6))?.id; };
  const armAt = (x: number, y: number) => [ctl.id, exp.id].find(a => { const bk = L0.blocks[a]; return x >= bk.x - 4 && x <= bk.x + bk.w + 4 && y >= bk.top - 4 && y <= (side ? Math.max(bk.bottom, L0.end) : bk.bottom) + 4; });
  const patch = (id: string, f: (p: SurvivalPatient) => SurvivalPatient) => s.patients.map(p => (p.id === id ? f({ ...p }) : p));
  type Prev = { next: SvState; line: string } | { refuse: string } | null;
  const preview = (p: Payload, x: number, y: number): Prev => {
    if (p.kind === "end") {
      const pt = s.patients.find(q => q.id === p.id)!;
      const t = Math.max(tOfA(pt.arm, x), pt.switchAt !== undefined ? Math.floor(pt.switchAt) + 1 : 1);
      if (t === pt.time) return { refuse: `${pt.id} stays at ${pt.time} ${u}` };
      return { next: { ...s, patients: patch(p.id, q => ({ ...q, time: t })), last: { kind: "time", id: p.id, from: pt.time, to: t } }, line: `Drop to move ${pt.id}'s ${pt.event ? ev : "censoring"} to ${t} ${u}` };
    }
    if (p.kind === "grip") {
      const to = armAt(x, y), pt = s.patients.find(q => q.id === p.id)!;
      if (!to || to === pt.arm) return { refuse: `Drag ${pt.id} into the other arm` };
      if (order(s, pt.arm).length <= 2) return { refuse: `${armLabel(pt.arm)} needs at least 2 patients` };
      return { next: { ...s, patients: patch(p.id, q => ({ ...q, arm: to })), last: { kind: "arm", id: p.id, to } }, line: `Drop to put ${pt.id} in ${armLabel(to)}` };
    }
    if (p.kind === "switch") {
      const pt = s.patients.find(q => q.id === p.id)!;
      if (Math.abs(y - L0.rows[p.id]) > 22) return { next: { ...s, patients: patch(p.id, q => { const { switchAt: _x, ...rest } = q; return rest; }), last: { kind: "switch", id: p.id } }, line: `Drop to remove ${pt.id}'s crossover` };
      const t = clamp(tOfA(pt.arm, x), 1, pt.time - 1);
      if (pt.time <= 1) return { refuse: "No room for a crossover before the end" };
      return { next: { ...s, patients: patch(p.id, q => ({ ...q, switchAt: t })), last: { kind: "switch", id: p.id, at: t } }, line: `Drop: ${pt.id} switches at ${t} ${u}` };
    }
    const id = rowAt(x, y); if (!id) return { refuse: "Drop it on a patient's line" };
    const pt = s.patients.find(q => q.id === id)!; const t = tOfA(pt.arm, x); const tok = (p as { tok: "event" | "censor" | "switch" }).tok;
    if (tok === "switch") {
      if (t >= pt.time) return { refuse: `${id}'s follow-up ends at ${pt.time}; a crossover has to come before that` };
      return { next: { ...s, patients: patch(id, q => ({ ...q, switchAt: t })), last: { kind: "switch", id, at: t } }, line: `Drop: ${id} crosses over to ${armLabel(other(pt.arm))} at ${t} ${u}` };
    }
    const event = tok === "event";
    if (pt.switchAt !== undefined && t <= pt.switchAt) return { refuse: `${id} crossed over at ${pt.switchAt}; the end has to come after` };
    return { next: { ...s, patients: patch(id, q => ({ ...q, time: t, event })), last: { kind: "type", id, event, time: t, from: { time: pt.time, event: pt.event } } }, line: `Drop: ${id} ${event ? `has ${ev === "death" ? "died" : `a ${ev}`}` : "is censored"} at ${t} ${u}` };
  };
  const commit = (next: SvState, say: string) => { h.commit(next); onChange?.(); setStatus(say); };
  const { svgRef, drag, begin, handlers } = useSvgDrag<Payload>(d => {
    if (!d.moved) { if (d.payload.kind === "end") toggle(d.payload.id); return; }
    const pv = preview(d.payload, d.x, d.y);
    if (pv && "next" in pv) commit(pv.next, pv.line.replace(/^Drop(: | to )/, "Done: ")); else if (pv) setStatus(pv.refuse + ".");
  });
  const toggle = (id: string) => {
    const pt = s.patients.find(q => q.id === id)!;
    commit({ ...s, patients: patch(id, q => ({ ...q, event: !q.event })), last: { kind: "type", id, event: !pt.event, time: pt.time, from: { time: pt.time, event: pt.event } } }, `${id} is now ${pt.event ? "censored" : anEv} at ${pt.time} ${u}.`);
  };
  const pv = drag && drag.moved ? preview(drag.payload, drag.x, drag.y) : null;
  const shown = pv && "next" in pv ? pv.next : s;
  const AS = shown === s ? A : analyse(shown);
  const dragLine = pv ? ("next" in pv ? pv.line : pv.refuse) : "";

  /* ---------- words ---------- */
  const med = (m: number | null) => (m === null ? "not reached" : `${m} ${u}`);
  const hrText = (a: typeof A) => a.cox ? `${fmt(a.cox.hr, 2)} (95% CI ${fmt(a.cox.lo, 2)}–${fmt(a.cox.hi, 2)})` : "not estimable";
  const high = (st: SvState, arm: string) => st.patients.filter(p => p.arm === arm && p.risk === "high").length;
  const hasRisk = config.patients.some(p => p.risk);
  const base = useMemo(() => analyse(start()), [config]);
  let instruction: string, tone: Tone = "neutral";
  const lst = s.last;
  const kmStep = (rows: KmRow[], t: number) => { const i = rows.findIndex(r => r.time === t); return i >= 0 ? rows[i] : undefined; };
  if (!lst) instruction = `Each line is one patient, from entry to ${ev} (×) or censoring (|). Drag an end mark along its line, tap it to switch event ↔ censored, drop a mark from the tray onto a line${hasRisk ? ", or drag a patient's label into the other arm" : ""}.`;
  else if (lst.kind === "type") {
    const pt = s.patients.find(p => p.id === lst.id)!; const rows = pt.arm === ctl.id ? A.kc : A.ke; const r = kmStep(rows, lst.time);
    if (!lst.event) {
      tone = "good";
      const others = r && r.events ? `Any other ${ev}s at ${lst.time} still lower the curve: ${r.events} of ${r.atRisk} at risk there.` : `No one else has ${anEv} at ${lst.time}, so the curve no longer steps there.`;
      const sameTime = lst.from?.time === lst.time;
      const later = sameTime ? `Later risk sets contain the same people as before this edit; only the ${ev} count at ${lst.time} fell.`
        : `${lst.id}'s follow-up now ends at ${lst.time} instead of ${lst.from?.time ?? "before"}, so the risk sets in between change.`;
      instruction = `${lst.id} is censored at ${lst.time}: still free of ${ev} when last seen. This person contributes no ${ev} at ${lst.time} and leaves follow-up at ${lst.time} (counted at risk at ${lst.time}). ${others} ${later} Median now ${med(pt.arm === ctl.id ? A.mc : A.me)}.`;
    }
    else { tone = "neutral"; instruction = `${anEv[0].toUpperCase()}${anEv.slice(1)} at ${lst.time}: the curve drops by the share of those still at risk${r ? ` (${r.events} of ${r.atRisk}, so × ${fmt(1 - r.events / r.atRisk, 3)})` : ""}. That's the product-limit rule: S(t) = Π (1 − dᵢ/nᵢ). Median now ${med(pt.arm === ctl.id ? A.mc : A.me)}.`; }
  } else if (lst.kind === "time") {
    const pt = s.patients.find(p => p.id === lst.id)!;
    instruction = `${lst.id}'s ${pt.event ? ev : "censoring"} moved from ${lst.from} to ${lst.to} ${u}. ${pt.event ? `Medians: ${ctl.label} ${med(A.mc)}, ${exp.label} ${med(A.me)}; HR ${hrText(A)}.` : "A censoring time only changes who is at risk, never the height of a step by itself."}`;
  } else if (lst.kind === "arm" || lst.kind === "randomise") {
    const hc = high(s, ctl.id), he = high(s, exp.id), nc = order(s, ctl.id).length, ne = order(s, exp.id).length;
    const share = (a: number, b: number) => (b ? a / b : 0);
    const imbalance = Math.abs(share(hc, nc) - share(he, ne));
    tone = imbalance > 0.25 ? "warn" : "good";
    instruction = lst.kind === "randomise"
      ? `Coin-flip allocation: ${config.riskLabel ?? "high risk"} in ${hc} of ${nc} vs ${he} of ${ne}. HR ${hrText(A)}. Chance imbalances happen in small trials, but no one can steer them; across many randomisations they average out.`
      : `${imbalance > 0.25 ? "Hand-picking. " : ""}${ctl.label} now has ${hc} of ${nc} with ${config.riskLabel ?? "high risk"}, ${exp.label} ${he} of ${ne}. The HR is ${hrText(A)} (it was ${hrText(base)}), and no treatment changed: only who was compared with whom. Randomisation stops anyone choosing like this, so known and unknown risk factors balance on average.`;
  } else if (lst.kind === "switch" || lst.kind === "analysis") {
    const itt = analyse({ ...s, analysis: "itt" }), pp = analyse({ ...s, analysis: "pp" });
    const nsw = s.patients.filter(p => p.switchAt !== undefined).length;
    tone = nsw ? "neutral" : "good";
    instruction = nsw ? `${plural(nsw, "patient")} crossed over. Intention-to-treat keeps everyone in the arm they were randomised to: HR ${hrText(itt)}. Excluding switchers (a naïve comparison, ${pp.oc.length} vs ${pp.oe.length} analysed) gives HR ${hrText(pp)}, and here each switcher is dropped for all of follow-up, even before the switch. Patients who switch aren't a random subset (they are often the ones getting worse), so this loses the balance randomisation bought and can be biased. Estimating a true per-protocol effect needs methods that handle why and when people deviated (for example inverse-probability weighting). ITT answers “what does assigning the drug do?”`
      : "No crossovers now, so intention-to-treat and excluding switchers are the same analysis.";
  } else instruction = "";

  /* ---------- share ---------- */
  const touched = h.moves > 0;
  const unchanged = touched && JSON.stringify(s.patients) === JSON.stringify(config.patients) && s.analysis === "itt";
  const share: ShareSummary | undefined = touched ? (() => {
    const label = s.analysis === "pp" ? "switchers excluded, naïve comparison" : "intention-to-treat";
    const inc = A.use, armN = (arm: string) => inc.filter(p => p.arm === arm).length, highIn = (arm: string) => inc.filter(p => p.arm === arm && p.risk === "high").length;
    const learner = unchanged ? `I changed things and put them back; the trial is as it started: medians ${med(A.mc)} vs ${med(A.me)}, HR ${hrText(A)}.`
      : `In my version (${label}), median time to ${ev} is ${med(A.mc)} on ${ctl.label} and ${med(A.me)} on ${exp.label}, and the hazard ratio is ${hrText(A)}.`;
    const bits: string[] = [];
    if (A.cox) {
      bits.push(`Under proportional hazards, the estimated ${ev} rate among those still free of ${ev} on ${exp.label} is ${fmt(A.cox.hr, 2)} times that in the corresponding ${ctl.label} risk set. It compares rates among people still at risk; it is not any one patient's probability or treatment effect.`);
      if (A.mc !== null && A.me !== null) bits.push(`The medians (${A.mc} vs ${A.me} ${u}, a gap of ${Math.abs(A.me - A.mc)}) are single points where each curve crosses 50%. If survival were exponential the median ratio would be 1/HR = ${fmt(1 / A.cox.hr, 2)}; here it is ${fmt(A.me / A.mc, 2)}. They can disagree, and with steps this coarse the median jumps when one patient moves.`);
      else bits.push(`At least one median isn't reached (the curve never falls to 50%), which is why trials report the HR: it uses every event, not one crossing point.`);
      bits.push(`The 95% CI (${fmt(A.cox.lo, 2)}–${fmt(A.cox.hi, 2)}) ${A.cox.lo < 1 && A.cox.hi > 1 ? "includes 1, so these data are compatible with no difference" : "excludes 1"}; log-rank p ${A.lr ? pFmt(A.lr.p) : "n/a"}.`);
    } else bits.push("The hazard ratio can't be estimated: one arm has no events or no patients left.");
    if (s.analysis === "pp") bits.push(`${plural(A.excluded, "switcher")} excluded for all of follow-up: ${A.oc.length} ${ctl.label} and ${A.oe.length} ${exp.label} patients analysed of ${order(s, ctl.id).length} and ${order(s, exp.id).length} randomised. This naïve comparison can be biased; intention-to-treat keeps everyone in their assigned arm.`);
    const cens = inc.filter(p => !p.event).length;
    bits.push(`${plural(cens, "patient")} ${cens === 1 ? "is" : "are"} censored: they count as at risk until last seen, then leave without counting as ${anEv}. Dropping them, or counting them as ${ev}s, would bias the curve.`);
    if (hasRisk) bits.push(`${cap(config.riskLabel ?? "high risk")}${s.analysis === "pp" ? " among those analysed" : ""}: ${highIn(ctl.id)} of ${armN(ctl.id)} vs ${highIn(exp.id)} of ${armN(exp.id)}.`);
    if (config.illustrative) bits.push("(Illustrative data, not a real trial.)");
    if (config.analysisNote) bits.push(config.analysisNote);
    if (!config.illustrative && !unchanged && JSON.stringify(s.patients) !== JSON.stringify(config.patients)) bits.push("My edits make these outcomes hypothetical; they are not the trial's data.");
    bits.push("Educational analysis, not for clinical use.");
    return { learner, reply: bits.join(" "),
      data: `survival · ${label} · median ${A.mc ?? "NR"} vs ${A.me ?? "NR"} ${u} · HR ${A.cox ? fmt(A.cox.hr, 3) : "NA"} [${A.cox ? `${fmt(A.cox.lo, 2)},${fmt(A.cox.hi, 2)}` : ""}] · logrank p ${A.lr ? fmt(A.lr.p, 4) : "NA"} · events ${A.oc.filter(o => o.event).length}/${A.oc.length} vs ${A.oe.filter(o => o.event).length}/${A.oe.length} · ${h.moves} moves` };
  })() : undefined;

  /* ---------- drawing ---------- */
  const armTone = (arm: string) => (arm === ctl.id ? "is-ctl" : "is-exp");
  const lay = L0;
  const dragging = drag?.moved ? drag : null;
  const row = (p: SurvivalPatient) => {
    const y0 = lay.rows[p.id];
    if (y0 === undefined) return null;
    const lifted = dragging && dragging.payload.kind === "grip" && dragging.payload.id === p.id;
    const y = lifted ? dragging!.y : y0, liftDx = lifted ? dragging!.x - dragging!.x0 : 0;
    const sp = shown.patients.find(q => q.id === p.id)!;
    const xe = txA(p.arm, sp.time), xs = sp.switchAt !== undefined ? txA(p.arm, sp.switchAt) : null, rx0 = bx0(p.arm), bxl = L0.blocks[p.arm].x;
    const tk = dense ? 3.2 : 6;
    const targeted = pv && "next" in pv && "tok" in (drag!.payload) && rowAt(drag!.x, drag!.y) === p.id;
    return <g key={p.id} className={`ml-patient ${armTone(sp.arm)}${lifted ? " is-lifted" : ""}${targeted ? " is-target" : ""}`} data-patient={p.id} transform={liftDx ? `translate(${liftDx} 0)` : undefined}>
      {!dense && <text x={bxl + LX - 4} y={y + 4} textAnchor="end" className="ml-pid">{p.id}</text>}
      {p.risk === "high" && <circle cx={bxl + (dense ? 6 : 8)} cy={y} r={dense ? 2.2 : 3.2} className="ml-risk" />}
      <g className="ml-grip" data-grip={p.id} onPointerDown={e => begin(e, { kind: "grip", id: p.id })}>
        <rect x={bxl} y={y - Math.max(rh, 14) / 2} width={LX + 4} height={Math.max(rh, 14)} className="ml-hit" />
        {dense && <line x1={bxl + 12} x2={bxl + LX} y1={y} y2={y} className="ml-griplines" />}
      </g>
      <line x1={rx0} x2={xs ?? xe} y1={y} y2={y} className="ml-tl" />
      {xs !== null && <line x1={xs} x2={xe} y1={y} y2={y} className={`ml-tl is-switched ${armTone(other(sp.arm))}`} />}
      {xs !== null && <g className="ml-switch" data-switch={p.id} onPointerDown={e => begin(e, { kind: "switch", id: p.id })}>
        <path d={`M${xs} ${y - tk * 0.8}l${tk * 0.8} ${tk * 0.8}l${-tk * 0.8} ${tk * 0.8}l${-tk * 0.8} ${-tk * 0.8}Z`} className="ml-switch-mark" />
        <rect x={xs - 9} y={y - Math.max(rh, 16) / 2} width={18} height={Math.max(rh, 16)} className="ml-hit" />
      </g>}
      <g className={`ml-end ${sp.event ? "is-event" : "is-censor"}`} data-end={p.id} onPointerDown={e => begin(e, { kind: "end", id: p.id })}>
        {sp.event ? <path d={`M${xe - tk * 0.7} ${y - tk * 0.7}L${xe + tk * 0.7} ${y + tk * 0.7}M${xe - tk * 0.7} ${y + tk * 0.7}L${xe + tk * 0.7} ${y - tk * 0.7}`} className="ml-mark" />
          : <line x1={xe} x2={xe} y1={y - tk} y2={y + tk} className="ml-mark" />}
        <rect x={xe - 11} y={y - Math.max(rh, 18) / 2} width={22} height={Math.max(rh, 18)} className="ml-hit" />
      </g>
    </g>;
  };
  const kmPath = (rows: KmRow[], last: number) => {
    let d = `M${tx(0)} ${ky(1)}`; let sv = 1;
    for (const r of rows) if (r.events) { d += `H${tx(r.time)}V${ky(r.survival)}`; sv = r.survival; }
    return d + `H${tx(last)}` + (sv < -1 ? "" : "");
  };
  const censorTicks = (rows: KmRow[]) => rows.filter(r => r.censored).map(r => `M${tx(r.time)} ${ky(survivalAt(rows, r.time)) - 4}v8`).join("");
  const lastT = (o: SurvObs[]) => Math.max(0, ...o.map(x => x.time));
  const riskTimes = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(config.horizon * f));
  const atRisk = (o: SurvObs[], t: number) => o.filter(x => x.time >= t).length;
  const tokX = (i: number) => (compact ? W - 16 - (3 - i) * 66 : W - 16 - (3 - i) * 84);
  const tokens: [("event" | "censor" | "switch"), string][] = [["event", `× ${ev}`], ["censor", "| censored"], ["switch", "◇ crossover"]];
  const canvas = <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ml-svg" {...handlers} role="img"
    aria-label={`Kaplan–Meier curves: median ${med(A.mc)} on ${ctl.label}, ${med(A.me)} on ${exp.label}; hazard ratio ${hrText(A)}.`}>
    {config.illustrative && <text x={compact ? 4 : 8} y={compact ? axisY + 26 : 20} className="ml-small is-strong">Illustrative data</text>}
    {tokens.map(([k, t], i) => {
      const lifted = dragging && dragging.payload.kind === "tok" && dragging.payload.tok === k;
      return <g key={k} className={`ml-token is-${k}${lifted ? " is-lifted" : ""}`} data-token={k} transform={lifted ? `translate(${dragging!.x - dragging!.x0} ${dragging!.y - dragging!.y0})` : undefined}
        onPointerDown={e => begin(e, { kind: "tok", tok: k })}>
        <rect x={tokX(i)} y={4} width={compact ? 62 : 80} height={22} rx={4} />
        <text x={tokX(i) + (compact ? 31 : 40)} y={19} textAnchor="middle">{compact ? t.replace(" censored", " cens.").replace(" crossover", " cross") : t}</text>
      </g>;
    })}
    {[ctl.id, exp.id].map(arm => <text key={arm} x={lay.blocks[arm].x + 4} y={lay.blocks[arm].top + 13} className={`ml-armlabel ${armTone(arm)}`}>{armLabel(arm)} · {order(shown, arm).length}</text>)}
    {s.patients.map(row)}
    {(side ? [ctl.id, exp.id] : [ctl.id]).map(arm => <g key={arm}>
      <line x1={bx0(arm)} x2={bx1(arm)} y1={axisY} y2={axisY} className="ml-axis" />
      {riskTimes.map(t => <text key={t} x={txA(arm, t)} y={axisY + 13} textAnchor="middle" className="ml-tick">{t}</text>)}
    </g>)}
    <text x={x1} y={axisY + 26} textAnchor="end" className="ml-tick">{u} since randomisation</text>
    <g className="ml-km">
      <line x1={x0} x2={x0} y1={kmTop} y2={kmBottom} className="ml-axis" />
      <line x1={x0} x2={x1} y1={kmBottom} y2={kmBottom} className="ml-axis" />
      {[0, 0.5, 1].map(v => <text key={v} x={x0 - 5} y={ky(v) + 4} textAnchor="end" className="ml-tick">{v === 0.5 ? ".5" : v}</text>)}
      <line x1={x0} x2={x1} y1={ky(0.5)} y2={ky(0.5)} className="ml-median-line" />
      {AS.mc !== null && <line x1={tx(AS.mc)} x2={tx(AS.mc)} y1={ky(0.5)} y2={kmBottom} className="ml-median-drop is-ctl" />}
      {AS.me !== null && <line x1={tx(AS.me)} x2={tx(AS.me)} y1={ky(0.5)} y2={kmBottom} className="ml-median-drop is-exp" />}
      <path d={kmPath(AS.kc, lastT(AS.oc))} className="ml-kmcurve is-ctl" data-curve="ctl" />
      <path d={kmPath(AS.ke, lastT(AS.oe))} className="ml-kmcurve is-exp" data-curve="exp" />
      <path d={censorTicks(AS.kc)} className="ml-kmcensor is-ctl" />
      <path d={censorTicks(AS.ke)} className="ml-kmcensor is-exp" />
      <text x={x0} y={kmTop - 8} className="ml-small">share without {ev} (Kaplan–Meier)</text>
      <text x={x1} y={kmBottom + 14} textAnchor="end" className="ml-tick">at risk</text>
      {riskTimes.map(t => <g key={t}><text x={tx(t)} y={kmBottom + 28} textAnchor="middle" className="ml-tick is-ctl">{atRisk(AS.oc, t)}</text><text x={tx(t)} y={kmBottom + 42} textAnchor="middle" className="ml-tick is-exp">{atRisk(AS.oe, t)}</text></g>)}
    </g>
  </svg>;

  const setAnalysis = (a: "itt" | "pp") => { if (a !== s.analysis) commit({ ...s, analysis: a, last: { kind: "analysis" } }, a === "pp" ? "Switchers excluded (naïve comparison)." : "Intention-to-treat analysis."); };
  const below = <div className="ml-km-facts">
    <dl className="ml-facts">
      {anySwitch(s) && <div className="ml-fact"><dt>Analysis{s.analysis === "pp" ? ` · ${plural(A.excluded, "switcher")} left out (naïve)` : ""}</dt><dd><span className="ml-seg" role="group" aria-label="Analysis">
        <button type="button" aria-pressed={s.analysis === "itt"} onClick={() => setAnalysis("itt")} title="Intention-to-treat" aria-label="Intention-to-treat">ITT</button>
        <button type="button" aria-pressed={s.analysis === "pp"} onClick={() => setAnalysis("pp")}>Exclude switchers (naïve comparison)</button></span></dd></div>}
      <div className="ml-fact"><dt>Median time to {ev}</dt><dd><span className="is-ctl">{ctl.label} {med(A.mc)}</span> · <span className="is-exp">{exp.label} {med(A.me)}</span>{A.mc !== null && A.me !== null ? ` · gap ${Math.abs(A.me - A.mc)}` : ""}</dd></div>
      <div className="ml-fact"><dt>Hazard ratio ({exp.label} vs {ctl.label})</dt><dd>{hrText(A)}{A.lr ? ` · log-rank p ${pFmt(A.lr.p)}` : ""}</dd></div>
      <div className="ml-fact"><dt>{ev[0].toUpperCase() + ev.slice(1)}s · censored</dt><dd>{A.oc.filter(o => o.event).length}/{A.oc.length} vs {A.oe.filter(o => o.event).length}/{A.oe.length} · {A.use.filter(p => !p.event).length} censored{s.analysis === "pp" ? " (analysed)" : ""}</dd></div>
      {hasRisk && <div className="ml-fact"><dt>{config.riskLabel ?? "High risk"}{s.analysis === "pp" ? " (analysed)" : ""}</dt><dd><span className="ml-risk-key" aria-hidden="true">●</span> {A.use.filter(p => p.arm === ctl.id && p.risk === "high").length} of {A.oc.length} vs {A.use.filter(p => p.arm === exp.id && p.risk === "high").length} of {A.oe.length}</dd></div>}
    </dl>
    <details className="receipt ml-more"><summary>Product-limit table</summary>
      {[[ctl, A.kc], [exp, A.ke]].map(([arm, rows]) => <table key={(arm as { id: string }).id} className="ml-table"><caption>{(arm as { label: string }).label}</caption>
        <thead><tr><th>{u}</th><th>at risk</th><th>{ev}s</th><th>censored</th><th>S(t)</th></tr></thead>
        <tbody>{(rows as KmRow[]).map(r => <tr key={r.time}><td>{r.time}</td><td>{r.atRisk}</td><td>{r.events}</td><td>{r.censored}</td><td>{fmt(r.survival, 3)}</td></tr>)}</tbody></table>)}
    </details>
  </div>;

  const [pick, setPick] = useState(config.patients[0].id);
  const pp = s.patients.find(p => p.id === pick) ?? s.patients[0];
  const randomise = () => {
    let seed = s.seed * 16807 % 2147483647; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const ids = s.patients.map(p => p.id); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const nc = config.patients.filter(p => p.arm === ctl.id).length;
    const armOf = new Map(ids.map((id, i) => [id, i < nc ? ctl.id : exp.id]));
    commit({ ...s, seed, patients: s.patients.map(p => ({ ...p, arm: armOf.get(p.id)! })), last: { kind: "randomise" } }, "Patients re-randomised by coin flip.");
  };
  const controls = <>
    <div className="ml-control-row">
      <label className="ml-select">Patient<select aria-label="Patient" value={pick} onChange={e => setPick(e.currentTarget.value)}>{s.patients.map(p => <option key={p.id} value={p.id}>{p.id} · {armLabel(p.arm)}</option>)}</select></label>
      <label className="ml-select">Time<input type="number" aria-label="Time" min={1} max={config.horizon} step={1} value={pp.time}
        onChange={e => { const t = clamp(Math.round(Number(e.currentTarget.value)), pp.switchAt !== undefined ? Math.floor(pp.switchAt) + 1 : 1, config.horizon); if (Number.isFinite(t) && t !== pp.time) commit({ ...s, patients: patch(pp.id, q => ({ ...q, time: t })), last: { kind: "time", id: pp.id, from: pp.time, to: t } }, `${pp.id} now ends at ${t} ${u}.`); }} /></label>
      <button type="button" className="ml-btn" onClick={() => toggle(pp.id)}>{pp.event ? "Make it censored" : `Make it ${anEv}`}</button>
      <button type="button" className="ml-btn" disabled={order(s, pp.arm).length <= 2} onClick={() => commit({ ...s, patients: patch(pp.id, q => ({ ...q, arm: other(q.arm) })), last: { kind: "arm", id: pp.id, to: other(pp.arm) } }, `${pp.id} moved to ${armLabel(other(pp.arm))}.`)}>Move to {armLabel(other(pp.arm))}</button>
      {pp.switchAt !== undefined ? <button type="button" className="ml-btn" onClick={() => commit({ ...s, patients: patch(pp.id, q => { const { switchAt: _x, ...rest } = q; return rest; }), last: { kind: "switch", id: pp.id } }, `${pp.id} no longer crosses over.`)}>Remove crossover</button>
        : <button type="button" className="ml-btn" disabled={pp.time <= 1} onClick={() => commit({ ...s, patients: patch(pp.id, q => ({ ...q, switchAt: Math.max(1, Math.floor(q.time / 2)) })), last: { kind: "switch", id: pp.id, at: Math.max(1, Math.floor(pp.time / 2)) } }, `${pp.id} crosses over at ${Math.max(1, Math.floor(pp.time / 2))} ${u}.`)}>Add crossover</button>}
    </div>
  </>;

  return <Shell mode="survival" title={config.title} count={`${n} patients · ${s.analysis === "pp" ? "switchers excluded" : "ITT"}`} canvasRef={ref} dragging={!!dragging}
    dragLine={dragLine} canvas={canvas} below={below} instruction={instruction} tone={tone} controls={controls} status={status}
    share={share} onShare={onShare} canUndo={h.canUndo} onUndo={() => { h.undo(); onChange?.(); setStatus("Undone."); }} acted={touched}
    onReset={() => { h.reset(); onChange?.(); setStatus("Back to the start."); }}
    extraActions={hasRisk ? <button type="button" className="quiet" onClick={randomise}>Randomise again</button> : undefined}
    caption={<SourceLine text={`Educational analysis, not for clinical use.${config.source ? ` ${config.source}` : ""}`} />} />;
}
