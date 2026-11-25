/* Vetted art for SortBoard. A model references these by name ("cell.metaphase", "plantCell") instead of
   writing SVG paths; a shape list stays available as an escape hatch. Every icon is drawn in a 100 × 80 box
   with theme tones only, so it follows light and dark. Diagrams carry named anchors for label spots. */

export type SortTone = "ink" | "muted" | "line" | "soft" | "paper" | "accent" | "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "none";
type ShapeStyle = { fill?: SortTone; stroke?: SortTone; width?: number; dash?: boolean; opacity?: number };
/** Whitelisted SVG shapes. No raw markup: a path is only its `d` command string. */
export type SortShape =
  | (ShapeStyle & { kind: "circle"; cx: number; cy: number; r: number })
  | (ShapeStyle & { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number })
  | (ShapeStyle & { kind: "rect"; x: number; y: number; w: number; h: number; rx?: number })
  | (ShapeStyle & { kind: "path"; d: string })
  | (ShapeStyle & { kind: "text"; x: number; y: number; text: string; size?: number; anchor?: "start" | "middle" | "end"; weight?: number });

/** A library diagram anchor: the exact point, plus an optional `pin` where the numbered marker sits
    (a short line joins them) when the point itself is too tight for a marker. */
export type DiagramAnchor = { at: [number, number]; pin?: [number, number] };
export type LibraryDiagram = { width: number; height: number; shapes: SortShape[]; anchors: Record<string, DiagramAnchor>; note?: string };

/* ---------- helpers ---------- */
const P = (d: string, stroke: SortTone, width = 1.6, extra: Partial<ShapeStyle> = {}): SortShape => ({ kind: "path", d, stroke, width, ...extra });
const C = (cx: number, cy: number, r: number, fill: SortTone, extra: Partial<ShapeStyle> = {}): SortShape => ({ kind: "circle", cx, cy, r, fill, ...extra });
const E = (cx: number, cy: number, rx: number, ry: number, fill: SortTone, extra: Partial<ShapeStyle> = {}): SortShape => ({ kind: "ellipse", cx, cy, rx, ry, fill, ...extra });
const R = (x: number, y: number, w: number, h: number, fill: SortTone, extra: Partial<ShapeStyle> & { rx?: number } = {}): SortShape => ({ kind: "rect", x, y, w, h, fill, ...extra });

// cells
const cell = (rx = 44, ry = 32): SortShape => E(50, 40, rx, ry, "soft", { stroke: "muted", width: 1.4 });
const X = (x: number, y: number): SortShape => P(`M${x - 3} ${y - 4.5} L${x + 3} ${y + 4.5} M${x + 3} ${y - 4.5} L${x - 3} ${y + 4.5}`, "c5", 2.4);
const V = (x: number, y: number, dir: 1 | -1): SortShape => P(`M${x + 7 * dir} ${y - 5} L${x} ${y} L${x + 7 * dir} ${y + 5}`, "c5", 2.4);
const pole = (x: number, y = 40): SortShape => C(x, y, 2.8, "c3");
const fibres = (px: number, xs: number, ys: number[]): SortShape => P(ys.map(y => `M${px} 40 L${xs} ${y}`).join(" "), "muted", 0.8, { opacity: 0.7 });
const chromatin = (cx: number, cy: number, w = 8): SortShape => P(`M${cx - w} ${cy - 2} q${w / 2} -5 ${w} 0 t${w} 0 M${cx - w + 2} ${cy + 4} q${w / 2} 4 ${w} 0 t${w - 2} 0`, "c5", 1.3, { opacity: 0.85 });
const nucleus = (cx: number, cy: number, r: number): SortShape => C(cx, cy, r, "paper", { stroke: "c1", width: 1.3 });
// clouds
const cloud = (dx = 0, dy = 0, s = 1): SortShape[] => [
  C(34 * s + dx, 44 * s + dy, 14 * s, "paper", { stroke: "muted", width: 1.4 }), C(52 * s + dx, 36 * s + dy, 18 * s, "paper", { stroke: "muted", width: 1.4 }),
  C(70 * s + dx, 45 * s + dy, 13 * s, "paper", { stroke: "muted", width: 1.4 }), R(30 * s + dx, 44 * s + dy, 44 * s, 14 * s, "paper"),
  P(`M${22 * s + dx} ${58 * s + dy} L${82 * s + dx} ${58 * s + dy}`, "muted", 1.4)];
