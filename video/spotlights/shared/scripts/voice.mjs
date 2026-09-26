#!/usr/bin/env node
// Narration stage: selected TTS engine per scene -> whisper word timings -> build/timing.json
// -> narration + film music (or synthesized pad fallback) -> assets/audio/mix.wav.
//
// Every API call is cached under audio/cache/ by a content hash of everything that
// affects its output, so re-running only re-voices lines that changed.
// The API key is read from the environment (or skate) and never written anywhere.
// Usage: node voice.mjs <film-dir> (defaults to the current working directory).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.argv[2] ?? process.cwd());
const CACHE = join(ROOT, "audio/cache");
const BUILD = join(ROOT, "build");
const OUT = join(ROOT, "assets/audio");
for (const d of [CACHE, BUILD, OUT]) mkdirSync(d, { recursive: true });

const spec = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
if (spec.voice === false) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./music-only.mjs", import.meta.url)), ROOT], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { tts, timing } = spec;
const frame = (t) => Math.round(t * timing.fps) / timing.fps;

let apiKey;
function key() {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("Speech cache miss: KEATING_OFFLINE=1 forbids API calls and key lookup. Cached TTS and word timings are required.");
  apiKey ??= process.env.OPENAI_API_KEY || execFileSync("skate", ["get", "openai-api@secrets"], { encoding: "utf8" }).trim();
  return apiKey;
}

let falApiKey;
function falKey() {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("Speech cache miss: KEATING_OFFLINE=1 forbids API calls and key lookup.");
  falApiKey ??= process.env.FAL_KEY || execFileSync("skate", ["get", "fal_api_key@secrets"], { encoding: "utf8" }).trim();
  return falApiKey;
}

const sha = (...parts) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const probe = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

async function openai(path, init) {
  if (process.env.KEATING_OFFLINE === "1") throw new Error(`Speech cache miss (${path}): KEATING_OFFLINE=1 forbids paid API calls.`);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.openai.com/v1/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key()}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      // Dropped connections and stalled responses are worth another try, like a 5xx.
      if (attempt < 4) { process.stdout.write(`        ${path}: ${err.cause?.code ?? err.name}, retrying\n`); continue; }
      throw err;
    }
    if (res.ok) return res;
    const body = await res.text();
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`OpenAI ${path} ${res.status}: ${body.replaceAll(key(), "[redacted]").slice(0, 400)}`);
  }
}

// OpenAI routes, picked by narration.json `tts.engine`:
//   chat     — /chat/completions with audio output (gpt-audio-*), the default
//   realtime — the Realtime API over WebSocket (gpt-realtime-*)
//   speech   — the classic /audio/speech endpoint (gpt-4o-mini-tts, tts-1)
//   fal      — Gemini 3.8 Flash TTS via fal queue API
// The conversational models are told to read verbatim; every take is checked
// against the script and re-rolled if the model ad-libbed.
const DIRECTION = "You are a voice actor recording a product film. Read the user's script aloud exactly as written, " +
  "word for word: no additions, no preamble, nothing after it. ";
const levenshtein = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const verbatim = (said, text) => {
  const a = said.toLowerCase().replace(/[^a-z0-9]/g, ""), b = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return levenshtein(a, b) <= Math.max(3, Math.round(b.length * 0.06));
};

async function viaSpeech(text, tts) {
  const res = await openai("audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tts.model, voice: tts.voice, input: text, instructions: tts.instructions, response_format: "wav" }),
  });
  return { wav: Buffer.from(await res.arrayBuffer()), said: text };
}

