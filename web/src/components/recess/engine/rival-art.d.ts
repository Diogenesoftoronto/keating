import type { RecessActorId } from "../types";

export function drawRivalActor(
  context: CanvasRenderingContext2D,
  actor: {
    bossId: RecessActorId; bossPose?: 0 | 1 | 2 | 3; beatSide?: number;
    x: number; y: number; w: number; h: number;
    bossLobes?: { x: number; y: number }[];
  },
  sheet?: HTMLImageElement,
  palette?: Record<"ink" | "card" | "soft" | "wash" | "deep", string>,
): void;
