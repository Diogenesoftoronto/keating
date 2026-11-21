import { expect, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { fireWeapon } from "../components/recess/engine/arsenal.js";
import { installRivals, makeRival } from "../components/recess/engine/boss-encounters.js";
import { bossRoster, chooseBossEncounter } from "../components/recess/engine/boss-roster.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";

test("each subject tours all six opponents without repeats and remixes them on its next visit", () => {
  const page = {};
  for (const pack of Object.values(packs)) {
    const visits = Array.from({ length: 12 }, () => chooseBossEncounter(pack, page));
    expect(visits[0].id).not.toBe("wall");
    expect(new Set(visits.slice(0, 6).map(v => v.id))).toEqual(new Set(Object.keys(bossRoster)));
    expect(visits.slice(1).every((v, i) => v.id !== visits[i].id)).toBe(true);
    for (let i = 0; i < 6; i++) {
      expect(visits[i].variant).toBe(0);
      expect(visits[i + 6]).toEqual({ id: visits[i].id, variant: visits[i].id === "wall" ? 0 : 1 });
    }
  }
  const owner = {}, physical = { id: "chat-12", cast: "maths" };
  chooseBossEncounter(physical, owner, { id: "cell", variant: 1 });
  expect(chooseBossEncounter(physical, owner)).toEqual({ id: "compass", variant: 0 });
  expect(chooseBossEncounter(packs.biology, owner)).toEqual({ id: "cell", variant: 0 });
  expect(chooseBossEncounter(packs.music, owner)).toEqual({ id: "metronome", variant: 0 });
  expect(chooseBossEncounter(packs.maths, {})).toEqual({ id: "compass", variant: 0 });
  for (const cast of ["history", "law", "literature"]) expect(chooseBossEncounter({ id: "chat", cast }, owner).id).toBe("carbon");
  for (const cast of ["coding", "chemistry", "finance"]) expect(chooseBossEncounter({ id: "chat", cast }, owner).id).toBe("projector");
  const personal = { ...physical, boss: { name: "The Last Decimal", taunts: { intro: "You missed a place." } } };
  const other = { ...physical, id: "chat-24", boss: { name: "The Missing Variable" } };
  expect(chooseBossEncounter(personal, owner).id).toBe("wall");
  expect(chooseBossEncounter(other, owner).id).toBe("wall");
  expect(Array.from({ length: 3 }, () => chooseBossEncounter(personal, owner).id))
    .toEqual(["compass", "metronome", "cell"]);
  expect(chooseBossEncounter(other, owner).id).toBe("compass");
});

// Real encounter code with time, the pilot and telemetry controlled at the flight-engine boundary.
function arena(id, variant = 0, { width = 320, height = 480, calm = false, playerX = width * .34 } = {}) {
  const bullets = [], events = [], picks = [], hooks = {};
  let hits = 0;
  const G = {
    W: width, H: height, floorY: height - 45, calm, state: "play", pack: packs.biology, kinds: {},
    P: { x: playerX, y: height * .62 }, fx: {}, hook(name, callback) { hooks[name] = callback; }, knock() {},
    emit(name) { events.push(name); }, hitPlayer() { ++hits; },
    addPick(k, x, y, mag) { picks.push({ k, x, y, mag }); },
    cancelBullets() { bullets.length = 0; },
    fire(x, y, angle, speed, kind) { bullets.push({ x, y, angle, speed, kind }); },
    mk(k, x, y, attrs) { return { ...attrs, k, x, y, max: attrs.hp, dead: 0 }; },
    hurtFoe(e, damage) {
      e.hp -= damage;
      if (e.hp <= 0 && !e.dead) { e.dead = 1; G.kinds[e.k].death(G, e); }
    },
  };
  installRivals(G);
  const e = G.boss = makeRival(G, { id, variant }), kind = G.kinds.rival;
  e.y = e.ty; // the real cutscene hands the actor off here
  const tick = () => kind.update(G, e, 1 / 60);
  const until = predicate => {
    for (let i = 0; i < 3600 && !predicate(); i++) tick();
    expect(predicate()).toBe(true);
  };
  tick();
  return { G, e, kind, tick, until, bullets, events, picks, hooks, hits: () => hits };
}

test("every rival shows its first warning at age zero and grants the extra reading time only once", () => {
  const seconds = { compass: 1.15, cell: 1.2, metronome: 1.1, carbon: 2.2, projector: 1.65 };
  for (const [id, base] of Object.entries(seconds)) for (const calm of [false, true]) {
    const { e, until } = arena(id, 1, { calm });
    expect(e.phase).toBe("warn"); expect(e.age).toBe(0);
    expect(e.duration).toBeCloseTo(base + .7 + (calm ? .25 : 0));
    if (id === "projector") {
      until(() => e.phase === "warn" && e.beat === 1);
      expect(e.duration).toBeCloseTo(1.45 + (calm ? .25 : 0));
    }
    until(() => e.round === 1);
    expect(e.age).toBe(0); expect(e.duration).toBeCloseTo(base + (calm ? .25 : 0));
  }
});

test("the compass inks the promised annulus with safe inside and outside, then changes radius or replants", () => {
  for (const variant of [0, 1]) {
    const { G, e, kind, until, tick, hits } = arena("compass", variant);
    const first = { ...e.pivot }, r = e.radius;
    G.P.x = first.x; G.P.y = first.y + r;
    expect(e.duration).toBeGreaterThanOrEqual(.9);
    expect(kind.threat(G, e, G.P.x, G.P.y)).toBeGreaterThan(kind.threat(G, e, first.x, first.y));
    until(() => e.phase === "strike");
    expect(hits()).toBe(0);
    tick(); expect(hits()).toBe(1);
    G.P.y -= 16; tick(); G.P.y += 32; tick();
    expect(hits()).toBe(1);
    until(() => e.index === 2);
    expect(e.phase).toBe("warn");
    if (variant === 0) { expect(e.pivot).toEqual(first); expect(e.radius).toBeGreaterThan(r); }
    else { expect(e.pivot.x).not.toBe(first.x); expect(e.radius).toBe(r); }
  }
});

test("Budding and Fission lock a real pair of landing pads, leave a mobile seam, and fire outward only", () => {
  for (const variant of [0, 1]) {
    const { G, e, kind, until, bullets } = arena("cell", variant);
    const lock = e.targetX;
    G.P.x = G.W - 24; G.P.y = G.floorY;
    until(() => e.phase === "strike" && e.age >= .38);
    expect(e.targetX).toBe(lock);
    const [a, b] = e.bossLobes;
    expect(Math.abs(a.y - b.y) > 14).toBe(variant === 0);
    until(() => Boolean(kind.hit(G, e, lock, e.targetY, kind.body)));
    expect(kind.hit(G, e, G.W - 12, e.targetY, kind.body)).toBeNull();
    until(() => e.phase === "strike" && e.shed);
    const [left, right] = e.bossLobes;
    expect(right.x - left.x - e.w * .50).toBeGreaterThanOrEqual(118);
    expect(kind.hit(G, e, e.seamX, left.y, kind.body)).toBeNull();
    expect(kind.hit(G, e, left.x, left.y, kind.body)).toBe(left);
    expect(kind.hit(G, e, right.x, right.y, 3)).toBe(right);
    expect(bullets).toHaveLength(6);
    for (const shot of bullets) expect(Math.sign(Math.cos(shot.angle))).toBe(Math.sign(shot.x - e.seamX));
    expect(kind.aimAt(G, e, left.x)).toBe(left);
    expect(kind.aimAt(G, e, right.x)).toBe(right);
  }
});

test("Offbeat's marked columns are the fired notes; Backbeat holds in silence and repeats the locked side", () => {
  for (const variant of [0, 1]) {
    const { G, e, kind, until, bullets } = arena("metronome", variant);
    const firstSide = e.beatSide;
    const xs = [...e.beatXs];
    expect(xs).toContain(G.P.x);
    G.P.x += 8;
    expect(kind.threat(G, e, xs[1], G.floorY)).toBeGreaterThan(0);
    expect(kind.threat(G, e, G.W - 15, G.floorY)).toBe(0);
    until(() => e.phase === "strike");
    expect(bullets.map(b => b.x)).toEqual(xs);
    if (variant) {
      until(() => e.phase === "rest");
      expect(e.bossPose).toBe(0);
      expect(kind.threat(G, e, xs[1], G.floorY)).toBe(0);
      until(() => e.phase === "warn");
      expect(bullets.map(b => b.x)).toEqual(xs);
    } else until(() => e.phase === "warn");
    expect(e.beatSide).toBe(variant ? firstSide : -firstSide);
    const second = [...e.beatXs];
    until(() => e.phase === "strike");
    expect(bullets.map(b => b.x)).toEqual([...xs, ...second]);
  }
});

test("Doublet keeps each penned landing pad visible until the lobes leave it, then clears the seam", () => {
  for (const variant of [0, 1]) {
    const { G, e, kind, tick, until, hooks } = arena("cell", variant, { width: 390, height: 409, playerX: 195 });
    const ellipses = [];
    G.c = new Proxy({ ellipse(x, y, rx, ry) { ellipses.push({ x, y, rx, ry, color: this.strokeStyle }); } },
      { get: (t, key) => t[key] ?? (() => {}) });
    function padCenters() {
      ellipses.length = 0;
      hooks["draw.over"]({ pal: { red: "red" } });
      return ellipses.filter(p => p.y === e.targetY && p.rx === e.w * .22 && p.color === "red").map(p => p.x);
    }
    const pads = padCenters();
    expect(pads).toHaveLength(2);
    until(() => e.phase === "strike");
    const clearedAt = new Map();
    while (e.phase === "strike") {
      const marked = padCenters();
      for (const x of pads) {
        if (e.age < .5 || kind.hit(G, e, x, e.targetY, kind.body)) expect(marked).toContain(x);
        if (!marked.includes(x) && !clearedAt.has(x)) clearedAt.set(x, e.age);
        if (clearedAt.has(x)) expect(marked).not.toContain(x);
      }
      tick();
    }
    expect(clearedAt.size).toBe(2);
    expect(padCenters()).toHaveLength(0);
    const [a, b] = [...clearedAt.values()];
    if (variant === 0) expect(b - a).toBeGreaterThan(.05);
    else expect(a).toBeCloseTo(b);
  }
});

test("Offbeat marks the exact center and the adjacent two pixels on the first beat of either pattern", () => {
  for (const variant of [0, 1]) for (const x of [194, 195, 196]) {
    const { G, e, kind, until, bullets } = arena("metronome", variant, { width: 390, height: 409, playerX: x });
    const side = x < 195 ? -1 : 1, safe = 195 - side * 40;
    expect(e.beatSide).toBe(side);
    expect(e.beatXs).toContain(x);
    expect(e.beatXs.every(column => side * (column - 195) >= 0)).toBe(true);
    const nearGap = x + side * 16, deepGap = x + side * 48;
    expect(kind.threat(G, e, deepGap, G.P.y)).toBeGreaterThan(kind.threat(G, e, nearGap, G.P.y));
    expect(kind.threat(G, e, nearGap, G.P.y)).toBeGreaterThan(kind.threat(G, e, safe, G.P.y));
    until(() => e.phase === "strike");
    expect(bullets.some(b => b.x === x && b.angle === Math.PI / 2 && b.y < G.P.y)).toBe(true);
    expect(bullets.every(b => Math.abs(b.x - safe) >= 40)).toBe(true);
  }
});

test("Carbon samples three distinct positions, shows their release order and strikes only the active footprint", () => {
  for (const variant of [0, 1]) {
    const { G, e, kind, until, tick, hooks, hits } = arena("carbon", variant);
    const points = [{ ...G.P }, { x: 198, y: 354 }, { x: 256, y: 246 }];
    points.slice(1).forEach((point, i) => {
      Object.assign(G.P, point);
      until(() => e.proof.marks.length === i + 2);
    });
    expect(e.proof.marks.map(({ x, y }) => ({ x, y }))).toEqual(points);
    expect(e.duration - e.age).toBeGreaterThan(1);
    const release = variant === 1 ? [2, 1, 0] : [0, 1, 2];
    const numbers = [];
    G.c = new Proxy({ fillText(label, x, y) { numbers.push({ label, x, y }); } }, { get: (t, k) => t[k] ?? (() => {}) });
    for (const [beat, index] of release.entries()) {
      const point = points[index];
      hooks["draw.over"]({ pal: {} });
      const strip = numbers.splice(-3);
      expect(strip.map(n => n.label)).toEqual(release.map(i => String(i + 1)));
      expect(numbers.some(n => n.label === String(index + 1) &&
        Math.abs(n.x - point.x) < e.proof.halfW && Math.abs(n.y - point.y) < e.proof.halfH)).toBe(true);
      numbers.length = 0;
      expect(kind.threat(G, e, point.x, point.y)).toBeGreaterThan(kind.threat(G, e, 25, 100));
      until(() => e.phase === "strike" && e.beat === beat);
      Object.assign(G.P, points[(index + 1) % 3]);
      let before = hits();
      tick(); expect(hits()).toBe(before);
      Object.assign(G.P, point);
      tick(); expect(hits()).toBe(++before);
      G.P.x += e.proof.halfW + 4;
      tick(); expect(hits()).toBe(before);
      until(() => e.phase !== "strike");
    }
    expect(e.phase).toBe("recover");
  }
});

test("overlapping Carbon samples keep a registration dot on the pilot and visibly fan into three targets", () => {
  for (const playerX of [16, 160, 304]) for (const variant of [0, 1]) {
    const { G, e, until } = arena("carbon", variant, { playerX, calm: true });
    until(() => e.proof.marks.length === 3);
    const { halfW, halfH, marks } = e.proof;
    expect(marks[0]).toMatchObject(G.P);
    for (const [i, mark] of marks.entries()) {
      expect(mark.sample).toEqual(G.P);
      expect(marks.slice(0, i).every(other =>
        Math.abs(mark.x - other.x) >= 2 * halfW || Math.abs(mark.y - other.y) >= 2 * halfH)).toBe(true);
    }
  }
});

test("Limelight shelters only behind the physical slide, with pinned light and room to move on phone and desktop", () => {
  for (const width of [320, 390, 900]) for (const playerX of [16, width / 2, width - 16]) {
    for (const calm of [false, true]) for (const variant of [0, 1]) {
      const { G, e, kind, tick, until, hits } = arena("projector", variant, { width, playerX, calm });
      const first = { ...e.beam };
      expect(first.slideY).toBeGreaterThan(first.lensY);
      expect(first.row).toBeGreaterThan(first.slideY);
      expect(kind.hit(G, e, first.slideX, first.slideY, 4)).toBeNull();
      let firstCenter;
      for (let beat = 0; beat <= variant; beat++) {
        const pinned = { ...e.beam }, { lensX, lensY, slideX, slideY, slideHalf, row } = pinned;
        const scale = (row - lensY) / (slideY - lensY);
        const center = lensX + (slideX - lensX) * scale, half = slideHalf * scale;
        expect(half * 2).toBeGreaterThanOrEqual(118);
        expect(center).toBeGreaterThan(15); expect(center).toBeLessThan(width - 15);
        expect(e.x).toBe(lensX);
        const caption = { ...e.cover };
        expect(caption.scale).toBe(1);
        for (const dx of [-25, 25]) for (const dy of [-9, 9]) {
          const x = caption.x + dx, y = caption.y + dy;
          const ratio = (y - lensY) / (slideY - lensY);
          expect(y).toBeGreaterThan(slideY);
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(width);
          expect(Math.abs(x - (lensX + (slideX - lensX) * ratio))).toBeLessThanOrEqual(slideHalf * ratio + .001);
        }
        expect(e.duration).toBeGreaterThanOrEqual(beat ? 1.45 : 1.65);
        if (beat === 0) firstCenter = center;
        else {
          expect(slideX).toBe(first.slideX); expect(slideY).toBe(first.slideY);
          expect(lensX).not.toBe(first.lensX); expect(Math.abs(center - firstCenter)).toBeGreaterThan(half);
        }
        expect(kind.threat(G, e, G.P.x, G.P.y)).toBeGreaterThan(kind.threat(G, e, center, row));
        G.P.x = center; G.P.y = row;
        const before = hits();
        until(() => e.phase === "strike" && e.beat === beat);
        expect(e.beam).toEqual(pinned);
        expect(e.cover).toEqual(caption);
        tick(); expect(hits()).toBe(before);
        const towardMiddle = center < width / 2 ? 1 : -1;
        G.P.x = center + towardMiddle * (half - 1); tick(); expect(hits()).toBe(before);
        G.P.x = center + towardMiddle * (half + 1); tick(); expect(hits()).toBe(before + 1);
        G.P.x = slideX; G.P.y = slideY - 1; tick(); expect(hits()).toBe(before + 2);
        G.P.x = center; G.P.y = row;
        until(() => e.phase !== "strike");
      }
      expect(e.phase).toBe("recover");
    }
  }
});

test("Limelight keeps COVER and the stationary warning stripes in the same places when it fires", () => {
  const { G, e, hooks, until } = arena("projector", 1, { width: 320, height: 409 });
  let path, marks, caption, transform;
  G.c = new Proxy({
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); },
    stroke() { if (this.strokeStyle === "danger" && this.lineWidth === 1.7) marks = path; },
    translate(x, y) { transform = { x, y }; }, fillText(label) { if (label === "COVER") caption = transform; },
  }, { get: (t, k) => t[k] ?? (() => {}) });
  const paint = () => {
    marks = caption = null;
    hooks["draw.over"]({ pal: { red: "danger" } });
    expect(caption).toEqual({ x: e.cover.x, y: e.cover.y });
    expect(marks.length).toBeGreaterThan(0);
    for (const { x, y } of marks) {
      const b = e.beam, scale = (y - b.lensY) / (b.slideY - b.lensY);
      expect(Math.abs(x - (b.lensX + (b.slideX - b.lensX) * scale))).toBeGreaterThan(b.slideHalf * scale);
    }
    return { caption, marks };
  };
  for (let beat = 0; beat < 2; beat++) {
    const warning = paint();
    until(() => e.phase === "strike");
    expect(paint()).toEqual(warning);
    until(() => e.phase !== "strike");
  }
});