// moon phase p in [0,1): 0 new, .25 first quarter, .5 full, .75 last quarter (northern hemisphere: waxing lit on the right)
function moon(p: number): SortShape[] {
  const cx = 50, cy = 40, r = 26;
  const disc = C(cx, cy, r, "soft", { stroke: "muted", width: 1.3 });
  if (p === 0) return [disc];
  if (p === 0.5) return [disc, C(cx, cy, r, "c3", { opacity: 0.9 })];
  const rx = Math.abs(Math.cos(2 * Math.PI * p)) * r;
  const waxing = p < 0.5; const crescent = p < 0.25 || p > 0.75;
  const outer = waxing ? 1 : 0;
  const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
  const d = `M${cx} ${cy - r} A${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A${rx.toFixed(2)} ${r} 0 0 ${term} ${cx} ${cy - r} Z`;
  return [disc, { kind: "path", d, fill: "c3", opacity: 0.9 }];
}
// particles for states of matter
const dots = (pts: [number, number][], r = 5): SortShape[] => pts.map(([x, y]) => C(x, y, r, "c1", { stroke: "ink", width: 0.8, opacity: 0.85 }));

export const ART: Record<string, SortShape[]> = {
  /* mitosis */
  "cell.interphase": [cell(), C(50, 40, 16, "paper", { stroke: "c1", width: 1.4 }), chromatin(46, 40), C(56, 34, 2.6, "c1")],
  "cell.prophase": [cell(), C(50, 40, 19, "none", { stroke: "c1", width: 1.3, dash: true }), X(42, 33), X(57, 31), X(45, 47), X(59, 46), pole(18, 34), pole(82, 46)],
  "cell.metaphase": [cell(), fibres(12, 50, [24, 33, 47, 56]), fibres(88, 50, [24, 33, 47, 56]), X(50, 24), X(50, 33), X(50, 47), X(50, 56), pole(12), pole(88)],
  "cell.anaphase": [cell(46, 30), fibres(8, 28, [27, 40, 53]), fibres(92, 72, [27, 40, 53]), V(27, 27, 1), V(29, 40, 1), V(27, 53, 1), V(73, 27, -1), V(71, 40, -1), V(73, 53, -1), pole(8), pole(92)],
  "cell.telophase": [{ kind: "path", d: "M50 13 C40 5 6 7 6 40 C6 73 40 75 50 67 C60 75 94 73 94 40 C94 7 60 5 50 13 Z", fill: "soft", stroke: "muted", width: 1.4 },
    nucleus(28, 40, 12), nucleus(72, 40, 12), chromatin(26, 40, 6), chromatin(70, 40, 6)],
  "cell.cytokinesis": [E(28, 40, 22, 27, "soft", { stroke: "muted", width: 1.4 }), E(72, 40, 22, 27, "soft", { stroke: "muted", width: 1.4 }),
    P("M50 22 L50 58", "c3", 1.6, { dash: true }), nucleus(28, 40, 10), nucleus(72, 40, 10), chromatin(26, 40, 5), chromatin(70, 40, 5)],
  "cell.daughters": [E(26, 40, 21, 25, "soft", { stroke: "muted", width: 1.4 }), E(74, 40, 21, 25, "soft", { stroke: "muted", width: 1.4 }),
    nucleus(26, 40, 9), nucleus(74, 40, 9), chromatin(24, 40, 5), chromatin(72, 40, 5)],
  /* water cycle */
  "water.evaporation": [{ kind: "path", d: "M4 62 q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 L96 78 L4 78 Z", fill: "c1", opacity: 0.35 },
    P("M4 62 q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0", "c1", 2), P("M30 54 q-4 -7 0 -14 t0 -14 M50 54 q-4 -7 0 -14 t0 -14 M70 54 q-4 -7 0 -14 t0 -14", "muted", 1.6, { dash: true }),
    P("M26 30 L30 24 L34 30 M46 30 L50 24 L54 30 M66 30 L70 24 L74 30", "muted", 1.6)],
  "water.condensation": [...cloud(), C(40, 46, 1.8, "c1"), C(52, 40, 1.8, "c1"), C(62, 48, 1.8, "c1"), C(48, 51, 1.8, "c1")],
  "water.precipitation": [...cloud(4, -16, 0.9), P("M34 44 l-3 8 M46 42 l-3 8 M58 44 l-3 8 M70 42 l-3 8 M40 58 l-3 8 M52 60 l-3 8 M64 58 l-3 8", "c1", 2)],
  "water.collection": [{ kind: "path", d: "M2 50 C18 30 34 32 46 46 L46 78 L2 78 Z", fill: "accent", opacity: 0.35 }, P("M30 40 C40 52 50 58 62 60", "c1", 3),
    E(74, 64, 22, 9, "c1", { opacity: 0.45 }), P("M60 64 q4 -3 8 0 t8 0 t8 0", "c1", 1.4)],
  "sun": [C(50, 40, 15, "c3", { opacity: 0.85 }), P("M50 14 L50 20 M50 60 L50 66 M24 40 L30 40 M70 40 L76 40 M32 22 L36 26 M68 22 L64 26 M32 58 L36 54 M68 58 L64 54", "c3", 2)],
  "cloud": cloud(),
  "rain": [...cloud(4, -16, 0.9), P("M34 44 l-3 8 M46 42 l-3 8 M58 44 l-3 8 M70 42 l-3 8", "c1", 2)],
  "drop": [{ kind: "path", d: "M50 12 C62 30 70 40 70 52 A20 20 0 0 1 30 52 C30 40 38 30 50 12 Z", fill: "c1", opacity: 0.55, stroke: "c1", width: 1.4 }],
  "snowflake": [P("M50 14 L50 66 M28 27 L72 53 M28 53 L72 27 M44 18 L50 24 L56 18 M44 62 L50 56 L56 62", "c1", 2)],
  "flame": [{ kind: "path", d: "M50 10 C58 26 72 34 70 54 A20 20 0 0 1 30 54 C29 42 38 36 42 26 C46 34 48 38 52 40 C54 30 52 20 50 10 Z", fill: "c3", opacity: 0.75, stroke: "c3", width: 1.4 },
    { kind: "path", d: "M50 40 C56 48 60 52 58 60 A8 8 0 0 1 42 60 C42 54 46 50 50 40 Z", fill: "c5", opacity: 0.7 }],
  "leaf": [{ kind: "path", d: "M22 64 C20 36 44 14 80 14 C80 46 60 66 22 64 Z", fill: "accent", opacity: 0.5, stroke: "accent", width: 1.4 }, P("M22 64 C40 48 56 34 72 22", "accent", 1.4)],
  /* energy sources */
  "energy.wind": [P("M50 36 L50 74", "ink", 2.4), C(50, 36, 3, "ink"), P("M50 36 L50 8 M50 36 L26 50 M50 36 L74 50", "muted", 4)],
  "energy.coal": [{ kind: "path", d: "M22 60 L30 38 L48 30 L66 34 L80 52 L70 66 L40 68 Z", fill: "ink", opacity: 0.8 }, P("M36 46 L48 40 M56 44 L66 50", "paper", 1.2, { opacity: 0.5 })],
  "energy.oil": [R(32, 18, 36, 50, "muted", { rx: 4, opacity: 0.55, stroke: "ink", width: 1.4 }), P("M32 32 L68 32 M32 54 L68 54", "ink", 1.4), { kind: "path", d: "M50 38 C54 43 56 45 56 48 A6 6 0 0 1 44 48 C44 45 46 43 50 38 Z", fill: "ink" }],
  "energy.atom": [E(50, 40, 32, 11, "none", { stroke: "c4", width: 1.6 }), { kind: "path", d: "M30 16 C42 10 76 46 70 64 C58 70 24 34 30 16 Z", fill: "none", stroke: "c4", width: 1.6 },
    { kind: "path", d: "M70 16 C58 10 24 46 30 64 C42 70 76 34 70 16 Z", fill: "none", stroke: "c4", width: 1.6 }, C(50, 40, 5, "c4")],
  "energy.solar": [C(78, 16, 9, "c3", { opacity: 0.85 }), { kind: "path", d: "M16 64 L28 30 L72 30 L84 64 Z", fill: "c1", opacity: 0.4, stroke: "c1", width: 1.4 },
    P("M22 47 L78 47 M43 30 L39 64 M57 30 L61 64", "c1", 1.2)],
  "energy.hydro": [{ kind: "path", d: "M8 30 L40 30 L48 70 L8 70 Z", fill: "c1", opacity: 0.4 }, R(40, 18, 14, 56, "muted", { opacity: 0.7, stroke: "ink", width: 1.2 }),
    P("M54 60 C66 60 72 66 92 66", "c1", 3), C(66, 46, 8, "none", { stroke: "ink", width: 1.4 }), P("M66 38 L66 54 M58 46 L74 46", "ink", 1.2)],
  /* plant life cycle */
  "plant.seed": [E(50, 46, 16, 11, "c3", { opacity: 0.7, stroke: "c3", width: 1.4 }), P("M38 44 C46 40 56 40 62 46", "ink", 1, { opacity: 0.5 }), P("M10 64 L90 64", "muted", 1.4)],
  "plant.sprout": [P("M10 64 L90 64", "muted", 1.4), P("M50 64 L50 40", "accent", 2.2), { kind: "path", d: "M50 44 C40 44 32 36 32 28 C42 28 50 34 50 44 Z", fill: "accent", opacity: 0.7 },
    { kind: "path", d: "M50 40 C60 40 68 32 68 24 C58 24 50 30 50 40 Z", fill: "accent", opacity: 0.7 }, P("M50 64 L44 72 M50 64 L56 74", "muted", 1)],
  "plant.young": [P("M10 70 L90 70", "muted", 1.4), P("M50 70 L50 20", "accent", 2.4), ...[[30, 50], [70, 42], [32, 32]].map(([x, y]) =>
    ({ kind: "path" as const, d: `M50 ${y + 6} C${x} ${y + 8} ${x} ${y - 6} ${x} ${y - 6} C${x + (x < 50 ? 10 : -10)} ${y - 6} 50 ${y} 50 ${y + 6} Z`, fill: "accent" as SortTone, opacity: 0.7 }))],
  "plant.flower": [P("M50 74 L50 40", "accent", 2.4), ...[0, 72, 144, 216, 288].map(a => E(50 + 11 * Math.cos(a * Math.PI / 180), 30 + 11 * Math.sin(a * Math.PI / 180), 8, 8, "c5", { opacity: 0.6 })),
    C(50, 30, 6, "c3"), { kind: "path", d: "M50 60 C40 60 34 54 32 48 C42 48 48 52 50 60 Z", fill: "accent", opacity: 0.7 }],
  "plant.fruit": [P("M50 12 L50 22", "accent", 2.2), { kind: "path", d: "M50 20 C52 14 60 12 64 14 C60 20 54 22 50 20 Z", fill: "accent", opacity: 0.8 },
    { kind: "path", d: "M50 24 C34 16 18 30 22 48 C26 64 40 72 50 66 C60 72 74 64 78 48 C82 30 66 16 50 24 Z", fill: "c5", opacity: 0.6, stroke: "c5", width: 1.4 }],
  /* butterfly life cycle */
  "insect.egg": [{ kind: "path", d: "M14 56 C30 40 70 40 86 56 C70 64 30 64 14 56 Z", fill: "accent", opacity: 0.45, stroke: "accent", width: 1.2 }, ...[[40, 50], [50, 47], [60, 50]].map(([x, y]) => E(x, y, 4, 5, "paper", { stroke: "muted", width: 1.1 }))],
  "insect.caterpillar": [...[24, 36, 48, 60, 72].map((x, i) => C(x, 48 - (i % 2) * 3, 8, "accent", { opacity: 0.75, stroke: "accent", width: 1 })), C(82, 42, 8, "c2", { opacity: 0.9 }), P("M84 34 L88 26 M80 34 L78 26", "ink", 1.2)],
  "insect.chrysalis": [P("M50 8 L50 16", "muted", 1.6), { kind: "path", d: "M50 16 C62 22 64 44 58 60 C55 68 45 68 42 60 C36 44 38 22 50 16 Z", fill: "c3", opacity: 0.55, stroke: "c3", width: 1.4 }, P("M42 34 L58 34 M42 46 L58 46", "c3", 1)],
  "insect.butterfly": [{ kind: "path", d: "M50 40 C40 18 14 14 16 34 C18 46 34 46 50 42 Z", fill: "c4", opacity: 0.6, stroke: "c4", width: 1.2 },
    { kind: "path", d: "M50 40 C60 18 86 14 84 34 C82 46 66 46 50 42 Z", fill: "c4", opacity: 0.6, stroke: "c4", width: 1.2 },
    { kind: "path", d: "M50 44 C40 50 26 64 34 68 C42 70 48 58 50 46 Z", fill: "c5", opacity: 0.55 }, { kind: "path", d: "M50 44 C60 50 74 64 66 68 C58 70 52 58 50 46 Z", fill: "c5", opacity: 0.55 },
    E(50, 44, 3, 13, "ink"), P("M48 32 L42 22 M52 32 L58 22", "ink", 1.1)],
  /* moon phases */
  "moon.new": moon(0), "moon.waxingCrescent": moon(0.125), "moon.firstQuarter": moon(0.25), "moon.waxingGibbous": moon(0.375),
  "moon.full": moon(0.5), "moon.waningGibbous": moon(0.625), "moon.lastQuarter": moon(0.75), "moon.waningCrescent": moon(0.875),
  /* states of matter */
  "matter.solid": [R(24, 14, 52, 52, "none", { stroke: "muted", width: 1.2, dash: true }), ...dots([[34, 24], [50, 24], [66, 24], [34, 40], [50, 40], [66, 40], [34, 56], [50, 56], [66, 56]], 6.5)],
  "matter.liquid": [P("M20 18 L20 70 L80 70 L80 18", "muted", 1.4), ...dots([[30, 62], [44, 63], [58, 61], [71, 63], [36, 49], [51, 50], [65, 48], [29, 37], [72, 38]], 6)],
  "matter.gas": [R(14, 10, 72, 62, "none", { stroke: "muted", width: 1.2, dash: true }), ...dots([[24, 22], [62, 18], [44, 40], [76, 48], [28, 60], [56, 62]], 5),
    P("M30 22 L38 20 M68 18 L76 22 M50 40 L58 36 M80 50 L84 56", "muted", 1)],
  /* scientific method */
  "method.observe": [{ kind: "path", d: "M10 40 C26 16 74 16 90 40 C74 64 26 64 10 40 Z", fill: "paper", stroke: "ink", width: 1.6 }, C(50, 40, 13, "c1", { opacity: 0.7 }), C(50, 40, 5, "ink")],
  "method.question": [C(50, 40, 28, "soft", { stroke: "muted", width: 1.4 }), P("M40 32 C40 22 60 22 60 32 C60 40 50 40 50 48", "ink", 3), C(50, 57, 2.6, "ink")],
  "method.hypothesis": [{ kind: "path", d: "M50 10 C34 10 26 22 26 32 C26 42 36 48 38 56 L62 56 C64 48 74 42 74 32 C74 22 66 10 50 10 Z", fill: "c3", opacity: 0.45, stroke: "c3", width: 1.6 },
    R(39, 58, 22, 6, "muted"), R(41, 66, 18, 5, "muted"), P("M44 44 L50 36 L56 44", "c3", 1.6)],
  "method.predict": [C(56, 40, 26, "none", { stroke: "c5", width: 1.6 }), C(56, 40, 16, "none", { stroke: "c5", width: 1.6 }), C(56, 40, 5, "c5"), P("M12 64 L50 44", "ink", 2), P("M42 42 L51 44 L46 52", "ink", 2)],
  "method.experiment": [{ kind: "path", d: "M42 12 L42 34 L24 66 C22 70 24 72 28 72 L72 72 C76 72 78 70 76 66 L58 34 L58 12", fill: "paper", stroke: "ink", width: 1.6 },
    { kind: "path", d: "M33 52 L67 52 L76 66 C78 70 76 72 72 72 L28 72 C24 72 22 70 24 66 Z", fill: "c6", opacity: 0.55 }, P("M38 12 L62 12", "ink", 2), C(46, 62, 2.5, "paper"), C(56, 58, 2, "paper")],
  "method.analyse": [P("M16 12 L16 70 L88 70", "ink", 1.6), R(24, 46, 12, 24, "c1", { opacity: 0.7 }), R(42, 32, 12, 38, "c1", { opacity: 0.7 }), R(60, 22, 12, 48, "c1", { opacity: 0.7 }), P("M22 50 L46 34 L72 18", "c5", 1.6)],
  "method.conclude": [C(50, 40, 28, "accent", { opacity: 0.25, stroke: "accent", width: 1.6 }), P("M36 40 L46 50 L66 28", "accent", 4)],
  "method.share": [{ kind: "path", d: "M12 18 L56 18 L56 46 L30 46 L20 56 L22 46 L12 46 Z", fill: "paper", stroke: "ink", width: 1.4 },
    { kind: "path", d: "M44 34 L88 34 L88 62 L78 62 L80 72 L70 62 L44 62 Z", fill: "c1", opacity: 0.4, stroke: "c1", width: 1.4 }, P("M20 28 L48 28 M20 36 L40 36", "muted", 1.4)],
};

