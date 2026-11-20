import { expect, test } from "bun:test";
import { applyHabitsCommand, createHabitsState, habitsSnapshot } from "../keating/habits/engine";
import { HABIT_KIT, RECESS_HELPERS, RECESS_WEAPONS, resolveRecessLoadout } from "../keating/habits/quest-catalog";
import { fireWeapon, helperMagnetScale, stepShot, updateHelpers } from "../components/recess/engine/arsenal.js";

function mockGame(weapon = "pulse", helper = "drone") {
  const events: Array<{ name: string; data: unknown }> = [];
  const G = {
    state: "play",
    T: 1,
    calm: true,
    W: 600,
    H: 500,
    score: 0,
    mult: 1,
    shots: [] as Array<Record<string, unknown>>,
    foes: [] as Array<Record<string, unknown>>,
    bul: [] as Array<Record<string, unknown>>,
    helpers: [] as Array<Record<string, unknown>>,
    loadout: {
      weapon,
      helper,
      perks: { chargeGain: 1, grazeRadius: 26, scoreBonus: 1, focusSpeed: 1, headStart: 0 },
    },
    P: { x: 300, y: 380, aim: -Math.PI / 2, focus: false, power: 1, vol: 0, fireT: 1 },
    chargeTier: () => 3,
    clamp: (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v),
    emit: (name: string, data: unknown) => { events.push({ name, data }); },
  };
  return { G, events };
}

test("all 6 Recess weapons produce distinct shot patterns and pierce/spread/wave properties", () => {
  const CHARGE = { cost: 0.002 };

  for (const weapon of ["pulse", "gavel", "scatter", "beam", "wave", "burst"] as const) {
    const { G } = mockGame(weapon, "drone");
    G.P.power = 2;
    let drained = 0;
    const cadence = fireWeapon(G, weapon, 3, (n: number) => { drained += n; }, CHARGE);
    expect(G.shots.length).toBeGreaterThan(0);
    expect(drained).toBeGreaterThan(0);
    expect(cadence).toBeGreaterThan(0);

    if (weapon === "gavel" || weapon === "beam") {
      expect(G.shots.some(s => s.pierce === true && s.hit instanceof Set)).toBe(true);
    }
    if (weapon === "scatter") {
      expect(G.shots.length).toBe(5);
      const wideSpan = Math.max(...G.shots.map(s => Number(s.ang))) - Math.min(...G.shots.map(s => Number(s.ang)));
      G.shots = [];
      G.P.focus = true;
      fireWeapon(G, "scatter", 3, () => {}, CHARGE);
      const focusSpan = Math.max(...G.shots.map(s => Number(s.ang))) - Math.min(...G.shots.map(s => Number(s.ang)));
      expect(focusSpan).toBeLessThan(wideSpan);
    }
    if (weapon === "wave") {
      const waves = G.shots.filter(s => s.kind === "wave");
      expect(waves.length).toBe(2);
      const x0 = Number(waves[0]!.x);
      const x1 = Number(waves[1]!.x);
      stepShot(G, waves[0], 0.05);
      stepShot(G, waves[1], 0.05);
      // Counter-phased sine waves drift to opposite sides of the aim line.
      expect(Number(waves[0]!.x) - x0).toBeCloseTo(-(Number(waves[1]!.x) - x1), 3);
    }
  }
});

test("companion helpers summon at Power 2 and 3, Magnet Scribe boosts pull, and Aegis parries enemy bullets", () => {
  const { G, events } = mockGame("pulse", "scribe");
  G.P.power = 1;
  updateHelpers(G, 0.016);
  expect(G.helpers.length).toBe(0);
  expect(helperMagnetScale(G)).toBe(1);

  G.P.power = 2;
  updateHelpers(G, 0.016);
  expect(G.helpers.length).toBe(1);
  expect(helperMagnetScale(G)).toBe(2.2);
  expect(events.some(e => e.name === "helperJoin")).toBe(true);

  G.P.power = 3;
  updateHelpers(G, 0.016);
  expect(G.helpers.length).toBe(2);

  // Aegis Prism orbits and parries a nearby non-safe enemy bullet on cooldown.
  const aegis = mockGame("pulse", "aegis");
  aegis.G.P.power = 2;
  updateHelpers(aegis.G, 0.016);
  const pod = aegis.G.helpers[0]!;
  const bullet = { x: Number(pod.x) + 4, y: Number(pod.y), r: 6, dead: false, safe: false };
  aegis.G.bul.push(bullet);
  updateHelpers(aegis.G, 0.016);
  expect(bullet.dead).toBe(true);
  expect(aegis.events.some(e => e.name === "parry")).toBe(true);
  expect(aegis.G.score).toBe(40);
});

test("Tamagotchi Workshop crafts and equips parts-only weapons and companions and resolves Recess loadout perks", () => {
  const state = createHabitsState(Date.parse("2026-11-20T12:00:00Z"), "lively", "seed", "UTC");
  expect(state.ownedKit).toEqual(expect.arrayContaining(["jetpack", "blaster", "drone"]));

  // Cannot craft without parts
  expect(applyHabitsCommand(state, { type: "craft", kitId: "megaphone" })).toBe(false);

  // With workshop parts earned from study/quests, craft a weapon and a companion
  state.inventory.parts = 12;
  expect(applyHabitsCommand(state, { type: "craft", kitId: "megaphone" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "craft", kitId: "aegis" })).toBe(true);
  expect(state.inventory.parts).toBe(2);

  expect(applyHabitsCommand(state, { type: "equip", kitId: "megaphone" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "equip", kitId: "aegis" })).toBe(true);

  // Also grant & equip existing Tamagotchi gear to verify perks flow into Recess
  state.ownedKit.push("flask", "keyboots", "protractor");
  expect(applyHabitsCommand(state, { type: "equip", kitId: "flask" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "equip", kitId: "keyboots" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "equip", kitId: "protractor" })).toBe(true);

  const snap = habitsSnapshot(state, "learner-1");
  const loadout = resolveRecessLoadout(snap.equippedKit);
  expect(loadout).toMatchObject({
    weapon: "scatter",
    helper: "aegis",
    perks: {
      chargeGain: 1.25,
      grazeRadius: 26,
      scoreBonus: 1,
      focusSpeed: 1.15,
      headStart: 4,
    },
  });

  expect(RECESS_WEAPONS.length).toBe(6);
  expect(RECESS_HELPERS.length).toBe(4);
  for (const piece of HABIT_KIT) {
    expect(piece.recessEffect).toBeTruthy();
  }
});