test("all ten rival patterns reward their recovery, respond to bombs and resolve for a pilot with empty charge", () => {
  for (const id of ["compass", "cell", "metronome", "carbon", "projector"]) for (const variant of [0, 1]) {
    const { G, e, kind, until, events } = arena(id, variant, { calm: true });
    expect(e.bossPose).toBe(1); expect(e.duration).toBeGreaterThan(1.1);
    const hit = () => {
      const p = kind.aimAt(G, e, G.P.x), part = kind.hit(G, e, p.x, p.y, 4);
      expect(part).toBeTruthy();
      kind.hitPart(G, e, part, 2, p.x, p.y);
    };
    const start = e.hp; hit(); expect(e.hp).toBeCloseTo(start - 1.3);
    until(() => e.phase === "recover");
    expect(e.bossPose).toBe(3); expect(e.duration).toBeGreaterThanOrEqual(2);
    const before = e.hp; hit(); expect(e.hp).toBe(before - 6);
    until(() => e.round === 1);
    const bombHP = e.hp; kind.bombed(G, e);
    expect(e.phase).toBe("recover"); expect(e.hp).toBe(bombHP - 30);
    until(() => e.dead === 1);
    expect(e.round).toBe(4); expect(G.boss).toBeNull(); expect(G.tldr).toBeTruthy();
    expect(events.filter(n => n === "bossDeath")).toHaveLength(1);
  }
});

