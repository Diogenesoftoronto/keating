// Generates an instrumental music bed on fal (Google Lyria 3.5).
//   node video/spotlights/gen-music.mjs <prompt> <out.mp3> [--image=<still.png>] [--dry-run]
//
// Shares motion/ledger.json and the FAL_BUDGET guard with gen-video.mjs. The key comes from FAL_KEY or
// `skate get fal_api_key@secrets` at runtime and is never written. Cached by prompt and image.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "google/lyria-3.5";
const COST = 0.1; // dollars per generation, https://api.fal.ai/v1/models/pricing

const flag = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const [prompt, out] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const image = flag("image");
const hash = createHash("sha256").update(JSON.stringify([ENDPOINT, prompt])).update(image ? readFileSync(image) : "").digest("hex").slice(0, 16);
if (existsSync(out) && existsSync(`${out}.hash`) && readFileSync(`${out}.hash`, "utf8").trim() === hash) {
  console.log(`${out} cached`);
  process.exit(0);
}

const ledgerPath = join(dirname(fileURLToPath(import.meta.url)), "motion", "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
const spent = ledger.reduce((sum, entry) => sum + entry.cost, 0);
const budget = Number(process.env.FAL_BUDGET ?? 20);
console.log(`${ENDPOINT} ≈ $${COST} · spent $${spent.toFixed(2)} of $${budget}`);
if (spent + COST > budget) throw new Error(`refusing: would take spend to $${(spent + COST).toFixed(2)}`);
if (process.argv.includes("--dry-run")) process.exit(0);

const key = process.env.FAL_KEY || execFileSync("skate", ["get", "fal_api_key@secrets"], { encoding: "utf8" }).trim();
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const input = { prompt };
if (image) input.image_url = `data:image/jpeg;base64,${execFileSync("magick", [image, "-quality", "90", "jpg:-"], { maxBuffer: 1 << 26 }).toString("base64")}`;
const queued = await json(`https://queue.fal.run/${ENDPOINT}`, { method: "POST", headers, body: JSON.stringify(input) });
ledger.push({ at: new Date().toISOString(), model: ENDPOINT, cost: COST, out, request: queued.request_id });
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

for (const t0 = Date.now(); ; ) {
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const status = await json(queued.status_url, { headers });
  if (status.status === "COMPLETED") break;
  if (status.error) throw new Error(JSON.stringify(status.error));
  if (Date.now() - t0 > 10 * 60000) throw new Error(`timed out (${status.status}); request ${queued.request_id}`);
}
const result = await json(queued.response_url, { headers });
const audio = await fetch(result.audio.url);
if (!audio.ok) throw new Error(`download ${audio.status}`);
writeFileSync(out, Buffer.from(await audio.arrayBuffer()));
writeFileSync(`${out}.hash`, `${hash}\n`);
console.log(out);
