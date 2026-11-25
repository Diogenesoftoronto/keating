/* Everything the explorer says, derived from the aggregation the learner built. Scripted, no LLM. */
import * as M from "./model";
import type { Data, State, Agg, Reading } from "./model";

export type Tone = "info" | "ok" | "warn";
/** `split`: a field the learner can split the compared bars by, straight from the comparison. */
export type Said = { tone: Tone; head: string; body: string[]; split?: string };

const val = (d: Data, g: Agg, s: State) => M.fmtValue(d, M.valueOf(d, g, s.view), s.view);
/** "93% (81/87)" · "73.0 (n=45)" · "263": a rate never appears without its n. */
export function withN(d: Data, g: Agg, view: M.View) {
  const v = M.fmtValue(d, M.valueOf(d, g, view), view);
  if (view === "count" || d.measure.kind === "count") return v;
  if (d.measure.kind === "rate") return `${v} (${Math.round(g.s)}/${Math.round(g.n)})`;
  return `${v} (n=${Math.round(g.n)})`;
}
const names = (d: Data) => ({ A: d.values[d.compare!][d.pair![0]], B: d.values[d.compare!][d.pair![1]] });
const fieldsLabel = (d: Data, fs: string[]) => M.joinAnd(fs.map(f => d.label(f)));
const higherLower = (d: Data, x: number) => {
  if (d.measure.kind === "rate") return x > 0 ? "higher" : "lower";
  if (d.measure.kind === "mean") return x > 0 ? "higher" : "lower";
  return x > 0 ? "more" : "fewer";
};
const measureName = (d: Data, view: M.View) => (view === "count" ? "cases" : (d.measure.label ?? "value").toLowerCase());
/** "Small stones", "Dept B", from a stratum's assignment. */
const smallNote = (d: Data, x: M.Stratum, s: State) => {
  const { A, B } = names(d);
  const [g, who] = x.A.n <= x.B.n ? [x.A, A] : [x.B, B];
  if (d.measure.kind === "rate" && s.view === "measure") return `${x.label}: only ${Math.round(g.n)} for ${who}, so that rate could be off by about ±${Math.round(M.margin(g.m, g.n) * 100)} points by chance.`;
  return `${x.label}: only ${Math.round(g.n)} for ${who}, a small group.`;
};

/** Name a set of strata: "Dept A, B, D and F", "Small", "Calculus · Fall and History · Spring". */
export function strataNames(d: Data, r: { by: string[] }, xs: M.Stratum[]) {
  if (r.by.length === 1) return M.listLabel(d, r.by[0], xs.map(x => x.a[r.by[0]]));
  return M.joinAnd(xs.map(x => x.label));
}
/** Who leads where: "The gap favours Women in Dept A, B, D and F; it still favours Men in Dept C and E." */
export function sidesSentence(d: Data, r: Extract<Reading, { strata: unknown }>, still = true) {
  const { A, B } = names(d);
  const w = r.W > 0 || (Math.abs(r.W) < 1e-12 && r.D > 0) ? A : B, o = w === A ? B : A;
  const parts = [`The gap favours ${w} in ${strataNames(d, r, r.withW)}`];
  if (r.againstW.length) parts.push(`it${still ? " still" : ""} favours ${o} in ${strataNames(d, r, r.againstW)}`);
  if (r.even.length) parts.push(`${strataNames(d, r, r.even)} ${r.even.length === 1 ? "is" : "are"} about even`);
  return parts.join("; ") + ".";
}

export function mixSentence(d: Data, s: State, mix: M.Mix) {
  const { A, B } = names(d);
  const z = d.values[mix.z][mix.worst];
  return `${M.pct(mix.shareA[mix.worst])} of ${A}’s cases were ${z}, against ${M.pct(mix.shareB[mix.worst])} of ${B}’s`;
}

