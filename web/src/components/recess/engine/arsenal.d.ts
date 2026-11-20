import type { RecessHelperId, RecessWeaponId } from "../../../keating/habits/quest-catalog";

export const WEAPON_LABELS: Record<RecessWeaponId, string>;
export const HELPER_LABELS: Record<RecessHelperId, string>;
export function pickDropWeapon(current: RecessWeaponId, rnd: (n: number) => number): RecessWeaponId;
export function fireWeapon(G: unknown, weaponId: RecessWeaponId, tier: number, drain: (amount: number) => void, CHARGE: { cost: number }): number;
export function stepShot(G: unknown, shot: unknown, dt: number): void;
export function drawShots(c: CanvasRenderingContext2D, em: CanvasRenderingContext2D, G: unknown, pal: unknown): void;
export function helperMagnetScale(G: unknown): number;
export function updateHelpers(G: unknown, dt: number): void;
export function drawHelpers(c: CanvasRenderingContext2D, em: CanvasRenderingContext2D, G: unknown, pal: unknown): void;
