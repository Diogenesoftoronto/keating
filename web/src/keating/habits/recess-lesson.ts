import { packs } from "../../components/recess/engine/packs.js";
import type { RecessPack, RecessQuestion } from "../../components/recess/types";
import type { HabitLesson } from "./lesson";
import { pictureFor } from "./recess-images";

/* Recess builds a playable level from the real chat, without a model.
 *
 * Tutor text is Markdown with emphasis, inline/display maths and code. Every
 * protected span is masked to one opaque placeholder before any splitting or
 * shortening, so a sentence can only ever be cut between spans. DOM-rendered
 * fields (questions, answers, title, tldr) keep Markdown; canvas fields are run
 * through `recessPlainText`. Everything here is deterministic. */

export type RecessQuestionKind = "cloze" | "name" | "formula" | "swap" | "correction" | "apply"
  | "truefalse" | "why" | "example" | "order" | "meaning" | "oddone" | "compare";
/** Where a question's correct answer was taught: an index into the HabitLesson and a verbatim plain-text quote of that turn. */
export interface RecessQuestionSource { turn: number; quote: string }
export type RecessKindedQuestion = RecessQuestion & { kind: RecessQuestionKind; id: string; source?: RecessQuestionSource };
type KindedQuestion = RecessKindedQuestion;

const subjectCues: Record<string, RegExp> = {
  maths: /\b(?:maths?|calculus|derivative|integral|algebra|equation|chain rule|probability|theorem|geometry|fractions?)\b/gi,
  coding: /\b(?:python|javascript|typescript|recursion|recursive|programming|loop|compiler|debugger|asynchronous|array|stack frame)\b/gi,
  chemistry: /\b(?:chemistry|stoichiometry|oxidation|covalent|molar|molecules?|reactants?|bond energy|combustion)\b/gi,
  biology: /\b(?:biology|mitosis|meiosis|dna|rna|chromosomes?|photosynthesis|organisms?|cell division|ecosystem)\b/gi,
  physics: /\b(?:physics|acceleration|velocity|momentum|gravity|thermodynamics|newton|voltage|kinetic energy)\b/gi,
  music: /\b(?:music|metronome|chords?|melody|semitone|rhythm|treble|arpeggio|time signature)\b/gi,
  business: /\b(?:business|revenue|gross margin|inventory|customer|cash flow|break.even|operating profit)\b/gi,
  finance: /\b(?:finance|interest rate|compound interest|investment|inflation|dividends?|loan|bonds?|portfolio)\b/gi,
  literature: /\b(?:literature|metaphors?|similes?|narrator|poetry|protagonist|stanza|fiction|figurative language)\b/gi,
  history: /\b(?:history|historian|century|primary source|archival|empire|dated document|industrial revolution)\b/gi,
  spanish: /\b(?:spanish|español|ser o estar|ser and estar|estar|pretérito|subjuntivo|¿c[oó]mo)\b/gi,
  french: /\b(?:french|français|imparfait|passé composé|avoir|bonjour|être)\b/gi,
  japanese: /\b(?:japanese|hiragana|katakana|kanji|romaji)\b|[\u3040-\u30ff]+/gi,
  law: /\b(?:law|statute|tort|lawsuit|defendant|verdict|jurisdiction|legal|burden of proof|contract law)\b/gi,
  politics: /\b(?:politics|electoral|legislature|citizenship|coalition|filibuster|parliament|voting system)\b/gi,
};

const neutralNames: RecessPack["names"] = {
  drift: "Loose word", dart: "Runaway term", spin: "Tangled idea", split: "Loose phrase",
  worm: "Train of thought", myth: "Misconception", wall: "Wall of Text",
};

export function recessSubjectStyle(id: string, label = "General"): Pick<RecessPack, "id" | "cast" | "label" | "names"> {
  const practice = Object.hasOwn(packs, id) ? packs[id] : undefined;
  if (!practice) return { id: "general", cast: "maths", label: id === "physics" ? "Physics" : label, names: neutralNames };
  return { id, cast: practice.cast ?? practice.id, label: practice.label, names: practice.names };
}

function detectSubject(lesson: HabitLesson): string {
  const recent = lesson.slice(-4);
  const current = recent.slice(-2);
  const currentScores = scoreSubjects(current);
  if (currentScores[0].score > currentScores[1].score) return currentScores[0].subject;
  const scores = scoreSubjects(recent);
  return scores[0].score > scores[1].score ? scores[0].subject : "general";
}

function scoreSubjects(lesson: HabitLesson) {
  return Object.entries(subjectCues).map(([subject, cue]) => ({
    subject,
    score: lesson.reduce((sum, turn, index) => sum + Math.min(4, turn.text.match(cue)?.length ?? 0) * (index + 1), 0),
  })).sort((left, right) => right.score - left.score);
}

/* ------------------------------------------------------------------ plain text */

const SUPER: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ",
  x: "ˣ", y: "ʸ", z: "ᶻ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
  n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};
const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", equiv: "≡", to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", implies: "⇒", infty: "∞",
  partial: "∂", nabla: "∇", sum: "Σ", prod: "∏", int: "∫", ldots: "…", dots: "…", cdots: "⋯", circ: "∘",
  in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", forall: "∀", exists: "∃", degree: "°", prime: "′",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", quad: " ", qquad: " ",
};
const WORD_COMMANDS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh",
  "tanh", "log", "ln", "exp", "lim", "max", "min", "det", "gcd", "mod"]);
const TEXT_COMMANDS = new Set(["text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "operatorname", "textbf",
  "textit", "boldsymbol", "mathbb", "mathcal", "vec", "hat", "bar", "overline", "underline"]);

/** Reads `{…}` at `index` (or a single character); returns its content and the next index. */
function readGroup(tex: string, index: number): [string, number] {
  while (tex[index] === " ") index++;
  if (tex[index] !== "{") return [tex[index] ?? "", index + 1];
  let depth = 0;
  for (let i = index; i < tex.length; i++) {
    if (tex[i] === "{") depth++;
    else if (tex[i] === "}" && --depth === 0) return [tex.slice(index + 1, i), i + 1];
  }
  return [tex.slice(index + 1), tex.length];
}

const needsParens = (value: string) => /[\s+\-−·×/]/.test(value.trim()) && !/^\(.*\)$/.test(value.trim());

function script(value: string, table: Record<string, string>, marker: "^" | "_"): string {
  const chars = [...value];
  if (chars.length && chars.every(char => table[char] !== undefined)) return chars.map(char => table[char]).join("");
  return chars.length === 1 ? `${marker}${value}` : `${marker}(${value})`;
}

/** Simple LaTeX to readable Unicode for canvas text. Unknown commands keep their name. */
function latexToUnicode(tex: string): string {
  let out = "";
  for (let i = 0; i < tex.length;) {
    const char = tex[i];
    if (char === "\\") {
      const name = /^\\([A-Za-z]+|.)/.exec(tex.slice(i))?.[1] ?? "";
      i += name.length + 1;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [top, afterTop] = readGroup(tex, i);
        const [bottom, afterBottom] = readGroup(tex, afterTop);
        const a = latexToUnicode(top), b = latexToUnicode(bottom);
        out += `${needsParens(a) ? `(${a})` : a}/${needsParens(b) ? `(${b})` : b}`;
        i = afterBottom;
      } else if (name === "sqrt") {
        const [body, after] = readGroup(tex, i);
        const value = latexToUnicode(body);
        out += [...value].length === 1 ? `√${value}` : `√(${value})`;
        i = after;
      } else if (TEXT_COMMANDS.has(name)) {
        const [body, after] = readGroup(tex, i);
        out += latexToUnicode(body);
        i = after;
      } else if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "displaystyle") {
        // drop sizing commands; the delimiter that follows is kept
      } else if (WORD_COMMANDS.has(name)) {
        out += name;
        if (/^[A-Za-z0-9\\]/.test(tex[i] ?? "")) out += " ";
        else if (tex[i] === " " && /^ [A-Za-z0-9\\]/.test(tex.slice(i, i + 2))) { out += " "; i++; }
      } else if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
      } else if (name === "," || name === ";" || name === ":" || name === " " || name === "!") {
        out += name === "!" ? "" : " ";
      } else if (name === "{" || name === "}" || name === "$" || name === "%" || name === "&" || name === "#" || name === "_") {
        out += name;
      } else {
        out += name;
      }
      continue;
    }
    if (char === "^" || char === "_") {
      const [body, after] = readGroup(tex, i + 1);
      out += script(latexToUnicode(body), char === "^" ? SUPER : SUB, char);
      i = after;
      continue;
    }
    if (char === "{" || char === "}") { i++; continue; }
    out += char;
    i++;
  }
  return out;
}

/** Strips Markdown and turns simple LaTeX into readable Unicode, for text drawn on the canvas. */
export function recessPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => ` ${code} `)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => ` ${latexToUnicode(tex.trim())} `)
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => latexToUnicode(tex.trim()))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => a ?? b ?? "")
    .replace(/(^|[^\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/* --------------------------------------------------------------- masking spans */

type SpanKind = "fence" | "dmath" | "math" | "code" | "bold" | "italic";
interface Span { raw: string; kind: SpanKind; inner: string }
interface Doc { masked: string; spans: Span[] }

const SPAN = /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\$(?![\s$])[^$\n]+?(?<![\s\\])\$|`[^`\n]+`|\*\*(?![\s*])[^*\n]+?(?<![\s*])\*\*|\*(?![\s*])[^*\n]+?(?<![\s*])\*/g;
const PH = /\uE000([\uE100-\uEFFF])\uE001/g;
const BLANK = "\uE002";
const phIndex = (char: string) => char.charCodeAt(0) - 0xE100;

function mask(text: string): Doc {
  const spans: Span[] = [];
  const masked = text.replace(SPAN, raw => {
    if (spans.length >= 0xE00) return raw.replace(/\$/g, "＄");
    const kind: SpanKind = raw.startsWith("```") ? "fence" : raw.startsWith("$$") ? "dmath" : raw.startsWith("$") ? "math"
      : raw.startsWith("`") ? "code" : raw.startsWith("**") ? "bold" : "italic";
    const inner = kind === "fence" ? raw.slice(3, -3).replace(/^[^\n]*\n/, "")
      : kind === "dmath" || kind === "bold" ? raw.slice(2, -2) : raw.slice(1, -1);
    spans.push({ raw, kind, inner: inner.trim() });
    return `\uE000${String.fromCharCode(0xE100 + spans.length - 1)}\uE001`;
  }).replace(/\$/g, "＄"); // a lone dollar would unbalance every string it reaches
  return { masked, spans };
}

const restore = (doc: Doc, masked: string) => masked.replace(PH, (_, char: string) => doc.spans[phIndex(char)]?.raw ?? "");
const placeholders = (doc: Doc, masked: string) => [...masked.matchAll(PH)].map(match => ({
  start: match.index!, end: match.index! + match[0].length, span: doc.spans[phIndex(match[1])],
}));

/** Every unescaped `$` pairs up and `$$` blocks close. */
export function recessDollarsBalanced(text: string): boolean {
  return (text.replace(/\\\$/g, "").match(/\$/g)?.length ?? 0) % 2 === 0;
}