async function viaFal(text, tts) {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("Speech cache miss: KEATING_OFFLINE=1 forbids paid API calls.");
  const model = tts.model ?? "google/gemini-3.8-flash-tts";
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${falKey()}` },
    body: JSON.stringify({ prompt: text, voice: tts.voice, style_instructions: tts.instructions, speakers: null, turns: null }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`fal Gemini TTS ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const queued = await response.json();
  if (!queued.request_id) throw new Error(`fal Gemini TTS did not return a request ID: ${JSON.stringify(queued).slice(0, 400)}`);
  for (let attempt = 0; attempt < 90; attempt++) {
    const statusResponse = await fetch(`https://queue.fal.run/${model}/requests/${queued.request_id}/status`, {
      headers: { Authorization: `Key ${falKey()}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!statusResponse.ok) throw new Error(`fal Gemini TTS status ${statusResponse.status}: ${(await statusResponse.text()).slice(0, 400)}`);
    const status = await statusResponse.json();
    if (status.status === "COMPLETED") break;
    if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") throw new Error(`fal Gemini TTS failed: ${JSON.stringify(status).slice(0, 400)}`);
    if (attempt === 89) throw new Error("fal Gemini TTS timed out while queued");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const resultResponse = await fetch(`https://queue.fal.run/${model}/requests/${queued.request_id}`, {
    headers: { Authorization: `Key ${falKey()}` }, signal: AbortSignal.timeout(180_000),
  });
  if (!resultResponse.ok) throw new Error(`fal Gemini TTS result ${resultResponse.status}: ${(await resultResponse.text()).slice(0, 400)}`);
  const result = await resultResponse.json();
  if (!result.audio?.url) throw new Error(`fal Gemini TTS returned no audio: ${JSON.stringify(result).slice(0, 400)}`);
  const audioResponse = await fetch(result.audio.url, { signal: AbortSignal.timeout(180_000) });
  if (!audioResponse.ok) throw new Error(`fal audio download ${audioResponse.status}`);
  return { wav: Buffer.from(await audioResponse.arrayBuffer()), said: text };
}

async function viaChat(text, tts) {
  const res = await openai("chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: tts.model, modalities: ["text", "audio"], audio: { voice: tts.voice, format: "wav" },
      messages: [{ role: "system", content: DIRECTION + tts.instructions }, { role: "user", content: `Script:\n${text}` }],
    }),
  });
  const { audio } = (await res.json()).choices[0].message;
  return { wav: Buffer.from(audio.data, "base64"), said: audio.transcript };
}

function viaRealtime(text, tts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${tts.model}`, { headers: { Authorization: `Bearer ${key()}` } });
    const pcm = [];
    let said = "";
    const fail = (err) => { clearTimeout(timer); ws.close(); reject(err); };
    const timer = setTimeout(() => fail(new Error("realtime: timed out")), 90_000);
    ws.onerror = (e) => fail(new Error(`realtime: ${e.message ?? "socket error"}`));
    ws.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "session.created") {
        ws.send(JSON.stringify({ type: "session.update", session: {
          type: "realtime", output_modalities: ["audio"], instructions: DIRECTION + tts.instructions,
          audio: { output: { voice: tts.voice, format: { type: "audio/pcm", rate: 24000 } } },
        } }));
        ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `Script:\n${text}` }] } }));
        ws.send(JSON.stringify({ type: "response.create" }));
      } else if (e.type === "response.output_audio.delta") pcm.push(Buffer.from(e.delta, "base64"));
      else if (e.type === "response.output_audio_transcript.delta") said += e.delta;
      else if (e.type === "error") fail(new Error(`realtime: ${JSON.stringify(e.error).slice(0, 300)}`));
      else if (e.type === "response.done") {
        clearTimeout(timer);
        ws.close();
        // Raw 16-bit 24 kHz mono -> WAV via ffmpeg on stdin.
        const wav = execFileSync("ffmpeg", ["-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "-", "-f", "wav", "-"], { input: Buffer.concat(pcm), maxBuffer: 1 << 28 });
        resolve({ wav, said });
      }
    };
  });
}

const ENGINES = { speech: viaSpeech, chat: viaChat, realtime: viaRealtime, fal: viaFal };

async function speak(text, tts) {
  const engine = tts.engine ?? "speech";
  if (!ENGINES[engine]) throw new Error(`unknown tts.engine "${engine}" (speech | chat | realtime | gemini)`);
  const id = sha(engine, tts.model, tts.voice, tts.instructions, text);
  const raw = join(CACHE, `${id}.raw.wav`);
  const clean = join(CACHE, `${id}.wav`);
  if (!existsSync(raw)) {
    for (let take = 1; ; take++) {
      process.stdout.write(`  tts   ${id} ${engine}/${tts.model} take ${take} "${text.slice(0, 40)}…"\n`);
      const { wav, said } = await ENGINES[engine](text, tts);
      if (verbatim(said, text)) { writeFileSync(raw, wav); break; }
      if (take === 4) throw new Error(`${tts.model} would not read verbatim:\n  script: ${text}\n  said:   ${said}`);
      process.stdout.write(`        off-script, re-rolling: "${said.slice(0, 80)}"\n`);
    }
  }
  if (!existsSync(clean)) {
    // 48 kHz mono, trim the model's leading/trailing silence so scene timing is tight.
    run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af",
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse",
      "-ar", "48000", "-ac", "1", clean]);
  }
  return { id, file: clean };
}

async function transcribe(id, file, prompt) {
  const cached = join(CACHE, `${id}.words.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  process.stdout.write(`  words ${id}\n`);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type: "audio/wav" }), "line.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", prompt);
  const res = await openai("audio/transcriptions", { method: "POST", body: form });
  const words = (await res.json()).words.map((w) => ({ w: w.word, s: w.start, e: w.end }));
  writeFileSync(cached, JSON.stringify(words));
  return words;
}

