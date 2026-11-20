import { packs } from "../../components/recess/engine/packs.js";
import type { RecessPack, RecessQuestion } from "../../components/recess/types";
import type { HabitLesson } from "./lesson";

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
  spanish: /\b(?:spanish|español|ser o estar|ser and estar|pretérito|subjuntivo|¿c[oó]mo)\b/gi,
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

const commonWords = new Set("again also always another because been before being come could does each either even from have here into just like more most must never next once only other over same some such than that them then there these they this those through very were what when where which while will with without would your".split(" "));

function termsIn(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)].filter(match =>
    match[0].length >= 4 && match[0].length <= 24 && !commonWords.has(match[0].toLowerCase()),
  );
}

function excerpt(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function recallQuestions(lines: string[], terms: string[]): RecessQuestion[] {
  const questions: RecessQuestion[] = [];
  const used = new Set<string>();
  for (const line of lines) {
    const answer = termsIn(line).find(term => !used.has(term[0].toLowerCase()));
    if (!answer || answer.index === undefined) continue;
    const key = answer[0].toLowerCase();
    const alternatives = terms.filter(term => term.toLowerCase() !== key).slice(0, 2);
    if (alternatives.length !== 2) continue;
    const before = line.slice(0, answer.index);
    const after = line.slice(answer.index + answer[0].length);
    const left = before.length > 32 ? `…${before.slice(-32)}` : before;
    questions.push({ q: `Fill in the tutor’s wording: “${left}____${excerpt(after, 35)}”`, a: [answer[0], ...alternatives] });
    used.add(key);
    if (questions.length === 3) break;
  }
  return questions;
}

/** Build a playable level from the actual tutor text, even when the model is unavailable. */
export function buildChatRecessPack(lesson: HabitLesson): RecessPack | null {
  const latestTutor = lesson.findLastIndex(turn => turn.role === "tutor" && turn.text.trim());
  if (latestTutor < 0) return null;
  const completed = lesson.slice(0, latestTutor + 1);
  const lines = completed.filter(turn => turn.role === "tutor").flatMap(turn =>
    turn.text.split(/\n+|(?<=[.!?。！？])\s+/u).map(line => line.trim()).filter(Boolean),
  ).slice(-10);
  const terms = Array.from(new Map(termsIn(lines.join(" ")).map(match => [match[0].toLowerCase(), match[0]])).values());
  const questions = recallQuestions([...lines].reverse(), terms);
  const latest = [...lines].reverse().find(line => line.length >= 24) ?? lines[lines.length - 1];
  const request = completed.findLast(turn => turn.role === "learner" && turn.text.trim().length >= 12)?.text.trim();
  const words = terms.length ? terms : ["…"];
  const token = (index: number) => words[index % words.length];
  return {
    ...recessSubjectStyle(detectSubject(completed)),
    title: excerpt((request ?? latest).replace(/\s+/g, " "), 56),
    drift: words.slice(0, 9),
    spin: token(0), split: [token(1), token(2), token(3)], dart: token(4), worm: token(5),
    myths: [], gates: questions.slice(0, 2), revive: questions.slice(2),
    wall: lines.slice(-6).map(line => excerpt(line, 48)), tldr: excerpt(latest, 145),
  };
}
