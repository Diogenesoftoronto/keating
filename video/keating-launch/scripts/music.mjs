#!/usr/bin/env node
// Reuses the frozen Keating instrumental; speech-aware mix, no hosted generation.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "assets/audio");
mkdirSync(out, { recursive: true });
const source = join(root, "../spotlights/music/judgements.mp3");
const prompt = JSON.parse(readFileSync(join(root, "../spotlights/music/prompts.json"))).judgements;
const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
const arrangementIntent = readFileSync(join(root, "prompts/music.txt"), "utf8").trim();
writeFileSync(join(out, "music-source.json"), JSON.stringify({ source: "video/spotlights/music/judgements.mp3", model: "google/lyria-3.5", prompt, arrangementIntent, sha256: hash }, null, 2) + "\n");

const { total } = JSON.parse(readFileSync(join(root, "build/timing.json")));
const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 28 });
const sourceDuration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], { encoding: "utf8" }));
// A gentle, pitch-preserving slowdown fits the complete musical arc to the film.
const tempo = Math.min(1, (sourceDuration - 0.1) / total);
if (tempo < 0.5) throw new Error("Music needs a longer arrangement for this film");
function master(input, output, filters, level) {
  const target = `I=${level}:TP=-2:LRA=11`;
  const analysis = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", `${filters},loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
  if (analysis.status !== 0) throw new Error(analysis.stderr.slice(-1500));
  const measured = JSON.parse(analysis.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  run(["-i", input, "-af", `${filters},loudnorm=${target}:linear=true:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}`, "-ar", "48000", "-ac", "2", output]);
}
master(join(root, "build/narration.wav"), join(out, "narration.wav"), `atrim=duration=${total},asetpts=PTS-STARTPTS`, -16);
master(source, join(out, "music-bed.wav"), `atempo=${tempo},atrim=duration=${total},asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=${total - 3}:d=3`, -18);

// The same spectral/level analysis as the HyperFrames voiceover-carve skill.
const require = createRequire(pathToFileURL(join(process.env.KEATING_AUDIO_CORE_DIR ?? root, "package.json")));
const pkgPath = require.resolve("@hyperframes/core/package.json");
const pkg = JSON.parse(readFileSync(pkgPath));
const load = (name) => import(pathToFileURL(join(dirname(pkgPath), pkg.exports[`./${name}`].import)).href);
const carve = await load("audio-carve");
const fx = await load("audio-fx");
const decode = (file) => {
  const pcm = run(["-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
};
const voice = decode(join(out, "narration.wav"));
// Include the authored playback gain in the relationship measurement; otherwise
// the level carve would duck an already quiet bed a second time.
const bed = decode(join(out, "music-bed.wav")).map((sample) => sample * 0.22);
const profile = carve.carveProfile(0.8);
const bands = carve.analyseCarveBands(voice, 48000, profile);
const duck = carve.analyseCarveDuck(voice, bed, 48000, profile, 0);
const nodes = bands.map((band, i) => ({ ...carve.carveBandsToChain([band]).nodes[0], id: `carve${i}`, fromCarve: true }));
nodes.push({ type: "gain", id: "carve-level", enabled: true, fromCarve: true, params: { ...fx.defaultAudioFxParams("gain"), gain: 0 } });
const lane = (id, points) => ({ target: `fx.${id}.gain`, points: points.map(({ t, v }) => ({ t: +t.toFixed(3), v })) });
const lanes = carve.analyseCarveDynamics(voice, 48000, bands).map((dynamic, i) => lane(nodes[i].id, dynamic.points));
if (duck.length > 1) lanes.push(lane("carve-level", duck));
const attrs = {
  "data-fx-carve": { enabled: true, sources: ["voiceover"], strength: 0.8 },
  "data-fx-chain": { version: 1, nodes },
  "data-automation": { version: 1, lanes },
};
writeFileSync(join(out, "music-fx.html"), Object.entries(attrs).map(([name, value]) => `${name}='${JSON.stringify(value)}'`).join(" ") + "\n");
console.log(`[music] ${total}s instrumental bed; ${bands.length} speech-aware EQ bands; ${duck.length} level points`);