export function describe(d: Data, s: State, flags: { seenFlip: boolean }): Said {
  const r = M.read(d, s);
  const f = M.filterAssign(s);
  const filt = s.filter ? ` (only ${d.label(s.filter)} = ${d.values[s.filter][s.filterValue]})` : "";
  if (!r) return generic(d, s);
  const { A, B } = names(d);
  const C = d.label(d.compare!);
  if (r.kind === "no-compare") {
    if (r.why === "filtered") return { tone: "info", head: `Filtered to one ${C.toLowerCase()}, so there’s nothing to compare it with.`, body: [`Drag ${C} out of “keep only” onto the chart to put ${A} and ${B} side by side.`] };
    const g = generic(d, s);
    return { tone: "info", head: `${C} isn’t in the chart, so ${A} and ${B} are pooled together${filt}.`, body: [...g.body, `Drag ${C} back onto the chart to compare them.`] };
  }
  if (s.view === "count") {
    if (r.kind === "overall") {
      const lk = M.lurking(d, s);
      return { tone: "info", head: `${A} has ${Math.round(r.A.n)} cases and ${B} has ${Math.round(r.B.n)}${filt}.`, body: [lk && flags.seenFlip ? `Group by ${d.label(lk.z)} to see how differently they’re spread: ${mixSentence(d, s, lk)}.` : `Counts alone don’t say what kinds of cases each got. Group by another field and look at the mix.`] };
    }
    const z = r.by[0], mix = M.mixOf(d, s, z);
    return { tone: mix && mix.gap > 0.15 ? "warn" : "info", head: `Counts show who got which cases.`, body: mix ? [`${mixSentence(d, s, mix)}.`, mix.gap > 0.15 ? `That’s a very different mix of ${d.label(z).toLowerCase()}.` : `The two groups have a similar mix of ${d.label(z).toLowerCase()}.`] : [] };
  }
  const lead = r.D >= 0 ? A : B, trail = r.D >= 0 ? B : A;
  const [gl, gt] = r.D >= 0 ? [r.A, r.B] : [r.B, r.A];
  const overall = `${lead} ${withN(d, gl, s.view)} vs ${trail} ${withN(d, gt, s.view)}`;
  if (r.kind === "overall") {
    const body = [`${M.fmtGap(d, r.D, s.view)} in ${lead}’s favour${filt}.`];
    if (s.filter && d.reveal.includes(s.filter)) {
      const un = M.read(d, { ...s, filter: null });
      if (un && un.kind === "overall" && Math.sign(un.D) !== Math.sign(r.D)) body.push(`That’s the opposite of the result for all cases. Check the other ${d.label(s.filter).toLowerCase()} values too, or group by ${d.label(s.filter)} to see them side by side.`);
    }
    const lk = M.lurking(d, s);
    if (flags.seenFlip && lk && lk.gap > 0.15) body.push(`But you’re comparing ${val(d, r.A, s)} vs ${val(d, r.B, s)} across groups with very different mixes: ${mixSentence(d, s, lk)}.`);
    else if (!flags.seenFlip) body.push(`Before reading this as “${trail} did worse”, ask what else differs between the two groups.`);
    return { tone: "info", head: `Overall: ${overall}.`, body };
  }
  const Z = fieldsLabel(d, r.by);
  const list = r.strata.slice(0, 4).map(x => `${x.label}: ${A} ${val(d, x.A, s)} vs ${B} ${val(d, x.B, s)}`);
  const more = r.strata.length > 4 ? [`…and ${r.strata.length - 4} more in the table.`] : [];
  const smalls = r.strata.filter(x => x.small).slice(0, 2).map(x => smallNote(d, x, s));
  if (r.kind === "flip") {
    const winner = r.W > 0 ? A : B, z = Z.toLowerCase();
    if (r.every) return { tone: "ok", head: `Within each ${z}, the gap favours ${winner}.`,
      body: [list.join(" · ") + ".", ...more, `Overall it’s the reverse: ${overall}.`, `Grouping by ${Z} reverses the conclusion in every ${z}.`, ...smalls] };
    /* a case-weighted reversal that not every group shares: say so, and name both sides */
    return { tone: "ok", head: `Reversed on average: weighting each ${z} by its cases, the gap favours ${winner} by ${M.fmtGap(d, r.W, s.view)}.`,
      body: [sidesSentence(d, r), `Overall it’s the other way: ${overall}.`, `So grouping by ${Z} reverses the conclusion on average, not in every ${z}.`, ...smalls] };
  }
  if (r.kind === "stable") {
    const gaps = r.strata.slice(0, 4).map(x => `${x.label} ${M.fmtGap(d, x.d, s.view, true)}`).join(", ") + (r.strata.length > 4 ? `, and ${r.strata.length - 4} more in the table` : "");
    const body = [`Gaps: ${gaps}; overall ${M.fmtGap(d, r.D, s.view, true)}.`, `Grouping by ${Z} doesn’t change the conclusion.`];
    const rel = Math.abs(r.W - r.D) / Math.max(Math.abs(r.D), 1e-9);
    if (rel > 0.08) body.push(`The gap is ${Math.abs(r.W) > Math.abs(r.D) ? "a little bigger" : "a little smaller"} within groups (${M.fmtGap(d, r.W, s.view)} on average) than overall (${M.fmtGap(d, r.D, s.view)}), because the groups have different mixes, but the direction holds.`);
    return { tone: "ok", head: `The gap favours ${lead} overall and in every ${Z.toLowerCase()}.`, body: [...body, ...smalls] };
  }
  return { tone: "warn", head: `Mixed: the gap favours ${A} in ${r.leadA} and ${B} in ${r.leadB} of ${r.strata.length} groups.`, body: [sidesSentence(d, r, false), list.join(" · ") + ".", ...more, `Overall: ${overall}, and the within-group gap leans the same way (${M.fmtGap(d, r.W, s.view)} on average).`, ...smalls] };
}

