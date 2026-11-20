import type { RecessBotArt, RecessCondition, RecessControl, RecessHud, RecessPack, RecessResult, RecessTheme, RecessWind } from "../types";
import type { RecessAudio } from "./audio.js";

type OneRun = {
  start(scene: "start"): boolean;
  stop(): void;
  bomb(): void;
  readonly state: "idle" | "intro" | "play" | "outro" | "down";
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
  hud(value: RecessHud): void;
  ask(value: { question: string; options: string[] } | null): void;
  phase(value: "play" | "outro"): void;
  revive(value: RecessWind | null, answer?: (index: number) => void): void;
  end(result: RecessResult): void;
}

export const Recess: { create(options: RecessOptions): OneRun };