/* ------------------------------------------------------------------- sentences */

interface Sentence {
  id: number;
  turn: number;
  doc: Doc;
  masked: string;
  complete: boolean;
  question: boolean;
  filler: boolean;
  greeting: boolean;
  code: boolean;
  /** A trailing fragment ("If $y = f(g(x))$, then") right before display maths. */
  leads?: Span;
}
/** A Markdown list in one tutor turn, items still masked. */
interface ListBlock { doc: Doc; turn: number; ordered: boolean; items: string[]; intro?: string }
interface DisplayMath { span: Span; doc: Doc; turn: number; lead?: string; sentence?: Sentence }

const FILLER_START = /^(?:yes|yep|yeah|exactly|correct|right|great|nice|good|perfect|well done|that['’]s (?:right|it|correct)|spot on|next time|try|now try|let['’]s|over to you|so)\b/i;
const GREETING = /^(?:hi|hello|hey|welcome|good (?:morning|afternoon|evening)|great question|sure|of course|happy to help|thanks|thank you|no problem)\b|\b(?:what would you like|how can i help|what do you want to (?:learn|study)|what shall we|let me know (?:what|if)|anything else)\b/i;

function splitTurn(text: string, turn: number, firstId: number) {
  const doc = mask(text);
  const sentences: Sentence[] = [];
  const display: DisplayMath[] = [];
  const lists: ListBlock[] = [];
  let list: ListBlock | null = null;
  const flush = () => { if (list && list.items.length >= 2) lists.push(list); list = null; };
  let id = firstId;
  for (const rawParagraph of doc.masked.split(/\n\s*\n/)) {
    const paragraph = rawParagraph.replace(/\n(?!\s*(?:[-*+]\s|\d+[.)]\s|#|>))/g, " ");
    for (const rawLine of paragraph.split("\n")) {
      const marker = /^\s*(?:([-*+])|(\d+)[.)])\s+/.exec(rawLine);
      const line = rawLine.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "").trim();
      if (!line) continue;
      if (marker) {
        const ordered = marker[2] !== undefined;
        if (!list || list.ordered !== ordered) {
          flush();
          const previous = sentences.at(-1);
          list = { doc, turn, ordered, items: [], intro: previous ? previous.masked : undefined };
        }
        list.items.push(line);
      } else if (!/^#/.test(rawLine.trim())) flush();
      const only = /^\uE000([\uE100-\uEFFF])\uE001[.,;:]?$/.exec(line);
      const onlySpan = only ? doc.spans[phIndex(only[1])] : undefined;
      if (onlySpan?.kind === "fence") continue;
      if (onlySpan?.kind === "dmath") {
        const previous = sentences.at(-1);
        const lead = previous && !previous.complete && previous.turn === turn ? previous : undefined;
        if (lead) lead.leads = onlySpan;
        display.push({ span: onlySpan, doc, turn, lead: lead ? restore(doc, lead.masked) : undefined, sentence: lead });
        continue;
      }
      for (const piece of line.split(/(?<=[.!?…][)"”’]?)\s+(?=\S)/u)) {
        const masked = piece.trim();
        if (!masked) continue;
        const found = placeholders(doc, masked);
        const spans = found.map(item => item.span);
        for (const [index, item] of found.entries()) if (item.span?.kind === "dmath") {
          const before = masked.slice(0, item.start).trim();
          display.push({ span: item.span, doc, turn, lead: index === 0 && before ? restore(doc, before) : undefined });
        }
        const plainStart = masked.replace(PH, "x");
        sentences.push({
          id: id++, turn, doc, masked,
          complete: /[.!?…]["”’)]?$/.test(masked),
          question: /\?["”’)]?$/.test(masked),
          filler: FILLER_START.test(plainStart) || /\bnext time\b/i.test(plainStart),
          greeting: GREETING.test(plainStart),
          code: spans.some(span => span?.kind === "fence"),
        });
      }
    }
  }
  flush();
  return { doc, sentences, display, lists };
}

/* ------------------------------------------------------------------- key terms */

const STOP = new Set(`a about above actually after again against all almost alone along already also although always am among an and
another any anyone anything anyway are aren't around as ask asked at away back basically be became because become been before being
below best better between bit both but by call called came can can't cannot case certain certainly clear clearly come comes common
correct correctly could couldn't did didn't different do does doesn't doing don't done down during each easy either else enough
especially even ever every everyone everything exactly example examples explain fact far feel feels few find first follow following
for found from full fully further get gets getting give given gives go goes going gone good got great had has hasn't have haven't
having he hello help here hey hi his how however i i'm idea ideas if important in inside instead into is isn't it it's its itself
just keep keeps kept kind know known last later learn learning least less let let's lets like likely little look looking looks lot
made main make makes making many may maybe me mean means might mistake mistakes more most much must my need needs never new next
nice no not nothing now of off often oh ok okay on once one only onto or other others our out over own part perhaps point pretty
probably put question questions quick quite rather really right said same say says see seems seen should show shows simple simply
since so some something sometimes soon sort start still such sure take takes tell tells than thank thanks that that's the their
them then there there's these they thing things think this those though thought three through time times to today together too
took toward try trying turn two under understand until up upon us use used uses using usually very want wants was wasn't way ways
we well went were what what's when where whether which while who whole whose why will with within without won't word words work
works would wouldn't wrong yeah yes yet you you're your yours yourself applying apply nested`.split(/\s+/));

const stem = (word: string) => {
  const lower = word.toLowerCase().replace(/['’]s$/, "");
  return lower.length > 4 && lower.endsWith("s") && !/(?:ss|us|is)$/.test(lower) ? lower.slice(0, -1) : lower;
};
const isStop = (word: string) => STOP.has(word.toLowerCase()) || STOP.has(stem(word)) || /^\d+$/.test(word);
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const keyOf = (text: string) => (text.match(WORD) ?? []).map(stem).join(" ");

interface Term {
  key: string;
  text: string;
  words: number;
  emph: number;
  bold: number;
  count: number;
  turns: Set<number>;
  learner: number;
  first: number;
  code: boolean;
  strong: boolean;
  score: number;
  capitalOnly: boolean;
}

/** Phrase-broken token stream: maths and code break phrases, emphasis contributes its words. */
function tokensOf(doc: Doc): { tokens: string[]; surface: string[] } {
  const flat = doc.masked.replace(PH, (_, char: string) => {
    const span = doc.spans[phIndex(char)];
    return span && (span.kind === "bold" || span.kind === "italic") ? ` ${recessPlainText(span.inner)} ` : " | ";
  });
  const tokens: string[] = [], surface: string[] = [];
  for (const phrase of flat.split(/[^\p{L}\p{M}\p{N}'’\- ]+/u)) {
    for (const word of phrase.match(WORD) ?? []) { tokens.push(stem(word)); surface.push(word); }
    tokens.push("|"); surface.push("|");
  }
  return { tokens, surface };
}

function countKey(tokens: readonly string[], key: string): number {
  const parts = key.split(" ");
  let count = 0;
  for (let i = 0; i + parts.length <= tokens.length; i++) if (parts.every((part, j) => tokens[i + j] === part)) count++;
  return count;
}

function extractTerms(tutor: { turn: number; doc: Doc }[], learner: readonly string[]): Term[] {
  const terms = new Map<string, Term>();
  let order = 0;
  const add = (key: string, text: string, words: number, code = false) => {
    if (!key || terms.has(key)) return terms.get(key);
    const term: Term = { key, text, words, emph: 0, bold: 0, count: 0, turns: new Set(), learner: 0, first: order++, code,
      strong: false, score: 0, capitalOnly: true };
    terms.set(key, term);
    return term;
  };
  const streams = tutor.map(item => ({ ...item, ...tokensOf(item.doc) }));
  for (const { doc } of tutor) for (const span of doc.spans) {
    if (span.kind === "bold" || span.kind === "italic") {
      const plain = recessPlainText(span.inner);
      const words = plain.match(WORD) ?? [];
      if (!words.length || words.length > 3 || plain.length > 32 || /[$\\=^]/.test(span.inner) || words.every(isStop)) continue;
      if (span.kind === "italic" && words.length > 1) continue; // an italic phrase is an example, not a term
      const term = add(keyOf(plain), plain, words.length);
      if (!term) continue;
      term.emph += span.kind === "bold" ? 3 : 2;
      if (span.kind === "bold") term.bold++;
    } else if (span.kind === "code" && span.inner.length <= 24 && span.inner.split(/\s+/).length <= 3) {
      const term = add(`\`${span.inner}`, span.inner, 1, true);
      if (term) { term.emph += 2; term.count++; term.turns.add(-1); }
    }
  }
  for (const { tokens, surface } of streams) for (let i = 0; i < tokens.length; i++) {
    const word = surface[i];
    if (word === "|" || isStop(word)) continue;
    if (word.length >= 4) add(tokens[i], word, 1);
    const next = surface[i + 1];
    if (next && next !== "|" && !isStop(next) && word.length >= 3 && next.length >= 3) add(`${tokens[i]} ${tokens[i + 1]}`, `${word} ${next}`, 2);
  }
  const learnerTokens = learner.map(text => tokensOf(mask(text)).tokens);
  for (const term of terms.values()) {
    if (term.code) { term.strong = true; continue; }
    for (const { tokens, surface, turn } of streams) {
      const parts = term.key.split(" ");
      for (let i = 0; i + parts.length <= tokens.length; i++) {
        if (!parts.every((part, j) => tokens[i + j] === part)) continue;
        term.count++;
        term.turns.add(turn);
        if (!/^\p{Lu}/u.test(surface[i])) term.capitalOnly = false;
        const seen = surface.slice(i, i + parts.length).join(" ");
        if (term.emph === 0 && seen.toLowerCase() === term.key) term.text = seen;
      }
    }
    term.learner = learnerTokens.reduce((sum, tokens) => sum + countKey(tokens, term.key), 0);
  }
  const list = [...terms.values()].filter(term => term.count > 0 || term.code);
  for (const term of list) {
    if (!term.code && term.emph === 0) {
      // Keep the casing a reader would expect mid-sentence.
      if (!term.capitalOnly || term.words > 1) term.text = term.text.toLowerCase();
    }
    term.strong = term.code || term.emph > 0 || term.turns.size >= 2 || (term.learner > 0 && term.count > 0) || (term.words > 1 && term.count >= 2)
      || (term.count >= 2 && term.text.length >= 6);
    term.score = term.emph + term.turns.size * 1.5 + term.count * 0.5 + term.learner * 2 + (term.words - 1);
  }
  // A word that only ever appears inside a longer kept term is that term.
  const kept = list.filter(term => term.emph > 0 || list.filter(other => other !== term && other.strong && other.words > term.words
    && ` ${other.key} `.includes(` ${term.key} `)).reduce((sum, other) => sum + other.count, 0) < term.count);
  const rank = (a: Term, b: Term) => b.score - a.score || a.first - b.first;
  const strong = kept.filter(term => term.strong).sort(rank);
  if (strong.length >= 4) return strong;
  const weak = kept.filter(term => !term.strong && term.text.length >= 5)
    .sort((a, b) => b.words - a.words || b.text.length - a.text.length || a.first - b.first);
  return [...strong, ...weak.slice(0, 6 - strong.length)];
}

/* ------------------------------------------------------------- term placement */

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function termPattern(term: Term) {
  const words = term.text.match(WORD) ?? [term.text];
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(word => `${escapeRegex(word)}s?`).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

interface Hit { start: number; end: number; emphasized?: "bold" | "italic"; exact: boolean }
function findTerm(doc: Doc, masked: string, term: Term): Hit[] {
  const hits: Hit[] = [];
  for (const item of placeholders(doc, masked)) {
    const span = item.span;
    if (!span) continue;
    if ((span.kind === "bold" || span.kind === "italic") && keyOf(recessPlainText(span.inner)) === term.key) {
      hits.push({ start: item.start, end: item.end, emphasized: span.kind, exact: true });
    } else if (term.code && span.kind === "code" && span.inner === term.text) {
      hits.push({ start: item.start, end: item.end, exact: true });
    }
  }
  if (!term.code) for (const match of masked.matchAll(termPattern(term))) {
    hits.push({ start: match.index!, end: match.index! + match[0].length, exact: match[0].toLowerCase() === term.text.toLowerCase() });
  }
  return hits.sort((a, b) => a.start - b.start);
}

const capitalize = (text: string) => text.replace(/^(\P{L}*)(\p{L})/u, (_, lead: string, letter: string) => lead + letter.toUpperCase());
const plainKey = (text: string) => recessPlainText(text).toLowerCase().replace(/\s+/g, " ").trim();

/** Splice `replacement` over a hit, keeping emphasis, sentence-start capitals, and a/an agreement. */
function splice(masked: string, hit: Hit, replacement: string): string {
  let before = masked.slice(0, hit.start);
  const starts = !before.replace(PH, "x").trim();
  let text = starts ? capitalize(replacement) : replacement;
  if (hit.emphasized === "bold") text = `**${text}**`;
  else if (hit.emphasized === "italic") text = `*${text}*`;
  before = before.replace(/\b(a|an|A|An)(\s+)$/, (_, article: string, space: string) => {
    const vowel = /^[aeiou]/i.test(replacement);
    const next = vowel ? "an" : "a";
    return (article[0] === "A" ? capitalize(next) : next) + space;
  });
  return before + text + masked.slice(hit.end);
}

/* ------------------------------------------------------------------ shortening */

/** Clause boundaries (`, ; :` then space) outside brackets. */
function clausePieces(masked: string): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i];
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0 && /[,;:]/.test(char) && /\s/.test(masked[i + 1] ?? "")) {
      pieces.push({ start, end: i + 1 });
      start = i + 1;
      while (/\s/.test(masked[start] ?? "")) start++;
      i = start - 1;
    }
  }
  pieces.push({ start, end: masked.length });
  return pieces;
}

/** First clause of a masked text, without its trailing punctuation. */
const firstClause = (masked: string) => masked.slice(0, clausePieces(masked)[0].end).trim().replace(/[,;:.!]$/, "");

/** Shortest clause window around `keep` (a masked index) that fits; cuts only between clauses. */
function fitClauses(doc: Doc, masked: string, keep: number, limit: number, allowEllipsis = true): string | null {
  const whole = restore(doc, masked).replace(BLANK, "____");
  if (whole.length <= limit) return whole;
  if (!allowEllipsis) return null;
  const pieces = clausePieces(masked);
  const home = Math.max(0, pieces.findIndex(piece => keep >= piece.start && keep < piece.end + 1));
  let from = home, to = home;
  const render = (a: number, b: number) => {
    let text = masked.slice(pieces[a].start, pieces[b].end).trim().replace(/[,;:]$/, "");
    text = restore(doc, text).replace(BLANK, "____");
    return `${a > 0 ? "…" : ""}${text}${b < pieces.length - 1 ? "…" : ""}`;
  };
  if (render(from, to).length > limit) return null;
  for (let grew = true; grew;) {
    grew = false;
    if (to + 1 < pieces.length && render(from, to + 1).length <= limit) { to++; grew = true; }
    if (from > 0 && render(from - 1, to).length <= limit) { from--; grew = true; }
  }
  const words = render(from, to).replace(/[…_]/g, " ").split(/\s+/).filter(Boolean).length;
  return words >= 4 ? render(from, to) : null;
}

/* ------------------------------------------------------------------- mutations */

/** Split at a top-level token (outside braces and parentheses). */
function splitTop(tex: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0, last = 0;
  for (let i = 0; i < tex.length; i++) {
    const char = tex[i];
    if (char === "{" || char === "(" || char === "[") depth++;
    else if (char === "}" || char === ")" || char === "]") depth--;
    else if (depth === 0) {
      const match = separator.exec(tex.slice(i));
      if (match && match.index === 0) { parts.push(tex.slice(last, i)); i += match[0].length - 1; last = i + 1; }
    }
  }
  parts.push(tex.slice(last));
  return parts.map(part => part.trim());
}

const balancedTex = (tex: string) => {
  let depth = 0;
  for (const char of tex) { if (char === "{" || char === "(") depth++; else if (char === "}" || char === ")") depth--; if (depth < 0) return false; }
  return depth === 0 && tex.trim().length > 0;
};

/** Plausible wrong versions of an expression, most instructive first. */
function texMutations(tex: string): string[] {
  const out: string[] = [];
  const product = splitTop(tex, /^\\(?:cdot|times)(?![A-Za-z])/);
  if (product.length >= 2) out.push(product.slice(0, -1).join(" \\cdot "));
  out.push(tex.replace(/([A-Za-z]'*)\(([A-Za-z]'*)\(([A-Za-z])\)\)/, "$1($3)"));
  if (product.length >= 2) out.push(product.join(" + "));
  out.push(tex.replace(/([A-Za-z])'(?=\()/, "$1"));
  const partner: Record<string, string> = { sin: "cos", cos: "sin", tan: "cot", cot: "tan", ln: "log", log: "ln" };
  out.push(tex.replace(/\\(sin|cos|tan|cot|ln|log)(?![A-Za-z])/, (_, name: string) => `\\${partner[name]}`));
  const lead = /^(\d+)\s*(?=[A-Za-z\\(])/.exec(tex);
  if (lead) out.push(tex.slice(lead[0].length));
  const sign = splitTop(tex, /^[+-]/);
  if (sign.length === 2) out.push(tex.replace(/(?<=\S\s*)([+-])(?=\s*\S)/, (_, op: string) => op === "+" ? "-" : "+"));
  const numbers = [...tex.matchAll(/\d+/g)];
  const last = numbers.at(-1);
  if (last) out.push(tex.slice(0, last.index!) + String(Number(last[0]) + 1) + tex.slice(last.index! + last[0].length));
  const first = numbers[0];
  if (first && numbers.length > 1) out.push(tex.slice(0, first.index!) + String(Number(first[0]) + 1) + tex.slice(first.index! + first[0].length));
  const norm = (value: string) => value.replace(/\s+/g, "");
  const seen = new Set([norm(tex)]);
  return out.map(item => item.trim()).filter(item => {
    if (!balancedTex(item) || seen.has(norm(item))) return false;
    seen.add(norm(item));
    return true;
  });
}

const looksMathy = (text: string) => /^[\s\d\p{L}^{}()+\-*/=.,'\\_|]+$/u.test(text) && /[\d^=+\-*/()]/.test(text)
  && (text.match(/\p{L}{3,}/gu) ?? []).every(word => /^(?:sin|cos|tan|log|ln|exp|frac|cdot|sqrt)$/.test(word.replace(/^\\/, "")));

/* ------------------------------------------------------------------- questions */

/** `origin` (window turn + Markdown snippet) is resolved into `source` once the pool is built. */
interface Candidate extends Omit<KindedQuestion, "id"> { sentence?: number; answerKey: string; origin?: { turn: number; text: string } }
const MAX_Q = 115, MAX_A = 60;

function fitsQuestion(q: string, a: readonly string[]) {
  return q.length <= MAX_Q && a.length >= 2 && a.length <= 4 && a.every(item => item.length > 0 && item.length <= MAX_A)
    && [q, ...a].every(recessDollarsBalanced) && new Set(a.map(item => plainKey(item))).size === a.length
    && a.slice(1).every(item => /[$\d]/.test(item + a[0]) || !nearDuplicate(plainKey(item), plainKey(a[0])));
}

/** Four choices when every one is valid, else three; null when even three do not fit. */
function choose(q: string, a: readonly string[]): string[] | null {
  const seen = new Set([plainKey(a[0] ?? "")]);
  const usableOptions = [a[0], ...a.slice(1).filter(item => {
    const key = plainKey(item);
    if (!item || item.length > MAX_A || !recessDollarsBalanced(item) || seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
  for (const size of [4, 3]) {
    const options = usableOptions.slice(0, size);
    if (options.length === size && fitsQuestion(q, options)) return options;
  }
  return null;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
/** Options a learner could defend as the same answer ("estoy cansada" / "estoy cansado"). */
const nearDuplicate = (a: string, b: string) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x === y || (Math.min(x.length, y.length) >= 4 && editDistance(x, y) <= 1);
};

function distractorsFor(answer: Term, terms: readonly Term[], exclude: string, count = 2): Term[] {
  const shown = exclude.toLowerCase();
  const answerWords = answer.key.split(" ");
  const related = (term: Term) => term.key.includes(answer.key) || answer.key.includes(term.key);
  const sibling = (term: Term) => term.words === answer.words && term.words > 1
    && term.key.split(" ").some(word => answerWords.includes(word));
  return terms.filter(term => term !== answer && term.code === answer.code && !related(term)
    && !nearDuplicate(term.text, answer.text) && !termPattern(term).test(shown))
    .map((term, index) => ({ term, index, rank: (sibling(term) ? 0 : 2) + (term.emph > 0 ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, count).map(item => item.term);
}

/** Options shown for a term answer. Sentence-start blanks get capitals throughout. */
/** How a term reads mid-sentence: "mitosis", but "Leibniz" and "DOCTOR" keep their capitals. */
const midSentence = (term: Term) => term.capitalOnly || !/^\p{Lu}\p{Ll}/u.test(term.text) ? term.text : term.text[0].toLowerCase() + term.text.slice(1);

function termOptions(answer: Term, distractors: readonly Term[], startsSentence: boolean) {
  const show = (term: Term) => term.code ? `\`${term.text}\`` : startsSentence ? capitalize(term.text) : midSentence(term);
  return [answer, ...distractors].map(show);
}

const usable = (sentence: Sentence) => sentence.complete && !sentence.question && !sentence.filler && !sentence.greeting && !sentence.code;

function clozeQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  for (const sentence of sentences) {
    if (!usable(sentence)) continue;
    const order = [...terms.slice(0, 10)].sort((a, b) => Number(b.emph > 0) - Number(a.emph > 0));
    for (const term of order) {
      const hits = findTerm(sentence.doc, sentence.masked, term);
      if (hits.length !== 1) continue; // a second mention would give the answer away
      const hit = hits[0];
      if (!hit.exact && !hit.emphasized) continue; // "verbs" is not a blank for "verb"
      const masked = sentence.masked.slice(0, hit.start) + BLANK + sentence.masked.slice(hit.end);
      const starts = !sentence.masked.slice(0, hit.start).replace(PH, "x").trim();
      const context = fitClauses(sentence.doc, masked, hit.start, MAX_Q - 12);
      if (!context) continue;
      const distractors = distractorsFor(term, terms, recessPlainText(context), 3);
      if (distractors.length < 2) continue;
      const q = `Fill in: “${context}”`;
      const a = choose(q, termOptions(term, distractors, starts));
      if (a) out.push({ kind: "cloze", q, a, sentence: sentence.id, answerKey: term.key });
      break;
    }
  }
  return out;
}

function nameQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  const P = "\uE000[\uE100-\uEFFF]\uE001";
  const patterns: { re: RegExp; ask: (match: RegExpExecArray, doc: Doc) => string }[] = [
    { re: new RegExp(`^(?:(?:A|An|The)\\s+)?(${P})\\s+(?:is|are|means|refers to)\\s+(?:just\\s+|simply\\s+|basically\\s+)?(.+?)[.!]$`, "u"),
      ask: (match, doc) => `What does Keating call ${restore(doc, match[2])}?` },
    { re: new RegExp(`^(?:(?:A|An|The)\\s+)?(${P})\\s+(tells you|lets you|helps you|gives you)\\s+(.+?)[.!:]$`, "u"),
      ask: (match, doc) => `Which idea ${match[2]} ${restore(doc, firstClause(match[3]))}?` },
    { re: new RegExp(`^(?:(?:A|An|The)\\s+)?(${P})\\s+(?!(?:was|has|does|is|uses)\\s)(\\p{Ll}{3,}s)\\s+(.+?)[.!:]$`, "u"),
      ask: (match, doc) => `Which idea ${match[2]} ${restore(doc, firstClause(match[3]))}?` },
    { re: new RegExp(`^Use\\s+(${P})\\s+(for|when|to|with)\\s+(.+?)[.!:]$`, "u"),
      ask: (match, doc) => `Which do you use ${match[2]} ${restore(doc, firstClause(match[3]))}?` },
    { re: new RegExp(`^(.+?)\\s+(?:is|are)\\s+called\\s+(?:an?\\s+|the\\s+)?(${P})[.!]$`, "u"),
      ask: (match, doc) => `What does Keating call ${restore(doc, match[1]).replace(/^\p{Lu}/u, letter => letter.toLowerCase())}?` },
  ];
  for (const sentence of sentences) {
    const introducesBlock = !sentence.complete && /:$/.test(sentence.masked);
    if (!(usable(sentence) || (introducesBlock && !sentence.filler && !sentence.greeting))) continue;
    for (const { re, ask } of patterns) {
      const match = re.exec(sentence.masked);
      if (!match) continue;
      const placeholder = match.slice(1).find(group => /^\uE000.\uE001$/u.test(group ?? ""));
      const span = placeholder ? sentence.doc.spans[phIndex(placeholder[1])] : undefined;
      if (!span) continue;
      const term = terms.find(item => !item.code && item.key === keyOf(recessPlainText(span.inner)));
      if (!term) continue;
      const q = ask(match, sentence.doc);
      const distractors = distractorsFor(term, terms, recessPlainText(q), 3);
      if (distractors.length < 2) continue;
      const a = choose(q, termOptions(term, distractors, false));
      if (a) { out.push({ kind: "name", q, a, sentence: sentence.id, answerKey: term.key }); break; }
    }
  }
  return out;
}

function formulaQuestion(lead: string | undefined, lhs: string, rhs: string, sentence?: number, origin?: Candidate["origin"]): Candidate | null {
  const wrong = texMutations(rhs).slice(0, 3);
  if (wrong.length < 2) return null;
  const prompt = lead && lead.length <= 70 && /(?:then|so|gives|get|is|:|,)$/i.test(lead) ? `${lead.replace(/:$/, ":")} ` : "Complete it: ";
  const q = `${prompt}$${lhs} =$ ?`;
  const a = choose(q, [rhs, ...wrong].map(item => `$${item}$`));
  return a ? { kind: "formula", q, a, sentence, origin, answerKey: plainKey(a[0]) } : null;
}

function formulaQuestions(sentences: readonly Sentence[], display: readonly DisplayMath[]): Candidate[] {
  const out: Candidate[] = [];
  for (const item of display) {
    const sides = splitTop(item.span.inner, /^=/);
    if (sides.length !== 2 || !sides[0] || !sides[1]) continue;
    const question = formulaQuestion(item.lead, sides[0], sides[1], item.sentence?.id, { turn: item.turn, text: item.span.raw });
    if (question) out.push(question);
  }
  for (const sentence of sentences) {
    if (!usable(sentence)) continue;
    for (const hit of placeholders(sentence.doc, sentence.masked)) {
      if (hit.span?.kind !== "math") continue;
      const sides = splitTop(hit.span.inner, /^=/);
      if (sides.length !== 2 || !sides[0] || !sides[1]) continue;
      const lead = restore(sentence.doc, sentence.masked.slice(0, hit.start)).trim();
      if ((lead.match(WORD) ?? []).length < 2 || lead.length > 70) continue;
      const wrong = texMutations(sides[1]).slice(0, 3);
      if (wrong.length < 2) continue;
      const q = `${lead} $${sides[0]} =$ ?`;
      const a = choose(q, [sides[1], ...wrong].map(value => `$${value}$`));
      if (a) out.push({ kind: "formula", q, a, sentence: sentence.id, answerKey: plainKey(a[0]) });
    }
  }
  return out;
}

/** Wrong versions of a masked text with key terms swapped or replaced, most plausible first (still masked). */
/** Pairs of key terms the tutor gave positive evidence are different: contrasted in one sentence
 * ("whereas", "but", "unlike", "not", …) or antonym siblings ("inner"/"outer function"). Keys as "a|b", sorted. */
type Contrasts = ReadonlySet<string>;
const pairKey = (a: Term, b: Term) => [a.key, b.key].sort().join("|");
const CONTRAST_WORD = /\b(?:whereas|while|but|unlike|instead of|rather than|not|versus|vs\.?|differs? from|different from|opposite|compared (?:to|with))\b|n['’]t\b/i;
const ANTONYMS = [["inner", "outer"], ["upper", "lower"], ["left", "right"], ["first", "last"], ["input", "output"],
  ["positive", "negative"], ["maximum", "minimum"], ["independent", "dependent"], ["prime", "composite"], ["acid", "base"],
  ["even", "odd"], ["before", "after"], ["increase", "decrease"], ["internal", "external"], ["open", "closed"]];
function contrastsIn(sentences: readonly Sentence[], terms: readonly Term[]): Set<string> {
  const pairs = new Set<string>();
  for (const sentence of sentences) {
    if (!CONTRAST_WORD.test(sentence.masked.replace(PH, "x"))) continue;
    const present = terms.slice(0, 16).filter(term => !term.code && findTerm(sentence.doc, sentence.masked, term).length);
    for (const a of present) for (const b of present) if (a !== b) pairs.add(pairKey(a, b));
  }
  for (const a of terms) for (const b of terms) {
    if (a === b || a.words !== b.words || a.words < 2) continue;
    const x = a.key.split(" "), y = b.key.split(" ");
    const differ = x.flatMap((word, index) => word !== y[index] ? [[word, y[index]]] : []);
    if (differ.length === 1 && ANTONYMS.some(([p, q]) => (differ[0][0] === p && differ[0][1] === q) || (differ[0][0] === q && differ[0][1] === p))) {
      pairs.add(pairKey(a, b));
    }
  }
  return pairs;
}

/** With `contrasts`, only pairs the tutor showed to differ are swapped, so a "false" version cannot stay true by accident. */
function termVariants(doc: Doc, masked: string, terms: readonly Term[], contrasts?: Contrasts): string[] {
  const safe = contrasts !== undefined;
  const allowed = (a: Term, b: Term) => !contrasts || contrasts.has(pairKey(a, b));
  const found = terms.slice(0, 12).map(term => ({ term, hits: findTerm(doc, masked, term) }))
    .filter(item => item.hits.length === 1 && !item.term.code && (item.hits[0].exact || !!item.hits[0].emphasized));
  // A term inside a longer present term ("derivative" in "inner derivative") is not separately swappable.
  const present = found.filter(item => !found.some(other => other !== item && other.hits[0].start <= item.hits[0].start
    && other.hits[0].end >= item.hits[0].end && other.hits[0].end - other.hits[0].start > item.hits[0].end - item.hits[0].start));
  const variants: string[] = [];
  const sibling = (a: Term, b: Term) => a.words === b.words && a.words > 1 && a.key.split(" ").some(word => b.key.split(" ").includes(word));
  const swap = (x: typeof present[number], y: typeof present[number]) => {
    const [first, second] = x.hits[0].start < y.hits[0].start ? [x, y] : [y, x];
    if (first.hits[0].end > second.hits[0].start) return;
    variants.push(splice(splice(masked, second.hits[0], midSentence(first.term)), first.hits[0], midSentence(second.term)));
  };
  for (const x of present) for (const y of present) if (x.term.first < y.term.first && sibling(x.term, y.term) && allowed(x.term, y.term)) swap(x, y);
  for (const x of present) for (const other of distractorsFor(x.term, terms, "", 3)) {
    if (!present.some(item => item.term === other) && sibling(x.term, other) && allowed(x.term, other)) variants.push(splice(masked, x.hits[0], midSentence(other)));
  }
  // Replacing a term with an unrelated one can accidentally stay true, so claims (safe) only swap terms already present.
  if (!safe) for (const x of present) for (const other of distractorsFor(x.term, terms, "", 3)) {
    if (other.words === x.term.words && !present.some(item => item.term === other)) variants.push(splice(masked, x.hits[0], midSentence(other)));
  }
  for (const x of present) for (const y of present) if (x.term.first < y.term.first && !sibling(x.term, y.term) && allowed(x.term, y.term)) swap(x, y);
  return [...new Set(variants)].filter(item => item !== masked);
}

function swapQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  for (const sentence of sentences) {
    if (!usable(sentence)) continue;
    const correct = restore(sentence.doc, sentence.masked);
    if (correct.length > MAX_A) continue;
    const distinct = [...new Set(termVariants(sentence.doc, sentence.masked, terms).map(item => restore(sentence.doc, item)))]
      .filter(item => plainKey(item) !== plainKey(correct));
    if (distinct.length < 2) continue;
    const q = "Which did Keating say?";
    const a = choose(q, [correct, ...distinct]);
    if (a) out.push({ kind: "swap", q, a, sentence: sentence.id, answerKey: plainKey(correct) });
  }
  return out;
}

interface Myth { wrong: string; right: string }

/** For "say X, not Y" where X and Y differ in one word: a third form with that word swapped for a key term. */
function recombined(rightText: string, rightPlain: string, wrongPlain: string, terms: readonly Term[]): string | undefined {
  const right = rightPlain.split(" "), wrong = wrongPlain.split(" ");
  if (right.length !== wrong.length || right.length < 2) return undefined;
  const differ = right.flatMap((word, index) => word.toLowerCase() !== wrong[index].toLowerCase() ? [index] : []);
  if (differ.length !== 1) return undefined;
  const at = differ[0];
  const swap = terms.find(term => term.words === 1 && !term.code && term.emph > 0
    && ![right[at], wrong[at]].some(word => word.toLowerCase() === term.text.toLowerCase()));
  if (!swap) return undefined;
  const words = [...right];
  words[at] = swap.text;
  const marker = /^(\*\*|\*|`)/.exec(rightText)?.[1] ?? "";
  return `${marker}${words.join(" ")}${marker}`;
}
function corrections(sentences: readonly Sentence[], terms: readonly Term[]): { questions: Candidate[]; myths: Myth[] } {
  const questions: Candidate[] = [], myths: Myth[] = [];
  const patterns: { re: RegExp; right: number; wrong: number; ask: (prefix: string) => string }[] = [
    { re: /^(.*?\S)\s+not\s+(.+?),?\s+but\s+(.+?)[.!]?$/iu, wrong: 2, right: 3, ask: prefix => `${prefix}…?` },
    { re: /^(.*?\S)\s+(?:isn['’]t|is not)\s+(.+?)[,;]\s*(?:it['’]s|it is)\s+(.+?)[.!]?$/iu, wrong: 2, right: 3, ask: prefix => `${prefix} is…?` },
    { re: /^(.*?\b(?:say|uses?|write|choose|put|pick))\s+(.+?),?\s+(?:rather than|instead of)\s+([^,;]+?)(?:[,;].*)?[.!]?$/iu, right: 2, wrong: 3, ask: prefix => `${prefix}…?` },
    { re: /^(.*?\b(?:say|uses?|write|choose|put|pick))\s+(.+?),\s+not\s+([^,;]+?)(?:[,;].*)?[.!]?$/iu, right: 2, wrong: 3, ask: prefix => `${prefix}…?` },
  ];
  for (const sentence of sentences) {
    if (!sentence.complete || sentence.question || sentence.greeting || sentence.code) continue;
    for (const { re, right, wrong, ask } of patterns) {
      const match = re.exec(sentence.masked);
      if (!match) continue;
      const prefix = restore(sentence.doc, match[1]).trim();
      const rightText = restore(sentence.doc, match[right]).trim();
      const wrongText = restore(sentence.doc, match[wrong]).trim();
      const rightPlain = recessPlainText(rightText), wrongPlain = recessPlainText(wrongText);
      const prefixWords = (prefix.match(WORD) ?? []).length;
      if (prefixWords < 1 || (prefixWords < 2 && !/^(?:say|use|write|choose|put|pick)$/i.test(prefix)) || !rightPlain || !wrongPlain || rightPlain === wrongPlain
        || rightPlain.length > 40 || wrongPlain.length > 40) continue;
      myths.push({ wrong: wrongPlain, right: rightPlain });
      const mathOnly = (text: string) => /^\$[^$]+\$$/.test(text);
      let third: string | undefined;
      if (mathOnly(rightText) && mathOnly(wrongText)) {
        const wrongTex = wrongText.slice(1, -1).replace(/\s+/g, "");
        third = texMutations(rightText.slice(1, -1)).find(item => item.replace(/\s+/g, "") !== wrongTex);
        if (third) third = `$${third}$`;
      } else {
        const term = terms.find(item => item.key === keyOf(rightPlain) || item.key === keyOf(wrongPlain));
        const other = term && term.words === 1 ? distractorsFor(term, terms, `${prefix} ${rightPlain} ${wrongPlain}`, 1)[0] : undefined;
        third = recombined(rightText, rightPlain, wrongPlain, terms) ?? other?.text;
      }
      if (third) {
        const index = sentences.indexOf(sentence);
        const previous = sentences[index - 1];
        const context = previous && previous.turn === sentence.turn && usable(previous) ? restore(previous.doc, previous.masked) : "";
        const which = `Which should you ${prefix.toLowerCase()}?`;
        const q = prefixWords >= 2 ? ask(prefix) : context && context.length + which.length < MAX_Q ? `${context} ${which}` : which;
        const a = [rightText, wrongText, third];
        if (fitsQuestion(q, a)) questions.push({ kind: "correction", q, a, sentence: sentence.id, answerKey: plainKey(rightText) });
      }
      break;
    }
  }
  return { questions, myths };
}

const CONFIRM = /^(?:yes|yep|exactly|correct|right|that['’]s (?:right|it|correct)|spot on|perfect|great|well done|nice)\b/i;
function applyQuestions(turns: readonly { role: string; text: string; index: number; sentences?: Sentence[] }[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i + 2 < turns.length; i++) {
    const [ask, reply, verdict] = [turns[i], turns[i + 1], turns[i + 2]];
    if (ask.role !== "tutor" || reply.role !== "learner" || verdict.role !== "tutor" || !ask.sentences) continue;
    const check = [...ask.sentences].reverse().find(sentence => sentence.question);
    const opening = verdict.text.trim();
    if (!check || !CONFIRM.test(opening) || /\b(?:not quite|almost|close|careful)\b/i.test(opening.slice(0, 60))) continue;
    const answer = reply.text.trim().replace(/^\$+|\$+$/g, "").replace(/[.!]$/, "");
    if (!answer || answer.length > 40 || answer.includes("$")) continue;
    const q = capitalize(restore(check.doc, check.masked)
      .replace(/^(?:(?:now|okay|ok|so),?\s+)?(?:try (?:one|this|it)(?: yourself)?|quick check|your turn|over to you)[:,.!]?\s*/i, ""));
    let a: string[] | null;
    if (looksMathy(answer)) {
      const wrong = texMutations(answer).slice(0, 3);
      if (wrong.length < 2) continue;
      a = choose(q, [answer, ...wrong].map(item => `$${item}$`));
    } else {
      const term = terms.find(item => item.key === keyOf(answer));
      if (!term) continue;
      a = choose(q, termOptions(term, distractorsFor(term, terms, q, 3), false));
    }
    // The confirmation and the sentence after it ("Yes! The outer function …") are what support the answer.
    const confirm = verdict.sentences?.slice(0, 2) ?? [];
    const origin = confirm.length ? { turn: verdict.index, text: confirm.map(item => restore(item.doc, item.masked)).join(" ") } : undefined;
    if (a) out.push({ kind: "apply", q, a, origin, answerKey: plainKey(a[0]) });
  }
  return out;
}

/* ----------------------------------------------------------- more question kinds */

const PRONOUN_START = /^(?:it|its|this|that|these|those|they|them|he|she|we|you|i|which|there)\b/i;
const P_ANY = "[-]";
const stripEnd = (text: string) => text.trim().replace(/[.!;:,]+$/, "").trim();
/** Lower a sentence-start capital ("A profession", "Meiosis") but keep acronyms and emphasis markers in place. */
const uncapitalize = (text: string) => text.replace(/^([*_`]*)(\p{Lu})(?=\p{Ll}|\s)/u, (_, marks: string, letter: string) => marks + letter.toLowerCase());
const words = (text: string) => (recessPlainText(text).match(WORD) ?? []).length;
/** Emphasis on a term reads as the term itself in a question. */
const showTerm = (term: Term) => term.code ? `\`${term.text}\`` : `**${midSentence(term)}**`;

/** A false version of a claim: a mutated formula, else a swapped key term. Restored text. */
function falsify(sentence: Sentence, terms: readonly Term[], contrasts: Contrasts): string | null {
  for (const hit of placeholders(sentence.doc, sentence.masked)) {
    if (hit.span?.kind !== "math") continue;
    const wrong = texMutations(hit.span.inner)[0];
    if (wrong) return restore(sentence.doc, sentence.masked.slice(0, hit.start)) + `$${wrong}$` + restore(sentence.doc, sentence.masked.slice(hit.end));
  }
  const variant = termVariants(sentence.doc, sentence.masked, terms, contrasts)[0];
  return variant ? restore(sentence.doc, variant) : null;
}

/** True/false claims; truths alternate, false first, so a pack holding two gets one of each. */
function trueFalseQuestions(sentences: readonly Sentence[], terms: readonly Term[], contrasts: Contrasts): Candidate[] {
  const out: Candidate[] = [];
  const prefix = "True or false: ";
  for (const sentence of sentences) {
    if (!usable(sentence) || words(restore(sentence.doc, sentence.masked)) < 5) continue;
    if (/\bnot\b|n['’]t\b|\bmistake\b/i.test(sentence.masked.replace(PH, "x"))) continue; // negations make the truth hard to read
    if (!terms.slice(0, 12).some(term => findTerm(sentence.doc, sentence.masked, term).length)) continue;
    const truth = restore(sentence.doc, sentence.masked);
    const lie = falsify(sentence, terms, contrasts);
    if (!lie || plainKey(lie) === plainKey(truth) || prefix.length + Math.max(truth.length, lie.length) > MAX_Q) continue;
    const isTrue = out.length % 2 === 1;
    const q = prefix + (isTrue ? truth : lie);
    const a = isTrue ? ["True", "False"] : ["False", "True"];
    if (fitsQuestion(q, a)) out.push({ kind: "truefalse", q, a, sentence: sentence.id, answerKey: `truefalse:${sentence.id}` });
  }
  return out;
}

interface Reason { sentence: Sentence; claim: string; reason: string; masked: string }
const WHY: { re: RegExp; claim: number; reason: number; lead: string }[] = [
  { re: /^Because\s+(.+?),\s+(.+?)[.!]$/iu, claim: 2, reason: 1, lead: "Because" },
  { re: /^(.+?),?\s+because\s+(.+?)[.!]$/iu, claim: 1, reason: 2, lead: "Because" },
  { re: /^(.+?),?\s+since\s+(.+?)[.!]$/iu, claim: 1, reason: 2, lead: "Because" },
  { re: /^(.+?),?\s+so that\s+(.+?)[.!]$/iu, claim: 1, reason: 2, lead: "So that" },
  { re: /^(.+?),\s+which means\s+(.+?)[.!]$/iu, claim: 2, reason: 1, lead: "Because" },
  { re: /^(.+?),\s+so\s+(.+?)[.!]$/iu, claim: 2, reason: 1, lead: "Because" },
];
function reasonsIn(sentences: readonly Sentence[]): Reason[] {
  const out: Reason[] = [];
  for (const sentence of sentences) {
    if (!usable(sentence)) continue;
    for (const { re, claim, reason, lead } of WHY) {
      const match = re.exec(sentence.masked);
      if (!match) continue;
      const claimMasked = stripEnd(match[claim]), reasonMasked = stripEnd(match[reason]);
      if (PRONOUN_START.test(claimMasked) || words(restore(sentence.doc, claimMasked)) < 2 || words(restore(sentence.doc, reasonMasked)) < 2) break;
      const masked = `${lead} ${uncapitalize(reasonMasked)}`;
      out.push({ sentence, claim: capitalize(restore(sentence.doc, claimMasked)), reason: restore(sentence.doc, masked), masked });
      break;
    }
  }
  return out;
}

function whyQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  const reasons = reasonsIn(sentences);
  for (const item of reasons) {
    const others = reasons.filter(other => other !== item).map(other => other.reason.replace(/^So that /, "Because "));
    const swapped = termVariants(item.sentence.doc, item.masked, terms).map(variant => restore(item.sentence.doc, variant));
    const lead = item.reason.startsWith("So that") ? "So that" : "Because";
    const distractors = [...new Set([...others.map(other => other.replace(/^Because /, `${lead} `)), ...swapped])]
      .filter(text => plainKey(text) !== plainKey(item.reason));
    if (distractors.length < 2) continue;
    const q = `“${item.claim}.” Why?`;
    const a = choose(q, [item.reason, ...distractors]);
    if (a) out.push({ kind: "why", q, a, sentence: item.sentence.id, answerKey: plainKey(item.reason) });
  }
  return out;
}

interface Example { term: Term; examples: string[]; sentence: Sentence }
const EXAMPLE_CUE = /(?:,\s*|\s+)(?:for example|for instance|e\.g\.|such as)\b,?\s+|,\s+like\s+|\s+like\s+(?=)/giu;
function examplesIn(sentences: readonly Sentence[], terms: readonly Term[]): Example[] {
  const out: Example[] = [];
  for (const [index, sentence] of sentences.entries()) {
    if (sentence.greeting || sentence.code || sentence.question) continue;
    for (const cue of sentence.masked.matchAll(EXAMPLE_CUE)) {
      const before = sentence.masked.slice(0, cue.index!);
      // The example belongs to the key term right before the cue (at most two words between).
      let owner: Term | undefined;
      for (const term of terms) {
        const hit = findTerm(sentence.doc, before, term).at(-1);
        if (hit && words(restore(sentence.doc, before.slice(hit.end))) <= (/like/i.test(cue[0]) ? 1 : 6)) { owner = term; break; }
      }
      // "For example, …" opening a sentence belongs to the previous sentence's leading term.
      if (!owner && cue.index === 0) {
        const previous = sentences[index - 1];
        owner = previous && terms.find(term => findTerm(previous.doc, previous.masked, term).length);
      }
      if (!owner) continue;
      const rest = sentence.masked.slice(cue.index! + cue[0].length);
      const tail = rest.split(/(?<=\S)[;:.!?](?=\s|$)|\s+(?:which|that|because|so|but|whereas|while)\s+/u)[0];
      const items = tail.split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/u).map(item => stripEnd(restore(sentence.doc, item)))
        .filter(item => item && words(item) <= 6 && item.length <= MAX_A);
      if (items.length) out.push({ term: owner, examples: items, sentence });
    }
  }
  return out;
}

function exampleQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  const found = examplesIn(sentences, terms);
  for (const item of found) {
    const own = new Set(found.filter(other => other.term === item.term).flatMap(other => other.examples.map(plainKey)));
    const answer = item.examples[0];
    const distractors = [...new Set(found.filter(other => other.term !== item.term).flatMap(other => other.examples))]
      .filter(example => !own.has(plainKey(example)));
    if (distractors.length < 2) continue;
    const q = `Which is an example of ${showTerm(item.term)}?`;
    const a = choose(q, [answer, ...distractors]);
    if (a) out.push({ kind: "example", q, a, sentence: item.sentence.id, answerKey: plainKey(answer) });
  }
  return out;
}

const SEQUENCE_START = /^(?:first(?:ly)?|to (?:start|begin)|step (?:1|one))\b,?\s*/i;
const SEQUENCE_NEXT = /^(?:then|next|after (?:that|this)|second(?:ly)?|third(?:ly)?|finally|lastly|last of all|step (?:\d+|two|three|four|five))\b,?\s*/i;
const STEP_INTRO = /\b(?:steps?|stages?|phases?|order|process|sequence|procedure|recipe|in turn)\b/i;

function stepText(doc: Doc, masked: string): string | null {
  const text = stripEnd(restore(doc, masked));
  if (text.length <= MAX_A && words(text) >= 2) return capitalize(text);
  const clause = stripEnd(restore(doc, firstClause(masked)));
  return clause.length <= MAX_A && words(clause) >= 2 ? capitalize(clause) : null;
}

function orderQuestions(sentences: readonly Sentence[], lists: readonly ListBlock[]): Candidate[] {
  const sequences: { steps: string[]; sentence?: number; turn?: number; raw?: string[] }[] = [];
  for (const list of lists) {
    if (!list.ordered && !(list.intro && STEP_INTRO.test(list.intro.replace(PH, "x")))) continue;
    const steps = list.items.map(item => stepText(list.doc, item));
    if (steps.length >= 3 && steps.every(Boolean)) {
      sequences.push({ steps: steps as string[], turn: list.turn, raw: list.items.map(item => restore(list.doc, item)) });
    }
  }
  for (let i = 0; i < sentences.length; i++) {
    if (!SEQUENCE_START.test(sentences[i].masked.replace(PH, "x"))) continue;
    const run = [sentences[i]];
    for (let j = i + 1; j < sentences.length && sentences[j].turn === sentences[i].turn; j++) {
      if (!SEQUENCE_NEXT.test(sentences[j].masked.replace(PH, "x"))) break;
      run.push(sentences[j]);
    }
    const steps = run.map(item => stepText(item.doc, item.masked.replace(item === run[0] ? SEQUENCE_START : SEQUENCE_NEXT, "")));
    if (steps.length >= 3 && steps.every(Boolean)) sequences.push({ steps: steps as string[], sentence: run[0].id });
    i += run.length - 1;
  }
  const out: Candidate[] = [];
  for (const { steps, sentence, turn, raw } of sequences) {
    const originAt = (index: number) => turn !== undefined && raw ? { turn, text: raw[index] } : undefined;
    if (new Set(steps.map(plainKey)).size !== steps.length) continue;
    if (steps.length >= 4) {
      for (let at = 0; at + 1 < steps.length; at++) {
        const q = `In Keating’s steps, what comes right after “${steps[at]}”?`;
        const others = [...steps.slice(at + 2), ...steps.slice(0, at)];
        const a = choose(q, [steps[at + 1], ...others]);
        if (a) out.push({ kind: "order", q, a, sentence, origin: originAt(at + 1), answerKey: `order:${plainKey(steps[at + 1])}` });
      }
    } else {
      const q = "In Keating’s steps, which comes first?";
      const a = choose(q, steps);
      if (a) out.push({ kind: "order", q, a, sentence, origin: originAt(0), answerKey: `order:${plainKey(steps[0])}` });
    }
  }
  return out;
}

const LANGUAGE_SUBJECTS = new Set(["spanish", "french", "japanese"]);
interface Gloss { word: string; gloss: string; sentence: Sentence }
const GLOSS_PATTERNS = [
  new RegExp(`(${P_ANY})\\s+means\\s+[“"]?([^“”"]+?)[”"]?(?=[,;.!?](?:\\s|$)|$)`, "gu"),
  new RegExp(`(${P_ANY})\\s+\\([“"]?([^()“”"]+?)[”"]?\\)`, "gu"),
  new RegExp(`(${P_ANY})\\s+[—–]\\s+[“"]?([^“”"]+?)[”"]?(?=[,;.!?](?:\\s|$)|$)`, "gu"),
  new RegExp(`(${P_ANY}),?\\s+[“"]([^“”"]+?)[”"]`, "gu"),
];
function glossesIn(sentences: readonly Sentence[], lists: readonly ListBlock[]): Gloss[] {
  const out: Gloss[] = [];
  const texts: { doc: Doc; masked: string; sentence?: Sentence }[] = [
    ...sentences.map(sentence => ({ doc: sentence.doc, masked: sentence.masked, sentence })),
  ];
  for (const sentence of texts) for (const re of GLOSS_PATTERNS) for (const match of sentence.masked.matchAll(re)) {
    const span = sentence.doc.spans[phIndex(match[1][1])];
    if (!span || (span.kind !== "italic" && span.kind !== "bold")) continue;
    const gloss = stripEnd(restore(sentence.doc, match[2]));
    if (!gloss || gloss.length > 40 || words(gloss) > 7 || span.raw.length > MAX_A || match[2].includes("\uE000")) continue;
    if (out.some(item => plainKey(item.word) === plainKey(span.raw))) continue;
    out.push({ word: span.raw, gloss, sentence: sentence.sentence! });
  }
  void lists;
  return out;
}

function meaningQuestions(sentences: readonly Sentence[], lists: readonly ListBlock[], language: boolean): Candidate[] {
  const glosses = glossesIn(sentences, lists);
  if (!language && glosses.length < 4) return [];
  const out: Candidate[] = [];
  for (const [index, item] of glosses.entries()) {
    const others = glosses.filter(other => other !== item);
    if (others.length < 2) break;
    if (index % 2 === 0) {
      const q = `What does ${item.word} mean?`;
      const a = choose(q, [item.gloss, ...others.map(other => other.gloss)]);
      if (a) out.push({ kind: "meaning", q, a, sentence: item.sentence?.id, answerKey: `meaning:${plainKey(item.gloss)}` });
    } else {
      const q = `How do you say “${item.gloss}”?`;
      const a = choose(q, [item.word, ...others.map(other => other.word)]);
      if (a) out.push({ kind: "meaning", q, a, sentence: item.sentence?.id, answerKey: `meaning:${plainKey(item.word)}` });
    }
  }
  return out;
}

interface Group { members: string[]; label?: string; source: string; sentence?: number; origin?: { turn: number; text: string } }
const groupItems = (doc: Doc, masked: string) => masked.split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/u)
  .map(item => stripEnd(restore(doc, item))).filter(Boolean);
function groupsIn(sentences: readonly Sentence[], lists: readonly ListBlock[]): Group[] {
  const out: Group[] = [];
  const short = (items: string[]) => items.length >= 3 && items.every(item => words(item) <= 3 && item.length <= 30);
  for (const sentence of sentences) {
    if (sentence.code) continue;
    for (const match of sentence.masked.matchAll(/\(([^()]+)\)/gu)) {
      const members = groupItems(sentence.doc, match[1]);
      if (!short(members)) continue;
      const before = sentence.masked.slice(0, match.index!);
      const near = placeholders(sentence.doc, before).filter(hit => hit.span && (hit.span.kind === "bold" || hit.span.kind === "italic")).at(-1);
      const label = near && words(restore(sentence.doc, before.slice(near.end))) <= 3 ? near.span!.raw : undefined;
      out.push({ members, label, source: restore(sentence.doc, sentence.masked), sentence: sentence.id });
    }
    const all = /^(.+?)\s+(?:are all|all|both)\s+/iu.exec(sentence.masked);
    if (all) {
      const members = groupItems(sentence.doc, all[1]);
      if (short(members)) out.push({ members, source: restore(sentence.doc, sentence.masked), sentence: sentence.id });
    }
  }
  for (const list of lists) {
    const members = list.items.map(item => stripEnd(restore(list.doc, item)));
    if (short(members)) out.push({ members, source: members.join(" "), label: undefined, origin: { turn: list.turn, text: restore(list.doc, list.items.join("\n")) } });
  }
  return out;
}

function oddOneQuestions(sentences: readonly Sentence[], lists: readonly ListBlock[], terms: readonly Term[]): Candidate[] {
  const out: Candidate[] = [];
  const groups = groupsIn(sentences, lists);
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth"];
  for (const [index, group] of groups.entries()) {
    const inGroup = new Set(group.members.map(plainKey));
    const fromOther = groups.filter(other => other !== group).flatMap(other => other.members);
    const fromTerms = terms.filter(term => term.emph > 0 && !term.code && !termPattern(term).test(group.source)).map(term => term.text);
    const odd = [...fromOther, ...fromTerms].find(item => !inGroup.has(plainKey(item))
      && !group.members.some(member => nearDuplicate(plainKey(member), plainKey(item))));
    if (!odd) continue;
    // Absence from a list is not evidence of exclusion from a category ("seven" is prime, just not in the first list),
    // so the question asks only what the list held, never which item "doesn't belong".
    if (index >= ordinals.length) break;
    const q = groups.length === 1 ? "Which was NOT in Keating’s list?" : `Which was NOT in Keating’s ${ordinals[index]} list?`;
    const cased = (item: string) => { const term = terms.find(entry => entry.key === keyOf(item)); return term ? midSentence(term) : item; };
    let a = [odd, ...group.members.slice(0, 3)].map(cased);
    // Options read as a set: a sentence-start capital on one member should not single it out.
    if (a.some(item => /^\p{Ll}/u.test(item))) a = a.map(item => /^\p{Lu}\p{Ll}+$/u.test(item) ? item.toLowerCase() : item);
    if (fitsQuestion(q, a)) out.push({ kind: "oddone", q, a, sentence: group.sentence, origin: group.origin, answerKey: `oddone:${plainKey(odd)}` });
  }
  return out;
}

/** What the tutor said a key term does: "Mitosis **produces two identical cells**." */
function predicateOf(doc: Doc, masked: string, terms: readonly Term[]): { term: Term; predicate: string } | null {
  const body = masked.replace(/^(?:a|an|the)\s+/i, "");
  const offset = masked.length - body.length;
  for (const term of terms) {
    if (term.code) continue;
    const hit = findTerm(doc, masked, term).find(item => item.start === offset);
    if (!hit) continue;
    const rest = masked.slice(hit.end).trim();
    if (!/^\p{Ll}/u.test(rest)) return null;
    const predicate = stripEnd(restore(doc, firstClause(rest)));
    return predicate.length <= MAX_A && words(predicate) >= 2 ? { term, predicate } : null;
  }
  return null;
}

function compareQuestions(sentences: readonly Sentence[], terms: readonly Term[]): Candidate[] {
  const pairs: { a?: { term: Term; predicate?: string }; b: { term: Term; predicate: string }; sentence: Sentence }[] = [];
  const pool = new Map<string, string[]>();
  const told = new Map<string, Sentence>();
  let current: Sentence | undefined;
  const note = (term: Term, predicate: string) => {
    pool.set(term.key, [...pool.get(term.key) ?? [], predicate]);
    if (current && !told.has(predicate)) told.set(predicate, current);
  };
  for (const sentence of sentences) {
    if (!sentence.complete || sentence.greeting || sentence.code || sentence.question) continue;
    current = sentence;
    const whole = predicateOf(sentence.doc, sentence.masked, terms);
    if (whole) note(whole.term, whole.predicate);
    const contrast = /^(.+?),?\s+(?:whereas|while)\s+(.+?)[.!]$/iu.exec(sentence.masked)
      ?? /^(.+?),\s+but\s+(.+?)[.!]$/iu.exec(sentence.masked);
    if (contrast) {
      const left = predicateOf(sentence.doc, stripEnd(contrast[1]), terms), right = predicateOf(sentence.doc, stripEnd(contrast[2]), terms);
      if (left && right && left.term !== right.term) {
        note(left.term, left.predicate); note(right.term, right.predicate);
        pairs.push({ a: left, b: right, sentence }, { a: right, b: left, sentence });
      }
    }
    const unlike = /^Unlike\s+(.+?),\s+(.+?)[.!]$/iu.exec(sentence.masked);
    if (unlike) {
      const right = predicateOf(sentence.doc, unlike[2], terms);
      const other = terms.find(term => findTerm(sentence.doc, unlike[1], term).length);
      if (right && other && other !== right.term) { note(right.term, right.predicate); pairs.push({ a: { term: other }, b: right, sentence }); }
    }
  }
  const out: Candidate[] = [];
  for (const { a, b, sentence } of pairs) {
    if (!a) continue;
    const contrastWith = a.predicate ?? pool.get(a.term.key)?.[0];
    // Another idea's description is a wrong choice only if the tutor never said it alongside B.
    const others = [...pool.entries()].filter(([key]) => key !== b.term.key && key !== a.term.key).flatMap(([, list]) => list)
      .filter(text => { const where = told.get(text); return !where || !findTerm(where.doc, where.masked, b.term).length; });
    const distractors = [...new Set([...(contrastWith ? [contrastWith] : []), ...(pool.get(a.term.key) ?? []), ...others])]
      .filter(text => plainKey(text) !== plainKey(b.predicate));
    if (distractors.length < 2) continue;
    const q = `Which describes ${showTerm(b.term)}, not ${showTerm(a.term)}?`;
    const options = choose(q, [b.predicate, ...distractors]);
    if (options) out.push({ kind: "compare", q, a: options, sentence: sentence.id, answerKey: `compare:${plainKey(b.predicate)}` });
  }
  return out;
}

/** Round-robin across kinds so a level mixes question types: every supported kind once before any kind
 * repeats, distinct source sentences preferred, answers never repeated. */
function mixQuestions(pools: readonly Candidate[][], limit: number): Candidate[] {
  const picked: Candidate[] = [];
  const answers = new Set<string>(), sentences = new Set<number>();
  const perKind = new Map<RecessQuestionKind, number>();
  const queues = pools.map(pool => [...pool]);
  const take = (maxPerKind: number, strict: boolean) => {
    let progressed = false;
    for (const queue of queues) {
      if (picked.length >= limit) return progressed;
      const index = queue.findIndex(item => !answers.has(item.answerKey) && (perKind.get(item.kind) ?? 0) < maxPerKind
        && (!strict || item.sentence === undefined || !sentences.has(item.sentence)));
      if (index < 0) continue;
      const [item] = queue.splice(index, 1);
      picked.push(item);
      answers.add(item.answerKey);
      perKind.set(item.kind, (perKind.get(item.kind) ?? 0) + 1);
      if (item.sentence !== undefined) sentences.add(item.sentence);
      progressed = true;
    }
    return progressed;
  };
  for (const [maxPerKind, strict] of [[1, true], [1, false], [2, true], [2, false], [limit, false]] as const) {
    while (picked.length < limit && take(maxPerKind, strict));
  }
  return picked;
}

/** Stable id for the same lesson: FNV-1a over kind, question and correct answer. */
function questionId(kind: string, q: string, answer: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${kind}\u0001${q}\u0001${answer}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `rq_${hash.toString(16).padStart(8, "0")}`;
}

/** A verbatim substring (≤120 chars) of the turn's plain text, starting at the snippet that taught the answer. */
function quoteFor(turnText: string, snippet: string): string {
  const plainTurn = recessPlainText(turnText);
  const cut = (text: string) => text.length <= 120 ? text : text.slice(0, 120).replace(/\s+\S*$/, "");
  const wanted = recessPlainText(snippet);
  for (const candidate of [cut(wanted), cut(wanted.split(/(?<=[.!?])\s/)[0] ?? ""), cut(wanted).slice(0, 40).replace(/\s+\S*$/, "")]) {
    if (candidate && plainTurn.includes(candidate)) return candidate;
  }
  return cut(plainTurn);
}

function toQuestion(item: Candidate): KindedQuestion {
  return { kind: item.kind, q: item.q, a: item.a, id: questionId(item.kind, item.q, item.a[0]),
    ...(item.source ? { source: item.source } : {}), ...(item.image ? { image: item.image } : {}) };
}

function interleave(pools: readonly Candidate[][], limit: number): KindedQuestion[] {
  const out: KindedQuestion[] = [];
  const questions = new Set<string>(), answers = new Set<string>();
  const queues = pools.map(pool => [...pool]);
  while (out.length < limit && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const item = queue.shift()!;
        if (questions.has(item.q) || answers.has(item.answerKey)) continue;
        questions.add(item.q); answers.add(item.answerKey);
        out.push(toQuestion(item));
        break;
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- lesson window */

function contentWords(text: string) {
  return new Set((recessPlainText(text).match(WORD) ?? []).filter(word => word.length >= 4 && !isStop(word)).map(stem));
}

/** The trailing run of exchanges that stay on the newest answered topic. */
function lessonWindow(completed: HabitLesson): HabitLesson {
  const tutorAt = completed.flatMap((turn, index) => turn.role === "tutor" ? [index] : []);
  const blockStart = (tutorIndex: number) => {
    let start = tutorIndex;
    while (start > 0 && completed[start - 1].role === "learner") start--;
    return start;
  };
  let start = blockStart(tutorAt[tutorAt.length - 1]);
  const words = new Set<string>();
  for (const turn of completed.slice(start)) for (const word of contentWords(turn.text)) words.add(word);
  for (let k = tutorAt.length - 2; k >= 0; k--) {
    const from = blockStart(tutorAt[k]);
    const block = completed.slice(from, tutorAt[k] + 1);
    const blockWords = new Set(block.flatMap(turn => [...contentWords(turn.text)]));
    const shared = [...blockWords].filter(word => words.has(word)).length;
    if (shared < 2) break;
    for (const word of blockWords) words.add(word);
    start = from;
  }
  return completed.slice(start);
}

/* --------------------------------------------------------------------- analysis */

export interface RecessLessonAnalysis {
  pack: RecessPack;
  /** The whole question pool, one kind at a time in turn, deduplicated. */
  candidates: KindedQuestion[];
  /** Plain-text topic when one is identifiable. */
  topic?: string;
  /** Key terms backed by emphasis or repetition, best first (plain text). */
  keyTerms: readonly string[];
  /** Words of tutor text in the window that are not greetings or chat logistics. */
  teachingWords: number;
}

function explanatoryScore(sentence: Sentence, terms: readonly Term[], top?: Term) {
  let score = 0;
  for (const term of terms.slice(0, 10)) if (findTerm(sentence.doc, sentence.masked, term).length) score += 2 + (term.emph ? 1 : 0);
  if (top && findTerm(sentence.doc, sentence.masked, top).length) score += 2;
  if (/\b(?:is|are|means|tells you|lets you|describes|refers to)\b/i.test(sentence.masked.replace(PH, "x"))) score += 1;
  const words = (restore(sentence.doc, sentence.masked).match(WORD) ?? []).length;
  if (words < 6) score -= 3;
  return score;
}

function titleFor(window: HabitLesson, terms: readonly Term[], tutorDocs: readonly Doc[]): { title: string; topic?: Term[] } {
  const request = window.find(turn => turn.role === "learner" && turn.text.trim().length >= 8);
  const requestDoc = request ? mask(request.text) : undefined;
  const inRequest = requestDoc ? terms.filter(term => !term.code && findTerm(requestDoc, requestDoc.masked, term).length) : [];
  const emphasizedAsked = inRequest.filter(term => term.emph > 0);
  let chosen: Term[] = [];
  if (emphasizedAsked.length >= 2 && emphasizedAsked[1].emph >= emphasizedAsked[0].emph / 2
    && !emphasizedAsked[0].key.includes(emphasizedAsked[1].key) && !emphasizedAsked[1].key.includes(emphasizedAsked[0].key)) {
    chosen = emphasizedAsked.slice(0, 2).sort((a, b) => a.first - b.first);
  } else if (!emphasizedAsked[0] && !inRequest[0] && request) {
    const cleaned = recessPlainText(request.text).replace(/[?.!]+$/, "")
      .replace(/^(?:(?:can|could|would|will) you (?:please )?)?(?:explain|teach me(?: about)?|tell me about|show me|help me (?:with|understand)|i want to (?:learn|know) about|what (?:is|are)|how do(?:es)?)\s+(?:some\s+|the\s+|a\s+|an\s+)?/i, "");
    if (cleaned !== recessPlainText(request.text).replace(/[?.!]+$/, "") && (cleaned.match(WORD) ?? []).length <= 6 && cleaned.length <= 56) {
      return { title: capitalize(cleaned) };
    }
    const fallback = terms.find(term => term.strong && !term.code);
    if (fallback) chosen = [fallback];
  } else if (emphasizedAsked[0] ?? inRequest[0] ?? terms.find(term => term.strong && !term.code)) {
    chosen = [emphasizedAsked[0] ?? inRequest[0] ?? terms.find(term => term.strong && !term.code)!];
  }
  if (chosen.length) {
    const flat = tutorDocs.map(doc => recessPlainText(doc.masked.replace(PH, (_, char: string) => {
      const span = doc.spans[phIndex(char)];
      return span && (span.kind === "bold" || span.kind === "italic") ? span.inner : " ";
    }))).join(" ");
    const name = (term: Term) => {
      const total = [...flat.matchAll(termPattern(term))].length;
      const withThe = [...flat.matchAll(new RegExp(`\\bthe\\s+${termPattern(term).source}`, "giu"))].length;
      return total > 0 && withThe * 2 >= total && chosen.length === 1 ? `the ${term.text}` : term.text;
    };
    const title = capitalize(chosen.map(name).join(" and "));
    if (title.length <= 56) return { title, topic: chosen };
  }
  if (request) {
    const plain = recessPlainText(request.text);
    if (plain.length <= 56) return { title: plain };
    const cut = plain.slice(0, 55);
    return { title: `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trimEnd()}…` };
  }
  return { title: "Quick review" };
}

const analysisCache = new Map<string, RecessLessonAnalysis | null>();
const ANALYSIS_CACHE_SIZE = 8;

/** The full local analysis behind `buildChatRecessPack`, also used for readiness. Memoised per lesson
 * content (small LRU), so rules, pack, candidates and readiness share one pass; callers get a copy. */
export function analyzeRecessLesson(lesson: HabitLesson): RecessLessonAnalysis | null {
  const key = JSON.stringify(lesson.map(turn => [turn.role, turn.text, turn.images?.map(image => image.id) ?? []]));
  let analysis = analysisCache.get(key);
  if (analysis === undefined) {
    analysis = computeAnalysis(lesson);
    if (analysisCache.size >= ANALYSIS_CACHE_SIZE) analysisCache.delete(analysisCache.keys().next().value!);
  } else analysisCache.delete(key);
  analysisCache.set(key, analysis);
  return analysis && structuredClone(analysis);
}

function computeAnalysis(lesson: HabitLesson): RecessLessonAnalysis | null {
  const latestTutor = lesson.findLastIndex(turn => turn.role === "tutor" && turn.text.trim());
  if (latestTutor < 0) return null;
  const completed = lesson.slice(0, latestTutor + 1);
  const window = lessonWindow(completed);
  let nextId = 0;
  const turns = window.map((turn, index) => {
    if (turn.role !== "tutor") return { ...turn, index };
    const split = splitTurn(turn.text, index, nextId);
    nextId += split.sentences.length;
    return { ...turn, index, ...split };
  });
  const tutorTurns = turns.filter(turn => turn.role === "tutor") as (typeof turns[number] & ReturnType<typeof splitTurn>)[];
  const sentences = tutorTurns.flatMap(turn => turn.sentences);
  const display = tutorTurns.flatMap(turn => turn.display);
  const lists = tutorTurns.flatMap(turn => turn.lists);
  const subject = detectSubject(completed);
  const terms = extractTerms(tutorTurns.map(turn => ({ turn: turn.index, doc: turn.doc })),
    window.filter(turn => turn.role === "learner").map(turn => turn.text));
  const { title, topic } = titleFor(window, terms, tutorTurns.map(turn => turn.doc));
  const top = topic?.[0];

  const ranked = [...sentences].filter(usable)
    .map(sentence => ({ sentence, score: explanatoryScore(sentence, terms, top) }))
    .sort((a, b) => b.score - a.score || a.sentence.id - b.sentence.id).map(item => item.sentence);

  const correction = corrections(sentences, terms);
  const contrasts = contrastsIn(sentences, terms);
  // Priority order: the rarer, more lesson-specific kinds first; cloze and swap are the fallback.
  const pools = [
    formulaQuestions(sentences, display),
    correction.questions,
    compareQuestions(sentences, terms),
    whyQuestions(sentences, terms),
    exampleQuestions(sentences, terms),
    meaningQuestions(sentences, lists, LANGUAGE_SUBJECTS.has(subject)),
    orderQuestions(sentences, lists),
    nameQuestions(sentences, terms),
    applyQuestions(turns, terms),
    oddOneQuestions(sentences, lists, terms),
    trueFalseQuestions(ranked, terms, contrasts),
    clozeQuestions(ranked, terms),
    swapQuestions(ranked, terms),
  ];
  const offset = completed.length - window.length;
  const byId = new Map(sentences.map(sentence => [sentence.id, sentence]));
  for (const pool of pools) for (const item of pool) {
    const sentence = item.sentence === undefined ? undefined : byId.get(item.sentence);
    const origin = item.origin ?? (sentence ? { turn: sentence.turn, text: restore(sentence.doc, sentence.masked) } : undefined);
    if (origin) item.source = { turn: offset + origin.turn, quote: quoteFor(window[origin.turn].text, origin.text) };
  }
  // A question about a picture carries that picture, or it is not asked.
  for (const pool of pools) for (let index = pool.length - 1; index >= 0; index--) {
    const image = pictureFor(pool[index], completed);
    if (image === null) pool.splice(index, 1);
    else if (image) pool[index].image = { id: image.id, alt: image.alt, src: image.src };
  }
  const picked = mixQuestions(pools, 6);
  const reviveCount = picked.length >= 6 ? 2 : picked.length >= 3 ? 1 : 0;
  const gateCount = Math.min(4, picked.length - reviveCount);
  // Four choices only on the hardest items (the last two gates) and on odd-one-out; three elsewhere.
  const questions = picked.map((item, index) => {
    const hard = item.kind === "oddone" || (index < gateCount && index >= gateCount - 2);
    return toQuestion({ ...item, a: item.kind === "truefalse" || hard ? item.a : item.a.slice(0, 3) });
  });
  const gates = questions.slice(0, gateCount);
  const revive = questions.slice(gateCount, gateCount + reviveCount);

  let tldr = ranked.map(sentence => restore(sentence.doc, sentence.masked)).find(text => text.length <= 145) ?? "";
  if (!tldr) for (const sentence of ranked) {
    const text = fitClauses(sentence.doc, sentence.masked, 0, 145);
    if (text && !text.startsWith("…")) { tldr = text; break; }
  }
  if (!tldr) {
    const fallback = sentences.find(sentence => !sentence.greeting && !sentence.code) ?? sentences[0];
    tldr = fallback ? fitClauses(fallback.doc, fallback.masked, 0, 145) ?? recessPlainText(restore(fallback.doc, fallback.masked)).slice(0, 145) : "";
  }

  const wallLines: { line: string; rank: number; order: number }[] = [];
  const rankOf = new Map(ranked.map((sentence, index) => [sentence.id, index]));
  for (const sentence of sentences) {
    if (sentence.code || sentence.greeting) continue;
    const plain = recessPlainText(restore(sentence.doc, sentence.masked));
    const spanFree = !sentence.masked.includes("\uE000");
    const pieces = plain.length <= 48 ? [plain] : spanFree
      ? [`${plain.slice(0, 47).replace(/\s+\S*$/, "").replace(/[,;:]$/, "")}…`]
      : clausePieces(plain).map(piece => plain.slice(piece.start, piece.end).trim().replace(/[,;:]$/, ""));
    for (const piece of pieces) {
      const pieceWords = piece.match(WORD) ?? [];
      const whole = pieces.length === 1;
      if (piece.length > 48 || (!whole && (pieceWords.length < 3 || isStop(pieceWords.at(-1) ?? "")))) continue;
      wallLines.push({ line: piece, rank: rankOf.get(sentence.id) ?? 999, order: wallLines.length });
    }
  }
  const wall = [...wallLines].sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, 6)
    .sort((a, b) => a.order - b.order).map(item => item.line);

  const plainTerms = terms.filter(term => !term.code || term.text.length <= 24).map(term => recessPlainText(term.text)).filter(Boolean);
  const words = plainTerms.length ? plainTerms : ["…"];
  const token = (index: number) => words[index % words.length];
  const teachingWords = sentences.filter(sentence => !sentence.greeting)
    .reduce((sum, sentence) => sum + (recessPlainText(restore(sentence.doc, sentence.masked)).match(WORD) ?? []).length, 0);

  const pack: RecessPack = {
    ...recessSubjectStyle(subject),
    title,
    drift: words.slice(0, 9),
    spin: token(0), split: [token(1), token(2), token(3)], dart: token(4), worm: token(5),
    myths: correction.myths.slice(0, 5), gates, revive,
    wall, tldr,
  };
  return {
    pack,
    candidates: interleave(pools, 16),
    topic: topic ? recessPlainText(title) : undefined,
    keyTerms: terms.filter(term => term.strong).map(term => recessPlainText(term.text)),
    teachingWords,
  };
}

/** Every question the builder could make from this lesson, before it picks the pack's gates and revive.
 * Each has a kind; kinds take turns so a curator sees real choice. Deduplicated by question text and by
 * correct answer, deterministic, at most 16. Choices are 2 (truefalse), 3 or 4. */
export function recessQuestionCandidates(lesson: HabitLesson): KindedQuestion[] {
  return analyzeRecessLesson(lesson)?.candidates ?? [];
}

/** Build a playable level from the actual tutor text, even when the model is unavailable. */
export function buildChatRecessPack(lesson: HabitLesson): RecessPack | null {
  return analyzeRecessLesson(lesson)?.pack ?? null;
}
