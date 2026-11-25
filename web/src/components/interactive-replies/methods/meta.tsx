import { useMemo, useState } from "react";
import type { MetaConfig, ShareSummary } from "./config";
import { egger, logOR, logRR, metaAnalyse, type MetaFit } from "./model";
import { SourceLine } from "./dag";
import { Shell, clamp, fmt, listWords, plural, useHistory, useSvgDrag, useWidth, type Tone } from "./shared";

type Study = { id: string; label: string; y: number; v: number; n?: number; drawer: boolean };
type Last = { kind: "effect" | "precision" | "drawer" | "publish" | "point" | "model"; id?: string; before?: Study };
type MaState = { studies: Study[]; model: "fixed" | "random"; last?: Last };
type Payload = { kind: "sq" | "pt" | "chip"; id: string } | { kind: "cap"; id: string; side: -1 | 1 };
const Z = 1.959964;

export function MetaLab({ config, onChange, onShare }: { config: MetaConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const ratio = config.measure !== "MD";
  const initial = useMemo<Study[]>(() => config.studies.map(st => {
    const name = st.year ? `${st.label} ${st.year}` : st.label;
    if (st.counts) {
      const k = st.counts; const e = config.measure === "OR" ? logOR(k.treatEvents, k.treatTotal, k.controlEvents, k.controlTotal) : logRR(k.treatEvents, k.treatTotal, k.controlEvents, k.controlTotal);
      return { id: st.id, label: name, y: e.y, v: e.v, n: k.treatTotal + k.controlTotal, drawer: false };
    }
    const f = ratio ? Math.log : (x: number) => x;
    const se = (f(st.upper!) - f(st.lower!)) / (2 * Z);
    return { id: st.id, label: name, y: f(st.estimate!), v: se * se, drawer: false };
  }), [config]);
  const start = (): MaState => ({ studies: initial.map(s => ({ ...s })), model: config.model ?? "random" });
  const h = useHistory(start);
  const s = h.state;
  const [status, setStatus] = useState("");
  const fitOf = (st: MaState) => { const act = st.studies.filter(x => !x.drawer); return act.length >= 2 ? metaAnalyse(act) : null; };
  const fit = useMemo(() => fitOf(s), [s]);
  const fit0 = useMemo(() => fitOf(start()), [initial]);

  /* ---------- scales (fixed at mount so nothing slides under the pointer) ---------- */
  const { ref, width: W } = useWidth();
  const compact = W < 470;
  const dom = useMemo(() => {
    const lo = Math.min(0, ...initial.map(x => x.y - Z * Math.sqrt(x.v))), hi = Math.max(0, ...initial.map(x => x.y + Z * Math.sqrt(x.v)));
    const pad = (hi - lo) * 0.12;
    const a = ratio ? clamp(lo - pad, Math.log(0.01), -0.05) : lo - pad, b = ratio ? clamp(hi + pad, 0.05, Math.log(100)) : hi + pad;
    const maxSe = Math.max(...initial.map(x => Math.sqrt(x.v))) * 1.25;
    return { a, b, maxSe, minSe: Math.min(...initial.map(x => Math.sqrt(x.v))) * 0.4 };
  }, [initial, ratio]);
  const labelW = compact ? 92 : 136, textW = compact ? 40 : 150;
  const px0 = labelW + 6, px1 = W - textW - 10;
  const X = (y: number) => px0 + ((y - dom.a) / (dom.b - dom.a)) * (px1 - px0);
  const Yof = (x: number) => dom.a + ((x - px0) / (px1 - px0)) * (dom.b - dom.a);
  const show = (y: number) => (ratio ? Math.exp(y) : y);
  const num = (y: number) => fmt(show(y), 2);
  const rowH = compact ? 26 : 24, top = 34;
  const k = s.studies.length;
  const rowY = (i: number) => top + i * rowH + rowH / 2;
  const pooledTop = top + k * rowH + 6;
  const axisY = pooledTop + 2 * rowH + 4;
  const drawerTop = axisY + 34, drawerH = 40;
  const funTop = drawerTop + drawerH + 34, FH = compact ? 150 : 160;
  const H = funTop + FH + 40;
  const FY = (se: number) => funTop + (se / dom.maxSe) * FH;
  const seOfY = (y: number) => clamp(((y - funTop) / FH) * dom.maxSe, dom.minSe, dom.maxSe);
  const ticks = ratio ? [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].map(Math.log).filter(t => t >= dom.a && t <= dom.b) : niceTicks(dom.a, dom.b);
  const nullX = X(0);

  /* ---------- moves ---------- */
  const patch = (id: string, f: (x: Study) => Study) => s.studies.map(x => (x.id === id ? f({ ...x }) : x));
  const byId = (st: MaState, id: string) => st.studies.find(x => x.id === id)!;
  const preview = (p: Payload, x: number, y: number): { next: MaState; line: string } | null => {
    const st = byId(s, p.id); const se = Math.sqrt(st.v);
    if (p.kind === "sq") {
      if (y > drawerTop - 6) return { next: { ...s, studies: patch(p.id, q => ({ ...q, drawer: true })), last: { kind: "drawer", id: p.id, before: st } }, line: `Drop to file ${st.label} away, unpublished` };
      const ny = clamp(Yof(x), dom.a, dom.b);
      return { next: { ...s, studies: patch(p.id, q => ({ ...q, y: ny })), last: { kind: "effect", id: p.id, before: st } }, line: `Drop: ${st.label} ${config.measure} ${num(ny)}` };
    }
    if (p.kind === "cap") {
      const nse = clamp(Math.abs(Yof(x) - st.y) / Z, dom.minSe, dom.maxSe);
      const nn = st.n ? Math.round(st.n * (se / nse) ** 2) : undefined;
      return { next: { ...s, studies: patch(p.id, q => ({ ...q, v: nse * nse, n: nn })), last: { kind: "precision", id: p.id, before: st } }, line: `Drop: 95% CI ${num(st.y - Z * nse)}–${num(st.y + Z * nse)}${nn ? `, as if ≈ ${nn.toLocaleString("en")} people` : ""}` };
    }
    if (p.kind === "pt") {
      const ny = clamp(Yof(x), dom.a, dom.b), nse = seOfY(y), nn = st.n ? Math.round(st.n * (se / nse) ** 2) : undefined;
      return { next: { ...s, studies: patch(p.id, q => ({ ...q, y: ny, v: nse * nse, n: nn })), last: { kind: "point", id: p.id, before: st } }, line: `Drop: ${st.label} ${config.measure} ${num(ny)}, SE ${fmt(nse, 2)}` };
    }
    if (p.kind === "chip") {
      if (y < drawerTop - 6) return { next: { ...s, studies: patch(p.id, q => ({ ...q, drawer: false })), last: { kind: "publish", id: p.id, before: st } }, line: `Drop to publish ${st.label} again` };
      return null;
    }
    return null;
  };
  const commit = (next: MaState, say: string) => { h.commit(next); onChange?.(); setStatus(say); };
  const { svgRef, drag, begin, handlers } = useSvgDrag<Payload>(d => {
    if (!d.moved) return;
    const pv = preview(d.payload, d.x, d.y);
    if (pv) { if (pv.next.studies.length > 0 && pv.next.studies.filter(x => !x.drawer).length < 2) { setStatus("At least two trials must stay published."); return; } commit(pv.next, pv.line.replace(/^Drop(: | to )/, "Done: ")); }
  });
  const pvRaw = drag?.moved ? preview(drag.payload, drag.x, drag.y) : null;
  const pv = pvRaw && pvRaw.next.studies.filter(x => !x.drawer).length >= 2 ? pvRaw : null;
  const shown = pv ? pv.next : s;
  const F = pv ? fitOf(shown) : fit;
  const dragLine = pvRaw ? (pv ? `${pvRaw.line}. Pooled ${config.measure} ${F ? num((shown.model === "fixed" ? F.fixed : F.random).y) : "—"}` : "At least two trials must stay published") : drag?.moved ? "Drag it back up to publish it" : "";

  /* ---------- words ---------- */
  const P = (f: MetaFit | null, m = s.model) => (f ? (m === "fixed" ? f.fixed : f.random) : null);
  const ci = (p: { y: number; lo: number; hi: number }) => `${num(p.y)} (95% CI ${num(p.lo)}–${num(p.hi)})`;
  const modelName = (m: string) => (m === "fixed" ? "fixed-effect" : "random-effects");
  const active = s.studies.filter(x => !x.drawer), filed = s.studies.filter(x => x.drawer);
  const wOf = (f: MetaFit | null, id: string, m = s.model) => { if (!f) return 0; const i = active.findIndex(x => x.id === id); return i < 0 ? 0 : (m === "fixed" ? f.fixed.w : f.random.w)[i]; };
  const eg = egger(active);
  const EGGER_MIN = 10; // Cochrane Handbook v6.5 §13.3.4.4: asymmetry tests only with at least 10 studies
  let instruction: string, tone: Tone = "neutral";
  /* Incremental feedback compares with the state just before the last move; the preset is only used where labelled "at the start". */
  const prevS = h.prev ?? start(), fitPrev = useMemo(() => fitOf(prevS), [prevS]);
  const prevActive = prevS.studies.filter(x => !x.drawer);
  const wPrev = (id: string, m = s.model) => { if (!fitPrev) return 0; const i = prevActive.findIndex(x => x.id === id); return i < 0 ? 0 : (m === "fixed" ? fitPrev.fixed.w : fitPrev.random.w)[i]; };
  const L = s.last, cur = P(fit), was = P(fitPrev), atStart = P(fit0);
  const favour = (y: number) => (y < 0 ? config.favours[0] : config.favours[1]);
  const pct = (w: number) => `${Math.round(w * 100)}%`;
  const width = (p: { lo: number; hi: number }) => p.hi - p.lo;
  const causes = "Several mechanisms produce funnel-plot asymmetry: non-reporting, bias in small studies, true heterogeneity, artefact and chance.";
  if (!L) instruction = `Each square is one trial; its area is its weight. Drag a square sideways to change its result, drag a whisker end to change its precision, or drop a trial in the file drawer below.`;
  else if (L.kind === "model") {
    const big = [...active].sort((a, b) => wOf(fit, b.id, "fixed") - wOf(fit, a.id, "fixed"))[0];
    tone = "good";
    if (fit!.tau2 <= 1e-12) instruction = `Estimated between-study variance is zero (τ² = 0: Q = ${fmt(fit!.q, 1)} is not above its ${fit!.df} df), so both fits give the same weights and interval here: ${ci(fit!.fixed)}. With ${plural(active.length, "trial")}, heterogeneity is uncertain.`;
    else if (s.model === "random") {
      const wf = wOf(fit, big.id, "fixed"), wr = wOf(fit, big.id, "random"), dw = width(fit!.random) - width(fit!.fixed);
      instruction = `Random effects assumes the true effect differs between trials and adds τ² = ${fmt(fit!.tau2, 3)} (DerSimonian–Laird) to every trial's variance, which evens out the weights: ${big.label} ${Math.round(wf * 100) === Math.round(wr * 100) ? `stays at ${pct(wr)}` : `goes from ${pct(wf)} under fixed effect to ${pct(wr)}`}. The random-effects interval is ${Math.abs(dw) < 1e-9 ? "the same width as" : dw > 0 ? "wider than" : "narrower than"} the fixed-effect one: ${ci(fit!.random)} vs ${ci(fit!.fixed)}.`;
    } else instruction = `Fixed effect assumes one common effect and weights by 1/SE² alone: ${big.label} carries ${pct(wOf(fit, big.id, "fixed"))}. Pooled ${config.measure} ${ci(fit!.fixed)}. Here τ² = ${fmt(fit!.tau2, 3)} and I² = ${pct(fit!.i2)}; whether one common effect is plausible depends on how large the differences between trials are and in which direction, and with ${plural(active.length, "trial")} that is estimated imprecisely.`;
  } else if (L.kind === "drawer" || L.kind === "publish") {
    const b = L.before!;
    tone = L.kind === "drawer" ? "warn" : "neutral";
    instruction = L.kind === "drawer"
      ? `${b.label} is in the file drawer. Removing this study changed the pooled ${config.measure} from ${was ? num(was.y) : "—"} to ${cur ? ci(cur) : "—"}. If whether a trial is published depends on its result, the published estimate can be biased. ${causes}${active.length < EGGER_MIN ? ` With ${plural(active.length, "trial")}, asymmetry tests have little power; the Cochrane Handbook advises them only with ${EGGER_MIN} or more, so no Egger p-value is shown.` : ""}`
      : `${b.label} is back in the analysis. Pooled ${config.measure} ${cur ? ci(cur) : "—"} (was ${was ? num(was.y) : "—"} before this move).`;
  } else {
    const b = L.before!, now = byId(s, L.id!);
    const w0 = wPrev(b.id), w1 = wOf(fit, b.id);
    const vChanged = Math.abs(now.v - b.v) > 1e-12, yChanged = Math.abs(now.y - b.y) > 1e-9;
    if (L.kind === "precision" || (vChanged && !yChanged)) {
      tone = "good";
      instruction = `${now.label}'s CI is now ${num(now.y - Z * Math.sqrt(now.v))}–${num(now.y + Z * Math.sqrt(now.v))}${now.n ? ` (as if ≈ ${now.n.toLocaleString("en")} people)` : ""}. Its weight went from ${pct(w0)} to ${pct(w1)}: inverse-variance weights depend on precision, 1/(SE²${s.model === "random" ? " + τ²" : ""}). Pooled ${config.measure} ${cur ? ci(cur) : "—"}.`;
    } else {
      const fixedW0 = wPrev(b.id, "fixed"), fixedW1 = wOf(fit, b.id, "fixed");
      tone = "neutral";
      const wLine = vChanged ? `Its fixed-effect weight went from ${pct(fixedW0)} to ${pct(fixedW1)} because its precision changed too; the result itself never earns weight` : `Its fixed-effect weight is unchanged (${pct(fixedW1)}): a result never earns weight, only precision does`;
      instruction = `${now.label} now shows ${config.measure} ${num(now.y)} (favours ${favour(now.y)}). ${wLine}${s.model === "random" ? `, though under random effects τ² changed to ${fmt(fit!.tau2, 3)}, so the random-effects weights shifted` : ""}. Pooled ${config.measure} ${cur ? ci(cur) : "—"}; I² = ${pct(fit?.i2 ?? 0)}.`;
      if (Math.sqrt(now.v) > median(s.studies.map(x => Math.sqrt(x.v))) && now.y < b.y && now.y < (fit?.fixed.y ?? 0)) { tone = "warn"; instruction += ` A small trial with a large effect sits low on the ${config.favours[0] === favour(-1) ? "left" : "right"} of the funnel. If such trials pile up on one side, the plot looks asymmetric. ${causes}`; }
    }
  }

  /* ---------- share ---------- */
  const touched = h.moves > 0;
  const unchanged = touched && s.model === start().model && s.studies.every((x, i) => x.y === initial[i].y && x.v === initial[i].v && !x.drawer);
  const share: ShareSummary | undefined = touched && fit ? (() => {
    const p = P(fit)!;
    const big = [...active].sort((a, b) => wOf(fit, b.id) - wOf(fit, a.id))[0];
    const edited = s.studies.filter((x, i) => x.y !== initial[i].y || x.v !== initial[i].v);
    const learner = unchanged ? `I tried changes and undid them; the ${modelName(s.model)} pooled ${config.measure} is still ${ci(p)}.`
      : `With ${plural(active.length, "trial")}${filed.length ? ` (${listWords(filed.map(x => x.label))} filed away)` : ""}${edited.length ? ` and ${listWords(edited.map(x => x.label))} changed` : ""}, the ${modelName(s.model)} pooled ${config.measure} is ${ci(p)} and I² is ${Math.round(fit.i2 * 100)}%.`;
    const bits = [
      `Each trial's weight is the inverse of its variance${s.model === "random" ? " plus τ²" : ""}, so ${big.label} carries ${Math.round(wOf(fit, big.id) * 100)}% here.`,
      `Fixed effect gives ${ci(fit.fixed)}; random effects (DerSimonian–Laird, τ² = ${fmt(fit.tau2, 3)}) gives ${ci(fit.random)}.`,
      `I² = ${Math.round(fit.i2 * 100)}% (from Cochran's Q, (Q − df)/Q) is the share of the variability in results beyond what chance would produce. The Cochrane Handbook v6.5 (§10.10.2) gives a rough guide with overlapping ranges, and ${Math.round(fit.i2 * 100)}% falls in ${i2Words(fit.i2)}; how much it matters depends on the size and direction of the effects and the strength of evidence for heterogeneity (Q = ${fmt(fit.q, 1)} on ${fit.df} df, p = ${fmt(fit.pQ, 3)}). With ${plural(active.length, "trial")}, I² and τ² are uncertain.`,
      p.hi < 0 || p.lo > 0 ? `The interval excludes ${ratio ? "1" : "0"}, favouring ${favour(p.y)}.` : `The interval includes ${ratio ? "1" : "0"}.`,
    ];
    if (filed.length) bits.push(`Compared with the start of this exercise (all ${initial.length} trials as reported), the pooled estimate moved from ${atStart ? num(atStart.y) : "—"} to ${num(p.y)}${edited.length ? ", including my edits to results" : ""}. Leaving ${listWords(filed.map(x => x.label))} out shows how sensitive the estimate is to omission; it does not show why a trial goes unpublished. If availability depends on the result, the published estimate can be biased. ${causes}`);
    if (active.length >= EGGER_MIN && eg) bits.push(`Egger's test: intercept ${fmt(eg.intercept, 2)}, p = ${fmt(eg.p, 2)}; asymmetry has several possible causes besides non-reporting.`);
    else bits.push(`No Egger p-value: with ${plural(active.length, "trial")} asymmetry tests have little power, and the Cochrane Handbook v6.5 (ch. 13) advises them only with ${EGGER_MIN} or more.`);
    bits.push("Educational analysis, not for clinical use.");
    return { learner, reply: bits.join(" "),
      data: `meta · ${s.model} · ${config.measure} ${fmt(show(p.y), 3)} [${fmt(show(p.lo), 3)},${fmt(show(p.hi), 3)}] · FE ${fmt(show(fit.fixed.y), 3)} · RE ${fmt(show(fit.random.y), 3)} · I2 ${fmt(fit.i2 * 100, 1)} · tau2 ${fmt(fit.tau2, 4)} · Q ${fmt(fit.q, 2)} · drawer [${filed.map(x => x.id).join(",")}] · edited [${edited.map(x => x.id).join(",")}] · ${h.moves} moves` };
  })() : undefined;

  /* ---------- drawing ---------- */
  const actShown = shown.studies.filter(x => !x.drawer);
  const wShown = (id: string) => { if (!F) return 0; const i = actShown.findIndex(x => x.id === id); return i < 0 ? 0 : (shown.model === "fixed" ? F.fixed.w : F.random.w)[i]; };
  const diamond = (p: { y: number; lo: number; hi: number }, y: number, cls: string) =>
    <path d={`M${X(Math.max(p.lo, dom.a))} ${y}L${X(p.y)} ${y - 7}L${X(Math.min(p.hi, dom.b))} ${y}L${X(p.y)} ${y + 7}Z`} className={`ml-diamond ${cls}`} />;
  const pooledRows: ["fixed" | "random", string][] = [["fixed", "Fixed effect"], ["random", "Random effects"]];
  const fe = F?.fixed;
  const canvas = <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ml-svg" {...handlers} role="img"
    aria-label={`Forest plot of ${k} trials. Pooled ${config.measure} ${cur ? ci(cur) : "not available"}.`}>
    <text x={6} y={18} className="ml-small is-strong">Trial</text>
    <text x={W - 8} y={18} textAnchor="end" className="ml-small is-strong">{compact ? "weight" : `${config.measure} [95% CI] · weight`}</text>
    <line x1={nullX} x2={nullX} y1={top - 4} y2={axisY} className="ml-null" />
    {fe && <line x1={X((shown.model === "fixed" ? F!.fixed : F!.random).y)} x2={X((shown.model === "fixed" ? F!.fixed : F!.random).y)} y1={top - 4} y2={axisY} className="ml-pooled-line" />}
    {s.studies.map((st, i) => {
      const sh = byId(shown, st.id); const y = rowY(i); const se = Math.sqrt(sh.v);
      const lo = sh.y - Z * se, hi = sh.y + Z * se, w = wShown(st.id), side = Math.sqrt(w) * (compact ? 24 : 30); // area ∝ weight (the hit target below keeps a 22 px minimum)
      const lifted = drag?.moved && drag.payload.kind === "sq" && drag.payload.id === st.id && drag.y > drawerTop - 6;
      const changed = sh.y !== initial[i].y || sh.v !== initial[i].v;
      return <g key={st.id} className={`ml-study${sh.drawer ? " is-filed" : ""}${changed ? " is-changed" : ""}`} data-study={st.id}>
        <text x={6} y={y + 4} className="ml-study-label">{compact ? shortLabel(st.label) : st.label}</text>
        {!sh.drawer && <>
          <line x1={X(Math.max(lo, dom.a))} x2={X(Math.min(hi, dom.b))} y1={y} y2={y} className="ml-ci" />
          {([-1, 1] as const).map(sd => { const xv = X(clamp(sd < 0 ? lo : hi, dom.a, dom.b)); return <g key={sd} className="ml-cap" data-cap={`${st.id}:${sd}`} onPointerDown={e => begin(e, { kind: "cap", id: st.id, side: sd })}>
            <line x1={xv} x2={xv} y1={y - 5} y2={y + 5} /><rect x={xv - 9} y={y - 11} width={18} height={22} className="ml-hit" /></g>; })}
          <g className="ml-square" data-square={st.id} onPointerDown={e => begin(e, { kind: "sq", id: st.id })}>
            <rect x={X(sh.y) - side / 2} y={y - side / 2} width={side} height={side} />
            <rect x={X(sh.y) - Math.max(side, 22) / 2} y={y - 11} width={Math.max(side, 22)} height={22} className="ml-hit" />
          </g>
          <text x={W - 8} y={y + 4} textAnchor="end" className="ml-study-num">{compact ? `${Math.round(w * 100)}%` : `${num(sh.y)} [${num(lo)}, ${num(hi)}] · ${(w * 100).toFixed(1)}%`}</text>
        </>}
        {sh.drawer && <text x={px0} y={y + 4} className="ml-small">in the file drawer</text>}
        {lifted && <rect x={drag!.x - 8} y={drag!.y - 8} width={16} height={16} className="ml-square-ghost" />}
      </g>;
    })}
    {F && pooledRows.map(([m, lab], j) => {
      const p = m === "fixed" ? F.fixed : F.random, y = pooledTop + j * rowH + rowH / 2;
      return <g key={m} className={`ml-pooled${shown.model === m ? " is-active" : ""}`} data-pooled={m}>
        <text x={6} y={y + 4} className="ml-study-label">{lab}</text>
        {diamond(p, y, shown.model === m ? "is-active" : "")}
        <text x={W - 8} y={y + 4} textAnchor="end" className="ml-study-num">{compact ? num(p.y) : `${num(p.y)} [${num(p.lo)}, ${num(p.hi)}]`}</text>
      </g>;
    })}
    <line x1={px0} x2={px1} y1={axisY} y2={axisY} className="ml-axis" />
    {ticks.map(t => <text key={t} x={X(t)} y={axisY + 13} textAnchor="middle" className="ml-tick">{ratio ? +Math.exp(t).toPrecision(2) : +t.toPrecision(3)}</text>)}
    <text x={compact ? 6 : nullX - 6} y={axisY + 27} textAnchor={compact ? "start" : "end"} className="ml-tick">← favours {config.favours[0]}</text>
    <text x={compact ? W - 8 : nullX + 6} y={axisY + 27} textAnchor={compact ? "end" : "start"} className="ml-tick">favours {config.favours[1]} →</text>
    <g className={`ml-drawer${drag?.moved && drag.payload.kind === "sq" && drag.y > drawerTop - 6 ? " is-hot" : ""}`}>
      <rect x={6} y={drawerTop} width={W - 12} height={drawerH} rx={8} className="ml-zone-line" />
      <text x={14} y={drawerTop + 15} className="ml-zone-label">File drawer (unpublished)</text>
      {!filed.length && <text x={14} y={drawerTop + 32} className="ml-zone-empty">drag a trial's square here to leave it out</text>}
      {filed.map((st, i) => {
        const lifted = drag?.moved && drag.payload.kind === "chip" && drag.payload.id === st.id;
        const cw = compact ? 92 : 128, x = 14 + i * (cw + 6);
        return <g key={st.id} className={`ml-chip${lifted ? " is-lifted" : ""}`} data-chip={st.id} transform={lifted ? `translate(${drag!.x - drag!.x0} ${drag!.y - drag!.y0})` : undefined}
          onPointerDown={e => begin(e, { kind: "chip", id: st.id })}>
          <rect x={x} y={drawerTop + 19} width={cw} height={18} rx={4} /><text x={x + cw / 2} y={drawerTop + 32} textAnchor="middle">{st.label.length > (compact ? 12 : 17) ? st.label.slice(0, compact ? 11 : 16) + "…" : st.label}</text>
        </g>;
      })}
    </g>
    <g className="ml-funnel">
      <text x={6} y={funTop - 10} className="ml-small is-strong">Funnel plot</text>
      <text x={W - 8} y={compact ? funTop + FH + 28 : funTop - 10} textAnchor="end" className="ml-small">{actShown.length < EGGER_MIN ? `Egger test not shown: needs ≥ ${EGGER_MIN} trials` : eg ? `Egger p = ${fmt(eg.p, 2)}` : ""}</text>
      <line x1={px0} x2={px0} y1={funTop} y2={funTop + FH} className="ml-axis" />
      <line x1={px0} x2={px1} y1={funTop + FH} y2={funTop + FH} className="ml-axis" />
      <text x={px0 - 4} y={funTop + 4} textAnchor="end" className="ml-tick">SE 0</text>
      <text x={px0 - 4} y={funTop + FH} textAnchor="end" className="ml-tick">{fmt(dom.maxSe, 2)}</text>
      {fe && <path d={`M${X(clamp(fe.y - Z * dom.maxSe, dom.a, dom.b))} ${FY(Math.min(dom.maxSe, (fe.y - dom.a) / Z))}L${X(fe.y)} ${funTop}L${X(clamp(fe.y + Z * dom.maxSe, dom.a, dom.b))} ${FY(Math.min(dom.maxSe, (dom.b - fe.y) / Z))}`} className="ml-funnel-limits" />}
      {fe && <line x1={X(fe.y)} x2={X(fe.y)} y1={funTop} y2={funTop + FH} className="ml-pooled-line" />}
      <line x1={nullX} x2={nullX} y1={funTop} y2={funTop + FH} className="ml-null" />
      {shown.studies.map(st => <g key={st.id} className={`ml-fpoint${st.drawer ? " is-filed" : ""}`} data-point={st.id} onPointerDown={e => { if (!st.drawer) begin(e, { kind: "pt", id: st.id }); }}>
        <circle cx={X(st.y)} cy={FY(Math.min(Math.sqrt(st.v), dom.maxSe))} r={5} />
        <circle cx={X(st.y)} cy={FY(Math.min(Math.sqrt(st.v), dom.maxSe))} r={14} className="ml-hit" />
      </g>)}
      <text x={px1} y={funTop + FH + 14} textAnchor="end" className="ml-tick">{config.measure}{ratio ? " (log scale)" : ""}, dashed: pseudo 95% limits</text>
    </g>
  </svg>;

  const setModel = (m: "fixed" | "random") => { if (m !== s.model) commit({ ...s, model: m, last: { kind: "model" } }, `${modelName(m)} model.`); };
  const below = <div className="ml-meta-facts">
    <div className="ml-seg" role="group" aria-label="Model">
      <button type="button" aria-pressed={s.model === "fixed"} onClick={() => setModel("fixed")}>Fixed effect</button>
      <button type="button" aria-pressed={s.model === "random"} onClick={() => setModel("random")}>Random effects</button>
    </div>
    <dl className="ml-facts">
      <div className="ml-fact"><dt>Pooled {config.measure}</dt><dd>{cur ? ci(cur) : "needs 2 trials"}</dd></div>
      <div className="ml-fact"><dt>Heterogeneity</dt><dd>{fit ? `I² ${Math.round(fit.i2 * 100)}% · τ² ${fmt(fit.tau2, 3)} · Q ${fmt(fit.q, 1)} (df ${fit.df}, p ${fmt(fit.pQ, 3)})` : "—"}</dd></div>
    </dl>
  </div>;

  const [pick, setPick] = useState(config.studies[0].id);
  const pk = byId(s, pick) ?? s.studies[0];
  const controls = <div className="ml-control-row">
    <label className="ml-select">Trial<select aria-label="Trial" value={pick} onChange={e => setPick(e.currentTarget.value)}>{s.studies.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <button type="button" className="ml-btn" disabled={pk.drawer} onClick={() => commit({ ...s, studies: patch(pk.id, q => ({ ...q, y: clamp(q.y - (dom.b - dom.a) / 20, dom.a, dom.b) })), last: { kind: "effect", id: pk.id, before: pk } }, `${pk.label} moved left.`)}>Result ←</button>
    <button type="button" className="ml-btn" disabled={pk.drawer} onClick={() => commit({ ...s, studies: patch(pk.id, q => ({ ...q, y: clamp(q.y + (dom.b - dom.a) / 20, dom.a, dom.b) })), last: { kind: "effect", id: pk.id, before: pk } }, `${pk.label} moved right.`)}>Result →</button>
    <button type="button" className="ml-btn" disabled={pk.drawer} onClick={() => { const nse = clamp(Math.sqrt(pk.v) / 1.5, dom.minSe, dom.maxSe); commit({ ...s, studies: patch(pk.id, q => ({ ...q, v: nse * nse, n: q.n ? Math.round(q.n * 2.25) : undefined })), last: { kind: "precision", id: pk.id, before: pk } }, `${pk.label} made more precise.`); }}>More precise</button>
    <button type="button" className="ml-btn" disabled={pk.drawer} onClick={() => { const nse = clamp(Math.sqrt(pk.v) * 1.5, dom.minSe, dom.maxSe); commit({ ...s, studies: patch(pk.id, q => ({ ...q, v: nse * nse, n: q.n ? Math.round(q.n / 2.25) : undefined })), last: { kind: "precision", id: pk.id, before: pk } }, `${pk.label} made less precise.`); }}>Less precise</button>
    <button type="button" className="ml-btn" disabled={!pk.drawer && active.length <= 2} onClick={() => commit({ ...s, studies: patch(pk.id, q => ({ ...q, drawer: !q.drawer })), last: { kind: pk.drawer ? "publish" : "drawer", id: pk.id, before: pk } }, pk.drawer ? `${pk.label} published again.` : `${pk.label} filed away.`)}>{pk.drawer ? "Publish again" : "File away"}</button>
  </div>;

  return <Shell mode="meta" title={config.title} count={`${plural(active.length, "trial")} · ${s.model === "fixed" ? "fixed effect" : "random effects"}`} canvasRef={ref} dragging={!!drag?.moved}
    dragLine={dragLine} canvas={canvas} below={below} instruction={instruction} tone={tone} controls={controls} status={status}
    share={share} onShare={onShare} canUndo={h.canUndo} onUndo={() => { h.undo(); onChange?.(); setStatus("Undone."); }} acted={touched}
    onReset={() => { h.reset(); onChange?.(); setStatus("Back to the start."); }}
    caption={<SourceLine text={`Educational analysis, not for clinical use.${config.source ? ` ${config.source}` : ""}`} />} />;
}

/** "Ferguson & Simes 1949" → "Ferguson 1949" for narrow screens (keeps trials with the same author apart by year). */
const shortLabel = (l: string) => { const yr = /\s(\d{4})$/.exec(l)?.[1]; const first = l.split(/\s|&/)[0]; const s = yr ? `${first} ${yr}` : l; return s.length > 15 ? s.slice(0, 14) + "…" : s; };
/** Cochrane Handbook v6.5 §10.10.2 rough guide for I²: the ranges overlap on purpose. */
const I2_GUIDE: [number, number, string][] = [[0, 0.4, "“might not be important” (0–40%)"], [0.3, 0.6, "“may represent moderate heterogeneity” (30–60%)"], [0.5, 0.9, "“may represent substantial heterogeneity” (50–90%)"], [0.75, 1, "“considerable heterogeneity” (75–100%)"]];
export const i2Words = (i2: number) => { const r = Math.round(i2 * 100) / 100; return listWords(I2_GUIDE.filter(([a, b]) => r >= a && r <= b).map(g => g[2])); };
const median = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function niceTicks(a: number, b: number) {
  const span = b - a, step0 = Math.pow(10, Math.floor(Math.log10(span / 4))), step = [1, 2, 5, 10].map(m => m * step0).find(st => span / st <= 6) ?? step0 * 10;
  const out: number[] = []; for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(+t.toFixed(10)); return out;
}
