import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DraggableRenderer, inOrder, param, translate, type Draggable, type DragSpec } from "dragology";
import { Pin, PinOff, RotateCcw, Undo2 } from "lucide-react";
import { compile, ExprError, type Ctx, type Fn } from "./expr";
import { shapeProblems } from "./shape";
import "./component.css";

/* =====================================================================================
   LinkedLab: several views of one model that move together while the learner drags.
   The config is plain JSON so a model can author it: a model kind from a small whitelist,
   declared parameters, formulas as strings (parsed by ./expr, never eval'd), which views
   to show, which marks on the canvas are draggable, and the regimes on a parameter axis.
   ===================================================================================== */

export type ShareSummary = { learner: string; data: string; reply: string };
export type ViewKind = "curve" | "trace" | "table" | "equation" | "phase";
export type Tone = "ok" | "warn" | "bad" | "info";

export type ParamSpec = {
  label: string; symbol?: string; min: number; max: number; value: number;
  step?: number; unit?: string; digits?: number;
};
/** 1-D iterated map x_{n+1} = map(x_n): gradient descent, Newton's method, the logistic map. */
export type IterateModel = {
  kind: "iterate"; variable: string; start: string; map: string; steps: number;
  /** y = curve(x) drawn in the curve view; the iterates sit on it. Defaults to the map. */
  curve?: string;
  /** What the trace plots per step (default: the curve value). */
  measure?: string; measureLabel?: string;
  /** "path": arrows between points on the curve. "cobweb": the classic staircase against y = x. */
  style?: "path" | "cobweb";
  xRange: [number, number]; yRange?: [number, number]; xLabel?: string; yLabel?: string;
  /** What one iteration is called in the copy ("step", "year"). */
  stepLabel?: string;
};
/** Euler-stepped ODE system with one or two state variables. */
export type OdeModel = {
  kind: "ode"; vars: string[]; rates: Record<string, string>; initial: Record<string, string>;
  /** Step size: a parameter name or formula. */
  dt: string; duration: number; ranges: Record<string, [number, number]>;
  /** Also draw a fine-step RK4 reference (600 steps; not an exact solution) as a ghost to compare against. */
  reference?: boolean; timeUnit?: string; labels?: Record<string, string>;
};
/** y = f(x; params) with draggable params, a probe on the curve and a linked table. */
export type FunctionModel = {
  kind: "function"; f: string;
  x: { name: string; label: string; min: number; max: number; unit?: string };
  y: { label: string; min: number; max: number; unit?: string };
  rows: number[]; probe?: number;
};
export type HandleSpec = {
  view: "curve" | "trace" | "phase";
  /** "start" = the initial point, "step" = where the first step lands, or a point given by formulas. */
  at: "start" | "step" | { x: string; y: string };
  vary: string[]; label?: string;
  /** For at: "step", which step to grab (default 1). A later step gears the drag down. */
  n?: number;
};
/** What a band says when the long run is a cycle of period ≥ 2 (detected, iterate models only). */
export type BandVariant = { name?: string; tone?: Tone; say: string; learner?: string; reply?: string };
export type RegimeBand = {
  name: string; tone: Tone; say: string; learner?: string; reply?: string;
  /** Short name for the regime axis (≤ 16 chars). Defaults to the name. */
  short?: string;
  /** Used instead when the run actually settles into a cycle of period ≥ 2 inside this band. */
  cycle?: BandVariant;
  /** Used instead when the parameter sits exactly on this band's upper cut (a neutral boundary). Not on the last band. */
  atCut?: BandVariant & { short?: string };
};
export type RegimeSpec = { param: string; cuts: string[]; bands: RegimeBand[]; sweep?: "outcome" | "orbit"; axisLabel?: string };
export type LinkedConfig = {
  title: string; goal?: string; views: ViewKind[];
  params: Record<string, ParamSpec>;
  model: IterateModel | OdeModel | FunctionModel;
  equation?: { lines: string[]; live?: string };
  handles?: HandleSpec[];
  /** Shown collapsed by default ("Show the numbers"). `note` is a template printed under it. */
  table?: { columns: { label: string; expr: string; digits?: number; compare?: boolean }[]; note?: string };
  regimes?: RegimeSpec;
  notes?: { when: string; say: string }[];
  share?: { learner: string; reply: string };
  labels?: Partial<Record<"curve" | "trace" | "phase", string>>;
  /** Plot views that start collapsed behind a "Show …" toggle (keeps the reply short). Never the only plot. */
  secondary?: ("curve" | "trace" | "phase")[];
};

/* ---------- Presets ----------
   Science notes (checked numerically, see test.mjs):
   - GD on L = ½·a·w²: w_{n+1} = (1 − η·a)·w. Monotone for η < 1/a, zig-zag converging for 1/a < η < 2/a,
     bounces forever at η = 2/a exactly, diverges past 2/a.
   - Euler on x'' = −k·x − c·x' (unit mass): per step |λ|² = 1 − Δt·(c − k·Δt) exactly, so the numerical
     amplitude decays only while Δt < c/k; to first order Euler behaves like damping c − k·Δt.
   - Logistic map: fixed point 1 − 1/r with slope 2 − r. Monotone approach for 1 < r < 2, oscillating
     approach for 2 < r < 3, 2-cycle to 1 + √6, period doubling accumulating at ≈ 3.5699, then mostly
     chaos with periodic windows (period 3 from 1 + √8 ≈ 3.8284). The readout uses the detected period. */
export const presets: Record<string, LinkedConfig> = {
  gradientDescent: {
    title: "Gradient descent on a valley",
    goal: "Drag the first step arrow longer or shorter, or slide the start point along the curve. A run can go three different ways. Find all three.",
    views: ["equation", "curve", "trace", "table"],
    params: {
      lr: { label: "learning rate", symbol: "η", min: 0.05, max: 2.4, value: 0.3, step: 0.05, digits: 2 },
      a: { label: "curvature", symbol: "a", min: 0.5, max: 2, value: 1, step: 0.1, digits: 1 },
      w0: { label: "start", symbol: "w₀", min: -2.8, max: 2.8, value: 2.4, step: 0.1, digits: 1 },
    },
    model: {
      kind: "iterate", variable: "w", start: "w0", map: "w - lr*a*w", curve: "0.5*a*w^2", steps: 16,
      xRange: [-3, 3], xLabel: "weight w", yLabel: "loss", measureLabel: "loss",
    },
    labels: { curve: "Loss curve L(w) = ½·a·w²", trace: "Loss at each step" },
    equation: {
      lines: ["w_{n+1} = w_n − {lr} · L′(w_n)", "L′(w) = {a} · w      start w_0 = {w0}"],
      live: "step [n|0]:  w_{[n+1|0]} = [w|2] − [lr|2] · [a*w|2] = [next_w|2]",
    },
    handles: [
      { view: "curve", at: "start", vary: ["w0"], label: "start" },
      { view: "curve", at: "step", vary: ["lr"], label: "first step" },
    ],
    table: { columns: [
      { label: "step", expr: "n", digits: 0 },
      { label: "w", expr: "w", digits: 2 },
      { label: "loss", expr: "0.5*a*w^2", digits: 3, compare: true },
    ] },
    regimes: {
      param: "lr", cuts: ["1/a", "2/a"], sweep: "outcome", axisLabel: "learning rate η",
      bands: [
        { name: "Creeps down one side", short: "Creeps", tone: "ok",
          say: "Each step covers [100*lr*a|0]% of the way to the bottom, so the run never jumps past it.",
          learner: "With η = {lr} my descent crept down one side of the valley.",
          reply: "Each step moves η·a = [lr*a|2] of the remaining distance, so w shrinks by a factor of [1-lr*a|2] every step and never changes sign. Safe, but the smaller η is, the more steps you pay for." },
        { name: "Zig-zags, still settles", short: "Zig-zags", tone: "warn",
          say: "Each step jumps past the bottom and lands [abs(1-lr*a)|2]× as far out on the other side. Under 1, so the zig-zag shrinks.",
          learner: "With η = {lr} my descent zig-zagged across the valley but still settled.",
          reply: "Past η = 1/a = [1/a|2] a step jumps over the bottom. Each step multiplies w by 1 − η·a = [1-lr*a|2]: the minus sign is the zig-zag, and because its size is under 1 the jumps still shrink.",
          cycle: { name: "Bounces forever", tone: "warn",
            say: "η is exactly 2/a, so each step multiplies w by 1 − η·a = −1: the run jumps between ±[abs(start_w)|2] for ever, neither settling nor growing.",
            learner: "With η = {lr} my descent bounced between the same two points for ever.",
            reply: "That is the knife edge η = 2/a = [2/a|2]. Each step multiplies w by exactly −1, so the jumps neither shrink nor grow. Any smaller and it settles; any bigger and it flies off." } },
        { name: "Overshoots and diverges", short: "Diverges", tone: "bad",
          say: "Each step lands [abs(1-lr*a)|2]× farther from the bottom than it started, so the loss grows every step.",
          learner: "With η = {lr} my descent overshot and flew out of the valley.",
          reply: "Each step multiplies w by 1 − η·a = [1-lr*a|2]. Its size is over 1, so every jump lands farther out than the last. The line is η = 2/a = [2/a|2]: a sharper valley (bigger a) makes that line come sooner, which is why one learning rate can work for one loss and blow up on another." },
      ],
    },
    notes: [
      { when: "abs(lr*a - 1) < 0.04", say: "η is almost exactly 1/a: the first step lands on the bottom. On a perfect bowl that is the fastest rate there is." },
      { when: "lr*a < 0.2", say: "Safe but slow: after [steps|0] steps the loss is still [final|3]." },
    ],
  },
  caffeine: {
    title: "Caffeine half-life",
    goal: "Drag the half-life point sideways, or the dose up and down. Slide the probe to bedtime. Which one changes the percentage left?",
    views: ["equation", "curve", "table"],
    params: {
      D: { label: "dose", symbol: "D", min: 40, max: 400, value: 200, step: 10, unit: "mg", digits: 0 },
      h: { label: "half-life", symbol: "h", min: 1.5, max: 10, value: 5, step: 0.5, unit: "h", digits: 1 },
    },
    model: {
      kind: "function", f: "D * 0.5^(t/h)",
      x: { name: "t", label: "hours after the coffee", min: 0, max: 24, unit: "h" },
      y: { label: "caffeine left (mg)", min: 0, max: 420, unit: "mg" },
      rows: [0, 2, 4, 6, 8, 12, 16, 24], probe: 16,
    },
    labels: { curve: "Caffeine left in the body" },
    equation: {
      lines: ["N(t) = {D} · (½)^{t ⁄ h}", "half-life h = {h}"],
      live: "at t = [t|1] h:  N = [D|0] · ½^{[t/h|2]} = [f(t)|0] mg",
    },
    handles: [
      { view: "curve", at: { x: "h", y: "D/2" }, vary: ["h"], label: "half-life" },
      { view: "curve", at: { x: "0", y: "D" }, vary: ["D"], label: "dose" },
    ],
    table: { columns: [
      { label: "hours", expr: "t", digits: 0 },
      { label: "half-lives", expr: "t/h", digits: 1 },
      { label: "% left", expr: "100*0.5^(t/h)", digits: 0 },
      { label: "mg left", expr: "D*0.5^(t/h)", digits: 0, compare: true },
    ] },
    notes: [
      { when: "1", say: "At t = [t|1] h, [f(t)|0] mg is left: [100*f(t)/D|0]% of the dose, after [t/h|1] half-lives." },
    ],
    share: {
      learner: "With a [D|0] mg dose and a [h|1] h half-life, [f(t)|0] mg is left after [t|0] hours.",
      reply: "[t|0] hours is [t/h|1] half-lives, so you keep ½ to that power: [100*0.5^(t/h)|0]% of whatever you drank. The dose scales every row of the table by the same amount; only the half-life changes the percentage.",
    },
  },
  spring: {
    title: "Euler steps on a damped spring",
    goal: "Drag the “20 steps” marker to the right: every Euler step gets longer. The grey curve is a fine-step reference (RK4, 600 steps), not an exact solution. With damping c > 0 the spring settles; with c = 0 it swings for ever at constant energy. When does the simulation stop agreeing with it?",
    views: ["equation", "trace", "phase", "table"],
    params: {
      dt: { label: "time step", symbol: "Δt", min: 0.03, max: 0.4, value: 0.05, step: 0.01, unit: "s", digits: 2 },
      k: { label: "stiffness", symbol: "k", min: 1, max: 9, value: 4, step: 0.5, digits: 1 },
      c: { label: "damping", symbol: "c", min: 0, max: 1.5, value: 0.8, step: 0.05, digits: 2 },
      x0: { label: "start position", symbol: "x₀", min: -1.8, max: 1.8, value: 1.5, step: 0.1, unit: "m", digits: 1 },
      v0: { label: "start velocity", symbol: "v₀", min: -3, max: 3, value: 0, step: 0.1, unit: "m/s", digits: 1 },
    },
    model: {
      kind: "ode", vars: ["x", "v"], rates: { x: "v", v: "-k*x - c*v" }, initial: { x: "x0", v: "v0" },
      dt: "dt", duration: 12, ranges: { x: [-2, 2], v: [-4.5, 4.5] }, reference: true, timeUnit: "s",
      labels: { x: "position x", v: "velocity v" },
    },
    labels: { trace: "Position over time", phase: "Phase: v against x" },
    equation: {
      lines: ["x_{n+1} = x_n + {dt} · v_n", "v_{n+1} = v_n + {dt} · (−{k} · x_n − {c} · v_n)"],
      live: "t = [t|2] s:  x = [x|2],  v = [v|2],  energy [0.5*v^2 + 0.5*k*x^2|2]",
    },
    handles: [
      { view: "trace", at: "step", n: 20, vary: ["dt"], label: "20 steps" },
      { view: "phase", at: "start", vary: ["x0", "v0"], label: "start" },
    ],
    table: { columns: [
      { label: "t (s)", expr: "t", digits: 2 },
      { label: "Euler x", expr: "x", digits: 2 },
      { label: "reference x (fine RK4)", expr: "ref_x", digits: 2 },
      { label: "energy", expr: "0.5*v^2 + 0.5*k*x^2", digits: 2, compare: true },
    ], note: "The spring never gains energy: with c > 0 it loses some every moment, and with c = 0 it keeps exactly what it started with. Any rise in the energy column is Euler’s error: each step uses the slope from the start of the step and overshoots a little." },
    regimes: {
      param: "dt", cuts: ["c/(2*k)", "c/k"], sweep: "outcome", axisLabel: "time step Δt",
      bands: [
        { name: "Settles, a little slow", short: "A little slow", tone: "ok",
          say: "Each Euler step acts roughly like damping c − k·Δt = [c-k*dt|2] instead of the real [c|2], so it settles, a little later than the real spring.",
          learner: "With Δt = {dt} s my simulated spring settled, a bit slower than the real one.",
          reply: "Every Euler step overshoots slightly and puts a little energy back: to first order it acts like damping c − k·Δt = [c-k*dt|2] instead of [c|2]. That is still more than half the real damping, so the run settles, just later than the grey curve." },
        { name: "Settles, far too slowly", short: "Far too slow", tone: "warn",
          say: "Euler acts roughly like damping [c-k*dt|2] instead of [c|2]: less than half the real friction, so it rings on long after the spring would stop.",
          atCut: { name: "Neither settles nor grows", short: "Neutral", tone: "warn",
            say: "Δt is exactly c/k = [c/k|2] s, so each Euler step multiplies the swing by √(1 − Δt·(c − k·Δt)) = [sqrt(1-dt*(c-k*dt))|3]: the simulation rings for ever at the same size while the spring settles.",
            learner: "With Δt = {dt} s my simulated spring kept swinging at the same size.",
            reply: "That is the knife edge Δt = c/k = [c/k|2] s. Per step the swing is multiplied by √(1 − Δt·(c − k·Δt)) = [sqrt(1-dt*(c-k*dt))|3], exactly 1, so the numerical oscillation is neutral: the energy Euler adds each step matches what the damping removes. Any smaller step and it settles (slowly); any bigger and it grows." },
          learner: "With Δt = {dt} s my simulation still settled, but far slower than the real spring.",
          reply: "Each step overshoots and adds energy back, so Euler acts like damping c − k·Δt = [c-k*dt|2] instead of [c|2]. It still settles because that number is positive, but the energy column falls far more slowly than it should." },
        { name: "Gains energy and grows", short: "Grows", tone: "bad",
          say: "Euler acts roughly like damping [c-k*dt|2]: below zero, so every step adds energy and the swings grow.",
          learner: "With Δt = {dt} s my simulated spring swung wider and wider.",
          reply: "Past Δt = c/k = [c/k|2] s each Euler step adds more energy than the damping takes out (per step the swing is multiplied by √(1 − Δt·(c − k·Δt)) = [sqrt(1-dt*(c-k*dt))|3], above 1). The spring itself never gains energy (with c > 0 it settles; with c = 0 it swings at constant energy); the simulation grows without limit. Same story as a learning rate that is too big: a step that overshoots by more than it corrects." },
      ],
    },
    notes: [
      { when: "c == 0", say: "With c = 0 there is no friction: the spring itself conserves energy and swings for ever without settling. Euler’s multiplier √(1 + k·Δt²) = [sqrt(1+k*dt^2)|3] is above 1 for every step size, so the simulation always grows." },
    ],
  },
  logistic: {
    title: "The logistic map",
    goal: "Drag the first cobweb step up or down to change the growth rate r. Find every way the population can behave.",
    views: ["equation", "curve", "trace", "table"],
    params: {
      r: { label: "growth rate", symbol: "r", min: 0.6, max: 4, value: 2.6, step: 0.005, digits: 3 },
      x0: { label: "start", symbol: "x₀", min: 0.02, max: 0.98, value: 0.2, step: 0.02, digits: 2 },
    },
    model: {
      kind: "iterate", variable: "x", start: "x0", map: "r*x*(1-x)", measure: "x", steps: 40, style: "cobweb",
      xRange: [0, 1], yRange: [0, 1], xLabel: "this year x", yLabel: "next year", measureLabel: "population", stepLabel: "year",
    },
    labels: { curve: "Cobweb: next year against this year", trace: "Population each year" },
    secondary: ["trace"],
    equation: { lines: ["x_{n+1} = {r} · x_n · (1 − x_n)", "start x_0 = {x0}"], live: "year [n|0]:  [r|3] · [x|3] · [1-x|3] = [next_x|3]" },
    handles: [
      { view: "curve", at: "step", vary: ["r"], label: "first step" },
      { view: "curve", at: "start", vary: ["x0"], label: "start" },
    ],
    table: { columns: [
      { label: "year", expr: "n", digits: 0 },
      { label: "x", expr: "x", digits: 3, compare: true },
      { label: "change", expr: "next_x - x", digits: 3 },
    ] },
    regimes: {
      param: "r", cuts: ["1", "2", "3", "1+sqrt(6)", "3.5699"], sweep: "orbit", axisLabel: "growth rate r",
      bands: [
        { name: "Dies out", short: "Dies out", tone: "info", say: "r is under 1: each year keeps less than it had, so the population shrinks to zero.",
          learner: "With r = {r} the population died out.", reply: "Below r = 1 a small population makes fewer than one replacement each, so x falls toward 0 whatever the start." },
        { name: "Settles smoothly", short: "Smooth", tone: "ok", say: "The slope where the curve meets y = x is 2 − r = [2-r|2], between 0 and 1, so each year closes part of the gap from the same side: no overshoot, no spiral. It settles at x = 1 − 1/r = [1-1/r|3].",
          learner: "With r = {r} the population climbed smoothly to [1-1/r|3].", reply: "The staircase walks straight up to where the curve crosses the diagonal, x = 1 − 1/r = [1-1/r|3]. Near that point the slope of the curve is 2 − r = [2-r|2]: positive and under 1, so every year closes part of the gap without overshooting." },
        { name: "Spirals in", short: "Spirals in", tone: "ok", say: "The slope at the crossing is 2 − r = [2-r|2]: negative, so each year overshoots the balance point x = [1-1/r|3], but by less each time, and the cobweb spirals in.",
          learner: "With r = {r} the population overshot back and forth but settled at [1-1/r|3].", reply: "Past r = 2 the slope at the balance point, 2 − r = [2-r|2], is negative, so each year lands on the other side of x = [1-1/r|3]. Its size is still under 1, so the overshoots shrink and the cobweb spirals in, like a learning rate between 1/a and 2/a." },
        { name: "Flips between two values", short: "2-cycle", tone: "warn", say: "The slope at the crossing is [2-r|2], steeper than −1, so the run overshoots the balance point every year and lands in a two-year cycle.",
          learner: "With r = {r} the population flipped between two values.", reply: "Past r = 3 the slope at the balance point, 2 − r, drops below −1: like a learning rate past 2/a, each year overshoots. It does not explode because the curve folds back, so it settles into a two-year cycle instead." },
        { name: "The cycle keeps splitting", short: "4, 8, 16…", tone: "warn", say: "The two-year cycle has itself started to overshoot and split. The splits come faster and faster as r rises.",
          learner: "With r = {r} the cycle had split beyond two values.", reply: "At r = 1 + √6 ≈ [1+sqrt(6)|3] the two-year cycle itself overshoots and splits into four, then eight, each split closer to the last. They pile up near r ≈ 3.57.",
          cycle: { say: "The two-year cycle has split again: this run repeats every [period|0] years. The splits come faster and faster as r rises.",
            learner: "With r = {r} the population repeated every [period|0] years.",
            reply: "At r = 1 + √6 ≈ [1+sqrt(6)|3] the two-year cycle overshoots and splits into four, then eight, and so on; yours repeats every [period|0] years. The splits pile up near r ≈ 3.57, where order gives way to chaos." } },
        { name: "Mostly never repeats", short: "Mostly chaos", tone: "bad", say: "Past r ≈ 3.57 most runs never settle into a cycle, and a tiny change to the start gives a completely different path. There are narrow windows of order inside (one is near r ≈ 3.83).",
          learner: "With r = {r} the population never repeated.", reply: "Past r ≈ 3.57 the splits have run together and most values of r are chaotic: no cycle at all, and a start of [x0|2] versus [x0+0.01|2] gives two runs that soon look nothing alike. Pin one run and nudge the start to see it. Hidden inside are narrow windows where order returns.",
          cycle: { name: "A window of order", tone: "warn",
            say: "Inside the chaotic range, r = [r|3] falls in a window of order: the run settles into a [period|0]-year cycle. Nudge r a little and chaos comes back.",
            learner: "With r = {r} the population settled into a [period|0]-year cycle, even though r is past 3.57.",
            reply: "That is one of the periodic windows inside the chaos: this run repeats every [period|0] years. The widest starts at r = 1 + √8 ≈ 3.828 with a 3-year cycle, which splits into 6, 12, … and dissolves back into chaos by about r ≈ 3.86. Order and chaos are interleaved past 3.57, not separated by one line." } },
      ],
    },
  },
};

