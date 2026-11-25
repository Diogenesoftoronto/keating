<!-- Model-facing schema for `PhysicsLab`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/lanes/physics/CATALOGUE-DELTA.md. -->

## `PhysicsLab` (kind `physics`): fields, waves and 1-D quantum wells

Write it in an openui fence as `PhysicsLab(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** spatial fields and waves with fixed, validated physics engines: Coulomb fields in a plane (`field`), coherent-wave interference and diffraction (`waves`), and the 1-D Schrödinger equation (`quantum`). The learner drags physical objects: charges and their charge knobs, a test charge, slits and their widths, a wavelength crest, the screen, a fringe marker, the walls and floor of a well, a barrier, control points, a level or energy line. You choose objects and potentials from a whitelist; there are no formulas to write.

**Choose it for:** why field lines never cross; what a dipole looks like; why E is zero between like charges; why fields fall off as 1/r²; why there is no field inside a conductor; fringe spacing (λL/d), path difference, bright and dark fringes, slit width against separation, quiet spots between two speakers; why energy is quantised, zero-point energy, how many bound states a well holds, the classically forbidden region, the oscillator's even ladder, tunnelling and its exponential dependence on width, reflection above a barrier, transmission resonance, double-well splitting.

**Not for:** generic formulas, ODEs or iterated maps (a damped spring, logistic growth, Newton's method): `LinkedModel`. Magnetostatics, circuits, 3-D fields beyond a plane slice, radiation, lenses or ray optics, gravity and orbits, 2-D or 3-D quantum, spin, many particles. Quantitative answers at real optical scale (the wave scene is a ripple tank unless you set units and `scaleNote`). A definition or derivation.

**Config** (`PhysicsConfig`, chosen by `mode`; schemas are closed):

```ts
type FieldConfig = {
  mode: "field"; title: string; goal?: string;                    // goal ≤ 400 chars
  units: { length: "mm" | "cm" | "m"; charge: "nC" | "µC" };
  view: { width: number; height: number };                        // plane centred on the origin; 0.6–3
  charges: { id: string; x: number; y: number; q: number; locked?: boolean }[];   // 1–6; id ≤ 3 chars; q ≠ 0, a multiple of qStep, |q| ≤ qMax
  conductor?: { x: number; y: number; r: number; grounded?: boolean };            // metal sphere; charges ≥ 1.15 r from its centre
  probe?: { x: number; y: number };                               // test charge start; omit → it waits in its dock
  linesPerUnit?: number;                                          // 1–16, default 6
  qStep?: number; qMax?: number;                                  // default 1 and 4; qMax/qStep ≤ 40
  maxCharges?: number;                                            // ≥ charges.length, ≤ 6; spare room shows the + / − dock
  show?: { lines?: boolean; equipotentials?: boolean; potentialMap?: boolean };
  findings?: ("oneArrow" | "nullPoint" | "superposition" | "inverseSquare" | "shielding")[];
};
// Σ|q|·linesPerUnit ≤ 140 and maxCharges·qMax·linesPerUnit ≤ 220; charges ≥ 4% of the width apart.
// shielding needs a conductor; inverseSquare needs no conductor.

type WavesConfig = {
  mode: "waves"; title: string; goal?: string;
  units: { length: "nm" | "µm" | "mm" | "cm" | "m" };
  wavelength: { value: number; min: number; max: number; step?: number };          // 0 < min ≤ value ≤ max
  scene:
    | { kind: "sources"; sources: { id: string; x: number; y: number }[] }        // 1–8 coherent, in-phase point sources
    | { kind: "slits"; barrierX: number; slits: { id: string; y: number; width: number }[]; minWidth?: number; maxWidth?: number };  // 1–4 slits
  screen: { x: number; min: number; max: number };                // min ≥ 4 λmax past the sources/slits
  view: { x0: number; x1: number; yHalf: number };                // 0.8–4× wider than tall; width ≤ 260 λmin
  scaleNote?: string;                                             // ≤ 80 chars
  findings?: ("bright" | "dark" | "spacing" | "width" | "separation")[];
};
// Slits: leave ≥ 2 λmax left of the barrier; slits may not overlap; maxWidth must allow ≥ 2 samples per λmin
// within 64 wavelets in total. bright/separation need ≥ 2 openings; width needs slits.

type QuantumConfig = {
  mode: "quantum"; title: string; goal?: string;
  units: "natural" | "electron";      // natural: ℏ = m = 1. electron: eV, nm, fs
  view: "bound" | "tunnel";
  domain: [number, number];           // hard walls (ψ = 0) at its ends
  energyRange: [number, number];
  potential:
    | { kind: "infinite"; left: number; right: number }                      // width ≥ 5% of the domain
    | { kind: "finiteSquare"; left: number; right: number; depth: number }   // leave ≥ 0.4 × width each side
    | { kind: "harmonic"; hw: number; center?: number }                      // ℏω in energy units
    | { kind: "doubleWell"; barrier: number; separation: number; center?: number }   // domain reaches 1.6a
    | { kind: "barrier"; left: number; right: number; height: number }       // tunnel view only
    | { kind: "points"; points: [number, number][] };                        // 2–12 [x, V], increasing x
  energy?: { value: number; min: number; max: number };   // tunnel view only
  states?: number;                    // bound view: 1–12 (default 6)
  selected?: number;                  // 1-based starting level
  depthAxis?: { max: number };        // bound finiteSquare only (≤ 12 states)
  widthAxis?: { max: number };        // tunnel barrier only
  findings?: string[];                // bound: "zeroPoint" | "forbidden" | "evenSpacing" | "splitting"; tunnel: "tunnels" | "exponential" | "reflectsAbove" | "resonance"
};
// For tunnelling with `points`, the first and last points must have V = 0.
```

Field lines are drawn for 3-D point charges in one plane: the number of lines per charge is honest, their 2-D spacing is not (it falls like 1/r), and the canvas says so; read strength from the test charge. The share describes only the committed state.

**Examples:**

```openui lifecycle=ephemeral id=dipole
root = LearningSurface([reply])
reply = PhysicsLab("A dipole: where do the lines go?", {"mode": "field", "title": "A dipole: where do the lines go?", "goal": "Drag the charges, or the knob beside each one to change its charge (drag it through the charge to flip the sign). Drop the test charge where two lines look about to cross.", "units": {"length": "cm", "charge": "nC"}, "view": {"width": 16, "height": 10}, "charges": [{"id": "A", "x": -3, "y": 0, "q": 2}, {"id": "B", "x": 3, "y": 0, "q": -2}], "linesPerUnit": 6, "qStep": 1, "qMax": 4, "maxCharges": 4, "findings": ["oneArrow", "superposition", "nullPoint"]})
```

```openui lifecycle=ephemeral id=tunnelling
root = LearningSurface([reply])
reply = PhysicsLab("Tunnelling through a barrier", {"mode": "quantum", "title": "Tunnelling through a barrier", "goal": "Drag the barrier's edges, its top, or the electron's energy. Then send a wave packet.", "units": "electron", "view": "tunnel", "domain": [-4, 4], "energyRange": [0, 2.2], "potential": {"kind": "barrier", "left": 0, "right": 0.5, "height": 1}, "energy": {"value": 0.5, "min": 0.05, "max": 2.1}, "widthAxis": {"max": 1.6}, "findings": ["tunnels", "exponential", "reflectsAbove", "resonance"]})
```
