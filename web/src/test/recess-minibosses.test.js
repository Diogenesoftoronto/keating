import { expect, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { Recess } from "../components/recess/engine/core.js";
import { chooseMiniboss, minibossRoster } from "../components/recess/engine/miniboss-roster.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";

const ids = Object.keys(minibossRoster);

// The requestAnimationFrame and canvas are the only platform doubles. Run combat, wave waits,
// quizzes, rewards and the returned result through the same entry points as the chat.
function flight(scene, play, { width = 320, height = 480, dockHeight = 50, calm = false } = {}) {
  const noop = () => {};
  const context = new Proxy({
    measureText: text => ({ width: text.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
  }, { get: (t, k) => t[k] ?? noop });
  const canvas = () => ({ width, height, hidden: false, getContext: () => context });
  let now = 0, frame, G, game, result;
  const platform = {
    document: { hidden: false, createElement: canvas }, window: new EventTarget(),
    performance: { now: () => now }, requestAnimationFrame: f => { frame = f; return 1; },
    cancelAnimationFrame: () => { frame = null; },
  };
  const arena = Object.assign(new EventTarget(), {
    querySelector: () => null, querySelectorAll: () => [], focus: noop, ownerDocument: platform.document,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  });
  const dock = { getBoundingClientRect: () => ({ left: 0, top: height - dockHeight, width, height: dockHeight }) };
  const original = Object.getOwnPropertyDescriptors(globalThis), script = RecessPatterns.script;
  const until = predicate => {
    for (let i = 0; i < 9000 && !predicate(); i++) { now += 20; frame?.(now); }
    expect(Boolean(predicate())).toBe(true);
  };
  const asks = [], scenes = [], notices = [];
  try {
    for (const [key, value] of Object.entries(platform)) Object.defineProperty(globalThis, key, { configurable: true, value });
    RecessPatterns.script = (world, marker) => { G = world; return script(world, marker); };
    game = Recess.create({ arena, thread: arena, dock, bot: dock, view: canvas(), shader: null,
      pack: packs.biology, calm, sheet: {}, rows: {}, toy: null, keycapBoots: false, hasJetpack: false, equipment: {},
      sound: RecessAudio.create(), theme: "paper", control: "follow", hud: noop,
      ask: q => asks.push({ q, at: G.T }), bossScene: beat => scenes.push(beat),
      minibossNotice: message => notices.push(message), end: value => { result = value; } });
    expect(game.start(scene)).toBe(true);
    play({ G, game, asks, scenes, notices, until, result: () => result });
  } finally {
    game?.dispose(); RecessPatterns.script = script;
    for (const key of Object.keys(platform)) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("each subject tours the three minibosses independently and practice preserves that tour", () => {
  const owner = {};
  for (const pack of Object.values(packs)) {
    const tour = Array.from({ length: 7 }, () => chooseMiniboss(pack, owner));
    expect(new Set(tour.slice(0, 3))).toEqual(new Set(ids));
    expect(tour.slice(0, 4)).toEqual(tour.slice(3));
  }
  const mathsChat = { id: "chat-23", cast: "maths" }, page = {};
  expect(chooseMiniboss(mathsChat, page, "clip")).toBe("clip");
  expect(chooseMiniboss(mathsChat, page)).toBe("pinwheel");
  expect(chooseMiniboss(packs.biology, page)).toBe("magnet");
  expect(chooseMiniboss(mathsChat, page)).toBe("magnet");
  expect(chooseMiniboss(mathsChat, {})).toBe("pinwheel");
});

test("right and wrong answers get the same breather, one miniboss and the next lesson question", () => {
  for (const correct of [true, false]) flight("start", ({ G, game, asks, scenes, until, result }) => {
    G.P.shotT = Infinity; G.P.inv = Infinity;
    const timeline = [];
    for (const event of ["gateStart", "gateResolve", "minibossSpawn", "minibossEnd", "bossSpawn"])
      G.on(event, () => timeline.push({ event, at: G.T }));
    until(() => G.gates);
    expect(G.miniboss).toBeNull();
    const gate = G.gates, selected = gate.a.findIndex(a => a.ok === correct);
    expect(game.answerGate(selected)).toBe(true);
    until(() => G.miniboss);
    expect(G.res.gates).toHaveLength(1); expect(G.res.gates[0].ok).toBe(correct);
    expect(G.miniboss.bossId).toBe("magnet"); expect(G.boss).toBeNull(); expect(G.gates).toBeNull();
    expect(asks.at(-1).q).toBeNull(); expect(G.T - asks.at(-1).at).toBeGreaterThanOrEqual(.72);
    expect(scenes.filter(Boolean)).toBeEmpty();
    until(() => G.gates);
    expect(G.gates.q).toBe(packs.biology.gates[1].q); expect(G.miniboss).toBeNull();
    expect(G.bul.some(b => b.miniOwner)).toBe(false);
    expect(timeline.map(e => e.event)).toEqual(["gateStart", "gateResolve", "minibossSpawn", "minibossEnd", "gateStart"]);
    if (!correct) return;
    until(() => G.boss);
    expect(scenes.filter(Boolean)).not.toBeEmpty(); expect(game.skipBossScene()).toBe(true);
    until(result);
    expect(result().won).toBe(true); expect(result().tldr).toBe(packs.biology.tldr);
    expect(result().minibosses).toBeUndefined();
    expect(timeline.filter(e => e.event === "minibossSpawn")).toHaveLength(1);
  }, { calm: true });
});

function quietPilot(G) {
  G.P.shotT = Infinity; G.P.bombs = 0; G.energy = 0; G.cellT = Infinity;
}

test("phone and desktop pilots get a complete harmless first warning, a real hit on its track, and a safe sidestep", () => {
  for (const id of ids) for (const dodge of [false, true]) {
    for (const size of [{ width: 320, height: 409, dockHeight: 59 }, { width: 390, height: 409, dockHeight: 59 }, { width: 760, height: 540, calm: true }]) {
      flight("mini/" + id, ({ G, asks, scenes, until }) => {
        quietPilot(G);
        let handoff, hitAt;
        G.on("minibossSpawn", ({ e, name }) => {
          handoff = { age: e.age, health: e.hp / e.max, name, phase: e.phase, at: G.T };
        });
        G.on("playerHit", () => { hitAt ??= G.T; });
        until(() => G.miniboss);
        const e = G.miniboss, origin = { x: G.P.x, y: G.P.y }, kind = G.kinds.mini;
        expect(handoff).toMatchObject({ age: 0, health: 1, name: minibossRoster[id].name, phase: "warn" });
        expect(G.P.hearts).toBe(4); expect(G.boss).toBeNull(); expect(asks).toBeEmpty(); expect(scenes).toBeEmpty();
        const firstWarning = e.duration;
        expect(firstWarning).toBeGreaterThanOrEqual(size.calm ? 1.99 : 1.77);
        expect(e.x - e.w / 2).toBeGreaterThanOrEqual(0); expect(e.x + e.w / 2).toBeLessThanOrEqual(G.W);
        const tracks = e.tracks.map(t => ({ ...t }));
        expect(tracks).toHaveLength(id === "clip" ? 1 : id === "pinwheel" ? 5 : 3);
        expect(kind.threat(G, e, origin.x, origin.y)).toBeGreaterThan(160);
        if (dodge) {
          if (id === "clip") G.inp.ty -= 52;
          else {
            const center = tracks[id === "pinwheel" ? 2 : 1], side = tracks[id === "pinwheel" ? 3 : 2];
            const angle = (center.angle + side.angle) / 2;
            const r = Math.hypot(origin.x - center.x0, origin.y - center.y0);
            G.inp.tx = G.clamp(center.x0 + r * Math.cos(angle), 16, G.W - 16);
            G.inp.ty = G.clamp(center.y0 + r * Math.sin(angle), 26, G.H - 22);
          }
          expect(kind.threat(G, e, G.inp.tx, G.inp.ty)).toBe(0);
        }
        until(() => e.phase === "strike");
        expect(e.tracks).toEqual(tracks); expect(G.P.hearts).toBe(4);
        if (id === "pinwheel") expect(G.bul.filter(b => b.miniOwner === e).map(b => b.ang)).toEqual(tracks.map(t => t.angle));
        if (id === "magnet") {
          const tokens = G.bul.filter(b => b.miniOwner === e);
          expect(tokens).toHaveLength(3);
          for (const b of tokens) {
            expect(Math.min(b.track.x1, G.W - b.track.x1, b.track.y1, e.playBottom - b.track.y1)).toBeCloseTo(17);
            expect(Math.hypot(b.track.x1 - origin.x, b.track.y1 - origin.y)).toBeGreaterThanOrEqual(40);
            expect(Math.hypot(b.x - b.track.x0, b.y - b.track.y0)).toBeLessThan(Math.hypot(b.track.x1 - b.track.x0, b.track.y1 - b.track.y0));
          }
        }
        until(() => e.cycle === 2);
        expect(firstWarning - e.duration).toBeCloseTo(.7);
        if (dodge) expect(hitAt).toBeUndefined();
        else { expect(G.P.hearts).toBe(3); expect(hitAt - handoff.at).toBeGreaterThanOrEqual(1); }
      }, size);
    }
  }
});

test("the Clip's painted name and its full gauge stay above an overlapping dock on small phones", () => {
  for (const width of [320, 390]) flight("mini/clip", ({ G, until }) => {
    quietPilot(G);
    const top = G.H - 74, labels = [], bars = [];
    G.on("play", () => { G.P.y = G.inp.ty = top - 5; });
    G.c.fillText = (name, x, y) => { if (name === "Margin Clip") labels.push({ x, y }); };
    G.c.strokeRect = (x, y, w, h) => { if (h === 4) bars.push({ x, y, w }); };
    until(() => labels.length);
    const e = G.miniboss, gauge = bars.find(b => Math.abs(b.w - e.w * .63) < .01);
    expect(e.playBottom).toBe(top);
    expect(gauge.y + 4).toBeLessThan(top - 5); expect(gauge.y).toBeLessThan(e.y);
    expect(labels[0].y).toBeLessThan(gauge.y); expect(labels[0].y).toBeGreaterThan(12);
    expect(gauge.x).toBeGreaterThanOrEqual(0); expect(gauge.x + gauge.w).toBeLessThanOrEqual(width);
    until(() => e.age > 1.7);
    const count = labels.length;
    until(() => labels.length > count); expect(e.phase).toBe("warn");
  }, { width, height: 409, dockHeight: 74 });
});

test("parked washers and both painted chevrons are visible at their true launch seats, including a pilot on the dock rail", () => {
  for (const width of [320, 390]) flight("mini/magnet", ({ G, until }) => {
    quietPilot(G);
    const top = G.H - 59, marks = [], washerCenters = [];
    let path = [];
    G.on("play", () => { G.P.y = G.inp.ty = top - 18; });
    G.c.beginPath = () => { path = []; };
    G.c.moveTo = (x, y) => path.push([{ x, y }]);
    G.c.lineTo = (x, y) => { path.at(-1)?.push({ x, y }); };
    G.c.stroke = () => { if (G.c.lineWidth === 2.5 && G.c.strokeStyle === G.pal.red) marks.push(...path); };
    G.c.arc = (x, y, r) => { if (r === 7) washerCenters.push({ x, y }); };
    until(() => G.miniboss && marks.length >= 6);
    const e = G.miniboss;
    expect(e.age).toBeLessThan(.1);
    for (const t of e.tracks) {
      expect(washerCenters.some(p => Math.hypot(p.x - t.x1, p.y - t.y1) < .01)).toBe(true);
      expect(t.y1 + 7).toBeLessThan(top); expect(Math.hypot(G.P.x - t.x1, G.P.y - t.y1)).toBeGreaterThanOrEqual(40);
      const length = Math.hypot(t.x0 - t.x1, t.y0 - t.y1);
      const ux = (t.x0 - t.x1) / length, uy = (t.y0 - t.y1) / length;
      for (const distance of [16, 27]) {
        const x = t.x1 + ux * distance, y = t.y1 + uy * distance;
        const arrow = marks.find(points => points.length === 3 && Math.hypot(points[1].x - x, points[1].y - y) < .01);
        expect(arrow).toBeDefined();
        for (const wing of [arrow[0], arrow[2]]) {
          expect((x - wing.x) * ux + (y - wing.y) * uy).toBeGreaterThan(5);
          expect(wing.y + 3).toBeLessThan(top);
        }
      }
    }
  }, { width, height: 409, dockHeight: 59 });
});

test("a short playfield keeps three separate washer seats when a pilot crowds its lower corners", () => {
  for (const width of [240, 320, 390]) flight("mini/magnet", ({ G, until }) => {
    quietPilot(G); G.P.inv = Infinity;
    G.on("play", () => { G.P.x = G.inp.tx = width * .48; G.P.y = G.inp.ty = 131; });
    until(() => G.miniboss);
    const e = G.miniboss;
    for (const [index, track] of e.tracks.entries()) {
      expect(track.x1).toBeWithin(16.99, width - 16.99);
      expect(track.y1).toBeWithin(16.99, e.playBottom - 16.99);
      expect(Math.hypot(G.P.x - track.x1, G.P.y - track.y1)).toBeGreaterThanOrEqual(40);
      for (const other of e.tracks.slice(index + 1)) {
        expect(Math.hypot(track.x1 - other.x1, track.y1 - other.y1)).toBeGreaterThanOrEqual(22);
      }
    }
  }, { width, height: 240, dockHeight: 74 });
});

test("three warnings and recoveries at zero charge earn only a small recharge and clear only this encounter's shots", () => {
  for (const id of ids) flight("mini/" + id, ({ G, game, notices, until, result }) => {
    quietPilot(G); G.P.inv = Infinity;
    let spawnAt; const warnings = [], attacks = [], ends = [], kills = [];
    G.on("telegraph", ({ e }) => { if (e.k === "mini") warnings.push(e.cycle); });
    G.on("attack", ({ e }) => { if (e.k === "mini") attacks.push(e.cycle); });
    G.on("minibossSpawn", () => { spawnAt = G.T; });
    G.on("minibossEnd", e => ends.push(e));
    G.on("kill", ({ e }) => kills.push(e));
    until(() => G.miniboss);
    const e = G.miniboss;
    expect(notices).toEqual([e.name + ". " + minibossRoster[id].cue]);
    const other = G.fire(28, 28, 0, 0, 0, { safe: true });
    until(() => e.phase === "recover" && e.cycle === 1); expect(e.hp).toBe(e.max * 2 / 3);
    until(() => e.phase === "recover" && e.cycle === 2); expect(e.hp).toBe(e.max / 3);
    until(() => !!ends.length);
    expect(warnings).toEqual([1, 2, 3]); expect(attacks).toEqual(warnings);
    expect(G.T - spawnAt).toBeWithin(8, 11);
    expect(ends[0]).toMatchObject({ name: e.name, defeated: false, charge: .03 }); expect(e.hp).toBeGreaterThan(0);
    expect(notices.slice(1)).toEqual([e.name + " withdrew. Charge +3%."]);
    expect(G.energy).toBeCloseTo(.03); expect(G.picks).toBeEmpty(); expect(kills).toBeEmpty(); expect(G.score).toBe(0);
    expect(G.bul).toEqual([other]); expect(G.res.minibosses).toBeUndefined();
    expect(G.tldr).toBeNull(); expect(G.boss).toBeNull(); expect(game.state).toBe("play");
    until(() => G.label === "Wave 2");
    game.stop(); until(result); expect(result().minibosses).toBeUndefined();
  }, { calm: true });
});

test("ordinary pulse hits and a bomb defeat each miniboss, award one real charge cell and report the name once", () => {
  for (const id of ids) flight("mini/" + id, ({ G, game, notices, until, result }) => {
    G.P.inv = Infinity; G.energy = .53;
    const hits = [], kills = [], ends = [], cells = [];
    G.on("foeHit", hit => { if (hit.e.k === "mini") hits.push(hit.d); });
    G.on("kill", ({ e }) => kills.push(e));
    G.on("minibossEnd", event => ends.push(event));
    G.on("pickup", event => { if (event.p.k === "e") cells.push(event.amount); });
    until(() => G.miniboss);
    const e = G.miniboss, before = e.hp;
    game.bomb(); expect(e.hp).toBe(before - 26);
    until(() => ends.length);
    expect(hits.some(d => d > 0 && d < 26)).toBe(true); expect(kills).toEqual([e]);
    expect(ends).toHaveLength(1); expect(ends[0]).toMatchObject({ name: e.name, defeated: true });
    expect(notices.slice(1)).toEqual([e.name + " defeated. A charge cell dropped."]);
    expect(G.kills).toBe(1); expect(G.picks.filter(p => p.k === "e")).toHaveLength(1);
    expect(G.res.minibosses).toEqual([e.name]); expect(G.tldr).toBeNull(); expect(game.state).toBe("play");
    G.kill(e); expect(ends).toHaveLength(1); expect(G.res.minibosses).toEqual([e.name]);
    until(() => cells.length); expect(cells).toEqual([.12]);
    game.stop(); until(result);
    expect(result().minibosses).toEqual([e.name]); expect(result().bossName).toBeUndefined();
    expect(result().won).toBe(false);
    expect(game.start("mini/" + id)).toBe(true); expect(G.res.minibosses).toBeUndefined();
  }, { calm: true });
});

test("timed Eurekas can finish on the first recovery and ordinary charged scatter gets a second attack to read", () => {
  const random = Math.random;
  try {
    for (const id of ids) for (const useBombs of [false, true]) {
      let seed = 41;
      Math.random = () => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      flight("mini/" + id, ({ G, game, until }) => {
        G.P.power = 3; G.loadout.weapon = "scatter";
        let attacks = 0, end;
        G.on("attack", ({ e }) => { if (e.k === "mini") attacks++; });
        G.on("minibossEnd", value => { end = value; });
        until(() => G.miniboss?.phase === "recover");
        if (useBombs) {
          game.bomb(); const first = G.T;
          until(() => end || G.T - first > .74);
          if (!end) game.bomb();
        }
        until(() => end);
        expect(end.defeated).toBe(true); expect(attacks).toBe(useBombs ? 1 : 2);
      }, { width: 390, height: 409 });
    }
  } finally { Math.random = random; }
});

test("retirement announces the actual recharge when the battery is almost full or full", () => {
  for (const energy of [.997, 1]) flight("mini/clip", ({ G, notices, until }) => {
    quietPilot(G); G.P.inv = Infinity; G.energy = energy;
    until(() => notices.length === 2);
    expect(G.energy).toBe(1);
    expect(notices[1]).toBe(energy === 1 ? "Margin Clip withdrew." : "Margin Clip withdrew. Charge +0.3%.");
  });
});

test("leaving during recall removes the washers and gives neither a defeat nor a survival reward", () => {
  flight("mini/magnet", ({ G, game, until, result }) => {
    quietPilot(G); const ends = [];
    G.on("minibossEnd", event => ends.push(event));
    until(() => G.bul.some(b => b.k === "miniWasher"));
    game.stop(); until(result);
    expect(G.miniboss).toBeNull(); expect(G.bul).toBeEmpty(); expect(ends).toBeEmpty();
    expect(result().minibosses).toBeUndefined(); expect(result().kills).toBe(0);
    expect(G.energy).toBe(0);
  });
});
