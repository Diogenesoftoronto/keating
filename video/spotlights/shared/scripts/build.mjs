#!/usr/bin/env node
// A film supplies narration.json + src/index.template.html; this compiler supplies
// measured timing, every-scene captions, local fonts and per-line RMS envelopes.
// Usage: node build.mjs <film-dir> (defaults to cwd).
// Templates use one <section id="s-ID"> per narration scene, with double-quoted
// attributes. Scene sections may nest other sections, but not one another. Keep
// shared CSS and the absolute-time root animation script in the parent template.
// {{captions}} marks the author-facing caption insertion point; generated cues
// are mounted inside their scene sub-composition with scene-relative clip timing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? process.cwd());
const timing = JSON.parse(readFileSync(join(ROOT, "build/timing.json"), "utf8"));
const spec = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
const template = readFileSync(join(ROOT, "src/index.template.html"), "utf8");
const [width, height] = spec.size ?? [1920, 1080];
if (![width, height].every((value) => Number.isInteger(value) && value > 0)) throw new Error("size must contain two positive integer dimensions");
const output = spec.output ?? `keating-spotlight-${basename(ROOT)}`;
const overlap = Number(template.match(/<!--\s*scene-overlap:\s*([\d.]+)\s*-->/)?.[1] ?? 0);
if (!Number.isFinite(overlap) || overlap < 0) throw new Error("invalid scene-overlap");
const durationFor = (scene) => scene.duration + (scene === timing.scenes.at(-1) ? 0 : overlap);
const automaticCaptions = spec.voice !== false && !/<!--\s*captions:\s*custom\s*-->/.test(template);
const scenes = Object.fromEntries(timing.scenes.map((scene) => [scene.id, scene]));
const fx = (n) => (+n.toFixed(3)).toString();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function need(id) {
  if (!scenes[id]) throw new Error(`template references unknown scene "${id}"`);
  return scenes[id];
}

// {{art:name:id:scene[:from:to]}} supplies an untimed .art wrapper for
// template-owned fades/pushes. Cues are scene-local seconds, "end", or a
// narration word with optional @offset (e.g. It's@-0.15 / question@0.1).
// Place inside its scene section: the compiler strips the section timing,
// leaving HyperFrames to own the video's scene-local playback window.
function art(name, id, sceneId, from = "0", to = "end") {
  const scene = need(sceneId);
  const cue = (value) => {
    if (value === "end") return durationFor(scene);
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    const [word, offset = "0"] = value.split("@");
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = scene.words.find((entry) => norm(entry.w) === norm(word));
    if (!match || !Number.isFinite(Number(offset))) throw new Error(`invalid art cue ${sceneId}/${value}`);
    return match.s - scene.start + Number(offset);
  };
  const start = cue(from), end = cue(to), duration = end - start;
  if (start < 0 || duration <= 0 || end > durationFor(scene) + 0.001) throw new Error(`invalid art window ${id}: ${start}..${end}`);
  const still = `assets/art/${name}.png`;
  const clip = `assets/motion/${name}.mp4`;
  const image = (src, extra = "") => `<img src="${src}" alt="" data-layout-allow-overflow ${extra}/>`;
  if (!existsSync(join(ROOT, clip))) {
    return `<div id="${id}" class="art"><div class="back art-media" data-layout-allow-overflow>${image(still)}</div><div class="foreground art-clone" style="background-image:url(${still})"></div><div class="wash"></div></div>`;
  }
  const sourceDuration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(ROOT, clip)], { encoding: "utf8" }).trim());
  if (!(sourceDuration > 0)) throw new Error(`invalid motion duration: ${clip}`);
  // Stretch longer slots, never below 0.6x; then hold the actual final frame.
  // Derived holds go beside staged art, never into the paid source directory.
  const rate = Math.max(0.6, Math.min(1, sourceDuration / duration));
  const playDuration = Math.min(duration, sourceDuration / rate);
  let base = still;
  if (duration > playDuration + 0.001) {
    base = `assets/art/${name}-last.png`;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.04", "-i", join(ROOT, clip), "-frames:v", "1", "-update", "1", join(ROOT, base)]);
  }
  return `<div id="${id}" class="art" data-motion="true"><div class="back art-media" data-layout-allow-overflow>${image(base)}<video id="${id}-clip" class="clip" src="${clip}" poster="${still}" data-start="${fx(start)}" data-duration="${fx(playDuration)}" data-playback-rate="${rate}" data-track-index="2" muted playsinline data-layout-allow-overflow></video></div><div class="wash"></div></div>`;
}