function generic(d: Data, s: State): Said {
  const dims = [...s.rows, ...s.cols];
  const f = M.filterAssign(s);
  const groups = M.tuples(d, s.rows).flatMap(rt => M.tuples(d, s.cols).map(ct => ({ ...f, ...M.assignOf(s.rows, rt), ...M.assignOf(s.cols, ct) })))
    .map(a => ({ a, g: M.agg(d, a) })).filter(x => x.g.n > 0);
  if (groups.length < 2) return { tone: "info", head: `All cases together: ${withN(d, groups[0]?.g ?? M.agg(d, f), s.view)}.`, body: [] };
  const v = (x: { g: Agg }) => M.valueOf(d, x.g, s.view);
  const hi = groups.reduce((a, b) => (v(b) > v(a) ? b : a)), lo = groups.reduce((a, b) => (v(b) < v(a) ? b : a));
  return { tone: "info", head: `${measureName(d, s.view)[0].toUpperCase()}${measureName(d, s.view).slice(1)} by ${fieldsLabel(d, dims)}.`, body: [`Highest: ${M.groupLabel(d, hi.a, dims)} ${withN(d, hi.g, s.view)}. Lowest: ${M.groupLabel(d, lo.a, dims)} ${withN(d, lo.g, s.view)}.`] };
}

