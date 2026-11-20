import { expect, test } from "bun:test";
import { RecessAudio } from "../components/recess/engine/audio.js";
import { Recess } from "../components/recess/engine/core.js";
import { packs } from "../components/recess/engine/packs.js";
import { RecessPatterns } from "../components/recess/engine/patterns.js";
import type { RecessPack, RecessQuestion } from "../components/recess/types";

class Playfield extends EventTarget {
  constructor(private readonly w = 640, private readonly h = 500) { super(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.w, height: this.h, bottom: this.h, right: this.w }; }
  querySelectorAll() { return []; }
  focus() {}
}

class Dock extends EventTarget {
  constructor(private readonly w = 640, private readonly h = 500) { super(); }
  getBoundingClientRect() { return { left: 0, top: this.h - 56, width: this.w, height: 56, bottom: this.h, right: this.w }; }
}

function makeLayer() {
  const vars = new Map<string, string>();
  const dataset: Record<string, string> = {};
  return {
    vars,
    dataset,
    style: {
      setProperty(k: string, v: string) { vars.set(k, v); },
      getPropertyValue(k: string) { return vars.get(k) ?? ""; },
    },
  };
}

function makeFakeContext() {
  const noop = () => {};
  return {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    setTransform: noop,
    clearRect: noop,
    translate: noop,
    save: noop,
    restore: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    arc: noop,
    ellipse: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    setLineDash: noop,
    drawImage: noop,
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
}

type TargetState = {
  bx: number; by: number; x: number; y: number; r: number; flash: number;
};

type GateState = {
  mode?: string;
  q: string;
  a: { t: string; ok: boolean }[];
  y?: number;
  st: number;
  t: number;
  arm?: number;
  pick: number;
  okIdx?: number;
  targets?: TargetState[];
};

type RunState = {
  state: string;
  W: number;
  H: number;
  T: number;
  calm: boolean;
  score: number;
  mult: number;
  P: { x: number; y: number; hearts: number; pw: number; lock: unknown; shotT: number };
  foes: unknown[];
  shots: { x: number; y: number; vx: number; vy: number; d: number; hom: boolean; t: number; dead?: boolean }[];
  bul: unknown[];
  picks: { k: string; x: number; y: number; mag: boolean }[];
  gates: GateState | null;
  res: { gates: { q: string; right: string; picked: string | null; ok: boolean; kind?: string; id?: string }[] };
  startGates(i: number): void;
  answerGate(i: number): boolean;
  energy: number;
  on(name: string, fn: (d: Record<string, unknown>) => void): void;
};

const ODDONE_GATE: RecessQuestion = {
  kind: "oddone",
  q: "Which one doesn't belong?",
  a: ["odd", "b", "c", "d"],
};

const LANE_GATE: RecessQuestion = {
  q: "Pick the right lane",
  a: ["right", "wrong-1", "wrong-2"],
};

function withTargetRun(
  opts: { gates: RecessQuestion[]; calm?: boolean; width?: number; height?: number },
  body: (ctx: {
    G: RunState;
    stepFrames(seconds: number, dt?: number): void;
    asks: ({ question: string; options: string[]; kind?: string } | null)[];
    gateLayer: ReturnType<typeof makeLayer>;
    targetLayer: ReturnType<typeof makeLayer>;
    resolved: Record<string, unknown>[];
  }) => void,
) {
  const w = opts.width ?? 640, h = opts.height ?? 500;
  const field = new Playfield(w, h);
  const dock = new Dock(w, h);
  const gateLayer = makeLayer();
  const targetLayer = makeLayer();
  let rafCb: ((ts: number) => void) | null = null;
  let now = 1000;
  const canvas = () => ({ width: 300, height: 150, hidden: false, getContext: makeFakeContext });
  const mocks = {
    window: new EventTarget(),
    document: { hidden: false, createElement: canvas },
    performance: { now: () => now },
    requestAnimationFrame: (cb: (ts: number) => void) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(mocks)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const origScript = RecessPatterns.script;
  let captured: RunState | null = null;
  // Stub the wave script so waves don't spawn enemies or advance gates automatically during unit tests.
  RecessPatterns.script = (G: RunState) => { captured = G; return { step() {} }; };
  const asks: ({ question: string; options: string[]; kind?: string } | null)[] = [];
  const resolved: Record<string, unknown>[] = [];
  const pack: RecessPack = { ...packs.maths, gates: opts.gates };
  try {
    const game = Recess.create({
      arena: field as unknown as HTMLElement,
      thread: field as unknown as HTMLElement,
      dock: dock as unknown as HTMLElement,
      bot: dock as unknown as HTMLElement,
      view: canvas() as unknown as HTMLCanvasElement,
      shader: null,
      gateLayer: gateLayer as unknown as HTMLElement,
      targetLayer: targetLayer as unknown as HTMLElement,
      sound: RecessAudio.create(),
      pack,
      theme: "paper",
      control: "follow",
      calm: opts.calm ?? false,
      sheet: {} as HTMLImageElement,
      rows: {},
      hasJetpack: true,
      flip: null,
      toy: null,
      equipment: {},
      keycapBoots: false,
      hud() {},
      ask(v) { asks.push(v); },
      phase() {},
      revive() {},
      end() {},
    });
    expect(game.start("start")).toBe(true);
    expect(captured).not.toBeNull();
    const G = captured!;
    G.on("gateResolve", (d) => resolved.push(d));
    // Put directly into play with firing paused until the test injects shots explicitly.
    G.state = "play";
    G.P.x = w / 2;
    G.P.y = h - 90;
    G.P.shotT = 999;

    const stepFrames = (seconds: number, dt = 0.02) => {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) {
        G.P.shotT = 999; // prevent autonomous volleys from interfering with deterministic tests
        now += dt * 1000;
        rafCb?.(now);
      }
    };

    body({ G, stepFrames, asks, gateLayer, targetLayer, resolved });
    game.dispose();
  } finally {
    RecessPatterns.script = origScript;
    for (const name of Object.keys(mocks)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("oddone gate spawns 4 non-overlapping floating targets inside bounds, clears bullets, and does not use lanes", () => {
  withTargetRun({ gates: [ODDONE_GATE] }, ({ G, stepFrames, asks, gateLayer, targetLayer }) => {
    G.bul.push({ x: 100, y: 100, vx: 0, vy: 50, r: 4, k: 0, t: 0 });
    G.startGates(0);

    expect(G.bul).toHaveLength(0);
    expect(G.gates?.mode).toBe("targets");
    expect(G.gates?.targets).toHaveLength(4);
    expect(asks.at(-1)?.kind).toBe("oddone");
    expect(asks.at(-1)?.options).toEqual(G.gates!.a.map((a) => a.t));
    expect(new Set(asks.at(-1)?.options)).toEqual(new Set(["odd", "b", "c", "d"]));

    stepFrames(0.6);

    // Target layer updated; lane layer untouched.
    expect(gateLayer.vars.size).toBe(0);
    expect(targetLayer.dataset.st).toBe("0");
    expect(targetLayer.dataset.pick).toBe("-1");
    expect(Number(targetLayer.dataset.ok)).toBe(G.gates!.a.findIndex((a) => a.ok));
    for (let i = 0; i < 4; i++) {
      expect(targetLayer.vars.get(`--t${i}-x`)).toMatch(/px$/);
      expect(targetLayer.vars.get(`--t${i}-y`)).toMatch(/px$/);
    }

    // All 4 targets stay within arena bounds, clear of the HUD/question banner, and non-overlapping.
    const targets = G.gates!.targets!;
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      expect(a.x - a.r).toBeGreaterThan(0);
      expect(a.x + a.r).toBeLessThan(G.W);
      expect(a.y - a.r).toBeGreaterThan(120);
      expect(a.y + a.r).toBeLessThan(G.H - 60);
      for (let j = i + 1; j < targets.length; j++) {
        const b = targets[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r + 16);
      }
    }

    // Auto-aim never locks onto targets.
    expect(G.P.lock).toBeNull();
  });
});

test("hitting the odd target awards points and sparks and records ok: true", () => {
  withTargetRun({ gates: [ODDONE_GATE] }, ({ G, stepFrames, asks, targetLayer, resolved }) => {
    G.mult = 3;
    G.startGates(0);
    stepFrames(1.3); // past the reading window

    const okIdx = G.gates!.a.findIndex((a) => a.ok);
    const target = G.gates!.targets![okIdx];
    const scoreBefore = G.score;
    const pwBefore = G.P.pw;

    // Fire a normal upward shot directly into the odd target.
    G.shots.push({ x: target.x, y: target.y + 12, vx: 0, vy: -980, d: 1, hom: false, t: 0 });
    stepFrames(0.02);

    expect(G.gates?.st).toBe(1);
    expect(G.gates?.pick).toBe(okIdx);
    expect(G.res.gates).toEqual([{ q: ODDONE_GATE.q, right: "odd", picked: "odd", ok: true, kind: "oddone", id: undefined }]);
    expect(G.score).toBe(scoreBefore + 3000);
    expect(G.P.pw).toBe(pwBefore + 22);
    expect(G.picks.filter((p) => p.k === "s").length).toBeGreaterThanOrEqual(14);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].ok).toBe(true);
    expect(resolved[0].pts).toBe(3000);
    expect(targetLayer.dataset.st).toBe("1");
    expect(targetLayer.dataset.pick).toBe(String(okIdx));
    expect(targetLayer.dataset.ok).toBe(String(okIdx));

    // After the resolution linger window, the gate clears and ask(null) fires.
    stepFrames(1.5);
    expect(G.gates).toBeNull();
    expect(asks.at(-1)).toBeNull();
  });
});

test("hitting a wrong target records ok: false with right: 'odd', costs no hearts, and ignores further shots", () => {
  withTargetRun({ gates: [ODDONE_GATE] }, ({ G, stepFrames, targetLayer, resolved }) => {
    G.startGates(0);
    stepFrames(1.3); // past the reading window

    const okIdx = G.gates!.a.findIndex((a) => a.ok);
    const wrongIdx = G.gates!.a.findIndex((a) => !a.ok);
    const wrongChoice = G.gates!.a[wrongIdx].t;
    const wrongTarget = G.gates!.targets![wrongIdx];
    const rightTarget = G.gates!.targets![okIdx];
    const heartsBefore = G.P.hearts;
    const scoreBefore = G.score;

    G.shots.push({ x: wrongTarget.x, y: wrongTarget.y + 12, vx: 0, vy: -980, d: 1, hom: false, t: 0 });
    stepFrames(0.02);

    expect(G.gates?.st).toBe(1);
    expect(G.gates?.pick).toBe(wrongIdx);
    expect(G.P.hearts).toBe(heartsBefore);
    expect(G.score).toBe(scoreBefore);
    expect(G.res.gates).toEqual([{ q: ODDONE_GATE.q, right: "odd", picked: wrongChoice, ok: false, kind: "oddone", id: undefined }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].ok).toBe(false);
    expect(resolved[0].right).toBe("odd");
    expect(targetLayer.dataset.st).toBe("1");
    expect(targetLayer.dataset.pick).toBe(String(wrongIdx));
    expect(targetLayer.dataset.ok).toBe(String(okIdx));

    // A second shot into the right target during the linger window must not re-resolve.
    G.shots.push({ x: rightTarget.x, y: rightTarget.y + 12, vx: 0, vy: -980, d: 1, hom: false, t: 0 });
    stepFrames(0.04);
    expect(G.res.gates).toHaveLength(1);
    expect(resolved).toHaveLength(1);
  });
});

test("timeout resolves as missed with picked: null (9 s normal, 12 s calm)", () => {
  withTargetRun({ gates: [ODDONE_GATE], calm: false }, ({ G, stepFrames, targetLayer, resolved }) => {
    G.startGates(0);
    stepFrames(8.5);
    expect(G.gates?.st).toBe(0);
    expect(G.res.gates).toHaveLength(0);

    stepFrames(0.7);
    expect(G.gates?.st).toBe(1);
    expect(G.res.gates).toEqual([{ q: ODDONE_GATE.q, right: "odd", picked: null, ok: false, kind: "oddone", id: undefined }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].picked).toBeNull();
    expect(targetLayer.dataset.pick).toBe("-1");
  });

  withTargetRun({ gates: [ODDONE_GATE], calm: true }, ({ G, stepFrames }) => {
    G.startGates(0);
    stepFrames(10);
    expect(G.gates?.st).toBe(0);
    expect(G.res.gates).toHaveLength(0);

    stepFrames(2.2);
    expect(G.gates?.st).toBe(1);
    expect(G.res.gates).toEqual([{ q: ODDONE_GATE.q, right: "odd", picked: null, ok: false, kind: "oddone", id: undefined }]);
  });
});

test("normal 3-choice gate still uses lanes and drives gateLayer rather than targetLayer", () => {
  withTargetRun({ gates: [LANE_GATE] }, ({ G, stepFrames, asks, gateLayer, targetLayer }) => {
    G.startGates(0);
    expect(G.gates?.mode).toBeUndefined();
    expect(asks.at(-1)?.kind).toBeUndefined();
    expect(asks.at(-1)?.options).toHaveLength(3);

    stepFrames(0.5);
    expect(gateLayer.vars.get("--gate-y")).toMatch(/px$/);
    expect(gateLayer.dataset.st).toBe("0");
    expect(targetLayer.vars.size).toBe(0);
  });
});

test("shots already in the air when the question appears never answer it", () => {
  withTargetRun({ gates: [ODDONE_GATE] }, ({ G, stepFrames }) => {
    G.startGates(0);
    const okIdx = G.gates!.a.findIndex((a) => a.ok);
    const target = G.gates!.targets![okIdx];
    // A shot fired before the gate opened, parked on the target: it must not count, even after the reading window.
    const stray = { x: target.x, y: target.y, vx: 0, vy: 0, d: 1, hom: false, t: 0, preGate: true };
    stepFrames(1.3);
    G.shots.push(stray);
    stepFrames(0.02);
    expect(G.gates?.st).toBe(0);
    expect(G.res.gates).toHaveLength(0);
  });
});

test("a number answers the open gate by its displayed position, at any charge", () => {
  withTargetRun({ gates: [ODDONE_GATE] }, ({ G }) => {
    G.startGates(0);
    const okIdx = G.gates!.a.findIndex((a) => a.ok);
    G.energy = 0;
    expect(G.answerGate(okIdx)).toBe(true);
    expect(G.res.gates[0]).toMatchObject({ ok: true, right: "odd", kind: "oddone" });
    expect(G.answerGate(0)).toBe(false); // already answered
  });
});