export const scenario = {
  tab: "Linked lab",
  prompt: "Why does gradient descent overshoot when the learning rate is too high?",
  intro: "Because each step is sized by the slope, not by how far away the bottom is. A big enough step jumps past the bottom, and past η = 2/a it lands higher than it started. Drag the first step on the curve and watch the arrows and the loss line change together.",
  receiptLabel: "Linked simulation",
  receiptText: "The learner asked why gradient descent overshoots. The lab runs the update rule live on a quadratic loss, so the curve, the loss plot, the table and the equation all show the same run; the regime lines come from the config (η = 1/a and 2/a).",
  preset: "gradientDescent",
};

/** Per-preset chat framing (the catalogue and the harness both read this). */
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  gradientDescent: { label: scenario.tab, prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  caffeine: { label: "Half-life", prompt: "If caffeine has a half-life of five hours, how much of my morning coffee is left at bedtime?",
    intro: "Half of it is gone every half-life, whatever the dose. Drag the half-life point and the dose on the curve; the formula and the numbers follow.",
    receiptLabel: "Linked simulation", receiptText: "The learner asked about caffeine left at bedtime. The lab plots N = D·½^(t/h); the dose and half-life are dragged on the curve and the probe reads any hour." },
  spring: { label: "Spring steps", prompt: "Why does my physics simulation blow up when I make the time step bigger?",
    intro: "Euler’s method takes each step using the slope at the start of the step, so a big step overshoots, the same way a big learning rate does. Stretch the steps and compare the dots with the grey fine-step reference.",
    receiptLabel: "Linked simulation", receiptText: "The learner asked why a simulation blows up with a bigger time step. The lab Euler-steps a damped spring next to a fine-step RK4 reference (not an exact solution); the regime lines are Δt = c/2k and c/k from the config." },
  logistic: { label: "Logistic map", prompt: "How can a simple population formula end up chaotic?",
    intro: "Each year feeds the next through the same curve. Drag the first step of the cobweb and watch where the staircase goes as the growth rate rises.",
    receiptLabel: "Linked simulation", receiptText: "The learner asked how a simple formula becomes chaotic. The lab iterates x → r·x·(1 − x); the readout names the cycle it actually detects in the long run (period up to 12)." },
};

/* =====================================================================================
   Config compilation and validation
   ===================================================================================== */
const VIEW_KINDS: ViewKind[] = ["curve", "trace", "table", "equation", "phase"];
const TONES: Tone[] = ["ok", "warn", "bad", "info"];
const RESERVED = new Set(["n", "t", "pi", "e", "steps", "final", "first", "settled", "outcome", "diverged", "f", "period"]);
/** An ode run longer than this many Euler steps is refused by the validator and cut (visibly) during drags. */
export const MAX_ODE_STEPS = 1500;

type Lab = {
  config: LinkedConfig;
  kind: "iterate" | "ode" | "function";
  pids: string[]; params: Record<string, ParamSpec>;
  views: Set<ViewKind>;
  vars: string[];
  iterate?: { map: Fn; start: Fn; curve: Fn; measure: Fn; steps: number; style: "path" | "cobweb"; xRange: [number, number]; yRange?: [number, number] };
  ode?: { rates: Fn[]; initial: Fn[]; dt: Fn; duration: number; ranges: [number, number][]; reference: boolean; unit: string };
  func?: { f: Fn; rows: number[]; xname: string };
  /** ruler: an ode trace "step" handle whose varied params change dt sits on the time axis as a step ruler. */
  handles: { spec: HandleSpec; x?: Fn; y?: Fn; ruler?: boolean }[];
  columns: { label: string; fn: Fn; digits: number; compare: boolean }[];
  cuts: Fn[]; regime?: RegimeSpec;
  notes: { when: Fn; say: string }[];
  rowNames: string[]; statNames: string[];
  bind: { p: P };
};

function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }

