<!-- Model-facing schema for `LinkedModel`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `LinkedModel` (kind `linked-model`): linked views of one model

Write it in an openui fence as `LinkedModel(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** how one parameter changes a whole run. The same model is drawn as a curve, a trace over steps
or time, a phase plot, a table and a live equation, all moving together as the learner drags a handle on a
plot or scrubs a number inside the equation. Regime bands on the parameter axis (settles / oscillates /
diverges) are discovered by trying values.

Three model kinds:

- `iterate`: x_{n+1} = map(x_n). Gradient descent, Newton's method, fixed-point iteration, compound
  growth year by year, cobweb diagrams.
- `ode`: one or two variables stepped with Euler's method, optionally against the exact solution.
  Cooling, decay, springs, predator–prey, epidemics (two compartments), a ball thrown straight up with drag.
- `function`: y = f(x; params) with a draggable probe and a linked table. Half-life, projectile height,
  break-even, dose–response, a sine wave's amplitude and period.

**Choose it for:** "Why does Newton's method sometimes jump away?", "How does air resistance change a
ball's path?", "What does the time step do in a simulation?", "How does the half-life change how much is
left?", "When does a population settle versus oscillate?", "How do amplitude and period change a sine
wave?"

**Not for:** solving one equation by hand (`EquationWorkbench`). Fractions (`FractionLine`). Real data with groups
(`DataExplorer`). A formula the learner only needs evaluated once ("what's 20% of 80?", prose). A model you cannot
write with the formula grammar below.

**Config** (`LinkedConfig`):

```ts
type LinkedConfig = {
  title: string;
  goal?: string;                       // one instruction line: what to drag and what to look for
  views: ("curve" | "trace" | "table" | "equation" | "phase")[];  // non-empty, allowed per kind (below)
  params: Record<string, ParamSpec>;   // 1–8 parameters
  model: IterateModel | OdeModel | FunctionModel;
  equation?: { lines: string[]; live?: string };       // templates, see below
  handles?: HandleSpec[];              // at most 6 draggable marks
  table?: { columns: { label: string; expr: string; digits?: number; compare?: boolean }[];  // ≤ 5 columns
             note?: string };                // template printed under the table; the table starts collapsed
  regimes?: RegimeSpec;                // iterate and ode only
  notes?: { when: string; say: string }[];   // `say` shows whenever formula `when` is non-zero
  share?: { learner: string; reply: string }; // templates. With regimes, the current band's learner/reply win
                                              // and share fills in only what the band leaves out
  labels?: { curve?: string; trace?: string; phase?: string };  // panel titles
  secondary?: ("curve" | "trace" | "phase")[];  // shown plot views that start collapsed behind "Show …";
                                                // may not hide every plot, or every handle
};
type ParamSpec = { label: string; symbol?: string; min: number; max: number; value: number;
                   step?: number; unit?: string; digits?: number };     // min < max
