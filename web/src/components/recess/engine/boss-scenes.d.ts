import type { RecessRivalId } from "../types";

export interface RecessBossSceneBeat {
  variant: "redaction" | "footnote" | "margin" | "radius" | "seam" | "tempo" | "imprint" | "exposure";
  bossId?: "wall" | RecessRivalId;
  bossVariant?: 0 | 1;
  variantName?: string;
  portraitPose?: 0 | 1 | 2 | 3;
  bossName: string;
  speaker: "boss" | "keating";
  text: string;
  index: 0 | 1;
  total: 2;
}

export function createBossScenes(world: unknown): {
  open(boss: unknown): boolean;
  tick(dt: number): void;
  advance(): boolean;
  skip(): boolean;
  cancel(): boolean;
};
