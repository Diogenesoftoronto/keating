#!/usr/bin/env node
// Audition all 30 fal Gemini 3.8 preset voices in English and Quebec French.
// Cache each request by voice, language, transcript, and style so reruns are free.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const out = join(root, "fal");
const samples = join(out, "samples");
const catalogPath = join(out, "catalog.json");
mkdirSync(samples, { recursive: true });
const voices = ["Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Pulcherrima", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi"];
const styles = [
  "Warm, grounded teacher; intimate studio tone, patient pace, lightly wry.",
  "Clear, calm documentary narrator; rounded resonance and precise diction.",
  "Bright, curious mentor; friendly lift, natural pace, restrained energy.",
  "Soft conversational voice; sincere and close, with unforced pauses.",
  "Steady, composed narrator; crisp articulation, humane and confident.",
  "Reflective storyteller; gentle low-mid register, thoughtful pauses.",
  "Open-hearted guide; humane, quietly passionate, speaking to one person.",
  "Playful but credible teacher; light warmth, never exaggerated.",
  "Velvety documentary delivery; measured phrasing and subtle emphasis.",
  "Easygoing student; candid, quick, curious, and conversational.",
];
const scripts = {
  "en-US": "Good teaching starts with a better question. Take a moment, notice what you already know, and let the next idea click.",
  "fr-CA": "Un bon enseignement commence par une meilleure question. Prends un instant, vois ce que tu sais déjà, puis laisse la prochaine idée faire son chemin.",
};
let cachedFalKey;
function key() {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("KEATING_OFFLINE=1 forbids voice generation.");
  cachedFalKey ??= process.env.FAL_KEY || execFileSync("skate", ["get", "fal_api_key@secrets"], { encoding: "utf8" }).trim();
  return cachedFalKey;
}
function sha(value) { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : { model: "google/gemini-3.8-flash-tts", voices: [] };
const done = new Set(catalog.voices.map((v) => v.file));
for (let index = 0; index < Math.min(voices.length, 20); index += 1) {
  for (const [locale, text] of Object.entries(scripts)) {
    const style = `${styles[index % styles.length]} ${locale === "fr-CA" ? "Parle en français québécois contemporain, accent naturel de Montréal ou de Québec, sans caricature." : "Speak natural North American English."}`;
    const id = sha(JSON.stringify({ voice: voices[index], locale, style, text }));
    const file = `samples/${voices[index]}-${locale}.wav`;
    if (!done.has(file)) {
      const response = await fetch(`https://queue.fal.run/google/gemini-3.8-flash-tts`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${key()}` },
        body: JSON.stringify({ prompt: text, voice: voices[index], style_instructions: style, speakers: null, turns: null }), signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`fal ${voices[index]} ${locale} ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const queued = await response.json();
      if (!queued.request_id) throw new Error(`fal returned no request ID: ${JSON.stringify(queued).slice(0, 300)}`);
      let completed = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const statusResponse = await fetch(`https://queue.fal.run/google/gemini-3.8-flash-tts/requests/${queued.request_id}/status`, { headers: { Authorization: `Key ${key()}` } });
        if (!statusResponse.ok) throw new Error(`fal status ${statusResponse.status}: ${(await statusResponse.text()).slice(0, 300)}`);
        const status = await statusResponse.json();
        if (status.status === "COMPLETED") { completed = true; break; }
        if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") throw new Error(`fal failed: ${JSON.stringify(status).slice(0, 300)}`);
        if (attempt === 89) throw new Error(`fal timed out for ${voices[index]} ${locale}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!completed) throw new Error(`fal did not complete ${voices[index]} ${locale}`);
      const resultResponse = await fetch(`https://queue.fal.run/google/gemini-3.8-flash-tts/requests/${queued.request_id}`, { headers: { Authorization: `Key ${key()}` } });
      if (!resultResponse.ok) throw new Error(`fal result ${resultResponse.status}: ${(await resultResponse.text()).slice(0, 300)}`);
      const result = await resultResponse.json();
      const audioResponse = await fetch(result.audio?.url);
      if (!audioResponse.ok) throw new Error(`fal audio download ${audioResponse.status}`);
      writeFileSync(join(out, file), Buffer.from(await audioResponse.arrayBuffer()));
      catalog.voices.push({ id, name: voices[index], locale, style, text, file });
      catalog.voices.sort((a, b) => voices.indexOf(a.name) - voices.indexOf(b.name) || a.locale.localeCompare(b.locale));
      writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
      process.stdout.write(`Generated ${voices[index]} · ${locale}\n`);
    }
  }
}
function esc(value) { return String(value).replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
const cards = (locale) => catalog.voices.filter((v) => v.locale === locale).map((v) => `<article><h2>${esc(v.name)}</h2><p>${esc(v.style)}</p><audio controls preload="none" src="${esc(v.file)}"></audio><p>${esc(v.text)}</p></article>`).join("\n");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Keating · fal Gemini voices</title><style>body{max-width:1200px;margin:auto;padding:2rem;background:#f2eee4;color:#20241f;font:16px/1.5 system-ui}h1{font-size:clamp(2rem,6vw,4rem)}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:1rem}article{padding:1rem;border:1px solid #333;background:#fff}audio{width:100%}</style><body><h1>Gemini 3.8 voices via fal</h1><p>${catalog.voices.length} audios · 30 built-in voices × English and Québec French. Each take uses a distinct delivery design; fal's endpoint accepts presets plus style direction, not persistent custom voice identities.</p><h2>English</h2><main>${cards("en-US")}</main><h2>Voix françaises québécoises</h2><main>${cards("fr-CA")}</main></body></html>`;
writeFileSync(join(out, "index.html"), `${html}\n`);
