#!/usr/bin/env node
// Offline music-only timing and mastering. No voice, transcription, or API path.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const spec = JSON.parse(readFileSync(join(root, "narration.json"), "utf8"));
if (spec.voice !== false) throw new Error("music-only requires voice: false");
const build = join(root, "build"), out = join(root, "assets/audio");
for (const dir of [build, out]) mkdirSync(dir, { recursive: true });
const source = join(root, "../music", `${basename(root)}.mp3`);
const run = (args) => execFileSync("ffmpeg", args, { maxBuffer: 1 << 28 });
const sampleRate = 11025, hop = 110, window = 512, step = hop / sampleRate;
const pcm = run(["-v", "error", "-i", source, "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"]);
const sampleCount = pcm.length / 2;

// Radix-2 FFT of a Hann-windowed mono PCM signal. Positive log-spectral flux
// measures new attacks rather than sustained volume; bass flux strengthens kicks.
function spectrum(offset) {
  const re = new Float64Array(window), im = new Float64Array(window);
  for (let i = 0; i < window; i++) re[i] = pcm.readInt16LE((offset + i) * 2) / 32768 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (window - 1)));
  for (let i = 1, j = 0; i < window; i++) {
    let bit = window >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= window; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let base = 0; base < window; base += length) {
      for (let k = 0; k < length / 2; k++) {
        const a = base + k, b = a + length / 2, c = Math.cos(angle * k), s = Math.sin(angle * k);
        const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
        re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
      }
    }
  }
  return Array.from({ length: window / 2 }, (_, i) => Math.log1p(30 * Math.hypot(re[i], im[i])));
}
const flux = [], bass = [];
let previous = Array(window / 2).fill(0);
for (let offset = 0; offset + window < sampleCount; offset += hop) {
  const current = spectrum(offset);
  let all = 0, low = 0;
  for (let bin = 2; bin < 185; bin++) {
    const delta = Math.max(0, current[bin] - previous[bin]);
    all += delta;
    if (bin < 12) low += delta;
  }
  flux.push(all); bass.push(low); previous = current;
}
function normalize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const scale = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return values.map((v) => Math.min(3, v / scale));
}
const full = normalize(flux), low = normalize(bass);
const onset = full.map((v, i) => 0.55 * v + 0.45 * low[i]);
// Window-centre time is corrected for the flux comparison's half-hop delay.
const onsetOffset = (window / 2 - hop / 2) / sampleRate;
const at = (time, values = onset) => {
  const index = Math.round((time - onsetOffset) / step);
  return Math.max(values[index - 1] ?? 0, values[index] ?? 0, values[index + 1] ?? 0);
};
const analysisEnd = Math.min(50, sampleCount / sampleRate - 2);
function fit(bpm, phase) {
  const beat = 60 / bpm;
  let sum = 0, supported = 0, count = 0;
  for (let time = phase; time < analysisEnd; time += beat) {
    if (time < 0.5) continue;
    const value = at(time);
    sum += value; supported += value > 0.4 ? 1 : 0; count++;
  }
  return sum / count * (0.75 + 0.25 * supported / count);
}
const candidates = [];
// A broad search, independent of the track's generation prompt or filename.
for (let bpm = 75; bpm <= 180; bpm += 0.1) {
  const beat = 60 / bpm;
  let best = { bpm, phase: 0, score: -1 };
  for (let phase = 0; phase < beat; phase += 0.01) {
    const score = fit(bpm, phase);
    if (score > best.score) best = { bpm, phase, score };
  }
  candidates.push(best);
}
candidates.sort((a, b) => b.score - a.score);
let best = candidates[0];
const coarse = best;
for (let bpm = coarse.bpm - 0.15; bpm <= coarse.bpm + 0.15; bpm += 0.005) {
  for (let phase = Math.max(0, coarse.phase - 0.02); phase < coarse.phase + 0.02; phase += 0.001) {
    const score = fit(bpm, phase);
    if (score > best.score) best = { bpm, phase, score };
  }
}
const beatLength = 60 / best.bpm;
// Choose a four-beat downbeat phase by repeated low-frequency accents. Starting
// at the first strong occurrence avoids treating a soft pickup as the opening.
const accents = Array.from({ length: 4 }, (_, barPhase) => {
  const values = [];
  for (let n = barPhase; best.phase + n * beatLength < analysisEnd; n += 4) values.push(at(best.phase + n * beatLength, low));
  return { barPhase, strength: values.reduce((a, b) => a + b, 0) / values.length };
}).sort((a, b) => b.strength - a.strength);
const downbeats = [];
for (let n = accents[0].barPhase; best.phase + n * beatLength < analysisEnd; n += 4) {
  const time = best.phase + n * beatLength;
  downbeats.push({ time, strength: at(time), bassStrength: at(time, low) });
}
const sourceStart = downbeats.find((b) => b.strength >= 0.45 && b.bassStrength >= 0.35)?.time;
if (sourceStart == null) throw new Error("No strong downbeat found in music");
const fps = spec.timing?.fps ?? 30;
let beats = 0;
const frame = (t) => Math.round(t * fps) / fps;
const scenes = spec.scenes.map((scene) => {
  if (!(Number.isInteger(scene.beats) && scene.beats > 0)) throw new Error(`Invalid beat count: ${scene.id}`);
  const start = frame(beats * beatLength);
  beats += scene.beats;
  return { ...scene, start, duration: frame(beats * beatLength) - start, words: [], art: [], shots: [], role: null };
});
const total = frame(beats * beatLength);
if (sourceStart + total > sampleCount / sampleRate) throw new Error("Music is shorter than the beat sequence");
const evidence = {
  source, bpm: best.bpm, phase: best.phase, sourceStart, beatLength, score: best.score,
  method: "ffmpeg mono PCM; 512-sample Hann FFT / 110-sample hop; positive log-spectral flux plus bass flux; constant-tempo 75-180 BPM and phase search; repeated four-beat bass accents",
  sampleRate, hop, analysisEnd, totalBeats: beats, total, fps, accents,
  candidates: candidates.filter((c, i, all) => i === 0 || all.slice(0, i).every((p) => Math.abs(c.bpm - p.bpm) > 0.8)).slice(0, 8),
  firstDownbeats: downbeats.slice(0, 8),
  cutErrorsMs: scenes.map((s) => ({ id: s.id, error: (s.start - spec.scenes.slice(0, spec.scenes.findIndex((x) => x.id === s.id)).reduce((sum, x) => sum + x.beats, 0) * beatLength) * 1000 })),
};
writeFileSync(join(build, "timing.json"), JSON.stringify({ total, fps, scenes }, null, 2));
writeFileSync(join(build, "beat-analysis.json"), JSON.stringify(evidence, null, 2));

const premaster = join(build, "music-trimmed.wav");
run(["-v", "error", "-y", "-i", source, "-af", `atrim=start=${sourceStart}:duration=${total},asetpts=PTS-STARTPTS,afade=t=out:st=${total - 1.2}:d=1.2`, "-ar", "48000", "-ac", "2", premaster]);
const target = "I=-14:TP=-1.5:LRA=11";
const analysis = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", premaster, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
if (analysis.status !== 0) throw new Error(analysis.stderr.slice(-2000));
const match = analysis.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
if (!match) throw new Error("Missing loudness analysis");
const measured = JSON.parse(match[0]);
run(["-v", "error", "-y", "-i", premaster, "-af", `loudnorm=${target}:linear=true:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}`, "-ar", "48000", "-ac", "2", join(out, "mix.wav")]);
writeFileSync(join(build, "music-master.json"), JSON.stringify({ source, sourceStart, total, target, measured }, null, 2));
console.log(`[music] ${best.bpm.toFixed(3)} BPM; phase ${best.phase.toFixed(3)}s; first strong downbeat ${sourceStart.toFixed(3)}s; ${beats} beats / ${total.toFixed(3)}s`);
