import { expect, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";

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