// Map whisper's words back onto the script's own tokens so captions show the
// authored spelling ("Keating", "keating.help", em dashes stay out).
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function align(text, heard, dur) {
  const tokens = text.split(/\s+/).filter((t) => norm(t));
  const out = tokens.map((t) => ({ w: t, s: null, e: null }));
  let j = 0;
  for (const tok of out) {
    const n = norm(tok.w);
    for (let k = j; k < Math.min(heard.length, j + 4); k++) {
      const h = norm(heard[k].w);
      if (h && (h === n || h.startsWith(n) || n.startsWith(h))) {
        tok.s = heard[k].s; tok.e = heard[k].e; j = k + 1; break;
      }
    }
  }
  // Interpolate any token whisper split/merged differently.
  for (let i = 0; i < out.length; i++) {
    if (out[i].s != null) continue;
    let a = i - 1; while (a >= 0 && out[a].s == null) a--;
    let b = i + 1; while (b < out.length && out[b].s == null) b++;
    const t0 = a >= 0 ? out[a].e : 0, t1 = b < out.length ? out[b].s : dur;
    const span = (t1 - t0) / (b - a);
    for (let m = a + 1; m < b; m++) { out[m].s = t0 + span * (m - a - 1); out[m].e = out[m].s + span * 0.9; }
  }
  return out;
}

const scenes = [];
let cursor = 0;
console.log(`[voice] ${spec.scenes.length} lines · ${tts.engine ?? "speech"} · ${tts.model}/${tts.voice}`);
for (const scene of spec.scenes) {
  const sceneTts = { ...tts, voice: scene.voice ?? tts.voice, instructions: scene.instructions ?? tts.instructions };
  const { id: hash, file } = await speak(scene.text, sceneTts);
  const voDuration = probe(file);
  const heard = await transcribe(hash, file, scene.text);
  const duration = frame(Math.max(scene.min ?? 0, timing.lead + voDuration + timing.tail));
  const voStart = frame(cursor + timing.lead);
  const words = align(scene.text, heard, voDuration).map((w) => ({
    w: w.w, s: +(voStart + w.s).toFixed(3), e: +(voStart + w.e).toFixed(3),
  }));
  scenes.push({ id: scene.id, text: scene.text, start: frame(cursor), duration, voStart, voDuration: +voDuration.toFixed(3), file, words, art: scene.art ?? [], shots: scene.shots ?? [], role: scene.role ?? null, voice: sceneTts.voice, ...(scene.title !== undefined ? { title: scene.title } : {}) });
  cursor = frame(cursor + duration);
}
const total = cursor;
writeFileSync(join(BUILD, "timing.json"), JSON.stringify({ total, fps: timing.fps, scenes }, null, 2));