/** What a bar-on-bar drop says. */
export function compareText(d: Data, s: State, srcA: M.Assign, tgtA: M.Assign, flags: { seenFlip: boolean }): Said {
  const dims = [...s.rows, ...s.cols];
  const name = (a: M.Assign) => M.groupLabel(d, a, dims);
  const gs = M.agg(d, srcA), gt = M.agg(d, tgtA);
  const diff = M.valueOf(d, gs, s.view) - M.valueOf(d, gt, s.view);
  const differ = dims.filter(k => srcA[k] !== tgtA[k]);
  const C = d.compare;
  const nums = `${name(srcA)} ${withN(d, gs, s.view)} vs ${name(tgtA)} ${withN(d, gt, s.view)}`;
  const gapSay = Math.abs(diff) < 1e-9 ? `No difference.` : `${name(srcA)} is ${M.fmtGap(d, diff, s.view)} ${higherLower(d, diff)}.`;
  const small = [gs, gt].some(g => g.n < d.small) && s.view === "measure"
    ? [d.measure.kind === "rate" ? `One of these is a small group: the rate for ${gs.n < gt.n ? name(srcA) : name(tgtA)} could be off by about ±${Math.round(M.margin(gs.n < gt.n ? gs.m : gt.m, Math.min(gs.n, gt.n)) * 100)} points by chance.` : `One of these is a small group (n=${Math.round(Math.min(gs.n, gt.n))}), so read the gap loosely.`]
    : [];
  if (!C || !differ.includes(C)) {
    const other = fieldsLabel(d, differ);
    return { tone: "info", head: `${nums}.`, body: [gapSay, C ? `Same ${d.label(C).toLowerCase()}, different ${other.toLowerCase()}: this gap is about the ${other.toLowerCase()}, not the ${d.label(C).toLowerCase()}.` : "", ...small].filter(Boolean) };
  }
  const others = differ.filter(k => k !== C);
  if (others.length) {
    return { tone: "warn", head: `${nums}.`, body: [`These bars differ in ${fieldsLabel(d, [C, ...others]).toLowerCase()}, so the ${M.fmtGap(d, diff, s.view)} gap mixes both.`, `To judge ${d.label(C).toLowerCase()}, compare bars that differ only in ${d.label(C).toLowerCase()}.`, ...small] };
  }
  const same = dims.filter(k => k !== C);
  if (!same.length) {
    const lk = M.lurking(d, s);
    const lopsided = !!lk && lk.gap > 0.15;
    const warn = lopsided && flags.seenFlip
      ? `But you’re comparing ${M.fmtValue(d, M.valueOf(d, gs, s.view), s.view)} vs ${M.fmtValue(d, M.valueOf(d, gt, s.view), s.view)} across groups with very different mixes: ${mixSentence(d, s, lk!)}.`
      : lopsided
      ? `This is the pooled comparison, and the two bars hold different cases: ${mixSentence(d, s, lk!)}. A pooled gap can come from that mix as well as from the ${d.label(C).toLowerCase()}. Split the bars and compare like with like.`
      : `This is the pooled comparison. It holds only if both groups had the same kinds of cases.`;
    return { tone: "info", head: `${nums}.`, body: [gapSay, warn, ...small], ...(lopsided && !dims.includes(lk!.z) ? { split: lk!.z } : {}) };
  }
  return { tone: "ok", head: `${nums}.`, body: [gapSay, `Like with like: both are ${same.map(k => d.values[k][srcA[k]]).join(" · ")}, so only ${d.label(C).toLowerCase()} differs.`, ...small] };
}

