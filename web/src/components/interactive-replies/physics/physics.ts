/* PhysicsLab numerics. Pure functions, no DOM, so the science test can call them directly.
   Electrostatics: point charges (3-D Coulomb fields drawn in a plane), method of images for a conducting sphere.
   Waves: Huygens sum of coherent cylindrical wavelets (2-D, amplitude ∝ 1/√r), screen profile.
   Quantum: finite-difference Hamiltonian, Sturm-bisection eigenvalues + inverse iteration eigenvectors,
   piecewise-constant transfer matrices for transmission, Crank–Nicolson time stepping. */

export const K_COULOMB = 8.9875517862e9;          // N·m²/C²: 1/4πε0 with ε0 = 8.8541878188e−12 F/m (CODATA 2022, physics.nist.gov)
export const LENGTH_M = { mm: 1e-3, cm: 1e-2, m: 1 } as const;
export const CHARGE_C = { nC: 1e-9, "µC": 1e-6 } as const;
/** ℏ²/2m in the lab's energy·length² unit. natural: ℏ = m = 1. electron: eV·nm² (ℏ²/2mₑ = 0.0380998 eV·nm², CODATA). */
export const HB2M = { natural: 0.5, electron: 0.0380998212 } as const;
/** ℏ in energy·time units: natural 1; electron eV·fs. */
export const HBAR_T = { natural: 1, electron: 0.6582119569 } as const;

export type Vec = { x: number; y: number };

/* ============================ electrostatics ============================ */

export type PointQ = { x: number; y: number; q: number };
export type Sphere = { x: number; y: number; r: number; grounded?: boolean };

/** Sources that reproduce the field OUTSIDE a conducting sphere (Griffiths, Introduction to Electrodynamics 4e, §3.2,
    Ex. 3.2 and Prob. 3.8): each outside charge q at distance s gets an image −qR/s at R²/s; a neutral (isolated) sphere
    also gets +qR/s at its centre so its net charge stays zero. Charges must be outside the sphere. */
export function imageSources(charges: PointQ[], c?: Sphere): PointQ[] {
  if (!c) return charges.map(q => ({ ...q }));
  const out: PointQ[] = charges.map(q => ({ ...q }));
  for (const ch of charges) {
    const dx = ch.x - c.x, dy = ch.y - c.y, s = Math.hypot(dx, dy);
    if (s <= c.r) continue;
    const f = (c.r * c.r) / (s * s);
    out.push({ x: c.x + dx * f, y: c.y + dy * f, q: -ch.q * c.r / s });
    if (!c.grounded) out.push({ x: c.x, y: c.y, q: ch.q * c.r / s });
  }
  return out;
}
export const insideSphere = (c: Sphere | undefined, x: number, y: number) => !!c && Math.hypot(x - c.x, y - c.y) < c.r;

/** Field in "lab units": Σ q r̂ / r² (multiply by k·[charge]/[length]² for SI). Zero inside the conductor. */
export function fieldAt(src: PointQ[], x: number, y: number, c?: Sphere): Vec {
  if (insideSphere(c, x, y)) return { x: 0, y: 0 };
  let ex = 0, ey = 0;
  for (const s of src) {
    const dx = x - s.x, dy = y - s.y, r2 = dx * dx + dy * dy;
    if (r2 < 1e-18) continue;
    const inv = s.q / (r2 * Math.sqrt(r2));
    ex += dx * inv; ey += dy * inv;
  }
  return { x: ex, y: ey };
}
/** Potential in lab units Σ q/r (zero at infinity). Inside the conductor it is the surface value (constant). */
export function potentialAt(src: PointQ[], x: number, y: number, c?: Sphere): number {
  if (c && insideSphere(c, x, y)) return sphereV(src, c);
  let v = 0;
  for (const s of src) { const r = Math.hypot(x - s.x, y - s.y); if (r > 1e-12) v += s.q / r; }
  return v;
}
function sphereV(src: PointQ[], c: Sphere) {
  if (c.grounded) return 0;
  /* Potential of the neutral sphere = potential its external charges produce at its centre (Σ q/s). */
  let v = 0;
  for (const s of src) { const d = Math.hypot(s.x - c.x, s.y - c.y); if (d > c.r + 1e-12) v += s.q / d; }
  return v;
}
/** Convert a lab-unit field magnitude to N/C. */
export const fieldSI = (labE: number, len: keyof typeof LENGTH_M, ch: keyof typeof CHARGE_C) => K_COULOMB * labE * CHARGE_C[ch] / (LENGTH_M[len] ** 2);
export const potentialSI = (labV: number, len: keyof typeof LENGTH_M, ch: keyof typeof CHARGE_C) => K_COULOMB * labV * CHARGE_C[ch] / LENGTH_M[len];

