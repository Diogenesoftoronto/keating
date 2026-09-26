#!/usr/bin/env node
// Compare Cartesia Sonic 3.6's public voices in English and native fr-CA voices.
// The public API supports preset voices, accent localization, and delivery controls;
// prompt-to-new-voice design is not exposed in its documented API.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const out = join(root, "cartesia");
const samples = join(out, "samples");
const manifestFile = join(out, "catalog.json");
mkdirSync(samples, { recursive: true });
let cachedCartesiaKey;
function apiKey() {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("KEATING_OFFLINE=1 forbids voice generation.");
  cachedCartesiaKey ??= process.env.CARTESIA_API_KEY || execFileSync("skate", ["get", "cartesia_api_key@secrets"], { encoding: "utf8" }).trim();
  return cachedCartesiaKey;
}
const headers = () => ({ Authorization: `Bearer ${apiKey()}`, "Cartesia-Version": "2026-08-14", "Content-Type": "application/json" });
const audioText = {
  en: "Good teaching starts with a better question. Take a moment, notice what you already know, and let the next idea click.",
  fr: "Un bon enseignement commence par une meilleure question. Prends un instant, vois ce que tu sais déjà, puis laisse la prochaine idée faire son chemin.",
};
async function list(locale) {
  const response = await fetch(`https://api.cartesia.ai/voices?limit=100&language=${encodeURIComponent(locale)}&expand%5B%5D=preview_file_url`, { headers: headers() });
  if (!response.ok) throw new Error(`Cartesia list ${locale} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  return data.data ?? [];
}
const [enVoices, frVoices] = await Promise.all([list("en-US"), list("fr-CA")]);
const en = enVoices.filter((voice) => voice.access === "public" || voice.visibility === "all").slice(0, 8);
const fr = frVoices.filter((voice) => voice.access === "public" || voice.visibility === "all").slice(0, 8);
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { model: "sonic-3.6", voices: [] };
const completed = new Set(manifest.voices.map((item) => item.file));
for (const [locale, text, voices] of [["en-US", audioText.en, en], ["fr-CA", audioText.fr, fr]]) {
  for (const voice of voices) {
    const filename = `samples/${voice.id}-${locale}.wav`;
    if (completed.has(filename)) continue;
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ model_id: "sonic-3.6", transcript: text, voice: voice.id, locale, output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 }, normalization: "auto" }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`Cartesia ${voice.name} ${locale} ${response.status}: ${(await response.text()).slice(0, 400)}`);
    writeFileSync(join(out, filename), Buffer.from(await response.arrayBuffer()));
    manifest.voices.push({ id: voice.id, name: voice.name, tagline: voice.tagline, description: voice.description, locale, preview: voice.preview_file_url ?? null, file: filename, text });
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Generated ${voice.name} · ${locale}\n`);
  }
}
function escape(value) { return String(value ?? "").replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
const cards = (locale) => manifest.voices.filter((voice) => voice.locale === locale).map((voice) => `<article><h2>${escape(voice.name)}</h2><p>${escape(voice.tagline ?? "")}</p><p>${escape(voice.description ?? "")}</p><audio controls preload="none" src="${escape(voice.file)}"></audio><p>${escape(voice.text)}</p></article>`).join("\n");
const noVoices = !fr.length ? "<p>Cartesia returned no public voices tagged with native fr-CA. This gallery does not mislabel European French as Québécois; a Québécois audition needs an appropriate Cartesia voice or localized voice.</p>" : "";
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Keating · Cartesia auditions</title><style>body{max-width:1200px;margin:auto;padding:2rem;background:#f2eee4;color:#20241f;font:16px/1.5 system-ui}h1{font-size:clamp(2rem,6vw,4rem)}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:1rem}article{padding:1rem;border:1px solid #333;background:#fff}audio{width:100%}</style><body><h1>Cartesia Sonic 3.6</h1><p>Public voice auditions. The API returns voice presets, not new voices designed from text descriptions.</p><h2>English</h2><main>${cards("en-US")}</main><h2>Français québécois (fr-CA)</h2>${noVoices}<main>${cards("fr-CA")}</main></body></html>`;
writeFileSync(join(out, "index.html"), `${html}\n`);
