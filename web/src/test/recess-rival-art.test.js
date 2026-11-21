import { expect, mock, test } from "bun:test";
import { createBossScenes } from "../components/recess/engine/boss-scenes.js";
import { RecessArt } from "../components/recess/engine/foes.js";
import { studioBosses } from "../components/recess/engine/studio-bosses.js";

const palette = RecessArt.PAL.paper;
const rivalIds = ["compass", "cell", "metronome", "carbon", "projector"];
const miniIds = ["clip", "pinwheel", "magnet"];
const actorIds = [...rivalIds, ...miniIds];
const sheets = Object.fromEntries(actorIds.map(id => [id, { id, naturalWidth: 512, naturalHeight: 512 }]));
const toy = { poses: { wall: {}, "wall-fall": {} } };

function drawing() {
  const known = { globalAlpha: 1 };
  return new Proxy(known, {
    get(target, key) { return target[key] ??= mock(); },
  });
}

function actor(id, pose = 0) {
  return { k: miniIds.includes(id) ? "mini" : "rival", bossId: id, bossPose: pose, bossVariant: 0, x: 160, y: 90, ty: 90, w: 120, h: 120, hp: 50, max: 50 };
}

test("the actor paints the current pose from its own sheet, including the two world-space halves of Doublet", () => {
  const c = drawing();
  const env = { pal: palette, toy, T: 1, G: { o: { rivalSheets: sheets } } };
  for (const id of actorIds.filter(id => id !== "cell")) {
    for (let pose = 0; pose < 4; pose++) {
      RecessArt.drawFoe(c, actor(id, pose), env);
      expect(c.drawImage.mock.lastCall).toEqual([sheets[id], (pose % 2) * 256, Math.floor(pose / 2) * 256, 256, 256, -60, -60, 120, 120]);
    }
  }
  const cell = { ...actor("cell", 2), bossLobes: [{ x: 35, y: 110 }, { x: 240, y: 140 }] };
  c.drawImage.mockClear();
  RecessArt.drawFoe(c, cell, env);
  expect(c.drawImage.mock.calls).toEqual([
    [sheets.cell, 0, 256, 128, 256, 5, 50, 60, 120],
    [sheets.cell, 128, 256, 128, 256, 210, 80, 60, 120],
  ]);
});

test("ink and missing sheets paint the actor even when a previous cast has Wall sprites", () => {
  for (const [skin, art] of [[null, sheets], [toy, {}]]) {
    for (const id of actorIds) {
      const c = drawing();
      RecessArt.drawFoe(c, actor(id), { pal: palette, toy: skin, T: 1, G: { o: { rivalSheets: art } } });
      expect(c.drawImage).not.toHaveBeenCalled();
      expect(c.fill).toHaveBeenCalled();
      expect(c.stroke).toHaveBeenCalled();
      if (id === "cell") expect(c.bezierCurveTo).toHaveBeenCalled();
    }
  }
});

test("the Ink platen and lens line up with their recovery targets", () => {
  for (const [id, radius] of [["carbon", 6], ["projector", 12]]) {
    const y = studioBosses[id].jointY * 100;
    const c = drawing();
    RecessArt.drawFoe(c, actor(id, 3), { pal: palette, T: 1 });
    expect(c.arc.mock.calls.some(([x, cy, r]) => x === 0 && cy === y && r === radius)).toBe(true);
  }
});

test("Offbeat's painted bob points at the marked side through both warning and swing", () => {
  const env = { pal: palette, toy, T: 1, G: { o: { rivalSheets: sheets } } };
  for (const beatSide of [-1, 1]) {
    for (const pose of [1, 2]) {
      const c = drawing();
      RecessArt.drawFoe(c, { ...actor("metronome", pose), beatSide }, env);
      const mirrored = c.scale.mock.calls.some(([x]) => x === -1);
      const paintedFacing = pose === 1 ? -1 : 1;
      expect(mirrored ? -paintedFacing : paintedFacing).toBe(beatSide);
    }
  }
});

test("the Ink winding key opens around the right-hand recovery target after either beat", () => {
  for (const beatSide of [-1, 1]) {
    for (const pose of [1, 2, 3]) {
      const c = drawing();
      RecessArt.drawFoe(c, { ...actor("metronome", pose), beatSide }, { pal: palette, T: 1 });
      const loops = c.arc.mock.calls.filter(([x, , radius]) => x > 27 && radius < 4);
      if (pose !== 3) { expect(loops).toHaveLength(0); continue; }
      expect(loops).toHaveLength(2);
      expect(loops[0][1]).toBeLessThan(5.5);
      expect(loops[1][1]).toBeGreaterThan(5.5);
      expect(c.scale.mock.calls.some(([x]) => x < 0)).toBe(false);
    }
  }
});

test("a defeated rival shows the recovery pose from its own sheet", () => {
  const c = drawing(), hooks = new Map(), events = new Map();
  const G = {
    c, o: { rivalSheets: sheets }, toy, T: 5, calm: false, foes: [],
    on: (name, fn) => events.set(name, fn), hook: (name, fn) => hooks.set(name, fn),
  };
  RecessArt.install(G);
  for (const id of ["metronome", ...miniIds]) events.get("kill")({ e: actor(id, 2) });
  hooks.get("draw.back")({ G, pal: palette, toy, T: G.T });
  for (const id of ["metronome", ...miniIds]) {
    expect(c.drawImage.mock.calls).toContainEqual([sheets[id], 256, 256, 256, 256, -60, -60, 120, 120]);
  }
});

test("each rematch gets its own exchange and communicates the actor and fight variation to the presenter", () => {
  const names = new Set();
  for (const id of rivalIds) {
    const lines = new Set();
    for (const variant of [0, 1]) {
      const beats = [];
      const G = { o: { arena: {}, bossScene: beat => beats.push(beat) }, pack: { id: "test" }, P: { inv: 0 }, W: 390, state: "play", calm: true, resetFlightInput() {} };
      const scene = createBossScenes(G), e = { ...actor(id), bossVariant: variant };
      expect(scene.open(e)).toBe(true);
      expect(e.bossPose).toBe(0);
      expect(scene.advance()).toBe(true);
      expect(e.bossPose).toBeGreaterThan(0);
      expect(beats[1].portraitPose).toBe(e.bossPose);
      expect(scene.advance()).toBe(true);
      expect(e.bossPose).toBe(0);
      expect(beats[2]).toBeNull();
      const [first, second] = beats;
      expect(first.bossId).toBe(id);
      expect(first.bossVariant).toBe(variant);
      expect(first.variantName).toBeTruthy();
      expect(first.speaker).not.toBe(second.speaker);
      names.add(first.bossName);
      lines.add(first.text); lines.add(second.text);
      expect(e.x).toBe(G.W / 2);
      expect(e.y).toBe(e.ty);
      expect(e.rot).toBeCloseTo(0);
    }
    expect(lines.size).toBe(4);
  }
  expect([...names]).toEqual(["The Anglewright", "Doublet", "Offbeat", "Carbon Copy", "Limelight"]);
});