type IterateModel = {
  kind: "iterate";
  variable: string;            // the iterated variable, e.g. "x"
  start: string;               // formula over params only: x_0
  map: string;                 // formula over params, variable, n: x_{n+1}
  steps: number;               // integer 2–200
  curve?: string;              // y = curve(variable) drawn in the curve view; default = map
  measure?: string; measureLabel?: string;  // what the trace plots each step (default: curve value)
  style?: "path" | "cobweb";   // cobweb = staircase against y = x (use with map as the curve)
  xRange: [number, number];    // min < max
  yRange?: [number, number]; xLabel?: string; yLabel?: string;
  stepLabel?: string;          // noun for one iteration: "step", "year"
};
type OdeModel = {
  kind: "ode";
  vars: string[];                          // 1 or 2 state variables
  rates: Record<string, string>;           // d(var)/dt formula per var, over params, vars, t
  initial: Record<string, string>;         // formula over params only, per var
  dt: string;                              // step size: a param name or a formula over params ("0.1" is fine)
  duration: number;                        // > 0; duration / dt ≤ 1500 at the starting values (enforced)
  ranges: Record<string, [number, number]>; // plot range per var, min < max; phase x-axis = vars[0], y = vars[1]
  reference?: boolean;                     // also draw the exact (fine RK4) motion as a ghost
  timeUnit?: string; labels?: Record<string, string>;
};
type FunctionModel = {
  kind: "function";
  f: string;                               // formula over params and x.name
  x: { name: string; label: string; min: number; max: number; unit?: string };
  y: { label: string; min: number; max: number; unit?: string };
  rows: number[];                          // 1–12 x values for the table
  probe?: number;                          // starting x of the draggable probe; default rows[0]
};
type HandleSpec = {
  view: "curve" | "trace" | "phase";       // must be one of the shown views
  at: "start" | "step" | { x: string; y: string }; // {x, y}: formulas over params only
  vary: string[];                          // 1–2 param ids the drag changes
  label?: string;
  n?: number;                              // for at: "step", which step to grab (default 1)
};
type RegimeSpec = {
  param: string;                           // a param id
  cuts: string[];                          // ≤ 5 formulas over params, ascending
  bands: RegimeBand[];                     // exactly cuts.length + 1, low → high
  sweep?: "outcome" | "orbit";             // orbit = plot the long-run values (bifurcation style)
  axisLabel?: string;
};
type RegimeBand = {
  name: string; tone: "ok" | "warn" | "bad" | "info"; say: string; learner?: string; reply?: string;
  short?: string;                          // ≤ 16 chars, shown on the regime axis (default: name)
  cycle?: { name?: string; tone?: "ok" | "warn" | "bad" | "info";   // iterate only: used instead of the band
            say: string; learner?: string; reply?: string };        // when the long run is a cycle of period ≥ 2
};
```

**Handles must move with the parameters they vary** (enforced: the validator nudges each varied param by
10% of its range and rejects a handle that doesn't move). A drag moves the handle and the lab searches the
`vary` params for the position under the pointer, so the handle's position must depend on them. Start
configs away from fixed points (a `step` handle at w₀ = 0 can't move):

- `at: "start"` sits at the initial state: on a `curve` at (x₀, curve(x₀)); on a `trace` at (step 0, first
  measured value); on a `phase` at (var1₀, var2₀). Vary params that the `start` / `initial` formulas use
  (`w0`, `x0`), **not** a rate such as a launch speed that only enters the rates.
- `at: "step"` sits where step `n` (default 1) lands. Vary params that change the step: a learning rate, a
  growth rate, `dt`. On an ode `trace`, a step handle that varies the step size (a param in the `dt`
  formula) becomes a **step ruler** on the time axis with one tick per step up to `n`; use `n` around 10–20
  so it isn't on top of the start.
- `at: { x, y }` works in every view, plotted in that view's coordinates: the formulas must contain the varied params (the curve's peak `{ x: "v/9.8", y:
  "v^2/19.6" }` varies `v`). Two varied params need a point that moves in two directions.

Views allowed per kind (enforced): **iterate** curve, trace, table, equation. **ode** trace, phase, table,
equation; `phase` needs two vars. **function** curve, table, equation. A `function` model needs `{x, y}`
handles; `"start"`/`"step"` handles are for iterate and ode. Regimes are not allowed on `function`.

Names (enforced):

- Param ids: `/^[A-Za-z][A-Za-z0-9]{0,11}$/`. Model variables and `x.name`: `/^[A-Za-z][A-Za-z0-9]{0,7}$/`.
  **No underscores**, and a variable may not reuse a param id.
- Reserved, never a param or model variable: `n t pi e steps final first settled outcome diverged f period`.
  (A `function` model's `x.name` may be `t`; it may not be `f`, `n`, `pi`, `e`.)

Formula grammar (every formula and every `[...]` in a template):

- Numbers (decimals and `1e-3` allowed), `+ - * / % ^` (also `**`), `< > <= >= == !=`, `&& || !`, `c ? a : b`,
  parentheses. **Write every multiplication with `*`**: `2*x`, not `2x`.
- Functions: `sin cos tan atan atan2 tanh exp sqrt abs log ln log10 log2 floor ceil round sign min max pow
  clamp(v, lo, hi)`. Constants `pi`, `e`. ≤ 240 chars.
- Every free name must be declared. Names available where:

| Where | Names |
|---|---|
| `iterate.start`, `ode.initial`, `ode.dt`, regime `cuts`, handle `{x, y}` | params |
| `iterate.map`, `curve`, `measure` | params, the variable, `n` |
| `ode.rates` | params, vars, `t` |
| `function.f` | params, `x.name` |
| table columns, `equation.lines`, `equation.live` | iterate: params, var, `n`, `next_<var>` · ode: params, vars, `t`, `n`, `next_<var>`, and `ref_<var>` when `reference` · function: params, `x.name`, and `f(…)` |
| `notes.when`, `notes.say`, band `say/learner/reply` (and `cycle`), `share`, `table.note` | everything in the row above, plus `steps final first settled outcome diverged period`, and (iterate, ode) `start_<var>`, `end_<var>` |

What the names mean in notes, bands and share: **parameter names** are the current values; **model
variables** (`x`, `h`, `next_x`, `ref_x`) are the row at the learner's **step cursor**, which starts at step 0
and moves only if the learner scrubs the trace, so `[h|1]` in a share text is usually the *starting* value.
For whole-run values use **`start_<var>` and `end_<var>`** (first and last state: `[end_h|1]`) and the stats:
`period` (iterate only: 1 = settles to a point, p = long-run cycle of period p up to 12, 0 = no cycle found,
−1 = blows up; always 0 for ode and function), `steps` (steps taken), `first`/`final` (first and last *measured* value:
the iterate's `measure`, or an ode's **first** var), `settled` (step it settled by, −1 if never), `diverged`
(1 if it blew up, else 0), `outcome` (log10 of end size over start size). Notes are re-evaluated live as the
learner drags. The `trace` view plots that same measured value (an ode's first var) against step or time.

Templates (`equation.lines`, `equation.live`, `say`, `learner`, `reply`, `share`, ≤ 600 chars):

- `[expr|digits]` prints a live value, e.g. `[next_x|3]`; digits default 2. The expression inside cannot
  contain `]` or `|`, so **don't use `||` inside a template**; use `max(a, b) > 0` style instead.
- `{p}` where `p` is a param id prints that param. In `equation.lines` it becomes a scrubbable number shown
  **with its unit**, so don't write the unit again after it (`{ang}`, not `{ang}°`); elsewhere it prints the
  bare number.
  **Any `{word}` made only of letters and digits must be a param id**, so write subscripts as `x_n` or
  `x_{n+1}`, never `x_{n}` or `T_{0}`.
- `x_{n+1}` and `w^2`/`^{…}` render as sub- and superscripts.

Limits worth knowing: an ode has **at most two** state variables (a 2-D projectile with drag needs four,
so model one direction, or use a `function` model without drag); a run cannot stop on a condition (to make
a ball stop at the ground, freeze the rates with `h < 0 ? 0 : …`); an ode takes at most 1500 steps: a config
that needs more at its starting values is rejected, and a drag that pushes past it is cut visibly
("cut off at 1500 steps").

Science in the text: a band's `say` must be true for the **whole** band. If the behaviour changes inside a
band, add a cut, or (iterate) give the band a `cycle` variant for periodic windows. Prefer "roughly" for
first-order approximations. The table and `secondary` plots start collapsed, so put what matters in a plot
that is shown.

Default table columns when `table` is omitted: iterate `n`, the variable; ode `t`, each var; function
`x.name`, `y`.

**Minimal example** (function):

```openui lifecycle=ephemeral id=height-of-a-thrown-ball
root = LearningSurface([reply])
reply = LinkedModel("Height of a thrown ball", {"title": "Height of a thrown ball", "goal": "Drag the top of the arc to change the launch speed. Slide the probe along the path.", "views": ["curve", "table"], "params": {"v": {"label": "launch speed", "symbol": "v", "min": 5, "max": 30, "value": 15, "step": 1, "unit": "m/s", "digits": 0}}, "model": {"kind": "function", "f": "v*t - 4.9*t^2", "x": {"name": "t", "label": "time", "min": 0, "max": 6, "unit": "s"}, "y": {"label": "height", "min": 0, "max": 50, "unit": "m"}, "rows": [0, 1, 2, 3, 4], "probe": 1}, "handles": [{"view": "curve", "at": {"x": "v/9.8", "y": "v^2/19.6"}, "vary": ["v"], "label": "top"}]})
```