type Compiled = { ok: true; lab: Lab } | { ok: false; problems: string[] };
/** Validates and compiles a config. Never throws: an unexpected failure becomes a problem sentence. */
export function compileConfig(raw: unknown): Compiled {
  try { return compileInner(raw); }
  catch (e) { return { ok: false, problems: [`config could not be compiled (${e instanceof Error ? e.message : "unknown error"})`] }; }
}
function compileInner(raw: unknown): Compiled {
  const problems: string[] = [];
  const fail = (m: string) => { problems.push(m); };
  try { JSON.stringify(raw); } catch { return { ok: false, problems: ["config is not plain JSON"] }; }
  const shape = shapeProblems(raw);
  if (shape.length) return { ok: false, problems: shape };
  const c = raw as LinkedConfig;
  if (typeof c.title !== "string" || !c.title.trim()) fail("missing title");
  if (!Array.isArray(c.views) || !c.views.length || c.views.some(v => !VIEW_KINDS.includes(v))) fail(`views must be a list from ${VIEW_KINDS.join(", ")}`);
  const params = c.params && typeof c.params === "object" ? c.params : {};
  const pids = Object.keys(params);
  if (!pids.length || pids.length > 8) fail("declare between 1 and 8 parameters");
  for (const id of pids) {
    const p = params[id];
    if (!/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(id) || RESERVED.has(id)) fail(`bad parameter name “${id}”`);
    if (!p || typeof p.label !== "string" || !isNum(p.min) || !isNum(p.max) || !isNum(p.value) || p.min >= p.max) fail(`parameter “${id}” needs a label and a min < max range`);
  }
  const m = c.model;
  const kind = m?.kind;
  if (kind !== "iterate" && kind !== "ode" && kind !== "function") {
    return { ok: false, problems: [...problems, "model.kind must be iterate, ode or function"] };
  }
  const views = new Set(c.views ?? []);
  const allowView: Record<string, ViewKind[]> = { iterate: ["curve", "trace", "table", "equation"], ode: ["trace", "phase", "table", "equation"], function: ["curve", "table", "equation"] };
  for (const v of views) if (!allowView[kind].includes(v)) fail(`a ${kind} model cannot show a ${v} view`);
  const lab: Lab = {
    config: c, kind, pids, params, views, vars: [], handles: [], columns: [], cuts: [], notes: [], rowNames: [], statNames: [], bind: { p: {} },
  };
  const safe = (src: unknown, names: string[], where: string, funcs = {}): Fn => {
    if (typeof src !== "string") { fail(`${where}: formula missing`); return () => NaN; }
    try { return compile(src, names, funcs).fn; } catch (e) { fail(`${where}: ${e instanceof ExprError ? e.message : "bad formula"}`); return () => NaN; }
  };
  const nameOk = (n: unknown) => typeof n === "string" && /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(n) && !RESERVED.has(n) && !pids.includes(n);
  let fFunc: Record<string, (x: number) => number> = {};
  void fFunc;
  if (kind === "iterate") {
    const im = m as IterateModel;
    if (!nameOk(im.variable)) fail("iterate.variable must be a short new name");
    const v = String(im.variable);
    lab.vars = [v];
    const names = [...pids, v, "n"];
    const range = Array.isArray(im.xRange) && isNum(im.xRange[0]) && isNum(im.xRange[1]) && im.xRange[0] < im.xRange[1];
    if (!range) fail("iterate.xRange must be [min, max]");
    if (!Number.isInteger(im.steps) || im.steps < 2 || im.steps > 200) fail("iterate.steps must be 2–200");
    const map = safe(im.map, names, "map");
    lab.iterate = {
      map, start: safe(im.start, pids, "start"), curve: im.curve ? safe(im.curve, names, "curve") : map,
      measure: im.measure ? safe(im.measure, names, "measure") : im.curve ? safe(im.curve, names, "curve") : (ctx => ctx[v]),
      steps: im.steps, style: im.style === "cobweb" ? "cobweb" : "path", xRange: im.xRange, yRange: im.yRange,
    };
    lab.rowNames = [...pids, v, "n", `next_${v}`];
  } else if (kind === "ode") {
    const om = m as OdeModel;
    const vars = Array.isArray(om.vars) ? om.vars : [];
    if (!vars.length || vars.length > 2 || !vars.every(nameOk)) fail("ode.vars must list one or two short names");
    if (views.has("phase") && vars.length !== 2) fail("a phase view needs two variables");
    lab.vars = vars;
    const names = [...pids, ...vars, "t"];
    if (!isNum(om.duration) || om.duration <= 0) fail("ode.duration must be positive");
    lab.ode = {
      rates: vars.map(v => safe(om.rates?.[v], names, `rate of ${v}`)),
      initial: vars.map(v => safe(om.initial?.[v], pids, `initial ${v}`)),
      dt: safe(om.dt, pids, "dt"), duration: om.duration, reference: !!om.reference, unit: om.timeUnit ?? "",
      ranges: vars.map(v => {
        const r = om.ranges?.[v];
        if (!Array.isArray(r) || !isNum(r[0]) || !isNum(r[1]) || r[0] >= r[1]) { fail(`ode.ranges.${v} must be [min, max]`); return [-1, 1] as [number, number]; }
        return r;
      }),
    };
    lab.rowNames = [...pids, ...vars, "t", "n", ...vars.map(v => `next_${v}`), ...(om.reference ? vars.map(v => `ref_${v}`) : [])];
  } else {
    const fm = m as FunctionModel;
    const xOk = typeof fm.x?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(fm.x.name) && !pids.includes(fm.x.name) && !["pi", "e", "f", "n"].includes(fm.x.name);
    if (!fm.x || !xOk || !isNum(fm.x.min) || !isNum(fm.x.max) || fm.x.min >= fm.x.max) fail("function.x needs a name and a min < max range");
    if (!fm.y || !isNum(fm.y.min) || !isNum(fm.y.max) || fm.y.min >= fm.y.max) fail("function.y needs a min < max range");
    if (!Array.isArray(fm.rows) || !fm.rows.length || fm.rows.length > 12 || !fm.rows.every(isNum)) fail("function.rows must list 1–12 numbers");
    const xn = String(fm.x?.name);
    lab.vars = [xn];
    const f = safe(fm.f, [...pids, xn], "f");
    lab.func = { f, rows: fm.rows ?? [], xname: xn };
    lab.rowNames = [...pids, xn];
  }
  /* Bands, notes and share also get whole-run names: start_<var>, end_<var> (first and last state) and
     period (iterate: detected long-run cycle length, 1 = settles, 0 = no cycle found, −1 = blows up). */
  lab.statNames = [...lab.rowNames, "steps", "final", "first", "settled", "outcome", "diverged", "period",
    ...(kind === "function" ? [] : lab.vars.flatMap(v => [`start_${v}`, `end_${v}`]))];
  if (kind === "function") {
    const f = lab.func!.f, xn = lab.func!.xname;
    /* f(x) is callable in columns, notes and templates, bound to the parameters being shown. */
    fFunc = { f: (x: number) => f({ ...lab.bind.p, [xn]: x }) };
  }
  const funcs = kind === "function" ? fFunc : {};

  if (c.secondary !== undefined) {
    const plots = (["curve", "trace", "phase"] as const).filter(v => views.has(v));
    if (!Array.isArray(c.secondary) || c.secondary.some(v => !plots.includes(v as never))) fail("secondary must list plot views that are shown");
    else if (plots.every(v => c.secondary!.includes(v))) fail("secondary cannot hide every plot");
    else if ((c.handles ?? []).length && (c.handles ?? []).every(h => c.secondary!.includes(h.view as never))) fail("secondary cannot hide every handle");
  }
  /* Handles */
  for (const [i, h] of (c.handles ?? []).entries()) {
    if (i >= 6) { fail("at most 6 handles"); break; }
    if (!h || !["curve", "trace", "phase"].includes(h.view) || !views.has(h.view)) { fail(`handle ${i + 1}: view must be one of the shown views`); continue; }
    if (!Array.isArray(h.vary) || !h.vary.length || h.vary.length > 2 || !h.vary.every(p => pids.includes(p))) { fail(`handle ${i + 1}: vary must name 1–2 parameters`); continue; }
    if (h.at === "start" || h.at === "step") {
      if (kind === "function") { fail(`handle ${i + 1}: a function model needs a point {x, y}`); continue; }
      lab.handles.push({ spec: h });
    } else if (h.at && typeof h.at === "object") {
      lab.handles.push({ spec: h, x: safe(h.at.x, pids, `handle ${i + 1} x`), y: safe(h.at.y, pids, `handle ${i + 1} y`) });
    } else fail(`handle ${i + 1}: at must be "start", "step" or {x, y}`);
  }
  /* Table */
  const defaultCols = kind === "iterate"
    ? [{ label: "n", expr: "n", digits: 0 }, { label: lab.vars[0], expr: lab.vars[0], digits: 3, compare: true }]
    : kind === "ode" ? [{ label: "t", expr: "t", digits: 2 }, ...lab.vars.map((v, i) => ({ label: v, expr: v, digits: 2, compare: i === 0 }))]
    : [{ label: lab.vars[0], expr: lab.vars[0], digits: 1 }, { label: "y", expr: (m as FunctionModel).f, digits: 2, compare: true }];
  const cols = c.table?.columns ?? defaultCols;
  if (!Array.isArray(cols) || cols.length > 5) fail("table: at most 5 columns");
  else for (const col of cols) lab.columns.push({ label: String(col.label ?? ""), fn: safe(col.expr, lab.rowNames, `column “${col.label}”`, funcs), digits: clampInt(col.digits ?? 2, 0, 4), compare: !!col.compare });
  /* Regimes */
  if (c.regimes) {
    const r = c.regimes;
    if (!pids.includes(r.param)) fail("regimes.param must be a parameter");
    if (kind === "function") fail("regimes need an iterate or ode model");
    if (!Array.isArray(r.cuts) || !Array.isArray(r.bands) || r.bands.length !== r.cuts.length + 1 || r.cuts.length > 5) fail("regimes need one more band than cuts (at most 5 cuts)");
    else {
      lab.cuts = r.cuts.map((cut, i) => safe(cut, pids, `cut ${i + 1}`));
      for (const b of r.bands) {
        if (!b || typeof b.name !== "string" || !TONES.includes(b.tone) || typeof b.say !== "string") fail("each band needs a name, tone and say");
        else if (b.short !== undefined && (typeof b.short !== "string" || b.short.length > 16)) fail(`band “${b.name}”: short must be ≤ 16 characters`);
        else if (b.cycle !== undefined && (typeof b.cycle !== "object" || typeof b.cycle.say !== "string" || (b.cycle.tone !== undefined && !TONES.includes(b.cycle.tone)))) fail(`band “${b.name}”: cycle needs say (and a valid tone)`);
        else if (b.cycle && kind !== "iterate") fail(`band “${b.name}”: cycle variants need an iterate model`);
        else if (b.atCut !== undefined && (typeof b.atCut !== "object" || typeof b.atCut.say !== "string" || (b.atCut.tone !== undefined && !TONES.includes(b.atCut.tone)) || b === r.bands[r.bands.length - 1])) fail(`band “${b.name}”: atCut needs say (and a valid tone), and the last band has no upper cut`);
      }
      lab.regime = r;
    }
  }
  for (const [i, nt] of (c.notes ?? []).entries()) {
    if (!nt || typeof nt.say !== "string") { fail(`note ${i + 1} needs say`); continue; }
    lab.notes.push({ when: safe(nt.when, lab.statNames, `note ${i + 1}`, funcs), say: nt.say });
  }
  /* Templates: check every [expr] and {param} parses. */
  const templates: [string, string | undefined, string[]][] = [
    ...(c.equation?.lines ?? []).map(l => ["equation", l, lab.rowNames] as [string, string, string[]]),
    ["equation.live", c.equation?.live, lab.rowNames],
    ...(lab.regime?.bands ?? []).flatMap(b => [["band say", b.say, lab.statNames], ["band learner", b.learner, lab.statNames], ["band reply", b.reply, lab.statNames],
      ["band cycle say", b.cycle?.say, lab.statNames], ["band cycle learner", b.cycle?.learner, lab.statNames], ["band cycle reply", b.cycle?.reply, lab.statNames],
      ["band atCut say", b.atCut?.say, lab.statNames], ["band atCut learner", b.atCut?.learner, lab.statNames], ["band atCut reply", b.atCut?.reply, lab.statNames]] as [string, string | undefined, string[]][]),
    ["table.note", c.table?.note, lab.statNames],
    ...lab.notes.map(n => ["note", n.say, lab.statNames] as [string, string, string[]]),
    ["share.learner", c.share?.learner, lab.statNames], ["share.reply", c.share?.reply, lab.statNames],
  ];
  for (const [where, src, names] of templates) {
    if (src === undefined) continue;
    if (typeof src !== "string" || src.length > 600) { fail(`${where}: must be a short string`); continue; }
    for (const mm of src.matchAll(/\[([^\]]+)\]/g)) {
      const [expr] = mm[1].split("|");
      try { compile(expr, names, funcs); } catch (e) { fail(`${where}: ${e instanceof Error ? e.message : "bad"} in [${expr}]`); }
    }
    for (const mm of src.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) if (!pids.includes(mm[1])) fail(`${where}: unknown parameter {${mm[1]}}`);
  }
  if (problems.length) return { ok: false, problems };
  /* Run-level checks at the starting values. */
  const p0: P = Object.fromEntries(pids.map(id => [id, clamp(params[id].value, params[id].min, params[id].max)]));
  if (kind === "ode") {
    const dt = lab.ode!.dt(p0), steps = lab.ode!.duration / dt;
    if (!(dt > 0)) fail("ode.dt must be positive at the starting values");
    else if (steps > MAX_ODE_STEPS) fail(`ode: duration / dt is ${Math.round(steps)} steps at the start; keep it ≤ ${MAX_ODE_STEPS} (raise dt or shorten duration)`);
  }
  /* An ode trace "step" handle that varies the step size becomes a step ruler on the time axis (moves only
     sideways); one that varies anything else stays where step n lands on the trajectory. */
  for (const h of lab.handles) {
    if (kind !== "ode" || h.spec.view !== "trace" || h.spec.at !== "step") continue;
    const dt0 = lab.ode!.dt(p0);
    h.ruler = h.spec.vary.some(id => { const sp = params[id], d = (sp.max - sp.min) * 0.1; return Math.abs(lab.ode!.dt({ ...p0, [id]: p0[id] + d <= sp.max ? p0[id] + d : p0[id] - d }) - dt0) > 1e-12; });
  }
  /* A handle whose position does not depend on the parameters it varies is drawn but dead. */
  for (const [i, h] of lab.handles.entries()) {
    const at = handleNorm(lab, h, p0);
    if (!at) continue;
    for (const id of h.spec.vary) {
      const spec = params[id], d = (spec.max - spec.min) * 0.1;
      const v = p0[id] + d <= spec.max ? p0[id] + d : p0[id] - d;
      const moved = handleNorm(lab, h, { ...p0, [id]: v });
      if (!moved || Math.hypot(moved.x - at.x, moved.y - at.y) < 0.004) {
        fail(`handle ${i + 1}${h.spec.label ? ` (“${h.spec.label}”)` : ""} does not move when ${id} changes: its position must depend on the parameters it varies`);
      }
    }
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, lab };
}
/** For tests: the detected long-run behaviour of a config at given parameters. */
export function longRun(config: LinkedConfig, p: Record<string, number>): Behaviour | null {
  const r = compileConfig(config);
  return r.ok ? behaviour(r.lab, p) : null;
}
/** For tests: the band a config shows at these parameters (cycle variant applied). */
export function bandAt(config: LinkedConfig, p: Record<string, number>): string | null {
  const r = compileConfig(config);
  return r.ok ? bandView(r.lab, p).band?.name ?? null : null;
}
/** The house validator: [] means valid. */
export function validateLinked(config: unknown): string[] {
  const r = compileConfig(config);
  return r.ok ? [] : r.problems;
}
/** The data ranges a view plots, for handles placed by formulas. */
function viewRanges(lab: Lab, view: HandleSpec["view"], p: P): { xr: [number, number]; yr: [number, number] } | null {
  if (lab.kind === "function") { const fm = lab.config.model as FunctionModel; return view === "curve" ? { xr: [fm.x.min, fm.x.max], yr: [fm.y.min, fm.y.max] } : null; }
  if (lab.kind === "iterate") {
    const it = lab.iterate!;
    if (view === "curve") return { xr: it.xRange, yr: curveRange(lab, p) };
    if (view === "trace") return { xr: [0, it.steps], yr: it.yRange && !(lab.config.model as IterateModel).measure ? it.yRange : measureRange(lab, p) };
    return null;
  }
  const od = lab.ode!;
  if (view === "trace") return { xr: [0, od.duration], yr: od.ranges[0] };
  if (view === "phase" && od.ranges.length > 1) return { xr: od.ranges[0], yr: od.ranges[1] };
  return null;
}
/** A handle's position in its view, normalised to the view's ranges (0..1), or null if it cannot be placed. */
function handleNorm(lab: Lab, h: Lab["handles"][number], p: P): Pt | null {
  const v = h.spec.view;
  const norm = (x: number, y: number, xr: [number, number], yr: [number, number]) =>
    Number.isFinite(x) && Number.isFinite(y) ? { x: (x - xr[0]) / (xr[1] - xr[0]), y: (y - yr[0]) / (yr[1] - yr[0]) } : null;
  if (h.x && h.y) { const vr = viewRanges(lab, v, p); return vr ? norm(h.x(p), h.y(p), vr.xr, vr.yr) : null; }
  const r = simulate(lab, p, false), N = r.m.length;
  if (N < 2) return null;
  const n = h.spec.at === "start" ? 0 : stepN(h.spec, N);
  if (lab.kind === "iterate") {
    const it = lab.iterate!, xs = r.vals[0], yr = curveRange(lab, p), vn = lab.vars[0];
    if (v === "curve") {
      if (it.style === "cobweb") return h.spec.at === "start" ? norm(xs[0], yr[0], it.xRange, yr) : norm(xs[n - 1], xs[n], it.xRange, yr);
      return norm(xs[n], it.curve({ ...p, [vn]: xs[n], n: 0 }), it.xRange, yr);
    }
    if (v === "trace") return norm(n, r.m[n], [0, it.steps], measureRange(lab, p));
    return null;
  }
  const od = lab.ode!;
  if (v === "trace") return norm(r.t[n], h.ruler ? od.ranges[0][0] : r.vals[0][n], [0, od.duration], od.ranges[0]);
  if (v === "phase" && r.vals.length > 1) return norm(r.vals[0][n], r.vals[1][n], od.ranges[0], od.ranges[1]);
  return null;
}
function clampInt(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* =====================================================================================
   Simulation
   ===================================================================================== */
type P = Record<string, number>;
type Run = {
  t: number[]; vals: number[][]; m: number[]; steps: number;
  diverged: number; settled: number; outcome: number;
  /** ode only: the run hit MAX_ODE_STEPS before `duration`. */
  truncated?: boolean;
  ref?: { t: number[]; vals: number[][] };
  refAt?: number[][];
};
const BIG = 1e6;

function funcCtx(lab: Lab, p: P): Record<string, (x: number) => number> {
  if (lab.kind !== "function") return {};
  const f = lab.func!.f, xn = lab.func!.xname;
  return { f: (x: number) => f({ ...p, [xn]: x }) };
}
/** Evaluate a compiled column/note with f() bound to these parameters. */
function withBind<T>(lab: Lab, p: P, run: () => T): T { const old = lab.bind.p; lab.bind.p = p; try { return run(); } finally { lab.bind.p = old; } }

function simulate(lab: Lab, p: P, withRef = true): Run {
  if (lab.kind === "iterate") {
    const it = lab.iterate!, v = lab.vars[0];
    const ctx: Ctx = { ...p };
    let x = it.start(p);
    const vals = [x], m: number[] = [];
    let diverged = -1;
    for (let n = 0; n <= it.steps; n++) {
      ctx[v] = x; ctx.n = n;
      m.push(it.measure(ctx));
      if (n === it.steps) break;
      let nx = it.map(ctx);
      if (!Number.isFinite(nx) || Math.abs(nx) > BIG) { if (diverged < 0) diverged = n + 1; nx = Number.isFinite(nx) ? Math.sign(nx) * BIG : BIG; }
      vals.push(nx); x = nx;
    }
    const span = it.yRange ? it.yRange[1] - it.yRange[0] : curveRange(lab, p)[1] - curveRange(lab, p)[0];
    return finish({ t: vals.map((_, i) => i), vals: [vals], m, steps: it.steps, diverged, settled: -1, outcome: 0 }, span);
  }
  if (lab.kind === "ode") {
    const od = lab.ode!, vars = lab.vars;
    const dt = clamp(od.dt(p), 1e-3, od.duration);
    const want = Math.floor(od.duration / dt + 1e-9), steps = Math.min(MAX_ODE_STEPS, want);
    const vals = vars.map(() => [] as number[]);
    let state = od.initial.map(f => f(p));
    const ctx: Ctx = { ...p };
    const t: number[] = [];
    let diverged = -1;
    for (let n = 0; n <= steps; n++) {
      t.push(n * dt);
      state.forEach((s, i) => vals[i].push(s));
      if (n === steps) break;
      vars.forEach((v, i) => { ctx[v] = state[i]; }); ctx.t = n * dt;
      state = state.map((s, i) => {
        let nx = s + dt * od.rates[i](ctx);
        if (!Number.isFinite(nx) || Math.abs(nx) > BIG) { if (diverged < 0) diverged = n + 1; nx = Number.isFinite(nx) ? Math.sign(nx) * BIG : BIG; }
        return nx;
      });
    }
    const run: Run = { t, vals, m: vals[0], steps, diverged, settled: -1, outcome: 0, truncated: want > steps };
    if (od.reference && withRef) {
      run.ref = reference(lab, p);
      const rt = run.ref.t, h = rt[1] - rt[0];
      run.refAt = vars.map((_, i) => t.map(tt => {
        const j = Math.min(rt.length - 2, Math.floor(tt / h)), f = (tt - rt[j]) / h;
        return run.ref!.vals[i][j] * (1 - f) + run.ref!.vals[i][j + 1] * f;
      }));
    }
    return finish(run, od.ranges[0][1] - od.ranges[0][0]);
  }
  return { t: [], vals: [], m: [], steps: 0, diverged: -1, settled: -1, outcome: 0 };
}
const refCache = new Map<string, { t: number[]; vals: number[][] }>();
function reference(lab: Lab, p: P) {
  const key = JSON.stringify(p) + lab.config.title;
  const hit = refCache.get(key);
  if (hit) return hit;
  const od = lab.ode!, vars = lab.vars, N = 600, h = od.duration / N;
  const ctx: Ctx = { ...p };
  const deriv = (s: number[], tt: number) => { vars.forEach((v, i) => { ctx[v] = s[i]; }); ctx.t = tt; return od.rates.map(r => r(ctx)); };
  let s = od.initial.map(f => f(p));
  const t = [0], vals = vars.map((_, i) => [s[i]]);
  for (let n = 0; n < N; n++) {
    const tt = n * h;
    const k1 = deriv(s, tt), k2 = deriv(s.map((x, i) => x + h / 2 * k1[i]), tt + h / 2);
    const k3 = deriv(s.map((x, i) => x + h / 2 * k2[i]), tt + h / 2), k4 = deriv(s.map((x, i) => x + h * k3[i]), tt + h);
    s = s.map((x, i) => x + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    t.push(tt + h); s.forEach((x, i) => vals[i].push(x));
  }
  const out = { t, vals };
  if (refCache.size > 200) refCache.clear();
  refCache.set(key, out);
  return out;
}
function finish(run: Run, span: number): Run {
  const m = run.m, N = m.length;
  const last = m[N - 1];
  let settled = -1;
  if (run.diverged < 0) {
    const tol = 0.01 * span;
    for (let i = N - 1; i >= 0; i--) { if (Math.abs(m[i] - last) > tol) { settled = i + 1 < N - 1 ? i + 1 : -1; break; } if (i === 0) settled = 0; }
  }
  const q = Math.max(1, Math.floor(N / 4));
  const head = Math.max(1e-9, Math.abs(m[0]) || Math.max(...m.slice(0, q).map(Math.abs)));
  const tail = Math.max(...m.slice(N - q).map(Math.abs));
  run.settled = settled;
  run.outcome = clamp(Math.log10((tail + 1e-12) / head), -12, 4);
  return run;
}
function curveRange(lab: Lab, p: P): [number, number] {
  const it = lab.iterate!;
  if (it.yRange) return it.yRange;
  const v = lab.vars[0], ctx: Ctx = { ...p, n: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 60; i++) {
    ctx[v] = it.xRange[0] + (it.xRange[1] - it.xRange[0]) * i / 60;
    const y = it.curve(ctx);
    if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) return [0, 1];
  const pad = (hi - lo) * 0.06;
  return [lo >= 0 && lo < (hi - lo) * 0.2 ? 0 : lo - pad, hi + pad];
}
function bandOf(lab: Lab, p: P): number {
  if (!lab.regime) return -1;
  const v = p[lab.regime.param];
  const cuts = lab.cuts.map(c => c(p));
  let i = 0;
  while (i < cuts.length && v > cuts[i]) i++;
  return i;
}
/* ---------- Long-run behaviour (iterate models): find the cycle the run actually settles into ---------- */
export type Behaviour = { period: number; values: number[]; lo: number; hi: number };
const behaviourCache = new Map<string, Behaviour>();
/** period: 1 = settles to a point, p = cycle of period p (≤ 12), 0 = no cycle found (chaos or very slow), −1 = blows up. */
function behaviour(lab: Lab, p: P): Behaviour {
  if (lab.kind !== "iterate") return { period: 0, values: [], lo: NaN, hi: NaN };
  const key = lab.config.title + JSON.stringify(p);
  const hit = behaviourCache.get(key);
  if (hit) return hit;
  const it = lab.iterate!, v = lab.vars[0], ctx: Ctx = { ...p, n: 0 };
  const span = Math.max(1e-9, it.xRange[1] - it.xRange[0]);
  let x = it.start(p);
  const tail: number[] = [];
  let out: Behaviour | null = null;
  for (let i = 0; i < 1600; i++) {
    ctx[v] = x; x = it.map(ctx);
    if (!Number.isFinite(x) || Math.abs(x) > BIG) { out = { period: -1, values: [], lo: NaN, hi: NaN }; break; }
    if (i >= 1600 - 96) tail.push(x);
  }
  if (!out) {
    const lo = Math.min(...tail), hi = Math.max(...tail), tol = 1e-6 * span;
    let period = 0;
    for (let per = 1; per <= 12 && !period; per++) {
      let ok = true;
      for (let i = 0; i + per < tail.length && ok; i++) if (Math.abs(tail[i] - tail[i + per]) > tol) ok = false;
      if (ok) period = per;
    }
    out = { period, values: period ? tail.slice(-period).sort((a, b) => a - b) : [], lo, hi };
  }
  if (behaviourCache.size > 400) behaviourCache.clear();
  behaviourCache.set(key, out);
  return out;
}
/** The band for these parameters, switched to its cycle variant when the run really cycles (period ≥ 2). */
function bandView(lab: Lab, p: P): { index: number; band: RegimeBand | null; cycle: boolean } {
  const index = bandOf(lab, p);
  if (index < 0) return { index, band: null, cycle: false };
  const b = lab.regime!.bands[index];
  if (b.atCut && index < lab.cuts.length) {
    const spec = lab.params[lab.regime!.param], cut = lab.cuts[index](p);
    if (Number.isFinite(cut) && Math.abs(p[lab.regime!.param] - cut) <= 1e-6 * (spec.max - spec.min))
      return { index, cycle: false, band: { ...b, ...b.atCut, name: b.atCut.name ?? b.name, tone: b.atCut.tone ?? b.tone, short: b.atCut.short ?? b.short } };
  }
  if (b.cycle && behaviour(lab, p).period >= 2) return { index, cycle: true, band: { ...b, ...b.cycle, name: b.cycle.name ?? b.name, tone: b.cycle.tone ?? b.tone } };
  return { index, band: b, cycle: false };
}
function stats(lab: Lab, p: P, run: Run, cursor: number): Ctx {
  const N = run.m.length;
  const ctx: Ctx = {
    ...rowCtx(lab, p, run, lab.kind === "function" ? cursor : Math.round(cursor)),
    steps: run.steps, final: run.m[N - 1] ?? NaN, first: run.m[0] ?? NaN, settled: run.settled, outcome: run.outcome, diverged: run.diverged >= 0 ? 1 : 0,
    period: behaviour(lab, p).period,
  };
  if (lab.kind !== "function") lab.vars.forEach((v, k) => { ctx[`start_${v}`] = run.vals[k][0]; ctx[`end_${v}`] = run.vals[k][N - 1]; });
  return ctx;
}
function rowCtx(lab: Lab, p: P, run: Run, i: number): Ctx {
  if (lab.kind === "function") return { ...p, [lab.func!.xname]: i };
  const ctx: Ctx = { ...p, n: i };
  if (lab.kind === "ode") ctx.t = run.t[i] ?? NaN;
  lab.vars.forEach((v, k) => {
    ctx[v] = run.vals[k][i] ?? NaN;
    ctx[`next_${v}`] = run.vals[k][i + 1] ?? NaN;
    if (run.refAt) ctx[`ref_${v}`] = run.refAt[k][i] ?? NaN;
  });
  return ctx;
}

/* ---------- Number formatting and templates ---------- */
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export function fmt(v: number, digits = 2): string {
  if (Number.isNaN(v)) return "–";
  if (!Number.isFinite(v) || Math.abs(v) >= BIG * 0.999) return v < 0 ? "−∞" : "∞";
  if (Math.abs(v) >= 1e5) {
    const e = Math.floor(Math.log10(Math.abs(v)));
    return `${(v / 10 ** e).toFixed(1)}×10${String(e).split("").map(ch => SUP[ch]).join("")}`.replace("-", "−");
  }
  let s = v.toFixed(digits);
  if (/^-0\.?0*$/.test(s)) s = s.slice(1);
  return s.replace("-", "−");
}
function fill(src: string | undefined, lab: Lab, ctx: Ctx, p: P): string {
  if (!src) return "";
  const funcs = funcCtx(lab, p);
  return src
    .replace(/\[([^\]]+)\]/g, (_, body: string) => {
      const [expr, d] = body.split("|");
      try { return fmt(compile(expr, Object.keys(ctx), funcs).fn(ctx), d === undefined ? 2 : Number(d)); } catch { return "?"; }
    })
    .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, id: string) => (lab.params[id] ? fmt(p[id], lab.params[id].digits ?? 2) : id));
}
function liveValue(expr: string, lab: Lab, ctx: Ctx, p: P) {
  try { return compile(expr, Object.keys(ctx), funcCtx(lab, p)).fn(ctx); } catch { return NaN; }
}