// Cache the complete mix independently of the paid speech/word caches. Reading the
// canonical music directly avoids stale staged copies when an approved track changes.
const music = join(ROOT, "../music", `${basename(ROOT)}.mp3`);
const fileHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const bedHash = existsSync(music) ? fileHash(music) : "synthetic-pad-v1";
const mixKey = sha(fileHash(fileURLToPath(import.meta.url)), bedHash,
  JSON.stringify({ total, scenes }), ...scenes.map((s) => fileHash(s.file)));
const mix = join(OUT, "mix.wav");
const manifest = join(BUILD, "audio-mix.json");
const narration = join(BUILD, "narration.wav");
const bed = join(BUILD, "bed.wav");
const outputs = [mix, narration, bed, join(BUILD, "voice-final.wav"), join(BUILD, "bed-final.wav")];
const cachedMix = existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).cacheKey === mixKey;
if (cachedMix && outputs.every(existsSync)) {
  console.log(`[voice] mix cache hit ${mixKey} (${existsSync(music) ? "Lyria" : "pad"})`);
} else {
// FFmpeg analysis goes to stderr; fail explicitly rather than parsing a failed run.
const analyse = (file, filter) => {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", filter, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (result.status !== 0) throw new Error(`Audio analysis failed: ${result.stderr.slice(-2000)}`);
  return result.stderr;
};
const normalize = (source, destination, target) => {
  const loud = `I=${target}:TP=-6:LRA=11`;
  const m = JSON.parse(analyse(source, `loudnorm=${loud}:print_format=json`).match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  run("ffmpeg", ["-v", "error", "-y", "-i", source, "-af",
    `loudnorm=${loud}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
    "-ar", "48000", "-ac", "2", destination]);
};
const rms = (file, start, end) => Number(analyse(file,
  `atrim=start=${start}:end=${end},astats=metadata=0:reset=0`).match(/Overall[\s\S]*?RMS level dB: ([-\w.]+)/)[1]);

// Narration bus: each line placed at its voStart; level before balancing the bed.
const rawNarration = join(BUILD, "narration-raw.wav");
const inputs = scenes.flatMap((s) => ["-i", s.file]);
const delays = scenes.map((s, i) => `[${i}]adelay=${Math.round(s.voStart * 1000)}:all=1[v${i}]`).join(";");
run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex",
  `${delays};${scenes.map((_, i) => `[v${i}]`).join("")}amix=inputs=${scenes.length}:normalize=0,apad=whole_dur=${total}[out]`,
  "-map", "[out]", "-ar", "48000", "-ac", "2", "-t", String(total), rawNarration]);
normalize(rawNarration, narration, -16.5);

const rawBed = join(BUILD, "bed-raw.wav");
if (existsSync(music)) {
  run("ffmpeg", ["-v", "error", "-y", "-i", music, "-af", `apad=whole_dur=${total},atrim=duration=${total}`,
    "-ar", "48000", "-ac", "2", rawBed]);
} else {
  // Original reproducible A-minor pad; the common mix stage supplies its fades.
  const tones = [[110, 0.30], [164.81, 0.22], [220, 0.18], [261.63, 0.12], [329.63, 0.08]];
  const expr = tones.map(([f, a], i) => `${a}*sin(2*PI*${f}*t)*(0.75+0.25*sin(2*PI*${(0.07 + i * 0.023).toFixed(3)}*t))`).join("+");
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${total}`, "-af",
    `lowpass=f=900,aecho=0.8:0.7:120|240:0.25|0.18,atrim=duration=${total}`, "-ac", "2", rawBed]);
}
const levelBed = join(BUILD, "bed-level.wav");
// Leave about 1dB for the final common gain to reach -18 between lines.
normalize(rawBed, levelBed, spec.output === "keating-manifesto" ? -18 : -19);

// Word-timed sidechain automation. Hold the duck through each line (including
// breaths), anticipate speech by 120ms and release over 250ms between lines.
// -6dB puts the bed near -24 LUFS after final gain; quieter lines get extra
// attenuation to maintain 8.3dB RMS separation (0.3dB of measurement margin).
const windows = scenes.map((s) => {
  const start = Math.max(0, Math.min(s.voStart, s.words[0]?.s ?? s.voStart));
  const end = Math.min(total, Math.max(s.voStart + s.voDuration, s.words.at(-1)?.e ?? 0));
  const gainDb = Math.min(-6, rms(narration, start, end) - rms(levelBed, start, end) - 8.3);
  return { id: s.id, start, end, gainDb };
});
const ducks = windows.map(({ start, end, gainDb }) => {
  const amount = 1 - 10 ** (gainDb / 20);
  return `(1-${amount}*min(clip((t-${start - 0.12})/0.12,0,1),clip((${end + 0.25}-t)/0.25,0,1)))`;
});
run("ffmpeg", ["-v", "error", "-y", "-i", levelBed, "-af",
  `volume='${ducks.join("*")}':eval=frame,afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, total - 1.5)}:d=1.5`,
  "-ar", "48000", "-ac", "2", "-t", String(total), bed]);
const premix = join(BUILD, "premix.wav");
run("ffmpeg", ["-v", "error", "-y", "-i", narration, "-i", bed, "-filter_complex",
  "[0][1]amix=inputs=2:normalize=0[out]", "-map", "[out]", "-ar", "48000", "-ac", "2", premix]);
// One common linear gain preserves the stem relationship and makes the saved
// verification stems exactly additive. Fail rather than silently clip a new track.
const measured = JSON.parse(analyse(premix, "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json").match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const gainDb = -16 - Number(measured.input_i);
if (Number(measured.input_tp) + gainDb > -1.5) throw new Error("Mix needs peak control before normalization; refusing to exceed -1 dBTP");
for (const [source, destination] of [[premix, mix], [narration, outputs[3]], [bed, outputs[4]]]) {
  run("ffmpeg", ["-v", "error", "-y", "-i", source, "-af", `volume=${gainDb}dB`, "-ar", "48000", "-ac", "2", destination]);
}
const speech = windows.map((w) => ({ ...w, voiceRmsDb: rms(outputs[3], w.start, w.end), bedRmsDb: rms(outputs[4], w.start, w.end) }));
for (const w of speech) {
  w.separationDb = w.voiceRmsDb - w.bedRmsDb;
  if (w.separationDb < 8) throw new Error(`Music masks narration in ${w.id}: ${w.separationDb.toFixed(2)}dB separation`);
}
writeFileSync(manifest, JSON.stringify({ cacheKey: mixKey, bedSource: existsSync(music) ? music : "synthetic-pad", bedHash, total, gainDb, speech }, null, 2));
console.log(`[voice] ${existsSync(music) ? "Lyria" : "pad"} mix ${mixKey}; minimum speech separation ${Math.min(...speech.map((w) => w.separationDb)).toFixed(2)}dB`);
}
console.log(`[voice] total ${total.toFixed(2)}s → build/timing.json, assets/audio/mix.wav`);
for (const s of scenes) console.log(`  ${s.id.padEnd(9)} ${s.start.toFixed(2).padStart(6)} +${s.duration.toFixed(2)}  vo ${s.voDuration.toFixed(2)}s`);
