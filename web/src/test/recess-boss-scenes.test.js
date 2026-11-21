import { expect, mock, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { createBossScenes } from "../components/recess/engine/boss-scenes.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";

test("the same page rotates entrances across new arenas, casts and model-authored dialogue", () => {
  const page = {};
  const openings = [];
  for (const subject of ["maths", "biology", "coding", "maths"]) {
    const beats = [];
    const generated = subject === "coding";
    const pack = generated ? { ...packs.coding, boss: { name: "A Lint Trap", taunts: { intro: "One more warning." } } } : packs[subject];
    const world = {
      W: 440, o: { arena: { ownerDocument: page }, bossScene: beat => beats.push(beat) },
      state: "play", calm: false, rnd: () => 0, P: { inv: 0 }, pack, resetFlightInput() {},
    };
    const scenes = createBossScenes(world);
    const wall = { x: 0, y: -100, w: 150, h: 150, ty: 108 };
    expect(scenes.open(wall)).toBe(true);
    expect(wall.y).toBeGreaterThan(0);
    expect(scenes.advance()).toBe(true);
    scenes.tick(12);
    expect(world.state).toBe("cutscene");
    expect(beats).toHaveLength(2);
    expect(scenes.skip()).toBe(true);
    expect(scenes.advance()).toBe(false);
    expect(beats.map(b => b?.index ?? null)).toEqual([0, 1, null]);
    expect(new Set(beats.slice(0, 2).map(b => b.speaker)).size).toBe(2);
    if (generated) {
      const bossBeat = beats.find(b => b?.speaker === "boss");
      expect(bossBeat.bossName).toBe("A Lint Trap");
      expect(bossBeat.text).toBe("One more warning.");
    }
    openings.push(beats[0].variant);
  }
  expect(new Set(openings.slice(0, 3))).toEqual(new Set(["redaction", "footnote", "margin"]));
  expect(openings[3]).not.toBe(openings[2]);
});

// Drive the public run and its real boss marker on a deterministic animation
// clock. Only the canvas and browser platform are substituted.
function withFlight({ present = true, calm = false } = {}, body) {
  let now = 1000, frame = null, world, game;
  const nop = () => {};
  const context = () => new Proxy({
    globalAlpha: 1, measureText: s => ({ width: s.length * 7 }),
    createRadialGradient: () => ({ addColorStop: nop }),
  }, { get: (target, key) => target[key] ?? nop });
  const canvas = () => ({ getContext: context, width: 480, height: 400, hidden: false });
  const browser = {
    window: new EventTarget(), document: { hidden: false, createElement: canvas },
    performance: { now: () => now }, requestAnimationFrame: fn => { frame = fn; return 1; },
    cancelAnimationFrame: () => { frame = null; },
  };
  const field = Object.assign(new EventTarget(), {
    ownerDocument: browser.document, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 400 }), focus: nop,
  });
  const dock = { getBoundingClientRect: () => ({ left: 0, top: 348, width: 480, height: 52 }) };
  const beats = [], results = [], originalScript = RecessPatterns.script;
  const platform = Object.getOwnPropertyDescriptors(globalThis);
  const pack = { ...packs.maths, boss: { name: "The Long Sum", taunts: { intro: "Look at all my working." } } };
  const frames = (count = 1) => {
    for (let i = 0; i < count; i++) { now += 20; frame?.(now); }
  };
  const until = predicate => {
    for (let i = 0; i < 600 && !predicate(); i++) frames();
    expect(predicate()).toBe(true);
  };
  try {
    for (const [key, value] of Object.entries(browser)) Object.defineProperty(globalThis, key, { configurable: true, value });
    RecessPatterns.script = (G, scene) => { world = G; return originalScript(G, scene); };
    game = Recess.create({
      pack, calm, arena: field, thread: field, dock, bot: dock, view: canvas(), shader: null, sound: RecessAudio.create(),
      theme: "paper", control: "follow", sheet: {}, rows: {}, hasJetpack: false, flip: null, toy: null, equipment: {},
      bossScene: present ? beat => beats.push(beat) : undefined,
      hud: nop, ask: nop, phase: nop, revive: nop, end: result => results.push(result),
    });
    game.start("boss");
    body({ game, world, beats, results, frames, until, document: browser.document });
  } finally {
    game?.dispose();
    RecessPatterns.script = originalScript;
    for (const key of Object.keys(browser)) {
      if (platform[key]) Object.defineProperty(globalThis, key, platform[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("a live boss entrance freezes combat, waits in a hidden tab, then hands the same boss to its first phase", () => {
  withFlight({}, ({ game, world: G, beats, frames, until, document }) => {
    until(() => game.state === "play");
    G.inp.held = true;
    G.inp.keys.Shift = true;
    // A last-chance window started on the spawn frame must not land a stale hit after reading.
    G.on("foeSpawn", ({ e }) => { if (e.k === "wall") G.hitPlayer(); });
    until(() => game.state === "cutscene");
    expect(G.inp.held).toBe(false);
    expect(G.inp.keys).toEqual({});
    const wall = G.boss;
    const hp = wall.hp, time = G.T, charge = G.energy, reserve = G.P.bombs, score = G.score;
    const bullet = G.fire(G.P.x, G.P.y, 0, 40, 0);
    const timer = mock();
    G.later(0.06, timer);
    document.hidden = true;
    frames(600);
    document.hidden = false;
    expect(beats).toHaveLength(1);
    const pop = mock();
    G.J.pop = pop;
    game.bomb(); G.refill(1);
    until(() => beats.length === 2);
    expect([G.T, G.energy, G.P.bombs, G.score, G.P.hearts, wall.hp, wall.t, bullet.t]).toEqual([time, charge, reserve, score, 4, hp, 0, 0]);
    expect(timer).not.toHaveBeenCalled();
    expect(game.answerGate(0)).toBe(false);
    expect(game.state).toBe("cutscene");
    until(() => game.state === "play");
    expect(beats[2]).toBeNull();
    expect(beats.filter(beat => beat?.text === "Look at all my working.")).toHaveLength(1);
    expect(G.boss).toBe(wall);
    expect(wall.y).toBe(wall.ty);
    expect(G.P.inv).toBeGreaterThan(0);
    until(() => wall.stage === 0);
    frames(80);
    expect(G.P.hearts).toBe(4);
    expect(timer).toHaveBeenCalledTimes(1);
    expect(pop.mock.calls.flat().some(s => String(s).includes("Look at all my working."))).toBe(false);
  });
});

test("calm holds each beat until requested and a skip or teardown dismisses it only once", () => {
  withFlight({ calm: true }, ({ game, world: G, beats, results, frames, until }) => {
    until(() => game.state === "cutscene");
    frames(400);
    expect(beats).toHaveLength(1);
    expect(G.boss.x).toBe(G.W / 2);
    expect(game.advanceBossScene()).toBe(true);
    frames(400);
    expect(beats).toHaveLength(2);
    expect(game.advanceBossScene()).toBe(true);
    expect(game.skipBossScene()).toBe(false);
    expect(game.state).toBe("play");
    game.stop();
    until(() => game.state === "idle");
    expect(results[0].quit).toBe(true);

    expect(game.start("boss")).toBe(true);
    until(() => game.state === "cutscene");
    expect(beats.at(-1).variant).not.toBe(beats[0].variant);
    game.stop();
    expect(game.state).toBe("outro");
    expect(beats.at(-1)).toBeNull();
    expect(game.skipBossScene()).toBe(false);
    until(() => game.state === "idle");
    expect(results).toHaveLength(2);

    game.start("boss");
    until(() => game.state === "cutscene");
    expect(game.skipBossScene()).toBe(true);
    expect(game.state).toBe("play");
    until(() => G.boss.stage === 0);
    game.stop();
    until(() => game.state === "idle");

    game.start("boss");
    until(() => game.state === "cutscene");
    const count = beats.length;
    game.dispose(); game.dispose(); frames(300);
    expect(beats).toHaveLength(count + 1);
    expect(beats.at(-1)).toBeNull();
    expect(game.advanceBossScene()).toBe(false);
    expect(results).toHaveLength(3);
  });
});

test("a caller without the presenter keeps the original entrance and pack taunt", () => {
  withFlight({ present: false }, ({ game, world: G, until, frames, beats }) => {
    const pop = mock();
    G.J.pop = pop;
    until(() => Boolean(G.boss));
    expect(game.state).toBe("play");
    expect(G.boss.y).toBeLessThan(0);
    until(() => G.boss.stage === 0);
    frames(70);
    expect(pop.mock.calls.flat().filter(s => String(s).includes("Look at all my working."))).toHaveLength(1);
    expect(beats).toEqual([]);
    expect(game.skipBossScene()).toBe(false);
  });
});