/* Rich equation text: x_{n+1}, w^2, {param} scrubbers, [expr|digits] live numbers. */
function rich(src: string, onParam: (id: string) => ReactNode, onExpr: (expr: string, digits: number) => ReactNode, key = "r"): ReactNode[] {
  const out: ReactNode[] = [];
  let text = "", i = 0, k = 0;
  const flush = () => { if (text) { out.push(<Fragment key={`${key}t${k++}`}>{text.replace(/\*/g, "·")}</Fragment>); text = ""; } };
  const group = (start: number): [string, number] => {
    let depth = 0, j = start;
    for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (depth === 0) break; } }
    return [src.slice(start + 1, j), j + 1];
  };
  const atom = (start: number): [ReactNode[], number] => {
    if (src[start] === "{") { const [inner, end] = group(start); return [rich(inner, onParam, onExpr, `${key}g${k++}`), end]; }
    if (src[start] === "[") { const end = src.indexOf("]", start); const [e, d] = src.slice(start + 1, end).split("|"); return [[<Fragment key={`${key}e${k++}`}>{onExpr(e, d === undefined ? 2 : Number(d))}</Fragment>], end + 1]; }
    return [[src[start] ?? ""], start + 1];
  };
  while (i < src.length) {
    const ch = src[i];
    if ((ch === "_" || ch === "^") && i + 1 < src.length) {
      flush();
      const [nodes, end] = atom(i + 1);
      out.push(ch === "_" ? <sub key={`${key}s${k++}`}>{nodes}</sub> : <sup key={`${key}s${k++}`}>{nodes}</sup>);
      i = end; continue;
    }
    const pm = ch === "{" ? /^\{([A-Za-z][A-Za-z0-9]*)\}/.exec(src.slice(i)) : null;
    if (pm) { flush(); out.push(<Fragment key={`${key}p${k++}`}>{onParam(pm[1])}</Fragment>); i += pm[0].length; continue; }
    if (ch === "[") { flush(); const [nodes, end] = atom(i); out.push(...nodes); i = end; continue; }
    text += ch; i++;
  }
  flush();
  return out;
}

/* =====================================================================================
   Geometry
   ===================================================================================== */
type Box = { x: number; y: number; w: number; h: number };
type Panel = { view: "curve" | "trace" | "phase" | "sweep"; outer: Box; plot: Box; title: string };
type Pt = { x: number; y: number };
const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

function layout(W: number, lab: Lab, hidden: Set<string> = new Set()): { panels: Panel[]; H: number } {
  const narrow = W < 460;
  const pads = { l: narrow ? 36 : 44, r: 14, t: 26, b: 34 };
  const panels: Panel[] = [];
  let y = 4;
  const L = lab.config.labels ?? {};
  const add = (view: Panel["view"], h: number, title: string, x = 0, w = W) => {
    const t = view === "sweep" ? 38 : pads.t;
    panels.push({ view, title, outer: { x, y, w, h }, plot: { x: x + pads.l, y: y + t, w: w - pads.l - pads.r, h: h - t - pads.b } });
  };
  const im = lab.config.model as IterateModel | FunctionModel;
  const has = (v: ViewKind) => lab.views.has(v) && !hidden.has(v);
  if (has("curve")) {
    const cob = lab.iterate?.style === "cobweb";
    const h = cob ? clamp(W * 0.6, 220, 290) : clamp(W * 0.36, 190, 222);
    add("curve", h, L.curve ?? (lab.kind === "function" ? (im as FunctionModel).y.label : (im as IterateModel).yLabel ?? "Curve"));
    y += h + 6;
  }
  const hasPhase = has("phase"), hasTrace = has("trace");
  if (hasPhase && hasTrace && W >= 600) {
    const pw = 236, h = 220;
    add("trace", h, L.trace ?? "Over time", 0, W - pw - 8);
    add("phase", h, L.phase ?? "Phase", W - pw, pw);
    y += h + 6;
  } else {
    if (hasTrace) { const h = lab.kind === "ode" ? 170 : 124; add("trace", h, L.trace ?? "Over time"); y += h + 6; }
    if (hasPhase) { const h = clamp(W * 0.8, 210, 260); add("phase", h, L.phase ?? "Phase"); y += h + 6; }
  }
  if (lab.regime) { const h = lab.regime.sweep === "orbit" ? 136 : 114; add("sweep", h, lab.regime.axisLabel ?? lab.params[lab.regime.param].label); y += h; }
  return { panels, H: Math.ceil(y + 4) };
}
function clipSeg(a: Pt, b: Pt, r: Box): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges: [number, number][] = [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]];
  for (const [pp, q] of edges) {
    if (pp === 0) { if (q < 0) return null; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}
const inside = (p: Pt, r: Box, m = 0) => p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m;
const clampPt = (p: Pt, r: Box, m = 0): Pt => ({ x: clamp(p.x, r.x - m, r.x + r.w + m), y: clamp(p.y, r.y - m, r.y + r.h + m) });
const sane = (v: number) => (Number.isFinite(v) ? clamp(v, -1e5, 1e5) : 1e5);
const P2 = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
function polyline(pts: Pt[], r: Box): string {
  let d = "", pen = false;
  for (let i = 1; i < pts.length; i++) {
    const s = clipSeg(pts[i - 1], pts[i], r);
    if (!s) { pen = false; continue; }
    d += pen ? `L${P2(s[1])}` : `M${P2(s[0])}L${P2(s[1])}`;
    pen = inside(pts[i], r, 0.5);
  }
  return d || "M0,0";
}
function arrow(a: Pt, b: Pt, r: Box, head = 7): string {
  const s = clipSeg(a, b, r);
  if (!s) return "M0,0";
  const [p, q] = s;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 2) return `M${P2(p)}L${P2(q)}`;
  const ang = Math.atan2(q.y - p.y, q.x - p.x), hl = Math.min(head, len * 0.45);
  const h1 = { x: q.x - hl * Math.cos(ang - 0.42), y: q.y - hl * Math.sin(ang - 0.42) };
  const h2 = { x: q.x - hl * Math.cos(ang + 0.42), y: q.y - hl * Math.sin(ang + 0.42) };
  return `M${P2(p)}L${P2(q)}M${P2(h1)}L${P2(q)}L${P2(h2)}`;
}
/* Dots as zero-length round-capped strokes: only M/h commands, which Dragology's path blending handles. */
function dots(pts: Pt[], r: Box, rad = 2.6): { d: string; strokeWidth: number } {
  let d = "";
  for (const p of pts) if (inside(p, r, 1)) d += `M${p.x.toFixed(1)},${p.y.toFixed(1)}h0.01`;
  return { d: d || "M0,0", strokeWidth: rad * 2 };
}
function ticks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count + 0.5) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}
const tickFmt = (v: number) => { const a = Math.abs(v); return fmt(v, a >= 10 || Number.isInteger(v) ? 0 : a >= 1 ? 1 : 2); };

