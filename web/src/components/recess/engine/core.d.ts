import type { RecessQuestionImage, RecessExplainItem, RecessExplainLevel, RecessBotArt, RecessCondition, RecessControl, RecessHud, RecessPack, RecessResult, RecessTheme, RecessWind } from "../types";
import type { RecessLoadout } from "../../../keating/habits/quest-catalog";
import type { RecessAudio } from "./audio.js";
import type { RecessBombKind } from "./bombs.js";
import type { RecessBossSceneBeat } from "./boss-scenes.js";
import type { BossEncounter } from "./boss-roster.js";
import type { MinibossId } from "./miniboss-roster.js";

type OneRun = {
  start(scene: "start" | `mini/${MinibossId}`): boolean;
  stop(): void;
  bomb(): void;
  /** Answer the open gate by displayed position; false when no gate is open. */
  answerGate(index: number): boolean;
  advanceBossScene(): boolean;
  skipBossScene(): boolean;
  readonly state: "idle" | "intro" | "play" | "outro" | "down" | "pause" | "cutscene";
  /** Remaining firing charge minus this run's starting charge, in [-1, 1]. */
  readonly chargeDelta: number;
  setCalm(value: boolean): void;
  setCondition(condition: RecessCondition): void;
  dispose(): void;
};

interface RecessOptions extends RecessBotArt {
  arena: HTMLElement;
  thread: HTMLElement;
  view: HTMLCanvasElement;
  shader: HTMLCanvasElement | null;
  dock: HTMLElement;
  bot: HTMLElement;
  sound: ReturnType<typeof RecessAudio.create>;
  pack: RecessPack;
  theme: RecessTheme;
  control: RecessControl;
  calm: boolean;
  /** Frozen weapon, companion helper, and Tamagotchi kit perks for this run. */
  loadout?: RecessLoadout;
  bombKind?: RecessBombKind;
  /** Select an opponent for practice. A normal chat flight rotates its subject's rivals. */
  bossEncounter?: BossEncounter;
  /** Optional DOM layer for gate labels (Markdown and maths). The engine sets --gate-y and data-st/pick/ok on it each frame. */
  gateLayer?: HTMLElement | null;
  /** Optional DOM layer for oddone target labels (Markdown and maths). The engine sets --t{i}-x/--t{i}-y and data-st/pick/ok on it each frame. */
  targetLayer?: HTMLElement | null;
  hud(value: RecessHud): void;
  ask(value: { question: string; options: string[]; kind?: string; image?: RecessQuestionImage } | null): void;
  phase(value: "play" | "outro"): void;
  revive(value: RecessWind | null, answer?: (index: number) => void): void;
  /** "Explain it" pause: show the prompt, call done with the grade. Called with null when the run stops mid-pause. */
  explain?(value: RecessExplainItem | null, done?: (level: RecessExplainLevel, answer: string) => void): void;
  /** Supplying a presenter enables the boss entrance. A null beat dismisses it. */
  bossScene?(value: RecessBossSceneBeat | null): void;
  /** A single caption when a miniboss arrives or leaves the flight. */
  minibossNotice?(message: string): void;
  end(result: RecessResult): void;
}

export const Recess: { create(options: RecessOptions): OneRun };