export type Line = { pts: number[]; from: number; to: number | "edge" | "null" | "conductor" | "max" };
export type Bounds = { x0: number; x1: number; y0: number; y1: number };

/** Integrate one field line with RK4 on the unit direction field. dir = +1 follows E, −1 runs against it. */
export function traceLine(src: PointQ[], charges: PointQ[], start: Vec, dir: 1 | -1, b: Bounds, c: Sphere | undefined, opts: { capture: number; maxSteps?: number }): Line {
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const hMax = span * 0.008, hMin = span * 0.0012, margin = span * 0.35;
  const pts = [start.x, start.y];
  let x = start.x, y = start.y;
  const unit = (px: number, py: number): Vec | null => {
    const e = fieldAt(src, px, py, undefined);
    const m = Math.hypot(e.x, e.y);
    return m < 1e-12 ? null : { x: dir * e.x / m, y: dir * e.y / m };
  };
  const max = opts.maxSteps ?? 900;
  for (let i = 0; i < max; i++) {
    let dmin = Infinity;
    for (const s of charges) dmin = Math.min(dmin, Math.hypot(x - s.x, y - s.y));
    if (c) dmin = Math.min(dmin, Math.abs(Math.hypot(x - c.x, y - c.y) - c.r) + c.r * 0.02);
    const h = Math.min(hMax, Math.max(hMin, 0.3 * dmin));
    const k1 = unit(x, y); if (!k1) return { pts, from: -1, to: "null" };
    const k2 = unit(x + 0.5 * h * k1.x, y + 0.5 * h * k1.y); if (!k2) return { pts, from: -1, to: "null" };
    const k3 = unit(x + 0.5 * h * k2.x, y + 0.5 * h * k2.y); if (!k3) return { pts, from: -1, to: "null" };
    const k4 = unit(x + h * k3.x, y + h * k3.y); if (!k4) return { pts, from: -1, to: "null" };
    const nx = x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x), ny = y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y);
    /* A line arriving at a sink (an opposite charge in the direction of travel) ends on it. */
    for (let j = 0; j < charges.length; j++) {
      const s = charges[j];
      if (Math.sign(s.q) === -dir && Math.hypot(nx - s.x, ny - s.y) < opts.capture) { pts.push(s.x, s.y); return { pts, from: -1, to: j }; }
    }
    if (c && insideSphere(c, nx, ny)) {
      const dx = nx - c.x, dy = ny - c.y, d = Math.hypot(dx, dy);
      pts.push(c.x + dx / d * c.r, c.y + dy / d * c.r);
      return { pts, from: -1, to: "conductor" };
    }
    x = nx; y = ny; pts.push(x, y);
    if (x < b.x0 - margin || x > b.x1 + margin || y < b.y0 - margin || y > b.y1 + margin) return { pts, from: -1, to: "edge" };
    const e = fieldAt(src, x, y, undefined), em = Math.hypot(e.x, e.y);
    /* Approaching a null point the field magnitude collapses; stop rather than wander. */
    if (em < 1e-7 && i > 3) return { pts, from: -1, to: "null" };
  }
  return { pts, from: -1, to: "max" };
}

/** Field lines whose number from each charge is proportional to |q| (linesPerUnit per unit charge). Seeds sit on a
    small circle round each charge of the sign carrying more total charge; lines from the other sign arrive on their own.
    A conductor's induced charge launches as many lines as end on it, spread by the outward flux along its rim. */
export function fieldLines(charges: PointQ[], c: Sphere | undefined, b: Bounds, linesPerUnit: number, seedR: number): Line[] {
  const src = imageSources(charges, c);
  const pos = charges.reduce((a, q) => a + Math.max(0, q.q), 0), neg = charges.reduce((a, q) => a + Math.max(0, -q.q), 0);
  const dir: 1 | -1 = pos >= neg ? 1 : -1;
  const lines: Line[] = [];
  charges.forEach((ch, idx) => {
    if (Math.sign(ch.q) !== dir) return;
    const n = Math.max(1, Math.round(Math.abs(ch.q) * linesPerUnit));
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / n;
      const l = traceLine(src, charges, { x: ch.x + seedR * Math.cos(a), y: ch.y + seedR * Math.sin(a) }, dir, b, c, { capture: seedR * 0.9 });
      l.pts.unshift(ch.x, ch.y); l.from = idx; lines.push(l);
    }
  });
  if (c) {
    const ended = lines.filter(l => l.to === "conductor").length;
    if (ended > 0) {
      /* Seeds on the side of the rim where field lines leave (for dir = +1, E·n > 0), spaced evenly in in-plane flux. */
      const M = 360, flux: number[] = [];
      let total = 0;
      for (let i = 0; i < M; i++) {
        const a = (2 * Math.PI * i) / M, px = c.x + (c.r * 1.0005) * Math.cos(a), py = c.y + (c.r * 1.0005) * Math.sin(a);
        const e = fieldAt(src, px, py, undefined);
        const en = dir * (e.x * Math.cos(a) + e.y * Math.sin(a));
        const f = Math.max(0, en); flux.push(f); total += f;
      }
      if (total > 0) {
        let acc = 0, k = 0;
        for (let i = 0; i < M && k < ended; i++) {
          acc += flux[i];
          while (k < ended && acc >= total * (k + 0.5) / ended) {
            const a = (2 * Math.PI * i) / M;
            const l = traceLine(src, charges, { x: c.x + c.r * 1.002 * Math.cos(a), y: c.y + c.r * 1.002 * Math.sin(a) }, dir, b, c, { capture: seedR * 0.9 });
            l.from = -2; lines.push(l); k++;
          }
        }
      }
    }
  }
  return lines;
}

