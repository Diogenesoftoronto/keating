#!/usr/bin/env node
// Composition stage: src/index.template.html + build/timing.json -> index.html.
//
// Everything time-dependent (scene windows, captions, the GPT Live waveform) is
// derived from the voiced narration, so re-voicing a line re-flows the whole video.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(readFileSync(join(ROOT, "build/timing.json"), "utf8"));
const spec = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
const S = Object.fromEntries(timing.scenes.map((s) => [s.id, s]));
const fx = (n) => (+n.toFixed(3)).toString();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- hook feed: the "more to read" answers --------------------------------------
const ANSWERS = [
  ["chat answer · 1,204 words", "how does recursion work?",
    "Recursion is a fundamental concept in computer science in which a function calls itself in order to solve smaller instances of the same problem. To fully understand recursion, it is important to first consider the call stack, the base case, the recursive case, tail-call optimisation, and…"],
  ["chat answer · 986 words", "explain photosynthesis simply",
    "Great question! Photosynthesis is the process by which plants, algae and some bacteria convert light energy into chemical energy. It occurs in two main stages: the light-dependent reactions and the Calvin cycle. Let's break each of these down in detail, starting with the thylakoid…"],
  ["chat answer · 1,530 words", "i don't get probability",
    "Probability can be understood from several perspectives, including the classical, frequentist, and Bayesian interpretations. Before we dive in, here are twelve key terms you will need: sample space, event, outcome, random variable, distribution, expectation, variance…"],
];
const answers = Array.from({ length: 12 }, (_, i) => ANSWERS[i % 3])
  .map(([who, ask, said]) => `<div class="answer"><div class="who">${esc(who)}</div><div class="ask">› ${esc(ask)}</div><div class="said" data-layout-allow-overlap>${esc(said)}</div></div>`)
  .join("");

const WALL = `<p>Absolutely! Let's break it down step by step. Recursion is a programming technique in which a function calls itself to solve smaller instances of the same problem.</p>
  <h3>Understanding the key concepts</h3>
  <ol><li><strong>Base case:</strong> the condition that stops the function from calling itself.</li><li><strong>Recursive case:</strong> the part where the function calls itself with a smaller input.</li><li><strong>Call stack:</strong> each function call waits for the next one to return.</li></ol>
  <p>To understand how these pieces work together, let's walk through an example in detail. Consider a function that adds every number from 1 to n. First, we need to define our stopping condition...</p>
  <h3>A step-by-step walkthrough</h3>
  <p>When n is greater than zero, the function adds n to the result of another call with n minus one. Each new call creates another stack frame, which keeps track of its local variables and return address...</p>`;

const chars = (text) => [...text].map((c) => `<span class="ch">${c === " " ? "&#32;" : esc(c)}</span>`).join("");

// ---- captions: ≤6-word phrase groups, broken after punctuation ------------------
function captionGroups(scene) {
  const groups = [];
  let cur = [];
  for (const w of scene.words) {
    cur.push(w);
    if (cur.length === 6 || /[.,?!:;]$/.test(w.w)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}
const captionIds = new Set(spec.scenes.filter((s) => s.captions).map((s) => s.id));
const captions = [];
for (const scene of timing.scenes.filter((s) => captionIds.has(s.id))) {
  const sceneEnd = scene.start + scene.duration;
  const groups = captionGroups(scene);
  groups.forEach((g, gi) => {
    const start = g[0].s - 0.08;
    const next = groups[gi + 1];
    const end = Math.min(sceneEnd, next ? next[0].s - 0.08 : g[g.length - 1].e + 0.35);
    const words = g.map((w, wi) => {
      const off = wi + 1 < g.length ? g[wi + 1].s : end;
      return `<span class="cw" data-s="${fx(w.s)}" data-e="${fx(off)}">${esc(w.w)}</span>`;
    }).join(" ");
    captions.push(`      <div id="cap-${scene.id}-${gi + 1}" class="clip cap" data-start="${fx(start)}" data-duration="${fx(end - start)}" data-track-index="4"><div class="pill">${words}</div></div>`);
  });
}

// ---- GPT Live waveform: RMS envelope of the live line, 15 values per second ------
function envelope(scene, rate = 15) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", scene.file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const hop = Math.round(8000 / rate);
  const rms = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0, n = 0;
    for (let j = i; j < Math.min(samples.length, i + hop); j++, n++) sum += (samples[j] / 32768) ** 2;
    rms.push(Math.sqrt(sum / Math.max(1, n)));
  }
  const peak = Math.max(...rms) || 1;
  return { t0: scene.voStart, step: +(1 / rate).toFixed(4), v: [...rms.map((r) => +Math.sqrt(r / peak).toFixed(3)), 0] };
}
const env = { live: envelope(S.live) };