test("a clean print or projection cycle spills three charge sparks and exposes damage before the next shot", () => {
  for (const id of ["carbon", "projector"]) for (const variant of [0, 1]) {
    const clean = arena(id, variant);
    const { G, e, until, picks } = clean;
    if (id === "carbon") {
      until(() => e.proof.marks.length === 3);
      G.P.x = 24; G.P.y = 128;
    } else {
      for (let beat = 0; beat <= variant; beat++) {
        G.P.x = 2 * e.beam.slideX - e.beam.lensX; G.P.y = e.beam.row;
        until(() => e.phase === "strike");
        until(() => e.phase !== "strike");
      }
    }
    until(() => e.phase === "recover");
    expect(clean.hits()).toBe(0);
    expect(e.hp).toBeCloseTo(e.max * .88);
    expect(picks).toHaveLength(3);
    expect(picks.every(p => p.k === "s" && p.mag)).toBe(true);
    const parked = arena(id, variant);
    parked.until(() => parked.e.phase === "recover");
    expect(parked.hits()).toBeGreaterThan(0);
    expect(parked.e.hp).toBe(parked.e.max); expect(parked.picks).toHaveLength(0);
    const interrupted = arena(id, variant);
    interrupted.kind.bombed(interrupted.G, interrupted.e);
    expect(interrupted.e.hp).toBe(interrupted.e.max - 30);
    expect(interrupted.picks).toHaveLength(0);
  }
});