/** Points where E = 0 (saddles between like charges). Grid search for |E| minima, refined by Newton steps. */
export function nullPoints(charges: PointQ[], c: Sphere | undefined, b: Bounds): Vec[] {
  const src = imageSources(charges, c);
  const nx = 60, ny = 40, gx = (b.x1 - b.x0) / nx, gy = (b.y1 - b.y0) / ny;
  const mag = (x: number, y: number) => { const e = fieldAt(src, x, y, undefined); return Math.hypot(e.x, e.y); };
  const found: Vec[] = [];
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  for (let i = 1; i < nx; i++) for (let j = 1; j < ny; j++) {
    const x = b.x0 + i * gx, y = b.y0 + j * gy;
    if (insideSphere(c, x, y)) continue;
    const m = mag(x, y);
    let isMin = true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (mag(x + di * gx, y + dj * gy) <= m) { isMin = false; break; }
    if (!isMin) continue;
    /* Newton on E(x, y) = 0 with a numerical Jacobian. */
    let px = x, py = y, ok = false;
    for (let it = 0; it < 30; it++) {
      const e = fieldAt(src, px, py, undefined), d = span * 1e-6;
      const ex = fieldAt(src, px + d, py, undefined), ey = fieldAt(src, px, py + d, undefined);
      const a = (ex.x - e.x) / d, bb = (ey.x - e.x) / d, cc = (ex.y - e.y) / d, dd = (ey.y - e.y) / d;
      const det = a * dd - bb * cc; if (!Number.isFinite(det) || Math.abs(det) < 1e-30) break;
      const sx = (dd * e.x - bb * e.y) / det, sy = (-cc * e.x + a * e.y) / det;
      px -= sx; py -= sy;
      if (Math.hypot(sx, sy) < span * 1e-10) { ok = true; break; }
    }
    if (!ok || px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1 || insideSphere(c, px, py)) continue;
    if (charges.some(q => Math.hypot(q.x - px, q.y - py) < span * 0.01)) continue;
    if (!found.some(f => Math.hypot(f.x - px, f.y - py) < span * 0.005)) found.push({ x: px, y: py });
  }
  return found;
}

/** Marching squares: segments of the contour f = level on a grid (values row-major, nx × ny samples). */
export function contourSegments(vals: Float64Array, nx: number, ny: number, level: number, out: number[]) {
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = vals[j * nx + i], b = vals[j * nx + i + 1], c = vals[(j + 1) * nx + i + 1], d = vals[(j + 1) * nx + i];
    if (!Number.isFinite(a + b + c + d)) continue;
    const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const t = (p: number, q: number) => (level - p) / (q - p);
    const top = () => [i + t(a, b), j], right = () => [i + 1, j + t(b, c)], bottom = () => [i + t(d, c), j + 1], left = () => [i, j + t(a, d)];
    const seg = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);
    switch (idx) {
      case 1: case 14: seg(left(), top()); break;
      case 2: case 13: seg(top(), right()); break;
      case 3: case 12: seg(left(), right()); break;
      case 4: case 11: seg(right(), bottom()); break;
      case 6: case 9: seg(top(), bottom()); break;
      case 7: case 8: seg(left(), bottom()); break;
      case 5: seg(left(), top()); seg(right(), bottom()); break;
      case 10: seg(top(), right()); seg(bottom(), left()); break;
    }
  }
}

/* ============================ waves ============================ */

export type Wavelet = { x: number; y: number; a: number };
export type WaveScene =
  | { kind: "sources"; sources: { x: number; y: number }[] }
  | { kind: "slits"; barrierX: number; slits: { y: number; width: number }[] };