const fonts = readFileSync(join(ROOT, "assets/fonts/fonts.css"), "utf8")
  .replace(/url\(([^)]+\.woff2)\)/g, "url(assets/fonts/$1)")
  .replace(/^/gm, "      ");

const data = { total: timing.total, fps: timing.fps, env, scenes: timing.scenes.map(({ file, ...s }) => s) };

const artClips = [];
let html = readFileSync(join(ROOT, "src/index.template.html"), "utf8")
  .replace("{{fonts}}", fonts)
  .replace(/\{\{start:(\w+)\}\}/g, (_, id) => fx(need(id).start))
  .replace(/\{\{dur:(\w+)\}\}/g, (_, id) => fx(need(id).duration))
  .replace(/\{\{total\}\}/g, fx(timing.total))
  .replace(/\{\{answers\}\}/g, answers)
  // These text nodes intentionally sit beneath the transparent shader and red X.
  .replace(/\{\{wall\}\}/g, WALL.replace(/<(p|h3|li|strong)>/g, '<$1 data-layout-allow-occlusion="">'))
  .replace("{{musicfx}}", () => readFileSync(join(ROOT, "assets/audio/music-fx.html"), "utf8").trim())
  .replace(/\{\{chars:([^}]+)\}\}/g, (_, t) => chars(t))
  .replace(/\{\{art:([\w-]+):([\w-]+):(\w+)\}\}/g, (_, name, id, scene) => art(name, id, need(scene)))
  .replace("{{artclips}}", () => artClips.join("\n"))
  .replace("{{bars}}", "<i></i>".repeat(24))
  .replace("{{captions}}", captions.join("\n"))
  .replace("/*TIMING*/ null", JSON.stringify(data));

// A generated still, or its H3 motion clip when scripts/gen-motion.mjs has made one.
// A clip can't be timed inside a timed scene, so it goes to the root, under the scenes
// (which are transparent over the shader ground), in an untimed wrapper that keeps the id
// for the zoom tweens.
function art(name, id, scene) {
  const clip = `assets/gen/${name}.mp4`;
  if (!existsSync(join(ROOT, clip))) return `<img id="${id}" data-layout-allow-overflow class="${id}" src="assets/gen/${name}.png" alt="" />`;
  artClips.push(`      <div id="${id}" class="art-wrap" data-layout-allow-overflow><video id="${id}-clip" class="clip ${id}" src="${clip}" data-start="${fx(scene.start)}" data-duration="${fx(scene.duration)}" data-track-index="3" muted playsinline></video></div>`);
  return "";
}

function need(id) {
  if (!S[id]) throw new Error(`template references unknown scene "${id}"`);
  return S[id];
}
const left = html.match(/\{\{[^}]*\}\}|\/\*TIMING\*\//g);
if (left) throw new Error(`unfilled placeholders: ${[...new Set(left)].join(", ")}`);

writeFileSync(join(ROOT, "index.html"), html.replace(/[\t ]+$/gm, ""));
console.log(`[build] index.html · ${fx(timing.total)}s · ${timing.scenes.length} scenes · ${captions.length} caption groups`);
