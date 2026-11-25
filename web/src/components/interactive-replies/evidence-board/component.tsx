import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./component.css";

/* EvidenceBoard: the learner works on the text itself.
   - link: drag a sentence or clause of a source passage onto a claim and drop it where it lands
     (backs it / partly / undercuts). Leader lines tie each claim to its spans. Checked against config with
     a reason quoted from the passage for every judgement.
   - revise: the learner rewrites a draft by moving its sentences. Their draft starts as the first draft;
     they drag lines in from a revision or spare lines, drop a line on another to replace it, drag a line out
     to cut it, and the rubric under the draft responds live (and previews mid-drag) with the sentence that
     decides each row.
   Drags are custom pointer handling over HTML text with an SVG overlay (Dragology renders SVG only, and long
   prose reads badly as estimated SVG text). Every drag previews live. */

export type ShareSummary = { learner: string; data: string; reply: string };

/* ---------- config ---------- */
export type Relation = "supports" | "partial" | "contradicts";
export type ExpectedRelation = Relation | "irrelevant";
/** A unit of text the learner can pick. Spans snap to these; give clause-sized spans where a clause matters. */
export type PassageSpan = { id: string; text: string };
export type EvidenceLink = {
  spanId: string; relation: ExpectedRelation; why: string;
  /** key into config.gaps: the reasoning gap a learner shows by getting this link wrong */
  gap?: string;
  /** false: don't list it as "missed" when unattached (default: supports/contradicts are key) */
  key?: boolean;
};
export type EvidenceClaim = { id: string; text: string; verdict?: string; links: EvidenceLink[] };
export type ReasoningGap = { name: string; reply: string };
type Common = { title: string; instructions?: string; gaps?: Record<string, ReasoningGap>; perfectReply?: string };
export type EvidenceLinkConfig = Common & {
  mode: "link";
  /** paragraphs: a string is split into sentences (ids p1s1, p1s2, …); an array gives explicit spans */
  passage: { headline?: string; source?: string; paragraphs: (string | PassageSpan[])[] };
  claims: EvidenceClaim[];
};
export type RubricCriterion = {
  id: string; name: string; descriptors: Record<string, string>;
  /** how several sentences that bear on this row combine: "weakest" (default: one weak sentence drags the
   *  row down, e.g. an overclaim) or "strongest" (the best sentence carries it, e.g. answering an objection) */
  combine?: "weakest" | "strongest";
  /** level when no sentence in the learner's draft bears on this row (default: the lowest level) */
  absent?: string;
  absentWhy?: string;
};
export type Draft = { id: string; label: string; sentences: PassageSpan[] };
/** What one sentence does to one rubric row when it is in the learner's draft. */
export type SentenceMark = { sentence: string; criterion: string; level: string; why: string; gap?: string; reply?: string };
/** Two sentences that, together in the draft, cap a row (a contradiction, a repeat). */
export type SentenceClash = { sentences: string[]; criterion: string; level: string; why: string; gap?: string; reply?: string };
/** Legacy (v1) per-draft rating. Still accepted: each cited sentence becomes a mark. Prefer `marks`. */
export type ReferenceRating = {
  criterion: string; draft: string; level: string; why: string;
  sentences: string[]; gap?: string; reply?: string;
};
export type EvidenceReviseConfig = Common & {
  mode: "revise";
  drafts: Draft[];                      // exactly two: the learner's starting draft, then a revision to borrow from
  spares?: PassageSpan[];               // 0–6 extra lines to borrow (a better claim, a distractor)
  levels: { id: string; label: string }[]; // low → high, 2–4
  rubric: RubricCriterion[];            // 2–5
  marks?: SentenceMark[];               // what each sentence does to each row; unmarked = doesn't bear on it
  clashes?: SentenceClash[];
  maxSentences?: number;                // longest draft allowed, default 6 (2–10)
  reference?: ReferenceRating[];        // legacy: used only when `marks` is absent
};
export type EvidenceBoardConfig = EvidenceLinkConfig | EvidenceReviseConfig;

const REL_LABEL: Record<ExpectedRelation, string> = { supports: "backs it", partial: "partly backs it", contradicts: "undercuts it", irrelevant: "doesn’t bear on it" };
const REL_SHORT: Record<Relation, string> = { supports: "Backs it", partial: "Partly", contradicts: "Undercuts" };
const RELS: Relation[] = ["supports", "partial", "contradicts"];

/* ---------- sentence splitting ---------- */
/* A full stop ends a sentence only when whitespace follows and the next word starts a sentence. It doesn't
   after a title or common abbreviation (Dr., Mr., e.g., vs.), an initial (J. K.), a dotted acronym (U.S.,
   a.m.), or when the next word is lower-case (“Why?” she asked). Decimals never split: no space follows. */