/** Huygens wavelets: point sources as given, or each slit sampled by `perSlit` in-phase points (plane wave at normal
    incidence). Amplitude per sample ∝ width/perSlit so a wider slit lets through proportionally more. */
export const MAX_WAVELETS = 64;
/** Samples a slit needs: spacing ≤ λ/2 across its width. Capped so all slits fit in MAX_WAVELETS. */
export const slitSamples = (width: number, lambda: number, slits: number) => Math.max(1, Math.min(Math.floor(MAX_WAVELETS / Math.max(1, slits)), Math.ceil((2 * width) / lambda) + 1));
export function wavelets(scene: WaveScene, lambda: number, perSlit = 0): Wavelet[] {
  if (scene.kind === "sources") return scene.sources.map(s => ({ x: s.x, y: s.y, a: 1 }));
  const out: Wavelet[] = [];
  for (const s of scene.slits) {
    const n = perSlit || slitSamples(s.width, lambda, scene.slits.length);
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? s.y : s.y - s.width / 2 + (s.width * (i + 0.5)) / n;
      out.push({ x: scene.barrierX, y, a: s.width / n / lambda });
    }
  }
  return out;
}
/** Time-averaged intensity |Σ a e^{ikr}/√r|² at a point (2-D cylindrical wavelets, far-field amplitude). */
export function intensityAt(ws: Wavelet[], k: number, x: number, y: number): number {
  let re = 0, im = 0;
  for (const w of ws) {
    const r = Math.hypot(x - w.x, y - w.y);
    if (r < 1e-9) continue;
    const amp = w.a / Math.sqrt(r);
    re += amp * Math.cos(k * r); im += amp * Math.sin(k * r);
  }
  return re * re + im * im;
}
/** Instantaneous displacement Re Σ a e^{i(kr − ωt)}/√r (for the crest view). */
export function displacementAt(ws: Wavelet[], k: number, phase: number, x: number, y: number): number {
  let s = 0;
  for (const w of ws) { const r = Math.hypot(x - w.x, y - w.y); if (r > 1e-9) s += (w.a / Math.sqrt(r)) * Math.cos(k * r - phase); }
  return s;
}
export function screenProfile(ws: Wavelet[], lambda: number, screenX: number, y0: number, y1: number, n: number): Float64Array {
  const k = (2 * Math.PI) / lambda, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = intensityAt(ws, k, screenX, y0 + ((y1 - y0) * i) / (n - 1));
  return out;
}
/** Measured spacing between neighbouring bright fringes nearest the axis (parabolic peak interpolation). */
export function measuredFringeSpacing(profile: Float64Array, y0: number, y1: number, centre: number): number {
  const n = profile.length, dy = (y1 - y0) / (n - 1), peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (profile[i] > profile[i - 1] && profile[i] >= profile[i + 1]) {
      const a = profile[i - 1], b = profile[i], c = profile[i + 1], den = a - 2 * b + c;
      peaks.push(y0 + (i + (den !== 0 ? 0.5 * (a - c) / den : 0)) * dy);
    }
  }
  if (peaks.length < 2) return NaN;
  peaks.sort((p, q) => Math.abs(p - centre) - Math.abs(q - centre));
  const near = peaks.slice(0, 3).sort((p, q) => p - q);
  return (near[near.length - 1] - near[0]) / (near.length - 1);
}
/** Path difference r₂ − r₁ (in wavelengths) from two points to (x, y). */
export const pathDifference = (a: Vec, b: Vec, p: Vec, lambda: number) => (Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(p.x - a.x, p.y - a.y)) / lambda;

/* ============================ quantum ============================ */

export type Potential =
  | { kind: "infinite"; left: number; right: number }
  | { kind: "finiteSquare"; left: number; right: number; depth: number }
  | { kind: "harmonic"; hw: number; center?: number }
  | { kind: "doubleWell"; barrier: number; separation: number; center?: number }
  | { kind: "barrier"; left: number; right: number; height: number }
  | { kind: "points"; points: [number, number][] };
export type QUnits = keyof typeof HB2M;

/** V(x). finiteSquare: −depth inside, 0 outside (Griffiths QM 3e §2.6). harmonic: ½mω²x² = (ℏω)²x²/(4·ℏ²/2m).
    doubleWell: barrier·((x/a)² − 1)². points: piecewise linear, flat beyond the ends. Infinite walls return +∞ outside. */
