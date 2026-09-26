// Animates a storyboard still into a short silent clip on fal (image-to-video, the still as first frame).
//   node video/spotlights/gen-video.mjs <still.png> <motion prompt> <out.mp4> [--model=h3] [--seconds=5] [--res=1080p] [--end=<last.png>] [--aspect=16:9|9:16] [--dry-run]
//
// Models: h3 (minimax/h3-max), seedance (bytedance/seedance-2.5, best fidelity and legible text), flux (blackforestlabs/flux-3).
// Every paid call is logged with a conservative cost estimate in motion/ledger.json, and a call that
// would take the total past FAL_BUDGET (default $20) is refused before anything is sent. The key comes
// from FAL_KEY or `skate get fal_api_key@secrets` at runtime and is never written. Cached by model, settings,
// prompt and still; the result is re-encoded to 1080p30 (1080×1920 with --aspect=9:16) with a keyframe every 15 frames for seeking.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Dollars per second from https://api.fal.ai/v1/models/pricing (H3 is on its launch rate until 30 Sep 2026).
// Seedance bills $0.0214 per 1000 tokens, width × height × 24 fps / 1024 tokens a second.
const MODELS = {
  h3: { id: "minimax/h3-max/image-to-video", res: { "768p": "768P", "1080p": "1080P" }, rate: { "768p": 0.025, "1080p": 0.025 } },
  seedance: { id: "bytedance/seedance-2.5/image-to-video", res: { "720p": "720p", "1080p": "1080p" }, rate: { "720p": 0.47, "1080p": 1.04 } },
  flux: { id: "blackforestlabs/flux-3/image-to-video", res: { "720p": "720p", "1080p": "1080p" }, rate: { "720p": 0.085, "1080p": 0.17 } },
};

const flag = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const [still, motion, out] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const model = MODELS[flag("model", "h3")];
const res = flag("res", "1080p");
const seconds = Number(flag("seconds", 5));
const aspect = flag("aspect", "16:9");
const [w, h] = aspect === "9:16" ? [1080, 1920] : [1920, 1080];
if (!model || !model.res[res]) throw new Error(`unknown model/resolution: ${flag("model", "h3")} ${res}`);
const rate = Number(flag("rate", model.rate?.[res] ?? NaN));
if (!Number.isFinite(rate)) throw new Error(`no known price for ${model.id}; pass --rate=<dollars per second> from fal's pricing page`);

const prompt = `Animate this printed poster illustration, keeping its exact style, palette, grain and composition. ${motion} No cuts; faces and hands stay stable; no new text, letters or logos.`;
const image = readFileSync(still);
const end = flag("end");
const hash = createHash("sha256").update(JSON.stringify([model.id, res, seconds, prompt, ...(aspect === "16:9" ? [] : [aspect])])).update(image)
  .update(end ? readFileSync(end) : "").digest("hex").slice(0, 16);
if (existsSync(out) && existsSync(`${out}.hash`) && readFileSync(`${out}.hash`, "utf8").trim() === hash) {
  console.log(`${out} cached`);
  process.exit(0);
}

const ledgerPath = join(dirname(fileURLToPath(import.meta.url)), "motion", "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
const spent = ledger.reduce((sum, entry) => sum + entry.cost, 0);
const cost = +(rate * seconds).toFixed(2);
const budget = Number(process.env.FAL_BUDGET ?? 20);
console.log(`${model.id} ${res} ${seconds}s ≈ $${cost} · spent $${spent.toFixed(2)} of $${budget}`);
if (spent + cost > budget) throw new Error(`refusing: would take spend to $${(spent + cost).toFixed(2)}`);
if (process.argv.includes("--dry-run")) process.exit(0);

const key = process.env.FAL_KEY || execFileSync("skate", ["get", "fal_api_key@secrets"], { encoding: "utf8" }).trim();
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const dataUrl = (png) => `data:image/jpeg;base64,${execFileSync("magick", [png, "-quality", "92", "jpg:-"], { maxBuffer: 1 << 26 }).toString("base64")}`;
const input = {
  prompt,
  image_url: dataUrl(still),
  ...(end ? { end_image_url: dataUrl(end) } : {}),
  duration: model === MODELS.h3 ? seconds : String(seconds),
  resolution: model.res[res],
  ...(model === MODELS.h3 ? { prompt_expansion_mode: "disabled" } : { generate_audio: false }),
  ...(model === MODELS.seedance ? { aspect_ratio: aspect } : {}),
};
const queued = await json(`https://queue.fal.run/${model.id}`, { method: "POST", headers, body: JSON.stringify(input) });
// Logged once the request is accepted, since fal bills it from here even if we stop polling.
ledger.push({ at: new Date().toISOString(), model: model.id, res, seconds, cost, out, request: queued.request_id });
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

for (const t0 = Date.now(); ; ) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const status = await json(queued.status_url, { headers });
  if (status.status === "COMPLETED") break;
  if (status.error) throw new Error(JSON.stringify(status.error));
  if (Date.now() - t0 > 20 * 60000) throw new Error(`timed out (${status.status}); request ${queued.request_id}`);
}
const result = await json(queued.response_url, { headers });
const video = await fetch(result.video.url);
if (!video.ok) throw new Error(`download ${video.status}`);
const work = mkdtempSync(join(tmpdir(), "spotlight-motion-"));
try {
  const raw = join(work, "raw.mp4");
  writeFileSync(raw, Buffer.from(await video.arrayBuffer()));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-an",
    "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},fps=30,format=yuv420p`,
    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-g", "15", "-movflags", "+faststart", out]);
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(`${out}.hash`, `${hash}\n`);
console.log(out);