function withFlight(id, variant, play) {
  const noop = () => {};
  const c = new Proxy({ measureText: s => ({ width: s.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }) }, { get: (t, k) => t[k] ?? noop });
  const canvas = () => ({ getContext: () => c, hidden: false, width: 320, height: 480 });
  let now = 0, frame, G, game, result;
  const platform = {
    document: { hidden: false, createElement: canvas }, window: new EventTarget(),
    performance: { now: () => now }, requestAnimationFrame: f => { frame = f; return 1; },
    cancelAnimationFrame: () => { frame = null; },
  };
  const field = Object.assign(new EventTarget(), { querySelector: () => null, querySelectorAll: () => [], focus: noop,
    ownerDocument: platform.document, getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 480 }) });
  const dock = { getBoundingClientRect: () => ({ left: 0, top: 430, width: 320, height: 50 }) };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const script = RecessPatterns.script;
  const until = predicate => {
    for (let i = 0; i < 3000 && !predicate(); i++) { now += 20; frame?.(now); }
    expect(Boolean(predicate())).toBe(true);
  };
  try {
    for (const [key, value] of Object.entries(platform)) Object.defineProperty(globalThis, key, { configurable: true, value });
    RecessPatterns.script = (world, scene) => { G = world; return script(world, scene); };
    const captions = [], requests = [];
    game = Recess.create({ arena: field, thread: field, dock, bot: dock, view: canvas(), shader: null,
      pack: packs.biology, calm: true, sheet: {}, rows: {}, toy: null, keycapBoots: false, hasJetpack: false, equipment: {},
      sound: RecessAudio.create(), theme: "paper", control: "follow", bossEncounter: { id, variant },
      hud: noop, ask: q => requests.push(q), bossScene: b => captions.push(b), end: value => { result = value; } });
    game.start("boss");
    until(() => game.state === "cutscene");
    play({ G, game, until, advance() { now += 20; frame(now); }, result: () => result, requests, captions });
  } finally {
    game?.dispose(); RecessPatterns.script = script;
    for (const key of Object.keys(platform)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("the authored wave marker brings a selected rival through the real player, combat, and lesson recap", () => {
  withFlight("cell", 1, ({ G, game, until, advance, result, requests, captions }) => {
    expect(G.boss.bossId).toBe("cell"); expect(G.boss.bossVariant).toBe(1); expect(G.label).toBe("Doublet");
    const hint = G.boss, before = hint.hp;
    for (let i = 0; i < 250; i++) advance();
    expect(hint.hp).toBe(before); expect(hint.stage).toBe(-1);
    expect(game.skipBossScene()).toBe(true);
    G.P.shotT = Infinity; G.P.power = 1; G.P.inv = Infinity; G.energy = 0;
    until(result);
    expect(result().won).toBe(true); expect(result().tldr).toBe(packs.biology.tldr);
    expect(result().bossName).toBe("Doublet");
    expect(G.boss).toBeNull(); expect(captions.at(-1)).toBeNull();
    expect(requests.filter(Boolean)).toHaveLength(0);
  });
});

test("a real pulse hitting the outer shell registers the recovery joint when its path crosses the sights", () => {
  for (const id of ["compass", "metronome", "carbon", "projector"]) {
    withFlight(id, 0, ({ G, game, until }) => {
      const boss = G.boss;
      game.skipBossScene(); G.P.shotT = Infinity; G.P.power = 1; G.P.inv = Infinity; G.energy = 0;
      until(() => boss.phase === "recover");
      const marked = G.aimPoint(boss);
      if (id === "metronome") {
        expect(marked.x).toBeCloseTo(boss.x + boss.w * .27);
        expect(marked.y).toBeCloseTo(boss.y + boss.h * .055);
      } else if (id === "carbon" || id === "projector") {
        expect(marked.x).toBe(boss.x);
        expect(marked.y).toBeCloseTo(boss.y + boss.h * (id === "carbon" ? .025 : .08));
      }
      const hits = [];
      G.on("foeHit", h => { if (h.e === boss) hits.push(h); });
      function pulse(x) {
        G.P.x = G.inp.tx = x; G.P.y = G.inp.ty = marked.y + 160;
        G.P.aim = -Math.PI / 2; G.P.focus = false;
        const count = hits.length;
        fireWeapon(G, "pulse", 1, () => {}, { cost: .002 });
        until(() => hits.length > count);
        return hits.at(-1);
      }
      const straight = pulse(marked.x);
      if (id === "compass") expect(Math.hypot(straight.x - marked.x, straight.y - marked.y)).toBeGreaterThan(boss.w * .24);
      expect(straight.d).toBe(3); expect(straight.critical).toBe(true);
      if (id === "metronome") {
        const outerKey = pulse(marked.x + boss.w * .16);
        expect(outerKey.x).toBeGreaterThan(boss.x + boss.w * .34 + 5);
        expect(outerKey.critical).toBe(true);
      }
      const grazing = pulse(boss.x - boss.w * .31);
      expect(grazing.d).toBe(1); expect(grazing.critical).toBe(false);
    });
  }
});
