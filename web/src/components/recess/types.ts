export type RecessLessonTurn = { role: "learner" | "tutor"; text: string };
export type RecessCondition = { charge: number; tune: number; shine: number };
export type RecessControl = "follow" | "twin" | "thrust";
export type RecessTheme = "paper" | "term";

export interface RecessQuestion {
  q: string;
  /** The first choice is correct. The engine shuffles choices before display. */
  a: readonly string[];
}

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
  boss?: {
    name: string;
    taunts?: { intro?: string; phase?: readonly string[]; low?: string; defeat?: string };
  };
}

export interface RecessCheckResult {
  q: string;
  right: string;
  picked: string | null;
  ok: boolean;
}

export interface RecessResult {
  won: boolean;
  quit: boolean;
  score: number;
  kills: number;
  grazes: number;
  rattled: number;
  hearts: number;
  gates: RecessCheckResult[];
  myths: { wrong: string; right: string }[];
  wind: RecessCheckResult | null;
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
}

export interface RecessWind {
  q: string;
  answers: { t: string; ok: boolean }[];
  seconds: number;
}
