/* PharmLab science. Pure functions, no DOM. Educational models, not for clinical dosing.

   PK: linear, time-invariant disposition, so a regimen's concentration is the superposition of each dose's
   closed-form response. Disposition is a sum of exponentials (the unit-impulse response):
     one compartment:  h(t) = (1/V)·e^(−k t),            k = CL/V
     two compartments: h(t) = a1·e^(−α t) + a2·e^(−β t)   (Gibaldi & Perrier ch. 2; Rowland & Tozer ch. 19)
   and each input is convolved with it in closed form:
     IV bolus D:            C = D·Σ aᵢ e^(−λᵢ τ)
     zero-order infusion R over T:  C = R·Σ aᵢ/λᵢ·(1 − e^(−λᵢ τ))  while τ ≤ T, then that value decays from T
     oral first-order (F, ka):      C = F·D·ka·Σ aᵢ/(ka − λᵢ)·(e^(−λᵢ τ) − e^(−ka τ))   (ka = λᵢ: F·D·aᵢ·ka·τ·e^(−λᵢ τ))
*/

export type Route = "bolus" | "infusion" | "oral";
export type Dose = { t: number; amount: number; route?: Route; hours?: number };
export type Disposition = { cl: number; v: number; q?: number; v2?: number };
export type Terms = { a: number[]; l: number[] };

export function terms(d: Disposition): Terms {
  const k10 = d.cl / d.v;
  if (!d.q || !d.v2) return { a: [1 / d.v], l: [k10] };
  const k12 = d.q / d.v, k21 = d.q / d.v2;
  const s = k10 + k12 + k21, disc = Math.sqrt(Math.max(0, s * s - 4 * k10 * k21));
  const alpha = (s + disc) / 2, beta = (s - disc) / 2;
  return { a: [(alpha - k21) / (d.v * (alpha - beta)), (k21 - beta) / (d.v * (alpha - beta))], l: [alpha, beta] };
}

export type Absorption = { f: number; ka: number };

/** Concentration at time t from one dose (amount in dose units, so C is in dose units per litre). */
export function doseConc(dose: Dose, t: number, tm: Terms, abs: Absorption, defaultRoute: Route, defaultHours: number): number {
  const tau = t - dose.t;
  if (tau <= 0 || dose.amount <= 0) return 0;
  const route = dose.route ?? defaultRoute;
  let c = 0;
  if (route === "bolus") for (let i = 0; i < tm.a.length; i++) c += dose.amount * tm.a[i] * Math.exp(-tm.l[i] * tau);
  else if (route === "infusion") {
    const T = Math.max(1e-6, dose.hours ?? defaultHours), R = dose.amount / T;
    for (let i = 0; i < tm.a.length; i++) {
      const li = tm.l[i];
      c += tau <= T ? R * tm.a[i] / li * (1 - Math.exp(-li * tau))
                    : R * tm.a[i] / li * (1 - Math.exp(-li * T)) * Math.exp(-li * (tau - T));
    }
  } else {
    const { f, ka } = abs;
    for (let i = 0; i < tm.a.length; i++) {
      const li = tm.l[i];
      c += Math.abs(ka - li) < 1e-9 * Math.max(ka, li)
        ? f * dose.amount * tm.a[i] * ka * tau * Math.exp(-li * tau)
        : f * dose.amount * ka * tm.a[i] / (ka - li) * (Math.exp(-li * tau) - Math.exp(-ka * tau));
    }
  }
  return c;
}

export function conc(doses: Dose[], t: number, tm: Terms, abs: Absorption, route: Route, hours: number): number {
  let c = 0;
  for (const d of doses) c += doseConc(d, t, tm, abs, route, hours);
  return Math.max(0, c);
}

export const halfLife = (cl: number, v: number) => Math.LN2 * v / cl;
/** Fraction of the eventual steady state reached after n half-lives of regular dosing: 1 − 2^(−n). */
export const fractionOfSteadyState = (n: number) => 1 - Math.pow(2, -n);
/** Accumulation factor for regular dosing every τ (one compartment): 1 / (1 − e^(−kτ)). */
export const accumulation = (k: number, tau: number) => 1 / (1 - Math.exp(-k * tau));
/** Average steady-state concentration: F·Dose / (CL·τ). */
export const cssAverage = (f: number, dose: number, cl: number, tau: number) => f * dose / (cl * tau);
/** Loading dose that reaches a target concentration at once: V·C / F. */
export const loadingDose = (v: number, target: number, f: number) => v * target / f;
/** Maintenance dose per interval: CL·C·τ / F. */
export const maintenanceDose = (cl: number, target: number, tau: number, f: number) => cl * target * tau / f;