export type Explain = { z: string; lines: string[] };
export function explain(d: Data, s: State): Explain | null {
  const r = M.read(d, { ...s, view: "measure" }, "measure");
  if (!r || !("strata" in r)) return null;
  const cands = r.reveal.length ? r.reveal : r.by;
  let best: M.Mix | null = null;
  for (const z of cands) { const m = M.mixOf(d, s, z); if (m && (!best || m.gap > best.gap)) best = m; }
  if (!best) return null;
  const { A, B } = names(d);
  const z = best.z, Z = d.label(z).toLowerCase();
  const all = best.all.map((g, i) => ({ g, i })).filter(x => x.g.n > 0);
  const hard = all.reduce((a, b) => (b.g.m < a.g.m ? b : a)), easy = all.reduce((a, b) => (b.g.m > a.g.m ? b : a));
  const vz = (i: number) => d.values[z][i];
  const fm = (g: Agg) => M.fmtValue(d, g.m, "measure");
  const shareA = best.shareA[hard.i], shareB = best.shareB[hard.i];
  const heavier = shareA > shareB ? A : B, lighter = shareA > shareB ? B : A;
  const lines = [
    `${d.label(z)} matters: ${vz(hard.i)} ${fm(hard.g)} against ${vz(easy.i)} ${fm(easy.g)} for everyone together.`,
    `And the two groups got different mixes: ${M.pct(Math.max(shareA, shareB))} of ${heavier}’s cases were ${vz(hard.i)}, against ${M.pct(Math.min(shareA, shareB))} of ${lighter}’s.`,
  ];
  if (r.kind === "flip") lines.push(`Each overall number is an average of the numbers for each ${Z}, weighted by that group’s own mix. ${heavier}’s average leans on its ${vz(hard.i)} cases, so it comes out lower overall even though ${r.every ? `the gap favours ${r.W > 0 ? A : B} within each ${Z}` : `the case-weighted gap within ${Z} groups favours ${r.W > 0 ? A : B}. ${sidesSentence(d, r).replace(/\.$/, "")}`}.`);
  else {
    /* Say which weights were held fixed, and describe this dataset only. A uniformly signed gap can still
       reverse overall when the two sides have different mixes (the kidney preset does), so no general rule. */
    const fav = (x: number) => (x > 0 ? A : B);
    const sameW = `Weighting both sides by the same mix (each ${Z}’s share of all the cases), the gap is ${M.signed(d, r.W, "measure")}, favouring ${fav(r.W)}; with each side weighted by its own mix, as the overall numbers are, it is ${M.signed(d, r.D, "measure")}, favouring ${fav(r.D)}.`;
    if (r.kind === "stable")
      lines.push(`${sameW} In this data ${r.every ? `the gap favours ${fav(r.D)} inside every ${Z} and overall` : `${sidesSentence(d, r).replace(/\.$/, "")}, and overall it favours ${fav(r.D)}`}, so grouping by ${Z} doesn’t reverse the conclusion here. That is an observation about this dataset, not a rule: the different mixes could have reversed it if they were lopsided enough and ${Z} mattered enough, as in the kidney-stone data.`);
    else
      lines.push(`${sameW} ${sidesSentence(d, r)} Weighted either way, the gap points the same way as the pooled numbers in this data, so grouping by ${Z} doesn’t reverse the conclusion here.`);
  }
  if (d.config.question?.explain) lines.push(d.config.question.explain);
  return { z, lines };
}