/* =====================================================================================
   Component
   ===================================================================================== */
type State = { p: P; cursor: number };
type Pinned = { p: P };
type Tried = { v: number; o: number; orbit?: number[]; tone: Tone; id: number };

export function LinkedLab({ config, onChange, onShare }: { config: LinkedConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const result = useMemo(() => compileConfig(config), [config]);
  if (!result.ok) {
    return <section className="activity linked is-fallback" data-simulation="linked-lab">
      <h3 className="ll-title">{typeof config?.title === "string" && config.title ? config.title : "Linked lab"}</h3>
      <p className="ll-fallback">This lab couldn’t be drawn from its description, so here is the reply without it.</p>
      <details className="receipt"><summary>What was wrong</summary>
        <div className="receipt-details">{result.problems.slice(0, 4).map((p, i) => <p key={i}>{p}</p>)}</div>
      </details>
    </section>;
  }
  return <Lab key={config.title} lab={result.lab} onChange={onChange} onShare={onShare} />;
}

function initialState(lab: Lab): State {
  const p: P = {};
  for (const id of lab.pids) { const s = lab.params[id]; p[id] = clamp(s.value, s.min, s.max); }
  const fm = lab.config.model as FunctionModel;
  return { p, cursor: lab.kind === "function" ? clamp(fm.probe ?? fm.rows[0], fm.x.min, fm.x.max) : 0 };
}
function snapParam(spec: ParamSpec, v: number) {
  const step = spec.step ?? (spec.max - spec.min) / 100;
  const s = Math.round((v - spec.min) / step) * step + spec.min;
  return clamp(Number(s.toFixed(6)), spec.min, spec.max);
}

function Lab({ lab, onChange, onShare }: { lab: Lab; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = "ll" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  /* SSR-safe: a fixed first width (identical on server and client); the ResizeObserver below measures after mount. */
  const [W, setW] = useState(600);
  /* Bumping this remounts the renderer on the committed state: an interrupted gesture or a width change
     mid-drag discards the live preview instead of dropping the hovered candidate. */
  const [renderKey, setRenderKey] = useState(0);
  const draggingRef = useRef(false);
  const [model, setModel] = useState<State>(() => initialState(lab));
  const [live, setLive] = useState<State | null>(null);
  const [history, setHistory] = useState<State[]>([]);
  const [pin, setPin] = useState<Pinned | null>(null);
  const [found, setFound] = useState<Set<number>>(() => new Set(lab.regime ? [bandOf(lab, initialState(lab).p)] : []));
  const [tried, setTried] = useState<Tried[]>(() => {
    const s0 = initialState(lab);
    if (!lab.regime) return [];
    const b0 = bandOf(lab, s0.p);
    return [{ v: s0.p[lab.regime.param], o: simulate(lab, s0.p, false).outcome, tone: lab.regime.bands[b0].tone, id: 0, orbit: lab.regime.sweep === "orbit" ? orbitOf(lab, s0.p) : undefined }];
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);
  const [touched, setTouched] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [reduced, setReduced] = useState(false);
  const triedId = useRef(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const resize = () => setW(prev => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      if (w !== prev && draggingRef.current) { draggingRef.current = false; setDragging(null); setLive(null); setRenderKey(k => k + 1); }
      return w;
    });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync(); q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  const view = live ?? model;
  const secondary = (lab.config.secondary ?? []).filter(v => lab.views.has(v));
  const { panels, H } = layout(W, lab, new Set(showSecondary ? [] : secondary));
  const runFor = useCallback((p: P, withRef = true) => simulate(lab, p, withRef), [lab]);
  const run = useMemo(() => runFor(view.p), [runFor, view.p]);
  const pinRun = useMemo(() => (pin ? runFor(pin.p) : null), [runFor, pin]);
  const band = bandOf(lab, view.p);
  const bv = bandView(lab, view.p);
  const tone: Tone = bv.band?.tone ?? "info";

  /* The sweep: every value of the regime parameter at once (one rung up the ladder). */
  const sweepKey = lab.regime ? JSON.stringify({ ...view.p, [lab.regime.param]: 0 }) : "";
  const allFound = !!lab.regime && found.size === lab.regime.bands.length;
  const sweep = useMemo(() => {
    if (!lab.regime || !allFound) return null;
    const spec = lab.params[lab.regime.param], N = lab.regime.sweep === "orbit" ? 150 : 90;
    const p0 = JSON.parse(sweepKey) as P;
    return Array.from({ length: N + 1 }, (_, i) => {
      const v = spec.min + (spec.max - spec.min) * i / N;
      const p = { ...p0, [lab.regime!.param]: v };
      if (lab.regime!.sweep === "orbit") return { v, o: 0, orbit: orbitOf(lab, p) };
      return { v, o: runFor(p, false).outcome };
    });
  }, [lab, sweepKey, runFor, allFound]);

  const commit = useCallback((next: State, how: string) => {
    const s = { ...next, cursor: lab.kind === "function" ? next.cursor : Math.round(next.cursor) };
    if (JSON.stringify(model) !== JSON.stringify(s)) setHistory(h => [...h.slice(-19), model]);
    setModel(s);
    setLive(null);
    setShared(false);
    setTouched(true);
    onChange?.();
    if (how === "cursor") return;
    const r = simulate(lab, s.p, false);
    const bvs = bandView(lab, s.p), b = bvs.index;
    if (lab.regime && b >= 0 && bvs.band) {
      setFound(f => (f.has(b) ? f : new Set([...f, b])));
      const v = s.p[lab.regime.param];
      setTried(list => [...list.filter(t => Math.abs(t.v - v) > 1e-9).slice(-23), {
        v, o: r.outcome, tone: bvs.band!.tone, id: ++triedId.current,
        orbit: lab.regime!.sweep === "orbit" ? orbitOf(lab, s.p) : undefined,
      }]);
      setStatus(`${bvs.band.name}. ${fill(bvs.band.say, lab, stats(lab, s.p, r, s.cursor), s.p)}`);
    } else setStatus(paramSummary(lab, s.p));
  }, [lab, onChange, model]);

  /* Stable renderer callbacks: Dragology calls onDragStatus from a layout effect keyed on the callback, so an
     inline arrow would re-fire it on every render and can chain into a "maximum update depth" loop. */
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const onDragState = useCallback((s: State) => setLive(s), []);
  const onDropState = useCallback((s: State) => commitRef.current(s, "drag"), []);
  const onDragStatus = useCallback((st: { type: string; behaviorCtx?: unknown }) => {
    const next = st.type === "dragging" ? (st.behaviorCtx as { draggedId?: string } | undefined)?.draggedId ?? "drag" : null;
    draggingRef.current = next !== null;
    setDragging(prev => (prev === next ? prev : next));
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => { draggingRef.current = false; setDragging(null); setLive(null); setRenderKey(k => k + 1); setStatus("Drag interrupted; nothing changed."); };
    document.addEventListener("pointercancel", cancel, true);
    return () => document.removeEventListener("pointercancel", cancel, true);
  }, [dragging]);

  const setParam = (id: string, v: number, final: boolean) => {
    const next = { ...model, p: { ...model.p, [id]: v } };
    if (final) commit(next, "param");
    else setLive(next);
  };
  const setCursor = (c: number) => {
    const max = lab.kind === "function" ? (lab.config.model as FunctionModel).x.max : run.m.length - 1;
    const min = lab.kind === "function" ? (lab.config.model as FunctionModel).x.min : 0;
    commit({ ...model, cursor: clamp(c, min, max) }, "cursor");
    setStatus(cursorSummary(lab, model.p, run, clamp(c, min, max)));
  };

  /* ---------- the draggable canvas ---------- */
  const fin = (spec: DragSpec<State>) => (reduced ? spec.withDropTransition(false) : spec);
  const vary = (d: Parameters<Draggable<State>>[0]["d"], s: State, ids: string[]) =>
    fin(d.vary(s, ids.map(id => param<State>("p", id)) as never, {
      constraint: st => ids.map(id => inOrder([lab.params[id].min, st.p[id], lab.params[id].max])),
    }).onDrop(st => ({ ...st, p: { ...st.p, ...Object.fromEntries(ids.map(id => [id, snapParam(lab.params[id], st.p[id])])) } })));

  const draggable: Draggable<State> = ({ state, d, draggedId, isTracking }) => {
    const p = state.p;
    const r = simulate(lab, p, !isTracking);
    const els: Record<string, ReactNode> = {};
    const out: ReactNode[] = [];
    for (const panel of panels) {
      const parts = renderPanel(panel, state, r, d, isTracking);
      out.push(<g id={`${uid}-panel-${panel.view}`}>{parts.body}</g>);
      Object.assign(els, parts.handles);
    }
    if (isTracking && draggedId && els[draggedId]) return <g>{els[draggedId]}</g>;
    return <g>
      {out}
      {Object.entries(els).map(([, el]) => el)}
    </g>;
  };

  function renderPanel(panel: Panel, state: State, r: Run, d: Parameters<Draggable<State>>[0]["d"], tracking: boolean) {
    const { plot, outer } = panel, p = state.p;
    const handles: Record<string, ReactNode> = {};
    const body: ReactNode[] = [];
    const tb = band >= 0 ? bandOf(lab, p) : -1;
    const tid = (axis: string, v: number) => `${uid}-${panel.view}-${axis}t-${String(+v.toFixed(4)).replace(".", "p").replace("-", "m")}`;
    const tn: Tone = tb >= 0 ? bandView(lab, p).band!.tone : "info";
    const frame = (xs: number[], ys: number[], X: (v: number) => number, Y: (v: number) => number, xl?: string, yl?: string) => <g className="ll-frame">
      <rect className="ll-plot-bg" x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={4} />
      {ys.map(v => <g id={tid("y", v)} transform={translate(0, Y(v))}><line className="ll-grid" x1={plot.x} x2={plot.x + plot.w} />
        <text className="ll-tick" transform={translate(plot.x - 10, 3.5)} textAnchor="end">{tickFmt(v)}</text></g>)}
      {xs.map(v => <text id={tid("x", v)} className="ll-tick" transform={translate(X(v), plot.y + plot.h + 18)} textAnchor={X(v) > plot.x + plot.w - 12 ? "end" : "middle"}>{tickFmt(v)}</text>)}
      <text className="ll-panel-title" transform={translate(outer.x + 2, outer.y + 13)}>{panel.title}</text>
      {xl ? <text className="ll-axis-label" transform={translate(plot.x + plot.w, plot.y + plot.h + 31)} textAnchor="end">{xl}</text> : <g />}
      {yl ? <text className="ll-axis-label" transform={translate(plot.x + 6, plot.y + 12)} textAnchor="start">{yl}</text> : <g />}
    </g>;
    /* Label boxes already placed in this panel, so later labels (the probe) can avoid them. */
    const boxes: Box[] = [];
    const labelW = (text: string) => text.length * 6.2 + 6;
    /* Centre a label over x but keep it inside the plot (never over the y ticks or past the right edge). */
    const fitX = (x: number, w: number) => clamp(x, plot.x + w / 2 + 2, plot.x + plot.w - w / 2 - 2) - x;
    const handle = (id: string, at: Pt, spec: HandleSpec, cursor = "grab") => {
      const c = clampPt(at, plot, 4);
      const lw = spec.label ? labelW(spec.label) : 0, ldx = spec.label ? fitX(c.x, lw) : 0, ldy = c.y - plot.y < 26 ? 24 : -14;
      if (spec.label) boxes.push({ x: c.x + ldx - lw / 2, y: c.y + ldy - 10, w: lw, h: 13 });
      boxes.push({ x: c.x - 9, y: c.y - 9, w: 18, h: 18 });
      handles[id] = <g id={id} transform={translate(c.x, c.y)} className="ll-handle" style={{ cursor }}
        data-handle={spec.label ?? spec.at} dragologyZIndex={10}
        dragologyOnDrag={() => vary(d, state, spec.vary)}>
        <circle r={16} className="ll-hit" />
        <circle r={7.5} className="ll-knob" />
        <circle r={2.5} className="ll-knob-dot" />
      </g>;
      /* The label is a sibling, not part of the grab target, so the handle's box stays centred on the knob. */
      if (spec.label) body.push(<g id={`${id}-label`} className="ll-handle-label-wrap" transform={translate(c.x + ldx, c.y + ldy)} pointerEvents="none">
        <text className="ll-handle-label" textAnchor="middle">{spec.label}</text></g>);
    };

    if (panel.view === "curve" && lab.kind === "iterate") {
      const it = lab.iterate!, v = lab.vars[0];
      const yr = curveRange(lab, p);
      const X = lin(it.xRange[0], it.xRange[1], plot.x, plot.x + plot.w), Y = lin(yr[0], yr[1], plot.y + plot.h, plot.y);
      const cv = (x: number) => it.curve({ ...p, [v]: x, n: 0 });
      const curvePts = Array.from({ length: 121 }, (_, i) => { const x = it.xRange[0] + (it.xRange[1] - it.xRange[0]) * i / 120; return { x: X(x), y: Y(sane(cv(x))) }; });
      body.push(frame(ticks(it.xRange[0], it.xRange[1], W < 460 ? 4 : 6), ticks(yr[0], yr[1], 3), X, Y, (lab.config.model as IterateModel).xLabel));
      body.push(<path className="ll-curve" d={polyline(curvePts, plot)} />);
      const xs = r.vals[0];
      const ptsOf = (vals: number[], pp: P) => vals.map(x => ({ x: X(sane(x)), y: Y(sane(it.curve({ ...pp, [v]: x, n: 0 }))) }));
      const R = { x: plot.x - 2, y: plot.y - 2, w: plot.w + 4, h: plot.h + 4 };
      if (it.style === "cobweb") {
        body.push(<path className="ll-diagonal" d={polyline([{ x: X(it.xRange[0]), y: Y(it.xRange[0]) }, { x: X(it.xRange[1]), y: Y(it.xRange[1]) }], plot)} />);
        const web = (vals: number[]) => { const out: Pt[] = [{ x: X(vals[0]), y: Y(yr[0]) }]; for (let i = 0; i < vals.length - 1; i++) { out.push({ x: X(vals[i]), y: Y(vals[i + 1]) }, { x: X(vals[i + 1]), y: Y(vals[i + 1]) }); } return out; };
        if (pinRun && !tracking) body.push(<path id={`${uid}-pin-web`} className="ll-pin-line" d={polyline(web(pinRun.vals[0]), R)} />);
        const wpts = web(xs);
        body.push(<g id={`${uid}-run-curve-${tn}`} className={`ll-run ll-tone-${tn}`}>
          <path className="ll-web" d={polyline(wpts, R)} />
          <path className="ll-step-arrow" d={arrow(wpts[0], wpts[1], R, 8)} />
        </g>);
        const ci = clamp(Math.round(state.cursor), 0, xs.length - 2);
        body.push(<g id={`${uid}-curve-cursor`} className="ll-cursor-mark" transform={translate(clampPt({ x: X(xs[ci]), y: Y(xs[ci + 1]) }, plot).x, clampPt({ x: X(xs[ci]), y: Y(xs[ci + 1]) }, plot).y)}><circle r={4.5} /></g>);
        for (const [i, h] of lab.handles.entries()) {
          if (h.spec.view !== "curve") continue;
          if (h.x && h.y) { handle(`${uid}-h-${i}`, { x: X(h.x(p)), y: Y(h.y(p)) }, h.spec, "move"); continue; }
          const k = stepN(h.spec, xs.length);
          const at = h.spec.at === "start" ? { x: X(xs[0]), y: Y(yr[0]) } : { x: X(sane(xs[k - 1])), y: Y(sane(xs[k])) };
          handle(`${uid}-h-${i}`, at, h.spec, h.spec.at === "start" ? "ew-resize" : "ns-resize");
        }
      } else {
        const pts = ptsOf(xs, p);
        if (pinRun && !tracking) {
          const pp = ptsOf(pinRun.vals[0], pin!.p);
          body.push(<path id={`${uid}-pin-path`} className="ll-pin-line" d={pp.slice(0, -1).map((a, i) => arrow(a, pp[i + 1], R, 5)).join("")} />);
        }
        body.push(<g id={`${uid}-run-curve-${tn}`} className={`ll-run ll-tone-${tn}`}>
          {pts.slice(0, -1).map((a, i) => <path className={i === 0 ? "ll-step-arrow" : "ll-arrow"} opacity={i === 0 ? 1 : Math.max(0.28, 1 - i * 0.07)} d={arrow(a, pts[i + 1], R, i === 0 ? 9 : 6.5)} />)}
          <path className="ll-dots" {...dots(pts.slice(1), plot, 2.4)} />
        </g>);
        const ci = clamp(Math.round(state.cursor), 0, pts.length - 1);
        const cp = pts[ci];
        body.push(<g id={`${uid}-curve-cursor`} className="ll-cursor-mark" transform={translate(clampPt(cp, plot).x, clampPt(cp, plot).y)}><circle r={5.5} /></g>);
        const off = pts.findIndex(pt => !inside(pt, plot, 2));
        if (off > 0) {
          const e = clampPt(pts[off], plot, 0);
          void e;
          body.push(<g id={`${uid}-offchart-${tn}`} className={`ll-offchart ll-tone-${tn}`} transform={translate(plot.x + plot.w - 6, plot.y + 12)}>
            <text textAnchor="end">{`${stepWord(lab, r, off)} leaves the chart`}</text></g>);
        }
        for (const [i, h] of lab.handles.entries()) {
          if (h.spec.view !== "curve") continue;
          if (h.x && h.y) { handle(`${uid}-h-${i}`, { x: X(h.x(p)), y: Y(h.y(p)) }, h.spec, "move"); continue; }
          handle(`${uid}-h-${i}`, h.spec.at === "start" ? pts[0] : pts[stepN(h.spec, pts.length)], h.spec);
        }
      }
    }

    if (panel.view === "curve" && lab.kind === "function") {
      const fm = lab.config.model as FunctionModel, f = lab.func!.f, xn = lab.func!.xname;
      const X = lin(fm.x.min, fm.x.max, plot.x, plot.x + plot.w), Y = lin(fm.y.min, fm.y.max, plot.y + plot.h, plot.y);
      const ptsFor = (pp: P) => Array.from({ length: 97 }, (_, i) => { const x = fm.x.min + (fm.x.max - fm.x.min) * i / 96; return { x: X(x), y: Y(sane(f({ ...pp, [xn]: x }))) }; });
      body.push(frame(ticks(fm.x.min, fm.x.max, W < 460 ? 4 : 6), ticks(fm.y.min, fm.y.max, 3), X, Y, fm.x.label));
      for (const row of fm.rows) body.push(<line className="ll-row-tick" x1={X(row)} x2={X(row)} y1={plot.y + plot.h - 5} y2={plot.y + plot.h} />);
      if (pin && !tracking) body.push(<path id={`${uid}-pin-curve`} className="ll-pin-line" d={polyline(ptsFor(pin.p), plot)} />);
      body.push(<g id={`${uid}-run-curve`} className="ll-run ll-tone-info"><path className="ll-fcurve" d={polyline(ptsFor(p), plot)} /></g>);
      for (const [i, h] of lab.handles.entries()) {
        if (h.spec.view !== "curve" || !h.x || !h.y) continue;
        const hx = h.x(p), hy = h.y(p), at = { x: X(hx), y: Y(hy) };
        body.push(<g className="ll-guides">
          <path className="ll-guide" d={`M${P2(clampPt({ x: at.x, y: at.y }, plot))}L${P2(clampPt({ x: at.x, y: plot.y + plot.h }, plot))}M${P2(clampPt(at, plot))}L${P2({ x: plot.x, y: clampPt(at, plot).y })}`} />
        </g>);
        const ax = h.spec.vary.some(id => lab.config.handles?.[i]?.at && typeof (lab.config.handles[i].at as { x: string }).x === "string" && (lab.config.handles[i].at as { x: string }).x.includes(id));
        handle(`${uid}-h-${i}`, at, h.spec, ax ? "ew-resize" : "ns-resize");
      }
      /* the probe: a point that rides the curve */
      const px = clamp(state.cursor, fm.x.min, fm.x.max), py = f({ ...p, [xn]: px });
      const pc = clampPt({ x: X(px), y: Y(py) }, plot);
      const ptext = `${fmt(px, 1)} ${fm.x.unit ?? ""} · ${fmt(py, 0)} ${fm.y.unit ?? ""}`.trim();
      const pw = labelW(ptext);
      const hit = (b: Box) => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      const tries = [-13, 24, -30, 40].flatMap(dy => [0, -60, 60].map(sh => ({ dy, dx: fitX(pc.x + sh, pw) + sh })));
      const spot = tries.find(t => { const b = { x: pc.x + t.dx - pw / 2, y: pc.y + t.dy - 10, w: pw, h: 13 }; return b.y > plot.y - 2 && b.y + b.h < plot.y + plot.h + 2 && !hit(b); }) ?? tries[0];
      handles[`${uid}-probe`] = <g id={`${uid}-probe`} transform={translate(pc.x, pc.y)} className="ll-probe" style={{ cursor: "ew-resize" }} dragologyZIndex={9}
        dragologyOnDrag={() => fin(d.vary(state, param("cursor"), { constraint: st => inOrder([fm.x.min, st.cursor, fm.x.max]) })
          .onDrop(st => { const q = (fm.x.max - fm.x.min) / 48; return { ...st, cursor: clamp(Math.round((st.cursor - fm.x.min) / q) * q + fm.x.min, fm.x.min, fm.x.max) }; }))}>
        <circle r={15} className="ll-hit" />
        <circle r={5.5} className="ll-probe-dot" />
        <text className="ll-probe-label" transform={translate(spot.dx, spot.dy)} textAnchor="middle">{ptext}</text>
      </g>;
      body.push(<path className="ll-probe-drop" d={`M${pc.x.toFixed(1)},${pc.y.toFixed(1)}L${pc.x.toFixed(1)},${(plot.y + plot.h).toFixed(1)}`} />);
    }

    if (panel.view === "trace") {
      const N = r.m.length;
      if (lab.kind === "iterate") {
        const it = lab.iterate!, v = lab.vars[0];
        const yr = it.yRange && !(lab.config.model as IterateModel).measure ? it.yRange : measureRange(lab, p);
        const X = lin(0, it.steps, plot.x, plot.x + plot.w), Y = lin(yr[0], yr[1], plot.y + plot.h, plot.y);
        body.push(frame(ticks(0, it.steps, W < 460 ? 4 : 8), ticks(yr[0], yr[1], 2), X, Y, (lab.config.model as IterateModel).stepLabel ?? "step", (lab.config.model as IterateModel).measureLabel));
        const pts = r.m.map((m, i) => ({ x: X(i), y: Y(sane(m)) }));
        if (pinRun && !tracking) body.push(<path id={`${uid}-pin-trace`} className="ll-pin-line" d={polyline(pinRun.m.map((m, i) => ({ x: X(i), y: Y(sane(m)) })), plot)} />);
        body.push(<g id={`${uid}-run-trace-${tn}`} className={`ll-run ll-tone-${tn}`}>
          <path className="ll-trace" d={polyline(pts, plot)} />
          <path className="ll-dots" {...dots(pts, plot, 2.6)} />
        </g>);
        void v;
        const ups = pts.map((pt, i) => (pt.y < plot.y - 1 ? i : -1)).filter(i => i >= 0);
        if (ups.length) body.push(<g id={`${uid}-trace-off-${tn}`} className={`ll-offchart ll-tone-${tn}`} transform={translate(plot.x + plot.w - 6, plot.y + 12)}><text textAnchor="end">{`↑ off the chart from ${stepWord(lab, r, ups[0])}`}</text></g>);
        cursorMark(X(clamp(state.cursor, 0, N - 1)), pts[clamp(Math.round(state.cursor), 0, N - 1)], X, N - 1);
        for (const [i, h] of lab.handles.entries()) {
          if (h.spec.view !== "trace") continue;
          handle(`${uid}-h-${i}`, h.x && h.y ? { x: X(h.x(p)), y: Y(h.y(p)) } : pts[h.spec.at === "start" ? 0 : stepN(h.spec, pts.length)], h.spec);
        }
      } else {
        const od = lab.ode!, [lo, hi] = od.ranges[0];
        const X = lin(0, od.duration, plot.x, plot.x + plot.w), Y = lin(lo, hi, plot.y + plot.h, plot.y);
        body.push(frame(ticks(0, od.duration, W < 460 ? 4 : 8), ticks(lo, hi, 2), X, Y, `t (${od.unit})`, (lab.config.model as OdeModel).labels?.[lab.vars[0]]));
        if (r.ref && !tracking) body.push(<path id={`${uid}-ref-trace`} className="ll-ref" d={polyline(r.ref.t.map((t, i) => ({ x: X(t), y: Y(r.ref!.vals[0][i]) })), plot)} />);
        if (pinRun && !tracking) body.push(<path id={`${uid}-pin-trace`} className="ll-pin-line" d={polyline(pinRun.t.map((t, i) => ({ x: X(t), y: Y(sane(pinRun.vals[0][i])) })), plot)} />);
        const pts = r.t.map((t, i) => ({ x: X(t), y: Y(sane(r.vals[0][i])) }));
        body.push(<g id={`${uid}-run-trace-${tn}`} className={`ll-run ll-tone-${tn}`}>
          <path className="ll-trace" d={polyline(pts, plot)} />
          <path className="ll-dots" {...dots(pts.length > 160 ? [] : pts, plot, 2.1)} />
          <path className="ll-step-arrow" d={arrow(pts[0], pts[1], { x: plot.x - 4, y: plot.y - 4, w: plot.w + 8, h: plot.h + 8 }, 6)} />
        </g>);
        const ups = pts.findIndex(pt => !inside(pt, plot, 1));
        if (ups > 0) body.push(<g id={`${uid}-trace-off-${tn}`} className={`ll-offchart ll-tone-${tn}`} transform={translate(plot.x + plot.w - 6, plot.y + 12)}><text textAnchor="end">{`swings off the chart at t = ${fmt(r.t[ups], 1)} ${od.unit}`}</text></g>);
        const ci = clamp(Math.round(state.cursor), 0, N - 1);
        cursorMark(X(r.t[clamp(state.cursor, 0, N - 1) | 0] + (state.cursor % 1) * (r.t[1] - r.t[0])), pts[ci], (n: number) => X(n * (r.t[1] - r.t[0])), N - 1);
        for (const [i, h] of lab.handles.entries()) {
          if (h.spec.view !== "trace") continue;
          if (h.x && h.y) { handle(`${uid}-h-${i}`, { x: X(h.x(p)), y: Y(h.y(p)) }, h.spec, "move"); continue; }
          if (h.spec.at === "start") { handle(`${uid}-h-${i}`, pts[0], h.spec, "ns-resize"); continue; }
          if (!h.ruler) { handle(`${uid}-h-${i}`, pts[stepN(h.spec, pts.length)], h.spec, "ns-resize"); continue; }
          /* A step ruler on the time axis: one tick per step up to step n, the handle at step n. It moves only
             sideways, so dragging it reads as stretching every step. */
          const k = stepN(h.spec, pts.length), base = plot.y + plot.h;
          const rx = (j: number) => X(r.t[Math.min(j, r.t.length - 1)]);
          let ticksD = "";
          for (let j = 0; j <= k; j++) ticksD += `M${rx(j).toFixed(1)},${base}v-5`;
          body.push(<g id={`${uid}-ruler-${i}`} className="ll-ruler">
            <path className="ll-ruler-line" d={`M${X(0).toFixed(1)},${base}H${clamp(rx(k), plot.x, plot.x + plot.w).toFixed(1)}`} />
            <path className="ll-ruler-ticks" d={ticksD} />
            <path className="ll-guide" d={`M${P2(clampPt({ x: rx(k), y: base }, plot))}L${P2(clampPt(pts[k], plot))}`} />
          </g>);
          handle(`${uid}-h-${i}`, { x: rx(k), y: base }, h.spec, "ew-resize");
        }
      }
      function cursorMark(cx: number, pt: Pt, Xn: (n: number) => number, maxN: number) {
        const c = clamp(cx, plot.x, plot.x + plot.w);
        handles[`${uid}-cursor`] = <g id={`${uid}-cursor`} className="ll-cursor" transform={translate(c, 0)} style={{ cursor: "ew-resize" }} dragologyZIndex={8}
          dragologyOnDrag={() => fin(d.vary(state, param("cursor"), { constraint: st => inOrder([0, st.cursor, maxN]) }).onDrop(st => ({ ...st, cursor: Math.round(st.cursor) })))}>
          <rect className="ll-hit" x={-9} y={plot.y} width={18} height={plot.h} />
          <line className="ll-cursor-line" y1={plot.y} y2={plot.y + plot.h} />
          <path className="ll-cursor-cap" d={`M-5,${plot.y - 7}L5,${plot.y - 7}L0,${plot.y - 1}Z`} />
        </g>;
        void Xn;
        if (inside(pt, plot, 1)) body.push(<g id={`${uid}-trace-cursor-pt`} className="ll-cursor-mark" transform={translate(pt.x, pt.y)}><circle r={5} /></g>);
      }
    }

    if (panel.view === "phase") {
      const od = lab.ode!, [xr, vr] = od.ranges;
      const X = lin(xr[0], xr[1], plot.x, plot.x + plot.w), Y = lin(vr[0], vr[1], plot.y + plot.h, plot.y);
      const ml = (lab.config.model as OdeModel).labels ?? {};
      body.push(frame(ticks(xr[0], xr[1], 4), ticks(vr[0], vr[1], 2), X, Y, ml[lab.vars[0]] ?? lab.vars[0], ml[lab.vars[1]] ?? lab.vars[1]));
      if (r.ref && !tracking) body.push(<path id={`${uid}-ref-phase`} className="ll-ref" d={polyline(r.ref.t.map((_, i) => ({ x: X(r.ref!.vals[0][i]), y: Y(r.ref!.vals[1][i]) })), plot)} />);
      if (pinRun && !tracking) body.push(<path id={`${uid}-pin-phase`} className="ll-pin-line" d={polyline(pinRun.t.map((_, i) => ({ x: X(sane(pinRun.vals[0][i])), y: Y(sane(pinRun.vals[1][i])) })), plot)} />);
      const pts = r.t.map((_, i) => ({ x: X(sane(r.vals[0][i])), y: Y(sane(r.vals[1][i])) }));
      const R = { x: plot.x - 4, y: plot.y - 4, w: plot.w + 8, h: plot.h + 8 };
      body.push(<g id={`${uid}-run-phase-${tn}`} className={`ll-run ll-tone-${tn}`}>
        <path className="ll-trace" d={polyline(pts, plot)} />
        <path className="ll-dots" {...dots(pts.length > 160 ? [] : pts, plot, 1.9)} />
        <path className="ll-step-arrow" d={arrow(pts[0], pts[1], R, 6)} />
      </g>);
      const ci = clamp(Math.round(state.cursor), 0, pts.length - 1);
      if (inside(pts[ci], plot, 1)) body.push(<g id={`${uid}-phase-cursor-pt`} className="ll-cursor-mark" transform={translate(pts[ci].x, pts[ci].y)}><circle r={5} /></g>);
      for (const [i, h] of lab.handles.entries()) if (h.spec.view === "phase") handle(`${uid}-h-${i}`, h.x && h.y ? { x: X(h.x(p)), y: Y(h.y(p)) } : pts[h.spec.at === "start" ? 0 : stepN(h.spec, pts.length)], h.spec, "move");
    }

    if (panel.view === "sweep" && lab.regime) {
      const rg = lab.regime, spec = lab.params[rg.param];
      const X = lin(spec.min, spec.max, plot.x, plot.x + plot.w);
      const orbit = rg.sweep === "orbit";
      const os = [...tried.map(t => t.o), ...(allFound && sweep ? sweep.map(s => s.o) : [])];
      const yr: [number, number] = orbit ? (lab.iterate?.yRange ?? [0, 1]) : [Math.min(-1, ...os) - 0.4, Math.max(0.6, ...os) + 0.4];
      const Y = lin(yr[0], yr[1], plot.y + plot.h, plot.y);
      const cuts = lab.cuts.map(c => c(p));
      const edges = [spec.min, ...cuts.map(c => clamp(c, spec.min, spec.max)), spec.max];
      body.push(<g className="ll-frame">
        <rect className="ll-plot-bg" x={plot.x} y={plot.y} width={plot.w} height={plot.h} rx={4} />
        <text className="ll-panel-title" transform={translate(outer.x + 2, outer.y + 13)}>{panel.title}</text>
        {ticks(spec.min, spec.max, W < 460 ? 4 : 7).map(v => <text id={tid("x", v)} className="ll-tick" transform={translate(X(v), plot.y + plot.h + 18)} textAnchor={X(v) > plot.x + plot.w - 12 ? "end" : "middle"}>{tickFmt(v)}</text>)}
        {orbit ? <g /> : <g>
          <line className="ll-grid ll-grid-strong" x1={plot.x} x2={plot.x + plot.w} y1={Y(0)} y2={Y(0)} />
          <text className="ll-tick" transform={translate(plot.x - 6, Y(0) + 3.5)} textAnchor="end">start</text>
          {Y(0) - plot.y >= 18 ? <text id={`${uid}-sw-grew`} className="ll-tick" transform={translate(plot.x - 6, plot.y + 8)} textAnchor="end">grew</text> : null}
          {plot.y + plot.h - Y(0) >= 16 ? <text id={`${uid}-sw-shrank`} className="ll-tick" transform={translate(plot.x - 6, plot.y + plot.h - 1)} textAnchor="end">shrank</text> : null}
        </g>}
      </g>);
      rg.bands.forEach((b, i) => {
        const x0 = X(edges[i]), x1 = X(edges[i + 1]);
        if (x1 - x0 < 0.5) return;
        const on = found.has(i);
        /* keep the band name off the η marker line: slide it to the roomier side of the marker */
        const mk = X(p[rg.param]), name = shorten(b.short ?? b.name, (x1 - x0 - 4) / 5.8), half = name.length * 2.9 + 4;
        let lx = (x0 + x1) / 2;
        if (mk > lx - half && mk < lx + half) {
          const left = mk - x0, right = x1 - mk;
          lx = right >= left ? Math.min(x1 - half, mk + half + 4) : Math.max(x0 + half, mk - half - 4);
        }
        body.push(<g id={`${uid}-band-${i}-${on ? "on" : "off"}`} className={`ll-band ll-tone-${b.tone} ${on ? "is-found" : "is-hidden"}`}>
          <rect x={x0} y={plot.y} width={x1 - x0} height={plot.h} />
          {on && x1 - x0 > 30 ? <text transform={translate(lx, plot.y + plot.h - 6)} textAnchor="middle">{name}</text> : <g />}
        </g>);
      });
      cuts.forEach((c, i) => {
        const show = found.has(i) && found.has(i + 1);
        if (!show || c < spec.min || c > spec.max) return;
        body.push(<g id={`${uid}-cut-${i}`} className="ll-cut" transform={translate(X(c), 0)}>
          <line y1={plot.y} y2={plot.y + plot.h} />
          <text transform={translate(4, plot.y + 11)} textAnchor="start">{/^[\d.]+$/.test(rg.cuts[i].trim()) ? `${spec.symbol ?? rg.param} = ${rg.cuts[i].trim()}` : `${shortExpr(rg.cuts[i])} = ${fmt(c, 2)}`}</text>
        </g>);
      });
      if (allFound && sweep && !tracking) {
        if (orbit) body.push(<path id={`${uid}-sweep-full`} className="ll-sweep-dots" {...dots(sweep.flatMap(s => s.orbit!.map(o => ({ x: X(s.v), y: Y(o) }))), plot, 0.75)} />);
        else body.push(<path id={`${uid}-sweep-full`} className="ll-sweep-line" d={polyline(sweep.map(s => ({ x: X(s.v), y: Y(s.o) })), plot)} />);
      }
      if (!tracking) for (const t of tried) {
        if (orbit) body.push(<path id={`${uid}-tried-${t.id}`} className={`ll-tried ll-tone-${t.tone}`} {...dots((t.orbit ?? []).map(o => ({ x: X(t.v), y: Y(o) })), plot, 1.6)} />);
        else body.push(<g id={`${uid}-tried-${t.id}`} className={`ll-tried ll-tone-${t.tone}`} transform={translate(X(t.v), Y(t.o))}><circle r={3.4} /></g>);
      }
      if (pin && !tracking) body.push(<g id={`${uid}-sweep-pin`} className="ll-sweep-pin" transform={translate(X(pin.p[rg.param]), 0)}>
        <line y1={plot.y} y2={plot.y + plot.h} /></g>);
      const mx = X(p[rg.param]);
      handles[`${uid}-sweep`] = <g id={`${uid}-sweep`} className="ll-sweep-marker" transform={translate(mx, 0)} style={{ cursor: "ew-resize" }} dragologyZIndex={8}
        dragologyOnDrag={() => vary(d, state, [rg.param])}>
        <rect className="ll-hit" x={-11} y={plot.y - 22} width={22} height={plot.h + 24} />
        <line className="ll-marker-line" y1={plot.y} y2={plot.y + plot.h} />
        <g transform={translate(0, plot.y)}><circle r={6.5} className="ll-knob" /></g>
        <text className="ll-marker-label" transform={translate(clamp(mx, plot.x + 26, plot.x + plot.w - 26) - mx, plot.y - 11)} textAnchor="middle">{`${spec.symbol ?? rg.param} ${fmt(p[rg.param], spec.digits ?? 2)}`}</text>
      </g>;
    }
    return { body: <g>{body}</g>, handles };
  }

  /* ---------- derived copy ---------- */
  const cursor = lab.kind === "function" ? view.cursor : clamp(Math.round(view.cursor), 0, Math.max(0, run.m.length - 1));
  const st = stats(lab, view.p, run, cursor);
  const b = bv.band;
  const notes = lab.notes.filter(n => { try { return withBind(lab, view.p, () => !!n.when({ ...st })); } catch { return false; } }).map(n => fill(n.say, lab, st, view.p));
  const compare = pin ? compareText(lab, pin.p, pinRun, view.p, run, cursor) : "";
  const unfound = lab.regime ? lab.regime.bands.map((_, i) => i).filter(i => !found.has(i)) : [];

  const share = () => {
    const p = model.p, r = simulate(lab, p), s = stats(lab, p, r, cursor);
    const bvp = bandView(lab, p), bb = bvp.index, bd = bvp.band;
    const learner = fill(bd?.learner ?? lab.config.share?.learner ?? `I tried ${paramSummary(lab, p)}.`, lab, s, p);
    let reply = fill(bd?.reply ?? lab.config.share?.reply ?? bd?.say ?? "", lab, s, p);
    if (lab.regime) {
      const left = lab.regime.bands.map((_, i) => i).filter(i => !found.has(i));
      const spec = lab.params[lab.regime.param], sym = spec.symbol ?? lab.regime.param;
      if (left.length) reply += ` There ${left.length === 1 ? "is one more way" : `are ${left.length} more ways`} a run can go. Try ${left.some(i => i > bb) ? `a bigger ${sym}` : `a smaller ${sym}`}${left.some(i => i > bb) && left.some(i => i < bb) ? ", and a smaller one" : ""}.`;
      else reply += ` You have found all ${lab.regime.bands.length} behaviours; the strip under the plots now shows every ${sym} at once.`;
    }
    if (pin) reply += ` ${compareText(lab, pin.p, simulate(lab, pin.p), p, r, cursor)}`;
    const data = [
      lab.config.title, paramSummary(lab, p),
      lab.kind === "function" ? `probe ${lab.func!.xname} = ${fmt(model.cursor, 1)}` : outcomeText(lab, r, p),
      bd ? `regime: ${bd.name} (${lab.regime!.cuts.map((c, i) => `${shortExpr(c)} = ${fmt(lab.cuts[i](p), 2)}`).join(", ")})` : "",
      lab.regime ? `found ${found.size} of ${lab.regime.bands.length}` : "",
      pin ? `pinned ${paramSummary(lab, pin.p)}` : "",
    ].filter(Boolean).join(" · ");
    setShared(true);
    onShare?.({ learner, data, reply: reply.trim() });
  };

  /* test & tooling hook */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingLinked?: unknown };
    host.keatingLinked = Object.freeze({
      snapshot: () => ({
        title: lab.config.title, p: { ...model.p }, cursor: model.cursor, band, bandName: b?.name ?? null,
        found: [...found].sort(), pinned: pin ? { ...pin.p } : null, tried: tried.length, allFound,
        run: { diverged: run.diverged, settled: run.settled, outcome: run.outcome, steps: run.steps, final: run.m[run.m.length - 1] },
        live: live ? { ...live.p } : null, dragging,
      }),
      /* Screen position of a model point in one of the views, for tests and tooling. */
      point: (viewName: Panel["view"], x: number, y = 0) => {
        const svg = wrap.current?.querySelector("svg")?.getBoundingClientRect();
        const panel = panels.find(pp => pp.view === viewName);
        if (!svg || !panel) return null;
        const sc = scalesFor(lab, panel, model.p);
        return { x: svg.x + sc.X(x), y: svg.y + sc.Y(y) };
      },
      handles: () => {
        const svg = wrap.current?.querySelector("svg")?.getBoundingClientRect();
        if (!svg) return null;
        const out: Record<string, { x: number; y: number }> = {};
        wrap.current!.querySelectorAll<SVGGElement>("[data-handle], .ll-cursor, .ll-sweep-marker, .ll-probe").forEach(el => {
          const r = (el.querySelector(".ll-knob, .ll-probe-dot, .ll-cursor-cap") ?? el).getBoundingClientRect();
          const name = el.getAttribute("data-handle") ?? (el.classList.contains("ll-cursor") ? "cursor" : el.classList.contains("ll-probe") ? "probe" : "sweep");
          const key = out[name] ? `${name}-${el.closest("[id]")?.id.split("-").pop()}` : name;
          out[key] = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        return out;
      },
    });
  });

  const scrub = (id: string) => <Scrub key={id} id={`${uid}-s-${id}`} spec={lab.params[id]} value={view.p[id]}
    onInput={v => setParam(id, v, false)} onCommit={v => setParam(id, v, true)} onCancel={() => { setLive(null); setStatus("Drag interrupted; nothing changed."); }} />;
  const exprNode = (expr: string, digits: number) => <span className="ll-live-num">{fmt(liveValue(expr, lab, { ...st }, view.p), digits)}</span>;
  const eq = lab.config.equation;
  const showEq = lab.views.has("equation") && eq;
  const pinLabel = pin ? `Unpin ${paramSummary(lab, pin.p, true)}` : "Pin this run";

  return <section className={`activity linked${dragging ? " is-dragging" : ""}`} data-simulation="linked-lab" aria-labelledby={`${uid}-title`}>
    <div className="ll-header">
      <h3 className="ll-title" id={`${uid}-title`}>{lab.config.title}</h3>
      {lab.regime && <span className="ll-count">{allFound ? `All ${lab.regime.bands.length} behaviours found` : `${found.size} of ${lab.regime.bands.length} behaviours found`}</span>}
    </div>
    {lab.config.goal && <p className="ll-goal">{lab.config.goal}</p>}
    {showEq ? <div className="ll-equation" aria-label="Equation with live numbers">
      {eq!.lines.map((line, i) => <p className="ll-eq-line" key={i}>{rich(line, scrub, exprNode, `l${i}`)}</p>)}
      {eq!.live && <p className="ll-eq-live" aria-live="off">{rich(eq!.live, id => <span className="ll-live-num">{fmt(view.p[id], lab.params[id].digits ?? 2)}</span>, exprNode, "live")}</p>}
      {lab.pids.some(id => !eq!.lines.join(" ").includes(`{${id}}`)) && <p className="ll-eq-line ll-eq-extra">
        {lab.pids.filter(id => !eq!.lines.join(" ").includes(`{${id}}`)).map(id => <span className="ll-extra" key={id}>{lab.params[id].symbol ?? id} = {scrub(id)}</span>)}
      </p>}
    </div> : <div className="ll-equation ll-param-row" aria-label="Parameters">
      {lab.pids.map(id => <span className="ll-extra" key={id}>{lab.params[id].label} {scrub(id)}</span>)}
    </div>}
    <div className="ll-canvas" ref={wrap} aria-hidden="true">
      <DraggableRenderer key={renderKey} draggable={draggable} state={live ?? model} width={W} height={H}
        onDragState={onDragState} onDropState={onDropState} onDragStatus={onDragStatus} />
    </div>
    <div className={`ll-readout ll-tone-${tone}`} aria-live="polite">
      {b && <p className="ll-regime"><span className="ll-regime-chip">{b.name}</span><span>{fill(b.say, lab, st, view.p)}</span></p>}
      {lab.kind !== "function" && <p className="ll-outcome">{outcomeText(lab, run, view.p)}</p>}
      {notes.map((n, i) => <p className="ll-note" key={i}>{n}</p>)}
      {compare && <p className="ll-compare"><span className="ll-pin-swatch" aria-hidden="true" />{compare}</p>}
      {lab.regime && !allFound && found.size > 1 && <p className="ll-hint">{unfound.length === 1 ? "One behaviour left to find." : `${unfound.length} behaviours left to find.`}</p>}
      {allFound && <p className="ll-hint">All found: the strip now shows every {lab.params[lab.regime!.param].symbol ?? lab.regime!.param} at once.</p>}
    </div>
    <div className="ll-toggles">
      {secondary.length > 0 && <button type="button" className="ll-toggle" aria-expanded={showSecondary} onClick={() => setShowSecondary(v => !v)}><span className="ll-chev" aria-hidden="true">›</span>
        {showSecondary ? "Hide" : "Show"} {secondary.map(v => (lab.config.labels?.[v] ?? v).toLowerCase()).join(" and ")}</button>}
      {lab.views.has("table") && <button type="button" className="ll-toggle" aria-expanded={showNumbers} onClick={() => setShowNumbers(v => !v)}><span className="ll-chev" aria-hidden="true">›</span>Show the numbers</button>}
      <button type="button" className="ll-toggle" aria-expanded={showButtons} onClick={() => setShowButtons(v => !v)}><span className="ll-chev" aria-hidden="true">›</span>Use buttons instead</button>
    </div>
    {showNumbers && lab.views.has("table") && <div className="ll-more">
      <DataTable lab={lab} p={view.p} run={run} cursor={cursor} pin={pin} pinRun={pinRun} onPick={setCursor} />
      {lab.config.table?.note && <p className="ll-table-note">{fill(lab.config.table.note, lab, st, view.p)}</p>}
    </div>}
    {showButtons && <div className="ll-more ll-buttons">
      <div className="ll-button-rows">
        {lab.pids.map(id => {
          const sp = lab.params[id], stp = sp.step ?? (sp.max - sp.min) / 100, v = model.p[id];
          return <div className="ll-button-row" key={id}>
            <span className="ll-button-label">{sp.label}{sp.symbol ? ` ${sp.symbol}` : ""}</span>
            <button type="button" className="quiet" aria-label={`Less ${sp.label}`} disabled={v <= sp.min} onClick={() => setParam(id, snapParam(sp, v - stp), true)}>−</button>
            <span className="ll-button-value">{fmt(v, sp.digits ?? 2)}{sp.unit ? ` ${sp.unit}` : ""}</span>
            <button type="button" className="quiet" aria-label={`More ${sp.label}`} disabled={v >= sp.max} onClick={() => setParam(id, snapParam(sp, v + stp), true)}>+</button>
          </div>;
        })}
        {lab.kind !== "function" ? <div className="ll-button-row">
          <span className="ll-button-label">follow {lab.kind === "ode" ? "time" : (lab.config.model as IterateModel).stepLabel ?? "step"}</span>
          <button type="button" className="quiet" aria-label="Earlier step" disabled={cursor <= 0} onClick={() => setCursor(cursor - 1)}>‹</button>
          <span className="ll-button-value">{stepWord(lab, run, cursor)}</span>
          <button type="button" className="quiet" aria-label="Later step" disabled={cursor >= run.m.length - 1} onClick={() => setCursor(cursor + 1)}>›</button>
        </div> : <div className="ll-button-row">
          <span className="ll-button-label">probe {lab.func!.xname}</span>
          {(() => { const fm = lab.config.model as FunctionModel, q = (fm.x.max - fm.x.min) / 24; return <>
            <button type="button" className="quiet" aria-label="Move the probe left" disabled={cursor <= fm.x.min} onClick={() => setCursor(cursor - q)}>‹</button>
            <span className="ll-button-value">{fmt(cursor, 1)}{fm.x.unit ? ` ${fm.x.unit}` : ""}</span>
            <button type="button" className="quiet" aria-label="Move the probe right" disabled={cursor >= fm.x.max} onClick={() => setCursor(cursor + q)}>›</button>
          </>; })()}
        </div>}
      </div>
    </div>}
    <span className="learning-lab__sr-only" role="status">{status}</span>
    <div className="actions ll-actions">
      {touched && <button type="button" className="primary" onClick={share} disabled={shared}>{shared ? "Shared" : "Share with Keating"}</button>}
      <button type="button" className="quiet ll-pin-btn" onClick={() => { setTouched(true); setPin(pin ? null : { p: { ...model.p } }); setStatus(pin ? "Pinned run removed." : `Pinned ${paramSummary(lab, model.p)}. Change something to compare.`); }}>
        {pin ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}{pinLabel}</button>
      {history.length > 0 && <button type="button" className="quiet" onClick={() => { const prev = history[history.length - 1]; setHistory(h => h.slice(0, -1)); setModel(prev); setLive(null); onChange?.(); setStatus(`Back to ${paramSummary(lab, prev.p)}.`); }}><Undo2 size={13} aria-hidden="true" />Undo</button>}
      {history.length > 0 && <button type="button" className="quiet" onClick={() => { setModel(initialState(lab)); setHistory([]); setLive(null); setPin(null); onChange?.(); setStatus("Back to the starting values."); }}><RotateCcw size={13} aria-hidden="true" />Start over</button>}
    </div>
  </section>;
}

function scalesFor(lab: Lab, panel: Panel, p: P) {
  const { plot } = panel;
  const ax = (d0: number, d1: number) => lin(d0, d1, plot.x, plot.x + plot.w);
  const ay = (d0: number, d1: number) => lin(d0, d1, plot.y + plot.h, plot.y);
  if (panel.view === "curve" && lab.kind === "iterate") { const yr = curveRange(lab, p); return { X: ax(...lab.iterate!.xRange), Y: ay(yr[0], yr[1]) }; }
  if (panel.view === "curve") { const fm = lab.config.model as FunctionModel; return { X: ax(fm.x.min, fm.x.max), Y: ay(fm.y.min, fm.y.max) }; }
  if (panel.view === "trace" && lab.kind === "iterate") { const it = lab.iterate!; const yr = it.yRange && !(lab.config.model as IterateModel).measure ? it.yRange : measureRange(lab, p); return { X: ax(0, it.steps), Y: ay(yr[0], yr[1]) }; }
  if (panel.view === "trace") { const od = lab.ode!; return { X: ax(0, od.duration), Y: ay(...od.ranges[0]) }; }
  if (panel.view === "phase") { const od = lab.ode!; return { X: ax(...od.ranges[0]), Y: ay(...od.ranges[1]) }; }
  const spec = lab.params[lab.regime!.param];
  return { X: ax(spec.min, spec.max), Y: (_: number) => plot.y + plot.h / 2 };
}
function stepN(h: HandleSpec, len: number) { return clamp(Math.round(h.n ?? 1), 1, len - 1); }
function orbitOf(lab: Lab, p: P): number[] {
  const it = lab.iterate!, v = lab.vars[0], ctx: Ctx = { ...p, n: 0 };
  let x = it.start(p);
  const out: number[] = [];
  for (let i = 0; i < 220; i++) {
    ctx[v] = x; x = it.map(ctx);
    if (!Number.isFinite(x)) break;
    if (i >= 190) out.push(x);
  }
  return out;
}
function measureRange(lab: Lab, p: P): [number, number] {
  const it = lab.iterate!, v = lab.vars[0], ctx: Ctx = { ...p, n: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 60; i++) { ctx[v] = it.xRange[0] + (it.xRange[1] - it.xRange[0]) * i / 60; const y = it.measure(ctx); if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) return [0, 1];
  return [lo >= 0 && lo < (hi - lo) * 0.2 ? 0 : lo, hi * 1.04];
}
function shorten(s: string, chars: number) { return s.length <= chars ? s : s.slice(0, Math.max(3, Math.floor(chars) - 1)).trimEnd() + "…"; }
function shortExpr(s: string) { return s.replace(/\*/g, "").replace(/sqrt\(([^)]+)\)/g, "√$1").replace(/\s+/g, ""); }
function paramSummary(lab: Lab, p: P, short = false) {
  const ids = short && lab.regime ? [lab.regime.param] : lab.pids;
  return ids.map(id => { const s = lab.params[id]; return `${s.symbol ?? id} ${fmt(p[id], s.digits ?? 2)}${s.unit && !short ? ` ${s.unit}` : ""}`; }).join(", ");
}
function stepWord(lab: Lab, run: Run, i: number) { return lab.kind === "ode" ? `t = ${fmt(run.t[i] ?? 0, 1)} ${lab.ode!.unit}` : `${(lab.config.model as IterateModel).stepLabel ?? "step"} ${i}`; }
function plural(lab: Lab) { return `${(lab.config.model as IterateModel).stepLabel ?? "step"}s`; }
/** What the run did, in words. Iterate models use the detected long-run behaviour, not rough rules. */
function outcomeText(lab: Lab, run: Run, p: P) {
  const N = run.m.length;
  const label = lab.kind === "iterate" ? (lab.config.model as IterateModel).measureLabel ?? lab.vars[0] : (lab.config.model as OdeModel).labels?.[lab.vars[0]] ?? lab.vars[0];
  const from = fmt(run.m[0], 3), to = fmt(run.m[N - 1], 3);
  if (run.diverged >= 0) return `Blew up by ${stepWord(lab, run, run.diverged)}.`;
  if (lab.kind === "iterate") {
    const beh = behaviour(lab, p), v = lab.vars[0], steps = plural(lab);
    if (beh.period === -1) return `${cap(label)} ${from} → ${to} after ${N - 1} ${steps}, and growing: it never comes back.`;
    if (beh.period === 1) {
      if (run.settled >= 0) return `${cap(label)} ${from} → ${to}, settled by ${stepWord(lab, run, run.settled)}.`;
      return `${cap(label)} ${from} → ${to} after ${N - 1} ${steps}; it settles at ${v} = ${fmt(beh.values[0], 3)} in the long run.`;
    }
    if (beh.period >= 2) return `In the long run it repeats every ${beh.period} ${steps}: ${v} = ${beh.values.map(x => fmt(x, 3)).join(", ")}.`;
    return `${cap(label)} never settles into a cycle (checked over 1,600 ${steps}): it wanders between ${fmt(beh.lo, 3)} and ${fmt(beh.hi, 3)}.`;
  }
  const cut = run.truncated ? ` (cut off at ${MAX_ODE_STEPS} steps, t = ${fmt(run.t[N - 1], 1)} ${lab.ode!.unit})` : "";
  if (run.settled >= 0) return `${cap(label)} ${from} → ${to}, settled by ${stepWord(lab, run, run.settled)}${cut}.`;
  const after = `${fmt(run.t[N - 1], 0)} ${lab.ode!.unit}`;
  if (growing(run)) return `${cap(label)} ${from} → ${to}: the swings are growing after ${after}${cut}.`;
  return `${cap(label)} ${from} → ${to}, still moving after ${after}${cut}.`;
}
/** The envelope of the last quarter is clearly bigger than the quarter before it, and than the start. */
function growing(run: Run) {
  const m = run.m, N = m.length, q = Math.max(1, Math.floor(N / 4));
  const env = (a: number, b: number) => Math.max(...m.slice(a, b).map(Math.abs));
  return run.outcome > 0.05 && env(N - q, N) > 1.05 * env(N - 2 * q, N - q);
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function compareText(lab: Lab, pp: P, pr: Run | null, p: P, r: Run, cursor: number) {
  const changed = lab.pids.filter(id => Math.abs(pp[id] - p[id]) > 1e-9);
  const who = paramSummary({ ...lab, pids: changed.length ? changed : lab.pids }, pp);
  if (lab.kind === "function") {
    const f = lab.func!.f, xn = lab.func!.xname, unit = (lab.config.model as FunctionModel).y.unit ?? "";
    return `Pinned ${who}: ${fmt(f({ ...pp, [xn]: cursor }), 0)} ${unit} at ${xn} = ${fmt(cursor, 1)}; now ${fmt(f({ ...p, [xn]: cursor }), 0)} ${unit}.`;
  }
  if (!pr) return "";
  if (!changed.length) return `Pinned this run. Change something to compare against it.`;
  const say = (run: Run, pp: P) => {
    if (run.diverged >= 0) return `blew up by ${stepWord(lab, run, run.diverged)}`;
    if (lab.kind === "iterate") {
      const b = behaviour(lab, pp);
      if (b.period === -1) return "kept growing";
      if (b.period >= 2) return `repeats every ${b.period} ${plural(lab)}`;
      if (b.period === 0) return "never repeats";
    }
    return run.settled >= 0 ? `settled by ${stepWord(lab, run, run.settled)}` : growing(run) ? "kept growing" : "was still moving at the end";
  };
  return `Pinned ${who} ${say(pr, pp)}; this run ${say(r, p)}.`;
}
function cursorSummary(lab: Lab, p: P, run: Run, c: number) {
  if (lab.kind === "function") { const xn = lab.func!.xname; return `${xn} = ${fmt(c, 1)}: ${fmt(lab.func!.f({ ...p, [xn]: c }), 1)}`; }
  const i = Math.round(c);
  return `${stepWord(lab, run, i)}: ${lab.vars.map((v, k) => `${v} = ${fmt(run.vals[k][i], 3)}`).join(", ")}`;
}

/* ---------- Scrubbable number (Bret Victor / Tangle style), also a keyboard slider ---------- */
function Scrub({ id, spec, value, onInput, onCommit, onCancel }: { id: string; spec: ParamSpec; value: number; onInput: (v: number) => void; onCommit: (v: number) => void; onCancel: () => void }) {
  const drag = useRef<{ x: number; v: number; last: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);
  const step = spec.step ?? (spec.max - spec.min) / 100;
  const perPx = (spec.max - spec.min) / 240;
  const commitKey = (v: number) => onCommit(snapParam(spec, v));
  return <span id={id} role="slider" tabIndex={0} className={`ll-scrub${active ? " is-active" : ""}`}
    aria-label={spec.label} aria-valuemin={spec.min} aria-valuemax={spec.max} aria-valuenow={Number(value.toFixed(4))}
    aria-valuetext={`${fmt(value, spec.digits ?? 2)}${spec.unit ? ` ${spec.unit}` : ""}`}
    title={`${spec.label}: drag sideways or use the arrow keys`}
    onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); (e.currentTarget as HTMLElement).focus(); drag.current = { x: e.clientX, v: value, last: value, moved: false }; setActive(true); }}
    onPointerMove={e => {
      const dr = drag.current; if (!dr) return;
      const v = snapParam(spec, dr.v + (e.clientX - dr.x) * perPx * (e.shiftKey ? 0.2 : 1));
      if (v !== dr.last) { dr.last = v; dr.moved = true; onInput(v); }
    }}
    onPointerUp={() => { const dr = drag.current; drag.current = null; setActive(false); if (dr?.moved) onCommit(dr.last); }}
    /* An interrupted scrub (pointercancel, or capture lost without a pointerup) keeps the last committed value. */
    onPointerCancel={() => { const dr = drag.current; drag.current = null; setActive(false); if (dr?.moved) onCancel(); }}
    onLostPointerCapture={() => { const dr = drag.current; if (!dr) return; drag.current = null; setActive(false); if (dr.moved) onCancel(); }}
    onKeyDown={e => {
      const big = e.shiftKey ? 10 : 1;
      const map: Record<string, number> = { ArrowRight: step * big, ArrowUp: step * big, ArrowLeft: -step * big, ArrowDown: -step * big, PageUp: step * 10, PageDown: -step * 10 };
      if (e.key in map) { e.preventDefault(); commitKey(value + map[e.key]); }
      else if (e.key === "Home") { e.preventDefault(); commitKey(spec.min); }
      else if (e.key === "End") { e.preventDefault(); commitKey(spec.max); }
    }}>
    <span className="ll-scrub-sym" aria-hidden="true">{spec.symbol ? `${spec.symbol}=` : ""}</span>{fmt(value, spec.digits ?? 2)}{spec.unit ? <span className="ll-scrub-unit"> {spec.unit}</span> : null}
  </span>;
}

