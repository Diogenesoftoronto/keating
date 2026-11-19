// Pack normalised atlases (1024x512, 4x2 cells of 256) into single strip images:
// one row per state, eight frames across. node botsheets.mjs <scratch> <outDir>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
const [S, out] = process.argv.slice(2);
const m = (...a) => execFileSync("magick", a, { encoding: "utf8" }).trim();
mkdirSync(`${out}/rows`, { recursive: true });
const src = (n) => [`${S}/bot-new/atlas/${n}.png`, `${S}/bot-old/atlas/${n}.png`].find(existsSync);
function strip(names, F, file, quality) {
  const rows = [];
  const have = names.filter((n) => src(n));
  for (const n of have) {
    const r = `${out}/rows/${n}-${F}.png`;
    m(src(n), "-crop", "256x256", "+repage", "-resize", `${F}x${F}`, "+append", r);
    rows.push(r);
  }
  m(...rows, "-append", "-quality", String(quality), "-define", "webp:alpha-quality=75", "-define", "webp:method=6", `${out}/${file}`);
  return have;
}
// screen rectangle (in 256-cell units) for each frame of a blank-face state
function screens(n) {
  const res = [];
  for (let i = 0; i < 8; i++) {
    const o = m(src(n), "-crop", `256x256+${(i % 4) * 256}+${Math.floor(i / 4) * 256}`, "+repage", "-alpha", "off", "-fx", "(g>0.72 && r<0.5 && b<0.5 && g-r>0.3)?1:0",
      "-define", "connected-components:verbose=true", "-define", "connected-components:area-threshold=120", "-connected-components", "8", "null:");
    let best = null;
    for (const line of o.split("\n").slice(1)) {
      const p = line.trim().split(/\s+/); if (!/255|white/.test(p[p.length - 1])) continue;
      const g = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(p[1]); if (!g) continue;
      const area = +p[3]; if (!best || area > best.area) best = { area, r: [+g[3], +g[4], +g[1], +g[2]] };
    }
    res.push(best ? best.r : res[res.length - 1] ?? [100, 52, 67, 51]);
  }
  return res;
}
const PLAY = ["blank-idle", "blank-sitting", "held", "falling", "landing", "dizzy", "petted", "startled", "yawning", "sleeping", "head-shake", "hint", "pointing-left", "typing", "paper-plane", "success", "running", "peeking", "celebrating", "carrying"];
const playHave = strip(PLAY, 96, "play.webp", 52);
const all = [...new Set([...readdirSync(`${S}/bot-new/atlas`), ...readdirSync(`${S}/bot-old/atlas`)].map((f) => f.replace(/\.png$/, "")))].filter((n) => !n.startsWith("blank-head")).sort();
const galHave = strip(all, 56, "gallery.webp", 38);
const meta = { play: playHave, gallery: galHave, screens: { "blank-idle": screens("blank-idle"), "blank-sitting": screens("blank-sitting") } };
writeFileSync(`${out}/bots.json`, JSON.stringify(meta));
console.log("play", playHave.length, "gallery", galHave.length);
