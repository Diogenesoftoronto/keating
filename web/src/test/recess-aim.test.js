import { expect, spyOn, test } from "bun:test";
import { autoAimSpread } from "../components/recess/engine/aim.js";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";

test("the sight opens smoothly with range, scales with the playfield and tightens under focus", () => {
  const near = autoAimSpread(70, 720, 450);
  const far = autoAimSpread(360, 720, 450);
  expect(far).toBeGreaterThan(near * 10);
  let previous = near;
  for (let distance = 70; distance <= 450; distance += 5) {
    const spread = autoAimSpread(distance, 720, 450);
    expect(spread).toBeGreaterThanOrEqual(previous);
    expect(spread - previous).toBeLessThan(0.01);
    expect(autoAimSpread(distance * 390 / 450, 390, 650)).toBeCloseTo(spread, 10);
    expect(autoAimSpread(distance, 720, 450, 0.75, true)).toBeCloseTo(spread * 0.35, 10);
    previous = spread;
  }
  expect(autoAimSpread(1200, 720, 450)).toBe(far);
  expect(autoAimSpread(360, 720, 450, 0)).toBeGreaterThan(far);
});

// Drive the real loop with a stationary target, a fixed sight phase, and a clock
// owned by the test. Only the wave schedule and browser paint surface are stand-ins.
function withFlight(body) {
  const width = 640, height = 500;
  const field = Object.assign(new EventTarget(), {
    focus() {}, querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, bottom: height, right: width }),
  });
  const noop = () => {};
  const context = new Proxy({ measureText: text => ({ width: text.length * 7 }) }, {
    get: (target, key) => key in target ? target[key] : noop,
  });
  const canvas = () => ({ width, height, getContext: () => context });
  let world, frame, game, now = 0;
  const platform = {
    window: new EventTarget(), document: { hidden: false, createElement: canvas },
    performance: { now: () => now },
    requestAnimationFrame: cb => { frame = cb; return 1; }, cancelAnimationFrame: () => { frame = null; },
  };
  const prior = Object.getOwnPropertyDescriptors(globalThis);
  const script = spyOn(RecessPatterns, "script").mockImplementation(G => { world = G; return { step() {} }; });
  function tick(count = 1) {
    for (let i = 0; i < count; i++) { now += 1000 / 60; frame(now); }
  }
  try {
    for (const [name, value] of Object.entries(platform)) Object.defineProperty(globalThis, name, { configurable: true, value });
    game = Recess.create({
      arena: field, thread: field, dock: field, bot: field, view: canvas(), shader: null,
      sound: RecessAudio.create(), pack: packs.maths, calm: true, control: "follow",
      sheet: {}, rows: {}, toy: null, hasJetpack: true, flip: null, equipment: {},
      hud() {}, ask() {}, phase() {}, end() {},
    });
    expect(game.start("start")).toBe(true);
    world.state = "play";
    Object.assign(world.P, { x: width / 2, y: height - 45, aim: -Math.PI / 2, seed: 0.8, shotT: 999 });
    Object.assign(world.inp, { usingKeys: true, tx: world.P.x, ty: world.P.y });
    return body(world, field, tick);
  } finally {
    game?.dispose();
    script.mockRestore();
    for (const name of Object.keys(platform)) {
      if (prior[name]) Object.defineProperty(globalThis, name, prior[name]); else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function pulseHitRate(distance, focused) {
  return withFlight((G, _field, tick) => {
    const target = G.mk("target", G.P.x, G.P.y - distance, { r: 8, hp: 10000 });
    G.foes.push(target);
    G.P.shotT = 0;
    G.inp.keys.Shift = focused;
    let fired = 0, hit = 0;
    G.on("shot", () => { fired += G.shots.filter(shot => shot.t === 0).length; });
    G.on("foeHit", ({ e }) => { if (e === target) hit++; });
    tick(480);
    expect(fired).toBeGreaterThan(100);
    // Let the last burst reach the target before counting.
    G.P.shotT = 999; tick(40);
    return hit / fired;
  });
}

test("real pulse volleys miss a distant small target more often and focus recovers accuracy", () => {
  const near = pulseHitRate(85, false);
  const far = pulseHitRate(405, false);
  const farFocused = pulseHitRate(405, true);
  expect(near).toBeGreaterThan(0.9);
  expect(far).toBeLessThan(near * 0.7);
  expect(farFocused).toBeGreaterThan(far + 0.2);
});

test("lock retention uses the actual weak point for spread and both trick blasters use the live aim", () => {
  withFlight((G, _field, tick) => {
    const target = G.mk("target", G.P.x, G.P.y - 90, { offset: 250 });
    G.kinds.target = { aimAt: (_G, e) => ({ x: e.x, y: e.y - e.offset }) };
    G.foes.push(target);
    tick(3);
    // A slightly closer foe does not steal the current lock. Its selection bias
    // must never shrink the 340px sight distance or substitute its 90px body.
    G.foes.push(G.mk("target", G.P.x, G.P.y - 300, { offset: 0 }));
    tick();
    expect(G.P.lock).toBe(target);
    expect(G.P.aimSpread).toBeCloseTo(autoAimSpread(340, G.W, G.H, G.care.tune), 10);
    expect(Math.abs(G.P.aim + Math.PI / 2)).toBeGreaterThan(0.035);
    for (const weapon of ["ricochet", "boomerang"]) {
      G.loadout.weapon = weapon;
      G.P.shotT = 0;
      G.shots = [];
      tick();
      expect(G.shots.length).toBeGreaterThan(0);
      const shot = G.shots[0];
      if (weapon === "ricochet") {
        const angles = G.shots.map(s => Math.atan2(s.vy, s.vx));
        expect((angles[0] + angles[1]) / 2).toBeCloseTo(G.P.aim, 10);
      } else {
        expect(Math.atan2(shot.tipY - shot.originY, shot.tipX - shot.originX)).toBeCloseTo(G.P.aim, 10);
      }
    }
  });
});

test("manual twin-stick and a second aiming finger follow their coordinates at any range", () => {
  withFlight((G, field, tick) => {
    const touch = (type, id, x, y) => field.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerType: "touch", pointerId: id, button: 0, clientX: x, clientY: y,
    }));
    const target = G.mk("target", 160, 63);
    G.foes.push(target);
    for (const control of ["twin", "follow"]) {
      G.control = control;
      if (control === "twin") Object.assign(G.inp, { ax: 555, ay: 64, touch: false });
      else {
        touch("pointerdown", 1, G.P.x, G.P.y);
        touch("pointerdown", 2, 555, 64);
      }
      tick(12);
      expect(G.P.manual).toBe(true);
      expect(G.P.aimSpread).toBe(0);
      expect(G.P.aim).toBeCloseTo(Math.atan2(64 - G.P.y, 555 - G.P.x), 10);
    }
    touch("pointerup", 2, 555, 64);
    tick();
    expect(G.P.manual).toBe(false);
    expect(G.P.lock).toBe(target);
    expect(G.P.aimSpread).toBeGreaterThan(0.1);
  });
});
