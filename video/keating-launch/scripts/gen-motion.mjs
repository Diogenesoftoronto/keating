// Animate the generated stills with MiniMax H3 (image-to-video, the still as first frame).
//
//   prompts/motion/<name>.json  { image, scene, prompt }  ->  assets/gen/<name>.mp4
//
// The clip is as long as its scene (rounded up, 4–15 s). It is cached by a hash of the
// prompt, the still and the length, so a clip is regenerated only when one of those
// changes. The result is re-encoded to silent 1080p30 with a keyframe every 15 frames,
// so the render can seek it frame by frame. The key is read from skate
// (`minimax@secrets`) or MINIMAX_API_KEY at runtime and never written.
// Without a key, missing clips are skipped and build.mjs keeps the still.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.minimax.io/v2";
const MODEL = "MiniMax-H3";
const RESOLUTION = "2K";
const timing = JSON.parse(readFileSync(join(ROOT, "build/timing.json"), "utf8"));

function key() {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  try {
    return execFileSync("skate", ["get", "minimax@secrets"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + path, {
        ...init,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`), { fatal: true });
      return body;
    } catch (err) {
      if (err.fatal || attempt >= 4) throw err;
      console.log(`[motion] ${path}: ${err.message}, retrying`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function animate(name, spec, seconds) {
  // A JPEG data URI keeps the request small; the still is a 3 MB PNG.
  const jpg = execFileSync("magick", [join(ROOT, spec.image), "-quality", "92", "jpg:-"], { maxBuffer: 1 << 26 });
  const { task_id, id } = await api("/video_generation", {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      content: [
        { type: "text", text: spec.prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpg.toString("base64")}` }, role: "first_frame" },
      ],
      duration: seconds,
      resolution: RESOLUTION,
    }),
  });
  const task = task_id ?? id;
  if (!task) throw new Error(`${name}: no task id in response`);
  console.log(`[motion] ${name}: task ${task}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const q = await api(`/query/video_generation/${task}`);
    const t = q.task ?? q;
    if (t.status === "succeeded") return t.content.url;
    if (t.status === "failed" || t.status === "cancelled") throw new Error(`${name}: ${t.status} ${JSON.stringify(t.error)}`);
    if (Date.now() - t0 > 20 * 60_000) throw new Error(`${name}: timed out (${t.status})`);
    process.stdout.write(`[motion] ${name}: ${t.status} ${Math.round((Date.now() - t0) / 1000)}s\r`);
  }
}

const KEY = key();
for (const file of readdirSync(join(ROOT, "prompts/motion")).filter((f) => f.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const spec = JSON.parse(readFileSync(join(ROOT, "prompts/motion", file), "utf8"));
  const scene = timing.scenes.find((s) => s.id === spec.scene);
  if (!scene) throw new Error(`${name}: unknown scene ${spec.scene}`);
  const seconds = Math.min(15, Math.max(4, Math.ceil(scene.duration)));
  const hash = createHash("sha256").update(JSON.stringify([MODEL, RESOLUTION, seconds, spec.prompt])).update(readFileSync(join(ROOT, spec.image))).digest("hex").slice(0, 16);
  const out = join(ROOT, `assets/gen/${name}.mp4`);
  const stamp = join(ROOT, `assets/gen/${name}.mp4.hash`);
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === hash) {
    console.log(`[motion] ${name} cached`);
    continue;
  }
  if (!KEY) {
    console.log(`[motion] ${name}: no MiniMax key; build keeps the still`);
    continue;
  }
  console.log(`[motion] ${name}: ${MODEL} ${RESOLUTION} ${seconds}s from ${spec.image}`);
  let url;
  try {
    url = await animate(name, spec, seconds);
  } catch (err) {
    // e.g. 2013: the account's plan doesn't include H3. Not fatal: the still stays.
    console.log(`[motion] ${name}: ${err.message.slice(0, 240)}; keeping the still`);
    continue;
  }
  const work = mkdtempSync(join(tmpdir(), "motion-"));
  const raw = join(work, "raw.mp4");
  writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-an",
    "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p",
    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-g", "15", "-movflags", "+faststart", out]);
  writeFileSync(stamp, hash + "\n");
  rmSync(work, { recursive: true, force: true });
  console.log(`\n[motion] ${name} -> assets/gen/${name}.mp4`);
}
