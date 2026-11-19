// node check-glyphs.mjs <glyphs.mjs> [sheet.html]
// Verifies the glyph grammar: every segment at 0/45/90 degrees, inside the live area, every animated part
// present in its drawing, every glyph grouped and labelled. Optionally writes a contact sheet.
import { writeFileSync } from "node:fs";
const [src, sheet] = process.argv.slice(2);
const { GLYPHS, GROUPS, LABELS } = await import(src);
const GLYPHS_V2 = {}, GROUPS_V2 = GROUPS, LABELS_V2 = LABELS;

function segments(d) {
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+/g) ?? [];
  const out = []; let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const px = x, py = y;
    if (cmd === "M") { x = num(); y = num(); sx = x; sy = y; cmd = "L"; continue; }
    if (cmd === "m") { x += num(); y += num(); sx = x; sy = y; cmd = "l"; continue; }
    if (cmd === "L") { x = num(); y = num(); }
    else if (cmd === "l") { x += num(); y += num(); }
    else if (cmd === "H") x = num();
    else if (cmd === "h") x += num();
    else if (cmd === "V") y = num();
    else if (cmd === "v") y += num();
    else if (cmd === "Z" || cmd === "z") { x = sx; y = sy; }
    else throw new Error("unsupported " + cmd + " in " + d);
    out.push([px, py, x, y]);
  }
  return out;
}
let bad = 0;
const all = { ...GLYPHS, ...GLYPHS_V2 };
for (const [name, g] of Object.entries(all)) {
  if (/transform="matrix/.test(g.d)) continue; // mirrored thumb, already checked upright
  for (const m of g.d.matchAll(/ d="([^"]+)"/g)) {
    for (const [x1, y1, x2, y2] of segments(m[1])) {
      const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
      if (!(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6)) { bad++; console.log(`ANGLE ${name}: (${x1},${y1})->(${x2},${y2}) in "${m[1]}"`); }
      for (const v of [x1, y1, x2, y2]) if (v < 2 || v > 22) { bad++; console.log(`BOUNDS ${name}: ${v} in "${m[1]}"`); }
    }
  }
  for (const m of g.d.matchAll(/<rect[^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    if (x < 2 || y < 2 || x + w > 22 || y + h > 22) { bad++; console.log(`BOUNDS ${name}: rect ${x},${y},${w},${h}`); }
  }
  const accents = (g.d.match(/class="a[f]?"/g) ?? []).length;
  if (!accents && !["left", "right", "down", "rise", "send", "chev", "chevr", "chevl", "chevu", "ring", "kmark"].includes(name) && !/class="af"|px\(/.test(g.d)) console.log(`NOACCENT ${name}`);
  for (const key of ["play", "hold", "loop", "press"]) for (const step of g[key] ?? []) for (const part of step[0].split(",")) if (!g.d.includes(`data-p="${part}"`)) { bad++; console.log(`PART ${name}: ${key} names "${part}" which is not in the drawing`); }
}
const grouped = new Set(GROUPS.flatMap(([, names]) => names));
for (const n of Object.keys(GLYPHS)) { if (!LABELS[n]) { bad++; console.log("NOLABEL " + n); } if (!grouped.has(n)) { bad++; console.log("UNGROUPED " + n); } }
for (const n of grouped) if (!GLYPHS[n]) { bad++; console.log("GROUP NAMES MISSING GLYPH " + n); }
console.log(`${Object.keys(GLYPHS).length} glyphs checked, ${bad} problems`);

const svg = (name, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="butt" stroke-linejoin="miter">${all[name].d}</svg>`;
const cell = (name) => `<figure>${svg(name, 48)}<div class="row">${svg(name, 24)}${svg(name, 15)}</div><figcaption><b>${name}</b><span>${(LABELS_V2[name] ?? LABELS[name])}</span></figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><title>glyph sheet</title><style>
body{margin:0;padding:16px;background:#f3eee2;color:#1c211b;font:11px/1.3 ui-monospace,monospace}
h2{font-size:12px;margin:14px 0 6px;letter-spacing:.08em;text-transform:uppercase;color:#4a5247}
.g{display:grid;grid-template-columns:repeat(12,1fr);gap:6px}
figure{margin:0;padding:8px 4px;border:1px solid #cfc8b6;background:#f8f4ea;display:grid;justify-items:center;gap:4px}
.row{display:flex;gap:8px;align-items:center}
figcaption{display:grid;justify-items:center;text-align:center}figcaption span{color:#6c7468;font-size:9px}
.a{stroke:#14743c}.af{fill:#14743c;stroke:none}.f{fill:currentColor;stroke:none}
.ref figure{background:#efe9db}
</style>
${GROUPS_V2.map(([title, names]) => `<h2>${title}</h2><div class="g">${names.map(cell).join("")}</div>`).join("")}
`;
if (sheet) writeFileSync(sheet, html);