const ABBR = new Set(["mr", "mrs", "ms", "mx", "dr", "prof", "sr", "jr", "st", "mt", "gen", "col", "capt", "lt", "sgt", "sen", "rep", "gov", "pres", "rev", "hon", "vs", "cf", "approx", "ca", "al", "inc", "ltd", "co", "corp", "dept", "est", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "e.g", "i.e", "viz", "etc."]);
const ABBR_BEFORE_NUMBER = new Set(["no", "nos", "fig", "figs", "vol", "p", "pp", "ch", "sec", "eq", "art"]);
type Cut = { at: number; ambiguous?: string };
function sentenceCuts(text: string): Cut[] {
  const cuts: Cut[] = [];
  const re = /[.!?]+["”’)\]]*(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const next = text.slice(end).match(/^\s+(["“‘(\[]*)(\S)/);
    if (!next) continue;
    const nc = next[2];
    if (/[a-z]/.test(nc)) continue;                                    // “Why?” she asked · e.g. lower-case
    const punct = m[0].replace(/["”’)\]]+$/, "");
    const closed = punct.length < m[0].length;                        // ‘…said.”’ always ends
    if (punct === "." && !closed) {
      const word = (text.slice(0, m.index).match(/(\S+)$/)?.[1] ?? "").replace(/^["“‘(\[]+/, "");
      const w = word.toLowerCase();
      if (ABBR.has(w) || ABBR.has(w + ".")) { if (w === "etc") { cuts.push({ at: end }); } continue; }
      if (ABBR_BEFORE_NUMBER.has(w) && /\d/.test(nc)) continue;
      if (/^[A-Z]$/.test(word)) continue;                              // an initial: J. K. Rowling
      if (/^([A-Za-z]\.)+[A-Za-z]$/.test(word)) {                       // U.S · a.m · Ph.D
        if (/[A-Z]/.test(nc)) cuts.push({ at: -1, ambiguous: `${word}. ${nc}` });   // “U.S. Senate” or a sentence end
        continue;
      }
    }
    cuts.push({ at: end });
  }
  return cuts;
}
/** Split a paragraph into sentences (robust to decimals, initials, Dr., U.S., e.g., and quotes). */
export function splitSentences(text: string): string[] {
  const out: string[] = []; let start = 0;
  for (const c of sentenceCuts(text)) if (c.at > 0) { out.push(text.slice(start, c.at)); start = c.at; }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}
const naiveSplit = (t: string) => (t.match(/[^.!?]+(?:[.!?]+["”’)]*|$)\s*/g) ?? [t]).filter(s => s.trim());

type Span = { id: string; text: string; para: number; i: number };
export function flattenPassage(p: EvidenceLinkConfig["passage"]): Span[] {
  const out: Span[] = [];
  p.paragraphs.forEach((para, pi) => {
    const parts: PassageSpan[] = typeof para === "string"
      ? splitSentences(para).map((t, k) => ({ id: `p${pi + 1}s${k + 1}`, text: (k ? " " : "") + t }))
      : para;
    parts.forEach(s => out.push({ id: s.id, text: s.text, para: pi, i: out.length }));
  });
  return out;
}

/* ---------- validation ---------- */
const isStr = (v: unknown, max = 2000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optStr = (v: unknown, max = 2000) => v === undefined || isStr(v, max);
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][\w-]{0,39}$/.test(v);

/** House validator: [] = valid; any entry makes the component render its calm fallback. */
export function validateEvidenceBoard(c: unknown): string[] {
  const cfg = c as EvidenceBoardConfig;
  if (!cfg || typeof cfg !== "object") return ["config is not an object"];
  const errs: string[] = [];
  if (!isStr(cfg.title, 200)) errs.push("title missing or over 200 chars");
  if (!optStr(cfg.instructions, 600)) errs.push("instructions must be text");
  if (!optStr(cfg.perfectReply, 800)) errs.push("perfectReply must be text");
  if (cfg.gaps !== undefined && (typeof cfg.gaps !== "object" || !cfg.gaps || Array.isArray(cfg.gaps) || Object.values(cfg.gaps).some(g => !isStr(g?.name, 120) || !isStr(g?.reply)))) errs.push("bad gaps: each needs a name (≤ 120) and a reply");
  if (cfg.mode === "link") {
    const p = cfg.passage;
    if (p && typeof p === "object" && (!optStr(p.headline, 200) || !optStr(p.source, 400))) errs.push("passage headline and source must be text");
    if (!p || !Array.isArray(p.paragraphs) || p.paragraphs.length < 1 || p.paragraphs.length > 8) return [...errs, "passage needs 1–8 paragraphs"];
    for (const [pi, para] of p.paragraphs.entries()) {
      if (typeof para === "string") { if (!isStr(para, 3000)) errs.push(`paragraph ${pi + 1} is empty or over 3000 chars`); }
      else if (!Array.isArray(para) || !para.length || para.some(s => !isId(s?.id) || typeof s.text !== "string" || !s.text.trim())) errs.push(`paragraph ${pi + 1} has a bad span (id /^[A-Za-z][\\w-]{0,39}$/ and non-empty text)`);
    }
    if (errs.length) return errs;
    const spans = flattenPassage(p);
    const ids = new Set(spans.map(s => s.id));
    if (ids.size !== spans.length) errs.push("duplicate span ids");
    if (spans.length > 40) errs.push(`too many spans (${spans.length}; at most 40)`);
    if (!Array.isArray(cfg.claims) || cfg.claims.length < 1 || cfg.claims.length > 6) return [...errs, "1–6 claims"];
    const cids = new Set<string>();
    for (const cl of cfg.claims) {
      if (!isId(cl?.id) || cids.has(cl.id) || !isStr(cl.text, 300) || !optStr(cl.verdict, 600) || !Array.isArray(cl.links)) { errs.push(`bad claim ${cl?.id}`); continue; }
      cids.add(cl.id);
      for (const l of cl.links) {
        if (!ids.has(l?.spanId)) errs.push(`claim ${cl.id} links to unknown span ${l?.spanId}`);
        else if (!["supports", "partial", "contradicts", "irrelevant"].includes(l.relation) || !isStr(l.why)) errs.push(`bad link on ${cl.id} → ${l.spanId}`);
        if (l?.gap && !cfg.gaps?.[l.gap]) errs.push(`unknown gap ${l.gap}`);
      }
    }
    return errs;
  }
  if (cfg.mode === "revise") {
    if (!Array.isArray(cfg.drafts) || cfg.drafts.length !== 2) return [...errs, "revise needs exactly two drafts"];
    const sids = new Set<string>();
    for (const d of cfg.drafts) {
      if (!isId(d?.id) || !isStr(d.label, 80) || !Array.isArray(d.sentences) || d.sentences.length < 1 || d.sentences.length > 12) { errs.push(`bad draft ${d?.id}`); continue; }
      for (const s of d.sentences) { if (!isId(s?.id) || sids.has(s.id) || !isStr(s.text, 600)) errs.push(`bad or duplicate sentence ${s?.id}`); else sids.add(s.id); }
    }
    if (cfg.spares !== undefined) {
      if (!Array.isArray(cfg.spares) || cfg.spares.length > 6) errs.push("spares: at most 6 lines");
      else for (const s of cfg.spares) { if (!isId(s?.id) || sids.has(s.id) || !isStr(s.text, 600)) errs.push(`bad or duplicate spare ${s?.id}`); else sids.add(s.id); }
    }
    if (!Array.isArray(cfg.levels) || cfg.levels.length < 2 || cfg.levels.length > 4 || cfg.levels.some(l => !isId(l?.id) || !isStr(l.label, 30))) return [...errs, "2–4 levels, each { id, label ≤ 30 }"];
    const lids = new Set(cfg.levels.map(l => l.id));
    if (!Array.isArray(cfg.rubric) || cfg.rubric.length < 2 || cfg.rubric.length > 5) return [...errs, "2–5 criteria"];
    const rids = new Set<string>();
    for (const r of cfg.rubric) {
      if (!isId(r?.id) || rids.has(r.id) || !isStr(r.name, 60) || !r.descriptors || cfg.levels.some(l => !isStr(r.descriptors[l.id], 300))) { errs.push(`bad criterion ${r?.id}: needs a name (≤ 60) and a descriptor per level`); continue; }
      rids.add(r.id);
      if (r.combine !== undefined && r.combine !== "weakest" && r.combine !== "strongest") errs.push(`criterion ${r.id}: combine is "weakest" or "strongest"`);
      if (!optStr(r.absentWhy, 300)) errs.push(`criterion ${r.id}: absentWhy must be text`);
      if (r.absent !== undefined && !lids.has(r.absent)) errs.push(`criterion ${r.id}: unknown absent level ${r.absent}`);
    }
    if (cfg.maxSentences !== undefined && (!Number.isInteger(cfg.maxSentences) || cfg.maxSentences < 2 || cfg.maxSentences > 10)) errs.push("maxSentences: 2–10");
    if (cfg.marks !== undefined) {
      if (!Array.isArray(cfg.marks) || !cfg.marks.length) errs.push("marks must be a non-empty list");
      else {
        const seen = new Set<string>();
        for (const m of cfg.marks) {
          if (!sids.has(m?.sentence) || !rids.has(m.criterion) || !lids.has(m.level) || !isStr(m.why)) { errs.push(`bad mark ${m?.sentence}/${m?.criterion}`); continue; }
          if (seen.has(m.sentence + "/" + m.criterion)) errs.push(`two marks for ${m.sentence}/${m.criterion}`);
          seen.add(m.sentence + "/" + m.criterion);
          if (m.gap && !cfg.gaps?.[m.gap]) errs.push(`unknown gap ${m.gap}`);
        }
      }
      if (cfg.clashes !== undefined && !Array.isArray(cfg.clashes)) errs.push("clashes must be a list");
      else for (const c of cfg.clashes ?? []) {
        if (!c || typeof c !== "object" || !Array.isArray(c.sentences) || c.sentences.some(s => typeof s !== "string")) { errs.push("bad clash: needs { sentences: [id, id], criterion, level, why }"); continue; }
        if (!Array.isArray(c?.sentences) || c.sentences.length !== 2 || c.sentences.some(s => !sids.has(s)) || c.sentences[0] === c.sentences[1] || !rids.has(c.criterion) || !lids.has(c.level) || !isStr(c.why)) errs.push(`bad clash ${c?.sentences?.join("+")}`);
        else if (c.gap && !cfg.gaps?.[c.gap]) errs.push(`unknown gap ${c.gap}`);
      }
    } else if (Array.isArray(cfg.reference)) {
      for (const r of cfg.rubric) for (const d of cfg.drafts) {
        const ref = cfg.reference.filter(x => x?.criterion === r.id && x.draft === d.id);
        if (ref.length !== 1) { errs.push(`need one reference for ${r.id}/${d.id}`); continue; }
        const x = ref[0];
        if (!lids.has(x.level) || !isStr(x.why) || !Array.isArray(x.sentences) || x.sentences.some(s => !sids.has(s))) errs.push(`bad reference ${r.id}/${d.id}`);
        if (x.gap && !cfg.gaps?.[x.gap]) errs.push(`unknown gap ${x.gap}`);
      }
    } else errs.push("revise needs marks (what each sentence does to each rubric row)");
    return errs;
  }
  return [...errs, "mode must be link or revise"];
}

/** Authoring warnings: the config renders, but something probably isn't what the author meant.
 *  Covers auto-split paragraphs (ids that shift, splits that look wrong) and revise drafts that can't reach the top. */
export function evidenceBoardWarnings(c: unknown): string[] {
  if (validateEvidenceBoard(c).length) return [];
  const cfg = c as EvidenceBoardConfig;
  const out: string[] = [];
  if (cfg.mode === "link") {
    const linked = new Set(cfg.claims.flatMap(cl => cl.links.map(l => l.spanId)));
    cfg.passage.paragraphs.forEach((para, pi) => {
      if (typeof para !== "string") return;
      const n = pi + 1;
      const parts = splitSentences(para), naive = naiveSplit(para);
      if (parts.length !== naive.length) out.push(`paragraph ${n} splits into ${parts.length} sentences (p${n}s1–p${n}s${parts.length}), not the ${naive.length} you get by cutting at every . ! ? — check your ids: ${parts.map((t, k) => `p${n}s${k + 1} = “${t.slice(0, 32)}${t.length > 32 ? "…" : ""}”`).join(", ")}`);
      for (const cut of sentenceCuts(para)) if (cut.ambiguous) out.push(`paragraph ${n}: “${cut.ambiguous}…” was read as one sentence; if it ends there, give explicit spans`);
      parts.forEach((t, k) => { if (/^[0-9a-z]/.test(t)) out.push(`p${n}s${k + 1} starts mid-sentence: “${t.slice(0, 40)}”`); });
      const used = parts.map((_, k) => `p${n}s${k + 1}`).filter(id => linked.has(id));
      if (used.length) out.push(`links point into auto-split paragraph ${n} (${used.join(", ")}); explicit spans are safer: an edit to the text shifts every later id`);
    });
  } else {
    const m = resolveMarks(cfg);
    const ids = allLines(cfg).map(l => l.id);
    const best = bestDraft(cfg, m.marks, m.clashes, ids);
    const top = cfg.levels.length - 1;
    const short = cfg.rubric.filter(r => best.levels[r.id] < top);
    if (short.length) out.push(`no draft of ≤ ${cfg.maxSentences ?? 6} lines reaches “${cfg.levels[top].label}” on ${short.map(r => r.name).join(", ")}; add a spare line that does`);
  }
  return out;
}

/* ---------- helpers ---------- */
const quote = (t: string, n = 64) => { const s = t.trim().replace(/^[“"]|[”"]$/g, ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
/** a quote that sits inside a sentence of ours: no closing full stop of its own */
const quoteIn = (t: string, n = 64) => quote(t, n).replace(/[.!?]+$/, "");
const firstSentences = (t: string, k = 2) => splitSentences(t).slice(0, k).join(" ");
function useWide(ref: React.RefObject<HTMLElement | null>, min = 560) {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= min));
    ro.observe(el); setWide(el.clientWidth >= min);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}
function lead(text: string) { const m = text.match(/^\s*/)![0]; return [m, text.slice(m.length)] as const; }

declare global { interface Window { keatingEvidence?: { snapshot: () => unknown } } }

/* ======================================================================= */
export function EvidenceBoard(props: { config: EvidenceBoardConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const problems = useMemo(() => validateEvidenceBoard(props.config), [props.config]);
  if (problems.length) return <section className="eb eb-fallback" data-evidence="fallback">
    <p className="eb-fallback-title">This evidence activity couldn’t be drawn.</p>
    <p className="eb-muted">Keating can still talk it through in words. <span className="eb-sr">({problems.join("; ")})</span></p>
  </section>;
  return props.config.mode === "link"
    ? <LinkBoard {...props} config={props.config} />
    : <ReviseBoard {...props} config={props.config as EvidenceReviseConfig} />;
}

/* ======================= link mode ======================= */
type Attachment = { id: string; claim: string; from: number; to: number; rel: Relation };
type Outcome = "right" | "close" | "wrong";
type Judged = { outcome: Outcome; expected: ExpectedRelation; why: string; gap?: string; trim?: string };
type Hover = { claim: string; rel: Relation } | null;
type DragState =
  | { kind: "idle" }
  | { kind: "press"; x: number; y: number; t: number; idx: number | null; att: string | null; shift: boolean; armed?: boolean }
  | { kind: "sweep"; anchor: number; handle?: boolean }
  | { kind: "carry"; from: number; to: number; att: string | null; x: number; y: number; hover: Hover };

export function judgeLink(claim: EvidenceClaim, spans: Span[], from: number, to: number, rel: Relation): Judged {
  const picked = spans.slice(from, to + 1);
  const exp = picked.map(s => ({ s, l: claim.links.find(l => l.spanId === s.id) }));
  const relevant = exp.filter(e => e.l && e.l.relation !== "irrelevant");
  const extras = exp.filter(e => !e.l || e.l.relation === "irrelevant");
  if (!relevant.length) {
    const withWhy = exp.find(e => e.l?.why);
    return { outcome: "wrong", expected: "irrelevant", gap: withWhy?.l?.gap,
      why: withWhy?.l?.why ?? `“${quote(picked.map(s => s.text).join(""), 80)}” doesn’t say anything about this claim, so it can’t back it or undercut it.` };
  }
  const rs = new Set(relevant.map(e => e.l!.relation as Relation));
  const expected: Relation = rs.size === 1 ? [...rs][0] : "partial";
  const outcome: Outcome = rel === expected ? "right"
    : (rel === "partial" && expected === "supports") || (rel === "supports" && expected === "partial") || (rel === "partial" && expected === "contradicts") ? "close" : "wrong";
  const gap = outcome === "right" ? undefined : relevant.find(e => e.l!.gap)?.l!.gap;
  // a right answer reads best with the plain reasons; the gap-flavoured ones explain mistakes
  const plain = relevant.filter(e => !e.l!.gap);
  const why = (outcome === "right" && plain.length ? plain : relevant).map(e => e.l!.why).join(" ");
  const trim = extras.length && relevant.length ? `Trim it: “${quote(extras.map(e => e.s.text).join(""), 50)}” adds nothing here.` : undefined;
  return { outcome, expected, why, gap, trim };
}

function linkResults(cfg: EvidenceLinkConfig, spans: Span[], atts: Attachment[]) {
  const judged = Object.fromEntries(atts.map(a => [a.id, judgeLink(cfg.claims.find(c => c.id === a.claim)!, spans, a.from, a.to, a.rel)]));
  const missed: { claim: string; link: EvidenceLink }[] = [];
  for (const c of cfg.claims) for (const l of c.links) {
    const isKey = l.key ?? (l.relation === "supports" || l.relation === "contradicts");
    if (!isKey) continue;
    const idx = spans.findIndex(s => s.id === l.spanId);
    if (!atts.some(a => a.claim === c.id && a.from <= idx && idx <= a.to)) missed.push({ claim: c.id, link: l });
  }
  const count = (o: Outcome) => Object.values(judged).filter(j => j.outcome === o).length;
  return { judged, missed, right: count("right"), close: count("close"), wrong: count("wrong") };
}

function LinkBoard({ config: cfg, onChange, onShare }: { config: EvidenceLinkConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const spans = useMemo(() => flattenPassage(cfg.passage), [cfg]);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [undo, setUndo] = useState<Attachment[][]>([]);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [drag, setDrag] = useState<DragState>({ kind: "idle" });
  const [checked, setChecked] = useState(false);
  const [first, setFirst] = useState<ReturnType<typeof linkResults> | null>(null);
  const [tries, setTries] = useState(0);
  const [focusClaim, setFocusClaim] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const [shared, setShared] = useState(false);
  const nextId = useRef(1);
  const root = useRef<HTMLElement>(null);
  const passageEl = useRef<HTMLDivElement>(null);
  const wide = useWide(root);
  const dragRef = useRef(drag); dragRef.current = drag;
  const selRef = useRef(sel); selRef.current = sel;
  const attsRef = useRef(atts); attsRef.current = atts;
  /* sweep history: a quick exit from the passage crosses other sentences on the way out; carry what was
     selected ~120 ms before leaving, so only a deliberate sweep extends the selection */
  const sweepHist = useRef<{ t: number; a: number; b: number }[]>([]);
  const results = useMemo(() => checked ? linkResults(cfg, spans, atts) : null, [checked, cfg, spans, atts]);
  const claimNo = (id: string) => cfg.claims.findIndex(c => c.id === id) + 1;
  const text = (from: number, to: number) => spans.slice(from, to + 1).map(s => s.text).join("").trim();

  const edit = useCallback((msg: string) => { setChecked(false); setShared(false); setSay(msg); onChange?.(); }, [onChange]);
  const remember = () => setUndo(u => [...u.slice(-30), attsRef.current]);

  const attach = useCallback((from: number, to: number, claim: string, rel: Relation, moving: string | null) => {
    const cl = cfg.claims.find(c => c.id === claim)!;
    remember();
    setAtts(prev => {
      let next = moving ? prev.filter(a => a.id !== moving) : prev;
      const same = next.find(a => a.claim === claim && a.from === from && a.to === to);
      if (same) next = next.map(a => a === same ? { ...a, rel } : a);
      else next = [...next, { id: `a${nextId.current++}`, claim, from, to, rel }];
      return next;
    });
    setSel(null);
    edit(`Attached “${quote(text(from, to), 50)}” to claim ${claimNo(claim)} as ${REL_LABEL[rel]}: ${quote(cl.text, 60)}`);
  }, [cfg, edit, spans]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback((id: string) => {
    const a = attsRef.current.find(x => x.id === id); if (!a) return;
    remember();
    setAtts(prev => prev.filter(x => x.id !== id));
    edit(`Removed “${quote(text(a.from, a.to), 50)}” from claim ${claimNo(a.claim)}.`);
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- hit testing --- */
  const hitClaim = (x: number, y: number): Hover => {
    const el = root.current; if (!el) return null;
    let best: { d: number; claim: string; li: HTMLElement } | null = null;
    el.querySelectorAll<HTMLElement>("[data-eb-claim]").forEach(li => {
      const r = li.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < 28 && (!best || d < best.d)) best = { d, claim: li.dataset.ebClaim!, li };
    });
    if (!best) return null;
    const b = best as { claim: string; li: HTMLElement };
    let rel: Relation = "supports", bd = Infinity;
    b.li.querySelectorAll<HTMLElement>("[data-eb-band]").forEach(seg => {
      const r = seg.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < bd) { bd = d; rel = seg.dataset.ebBand as Relation; }
    });
    return { claim: b.claim, rel };
  };
  const spanAt = (x: number, y: number): number | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-eb-span]");
    return hit && passageEl.current?.contains(hit) ? Number(hit.dataset.ebSpan) : null;
  };
  const inPassage = (x: number, y: number) => {
    const r = passageEl.current?.getBoundingClientRect();
    return !!r && x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
  };

  /* --- pointer drag --- */
  useEffect(() => {
    if (drag.kind === "idle") return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.kind === "press") {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        if (d.att) {
          const a = attsRef.current.find(x => x.id === d.att)!;
          setDrag({ kind: "carry", from: a.from, to: a.to, att: a.id, x: e.clientX, y: e.clientY, hover: hitClaim(e.clientX, e.clientY) });
        } else if (d.idx !== null) {
          const s = selRef.current;
          if (s && d.idx >= s.a && d.idx <= s.b) setDrag({ kind: "carry", from: s.a, to: s.b, att: null, x: e.clientX, y: e.clientY, hover: hitClaim(e.clientX, e.clientY) });
          else if (!d.armed) { setSel({ a: d.idx, b: d.idx }); setDrag({ kind: "carry", from: d.idx, to: d.idx, att: null, x: e.clientX, y: e.clientY, hover: hitClaim(e.clientX, e.clientY) }); }
          else { setSel({ a: d.idx, b: d.idx }); sweepHist.current = [{ t: performance.now() - 1000, a: d.idx, b: d.idx }]; setDrag({ kind: "sweep", anchor: d.idx }); }
        }
        return;
      }
      if (d.kind === "sweep") {
        const hov = hitClaim(e.clientX, e.clientY);
        if (!inPassage(e.clientX, e.clientY) || hov) {
          const cut = performance.now() - 120;
          const s = [...sweepHist.current].reverse().find(h => h.t <= cut) ?? { a: d.anchor, b: d.anchor };
          setSel({ a: s.a, b: s.b });
          setDrag({ kind: "carry", from: s.a, to: s.b, att: null, x: e.clientX, y: e.clientY, hover: hov });
          return;
        }
        const i = spanAt(e.clientX, e.clientY);
        if (i !== null) {
          const n = { a: Math.min(d.anchor, i), b: Math.max(d.anchor, i) };
          const last = sweepHist.current[sweepHist.current.length - 1];
          if (!last || last.a !== n.a || last.b !== n.b) sweepHist.current.push({ t: performance.now(), ...n });
          setSel(n);
        }
        return;
      }
      if (d.kind === "carry") setDrag({ ...d, x: e.clientX, y: e.clientY, hover: hitClaim(e.clientX, e.clientY) });
    };
    const up = () => {
      const d = dragRef.current;
      if (d.kind === "press") {          // a tap
        if (d.idx !== null && !d.att) {
          const s = selRef.current;
          if (d.shift && s) setSel({ a: Math.min(s.a, d.idx), b: Math.max(s.b, d.idx) });
          else if (s && s.a === d.idx && s.b === d.idx) setSel(null);
          else setSel({ a: d.idx, b: d.idx });
          setSay(`Selected “${quote(spans[d.idx].text, 60)}”. Drag it onto a claim, or tap a claim’s band. Pull the handle at its end to take more.`);
        }
      } else if (d.kind === "sweep") {
        const s = selRef.current; if (s) setSay(`Selected “${quote(text(s.a, s.b), 60)}”. Drag it onto a claim.`);
      } else if (d.kind === "carry") {
        if (d.hover) attach(d.from, d.to, d.hover.claim, d.hover.rel, d.att);
        else if (d.att) remove(d.att);
      }
      setDrag({ kind: "idle" });
    };
    /* An interrupted gesture discards the preview and keeps the last committed attachments: never attach the
       hovered claim, never remove a carried attachment. */
    const cancel = () => {
      const d = dragRef.current;
      if (d.kind === "carry" || d.kind === "sweep") setSay("Drag interrupted; nothing changed.");
      setDrag({ kind: "idle" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  }, [drag.kind, attach, remove]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (drag.kind !== "carry" && drag.kind !== "sweep") return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", stop);
    const t = setInterval(() => {
      const d = dragRef.current; if (d.kind !== "carry") return;
      const edge = 56, v = d.y > innerHeight - edge ? 14 : d.y < edge ? -14 : 0;
      if (!v) return;
      const before = scrollY; scrollBy(0, v);
      if (scrollY !== before) setDrag({ ...d, hover: hitClaim(d.x, d.y) });
    }, 24);
    return () => { clearInterval(t); document.removeEventListener("selectstart", stop); };
  }, [drag.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSpanDown = (e: React.PointerEvent, idx: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const t = performance.now();
    setDrag({ kind: "press", x: e.clientX, y: e.clientY, t, idx, att: null, shift: e.shiftKey });
    // press and hold: arm a sweep (shown on the span and by a hint) so the next movement extends the selection
    setTimeout(() => setDrag(d => d.kind === "press" && d.t === t ? { ...d, armed: true } : d), 280);
  };
  const onHandleDown = (e: React.PointerEvent) => {
    const s = selRef.current; if (e.button !== 0 || !s) return;
    e.preventDefault(); e.stopPropagation();
    sweepHist.current = [{ t: performance.now() - 1000, a: s.a, b: s.b }];
    setDrag({ kind: "sweep", anchor: s.a, handle: true });
  };
  const onChipDown = (e: React.PointerEvent, att: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDrag({ kind: "press", x: e.clientX, y: e.clientY, t: performance.now(), idx: null, att, shift: false });
  };

  /* --- leader lines (measured after layout) --- */
  const [lines, setLines] = useState<{ id: string; d: string; rel: Relation; claim: string; preview?: boolean; dot: [number, number] }[]>([]);
  const carry = drag.kind === "carry" ? drag : null;
  useLayoutEffect(() => {
    const el = root.current, pe = passageEl.current, board = el?.querySelector(".eb-board"); if (!el || !pe || !board) return;
    const R = board.getBoundingClientRect(), P = pe.getBoundingClientRect();
    const spanY = (i: number) => { const s = el.querySelector(`[data-eb-span="${i}"]`); const r = s?.getClientRects()[0]; return r ? r.top + r.height / 2 - R.top : 0; };
    const route = (sy: number, ex: number, ey: number, k: number) => {
      if (wide) { const sx = P.right - R.left + 6; const mid = (sx + ex) / 2; return { d: `M${sx},${sy} C${mid},${sy} ${mid},${ey} ${ex},${ey}`, dot: [sx, sy] as [number, number] }; }
      const gx = 4 + (k % 4) * 2.5; const sx = P.left - R.left + 2;
      return { d: `M${sx},${sy} H${gx} V${ey} H${ex}`, dot: [sx, sy] as [number, number] };
    };
    const out: typeof lines = [];
    atts.forEach((a, k) => {
      if (carry?.att === a.id) return;
      const chip = el.querySelector(`[data-eb-att="${a.id}"] .eb-chip-dot`); if (!chip) return;
      const c = chip.getBoundingClientRect();
      out.push({ id: a.id, rel: a.rel, claim: a.claim, ...route(spanY(a.from), c.left - R.left + 2, c.top + c.height / 2 - R.top, k) });
    });
    if (carry) {
      let ex = carry.x - R.left, ey = carry.y - R.top;
      if (carry.hover) {
        const seg = el.querySelector(`[data-eb-claim="${carry.hover.claim}"] [data-eb-band="${carry.hover.rel}"]`);
        if (seg) { const s = seg.getBoundingClientRect(); ex = s.left - R.left + 2; ey = s.top + s.height / 2 - R.top; }
      }
      const sy = spanY(carry.from);
      const sx = wide ? P.right - R.left + 6 : P.left - R.left + 2;
      const r = carry.hover ? route(sy, ex, ey, atts.length) : { d: `M${sx},${sy} L${ex},${ey}`, dot: [sx, sy] as [number, number] };
      out.push({ id: "preview", rel: carry.hover?.rel ?? "supports", claim: carry.hover?.claim ?? "", preview: true, ...r });
    }
    const key = JSON.stringify(out);
    setLines(prev => JSON.stringify(prev) === key ? prev : out);
  });

  /* --- check / share --- */
  const check = () => {
    const r = linkResults(cfg, spans, atts);
    setChecked(true); setTries(t => t + 1);
    if (!first) setFirst(r);
    setSay(`Checked: ${r.right} of ${atts.length} links right${r.close ? `, ${r.close} close` : ""}. ${r.missed.length ? `${r.missed.length} key passage${r.missed.length > 1 ? "s" : ""} not attached.` : "No key passage missed."}`);
  };
  const share = () => {
    const r = results ?? linkResults(cfg, spans, atts);
    const main = cfg.claims[0];
    const mainAtts = atts.filter(a => a.claim === main.id);
    const full = mainAtts.filter(a => a.rel === "supports").length, part = mainAtts.filter(a => a.rel === "partial").length, under = mainAtts.filter(a => a.rel === "contradicts").length;
    const n = (k: number, w: string) => `${k} passage${k > 1 ? "s" : ""} ${w}`;
    const mq = quoteIn(main.text, 50);
    const stance = !mainAtts.length ? `I didn’t attach anything to “${mq}”.`
      : full > under ? `I think the article backs “${mq}”: ${n(full, full > 1 ? "back it" : "backs it")}${under ? ` and ${n(under, under > 1 ? "undercut it" : "undercuts it")}` : ""}.`
      : under ? `I think “${mq}” isn’t backed up: ${n(under, under > 1 ? "undercut it" : "undercuts it")}${full + part ? ` and ${full + part} only ${full + part > 1 ? "back" : "backs"} it partly` : ""}.`
      : `I think “${mq}” is only partly backed: ${n(part, part > 1 ? "back it partly" : "backs it partly")}.`;
    const firstR = first ?? r;
    const unchecked = !checked && !tries;
    const learner = `${stance} ${unchecked ? `I made ${atts.length} link${atts.length > 1 ? "s" : ""} and haven’t checked them yet.` : `${r.right} of ${atts.length} of my links were right${r.close ? `, ${r.close} close` : ""}${r.missed.length ? `, and I missed ${r.missed.length} key passage${r.missed.length > 1 ? "s" : ""}` : ""}.`}`;
    // the reasoning gaps behind the misses, heaviest first (wrong 2, close or missed 1; ties keep claim order)
    const gapCount: Record<string, number> = {};
    const wrongs = atts.map(a => ({ a, j: r.judged[a.id] })).filter(x => x.j.outcome !== "right");
    wrongs.forEach(x => { if (x.j.gap) gapCount[x.j.gap] = (gapCount[x.j.gap] ?? 0) + (x.j.outcome === "wrong" ? 2 : 1); });
    // Misconception labels come only from placements the learner actually made that conflict with the passage.
    // Unattached passages are never evidence of a misconception: they are gaps in coverage, named as such.
    const tops = Object.entries(gapCount).filter(([k]) => cfg.gaps?.[k]).sort((x, y) => y[1] - x[1]).map(e => e[0]);
    let reply: string;
    const linkWords = (a: Attachment) => `“${quoteIn(text(a.from, a.to), 60)}” on claim ${claimNo(a.claim)} (“${quoteIn(cfg.claims.find(c => c.id === a.claim)!.text, 72)}”) as ${a.rel === "supports" ? "backing it" : a.rel === "partial" ? "partly backing it" : a.rel === "contradicts" ? "undercutting it" : "not bearing on it"}`;
    if (unchecked) {
      // describe what was submitted, then judge only those placements, then invite one untouched claim
      const shown = atts.slice(0, 2).map(linkWords);
      const more = atts.length > 2 ? `, plus ${atts.length - 2} more` : "";
      reply = `So far you’ve put ${shown.length === 2 ? `${shown[0]}, and ${shown[1]}` : shown[0]}${more}.`;
      const conflict = wrongs.find(x => x.j.outcome === "wrong") ?? wrongs[0];
      if (conflict) {
        const g = conflict.j.gap && cfg.gaps?.[conflict.j.gap];
        reply += ` Look again at “${quoteIn(text(conflict.a.from, conflict.a.to), 60)}”: it ${REL_LABEL[conflict.j.expected]} rather than ${conflict.a.rel === "supports" ? "backing it" : conflict.a.rel === "partial" ? "partly backing it" : conflict.a.rel === "contradicts" ? "undercutting it" : "not bearing on it"}.${g ? ` That placement looks like ${g.name.charAt(0).toLowerCase() + g.name.slice(1)}. ${firstSentences(g.reply, 2)}` : ` ${conflict.j.why}`}`;
      } else reply += ` ${atts.length === 1 ? "That placement fits what the sentence says." : "Those placements fit what the sentences say."}`;
      const untouched = cfg.claims.find(c => !atts.some(a => a.claim === c.id));
      reply += untouched ? ` Next, try claim ${claimNo(untouched.id)} (“${quoteIn(untouched.text, 72)}”): nothing is attached to it yet. Which sentence bears on it?` : " Every claim has something attached; press Check when you’re ready.";
    }
    else if (tops.length) {
      const g1 = cfg.gaps![tops[0]];
      reply = `${g1.name}. ${g1.reply}`;
      if (tops[1]) { const g2 = cfg.gaps![tops[1]]; reply += ` There’s a second slip too, ${g2.name.charAt(0).toLowerCase() + g2.name.slice(1)}: ${firstSentences(g2.reply, 2)}`; }
    }
    else if (wrongs.length) { const w = wrongs[0]; reply = `Look again at “${quoteIn(text(w.a.from, w.a.to), 70)}”. You had it as ${REL_LABEL[w.a.rel]}, but it ${REL_LABEL[w.j.expected]}: ${w.j.why}`; }
    else if (r.missed.length) { const m = r.missed[0]; const s = spans.find(x => x.id === m.link.spanId)!; reply = `Your links hold up. One you left out: “${quoteIn(s.text, 70)}” ${REL_LABEL[m.link.relation]} (claim ${claimNo(m.claim)}). ${m.link.why}`; }
    else reply = cfg.perfectReply ?? "Every link holds up, and each one rests on what the passage actually says. That’s the habit: read the whole sentence, then ask what it can and can’t show.";
    if (tries > 1 && firstR.wrong > r.wrong) reply += ` You also fixed ${firstR.wrong - r.wrong} on a second look, which is the habit that matters.`;
    const data = `link · ${atts.length} links: ${r.right} right, ${r.close} close, ${r.wrong} wrong · missed ${r.missed.length} · ${unchecked ? "not checked" : `try ${tries}`}${tops.length ? ` · gaps: ${tops.map(k => cfg.gaps?.[k]?.name ?? k).join(", ")}` : ""} · ` +
      atts.map(a => `${a.claim}←${spans[a.from].id}${a.to > a.from ? "–" + spans[a.to].id : ""}:${a.rel}/${r.judged[a.id].outcome}`).join(", ");
    setShared(true);
    setSay("Shared with Keating.");
    onShare?.({ learner, data, reply });
  };
  const startOver = () => { remember(); setAtts([]); setSel(null); setFirst(null); setTries(0); edit("Cleared. Every claim is unsupported again."); };
  const doUndo = () => {
    const prev = undo[undo.length - 1]; if (!prev) return;
    setUndo(u => u.slice(0, -1)); setAtts(prev); setSel(null);
    edit(`Undone. ${prev.length} link${prev.length === 1 ? "" : "s"} on the board.`);
  };

  useEffect(() => { if (!import.meta.env.DEV) return; window.keatingEvidence = { snapshot: () => ({ mode: "link", atts, sel, checked, drag: drag.kind, armed: drag.kind === "press" ? !!drag.armed : false, hover: drag.kind === "carry" ? drag.hover : null, results: results && { right: results.right, close: results.close, wrong: results.wrong, missed: results.missed.map(m => `${m.claim}:${m.link.spanId}`), judged: Object.fromEntries(atts.map(a => [`${a.claim}:${spans[a.from].id}${a.to > a.from ? "-" + spans[a.to].id : ""}`, results.judged[a.id].outcome])) } }) }; });

  /* --- button panel state --- */
  const [kFrom, setKFrom] = useState(0), [kTo, setKTo] = useState(0), [kClaim, setKClaim] = useState(cfg.claims[0].id), [kRel, setKRel] = useState<Relation>("supports");
  useEffect(() => { if (sel) { setKFrom(sel.a); setKTo(sel.b); } }, [sel]);

  const covered = (i: number) => atts.filter(a => a.from <= i && i <= a.to);
  const hotClaim = carry?.hover?.claim ?? focusClaim;
  const paras = useMemo(() => { const m: Span[][] = []; spans.forEach(s => (m[s.para] ??= []).push(s)); return m; }, [spans]);
  const carrying = carry ? text(carry.from, carry.to) : "";
  const showHandle = sel && drag.kind === "idle";
  const armedPress = drag.kind === "press" && drag.armed ? drag : null;

  return <section ref={root} className={"eb eb-link" + (drag.kind !== "idle" && drag.kind !== "press" ? " is-dragging" : "")} data-evidence="link" data-layout={wide ? "wide" : "stack"}
    data-checked={checked ? "1" : undefined} aria-label={cfg.title}>
    <header className="eb-head">
      <h3 className="eb-title">{cfg.title}</h3>
      {cfg.instructions && <p className="eb-muted eb-instructions">{cfg.instructions}</p>}
    </header>
    <div className="eb-board eb-canvas">
      <svg className="eb-lines" aria-hidden="true">
        {lines.map(l => <g key={l.id} data-rel={l.rel} data-hot={l.preview || l.claim === hotClaim ? "1" : undefined} data-preview={l.preview ? "1" : undefined}>
          <path d={l.d} className="eb-line" />
          <circle cx={l.dot[0]} cy={l.dot[1]} r={2.6} className="eb-line-dot" />
        </g>)}
      </svg>
      <div ref={passageEl} className="eb-passage" data-sweeping={drag.kind === "sweep" ? "1" : undefined}>
        {cfg.passage.headline && <p className="eb-headline">{cfg.passage.headline}</p>}
        {paras.map((p, pi) => <p key={pi} className="eb-para">
          {p.map(s => {
            const [ws, body] = lead(s.text);
            const cov = covered(s.i);
            const inSel = sel && s.i >= sel.a && s.i <= sel.b;
            const inCarry = carry && s.i >= carry.from && s.i <= carry.to;
            const hot = cov.filter(a => a.claim === hotClaim);
            const endHere = atts.filter(a => a.to === s.i);
            return <span key={s.id}>{ws}<span className="eb-span" data-eb-span={s.i} data-span-id={s.id}
              data-sel={inSel ? "1" : undefined} data-armed={armedPress?.idx === s.i ? "1" : undefined} data-carry={inCarry ? "1" : undefined}
              data-att={cov.length ? cov[cov.length - 1].rel : undefined} data-hot={hot.length ? hot[0].rel : undefined}
              onPointerDown={e => onSpanDown(e, s.i)} onMouseDown={e => e.preventDefault()}>{body}</span>
              {showHandle && sel!.b === s.i && <span className="eb-handle" data-eb-handle="1" aria-hidden="true" title="Pull to take more of the text"
                onPointerDown={onHandleDown} onMouseDown={e => e.preventDefault()}><span className="eb-handle-knob" /></span>}
              {endHere.map(a => <sup key={a.id} className="eb-mark" data-rel={a.rel} data-res={results?.judged[a.id].outcome}
                title={`Claim ${claimNo(a.claim)}: ${REL_LABEL[a.rel]}`}>{claimNo(a.claim)}</sup>)}
            </span>;
          })}
        </p>)}
        {cfg.passage.source && <p className="eb-source">{cfg.passage.source}</p>}
      </div>
      <ol className="eb-claims" aria-label="Claims">
        {cfg.claims.map((c, ci) => {
          const mine = atts.filter(a => a.claim === c.id);
          const backs = mine.filter(a => a.rel !== "contradicts").length, under = mine.length - backs;
          const missed = results?.missed.filter(m => m.claim === c.id) ?? [];
          const js = mine.map(a => results?.judged[a.id]).filter(Boolean) as Judged[];
          const status = results
            ? [mine.length ? `${js.filter(j => j.outcome === "right").length} of ${mine.length} right` : "Unsupported: nothing attached", missed.length ? `${missed.length} key passage${missed.length > 1 ? "s" : ""} missed` : ""].filter(Boolean).join(" · ")
            : !mine.length ? "Unsupported: nothing attached" : !backs ? `Nothing backs it · undercut ×${under}` : `Backed ×${backs}${under ? ` · undercut ×${under}` : ""}`;
          const hov = carry?.hover?.claim === c.id ? carry.hover.rel : undefined;
          return <li key={c.id} className="eb-claim" data-eb-claim={c.id} data-hot={hov ? "1" : undefined} data-unsupported={backs ? undefined : "1"}
            onPointerEnter={() => setFocusClaim(c.id)} onPointerLeave={() => setFocusClaim(f => f === c.id ? null : f)}>
            <div className="eb-claim-head">
              <span className="eb-claim-num" aria-hidden="true">{ci + 1}</span>
              <div>
                <p className="eb-claim-text">{c.text}</p>
                <p className="eb-claim-status">{status}</p>
              </div>
            </div>
            {mine.length > 0 && <ul className="eb-chips">
              {mine.map(a => {
                const j = results?.judged[a.id];
                const gapName = j && j.outcome !== "right" && j.gap ? cfg.gaps?.[j.gap]?.name : undefined;
                return <li key={a.id} className="eb-chip" data-eb-att={a.id} data-rel={a.rel} data-res={j?.outcome} data-lifted={carry?.att === a.id ? "1" : undefined}
                  onPointerDown={e => onChipDown(e, a.id)} onMouseDown={e => { if (!(e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
                  <span className="eb-chip-dot" aria-hidden="true" />
                  <span className="eb-chip-rel">{REL_SHORT[a.rel]}</span>
                  <q className="eb-chip-quote" title={text(a.from, a.to)}>{quote(text(a.from, a.to), 90)}</q>
                  {j && <span className="eb-chip-mark" aria-label={j.outcome}>{j.outcome === "right" ? "✓" : j.outcome === "close" ? "≈" : "✗"}</span>}
                  <button type="button" className="eb-x" aria-label={`Remove “${quote(text(a.from, a.to), 40)}” from claim ${ci + 1}`} onClick={() => remove(a.id)}>×</button>
                  {j && j.outcome !== "right" && <span className="eb-chip-verdict">{j.outcome === "close" ? `Close: it ${REL_LABEL[j.expected]}` : `It ${REL_LABEL[j.expected]}`}{gapName ? ` · ${gapName}` : ""}</span>}
                </li>;
              })}
            </ul>}
            {(!checked || sel || carry) && <div className="eb-bands" data-armed={sel ? "1" : undefined}>
              {RELS.map(r => <button type="button" key={r} className="eb-band" data-eb-band={r} data-on={hov === r ? "1" : undefined}
                disabled={!sel} aria-label={`Attach the selected text to claim ${ci + 1} as ${REL_LABEL[r]}`}
                onClick={() => sel && attach(sel.a, sel.b, c.id, r, null)}>
                <span className="eb-band-label">{REL_SHORT[r]}</span>
              </button>)}
            </div>}
            {checked && (mine.length > 0 || missed.length > 0 || c.verdict) && <details className="eb-more">
              <summary>Why{missed.length ? ` · ${missed.length} not attached` : ""}</summary>
              {mine.map(a => { const j = results!.judged[a.id]; return <p key={a.id} className="eb-why" data-res={j.outcome}>
                <q>{quote(text(a.from, a.to), 48)}</q>{" "}
                {j.outcome === "right" ? "Right. " : j.outcome === "close" ? `Close: it ${REL_LABEL[j.expected]}. ` : `It ${REL_LABEL[j.expected]}. `}
                {j.gap && j.outcome !== "right" && cfg.gaps?.[j.gap] && <span className="eb-gap">{cfg.gaps[j.gap].name}. </span>}
                {j.why}{j.trim ? " " + j.trim : ""}
              </p>; })}
              {missed.map(m => { const s = spans.find(x => x.id === m.link.spanId)!; return <p key={m.link.spanId} className="eb-missed">
                <span className="eb-missed-tag">Not attached</span> “{quote(s.text, 80)}” {REL_LABEL[m.link.relation]}. {m.link.why}</p>; })}
              {c.verdict && <p className="eb-verdict"><span className="eb-verdict-tag">Reading</span> {c.verdict}</p>}
            </details>}
          </li>;
        })}
      </ol>
    </div>
    {carry && <div className="eb-float" style={{ transform: `translate(${Math.max(4, Math.min(carry.x + 12, innerWidth - Math.min(260, innerWidth - 8) - 4))}px, ${carry.y + 14}px)` }} aria-hidden="true" data-rel={carry.hover?.rel}>
      <span className="eb-float-rel">{carry.hover ? `${REL_SHORT[carry.hover.rel]} · claim ${claimNo(carry.hover.claim)}` : carry.att ? "Drop off a claim to remove" : "Drop on a claim"}</span>
      <q>{quote(carrying, 80)}</q>
    </div>}
    {armedPress && <div className="eb-float eb-float-hint" style={{ transform: `translate(${Math.max(4, Math.min(armedPress.x + 12, innerWidth - 200))}px, ${armedPress.y + 16}px)` }} aria-hidden="true">
      Now sweep along the text
    </div>}
    <div className="eb-actions">
      <button type="button" className="eb-primary" onClick={check} disabled={!atts.length || checked}>{checked ? "Checked" : tries ? "Check again" : "Check my evidence"}</button>
      <button type="button" className="eb-quiet" onClick={share} disabled={!atts.length || shared}>{shared ? "Shared" : "Share with Keating"}</button>
      <button type="button" className="eb-quiet" onClick={doUndo} disabled={!undo.length}>Undo</button>
      <button type="button" className="eb-quiet" onClick={startOver} disabled={!atts.length}>Start over</button>
      {results && <span className="eb-count">{results.right} of {atts.length} right{results.close ? ` · ${results.close} close` : ""} · {results.missed.length} missed · try {tries}</span>}
    </div>
    {checked && results && results.wrong + results.close + results.missed.length > 0 && <p className="eb-muted eb-hint">Open “Why” under a claim for the reasons. Edit any link and check again; your first try is kept.</p>}
    <details className="eb-keys">
      <summary>Use buttons instead</summary>
      <div className="eb-keys-grid">
        <label>From<select value={kFrom} onChange={e => { const v = Number(e.target.value); setKFrom(v); if (kTo < v) setKTo(v); }}>
          {spans.map(s => <option key={s.id} value={s.i}>{s.i + 1}. {quote(s.text, 46)}</option>)}</select></label>
        <label>To<select value={kTo} onChange={e => setKTo(Math.max(kFrom, Number(e.target.value)))}>
          {spans.map(s => <option key={s.id} value={s.i} disabled={s.i < kFrom}>{s.i + 1}. {quote(s.text, 46)}</option>)}</select></label>
        <label>Claim<select value={kClaim} onChange={e => setKClaim(e.target.value)}>
          {cfg.claims.map((c, i) => <option key={c.id} value={c.id}>{i + 1}. {quote(c.text, 50)}</option>)}</select></label>
        <label>As<select value={kRel} onChange={e => setKRel(e.target.value as Relation)}>
          {RELS.map(r => <option key={r} value={r}>{REL_LABEL[r]}</option>)}</select></label>
        <button type="button" className="eb-quiet" onClick={() => attach(kFrom, kTo, kClaim, kRel, null)}>Attach</button>
      </div>
    </details>
    <p className="eb-sr" role="status" aria-live="polite">{say}</p>
  </section>;
}

/* ======================= revise mode ======================= */
type Line = { id: string; text: string; tag: string; group: "a" | "b" | "s" };
function allLines(cfg: EvidenceReviseConfig): Line[] {
  return [
    ...cfg.drafts[0].sentences.map((s, i) => ({ id: s.id, text: s.text.trim(), tag: `A${i + 1}`, group: "a" as const })),
    ...cfg.drafts[1].sentences.map((s, i) => ({ id: s.id, text: s.text.trim(), tag: `B${i + 1}`, group: "b" as const })),
    ...(cfg.spares ?? []).map((s, i) => ({ id: s.id, text: s.text.trim(), tag: `S${i + 1}`, group: "s" as const })),
  ];
}
type Resolved = { marks: SentenceMark[]; clashes: SentenceClash[]; absentWhy: Record<string, string> };
/** marks as authored, or (legacy configs) derived from per-draft reference ratings: each cited sentence carries its rating */
function resolveMarks(cfg: EvidenceReviseConfig): Resolved {
  if (cfg.marks) return { marks: cfg.marks, clashes: cfg.clashes ?? [], absentWhy: {} };
  const marks: SentenceMark[] = [], absentWhy: Record<string, string> = {};
  for (const r of cfg.reference ?? []) {
    if (!r.sentences.length && !absentWhy[r.criterion]) absentWhy[r.criterion] = r.reply ?? r.why;
    for (const s of r.sentences) if (!marks.some(m => m.sentence === s && m.criterion === r.criterion)) marks.push({ sentence: s, criterion: r.criterion, level: r.level, why: r.why, gap: r.gap, reply: r.reply });
  }
  return { marks, clashes: [], absentWhy };
}
type RowScore = { li: number; why: string; gap?: string; reply?: string; cause: string[]; absent?: boolean };
function scoreDraft(cfg: EvidenceReviseConfig, res: Resolved, ids: string[]): Record<string, RowScore> {
  const lv = (id: string) => cfg.levels.findIndex(l => l.id === id);
  const out: Record<string, RowScore> = {};
  for (const r of cfg.rubric) {
    if (!ids.length) { out[r.id] = { li: 0, why: "The draft is empty.", cause: [], absent: true }; continue; }
    const pos = (s: string) => ids.indexOf(s);
    const ms = res.marks.filter(m => m.criterion === r.id && ids.includes(m.sentence)).sort((x, y) => pos(x.sentence) - pos(y.sentence))
      .map(m => ({ li: lv(m.level), why: m.why, gap: m.gap, reply: m.reply, cause: [m.sentence] }));
    const cs = res.clashes.filter(c => c.criterion === r.id && c.sentences.every(s => ids.includes(s)))
      .map(c => ({ li: lv(c.level), why: c.why, gap: c.gap, reply: c.reply, cause: [...c.sentences].sort((x, y) => pos(x) - pos(y)) }));
    let row: RowScore;
    if (!ms.length) {
      const li = r.absent ? lv(r.absent) : 0;
      row = { li, why: r.absentWhy ?? res.absentWhy[r.id] ?? (li === cfg.levels.length - 1 ? r.descriptors[cfg.levels[li].id] : `Nothing in your draft does this yet. ${r.descriptors[cfg.levels[cfg.levels.length - 1].id]}`), cause: [], absent: true };
    } else {
      const pick = (r.combine ?? "weakest") === "strongest" ? Math.max(...ms.map(m => m.li)) : Math.min(...ms.map(m => m.li));
      row = ms.find(m => m.li === pick)!;
    }
    for (const c of cs) if (c.li < row.li) row = c;      // a clash caps the row
    out[r.id] = row;
  }
  return out;
}
function bestDraft(cfg: EvidenceReviseConfig, marks: SentenceMark[], clashes: SentenceClash[], ids: string[]) {
  const res: Resolved = { marks, clashes, absentWhy: {} }, max = cfg.maxSentences ?? 6;
  const useful = ids.filter(id => marks.some(m => m.sentence === id));
  let best = { sum: -1, ids: [] as string[], levels: {} as Record<string, number> };
  if (useful.length > 16) return { ...best, levels: Object.fromEntries(cfg.rubric.map(r => [r.id, cfg.levels.length - 1])) };   // too many to search; don't warn
  const walk = (start: number, pick: string[]) => {
    if (pick.length) {
      const s = scoreDraft(cfg, res, pick), sum = cfg.rubric.reduce((n, r) => n + s[r.id].li, 0);
      if (sum > best.sum) best = { sum, ids: [...pick], levels: Object.fromEntries(cfg.rubric.map(r => [r.id, s[r.id].li])) };
    }
    if (pick.length >= max) return;
    for (let i = start; i < useful.length; i++) { pick.push(useful[i]); walk(i + 1, pick); pick.pop(); }
  };
  walk(0, []);
  return best;
}

/** The rubric level ids a draft (sentence ids, in order) earns. For tests, evals and authoring checks. */
export function scoreRevision(cfg: EvidenceReviseConfig, ids: string[]): Record<string, string> {
  const s = scoreDraft(cfg, resolveMarks(cfg), ids);
  return Object.fromEntries(cfg.rubric.map(r => [r.id, cfg.levels[s[r.id].li].id]));
}

type Target = { kind: "insert"; at: number } | { kind: "replace"; at: number } | { kind: "out" };
function applyMove(draft: string[], id: string, t: Target | null, max: number): string[] | null {
  if (!t) return null;
  const cur = draft.indexOf(id);
  if (t.kind === "out") return cur < 0 ? null : draft.filter(x => x !== id);
  if (t.kind === "replace") {
    const tid = draft[t.at]; if (!tid || tid === id) return null;
    const n = [...draft]; if (cur >= 0) n[cur] = tid; n[t.at] = id; return n;
  }
  const n = draft.filter(x => x !== id); let at = t.at; if (cur >= 0 && cur < at) at--;
  if (cur < 0 && n.length >= max) return null;
  n.splice(at, 0, id);
  return n.join() === draft.join() ? null : n;
}
type RDrag = { id: string; fromDraft: boolean; x: number; y: number; sx: number; sy: number; live: boolean; target: Target | null };

function ReviseBoard({ config: cfg, onChange, onShare }: { config: EvidenceReviseConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const lines = useMemo(() => allLines(cfg), [cfg]);
  const byId = useMemo(() => Object.fromEntries(lines.map(l => [l.id, l])), [lines]);
  const res = useMemo(() => resolveMarks(cfg), [cfg]);
  const max = cfg.maxSentences ?? 6;
  const start = useMemo(() => cfg.drafts[0].sentences.map(s => s.id), [cfg]);
  const [draft, setDraft] = useState<string[]>(start);
  const [undo, setUndo] = useState<string[][]>([]);
  const [moves, setMoves] = useState(0);
  const [drag, setDrag] = useState<RDrag | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [focusCrit, setFocusCrit] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const [shared, setShared] = useState(false);
  const root = useRef<HTMLElement>(null);
  const draftEl = useRef<HTMLOListElement>(null);
  const wide = useWide(root);
  const dragRef = useRef(drag); dragRef.current = drag;
  const draftRef = useRef(draft); draftRef.current = draft;
  const score = useCallback((ids: string[]) => scoreDraft(cfg, res, ids), [cfg, res]);
  const scores = useMemo(() => score(draft), [score, draft]);
  const startScores = useMemo(() => score(start), [score, start]);
  const preview = drag?.live ? applyMove(draft, drag.id, drag.target, max) : null;
  const previewScores = useMemo(() => preview ? score(preview) : null, [preview?.join(), score]); // eslint-disable-line react-hooks/exhaustive-deps
  const lvl = (i: number) => cfg.levels[i];
  const top = cfg.levels.length - 1;
  const tags = (ids: string[]) => ids.map(id => byId[id].tag).join(" + ");
  const groupLabel = { a: cfg.drafts[0].label, b: cfg.drafts[1].label, s: "Spare lines" };

  const commit = useCallback((next: string[], msg: string) => {
    setUndo(u => [...u.slice(-30), draftRef.current]);
    setDraft(next); setMoves(m => m + 1); setSel(null); setShared(false);
    const s = scoreDraft(cfg, res, next);
    setSay(`${msg} Rubric: ${cfg.rubric.map(r => `${r.name} ${cfg.levels[s[r.id].li].label}`).join(", ")}.`);
    onChange?.();
  }, [cfg, res, onChange]);
  const describe = (id: string, t: Target, cur: string[]) => {
    const l = byId[id];
    if (t.kind === "out") return `Took out ${l.tag}.`;
    if (t.kind === "replace") { const o = byId[cur[t.at]]; return cur.includes(id) ? `Swapped ${l.tag} and ${o.tag}.` : `${l.tag} replaces ${o.tag}.`; }
    return cur.includes(id) ? `Moved ${l.tag} to line ${t.at + 1 - (cur.indexOf(id) < t.at ? 1 : 0)}.` : `Added ${l.tag} as line ${t.at + 1}.`;
  };
  const move = (id: string, t: Target) => {
    const cur = draftRef.current, next = applyMove(cur, id, t, max);
    if (!next) { if (t.kind === "insert" && !cur.includes(id) && cur.length >= max) setSay(`Your draft is full (${max} lines). Drop the line on one to replace it.`); return; }
    commit(next, describe(id, t, cur));
  };

  /* --- hit testing --- */
  const targetAt = (x: number, y: number, d: RDrag): Target | null => {
    const list = draftEl.current; if (!list) return null;
    const r = list.getBoundingClientRect();
    const inside = x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 22 && y <= r.bottom + 22;   // magnetic margin
    if (!inside) return d.fromDraft ? { kind: "out" } : null;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-eb-row-line]")];
    for (let i = 0; i < rows.length; i++) {
      const rr = rows[i].getBoundingClientRect();
      if (rows[i].dataset.ebLine !== d.id && y >= rr.top + rr.height * .26 && y <= rr.bottom - rr.height * .26) return { kind: "replace", at: i };
    }
    return { kind: "insert", at: rows.filter(row => { const rr = row.getBoundingClientRect(); return rr.top + rr.height / 2 < y; }).length };
  };
  useEffect(() => {
    if (!drag) return;
    const mv = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const live = d.live || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5;
      if (live && !d.live) setSel(null);
      setDrag({ ...d, x: e.clientX, y: e.clientY, live, target: live ? targetAt(e.clientX, e.clientY, d) : null });
    };
    const up = () => {
      const d = dragRef.current; setDrag(null);
      if (!d) return;
      if (d.live) { if (d.target) move(d.id, d.target); return; }
      tap(d.id, d.fromDraft);
    };
    // pointercancel: drop the preview, keep the draft as last committed; never apply the hovered edit
    const cancel = () => { const d = dragRef.current; setDrag(null); if (d?.live) setSay("Drag interrupted; your draft is unchanged."); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drag?.live) return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", stop);
    const t = setInterval(() => {
      const d = dragRef.current; if (!d?.live) return;
      const edge = 56, v = d.y > innerHeight - edge ? 14 : d.y < edge ? -14 : 0;
      if (!v) return;
      const before = scrollY; scrollBy(0, v);
      if (scrollY !== before) setDrag({ ...d, target: targetAt(d.x, d.y, d) });
    }, 24);
    return () => { clearInterval(t); document.removeEventListener("selectstart", stop); };
  }, [drag?.live]); // eslint-disable-line react-hooks/exhaustive-deps

  /* tap path (phones): tap a line, then tap where it goes */
  const tap = (id: string, inDraft: boolean) => {
    const cur = draftRef.current;
    if (sel && sel !== id && inDraft) { move(sel, { kind: "replace", at: cur.indexOf(id) }); return; }
    if (sel === id) { setSel(null); setSay("Deselected."); return; }
    setSel(id);
    setSay(inDraft ? `Selected ${byId[id].tag}. Tap another line in your draft to swap them, or × to take it out.` : `Selected ${byId[id].tag}. Tap a line in your draft to replace it, or tap “Add it here” at the end.`);
  };
  const onLineDown = (e: React.PointerEvent, id: string, inDraft: boolean) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDrag({ id, fromDraft: inDraft, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, live: false, target: null });
  };

  /* --- share --- */
  const share = () => {
    const s = scores;
    const rowsTxt = cfg.rubric.map(r => `${r.name.toLowerCase()} ${lvl(s[r.id].li).label.toLowerCase()}`).join(", ");
    const changed = draft.join() !== start.join();
    const learner = changed
      ? `I rebuilt the ${cfg.drafts[0].label.toLowerCase()} as ${tags(draft)}. The rubric now reads ${rowsTxt}.`
      : `I haven’t changed the ${cfg.drafts[0].label.toLowerCase()} yet. The rubric reads ${rowsTxt}.`;
    const weakest = [...cfg.rubric].sort((x, y) => s[x.id].li - s[y.id].li)[0];
    const w = s[weakest.id];
    const lifted = cfg.rubric.filter(r => s[r.id].li > startScores[r.id].li).map(r => r.name.toLowerCase());
    let reply: string;
    if (w.li === top) reply = cfg.perfectReply ?? `Every row is ${lvl(top).label.toLowerCase()}, and each line earns its place. Try the same moves on your own draft.`;
    else {
      const g = w.gap && cfg.gaps?.[w.gap];
      const look = w.cause.length ? ` Look at ${w.cause.map(id => `${byId[id].tag} (“${quoteIn(byId[id].text, 70)}”)`).join(" and ")}.` : "";
      reply = `${weakest.name} is still ${lvl(w.li).label.toLowerCase()}.${look} ${w.reply ?? w.why}${g ? ` (${g.name}.)` : ""}`;
      if (lifted.length) reply += ` You’ve already lifted ${lifted.join(" and ")} from where the first draft started.`;
    }
    const data = `revise · draft ${draft.map(id => byId[id].tag).join(",")} · ${cfg.rubric.map(r => `${r.id} ${lvl(s[r.id].li).id}`).join(", ")} · start ${cfg.rubric.map(r => `${r.id} ${lvl(startScores[r.id].li).id}`).join(", ")} · ${moves} move${moves === 1 ? "" : "s"}`;
    setShared(true); setSay("Shared with Keating.");
    onShare?.({ learner, data, reply });
  };
  const startOver = () => { commit(start, "Back to the first draft."); setMoves(0); };
  const doUndo = () => {
    const prev = undo[undo.length - 1]; if (!prev) return;
    setUndo(u => u.slice(0, -1)); setDraft(prev); setSel(null); setShared(false);
    setSay(`Undone. Your draft is ${tags(prev) || "empty"}.`); onChange?.();
  };

  const levelsOf = (s: Record<string, RowScore> | null) => s && Object.fromEntries(cfg.rubric.map(r => [r.id, lvl(s[r.id].li).id]));
  useEffect(() => { if (!import.meta.env.DEV) return; window.keatingEvidence = { snapshot: () => ({ mode: "revise", draft, sel, moves, drag: drag ? (drag.live ? "carry" : "press") : "idle", target: drag?.target ?? null, levels: levelsOf(scores), preview: levelsOf(previewScores), undo: undo.length }) }; });

  const shown = previewScores ?? scores;
  const cited = new Set(focusCrit ? shown[focusCrit].cause : []);
  const t = drag?.live ? drag.target : null;
  const carried = drag?.live ? byId[drag.id] : null;
  const full = draft.length >= max;
  const pool = lines.filter(l => !draft.includes(l.id));
  const floatLabel = !carried ? "" : !t ? "Drop it in your draft"
    : t.kind === "out" ? "Take it out"
    : t.kind === "replace" ? (draft.includes(carried.id) ? `Swap with ${byId[draft[t.at]].tag}` : `Replaces ${byId[draft[t.at]].tag}`)
    : !preview ? (full && !draft.includes(carried.id) ? `Full: drop on a line to replace it` : "Stays where it is")
    : draft.includes(carried.id) ? `Move to line ${preview.indexOf(carried.id) + 1}` : `Add as line ${t.at + 1}`;

  const lineRow = (l: Line, i: number, inDraft: boolean) => <li key={l.id} className="eb-sline" data-eb-line={l.id} data-eb-row-line={inDraft ? "1" : undefined}
    data-in={inDraft ? "draft" : "pool"} data-group={l.group}
    data-insert-before={inDraft && t?.kind === "insert" && t.at === i && preview ? "1" : undefined}
    data-target={inDraft && t?.kind === "replace" && t.at === i ? "replace" : undefined}
    data-leaving={carried?.id === l.id && t?.kind === "out" ? "1" : undefined}
    data-lifted={carried?.id === l.id ? "1" : undefined} data-sel={sel === l.id ? "1" : undefined} data-cited={cited.has(l.id) ? "1" : undefined}
    onPointerDown={e => onLineDown(e, l.id, inDraft)} onMouseDown={e => { if (!(e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
    <span className="eb-line-tag">{l.tag}</span>
    <span className="eb-line-text">{l.text}</span>
    {inDraft && <button type="button" className="eb-x" aria-label={`Take out ${l.tag}`} onClick={() => move(l.id, { kind: "out" })}>×</button>}
  </li>;

  return <section ref={root} className={"eb eb-revise" + (drag?.live ? " is-dragging" : "")} data-evidence="revise" data-layout={wide ? "wide" : "stack"} aria-label={cfg.title}>
    <header className="eb-head">
      <h3 className="eb-title">{cfg.title}</h3>
      {cfg.instructions && <p className="eb-muted eb-instructions">{cfg.instructions}</p>}
    </header>
    <div className="eb-canvas eb-revise-canvas">
      <div className="eb-mine">
        <p className="eb-col-head"><span>Your draft</span><span className="eb-muted">{draft.length} of {max} lines</span></p>
        <ol ref={draftEl} className="eb-mydraft" aria-label="Your draft">
          {draft.map((id, i) => lineRow(byId[id], i, true))}
          <li className="eb-end-slot" data-on={t?.kind === "insert" && t.at === draft.length && preview ? "1" : undefined} data-armed={sel ? "1" : undefined}
            onClick={() => { if (sel) move(sel, { kind: "insert", at: draftRef.current.length }); }}>
            {full ? `Full: drop a line on one to replace it` : sel ? "Add it here" : "Drop a line here to add it"}
          </li>
        </ol>
        <div className="eb-score" role="group" aria-label="Rubric for your draft">
          {cfg.rubric.map(r => {
            const cur = scores[r.id], pv = previewScores?.[r.id], s0 = startScores[r.id];
            const ch = pv && pv.li !== cur.li ? (pv.li > cur.li ? "up" : "down") : undefined;
            const show = pv ?? cur;
            return <div key={r.id} className="eb-crit" data-eb-crit={r.id} data-level={lvl(cur.li).id} data-preview={pv ? lvl(pv.li).id : undefined} data-trend={ch}
              onPointerEnter={() => setFocusCrit(r.id)} onPointerLeave={() => setFocusCrit(f => f === r.id ? null : f)}>
              <span className="eb-crit-name">{r.name}</span>
              <span className="eb-meter" aria-hidden="true">
                {cfg.levels.map((l, i) => <span key={l.id} className="eb-pip" data-on={i <= cur.li && (!pv || i <= pv.li) ? "1" : undefined}
                  data-gain={pv && i > cur.li && i <= pv.li ? "1" : undefined} data-loss={pv && i <= cur.li && i > pv.li ? "1" : undefined}
                  data-start={i === s0.li ? "1" : undefined} />)}
              </span>
              <span className="eb-crit-level" title={r.descriptors[lvl(show.li).id]}>{ch ? <>{lvl(cur.li).label} <span aria-hidden="true">→</span> <b>{lvl(pv!.li).label}</b></> : lvl(cur.li).label}</span>
              <p className="eb-crit-why">{show.cause.length > 0 && <span className="eb-cites">{tags(show.cause)}</span>} {show.why}{show.gap && show.li < top && cfg.gaps?.[show.gap] ? <span className="eb-gap"> {cfg.gaps[show.gap].name}.</span> : null}</p>
            </div>;
          })}
        </div>
      </div>
      <div className="eb-poolcol">
        <p className="eb-col-head"><span>Lines you can use</span></p>
        {(["b", "a", "s"] as const).map(g => { const ls = pool.filter(l => l.group === g); return ls.length > 0 && <div key={g} className="eb-pool" data-pool={g}>
          <p className="eb-pool-label">{g === "a" ? `Cut from your draft` : groupLabel[g]}</p>
          <ul className="eb-pool-list">{ls.map((l, i) => lineRow(l, i, false))}</ul>
        </div>; })}
        {!pool.length && <p className="eb-muted eb-pool-empty">Every line is in your draft.</p>}
      </div>
    </div>
    {carried && <div className="eb-float" style={{ transform: `translate(${Math.max(4, Math.min(drag!.x + 12, innerWidth - Math.min(260, innerWidth - 8) - 4))}px, ${drag!.y + 14}px)` }} aria-hidden="true" data-kind={t?.kind ?? "none"}>
      <span className="eb-float-rel">{carried.tag} · {floatLabel}</span>
      <q>{quote(carried.text, 80)}</q>
    </div>}
    <div className="eb-actions">
      <button type="button" className="eb-primary" onClick={share} disabled={shared || (!moves && !undo.length)}>{shared ? "Shared" : "Share with Keating"}</button>
      <button type="button" className="eb-quiet" onClick={doUndo} disabled={!undo.length}>Undo</button>
      <button type="button" className="eb-quiet" onClick={startOver} disabled={draft.join() === start.join()}>Start over</button>
      <span className="eb-count">{cfg.rubric.filter(r => scores[r.id].li === top).length} of {cfg.rubric.length} rows {lvl(top).label.toLowerCase()} · {moves} move{moves === 1 ? "" : "s"}</span>
    </div>
    <details className="eb-keys">
      <summary>Use buttons instead</summary>
      <div className="eb-keys-list">
        <p className="eb-keys-label">Your draft</p>
        {draft.map((id, i) => <div key={id} className="eb-keys-row"><span className="eb-line-tag">{byId[id].tag}</span><span className="eb-keys-text">{quote(byId[id].text, 70)}</span>
          <button type="button" className="eb-quiet" aria-label={`Move ${byId[id].tag} up`} disabled={!i} onClick={() => move(id, { kind: "insert", at: i - 1 })}>↑</button>
          <button type="button" className="eb-quiet" aria-label={`Move ${byId[id].tag} down`} disabled={i === draft.length - 1} onClick={() => move(id, { kind: "insert", at: i + 2 })}>↓</button>
          <button type="button" className="eb-quiet" onClick={() => move(id, { kind: "out" })}>Take out</button></div>)}
        <p className="eb-keys-label">Lines you can use</p>
        {pool.map(l => <div key={l.id} className="eb-keys-row"><span className="eb-line-tag">{l.tag}</span><span className="eb-keys-text">{quote(l.text, 70)}</span>
          <button type="button" className="eb-quiet" aria-label={`Add ${l.tag}`} disabled={full} onClick={() => move(l.id, { kind: "insert", at: draft.length })}>Add</button></div>)}
      </div>
    </details>
    <p className="eb-sr" role="status" aria-live="polite">{say}</p>
  </section>;
}

/* ======================= presets ======================= */
const coffee: EvidenceLinkConfig = {
  mode: "link",
  title: "Does the article back its headline?",
  instructions: "Drag a sentence onto a claim, and drop it on what you think it does: backs it, partly, or undercuts it. To take more than one piece, tap a sentence and pull the handle at its end, or press and hold, then sweep.",
  passage: {
    headline: "Drinking coffee helps you live longer, study finds",
    source: "News report on a cohort study (illustrative)",
    paragraphs: [
      [{ id: "size", text: "Researchers followed about 400,000 adults aged 50 to 71 for 13 years." },
       { id: "result", text: " People who drank two or more cups a day were about 10 percent less likely to die during that time than people who drank none." }],
      [{ id: "differ", text: "Coffee drinkers differed in other ways too:" },
       { id: "smoke", text: " many of the heaviest drinkers also smoked." },
       { id: "adjust", text: " Once the team adjusted for smoking, the link between coffee and a lower risk of death grew stronger, not weaker." },
       { id: "once", text: " Diet and exercise were asked about only once, at the start." }],
      [{ id: "observ", text: "“This is an observational study,” said the lead author." },
       { id: "cantsay", text: " “We can’t say" },
       { id: "fragment", text: " coffee itself is responsible." },
       { id: "harm", text: " But for most people, it’s reassuring that coffee doesn’t seem to be harmful.”" }],
      [{ id: "edith", text: "Edith, 98, drinks four cups a day and has no plans to stop." },
       { id: "kept", text: " “Coffee has kept me going,” she said." }],
    ],
  },
  claims: [
    { id: "headline", text: "Coffee makes people live longer.", verdict: "Not as worded. The study found a link between coffee and a lower death rate, and its own author says it can’t show coffee is the cause.",
      links: [
        { spanId: "result", relation: "partial", why: "Coffee drinkers died less often over 13 years. That’s a link between coffee and survival, not evidence that coffee caused it.", gap: "correlation" },
        { spanId: "adjust", relation: "partial", why: "Ruling out smoking removes one rival explanation, so the link is sturdier. Other differences between coffee drinkers weren’t tested here.", gap: "correlation" },
        { spanId: "once", relation: "contradicts", why: "Lifestyle was measured once, 13 years earlier, so the study can’t fully separate coffee from how its drinkers live.", key: false },
        { spanId: "observ", relation: "contradicts", why: "Observational means people chose their own coffee; nobody was assigned it. That design can show a link but not a cause.", gap: "correlation" },
        { spanId: "cantsay", relation: "contradicts", why: "The author says outright that they can’t claim coffee is responsible.", gap: "correlation" },
        { spanId: "fragment", relation: "contradicts", key: false, gap: "context", why: "Read it with the words before it: “We can’t say coffee itself is responsible.” Cut off from “We can’t say,” the fragment flips the author’s meaning." },
        { spanId: "harm", relation: "irrelevant", gap: "hedge", why: "“Doesn’t seem to be harmful” is a much weaker claim than “helps you live longer”. A headline that turns one into the other has dropped the hedge." },
        { spanId: "edith", relation: "irrelevant", gap: "anecdote", why: "One 98-year-old is a single case. She could have lived long for many reasons, and one person can’t show a trend across 400,000." },
        { spanId: "kept", relation: "irrelevant", gap: "anecdote", why: "This is Edith’s own belief about herself, not a measurement. A vivid quote isn’t a trend." },
        { spanId: "size", relation: "irrelevant", why: "A big, long study makes the link more trustworthy as a link, but size alone can’t turn a link into a cause." },
        { spanId: "smoke", relation: "irrelevant", gap: "context", why: "On its own this raises a rival explanation, but the next sentence says the team adjusted for smoking. Read on before counting it." },
      ] },
    { id: "big", text: "The study was large and long-term.", verdict: "Supported: 400,000 adults over 13 years.",
      links: [{ spanId: "size", relation: "supports", why: "About 400,000 adults over 13 years is both large and long." }] },
    { id: "fewer", text: "Coffee drinkers were less likely to die during the study.", verdict: "Supported, and the link held up after adjusting for smoking.",
      links: [
        { spanId: "result", relation: "supports", why: "This is the finding itself: about 10 percent less likely to die over 13 years." },
        { spanId: "adjust", relation: "supports", key: false, why: "The link grew stronger once smoking was taken into account, so it isn’t just smokers dragging the non-drinkers’ numbers around." },
        { spanId: "edith", relation: "irrelevant", gap: "anecdote", why: "One long-lived coffee drinker doesn’t tell you how coffee drinkers did as a group." },
      ] },
    { id: "authors", text: "The researchers say coffee is what makes the difference.", verdict: "Contradicted: the lead author says they can’t say coffee itself is responsible.",
      links: [
        { spanId: "cantsay", relation: "contradicts", why: "“We can’t say coffee itself is responsible” is the opposite of this claim." },
        { spanId: "fragment", relation: "contradicts", key: false, gap: "context", why: "Read the whole sentence: “We can’t say coffee itself is responsible.” Quoting only the second half makes the author say the reverse of what she said." },
        { spanId: "observ", relation: "contradicts", key: false, why: "Calling it observational is the author flagging that the study can’t show cause." },
        { spanId: "harm", relation: "irrelevant", gap: "hedge", why: "She says coffee doesn’t seem harmful. That’s about safety, not about coffee causing a longer life." },
      ] },
  ],
  gaps: {
    correlation: { name: "Correlation offered as causation", reply: "The article shows that coffee drinkers died less often. That’s a link. To say coffee *makes* you live longer, you’d have to rule out every other way coffee drinkers differ, and an observational study can’t do that. What else might people who drink two cups a day have in common?" },
    context: { name: "A quote out of context", reply: "Read every quote with the sentence it sits in. “Coffee itself is responsible” sounds like a finding until you see the words just before it: “We can’t say.” When a headline quotes a fragment, go back to the full sentence." },
    anecdote: { name: "An anecdote offered as a trend", reply: "Edith is the most memorable part of the article, and that’s the trap. One person’s story can’t show what happened across 400,000 people. Ask whether a sentence measures the group or just describes someone in it." },
    hedge: { name: "A hedge dropped", reply: "The author’s actual conclusion is “coffee doesn’t seem to be harmful”. The headline turned that into “helps you live longer”. Watch for words like *seem*, *may* and *linked to* disappearing between the study and the headline." },
  },
  perfectReply: "Every link holds. You found the link the study shows, the author’s own “we can’t say”, and you kept Edith out of it. So the honest headline is “Coffee drinkers lived a little longer in a big study; it may not be the coffee.” Want to try rewriting it?",
};

const millLetter: EvidenceLinkConfig = {
  mode: "link",
  title: "What does this source tell us about its author?",
  instructions: "A historian reads a source for who wrote it, why, and what they had to gain. This letter is a fictional composite (see the note under it). Drag sentences onto the claims about its author.",
  passage: {
    headline: "Letter to the editor, set in 1833",
    source: "A fictional composite written for this exercise, not a real document. It is modelled on arguments mill owners made during the 1830s factory reform debate, so read it as a type of source, not as evidence about any real mill.",
    paragraphs: [
      [{ id: "answer", text: "Sir, I write in answer to the charges lately made against the mills of this district." },
       { id: "employ", text: " I have employed children at my mill for twenty years," },
       { id: "know", text: " and I know their condition better than any gentleman who visits for an afternoon." }],
      [{ id: "fed", text: "The children in my mill are well fed and cheerful." },
       { id: "hours", text: " They work twelve hours, with an hour for dinner," },
       { id: "farm", text: " which is no more than a farm labourer’s child works at harvest." },
       { id: "workhouse", text: " Were the mills to close, these families would be in the workhouse by winter." }],
      [{ id: "air", text: "I will grant that the air in the carding room is close," },
       { id: "tired", text: " and that some of the younger ones grow tired toward evening." },
       { id: "idle", text: " But idleness, not labour, is the ruin of the poor." }],
    ],
  },
  claims: [
    { id: "stake", text: "The author has a personal stake in the debate.", verdict: "Supported: he employs the children whose work is being criticised, and he’s writing to defend it.",
      links: [
        { spanId: "employ", relation: "supports", why: "He has employed children for twenty years, so reform would cost him directly." },
        { spanId: "answer", relation: "supports", why: "He’s writing to answer charges against mills like his. The letter has a purpose: defence." },
        { spanId: "know", relation: "partial", key: false, why: "He claims insider knowledge, which could be real experience or a way to dismiss critics. Either way it shows he’s invested." },
      ] },
    { id: "concede", text: "The author admits some of his critics’ points.", verdict: "Supported, partly: he grants the bad air and tired children, then turns the argument back.",
      links: [
        { spanId: "air", relation: "supports", why: "“I will grant” is a concession: the carding-room air is bad." },
        { spanId: "tired", relation: "supports", why: "He concedes that the youngest children are exhausted by evening." },
        { spanId: "idle", relation: "irrelevant", why: "This is where he stops conceding and turns the point around." },
        { spanId: "fed", relation: "irrelevant", why: "This denies the critics’ charges rather than admitting any." },
      ] },
    { id: "proves", text: "The letter proves that mill children were well treated.", verdict: "Not supported: a defender’s own assertion can’t prove itself, and he concedes evidence against it.",
      links: [
        { spanId: "fed", relation: "irrelevant", gap: "faceValue", why: "“Well fed and cheerful” is the employer’s own word, written to answer critics. It tells us what he wanted readers to believe, not how the children were." },
        { spanId: "know", relation: "irrelevant", gap: "faceValue", why: "Claiming to know best isn’t evidence. A historian would check it against inspectors’ reports or the children’s own accounts." },
        { spanId: "air", relation: "contradicts", why: "Even the owner admits the air is close, which cuts against “well treated”." },
        { spanId: "tired", relation: "contradicts", why: "Children worn out by evening, in his own words, undercut the claim." },
        { spanId: "hours", relation: "contradicts", key: false, why: "Twelve hours a day for a child is long by the reformers’ standard. That was the very charge he was answering." },
      ] },
    { id: "compare", text: "His defence rests on comparing mill work with the alternatives.", verdict: "Supported: farm work and the workhouse are his main comparisons.",
      links: [
        { spanId: "farm", relation: "supports", why: "He compares mill hours with a farm child’s harvest hours." },
        { spanId: "workhouse", relation: "supports", why: "He offers the workhouse as the alternative, which makes the mill look like rescue." },
        { spanId: "idle", relation: "partial", key: false, why: "Setting labour against idleness is a comparison too, but it’s a moral one rather than a practical alternative." },
        { spanId: "hours", relation: "irrelevant", gap: "context", why: "On its own this is just a fact about hours. The comparison comes in the clause after it." },
      ] },
  ],
  gaps: {
    faceValue: { name: "A source taken at face value", reply: "The mill owner says the children are well fed and cheerful. That’s good evidence of what he wanted readers to believe, and weak evidence of how they actually lived. Ask who wrote it, why, and what they stood to lose, then look for a source with a different stake, like an inspector or a child worker." },
    context: { name: "A clause read out of its sentence", reply: "“They work twelve hours” is only half his sentence. The other half, “no more than a farm labourer’s child”, is the argument. Read the clause in its sentence before deciding what it does." },
  },
  perfectReply: "You read it like a historian: his stake, his concessions, and the comparisons that carry his argument. And you didn’t let “well fed and cheerful” prove itself. Which source would you want next to check him against?",
};


/* Science check (fix wave): the revision's 0.4 °C difference is inside its own ±0.5 °C thermometer precision,
   so "our results support the hypothesis" overclaims; only "consistent with … but not confirmed" is at the
   strength the data allows. 20 g NaCl per litre is ≈ 0.34 mol/kg, i ≈ 2, Kb = 0.512 °C·kg/mol → ΔT ≈ 0.35 °C,
   so a 0.4 °C average is a plausible measurement. Kitchen salting (≈ 10 g/L) raises it by under 0.2 °C. */
const labConclusion: EvidenceReviseConfig = {
  mode: "revise",
  title: "Make this conclusion stronger",
  instructions: "Your draft starts as the first draft. Drag in lines from the revision or the spare lines: drop one between lines to add it, on a line to replace it, or drag a line out to cut it. The rubric under your draft responds as you go.",
  drafts: [
    { id: "first", label: "First draft", sentences: [
      { id: "a1", text: "In conclusion, the experiment proved that salt makes water boil at a higher temperature." },
      { id: "a2", text: "The salty water took longer to boil, which shows this." },
      { id: "a3", text: "There may have been some errors." },
      { id: "a4", text: "Overall the experiment was a success and the hypothesis was correct." },
    ] },
    { id: "revised", label: "A classmate’s revision", sentences: [
      { id: "b1", text: "Our results support the hypothesis that dissolved salt raises the boiling point of water." },
      { id: "b2", text: "Water with 20 g of salt per litre boiled at 100.4 °C on average, compared with 100.0 °C for tap water, across three trials each." },
      { id: "b3", text: "The 0.4 °C difference is smaller than our thermometer’s ±0.5 °C precision, so it could be measurement error; a more precise thermometer and more trials would show whether it is real." },
    ] },
  ],
  spares: [
    { id: "s1", text: "Our results are consistent with the hypothesis that dissolved salt raises the boiling point of water, but they don’t confirm it." },
    { id: "s2", text: "So salt may raise the boiling point slightly, but this experiment can’t show it for certain." },
    { id: "s3", text: "Cooks salt pasta water so that it boils hotter, which agrees with our result." },
    { id: "s4", text: "The salty water also looked slightly cloudy." },
  ],
  levels: [{ id: "weak", label: "Weak" }, { id: "ok", label: "OK" }, { id: "strong", label: "Strong" }],
  rubric: [
    { id: "claim", name: "Claim", combine: "weakest", absentWhy: "No sentence answers the question yet.",
      descriptors: { weak: "No clear answer to the question.", ok: "Answers the question but claims more certainty than the data allows.", strong: "Answers the question at the strength the data allows." } },
    { id: "evidence", name: "Evidence", combine: "strongest", absentWhy: "No sentence gives a measurement.",
      descriptors: { weak: "No data, or data that measures something else.", ok: "Refers to results without numbers, or mixes in evidence that doesn’t fit.", strong: "Specific measurements of the thing the claim is about." } },
    { id: "limits", name: "Limitations", combine: "strongest", absentWhy: "Nothing says what limits the result.",
      descriptors: { weak: "None, or vague (“some errors”).", ok: "Names a limitation but not its effect.", strong: "Names a limitation and how it affects confidence." } },
    { id: "clarity", name: "Clarity", absent: "strong", absentWhy: "Every sentence moves the conclusion forward.",
      descriptors: { weak: "Sentences contradict each other.", ok: "Readable, but repeats itself or wanders.", strong: "Every sentence moves the conclusion forward." } },
  ],
  marks: [
    { sentence: "a1", criterion: "claim", level: "ok", gap: "overclaim", why: "It answers the question, but “proved” claims more than three small trials can show." },
    { sentence: "a2", criterion: "evidence", level: "weak", gap: "wrongMeasure", why: "Time to boil isn’t the temperature water boils at. Taking longer doesn’t show a higher boiling point.",
      reply: "A2 says the salty water took longer to boil. But the claim is about the temperature water boils at. Longer isn’t hotter: more water, a weaker flame or a colder start would all take longer too. Evidence has to measure the thing the claim is about, and only B2 does." },
    { sentence: "a3", criterion: "limits", level: "weak", why: "“Some errors” names nothing a reader could check or fix." },
    { sentence: "a4", criterion: "claim", level: "ok", gap: "overclaim", why: "“The hypothesis was correct” claims a certainty three trials can’t give." },
    { sentence: "b1", criterion: "claim", level: "ok", gap: "overclaim", why: "“Support” claims more than the data allows: the 0.4 °C difference is inside the thermometer’s ±0.5 °C precision, so the result is only consistent with the hypothesis.",
      reply: "B1 says the results support the hypothesis, but B2 and B3 show a 0.4 °C difference measured with a ±0.5 °C thermometer. A difference smaller than the instrument’s precision can’t support much. “Consistent with, but not confirmed” is as far as this data goes." },
    { sentence: "b2", criterion: "evidence", level: "strong", why: "Actual boiling temperatures for both conditions, averaged over three trials each." },
    { sentence: "b3", criterion: "limits", level: "strong", why: "It names the thermometer’s precision, says the difference falls inside it, and says what would settle it." },
    { sentence: "s1", criterion: "claim", level: "strong", why: "“Consistent with … but they don’t confirm it” is as far as a 0.4 °C difference on a ±0.5 °C thermometer can go." },
    { sentence: "s2", criterion: "claim", level: "strong", why: "“May … slightly” and “can’t show it for certain” keep the claim at the strength of the data." },
    { sentence: "s3", criterion: "evidence", level: "weak", gap: "outside", why: "Kitchen lore isn’t a measurement from this experiment. Cooks salt water for flavour; at kitchen amounts the boiling point rises by under 0.2 °C." },
    { sentence: "s4", criterion: "clarity", level: "ok", why: "True, but cloudiness says nothing about the boiling point. It wanders off the question." },
  ],
  clashes: [
    { sentences: ["a1", "a4"], criterion: "clarity", level: "ok", why: "A4 repeats A1’s claim with “success” added." },
    { sentences: ["a2", "b2"], criterion: "evidence", level: "ok", gap: "wrongMeasure", why: "A2’s time to boil sits next to B2’s temperatures and muddies them: only the temperatures bear on the claim." },
    { sentences: ["s3", "b2"], criterion: "evidence", level: "ok", gap: "outside", why: "The pasta-water line isn’t data from this experiment, and it dilutes B2’s measurements." },
    { sentences: ["a3", "b3"], criterion: "clarity", level: "ok", why: "A3’s “some errors” is a vaguer copy of B3. Keep the precise one." },
    { sentences: ["b3", "a4"], criterion: "clarity", level: "weak", gap: "hedge", why: "A4 says “the hypothesis was correct” after B3 says the difference could be measurement error. The ending undoes the hedge.",
      reply: "A4 still says “the hypothesis was correct”, after B3 says the difference could be measurement error. The ending undoes the hedge. When you revise, reread the last sentence against everything you changed above it." },
    { sentences: ["s1", "a4"], criterion: "clarity", level: "weak", gap: "hedge", why: "A4’s “the hypothesis was correct” contradicts “they don’t confirm it”." },
    { sentences: ["s2", "a4"], criterion: "clarity", level: "weak", gap: "hedge", why: "A4 says the hypothesis was correct; the other line says the experiment can’t show it for certain." },
  ],
  gaps: {
    overclaim: { name: "Claiming more than the data shows", reply: "A small experiment can be consistent with a hypothesis; it can’t prove it." },
    wrongMeasure: { name: "Evidence that measures something else", reply: "Check that the evidence measures the same quantity the claim is about." },
    outside: { name: "Evidence from outside the experiment", reply: "A conclusion rests on your own measurements." },
    hedge: { name: "A hedge dropped", reply: "A conclusion has to keep the uncertainty it admitted." },
  },
  perfectReply: "Every row is strong, and each line earns its place: a claim kept to “consistent with”, the measured temperatures, and a limitation that says the difference sits inside the thermometer’s precision. You also cut “the hypothesis was correct”, which the revision would have kept. Try the same moves on your own conclusion?",
};

/* English / argument writing: claim, evidence, reasoning, counter-argument. The Seattle figures are from the
   2016 start-time change studied by Dunster et al. (Science Advances, 2018) in two Seattle high schools: start
   moved 55 minutes later, students' median sleep rose 34 minutes, and grades in the studied biology class rose.
   The study did not measure family evenings or after-school jobs, so the bus line only partly answers the
   objection (Astra review). A spare line gives a full answer without claiming more than is known. */
const schoolStart: EvidenceReviseConfig = {
  mode: "revise",
  title: "Make the paragraph more persuasive",
  instructions: "Your draft starts as the first draft. Swap in lines from the revision, drop one on a line to replace it, or drag a line out to cut it. Watch which rubric rows move.",
  drafts: [
    { id: "first", label: "First draft", sentences: [
      { id: "a1", text: "School should start later." },
      { id: "a2", text: "Teenagers are always tired and nobody can learn at 8 am." },
      { id: "a3", text: "Lots of people agree with this." },
      { id: "a4", text: "It would make everything better." },
    ] },
    { id: "second", label: "Revised draft", sentences: [
      { id: "b1", text: "Our school should move its start time from 8:00 to 8:45." },
      { id: "b2", text: "Teenagers’ body clocks shift later in puberty, so many can’t fall asleep before 11 pm." },
      { id: "b3", text: "In a study at two Seattle high schools, after the start moved 55 minutes later, students’ median sleep rose by 34 minutes a night and grades in the class studied went up." },
      { id: "b4", text: "More sleep means students arrive able to concentrate in first period instead of fighting to stay awake." },
      { id: "b5", text: "Some parents worry about bus timetables and after-school jobs." },
      { id: "b6", text: "Seattle reworked its bus routes to fit the later start, so the change need not cost families their evenings." },
    ] },
  ],
  spares: [
    { id: "s1", text: "Buses can adapt, as Seattle reworked its routes for the later start; for students with jobs, a day ending at 3:45 instead of 3:00 still leaves the evening, and we could survey working students before deciding." },
  ],
  levels: [{ id: "beginning", label: "Beginning" }, { id: "developing", label: "Developing" }, { id: "secure", label: "Secure" }],
  rubric: [
    { id: "claim", name: "Specific claim", combine: "weakest", absentWhy: "No sentence says what should change.",
      descriptors: { beginning: "Vague about what should change.", developing: "Clear about the side, not the change.", secure: "Says exactly what should change." } },
    { id: "evidence", name: "Evidence", combine: "strongest",
      descriptors: { beginning: "Opinions or generalisations stand in for evidence.", developing: "Relevant facts, but general or unsourced.", secure: "Specific, sourced evidence that bears on the claim." } },
    { id: "reasoning", name: "Reasoning", combine: "strongest", absentWhy: "Nothing explains why the evidence matters.",
      descriptors: { beginning: "No explanation of why the evidence matters.", developing: "The link is implied, not spelled out.", secure: "Explains how the evidence supports the claim." } },
    { id: "counter", name: "Other side", combine: "strongest", absentWhy: "No objection appears anywhere. Who would object to a later start, and what would you say to them?",
      descriptors: { beginning: "No objection is mentioned.", developing: "An objection is named but not answered.", secure: "The strongest objection is named and answered." } },
  ],
  marks: [
    { sentence: "a1", criterion: "claim", level: "developing", why: "The side is clear, but “later” doesn’t say how much." },
    { sentence: "a2", criterion: "evidence", level: "beginning", gap: "generalise", why: "“Always tired” and “nobody can learn” are sweeping generalisations, not evidence." },
    { sentence: "a3", criterion: "evidence", level: "beginning", gap: "bandwagon", why: "“Lots of people agree” is popularity, not evidence that it works." },
    { sentence: "a4", criterion: "reasoning", level: "beginning", gap: "noLink", why: "“Make everything better” doesn’t say how or why." },
    { sentence: "b1", criterion: "claim", level: "secure", why: "It names the exact change: 8:00 to 8:45." },
    { sentence: "b2", criterion: "evidence", level: "developing", why: "A real fact about body clocks, but general and unsourced." },
    { sentence: "b3", criterion: "evidence", level: "secure", why: "A specific, checkable study with numbers, and it says where they come from: two schools, 55 minutes later, a median of 34 minutes more sleep." },
    { sentence: "b4", criterion: "reasoning", level: "secure", why: "It spells out the link: more sleep, so students can concentrate in first period." },
    { sentence: "b5", criterion: "counter", level: "developing", gap: "noAnswer", why: "It names the bus and jobs worry but doesn’t answer it." },
    { sentence: "b6", criterion: "counter", level: "developing", gap: "partAnswer", why: "Rerouting buses answers the timetable half. But nothing here shows families kept their evenings, and after-school jobs go unanswered, so it only partly answers the worry." },
    { sentence: "s1", criterion: "counter", level: "secure", why: "It answers both halves: buses with what Seattle did, jobs with the actual change in the end of the day, and it doesn’t claim more than it knows." },
  ],
  clashes: [
    { sentences: ["a2", "b3"], criterion: "evidence", level: "developing", gap: "generalise", why: "A2’s “always tired … nobody can learn” overstates what B3’s numbers show, and a reader who doubts A2 starts doubting B3." },
    { sentences: ["a3", "b3"], criterion: "evidence", level: "developing", gap: "bandwagon", why: "“Lots of people agree” sits next to the study and makes the paragraph sound like a poll." },
  ],
  gaps: {
    generalise: { name: "A generalisation standing in for evidence", reply: "“Always” and “nobody” invite a reader to think of one exception. Swap the sweeping line for a measurement." },
    bandwagon: { name: "Popularity offered as proof", reply: "How many people agree tells you nothing about whether a later start works." },
    noLink: { name: "Evidence not tied to the claim", reply: "A fact only persuades when you say what it shows about your claim." },
    noAnswer: { name: "An objection raised but not answered", reply: "Naming the worry is half the move; the answer is what earns trust." },
    partAnswer: { name: "An objection only partly answered", reply: "Check that your answer covers the whole worry and that your evidence shows what you say it shows. Rerouted buses don’t prove families kept their evenings." },
  },
  perfectReply: "Every row is secure: an exact change, a sourced study, the reasoning that ties sleep to first period, and the objection answered on both buses and jobs without claiming more than you know. Notice that you also cut the lines that sounded strong but weren’t evidence. Want to try it on your own paragraph?",
};

export const presets: Record<string, EvidenceBoardConfig> = { coffee, millLetter, labConclusion, schoolStart };

export const scenario = {
  tab: "Evidence",
  prompt: "This headline says coffee makes you live longer. Does the article back that up?",
  intro: "Let’s check it the way a fact-checker would: claim by claim, with the article’s own sentences as evidence. Drag a sentence, or part of one, onto a claim. Whatever stays unattached stays unsupported.",
  receiptLabel: "Evidence check",
  receiptText: "The learner asked whether an article supports its headline. Each link they make is checked against a reference reading, and the reason for every judgement is quoted from the passage.",
  preset: "coffee",
};

/** One chat setting per preset: what the learner asked and how Keating opens the component. */
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  coffee: { label: "Coffee headline · link", prompt: scenario.prompt, intro: scenario.intro },
  millLetter: { label: "Mill owner’s letter · link", prompt: "How do I tell if a primary source is biased?",
    intro: "Read it for who wrote it, why, and what they stood to gain. Here’s a mill owner’s letter set in 1833. It’s a fictional composite I wrote for practice, modelled on arguments from the factory reform debate, not a real archive document. Attach his own words to each claim about him.",
    receiptLabel: "Source reading", receiptText: "The learner asked how to read a primary source for bias. Each link they make between the letter and a claim about its author is checked, with a reason quoted from the letter." },
  labConclusion: { label: "Lab conclusion · revise", prompt: "My teacher said my lab conclusion was weak. What makes one strong?",
    intro: "Let’s revise it rather than talk about it. Your draft starts as the weak one. Borrow lines from a classmate’s revision or the spares, cut what doesn’t help, and watch the rubric under your draft.",
    receiptLabel: "Revision", receiptText: "The learner rebuilt a lab conclusion from its sentences. Each rubric row is scored from the sentences in their draft, and the row names the sentence that decides it." },
  schoolStart: { label: "School start · revise", prompt: "I rewrote my paragraph on later school start times. Is the second draft better? Why?",
    intro: "Find out by building it. Start from your first draft and swap in lines from the revision one at a time; the rubric shows which line moves which row.",
    receiptLabel: "Revision", receiptText: "The learner rebuilt a persuasive paragraph from its sentences. Each rubric row is scored from the sentences in their draft." },
};
