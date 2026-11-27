import { expect, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";

test("the authored practice lessons have playable gates and correctable misconceptions", () => {
  expect(Object.keys(packs)).toContain("maths");
  expect(Object.keys(packs)).not.toContain("nemesis");
  for (const [key, pack] of Object.entries(packs)) {
    expect(pack.id).toBe(key);
    expect(pack.drift.length).toBeGreaterThan(0);
    expect(pack.split).toHaveLength(3);
    expect(pack.wall.length).toBeGreaterThan(0);
    expect(pack.myths.length).toBeGreaterThan(1);
    expect(pack.gates.length).toBeGreaterThan(1);
    for (const question of [...pack.gates, ...(pack.revive ?? [])]) {
      expect(question.q.trim()).not.toBe("");
      expect(question.a).toHaveLength(3);
      expect(new Set(question.a).size).toBe(3);
    }
  }
});

test("Recess starts muted and repeated disposal is safe", () => {
  const audio = RecessAudio.create();
  expect(audio.on).toBe(false);
  audio.dispose();
  audio.dispose();
  expect(audio.on).toBe(false);
});

class Playfield extends EventTarget {
  getBoundingClientRect() { return { left: 0, top: 0, width: 420, height: 330 }; }
  querySelectorAll() { return []; }
  focus() {}
}

test("flight owns only arena keys and disposal removes its frame and handlers", () => {
  let scheduled = 0;
  const cancelled: number[] = [];
  const rect = new Playfield();
  const canvas = () => ({
    width: 300, height: 150, hidden: false, getContext: () => ({}),
  });
  const mocks = {
    window: new EventTarget(),
    document: { createElement: canvas },
    requestAnimationFrame: () => ++scheduled,
    cancelAnimationFrame: (id: number) => cancelled.push(id),
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(mocks)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  try {
    const field = rect as unknown as HTMLElement;
    const game = Recess.create({
      arena: field, thread: field, dock: field, bot: field,
      view: canvas() as unknown as HTMLCanvasElement, shader: null, sound: RecessAudio.create(),
      pack: packs.maths, theme: "paper", control: "follow", calm: true,
      sheet: {} as HTMLImageElement, rows: {}, hasJetpack: true, flip: null, toy: null,
      equipment: {}, keycapBoots: false,
      hud() {}, ask() {}, phase() {}, revive() {}, end() {},
    });
    const escape = () => Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    expect(game.start("start")).toBe(true);
    expect(game.start("start")).toBe(false);
    expect(mocks.window.dispatchEvent(escape())).toBe(true);
    expect(game.state).toBe("intro");
    expect(rect.dispatchEvent(escape())).toBe(false);
    expect(game.state).toBe("outro");
    game.dispose();
    expect(cancelled).toEqual([1]);
    expect(rect.dispatchEvent(escape())).toBe(true);
    expect(game.start("start")).toBe(false);
  } finally {
    for (const name of Object.keys(mocks)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

type RunState = {
  state: string;
  control: string;
  energy: number;
  chargeTier(): number;
  refill(amount: number): void;
  care: { charge: number };
  P: { x: number; y: number; bombs: number };
  inp: { pid: number | null; aid: number | null; ax: number; ay: number; tx: number; ty: number };
};

type Run = ReturnType<typeof Recess.create>;
function touchRun(control: "follow" | "twin", body: (run: RunState, field: Playfield, win: EventTarget, game: Run) => void, charge = 0.75,
  overrides: Partial<Parameters<typeof Recess.create>[0]> = {}) {
  const rect = new Playfield();
  const canvas = () => ({ width: 300, height: 150, hidden: false, getContext: () => ({}) });
  const mocks = {
    window: new EventTarget(),
    document: { createElement: canvas },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(mocks)) Object.defineProperty(globalThis, name, { configurable: true, value });
  const script = RecessPatterns.script;
  let run: RunState | null = null;
  RecessPatterns.script = (G: RunState, scene: string) => { run = G; return script(G, scene); };
  try {
    const field = rect as unknown as HTMLElement;
    const game = Recess.create({
      arena: field, thread: field, dock: field, bot: field,
      view: canvas() as unknown as HTMLCanvasElement, shader: null, sound: RecessAudio.create(),
      pack: packs.maths, theme: "paper", control, calm: true,
      sheet: {} as HTMLImageElement, rows: {}, hasJetpack: true, flip: null, toy: null,
      equipment: {}, keycapBoots: false,
      hud() {}, ask() {}, phase() {}, revive() {}, end() {},
      ...overrides,
    });
    game.setCondition({ charge, tune: 0.75, shine: 0.75 });
    expect(game.start("start")).toBe(true);
    expect(run).not.toBeNull();
    body(run!, rect, mocks.window, game);
    game.dispose();
  } finally {
    RecessPatterns.script = script;
    for (const name of Object.keys(mocks)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

const touch = (type: string, pointerId: number, clientX = 0, clientY = 0) =>
  Object.assign(new Event(type, { cancelable: true }), { pointerId, pointerType: "touch", button: 0, clientX, clientY });

test("a dock button keeps its pointer and Space activation inside the flight arena", () => {
  touchRun("follow", (run, field) => {
    run.state = "play";
    const button = { closest: () => true };
    const press = touch("pointerdown", 2, 250, 270);
    Object.defineProperty(press, "target", { value: button });
    field.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    expect(run.inp.pid).toBeNull();

    const reserve = run.P.bombs;
    const space = Object.assign(new Event("keydown", { cancelable: true }), { key: " " });
    Object.defineProperty(space, "target", { value: button });
    field.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(run.P.bombs).toBe(reserve);
  });
});

test("on touch the first finger flies, a second aims, and either can lift alone", () => {
  touchRun("follow", (run, field, win) => {
    const bombs = run.P.bombs;
    field.dispatchEvent(touch("pointerdown", 1, 200, 250));
    field.dispatchEvent(touch("pointerdown", 2, 300, 60));
    expect([run.inp.pid, run.inp.aid, run.inp.ax, run.inp.ay]).toEqual([1, 2, 300, 60]);
    field.dispatchEvent(touch("pointerdown", 3, 10, 10));
    expect([run.inp.pid, run.inp.aid, run.P.bombs]).toEqual([1, 2, bombs]);

    run.state = "play";
    const before = { x: run.inp.tx, y: run.inp.ty };
    field.dispatchEvent(touch("pointermove", 2, 120, 90));
    expect([run.inp.ax, run.inp.ay, run.inp.tx, run.inp.ty]).toEqual([120, 90, before.x, before.y]);
    field.dispatchEvent(touch("pointermove", 1, 210, 240));
    expect(run.inp.tx).toBeCloseTo(before.x + 13);
    expect(run.inp.ty).toBeCloseTo(before.y - 13);
    expect([run.inp.ax, run.inp.ay]).toEqual([120, 90]);

    field.dispatchEvent(touch("pointerup", 1));
    expect([run.inp.pid, run.inp.aid]).toEqual([null, 2]);
    field.dispatchEvent(touch("pointerdown", 4, 50, 50));
    expect([run.inp.pid, run.inp.aid]).toEqual([4, 2]);
    field.dispatchEvent(touch("pointercancel", 2));
    expect([run.inp.pid, run.inp.aid]).toEqual([4, null]);

    field.dispatchEvent(touch("pointerdown", 5, 90, 90));
    field.dispatchEvent(new Event("blur"));
    expect([run.inp.pid, run.inp.aid]).toEqual([4, 5]);
    win.dispatchEvent(new Event("blur"));
    expect([run.inp.pid, run.inp.aid]).toEqual([null, null]);
  });
});

test("in twin controls a touch flight starts from where Keating is", () => {
  touchRun("twin", (run, field) => {
    run.P.x = 140; run.P.y = 200;
    field.dispatchEvent(touch("pointerdown", 7, 380, 40));
    expect([run.inp.pid, run.inp.tx, run.inp.ty]).toEqual([7, 140, 200]);
    run.state = "play";
    field.dispatchEvent(touch("pointermove", 7, 390, 40));
    expect(run.inp.tx).toBeCloseTo(153);
  });
});

test("a two-finger tap spends one flight reserve and works with either lift order", () => {
  for (const [first, second] of [[1, 2], [2, 1]]) {
    touchRun("follow", (run, field) => {
      run.state = "play";
      const bombs = run.P.bombs;
      const send = (event: string, finger: number) => field.dispatchEvent(
        finger === 1 ? touch(event, finger, 190, 230) : touch(event, finger, 230, 160),
      );
      send("pointerdown", 1);
      send("pointerdown", 2);
      send("pointerup", first);
      expect(run.P.bombs).toBe(bombs);
      send("pointerup", second);
      expect(run.P.bombs).toBe(bombs - 1);
      expect([run.inp.pid, run.inp.aid]).toEqual([null, null]);
    });
  }
});

test("manual aim, a lesson gate and window blur discard tap bombing", () => {
  touchRun("twin", (run, field, win) => {
    run.state = "play";
    const bombs = run.P.bombs;
    for (const action of [
      () => {
        field.dispatchEvent(touch("pointermove", 2, 260, 137));
        expect([run.inp.ax, run.inp.ay]).toEqual([260, 137]);
      },
      () => win.dispatchEvent(new Event("blur")),
      () => field.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 2 })),
      () => Object.assign(run, { gates: { st: 0 } }),
    ]) {
      field.dispatchEvent(touch("pointerdown", 1, 190, 230));
      field.dispatchEvent(touch("pointerdown", 2, 230, 160));
      action();
      field.dispatchEvent(touch("pointerup", 1, 190, 230));
      field.dispatchEvent(touch("pointerup", 2, 230, 160));
      expect(run.P.bombs).toBe(bombs);
    }
  });
});

test("firing charge starts at Care charge, tiers down, refills only in play and reports its delta", () => {
  touchRun("follow", (run, _field, _win, game) => {
    expect(run.energy).toBeCloseTo(0.6);
    expect(game.chargeDelta).toBe(0);
    expect(run.chargeTier()).toBe(3);
    run.energy = 0.2; expect(run.chargeTier()).toBe(2);
    run.energy = 0.08; expect(run.chargeTier()).toBe(1);
    run.energy = 0; expect(run.chargeTier()).toBe(0);
    run.refill(0.5);
    expect(run.energy).toBe(0); // still in the intro: nothing is caught yet
    run.state = "play";
    run.refill(0.12);
    expect(run.energy).toBeCloseTo(0.12);
    expect(game.chargeDelta).toBeCloseTo(-0.48);
    run.refill(5);
    expect(run.energy).toBe(1);
    expect(game.chargeDelta).toBeCloseTo(0.4);
    run.state = "outro";
    run.energy = 0.3;
    run.refill(0.2);
    expect(run.energy).toBe(0.3);
  }, 0.6);
});

test("a gate about a picture hands the page that picture and comes down slower", () => {
  const image = { id: "img_cell", alt: "Labelled animal cell", src: "data:image/png;base64,AAAA" };
  const asked: unknown[] = [];
  const pack = { ...packs.maths, gates: [{ q: "Which labelled part holds the DNA?", a: ["Nucleus", "Ribosome", "Membrane"], image }, { q: "Plain?", a: ["Yes", "No", "Maybe"] }] };
  touchRun("follow", run => {
    const G = run as unknown as { startGates(i: number): void; gates: { slow?: boolean } | null };
    G.startGates(0);
    expect(asked.at(-1)).toMatchObject({ question: "Which labelled part holds the DNA?", image });
    expect(G.gates?.slow).toBe(true);
    G.gates = null;
    G.startGates(1);
    expect((asked.at(-1) as { image?: unknown }).image).toBeUndefined();
    expect((G.gates as { slow?: boolean } | null)?.slow).toBe(false);
  }, 0.75, { pack, ask: value => { if (value) asked.push(value); } });
});
