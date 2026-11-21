import { expect, test } from "bun:test";
import { fireWeapon, pickDropWeapon, stepShot } from "../components/recess/engine/arsenal.js";
import { applyHabitsCommand, createHabitsState } from "../keating/habits/engine";
import { RECESS_WEAPONS, resolveRecessLoadout, type RecessWeaponId } from "../keating/habits/quest-catalog";

type Shot = {
  x: number; y: number; vx: number; vy: number; ang: number; r: number;
  hit: Set<object>; returning: boolean; duration: number; banksLeft: number; dead?: boolean;
};

function volley(weapon: RecessWeaponId, power = 1, tier = 3, focus = false, aim = -Math.PI / 2) {
  const game = {
    W: 320, H: 480, shots: [] as Shot[], foes: [],
    P: { x: 160, y: 410, aim, focus, power, vol: 0, fireT: 1 },
    clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
    emit: () => {},
  };
  let cost = 0;
  fireWeapon(game, weapon, tier, (amount: number) => { cost += amount; }, { cost: 0.002 });
  return { game, shots: game.shots, cost };
}

test("the brush banks at the actual rail, uses the rest of the frame, and exhausts its rebounds", () => {
  const { game, shots } = volley("ricochet", 2, 3, false, 0);
  const s = shots.find(shot => Math.abs(shot.vy) < 1e-6)!;
  const startX = s.x, startY = s.y, speed = s.vx;
  const rail = game.W - s.r;
  const firstContact = (rail - startX) / speed;

  stepShot(game, s, firstContact + 0.04);
  expect(s.x).toBeCloseTo(rail - speed * 0.04);
  expect(s.y).toBeCloseTo(startY);
  expect(s.vx).toBe(-speed);
  expect(s.banksLeft).toBe(1);

  const across = (game.W - 2 * s.r) / speed;
  stepShot(game, s, across - 0.04 + 0.01);
  expect(s.x).toBeCloseTo(s.r + speed * 0.01);
  expect(s.vx).toBe(speed);
  expect(s.banksLeft).toBe(0);
  stepShot(game, s, across);
  expect(s.dead).toBe(true);
  expect(s.x).toBe(rail);
});

test("return stamps can hit once per leg and follow the moving pilot home", () => {
  const { game, shots } = volley("boomerang");
  const s = shots[0]!;
  const foe = {};
  const startY = s.y;
  s.hit.add(foe);
  stepShot(game, s, s.duration * 0.25);
  expect(s.x).toBeGreaterThan(game.P.x);
  expect(s.y).toBeLessThan(startY);
  expect(s.hit.has(foe)).toBe(true);
  stepShot(game, s, s.duration * 0.25);
  expect(s.returning).toBe(true);
  expect(s.hit.has(foe)).toBe(false);
  const turnaroundY = s.y;

  s.hit.add(foe);
  game.P.x += 105;
  game.P.y -= 14;
  stepShot(game, s, s.duration * 0.25);
  expect(s.y).toBeGreaterThan(turnaroundY);
  expect(s.hit.has(foe)).toBe(true);
  stepShot(game, s, s.duration * 0.26);
  expect(s.dead).toBe(true);
  expect(s.x).toBeCloseTo(game.P.x);
  expect(s.y).toBeCloseTo(game.P.y);
});

test("reserve charge preserves each trick, and upgrades and focus change the spread", () => {
  for (const weapon of ["ricochet", "boomerang"] as const) {
    expect(volley(weapon, 4, 0).shots).toHaveLength(0);
    const reserve = volley(weapon, 4, 1);
    expect(reserve.shots).toHaveLength(1);
    expect(reserve.cost).toBe(0.001);
    expect(volley(weapon, 4, 2).shots.length).toBeLessThan(volley(weapon, 4).shots.length);
  }
  const brush = volley("ricochet"), focused = volley("ricochet", 1, 3, true);
  expect(Math.abs(focused.shots[0]!.vx)).toBeLessThan(Math.abs(brush.shots[0]!.vx));
  const stamps = volley("boomerang", 3);
  for (const s of stamps.shots) stepShot(stamps.game, s, s.duration * 0.25);
  expect(stamps.shots[0]!.x - stamps.game.P.x).toBeCloseTo(stamps.game.P.x - stamps.shots[1]!.x);
});

test("both projectiles are obtainable as drops and through the Workshop", () => {
  const state = createHabitsState(0, "lively", "seed", "UTC");
  state.inventory.parts = 10;
  const drops = new Set(Array.from({ length: 32 }, (_, i) => pickDropWeapon("pulse", n => i / 32 * n)));
  for (const id of ["bankbrush", "returnstamp"]) {
    const piece = RECESS_WEAPONS.find(item => item.id === id)!;
    expect(drops.has(piece.weapon)).toBe(true);
    expect(applyHabitsCommand(state, { type: "craft", kitId: id })).toBe(true);
    expect(applyHabitsCommand(state, { type: "equip", kitId: id })).toBe(true);
    expect(resolveRecessLoadout(state.equippedKit).weapon).toBe(piece.weapon);
  }
});