function captionGroups(scene) {
  const groups = [];
  let current = [];
  for (const word of scene.words) {
    current.push(word);
    if (current.length === 6 || /[.,?!:;]$/.test(word.w)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

const captions = [];
for (const scene of automaticCaptions ? timing.scenes : []) {
  const groups = captionGroups(scene);
  groups.forEach((group, index) => {
    const start = Math.max(scene.start, group[0].s - 0.08);
    const next = groups[index + 1];
    const end = Math.min(scene.start + scene.duration, next ? next[0].s - 0.08 : group.at(-1).e + 0.35);
    if (end <= start) throw new Error(`non-positive caption duration in scene ${scene.id}`);
    const words = group.map((word, wi) => `<span class="cw" data-s="${fx(word.s)}" data-e="${fx(group[wi + 1]?.s ?? end)}">${esc(word.w)}</span>`).join(" ");
    captions.push({ sceneId: scene.id, html: `      <div id="cap-${esc(scene.id)}-${index + 1}" class="clip cap caption-cue" data-start="${fx(start - scene.start)}" data-duration="${fx(end - start)}" data-track-index="4" data-track-kind="captions"><div class="pill">${words}</div></div>` });
  });
}

// Fifteen values per second keeps waveform motion light and seekable. Samples are
// normalized per line, and t0 is the absolute voice start on the film timeline.
function envelope(scene, rate = 15) {
  const file = isAbsolute(scene.file) ? scene.file : resolve(ROOT, scene.file);
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const hop = Math.round(8000 / rate);
  const sampleCount = pcm.length >> 1;
  const rms = [];
  for (let i = 0; i < sampleCount; i += hop) {
    let sum = 0, count = 0;
    for (let j = i; j < Math.min(sampleCount, i + hop); j++, count++) sum += (pcm.readInt16LE(j * 2) / 32768) ** 2;
    rms.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const peak = rms.reduce((max, value) => Math.max(max, value), 0) || 1;
  return { t0: scene.voStart, step: +(1 / rate).toFixed(4), v: [...rms.map((value) => +Math.sqrt(value / peak).toFixed(3)), 0] };
}

const env = spec.voice === false ? {} : Object.fromEntries(timing.scenes.map((scene) => [scene.id, envelope(scene)]));
const fonts = readFileSync(join(ROOT, "assets/fonts/fonts.css"), "utf8")
  .replace(/url\((['"]?)([^)'"\s]+\.woff2)\1\)/g, 'url("assets/fonts/$2")')
  .replace(/^/gm, "      ");
const data = { total: timing.total, fps: timing.fps, label: spec.label, env, scenes: timing.scenes.map(({ file, ...scene }) => scene) };
const encoded = JSON.stringify(data).replace(/</g, "\\u003c");
let html = template
  .replaceAll("{{fonts}}", () => fonts)
  .replaceAll("{{label}}", () => esc(spec.label))
  .replaceAll("{{captions}}", "")
  .replaceAll("{{width}}", String(width))
  .replaceAll("{{height}}", String(height))
  .replaceAll("{{output}}", () => esc(output))
  .replace(/\{\{start:([\w-]+)\}\}/g, (_, id) => fx(need(id).start))
  .replace(/\{\{dur:([\w-]+)\}\}/g, (_, id) => fx(durationFor(need(id))))
  .replaceAll("{{total}}", fx(timing.total))
  .replace(/\{\{art:([\w-]+):([\w-]+):([\w-]+)(?::([^:}]+):([^:}]+))?\}\}/g, (_, name, id, scene, from, to) => art(name, id, scene, from, to))
  .replaceAll("__DATA__", () => encoded)
  .replaceAll("/*TIMING*/ null", () => encoded);
const unfilled = html.match(/\{\{[^}]*\}\}|\/\*TIMING\*\/|__DATA__/g);
if (unfilled) throw new Error(`unfilled placeholders: ${[...new Set(unfilled)].join(", ")}`);

// Keep the authored film in one template while giving Studio real scene units.
// Each narration scene is a <section id="s-ID">. Parent animation selectors and
// absolute word cues remain stable; the runtime owns each mounted scene window.
const compositionDir = join(ROOT, "build/compositions");
mkdirSync(compositionDir, { recursive: true });
for (const scene of timing.scenes) {
  const section = sceneSection(html, scene.id);
  const compositionId = `scene-${scene.id}`;
  const content = section.html
    .replace(/^<section\b[^>]*>/, (tag) => tag
      .replace(/\sdata-(?:start|duration|track-index)="[^"]*"/g, "")
      .replace(/class="([^"]*)"/, (_, classes) => `class="${classes.split(/\s+/).filter((name) => name !== "clip").join(" ")}"`))
    .replace(/(\b(?:src|poster)=["']|url\(["']?)assets\//g, "$1../../assets/");
  const childCaptions = captions.filter((caption) => caption.sceneId === scene.id).map((caption) => caption.html).join("\n");
  const child = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head><body><template>
<style>#root { position:absolute; inset:0; width:100%; height:100%; }</style>
<div id="root" data-composition-id="${compositionId}" data-duration="${fx(durationFor(scene))}" data-width="${width}" data-height="${height}">
${content}
${childCaptions}
</div>
<script>{ const child = gsap.timeline({paused:true}); child.set({}, {}, ${fx(durationFor(scene))}); window.__timelines["${compositionId}"] = child; }</script>
</template></body></html>
`;
  writeFileSync(join(compositionDir, `${compositionId}.html`), child);
  const mount = `<div id="mount-${scene.id}" class="clip" data-composition-id="${compositionId}" data-composition-src="build/compositions/${compositionId}.html" data-start="${fx(scene.start)}" data-duration="${fx(durationFor(scene))}" data-track-index="${overlap ? timing.scenes.indexOf(scene) % 2 : 0}" data-width="${width}" data-height="${height}" style="position:absolute;inset:0;z-index:1"></div>`;
  html = html.slice(0, section.start) + mount + html.slice(section.end);
}

function sceneSection(source, id) {
  // Balance section tags so a scene can itself contain semantic subsections.
  const tags = /<\/?section\b[^>]*>/g;
  let start = -1, depth = 0, tag;
  while ((tag = tags.exec(source))) {
    const closing = tag[0].startsWith("</");
    if (start < 0) {
      if (closing || !tag[0].includes(`id="s-${id}"`)) continue;
      start = tag.index;
      depth = 1;
    } else {
      depth += closing ? -1 : 1;
      if (depth === 0) return { start, end: tags.lastIndex, html: source.slice(start, tags.lastIndex) };
    }
  }
  throw new Error(`template needs one complete <section id="s-${id}"> for narration scene "${id}"`);
}

writeFileSync(join(ROOT, "index.html"), html);
console.log(`[build] index.html · ${fx(timing.total)}s · ${timing.scenes.length} scenes · ${captions.length} caption groups`);
