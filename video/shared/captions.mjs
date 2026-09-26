// Writes WebVTT captions for the narrated films.
//
//   node video/shared/captions.mjs launch video/keating-launch/build/timing.json out.vtt
//   node video/shared/captions.mjs intro video/keating-intro/scenes.json .keating/outputs/video/keating-intro/props.json out.vtt
//
// The launch film has word timings from its TTS pass, so each sentence is
// cued exactly. The intro only knows its scene cuts (props weights are
// seconds once render-keating-intro.mjs snaps them to narration pauses), so a
// scene's sentences share its span by length.
import { readFileSync, writeFileSync } from "node:fs";

const [mode, ...paths] = process.argv.slice(2);

// A sentence ends at punctuation followed by a space, so "keating.help" stays whole.
const sentences = (text) => text.split(/(?<=[.?!]["”’]?)\s+/u).map((part) => part.trim()).filter(Boolean);
const spoken = (text) => text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token));

function stamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

function launchCues(timingPath) {
  const timing = JSON.parse(readFileSync(timingPath, "utf8"));
  const cues = [];
  for (const scene of timing.scenes) {
    let index = 0;
    for (const sentence of sentences(scene.text)) {
      const words = scene.words.slice(index, index + spoken(sentence).length);
      index += words.length;
      if (words.length) cues.push({ start: words[0].s, end: words.at(-1).e + 0.4, text: sentence });
    }
  }
  return cues;
}

function introCues(scenesPath, propsPath) {
  const lines = JSON.parse(readFileSync(scenesPath, "utf8")).map((scene) => scene.line);
  const { scenes } = JSON.parse(readFileSync(propsPath, "utf8"));
  const cues = [];
  let sceneStart = 0;
  scenes.forEach((scene, sceneIndex) => {
    const parts = sentences(lines[sceneIndex]);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const span = scene.weight - 0.5;
    let at = sceneStart + 0.2;
    for (const part of parts) {
      const length = (part.length / total) * span;
      cues.push({ start: at, end: at + length, text: part });
      at += length;
    }
    sceneStart += scene.weight;
  });
  return cues;
}

const cues = mode === "launch" ? launchCues(paths[0]) : mode === "intro" ? introCues(paths[0], paths[1]) : null;
if (!cues) {
  console.error("Usage: captions.mjs launch <timing.json> <out.vtt> | intro <scenes.json> <props.json> <out.vtt>");
  process.exit(1);
}
// A cue never runs into the next one.
cues.forEach((cue, index) => { if (cues[index + 1]) cue.end = Math.min(cue.end, cues[index + 1].start - 0.05); });
const out = paths.at(-1);
writeFileSync(out, `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}`).join("\n\n")}\n`);
console.log(`${out}: ${cues.length} cues`);