/** Time (after tFrom) at which the curve has fallen to half its value at tFrom, by bisection on the sampled model. */
export function readHalfLife(c: (t: number) => number, tFrom: number, tMax: number): number | null {
  const c0 = c(tFrom), half = c0 / 2;
  if (!(c0 > 0)) return null;
  let lo = tFrom, hi = tFrom;
  while (c(hi) > half) { hi += (tMax - tFrom) / 50; if (hi > tFrom + 50 * (tMax - tFrom)) return null; }
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (c(m) > half) lo = m; else hi = m; }
  return (lo + hi) / 2 - tFrom;
}

/** Find the modifier scale in [min, max] whose curve passes nearest `target` at time t (grid then golden refine). */
export function solveScale(f: (s: number) => number, target: number, min: number, max: number): number {
  const N = 90;
  let best = min, err = Infinity;
  for (let i = 0; i <= N; i++) {
    const s = min * Math.pow(max / min, i / N), e = Math.abs(Math.log(Math.max(1e-12, f(s))) - Math.log(Math.max(1e-12, target)));
    if (e < err) { err = e; best = s; }
  }
  let lo = Math.max(min, best / Math.pow(max / min, 1 / N)), hi = Math.min(max, best * Math.pow(max / min, 1 / N));
  const g = (s: number) => Math.abs(Math.log(Math.max(1e-12, f(s))) - Math.log(Math.max(1e-12, target)));
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (g(m1) < g(m2)) hi = m2; else lo = m1;
  }
  return (lo + hi) / 2;
}

/* ---------------- PD ----------------
   Occupancy model with response proportional to occupancy weighted by intrinsic efficacy (Clark / del Castillo–
   Katz; Rang & Dale ch. 2; Katzung ch. 2). No spare receptors, Hill slope 1, so the agonist's EC50 equals its K.
     E/Emax = (eA·A/KA + eP·P/KP) / (1 + A/KA + P/KP + B/KB) × 1/(1 + N/KN)
   B: reversible competitive antagonist (same site). Gaddum–Schild: the agonist curve shifts right in parallel by
      the dose ratio r = 1 + [B]/KB, maximum unchanged.
   N: non-competitive antagonist acting downstream / at another site: maximum falls by 1/(1 + [N]/KN), EC50 unchanged.
   P: partial agonist (efficacy eP < 1) competing for the same site. */

export type PdState = { ka: number; ea?: number; b?: number; kb?: number; n?: number; kn?: number; p?: number; kp?: number; ep?: number };

export function response(A: number, s: PdState): number {
  const ea = s.ea ?? 1;
  const xa = A / s.ka, xp = s.p && s.kp ? s.p / s.kp : 0, xb = s.b && s.kb ? s.b / s.kb : 0, xn = s.n && s.kn ? s.n / s.kn : 0;
  return (ea * xa + (s.ep ?? 0) * xp) / (1 + xa + xp + xb) / (1 + xn);
}
export const doseRatio = (b: number, kb: number) => 1 + b / kb;
/** EC50 of the agonist read off the model curve by bisection (half of that curve's own maximum). */
export function readEc50(s: PdState, lo = 1e-14, hi = 1): number {
  const base = response(0, s), top = (s.ea ?? 1) / (1 + (s.n && s.kn ? s.n / s.kn : 0));   // limit as [A] → ∞
  const half = base + (top - base) / 2;
  if (!(top > base)) return NaN;
  let a = Math.log10(lo), b = Math.log10(hi);
  for (let i = 0; i < 90; i++) { const m = (a + b) / 2; if (response(10 ** m, s) < half) a = m; else b = m; }
  return 10 ** ((a + b) / 2);
}

/* Quantal (population) dose–response: log-normal, so the fraction responding is Φ((log10 D − log10 D50)/σ). */
export function phi(z: number): number {
  // Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
export const quantal = (dose: number, d50: number, sigma: number) => phi((Math.log10(dose) - Math.log10(d50)) / sigma);
export function quantalDose(frac: number, d50: number, sigma: number): number {
  let a = -6, b = 6;
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (phi(m) < frac) a = m; else b = m; }
  return d50 * 10 ** (sigma * (a + b) / 2);
}

/* ---------------- Oncology ----------------
   Tumour: Skipper–Schabel–Wilcox log-kill (each cycle kills a constant fraction, i.e. L logs, scaled by the dose
   given) with Gompertzian regrowth between cycles, closed form from the current size:
     N(t) = K·exp( ln(N(t0)/K) · e^(−b (t − t0)) )                                      (Norton & Simon 1977)
   Neutrophils: Friberg semi-mechanistic myelosuppression model (proliferating pool, three transit pools,
   circulation, feedback (Circ0/Circ)^γ), ktr = 4/MTT; each cycle adds a drug effect E0·dose·e^(−(t−day)/τ) on proliferation (τ = effectDays).
   (Friberg et al., J Clin Oncol 2002;20:4713.) Integrated with RK4 at 1 h. */

