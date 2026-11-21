import { expect, mock, spyOn, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { advanceBombFields, interceptBombBullet, releaseBomb } from "../components/recess/engine/bombs.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { install as installPatterns, RecessPatterns } from "../components/recess/engine/patterns.js";

function fieldWorld(bombKind) {
  return {
    W: 320, H: 400, P: { x: 160, y: 200, inv: 0 }, bombKind, bombFields: [], foes: [], kinds: {},
    addPick: mock(), emit: mock(), cancelBullets: mock(), hurtFoe: mock((foe, damage) => { foe.hp -= damage; }),
    on() {}, hook() {},
  };
}

test("an ink well catches a fast shot between frames, stays where fired, and expires after 2.5 seconds", () => {
  const world = fieldWorld("inkwell");
  releaseBomb(world);
  world.P.x = 35;
  world.P.y = 330;
  const shot = { k: 1, x: 265, y: 200, r: 3 };
  expect(interceptBombBullet(world, shot, 55, 200)).toBe(true);
  expect(interceptBombBullet(world, { ...shot, y: 290 }, 55, 290)).toBe(false);
  expect(world.addPick).toHaveBeenCalledTimes(1);
  expect(world.cancelBullets).not.toHaveBeenCalled();

  advanceBombFields(world, 2.49);
  expect(interceptBombBullet(world, shot, 55, 200)).toBe(true);
  advanceBombFields(world, 0.02);
  expect(interceptBombBullet(world, shot, 55, 200)).toBe(false);
  expect(world.bombFields).toHaveLength(0);
});

test("an offscreen laser is intercepted only if its visible beam reaches the ink well", () => {
  const world = fieldWorld("inkwell");
  releaseBomb(world);
  const laser = { k: 6, x: -80, y: 200, ang: 0, len: 490, r: 3 };
  expect(interceptBombBullet(world, { ...laser, len: 90 }, -80, 200)).toBe(false);
  expect(interceptBombBullet(world, { ...laser, y: 305 }, -80, 305)).toBe(false);
  expect(interceptBombBullet(world, laser, -80, 200)).toBe(true);
  expect(world.addPick).toHaveBeenCalledWith("s", 160, 200, true);
});

test("a well respects the hole in a rule and the height of a floor ripple", () => {
  const world = fieldWorld("inkwell");
  world.floorY = 300;
  releaseBomb(world);
  const rule = { k: 9, r: 5, x: 160, y: 205, gx: 160, gw: 140 };
  expect(interceptBombBullet(world, rule, 160, 199)).toBe(false);
  expect(interceptBombBullet(world, { ...rule, gx: 220 }, 160, 199)).toBe(true);
  const ripple = { k: 10, r: 8, x: 166, y: 300 };
  expect(interceptBombBullet(world, ripple, 155, 300)).toBe(false);
  world.P.y = 267;
  releaseBomb(world);
  expect(interceptBombBullet(world, ripple, 155, 300)).toBe(true);
});

test("a redaction sweep hits each active foe once and honours the Wall's phase damage floor", () => {
  const world = fieldWorld("sweep");
  installPatterns(world);
  const drift = { k: "drift", y: 360, r: 14, hp: 70, born: 0 };
  const wall = { k: "wall", y: 250, h: 80, hp: 115, born: 0, hold: true, floor: 100 };
  const landing = { ...drift, born: 1 };
  const dead = { ...drift, dead: true };
  world.foes.push(drift, wall, landing, dead);
  releaseBomb(world);
  advanceBombFields(world, 0.14);
  expect([drift.hp, wall.hp]).toEqual([44, 115]);
  const shot = { k: 1, x: 40, y: 340, r: 3 };
  expect(interceptBombBullet(world, shot, 40, 395)).toBe(true);
  expect(interceptBombBullet(world, shot, 40, 330)).toBe(false);
  advanceBombFields(world, 0.18);
  advanceBombFields(world, 0.01);
  expect([drift.hp, wall.hp, landing.hp, dead.hp]).toEqual([44, 100, 70, 70]);
  expect(world.hurtFoe).toHaveBeenCalledTimes(2);
  expect(world.cancelBullets).not.toHaveBeenCalled();
  advanceBombFields(world, 1);
  advanceBombFields(world, 0.1);
  expect(world.bombFields).toHaveLength(0);
});

// Launch through the normal game API. Intercept the script factory to inspect
// its world before the first frame, as in the keyboard/touch playfield tests.
test("an unknown bomb falls back to Eureka, consumes one charge and cancels every projectile", () => {
  const arena = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 400 }),
    querySelectorAll: () => [], focus() {},
  });
  const canvas = () => ({ width: 320, height: 400, hidden: false, getContext: () => ({}) });
  const platform = {
    window: new EventTarget(), document: { createElement: canvas },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  let world, game;
  const startScript = RecessPatterns.script;
  const script = spyOn(RecessPatterns, "script").mockImplementation((G, scene) => {
    world = G;
    return startScript(G, scene);
  });
  try {
    for (const [name, value] of Object.entries(platform)) Object.defineProperty(globalThis, name, { configurable: true, value });
    game = Recess.create({
      arena, thread: arena, dock: arena, bot: arena,
      view: canvas(), shader: null, sound: RecessAudio.create(),
      pack: packs.maths, theme: "paper", control: "follow", calm: true,
      sheet: {}, rows: {}, hasJetpack: true, flip: null, toy: null, equipment: {}, keycapBoots: false,
      bombKind: "retired-bomb-id", hud() {}, ask() {}, phase() {}, revive() {}, end() {},
    });
    expect(game.start("start")).toBe(true);
    expect(world.bombKind).toBe("eureka");
    const bullet = { k: 1, x: 20, y: 70, r: 3 };
    const beam = { k: 6, x: -40, y: 50, r: 3, ang: 0, len: 470 };
    world.bul.push(bullet, beam);
    const foe = { k: "drift", x: 50, y: 35, r: 8, hp: 70, born: 0 };
    world.foes.push(foe);
    game.bomb();
    expect(world.bul).toHaveLength(2);
    world.state = "play";
    world.P.bombs = 0;
    game.bomb();
    expect(world.bul).toHaveLength(2);
    world.P.bombs = 2;
    game.bomb();
    expect(world.bul).toHaveLength(0);
    expect(foe.hp).toBe(44);
    expect(world.P.bombs).toBe(1);
    expect(world.bombFields).toHaveLength(0);
    world.bul.push(bullet);
    game.bomb();
    expect(world.P.bombs).toBe(1);
    expect(world.bul).toHaveLength(1);
  } finally {
    game?.dispose();
    script.mockRestore();
    for (const name of Object.keys(platform)) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
