<!-- Model-facing schema for `PharmLab`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/lanes/pharm/CATALOGUE-DELTA.md. -->

## `PharmLab` (kind `pharmacology`): move the drug, watch the curve

Write it in an openui fence as `PharmLab(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Educational model only, never patient dosing.** Every card carries "Educational model, not for clinical dosing." (pk, pd) or "Teaching model, not a treatment plan. Not for clinical use." (oncology), and the share says so too. Never author a config from a real patient's numbers, never present a result as a dose to give, and never use it to answer "what dose should my patient get?": answer that in words and point to local guidelines, the TDM service and a pharmacist.

**Teaches:** a pharmacology "why" whose answer is a curve over dose or time: loading against maintenance doses, half-life, accumulation and time to steady state, trough and peak targeting, renal impairment or a larger volume, infusion rate; competitive against non-competitive antagonism, the Schild shift, partial agonists, potency against efficacy; the therapeutic index; chemotherapy spacing, the nadir, dose density, G-CSF. Modes: `pk` (concentration over time), `pd` + `view: "receptor"` (receptor pharmacology at one moment), `pd` + `view: "quantal"` (population ED50/TD50), `oncology` (cycles, log-kill, regrowth, marrow recovery).

What the learner drags: **pk**: a dose dot's height (amount), its foot along time, pull a foot below the lane to remove it, the dashed **+** chip to add one, the "every N h" bracket to re-space all doses, the **CL** knob on the tail and the **V** knob on the first peak. **pd receptor**: molecules from the tray onto a concentration line on the agonist's log axis (the EC50 shift shows the dose ratio; a non-competitive blocker lowers the maximum). **pd quantal**: the dose marker and the TD50 knob (readouts TI = TD50/ED50 and TD1/ED99). **oncology**: cycle feet (day), dots (dose %), pull off or + to add; a cycle whose ANC is below threshold on its day is auto-delayed (shown "+N d"); a G-CSF toggle.

**Not for:** mechanism-of-action stories with no curve (prose or a diagram); non-linear (Michaelis–Menten) kinetics such as phenytoin, ethanol or high-dose aspirin (the model is linear and would draw the wrong shape: say so); drug interactions, protein binding or active metabolites; real chemotherapy regimens or a specific tumour's response (`oncology` shows principles only). A generic exponential-decay formula with no dosing (caffeine left at bedtime, radioactive decay) is a `LinkedModel`.

**Config** (`PharmConfig`, discriminated by `mode`; every object is closed, unknown keys are rejected):

```ts
type Route = "bolus" | "infusion" | "oral";
type Dose = { t: number; amount: number; route?: Route; hours?: number };   // t in h; amount in drug.doseUnit

type PkConfig = {
  mode: "pk"; title: string; goal?: string;
  drug: {
    name: string;
    doseUnit: "mg" | "µg";
    concUnit: "mg/L" | "µg/mL" | "µg/L" | "ng/mL";   // mg → mg/L|µg/mL, µg → µg/L|ng/mL
    v: number;                        // L (central volume if q/v2 given)
    cl?: number; halfLife?: number;   // exactly one: CL in L/h, or t½ in h (CL = ln2·V/t½)
    f?: number; ka?: number;          // required if any dose is oral: F in (0,1], ka in 1/h
    q?: number; v2?: number;          // optional second compartment (together): L/h, L
    range: { low: number; high: number; label?: string };   // the drawn window band
    toxic?: number;                   // toxic band starts here
    target?: number;                  // LD = V·C/F and MD = CL·C·τ/F; default = window midpoint
    trough?: { min?: number; max?: number };                  // checked before the last dose
    peak?: { min?: number; max?: number; at?: number };       // at = hours after dose start; else the true peak
    source: string;                   // REQUIRED citation, printed under the equations
  };
  regimen: {
    route: Route; hours?: number;     // infusion duration (required for infusions)
    interval: number;                 // h; ≤ view.hours
    doses: Dose[];                    // 1–40, each inside the view, amount 0–maxDose
    addRoute?: Route; addHours?: number;   // what the + chip adds (e.g. a bolus loading dose onto an infusion)
    maxDose: number; doseStep: number;     // doseStep ≤ maxDose/4
    timeStep: number;                      // drag snap in h; ≤ view.hours/8
  };
  patient?: {
    clearance?: { label: string; min: number; max: number };   // scale range, 0 < min < 1 < max, max/min ≤ 100
    volume?: { label: string; min: number; max: number };
    note?: string;                    // printed when clearance is changed
  };
  view: { hours: number; yMax: number; days?: boolean };   // yMax ≥ range.low and ≤ 50 × range.high
};

type PdLigand = { id: string /* camelCase */; name: string; kind: "competitive" | "noncompetitive" | "partial";
                  k: number /* M, inside range */; efficacy?: number /* partial only, (0,1) */; conc?: number /* 0 = in tray */ };