export type Cycle = { day: number; dose: number };   // dose is a fraction of the full dose (1 = 100%)
export type OncParams = {
  n0: number; k: number; b: number; logKill: number;
  anc0: number; mtt: number; gamma: number; effect: number; effectDays: number;
  threshold: number; gcsf?: boolean; gcsfMtt?: number; gcsfBoost?: number; gcsfFrom?: number; gcsfTo?: number;
};
export type OncRun = { days: number[]; tumour: number[]; anc: number[]; given: Cycle[]; delays: number[]; nadirs: { day: number; anc: number }[]; kills: { day: number; before: number; after: number }[] };

export function oncRun(plan: Cycle[], p: OncParams, horizon: number, autoDelay = true): OncRun {
  const sorted = [...plan].sort((a, b) => a.day - b.day);
  const dt = 1 / 24;
  const mtt = p.gcsf ? (p.gcsfMtt ?? p.mtt) : p.mtt;
  const ktr = 4 / (mtt / 24);   // per day (mtt in hours)
  const gamma = p.gamma;
  const boostAt = (t: number) => { if (!p.gcsf) return 0; for (const q of pulses) if (t >= q.start + (p.gcsfFrom ?? 2) && t < q.start + (p.gcsfTo ?? 11)) return p.gcsfBoost ?? 0; return 0; };
  let y = [p.anc0, p.anc0, p.anc0, p.anc0, p.anc0];
  let N = p.n0;
  const days: number[] = [], tumour: number[] = [], anc: number[] = [];
  const given: Cycle[] = [], delays: number[] = [];
  const kills: { day: number; before: number; after: number }[] = [];
  let shift = 0, ci = 0;
  const pulses: { start: number; dose: number }[] = [];
  const steps = Math.round(horizon / dt);
  const effectAt = (t: number) => { let e = 0; for (const q of pulses) if (t >= q.start) e += p.effect * q.dose * Math.exp(-(t - q.start) / p.effectDays); return Math.min(0.99, e); };
  const deriv = (s: number[], t: number) => {
    const e = effectAt(t), fb = Math.pow(p.anc0 / Math.max(1e-6, s[4]), gamma);
    return [ktr * s[0] * (1 - e) * fb * (1 + boostAt(t)) - ktr * s[0], ktr * (s[0] - s[1]), ktr * (s[1] - s[2]), ktr * (s[2] - s[3]), ktr * (s[3] - s[4])];
  };
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    // start any cycle due now (with ANC check)
    while (ci < sorted.length && t + 1e-9 >= sorted[ci].day + shift) {
      // a cycle due now starts if ANC ≥ threshold; a delayed one is re-checked once a day (whole days)
      const due = Math.abs(t - (sorted[ci].day + shift)) < dt / 2, wholeDay = Math.abs(t - Math.round(t)) < dt / 2;
      if (autoDelay && (y[4] < p.threshold || (!due && !wholeDay))) break;
      const day = Math.round(t * 24) / 24;
      delays.push(Math.max(0, day - sorted[ci].day));
      shift = day - sorted[ci].day;
      given.push({ day, dose: sorted[ci].dose });
      pulses.push({ start: day, dose: sorted[ci].dose });
      const before = N;
      N = Math.max(1, N * Math.pow(10, -p.logKill * sorted[ci].dose));
      kills.push({ day, before, after: N });
      ci++;
    }
    if (i % 6 === 0) { days.push(t); tumour.push(N); anc.push(y[4]); }
    const k1 = deriv(y, t), k2 = deriv(y.map((v, j) => v + dt / 2 * k1[j]), t + dt / 2),
      k3 = deriv(y.map((v, j) => v + dt / 2 * k2[j]), t + dt / 2), k4 = deriv(y.map((v, j) => v + dt * k3[j]), t + dt);
    y = y.map((v, j) => Math.max(1e-6, v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])));
    N = gompertz(N, p.k, p.b, dt);
  }
  // nadir after each given cycle (min ANC between this cycle and the next, or horizon)
  const nadirs = given.map((g, j) => {
    const end = j + 1 < given.length ? given[j + 1].day : horizon;
    let m = Infinity, md = g.day;
    days.forEach((d, i) => { if (d >= g.day && d <= end && anc[i] < m) { m = anc[i]; md = d; } });
    return { day: md - g.day, anc: m };
  });
  // planned cycles never given (still waiting at the horizon) count as delays to the horizon
  for (; ci < sorted.length; ci++) delays.push(Infinity);
  return { days, tumour, anc, given, delays, nadirs, kills };
}
export const gompertz = (N: number, K: number, b: number, dt: number) => K * Math.exp(Math.log(N / K) * Math.exp(-b * dt));