export function potentialFn(p: Potential, units: QUnits): (x: number) => number {
  const c = HB2M[units];
  switch (p.kind) {
    case "infinite": return x => (x <= p.left || x >= p.right ? Infinity : 0);
    case "finiteSquare": return x => (x > p.left && x < p.right ? -p.depth : 0);
    case "harmonic": { const x0 = p.center ?? 0; return x => (p.hw * p.hw * (x - x0) ** 2) / (4 * c); }
    case "doubleWell": { const x0 = p.center ?? 0; return x => p.barrier * (((x - x0) / p.separation) ** 2 - 1) ** 2; }
    case "barrier": return x => (x >= p.left && x <= p.right ? p.height : 0);
    case "points": {
      const pts = [...p.points].sort((a, b) => a[0] - b[0]);
      return x => {
        if (x <= pts[0][0]) return pts[0][1];
        for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, v0] = pts[i - 1], [x1, v1] = pts[i]; return x1 === x0 ? v1 : v0 + ((v1 - v0) * (x - x0)) / (x1 - x0); }
        return pts[pts.length - 1][1];
      };
    }
  }
}

export type Grid = { x: Float64Array; v: Float64Array; h: number; c: number };
/** Interior grid points of [a, b] with hard walls (ψ = 0) at a and b. For an infinite well the walls are its edges. */
export function makeGrid(p: Potential, units: QUnits, domain: [number, number], n: number): Grid {
  const [a, b] = p.kind === "infinite" ? [p.left, p.right] : domain;
  const h = (b - a) / (n + 1), V = potentialFn(p, units);
  const x = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = a + (i + 1) * h; v[i] = p.kind === "infinite" ? 0 : V(x[i]); }
  return { x, v, h, c: HB2M[units] };
}

