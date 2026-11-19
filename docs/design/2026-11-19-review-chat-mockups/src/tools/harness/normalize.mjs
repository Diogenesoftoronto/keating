// Re-pack a generated 4x2 pose sheet into the app's atlas format: 1024x512, eight 256x256 cells,
// one uniform scale for the whole sheet, relative motion between poses preserved.
// usage: node normalize.mjs <rawDir> <outDir> [name ...]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
const [rawDir, outDir, ...only] = process.argv.slice(2);
const AIR = new Set(["held", "falling", "blank-head"]); // centred vertically instead of standing on the baseline
const m = (...a) => execFileSync("magick", a, { encoding: "utf8" }).trim();
for (const d of ["atlas", "webp", "thumb", "gif", "tmp"]) mkdirSync(`${outDir}/${d}`, { recursive: true });
const names = (only.length ? only : readdirSync(rawDir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""))).sort();
const report = [];
for (const name of names) {
  const src = `${rawDir}/${name}.png`;
  if (!existsSync(src)) { report.push(`${name}: missing`); continue; }
  try {
    const tmp = `${outDir}/tmp/${name}`;
    mkdirSync(tmp, { recursive: true });
    // 1. make sure the background is transparent (key out magenta when there is no alpha)
    const opaque = m(src, "-format", "%[opaque]", "info:") === "True";
    const keyed = `${tmp}/keyed.png`;
    if (opaque) m(src, "-alpha", "set", "-fuzz", "22%", "-transparent", "#FF00FF", keyed); else m(src, keyed);
    const [W, H] = m(keyed, "-format", "%w %h", "info:").split(" ").map(Number);
    const cw = Math.floor(W / 4), ch = Math.floor(H / 2);
    // 2. cut the eight cells and find the union of their content boxes
    let ux0 = 1e9, uy0 = 1e9, ux1 = -1, uy1 = -1; const cells = [];
    for (let i = 0; i < 8; i++) {
      const cell = `${tmp}/c${i}.png`;
      m(keyed, "-crop", `${cw}x${ch}+${(i % 4) * cw}+${Math.floor(i / 4) * ch}`, "+repage", cell);
      const box = m(cell, "-channel", "A", "-threshold", "8%", "+channel", "-format", "%@", "info:"); // WxH+X+Y
      const mt = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(box);
      if (mt && +mt[1] > 4 && +mt[2] > 4 && !(+mt[1] === cw && +mt[2] === ch && opaque === false && false)) {
        const [w, h, x, y] = mt.slice(1).map(Number);
        ux0 = Math.min(ux0, x); uy0 = Math.min(uy0, y); ux1 = Math.max(ux1, x + w); uy1 = Math.max(uy1, y + h);
      }
      cells.push(cell);
    }
    if (ux1 < 0) { report.push(`${name}: empty`); continue; }
    const uw = ux1 - ux0, uh = uy1 - uy0, grav = AIR.has(name) ? "Center" : "South";
    // 3. same crop and scale for every cell, then stand it on the baseline
    const out = [];
    for (let i = 0; i < 8; i++) {
      const o = `${tmp}/f${i}.png`;
      m(cells[i], "-crop", `${uw}x${uh}+${ux0}+${uy0}`, "+repage", "-resize", "244x244", "-background", "none", "-gravity", grav, "-extent", grav === "South" ? "256x250" : "256x256", "-gravity", "North", "-extent", "256x256", o);
      out.push(o);
    }
    m(...out.slice(0, 4), "+append", `${tmp}/r0.png`); m(...out.slice(4), "+append", `${tmp}/r1.png`);
    m(`${tmp}/r0.png`, `${tmp}/r1.png`, "-append", `${outDir}/atlas/${name}.png`);
    m(`${outDir}/atlas/${name}.png`, "-resize", "384x192", "-quality", "46", "-define", "webp:alpha-quality=70", `${outDir}/webp/${name}.webp`);
    m(`${outDir}/atlas/${name}.png`, "-resize", "256x128", "-quality", "42", "-define", "webp:alpha-quality=60", `${outDir}/thumb/${name}.webp`);
    m("-delay", "14", "-dispose", "Background", ...out.map((f) => [f]).flat(), "-background", "#f1ece0", "-alpha", "remove", "-resize", "160x160", "-loop", "0", `${outDir}/gif/${name}.gif`);
    report.push(`${name}: ok ${W}x${H} ${opaque ? "keyed" : "alpha"} union ${uw}x${uh}`);
  } catch (e) { report.push(`${name}: FAILED ${String(e.message).slice(0, 160)}`); }
}
writeFileSync(`${outDir}/report.txt`, report.join("\n") + "\n");
console.log(report.join("\n"));
