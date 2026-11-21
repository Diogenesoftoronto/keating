export type RecessBombKind = "eureka" | "sweep" | "inkwell";
export const RECESS_BOMBS: Record<RecessBombKind, { name: string; effect: string }>;
export function resolveBombKind(value: unknown): RecessBombKind;
export function releaseBomb(world: unknown): void;
export function advanceBombFields(world: unknown, dt: number): void;
export function interceptBombBullet(world: unknown, bullet: unknown, fromX: number, fromY: number): boolean;
export function drawBombFields(world: unknown): void;