/* ---------- Linked table: flat rows, the cursor row highlighted, rows pick the step ---------- */
function DataTable({ lab, p, run, cursor, pin, pinRun, onPick }: { lab: Lab; p: P; run: Run; cursor: number; pin: Pinned | null; pinRun: Run | null; onPick: (c: number) => void }) {
  let rows: number[];
  if (lab.kind === "function") rows = lab.func!.rows;
  else {
    const N = run.m.length, c = Math.round(cursor);
    const start = clamp(c - 2, 0, Math.max(0, N - 6));
    rows = Array.from({ length: Math.min(6, N) }, (_, i) => start + i);
  }
  const nearest = lab.kind === "function" ? rows.reduce((best, r) => (Math.abs(r - cursor) < Math.abs(best - cursor) ? r : best), rows[0]) : Math.round(cursor);
  const N = run.m.length;
  return <div className="ll-table-wrap">
    <table className="ll-table">
      <caption className="learning-lab__sr-only">Values of this run. Pick a row to follow it on the plots.</caption>
      <thead><tr>
        {lab.columns.map((c, i) => <th key={i} scope="col">{c.label}</th>)}
        {pin && lab.columns.filter(c => c.compare).map((c, i) => <th key={`p${i}`} scope="col" className="ll-pin-col">{c.label}, pinned</th>)}
      </tr></thead>
      <tbody>
        {rows.map(r => {
          const ctx = rowCtx(lab, p, run, r);
          const pctx = pin ? rowCtx(lab, pin.p, pinRun ?? run, r) : null;
          const on = r === nearest;
          return <tr key={r} className={on ? "is-current" : undefined} aria-current={on ? "true" : undefined}>
            {lab.columns.map((c, i) => { const v = fmt(withBind(lab, p, () => c.fn(ctx)), c.digits); return <td key={i}>{i === 0
              ? <button type="button" className="ll-row-pick" onClick={() => onPick(r)} aria-label={`Follow ${lab.kind === "function" ? `${lab.func!.xname} = ${r}` : stepWord(lab, run, r)}`}>{v}</button>
              : v}</td>; })}
            {pctx && lab.columns.filter(c => c.compare).map((c, i) => <td key={`p${i}`} className="ll-pin-col">{fmt(withBind(lab, pin!.p, () => c.fn(pctx)), c.digits)}</td>)}
          </tr>;
        })}
      </tbody>
    </table>
    {lab.kind !== "function" && <div className="ll-table-nav">
      <button type="button" className="quiet" onClick={() => onPick(Math.round(cursor) - 1)} disabled={Math.round(cursor) <= 0}>‹ Earlier</button>
      <span>{stepWord(lab, run, Math.round(cursor))} of {lab.kind === "ode" ? `${fmt(run.t[N - 1], 0)} ${lab.ode!.unit}` : N - 1}</span>
      <button type="button" className="quiet" onClick={() => onPick(Math.round(cursor) + 1)} disabled={Math.round(cursor) >= N - 1}>Later ›</button>
    </div>}
  </div>;
}