/** Number of eigenvalues of the tridiagonal H (diag d, constant off-diagonal e) below λ (Sturm sequence). */
function sturmCount(d: Float64Array, e: number, lambda: number): number {
  let q = d[0] - lambda, count = q < 0 ? 1 : 0;
  const e2 = e * e;
  for (let i = 1; i < d.length; i++) {
    q = d[i] - lambda - e2 / (q === 0 ? 1e-300 : q);
    if (q < 0) count++;
  }
  return count;
}
/** Solve (H − μ)x = rhs for tridiagonal H (Thomas algorithm). */
function solveShifted(d: Float64Array, e: number, mu: number, rhs: Float64Array): Float64Array {
  const n = d.length, cp = new Float64Array(n), dp = new Float64Array(n), x = new Float64Array(n);
  let den = d[0] - mu; if (Math.abs(den) < 1e-300) den = 1e-300;
  cp[0] = e / den; dp[0] = rhs[0] / den;
  for (let i = 1; i < n; i++) {
    den = d[i] - mu - e * cp[i - 1]; if (Math.abs(den) < 1e-300) den = 1e-300;
    cp[i] = e / den; dp[i] = (rhs[i] - e * dp[i - 1]) / den;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

export type Eigen = { energies: number[]; states: Float64Array[] };
/** Lowest `count` eigenpairs of −(ℏ²/2m)ψ'' + Vψ = Eψ by second-order finite differences. ψ normalised Σψ²h = 1. */
export function eigenstates(g: Grid, count: number): Eigen {
  const n = g.x.length, k = g.c / (g.h * g.h), d = new Float64Array(n), e = -k;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { d[i] = 2 * k + g.v[i]; lo = Math.min(lo, d[i] - 2 * k); hi = Math.max(hi, d[i] + 2 * k); }
  const energies: number[] = [], states: Float64Array[] = [];
  const m = Math.min(count, n);
  for (let j = 0; j < m; j++) {
    let a = lo, b = hi;
    for (let it = 0; it < 200 && b - a > 1e-13 * Math.max(1, Math.abs(a) + Math.abs(b)); it++) {
      const mid = 0.5 * (a + b);
      if (sturmCount(d, e, mid) > j) b = mid; else a = mid;
    }
    const lam = 0.5 * (a + b);
    energies.push(lam);
    let vec: Float64Array = new Float64Array(n); for (let i = 0; i < n; i++) vec[i] = 1 + 0.01 * Math.sin(i * 1.7 + j);
    const mu = lam + Math.max(1e-12, Math.abs(lam) * 1e-12);
    for (let it = 0; it < 4; it++) {
      vec = solveShifted(d, e, mu, vec);
      /* Keep near-degenerate partners (deep double wells) orthogonal. */
      for (let p = 0; p < states.length; p++) if (Math.abs(energies[p] - lam) < 1e-6 * Math.max(1, Math.abs(lam))) {
        let dot = 0; for (let i = 0; i < n; i++) dot += vec[i] * states[p][i] * g.h;
        for (let i = 0; i < n; i++) vec[i] -= dot * states[p][i];
      }
      let s = 0; for (let i = 0; i < n; i++) s += vec[i] * vec[i];
      s = Math.sqrt(s * g.h) || 1; for (let i = 0; i < n; i++) vec[i] /= s;
    }
    /* Sign convention: the first sizeable lobe is positive. */
    let peak = 0; for (let i = 0; i < n; i++) if (Math.abs(vec[i]) > Math.abs(peak)) peak = vec[i];
    let first = 0; for (let i = 0; i < n; i++) if (Math.abs(vec[i]) > 0.2 * Math.abs(peak)) { first = vec[i]; break; }
    if (first < 0) for (let i = 0; i < n; i++) vec[i] = -vec[i];
    states.push(vec);
  }
  return { energies, states };
}

/** Probability of finding the particle where V > E (classically forbidden). Trapezoid rule on |ψ|² with fractional
    cells at the turning points (V and |ψ|² linear across a cell), so a turning point no longer adds or drops a whole
    cell. ψ = 0 at the hard walls just outside the grid; Σψ²h = 1 is then exactly the trapezoid norm.
    Harmonic ground state: erfc(1) = 0.1573 (Griffiths & Schroeter 3e, ch. 2). */
export function forbiddenProbability(g: Grid, psi: Float64Array, E: number): number {
  const n = psi.length, f = (i: number) => (i < 0 || i >= n ? 0 : psi[i] * psi[i]);
  const d = (i: number) => (i < 0 ? g.v[0] - E : i >= n ? g.v[n - 1] - E : g.v[i] - E);
  let p = 0;
  for (let i = -1; i < n; i++) {
    const da = d(i), db = d(i + 1), fa = f(i), fb = f(i + 1);
    if (!Number.isFinite(da) || !Number.isFinite(db)) { if (da > 0 && db > 0) p += 0.5 * g.h * (fa + fb); continue; }
    if (da > 0 && db > 0) p += 0.5 * g.h * (fa + fb);
    else if (da > 0 || db > 0) {
      const t = da / (da - db), ft = fa + t * (fb - fa);     // crossing at fraction t of the cell
      p += da > 0 ? 0.5 * g.h * t * (fa + ft) : 0.5 * g.h * (1 - t) * (ft + fb);
    }
  }
  return p;
}

/** Finite square well of width w and depth V0 on the infinite line: N = ⌈z₀/(π/2)⌉ bound states, z₀ = (w/2)√(2mV0)/ℏ
    (Griffiths QM §2.6). The n-th threshold V0 = (ℏ²/2m)(nπ/w)² is counted only once strictly crossed: exactly at it
    the new solution has E = 0 and is not normalisable, so it becomes bound just above that depth. */
export const THRESHOLD_TOL = 1e-6;
const zRatio = (w: number, V0: number, units: QUnits) => (w * Math.sqrt(V0 / HB2M[units])) / Math.PI;   // = 2z₀/π
export const boundStateCount = (w: number, V0: number, units: QUnits) => (!(V0 > 0) || !(w > 0) ? 0 : Math.max(1, Math.ceil(zRatio(w, V0, units) - THRESHOLD_TOL)));
/** n ≥ 1 when the depth sits (within tolerance) exactly on the n-th threshold, else 0. */
export const atBoundThreshold = (w: number, V0: number, units: QUnits) => { if (!(V0 > 0) || !(w > 0)) return 0; const r = zRatio(w, V0, units), n = Math.round(r); return n >= 1 && Math.abs(r - n) <= THRESHOLD_TOL ? n : 0; };
export const boundThreshold = (n: number, w: number, units: QUnits) => HB2M[units] * ((n * Math.PI) / w) ** 2;
/** Infinite well: Eₙ = n²π²ℏ²/(2mL²). */
export const infiniteWellE = (n: number, L: number, units: QUnits) => (n * n * Math.PI * Math.PI * HB2M[units]) / (L * L);

/** Exact transmission through a rectangular barrier (Griffiths QM 2e Prob. 2.33; the Astra review reports the 3e excerpt numbers it 2.33 too). At E = V0 the
    finite threshold limit 1/(1 + V0a²/(4ℏ²/2m)) is used, with a relative tolerance. */
export function barrierT(E: number, V0: number, a: number, units: QUnits): number {
  const c = HB2M[units];
  if (E <= 0) return 0;
  if (Math.abs(E - V0) <= E_EQ_TOL * Math.max(1, Math.abs(V0))) return 1 / (1 + (V0 * a * a) / (4 * c));
  if (E < V0) { const kap = Math.sqrt((V0 - E) / c), s = Math.sinh(kap * a); return 1 / (1 + (V0 * V0 * s * s) / (4 * E * (V0 - E))); }
  const kp = Math.sqrt((E - V0) / c), s = Math.sin(kp * a);
  return 1 / (1 + (V0 * V0 * s * s) / (4 * E * (E - V0)));
}

/** E and V are treated as equal within this relative tolerance (UI energies are snapped to 1/200 of the axis). */
export const E_EQ_TOL = 1e-9;
export const sameEnergy = (E: number, V: number) => Math.abs(E - V) <= E_EQ_TOL * Math.max(1, Math.abs(V));
/** Over-barrier resonance index: n ≥ 1 when k′a is within `tol` of nπ (complete transmission), else 0. */
export function barrierResonance(E: number, V0: number, a: number, units: QUnits, tol = 0.06): number {
  if (!(E > V0) || !(a > 0)) return 0;
  const ka = Math.sqrt((E - V0) / HB2M[units]) * a, n = Math.round(ka / Math.PI);
  return n >= 1 && Math.abs(ka - n * Math.PI) <= tol * Math.PI ? n : 0;
}
type C = [number, number];
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cexp = (a: C): C => { const m = Math.exp(a[0]); return [m * Math.cos(a[1]), m * Math.sin(a[1])]; };
const csqrt = (v: number): C => (v >= 0 ? [Math.sqrt(v), 0] : [0, Math.sqrt(-v)]);

export type Scattering = { T: number; R: number; psi2: (x: number) => number; re: (x: number) => number };
/** Transmission through any potential by slicing it into piecewise-constant steps (transfer matrices), with the
    incident wave e^{ikx} from the left. Returns T, R and |ψ(x)|² normalised to a unit incident amplitude. */
export function scatter(V: (x: number) => number, E: number, x0: number, x1: number, slices: number, units: QUnits): Scattering {
  const c = HB2M[units];
  const edges: number[] = [], vs: number[] = [V(x0 - 1e-9)];
  for (let i = 0; i <= slices; i++) edges.push(x0 + ((x1 - x0) * i) / slices);
  for (let i = 0; i < slices; i++) vs.push(V(0.5 * (edges[i] + edges[i + 1])));
  vs.push(V(x1 + 1e-9));
  /* Region j spans edges[j-1]..edges[j] (region 0: x < x0, region last: x > x1). k_j = √((E − V_j)/c) (complex). */
  const ks = vs.map(v => { const kk = csqrt((E - v) / c); return (kk[0] === 0 && kk[1] === 0 ? [1e-9, 0] : kk) as C; });
  const N = vs.length;
  const A: C[] = new Array(N), B: C[] = new Array(N);
  A[N - 1] = [1, 0]; B[N - 1] = [0, 0];
  for (let j = N - 2; j >= 0; j--) {
    const xb = edges[j], k1 = ks[j], k2 = ks[j + 1];
    const i = (z: C): C => [-z[1], z[0]];
    const e2p = cmul(A[j + 1], cexp(i([k2[0] * xb, k2[1] * xb]))), e2m = cmul(B[j + 1], cexp(i([-k2[0] * xb, -k2[1] * xb])));
    const psi = cadd(e2p, e2m), dpsi = cmul(i(k2), [e2p[0] - e2m[0], e2p[1] - e2m[1]]);
    /* In region j: ψ = a e^{ik1x} + b e^{−ik1x}; match ψ and ψ' at xb. */
    const ik1 = i(k1), half = (z: C): C => [z[0] / 2, z[1] / 2];
    const t = cdiv(dpsi, ik1);
    const a = cmul(half([psi[0] + t[0], psi[1] + t[1]]), cexp(i([-k1[0] * xb, -k1[1] * xb])));
    const b = cmul(half([psi[0] - t[0], psi[1] - t[1]]), cexp(i([k1[0] * xb, k1[1] * xb])));
    A[j] = a; B[j] = b;
  }
  const inc = A[0], scale = cdiv([1, 0], inc);
  for (let j = 0; j < N; j++) { A[j] = cmul(A[j], scale); B[j] = cmul(B[j], scale); }
  const T = (A[N - 1][0] ** 2 + A[N - 1][1] ** 2) * (ks[N - 1][0] / ks[0][0]);
  const R = B[0][0] ** 2 + B[0][1] ** 2;
  const region = (x: number) => { if (x < x0) return 0; if (x >= x1) return N - 1; return 1 + Math.min(slices - 1, Math.floor(((x - x0) / (x1 - x0)) * slices)); };
  const psiAt = (x: number): C => {
    const j = region(x), k = ks[j];
    const p = cexp([-k[1] * x, k[0] * x]), m = cexp([k[1] * x, -k[0] * x]);
    return cadd(cmul(A[j], p), cmul(B[j], m));
  };
  return { T, R, psi2: x => { const p = psiAt(x); return p[0] * p[0] + p[1] * p[1]; }, re: x => psiAt(x)[0] };
}

/** Crank–Nicolson propagator for iℏ ∂ψ/∂t = Hψ on a grid with hard walls: (1 + iHΔt/2ℏ)ψⁿ⁺¹ = (1 − iHΔt/2ℏ)ψⁿ.
    Unitary for Hermitian H, so the norm is conserved to rounding. */
export class CrankNicolson {
  re: Float64Array; im: Float64Array;
  private cpr: Float64Array; private cpi: Float64Array; private dr: Float64Array; private di: Float64Array;
  private alpha: number; private beta: Float64Array;
  constructor(public g: Grid, public dt: number, public units: QUnits, re: Float64Array, im: Float64Array) {
    const n = g.x.length; this.re = re; this.im = im;
    this.cpr = new Float64Array(n); this.cpi = new Float64Array(n); this.dr = new Float64Array(n); this.di = new Float64Array(n);
    const hbar = HBAR_T[units], k = g.c / (g.h * g.h);
    /* H: diag 2k + V, off −k. With r = Δt/2ℏ: LHS diag 1 + i r(2k+V), off −i r k. */
    const r = dt / (2 * hbar);
    this.alpha = r * k; this.beta = new Float64Array(n);
    for (let i = 0; i < n; i++) this.beta[i] = r * (2 * k + g.v[i]);
  }
  step() {
    const n = this.re.length, { re, im, alpha: al, beta: be } = this;
    /* rhs = (1 − irH)ψ: (1 − i·be)ψ_i + i·al(ψ_{i−1} + ψ_{i+1}). */
    const rr = new Float64Array(n), ri = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sr = (i > 0 ? re[i - 1] : 0) + (i < n - 1 ? re[i + 1] : 0), si = (i > 0 ? im[i - 1] : 0) + (i < n - 1 ? im[i + 1] : 0);
      rr[i] = re[i] + be[i] * im[i] - al * si;
      ri[i] = im[i] - be[i] * re[i] + al * sr;
    }
    /* LHS: diag (1, be_i), off (0, −al). Complex Thomas. */
    const { cpr, cpi, dr, di } = this;
    const offR = 0, offI = -al;
    let denR = 1, denI = be[0];
    let q = denR * denR + denI * denI;
    cpr[0] = (offR * denR + offI * denI) / q; cpi[0] = (offI * denR - offR * denI) / q;
    dr[0] = (rr[0] * denR + ri[0] * denI) / q; di[0] = (ri[0] * denR - rr[0] * denI) / q;
    for (let i = 1; i < n; i++) {
      /* den = diag − off·cp[i−1] */
      const mr = offR * cpr[i - 1] - offI * cpi[i - 1], mi = offR * cpi[i - 1] + offI * cpr[i - 1];
      denR = 1 - mr; denI = be[i] - mi; q = denR * denR + denI * denI;
      cpr[i] = (offR * denR + offI * denI) / q; cpi[i] = (offI * denR - offR * denI) / q;
      const nr = rr[i] - (offR * dr[i - 1] - offI * di[i - 1]), ni = ri[i] - (offR * di[i - 1] + offI * dr[i - 1]);
      dr[i] = (nr * denR + ni * denI) / q; di[i] = (ni * denR - nr * denI) / q;
    }
    re[n - 1] = dr[n - 1]; im[n - 1] = di[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      re[i] = dr[i] - (cpr[i] * re[i + 1] - cpi[i] * im[i + 1]);
      im[i] = di[i] - (cpr[i] * im[i + 1] + cpi[i] * re[i + 1]);
    }
  }
  norm(from = -Infinity, to = Infinity) {
    let s = 0; for (let i = 0; i < this.re.length; i++) { const x = this.g.x[i]; if (x >= from && x <= to) s += (this.re[i] ** 2 + this.im[i] ** 2) * this.g.h; }
    return s;
  }
}
/** Normalised Gaussian packet centred at x0, width σ (in |ψ|², std σ), central wavenumber k0. Its momentum spread is
    σk = 1/(2σ), so its mean kinetic energy is (ℏ²/2m)(k0² + σk²), not ℏ²k0²/2m. */
export function gaussianPacket(g: Grid, x0: number, sigma: number, k0: number) {
  const n = g.x.length, re = new Float64Array(n), im = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = g.x[i] - x0, env = Math.exp(-(d * d) / (4 * sigma * sigma)); re[i] = env * Math.cos(k0 * g.x[i]); im[i] = env * Math.sin(k0 * g.x[i]); s += env * env * g.h; }
  s = Math.sqrt(s); for (let i = 0; i < n; i++) { re[i] /= s; im[i] /= s; }
  return { re, im };
}
