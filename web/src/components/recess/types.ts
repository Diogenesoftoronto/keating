import type { RecessHelperId, RecessWeaponId } from "../../keating/habits/quest-catalog";
import type { BossId } from "./engine/boss-roster.js";
import type { MinibossId } from "./engine/miniboss-roster.js";

export type RecessLessonTurn = { role: "learner" | "tutor"; text: string };
export type RecessCondition = { charge: number; tune: number; shine: number };
export type RecessControl = "follow" | "twin" | "thrust";
export type RecessTheme = "paper" | "term";
export type RecessRivalId = Exclude<BossId, "wall">;
export type RecessActorId = RecessRivalId | MinibossId;

export type RecessQuestionKind = "cloze" | "name" | "formula" | "swap" | "correction" | "apply"
  | "truefalse" | "why" | "example" | "order" | "meaning" | "oddone" | "compare";

export interface RecessQuestion {
  /** Markdown with $maths$ allowed; rendered in the DOM. */
  q: string;
  kind?: RecessQuestionKind;
  /** Stable for the same lesson: lets a result point back at the question it came from. */
  id?: string;
  /** The tutor turn (index into the lesson) and a verbatim plain excerpt that support the correct answer. */
  source?: { turn: number; quote: string };
  /** Two to four choices, the first correct. The engine shuffles them (true/false keeps True on the left) and draws one lane per choice. */
  a: readonly string[];
}

export type RecessExplainLevel = "sound" | "partial" | "missed";
/** The open question for the "explain it" pause: chosen before the run, graded while play is paused. */
export interface RecessExplainItem { prompt: string; reference: string }

export interface RecessPack {
  id: string;
  cast?: string;
  label: string;
  title: string;
  meta?: string;
  thread?: readonly ({ me: string } | { k: string } | { code: string })[];
  names: Record<"drift" | "dart" | "spin" | "split" | "worm" | "myth" | "wall", string>;
  drift: readonly string[];
  spin: string;
  split: readonly string[];
  dart: string;
  worm: string;
  myths: readonly { wrong: string; right: string }[];
  gates: readonly RecessQuestion[];
  wall: readonly string[];
  tldr: string;
  revive?: readonly RecessQuestion[];
  explain?: RecessExplainItem;
  boss?: {
    name: string;
    taunts?: { intro?: string; phase?: readonly string[]; low?: string; defeat?: string };
  };
}

export interface RecessCheckResult {
  q: string;
  kind?: RecessQuestionKind;
  id?: string;
  right: string;
  picked: string | null;
  ok: boolean;
}

export interface RecessResult {
  won: boolean;
  quit: boolean;
  /** The actual opponent reached in this flight. Older logs and early landings may omit it. */
  bossName?: string;
  /** A knockout earns an entry, even if the pilot lands before the finale. */
  minibosses?: string[];
  score: number;
  kills: number;
  grazes: number;
  rattled: number;
  hearts: number;
  gates: RecessCheckResult[];
  myths: { wrong: string; right: string }[];
  wind: RecessCheckResult | null;
  explain?: (RecessExplainItem & { answer: string; level: RecessExplainLevel }) | null;
  tldr: string | null;
  care: {
    /** Legacy flat cost; kept for older readers. `chargeDelta` is authoritative when present. */
    used: number;
    /** Firing charge left at the end minus the charge the run started with, in [-1, 1]. */
    chargeDelta?: number;
    cogs: number;
    sparks: number;
  };
}

export interface RecessBotArt {
  sheet: HTMLImageElement;
  rivalSheets?: Partial<Record<RecessActorId, HTMLImageElement>>;
  rows: Record<string, number>;
  hasJetpack: boolean;
  toy: { img: HTMLImageElement; box: readonly (readonly number[])[]; cell: number; cast: string; axis: string; poses: Record<string, HTMLImageElement> } | null;
  flip: { img: HTMLImageElement; rows: Record<string, number>; cell: number } | null;
  equipment: Partial<Record<"topper" | "pack" | "blaster", { image: HTMLImageElement; cell: number }>>;
  keycapBoots: boolean;
}

export interface RecessHud {
  hearts: number;
  bombs: number;
  score: number;
  mult: number;
  combo: number;
  power: number;
  /** Live firing charge, 0 to 1. */
  charge: number;
  meter: number;
  boss: number;
  weapon?: RecessWeaponId;
  weaponTemp?: boolean;
  helpers?: number;
  helperKind?: RecessHelperId;
}

export interface RecessWind {
  q: string;
  answers: { t: string; ok: boolean }[];
  seconds: number;
}