export const DIAGRAMS: Record<string, LibraryDiagram> = {
  plantCell: {
    width: 260, height: 200,
    shapes: [
      R(6, 6, 248, 188, "none", { rx: 22, stroke: "c3", width: 9, opacity: 0.7 }),
      R(18, 18, 224, 164, "soft", { rx: 14, stroke: "ink", width: 1.2 }),
      R(108, 40, 112, 104, "c1", { rx: 36, stroke: "c1", width: 1.3, opacity: 0.3 }),
      C(62, 68, 24, "c4", { stroke: "c4", width: 1.3, opacity: 0.4 }), C(68, 62, 7, "c4", { opacity: 0.9 }),
      E(62, 152, 17, 8, "accent", { opacity: 0.75 }), P("M50 152 L74 152 M53 148 L71 148 M53 156 L71 156", "paper", 1.1),
      E(140, 166, 15, 7, "accent", { opacity: 0.75 }), P("M129 166 L151 166 M132 162 L148 162", "paper", 1.1),
      E(34, 112, 8, 14, "accent", { opacity: 0.75 }),
      E(205, 165, 14, 7.5, "c5", { opacity: 0.5, stroke: "c5", width: 1.2 }), P("M194 165 l3 -4 l3 7 l3 -7 l3 7 l3 -7 l3 4", "c5", 1.1),
      E(94, 116, 10, 5.5, "c5", { opacity: 0.45, stroke: "c5", width: 1.1 }),
    ],
    anchors: {
      wall: { at: [130, 6] }, membrane: { at: [242, 100], pin: [229, 100] }, cytoplasm: { at: [94, 34] },
      nucleus: { at: [50, 80] }, nucleolus: { at: [68, 62] }, vacuole: { at: [178, 92] },
      chloroplast: { at: [62, 152] }, mitochondrion: { at: [205, 165] },
    },
    note: "Wall is the thick outer band; membrane the thin line just inside it.",
  },
  animalCell: {
    width: 260, height: 200,
    shapes: [
      { kind: "path", d: "M40 60 C50 20 120 12 170 22 C220 30 250 70 244 112 C238 160 196 190 130 186 C70 184 22 160 18 118 C14 92 30 76 40 60 Z", fill: "soft", stroke: "ink", width: 1.4 },
      C(120, 98, 34, "c4", { stroke: "c4", width: 1.3, opacity: 0.35 }), C(132, 90, 10, "c4", { opacity: 0.9 }),
      E(200, 72, 18, 9, "c5", { opacity: 0.5, stroke: "c5", width: 1.2 }), P("M186 72 l3 -5 l4 9 l4 -9 l4 9 l4 -9 l4 9 l3 -4", "c5", 1.1),
      E(72, 152, 16, 8, "c5", { opacity: 0.5, stroke: "c5", width: 1.2 }), P("M60 152 l3 -4 l4 8 l4 -8 l4 8 l4 -8 l3 4", "c5", 1.1),
      ...[[58, 90], [66, 104], [54, 118], [196, 140], [206, 128], [186, 152], [172, 50], [150, 40]].map(([x, y]) => C(x, y, 2.4, "c1")),
    ],
    anchors: {
      membrane: { at: [18, 118] }, cytoplasm: { at: [170, 166] }, nucleus: { at: [100, 118] }, nucleolus: { at: [132, 90] },
      mitochondrion: { at: [200, 72] }, ribosome: { at: [62, 104], pin: [72, 120] },
    },
  },
  neuron: {
    width: 260, height: 160,
    shapes: [
      P("M34 68 L14 44 M24 56 L6 58 M14 44 L18 30 M14 44 L4 36 M32 94 L12 120 M22 108 L4 106 M12 120 L8 136 M12 120 L24 136 M46 58 L40 34 M40 34 L30 24 M40 34 L48 20", "ink", 2.2),
      C(52, 80, 22, "soft", { stroke: "ink", width: 1.6 }), C(54, 78, 8, "c2", { stroke: "ink", width: 1.2, opacity: 0.9 }),
      { kind: "path", d: "M72 72 L88 77 L88 83 L72 88 Z", fill: "soft", stroke: "ink", width: 1.3 },
      P("M88 80 L216 80", "ink", 2.6),
      R(96, 72, 26, 16, "c1", { rx: 7, stroke: "ink", width: 1.2, opacity: 0.8 }), R(130, 72, 26, 16, "c1", { rx: 7, stroke: "ink", width: 1.2, opacity: 0.8 }), R(164, 72, 26, 16, "c1", { rx: 7, stroke: "ink", width: 1.2, opacity: 0.8 }),
      P("M216 80 L238 56 M216 80 L244 80 M216 80 L238 104", "ink", 2.2),
      C(240, 54, 4.5, "c3", { stroke: "ink", width: 1.1 }), C(247, 80, 4.5, "c3", { stroke: "ink", width: 1.1 }), C(240, 106, 4.5, "c3", { stroke: "ink", width: 1.1 }),
    ],
    anchors: {
      dendrites: { at: [14, 44] }, cellBody: { at: [40, 96] }, nucleus: { at: [54, 78] }, hillock: { at: [80, 80], pin: [80, 104] },
      axon: { at: [203, 80], pin: [203, 58] }, myelin: { at: [109, 80], pin: [109, 56] }, node: { at: [160, 80], pin: [160, 104] }, terminal: { at: [247, 80] },
    },
    note: "Signal runs left to right.",
  },
  flower: {
    width: 240, height: 220,
    shapes: [
      P("M120 220 L120 150", "accent", 5),
      { kind: "path", d: "M106 148 C92 146 80 136 76 126 C90 128 102 136 108 144 Z", fill: "accent", opacity: 0.8 },
      { kind: "path", d: "M134 148 C148 146 160 136 164 126 C150 128 138 136 132 144 Z", fill: "accent", opacity: 0.8 },
      { kind: "path", d: "M104 142 C70 140 40 100 52 64 C78 74 100 108 110 138 Z", fill: "c5", opacity: 0.5, stroke: "c5", width: 1.3 },
      { kind: "path", d: "M136 142 C170 140 200 100 188 64 C162 74 140 108 130 138 Z", fill: "c5", opacity: 0.5, stroke: "c5", width: 1.3 },
      E(120, 148, 16, 6, "accent"),
      E(120, 128, 12, 15, "c6", { opacity: 0.6, stroke: "c6", width: 1.3 }), P("M120 113 L120 62", "c6", 3), E(120, 58, 9, 5, "c6"),
      P("M108 136 L92 78 M132 136 L148 78", "c3", 2), E(91, 72, 6, 9, "c3"), E(149, 72, 6, 9, "c3"),
    ],
    anchors: {
      petal: { at: [66, 92] }, sepal: { at: [82, 132] }, anther: { at: [149, 72] }, filament: { at: [100, 108] },
      stigma: { at: [120, 58] }, style: { at: [120, 88] }, ovary: { at: [120, 128] }, stem: { at: [120, 190] },
    },
  },
  heart: {
    width: 240, height: 220,
    shapes: [
      P("M40 0 L40 64", "c1", 12, { opacity: 0.55 }),
      P("M112 128 L112 42 C112 26 98 18 78 18", "c1", 11, { opacity: 0.55 }),
      P("M128 128 L128 36 C128 8 182 6 190 32 L190 48", "c5", 11, { opacity: 0.55 }),
      P("M240 86 L212 86", "c5", 9, { opacity: 0.55 }),
      R(22, 60, 82, 56, "c1", { rx: 20, stroke: "c1", width: 1.4, opacity: 0.35 }),
      R(136, 60, 82, 56, "c5", { rx: 20, stroke: "c5", width: 1.4, opacity: 0.35 }),
      { kind: "path", d: "M22 124 L116 124 L116 206 C78 202 34 176 22 124 Z", fill: "c1", stroke: "c1", width: 1.4, opacity: 0.35 },
      { kind: "path", d: "M124 124 L218 124 C210 172 166 200 124 208 Z", fill: "c5", stroke: "c5", width: 1.4, opacity: 0.35 },
      P("M120 122 L120 210", "ink", 3),
      P("M40 120 L96 120 M144 120 L200 120", "ink", 1.2, { dash: true }),
    ],
    anchors: {
      rightAtrium: { at: [62, 88] }, rightVentricle: { at: [76, 160] }, leftAtrium: { at: [178, 88] }, leftVentricle: { at: [166, 160] },
      septum: { at: [120, 190] }, aorta: { at: [160, 12] }, pulmonaryArtery: { at: [86, 18] }, venaCava: { at: [40, 30] }, pulmonaryVein: { at: [230, 86] },
    },
    note: "Drawn as you face the person: their right side is on your left.",
  },
};

export const artNames = Object.keys(ART);
export const diagramNames = Object.keys(DIAGRAMS);