export function shareSummary(d: Data, s: State, f: { seenFlip: boolean; explained: boolean; stratified: boolean; whatIfT: number | null }) {
  const r = M.read(d, { ...s, view: "measure" }, "measure");
  const ms = { ...s, view: "measure" as const };
  const caveat = d.config.question?.caveat ?? "";
  const dims = [...s.rows, ...s.cols];
  const layout = `rows=[${s.rows.join(",")}] cols=[${s.cols.join(",")}] filter=${s.filter ? `${s.filter}:${d.values[s.filter][s.filterValue]}` : "none"} view=${s.view}`;
  let crossNote = "", crossLearner = "";
  if (s.compare) {
    const bars = barAssigns(d, s);
    const a = bars.get(s.compare[0]), b = bars.get(s.compare[1]);
    if (a && b && d.compare) {
      const differ = dims.filter(k => a[k] !== b[k]);
      const t = compareText(d, ms, a, b, f);
      crossLearner = ` I compared ${t.head.replace(/\.$/, "")}.`;
      if (differ.includes(d.compare) && differ.length > 1) crossNote = `One thing first: those two bars differ in ${fieldsLabel(d, differ).toLowerCase()}, so that gap mixes both. `;
    }
  }
  const data = `${layout}; reading=${r ? r.kind : "none"}${r && "W" in r ? ` (within ${M.signed(d, r.W, "measure")}, overall ${M.signed(d, r.D, "measure")})` : ""}; seenFlip=${f.seenFlip}; explained=${f.explained}${f.whatIfT !== null ? `; whatIf=${Math.round(f.whatIfT * 100)}%` : ""}${s.compare ? `; compare=${s.compare.join(" vs ")}` : ""}`;
  if (!r || !d.compare) return { learner: `I looked at ${(d.measure.label ?? "the data").toLowerCase()} by ${fieldsLabel(d, dims) || "all cases"}.${crossLearner}`, data, reply: "Thanks. What pattern stands out to you, and what might explain it?" };
  const { A, B } = names(d);
  const expectFlip = d.config.question?.expect !== "no-flip";
  const fm = (g: Agg) => M.fmtValue(d, g.m, "measure");
  if (r.kind === "no-compare") return { learner: `I pooled ${A} and ${B} and looked at ${fieldsLabel(d, dims) || "everything"}.${crossLearner}`, data, reply: `${crossNote}That view mixes ${A} and ${B} together, so it can’t answer the question. Put ${d.label(d.compare)} back into the chart and compare.` };
  if (r.kind === "overall") {
    const lead = r.D >= 0 ? A : B, trail = r.D >= 0 ? B : A;
    return {
      learner: `Overall the gap favours ${lead} (${fm(r.D >= 0 ? r.A : r.B)} vs ${fm(r.D >= 0 ? r.B : r.A)}), so it looks like ${trail} did worse.${crossLearner}`, data,
      reply: `${crossNote}${expectFlip ? `That’s the headline number, but ${A} and ${B} didn’t necessarily get the same kinds of cases. Before deciding, group by another field and see whether the gap survives.` : `That’s the overall gap. Does it survive inside each group? Drag another field onto the chart’s axis and check before trusting it.`}`,
    };
  }
  const Z = fieldsLabel(d, r.by), z = Z.toLowerCase();
  const strata = r.strata.slice(0, 3).map(x => `${x.label} ${fm(x.A)} vs ${fm(x.B)}`).join(", ");
  const ex = explain(d, s);
  const mix = ex ? M.mixOf(d, s, ex.z) : null;
  if (r.kind === "flip") {
    const win = r.W > 0 ? A : B, lead = r.D >= 0 ? A : B;
    const every = r.every;
    const sides = sidesSentence(d, r).replace(/\.$/, "");
    return {
      learner: every
        ? `Grouped by ${z}, the gap favours ${win} in every ${z} (${A} vs ${B}: ${strata}), even though it favours ${lead} overall (${fm(r.A)} vs ${fm(r.B)}).${crossLearner}`
        : `Grouped by ${z}, the gap favours ${win} on average (${M.fmtGap(d, r.W, "measure")}, weighting each ${z} by its cases), even though it favours ${lead} overall (${fm(r.A)} vs ${fm(r.B)}). ${sides}.${crossLearner}`, data,
      reply: `${crossNote}Yes, that’s Simpson’s paradox${every ? "" : " on average"}. ${every ? `Within each ${z} the gap favours ${win}` : `Weighted by cases, the gap within ${z} groups favours ${win}, though not everywhere: ${sides}`}${mix ? `. But ${mixSentence(d, s, mix)}` : ""}. The overall number averages over different case mixes, so it penalises whoever took the harder cases. ${f.explained ? "" : "Open “Explain the flip” to see the weighting. "}${caveat}`.trim(),
    };
  }
  if (r.kind === "stable") {
    const lead = r.D >= 0 ? A : B;
    return {
      learner: `The gap favours ${lead} in every ${z} (${r.strata.slice(0, 4).map(x => `${x.label} by ${M.fmtGap(d, x.d, "measure", true)}`).join(", ")}) as well as overall, so grouping by ${z} doesn’t change it.${crossLearner}`, data,
      reply: `${crossNote}Right: the gap survives grouping by ${z}${expectFlip ? ", so this grouping doesn’t reveal a reversal. Try another field" : ""}. ${expectFlip ? "" : `A reversal needs a lopsided mix and a strong ${z} effect at the same time; here the mix only nudges the size of the gap. `}${caveat}`.trim(),
    };
  }
  return {
    learner: `Grouped by ${z}, it’s mixed: the gap favours ${A} in ${r.leadA} groups and ${B} in ${r.leadB}.${crossLearner}`, data,
    reply: `${crossNote}Mixed results across ${z} groups mean the overall gap is fragile. Look at the sizes: are the groups where one side wins also the small ones? ${caveat}`.trim(),
  };
}

/** gid → assignment for every bar in a state. */
export function barAssigns(d: Data, s: State) {
  const f = M.filterAssign(s);
  const out = new Map<string, M.Assign>();
  for (const rt of M.tuples(d, s.rows)) for (const ct of M.tuples(d, s.cols)) {
    const a = { ...f, ...M.assignOf(s.rows, rt), ...M.assignOf(s.cols, ct) };
    out.set(M.gidOf(d, a), a);
  }
  return out;
}

export type { Reading };
