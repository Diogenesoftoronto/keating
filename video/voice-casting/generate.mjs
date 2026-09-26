#!/usr/bin/env node
// Create and audition persistent Gemini 3.8 voice personas from voices.json.
// Progress is saved after every voice so an interrupted run can resume safely.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "generated");
const SAMPLES = join(OUT, "samples");
const DEFINITIONS = JSON.parse(readFileSync(join(ROOT, "voices.json"), "utf8"));
const MANIFEST = join(OUT, "catalog.json");
mkdirSync(SAMPLES, { recursive: true });

let apiKey;
function key() {
  if (process.env.KEATING_OFFLINE === "1") throw new Error("KEATING_OFFLINE=1 forbids voice creation.");
  apiKey ??= process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || execFileSync("skate", ["get", "gemini@secrets"], { encoding: "utf8" }).trim();
  return apiKey;
}
async function apiFetch(url, init) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 6) return response;
    } catch (error) {
      if (attempt === 6) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
  }
}

const catalog = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { model: "gemini-3.8-flash-tts", voices: [] };
const complete = new Set(catalog.voices.filter((voice) => voice.id && voice.sample).map((voice) => voice.key));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
let created = 0;

function writeCatalog() {
  writeFileSync(MANIFEST, `${JSON.stringify(catalog, null, 2)}\n`);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keating · Gemini voice casting</title><style>body{max-width:1100px;margin:auto;padding:2rem;background:#f1ece0;color:#1c211b;font:16px/1.5 system-ui}h1{font-size:clamp(2rem,6vw,4rem)}nav{position:sticky;top:0;padding:1rem;background:#f1ece0}nav a{margin-right:1rem;color:#167a3b}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}article{padding:1.25rem;border:2px solid #1c211b;box-shadow:5px 5px #1e9b50;background:#fffdf7}audio{width:100%}code{display:block;overflow-wrap:anywhere;margin-top:.75rem;font-size:.75rem}p{overflow-wrap:anywhere}</style><body><h1>Gemini voice casting</h1><p>${catalog.voices.length} designed voices · Gemini 3.8 Flash TTS. Compare each short preview; English and French canadien samples are grouped below.</p><nav><a href="#english">English</a><a href="#fr-ca">Français québécois</a></nav><h2 id="english">English voices</h2><main>${cardsFor("en-US")}</main><h2 id="fr-ca">Voix québécoises</h2><main>${cardsFor("fr-CA")}</main></body></html>`;
  writeFileSync(join(OUT, "index.html"), `${html}\n`);
}
function cardsFor(language) {
  return catalog.voices.filter((voice) => voice.language === language).map((voice) => `<article><h2>${escapeHtml(voice.name)}</h2><p>${escapeHtml(voice.languageLabel)} · ${escapeHtml(voice.gender)}</p><p>${escapeHtml(voice.prompt)}</p>${voice.sample ? `<audio controls preload="none" src="${escapeHtml(voice.sample)}"></audio>` : "<p>Preview pending</p>"}<code>${escapeHtml(voice.id ?? "pending")}</code></article>`).join("\n");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

catalog.voices = catalog.voices.filter((voice) => DEFINITIONS.some((item) => item.id === voice.key));
for (const definition of DEFINITIONS) {
  if (complete.has(definition.id) || created >= limit) continue;
  const entry = catalog.voices.find((voice) => voice.key === definition.id) ?? {
    key: definition.id,
    name: definition.name,
    language: definition.language,
    languageLabel: definition.language === "fr-CA" ? "Français canadien · accent québécois" : "English · North American",
    gender: definition.gender,
    prompt: definition.prompt,
  };
  if (!catalog.voices.includes(entry)) catalog.voices.push(entry);
  if (!entry.id) {
    const response = await apiFetch("https://generativelanguage.googleapis.com/v1beta/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify({
        store: true,
        voice: {
          model: catalog.model,
          type: "prompted",
          display_name: `Keating ${definition.name}`,
          gender: definition.gender,
          language_code: definition.language,
          prompted: { input: definition.prompt },
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`Voice design ${definition.id} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const result = await response.json();
    entry.id = result.id;
    writeCatalog();
    process.stdout.write(`[voice-design] created ${definition.id} (${entry.id})\n`);
  }
  if (entry.id && !entry.sample) {
    const result = await apiFetch(`https://generativelanguage.googleapis.com/v1beta/voices/${encodeURIComponent(entry.id)}`, {
      headers: { "x-goog-api-key": key() },
      signal: AbortSignal.timeout(180_000),
    });
    if (!result.ok) throw new Error(`Voice preview ${definition.id} failed (${result.status}).`);
    const voice = await result.json();
    if (!voice.sample_audio?.data) throw new Error(`Voice ${definition.id} was created, but Google returned no sample_audio preview.`);
    const filename = `${definition.id}.wav`;
    writeFileSync(join(SAMPLES, filename), Buffer.from(voice.sample_audio.data, "base64"));
    entry.sample = `samples/${filename}`;
    writeCatalog();
    process.stdout.write(`[voice-design] saved sample ${definition.id}\n`);
  }
  complete.add(definition.id);
  created += 1;
}
writeCatalog();
process.stdout.write(`[voice-design] ${catalog.voices.filter((voice) => voice.sample).length}/${DEFINITIONS.length} previews in ${OUT}\n`);