type PdConfig = {
  mode: "pd"; title: string; goal?: string;
  view: "receptor" | "quantal";
  range: [number, number];            // receptor: molar; quantal: dose; high ≥ 10 × low, ≤ 14 decades
  agonist?: { name: string; ec50: number; probe?: number };   // receptor only
  ligands?: PdLigand[];               // receptor only, 1–3
  quantal?: { drug: string; unit: string; ed50: number; td50: number; sigma: number /* log10 units, 0.02–2 */;
              dose: number; tdMin?: number; tdMax?: number };   // quantal only
  assumptions?: string; source: string;
};

type OncConfig = {
  mode: "oncology"; title: string; goal?: string;
  regimen: { name: string; cycles: { day: number; dose: number /* 0.25–1.25 of full */ }[]; maxCycles: number /* ≤ 12 */;
             dayStep?: number; doseStep?: number };
  tumour: { n0: number; k: number /* Gompertz plateau, > n0, ≤ 1e14 */; b: number /* per day, ≤ 0.2 */;
            logKill: number /* logs per full cycle, ≤ 5 */; detect?: number };
  marrow: { anc0: number /* ×10⁹/L */; mtt: number /* h, 24–400 */; gamma: number /* 0–1 */; effect: number /* (0,1) */;
            effectDays: number; threshold: number /* < anc0 */; gcsf?: boolean; gcsfBoost?: number /* ≤ 0.4 */; gcsfMtt?: number };
  days: number /* 14–240 */; residualAfter?: number /* days after the last cycle, default 21 */;
  source: string;
};
```

Authoring rules: use real, cited parameters in `source` and mark any illustrative value there or in `assumptions` ("ka illustrative"). `cl` and `v` must agree with the half-life you quote (t½ = ln2·V/CL); textbook tables often pair a terminal t½ with Vss from a multi-compartment drug (vancomycin, morphine, lidocaine), which breaks the one-compartment identity, so prefer `halfLife` + `v` from one source, or add `q`/`v2`. A trough-guided case (aminoglycosides) uses `trough`/`peak` and leaves `toxic` unset. For receptor configs set `k` from pA2 (KB = 10^−pA2). Oncology: keep the default marrow numbers unless you have a source and say the rates are calibrated for teaching.

**Examples:**

```openui lifecycle=ephemeral id=gentamicin-trough
root = LearningSurface([reply])
reply = PharmLab("Gentamicin: the timed level and the pre-dose trough", {"mode": "pk", "title": "Gentamicin: the timed level and the pre-dose trough", "goal": "120 mg every 8 h by 30-minute infusion. Drag the kidneys' clearance down to a quarter, then see what spacing the doses does to the pre-dose level.", "drug": {"name": "Gentamicin", "doseUnit": "mg", "concUnit": "mg/L", "v": 17.5, "halfLife": 2.5, "range": {"low": 4, "high": 10, "label": "1-h sample 4–10"}, "trough": {"max": 2}, "peak": {"min": 4, "max": 10, "at": 1}, "source": "Gentamicin SmPC (emc 2407, 12877): V ≈ extracellular water (0.25 L/kg, 17.5 L at 70 kg); t½ 2–3 h with normal kidneys, longer in renal impairment. Divided dosing: 1-h level 4–10 mg/L (30 min after a 30-min infusion ends), trough < 2 mg/L. Once daily: trough < 1 mg/L."}, "regimen": {"route": "infusion", "hours": 0.5, "interval": 8, "doses": [{"t": 0, "amount": 120}, {"t": 8, "amount": 120}, {"t": 16, "amount": 120}, {"t": 24, "amount": 120}, {"t": 32, "amount": 120}, {"t": 40, "amount": 120}, {"t": 48, "amount": 120}, {"t": 56, "amount": 120}, {"t": 64, "amount": 120}], "maxDose": 400, "doseStep": 10, "timeStep": 0.5}, "patient": {"clearance": {"label": "Kidney function (clearance)", "min": 0.15, "max": 1.5}, "volume": {"label": "Volume (extracellular water)", "min": 0.6, "max": 1.8}}, "view": {"hours": 72, "yMax": 16}})
```

```openui lifecycle=ephemeral id=receptor-antagonism
root = LearningSurface([reply])
reply = PharmLab("Acetylcholine on ileum: two ways to block it", {"mode": "pd", "title": "Acetylcholine on ileum: two ways to block it", "goal": "Drag atropine onto the concentration line, then verapamil. Watch what each does to the curve's position and its top.", "view": "receptor", "range": [1e-10, 0.01], "agonist": {"name": "Acetylcholine", "ec50": 1e-07, "probe": 1e-06}, "ligands": [{"id": "atropine", "name": "Atropine", "kind": "competitive", "k": 1e-09}, {"id": "verapamil", "name": "Verapamil", "kind": "noncompetitive", "k": 3e-07}], "assumptions": "Response ∝ occupancy, no spare receptors, Hill slope 1. ACh EC50 and the verapamil constant are illustrative orders of magnitude.", "source": "Atropine KB ≈ 1 nM (pA2 ≈ 9 on guinea-pig ileum, Arunlakshana & Schild 1959). Rang & Dale ch. 2: competitive vs non-competitive antagonism (verapamil blocks Ca²⁺ entry downstream)."})
```
