// Generates one storyboard/illustration frame with gpt-image-2.5-sunburst.
//   node video/spotlights/gen-image.mjs <prompt.txt> <out.png> [--size=1536x1024]
// Cached by prompt hash (<out>.hash). The key comes from OPENAI_API_KEY or skate at runtime.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [promptPath, out] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const size = process.argv.find((arg) => arg.startsWith("--size="))?.slice(7) ?? "1536x1024";
const model = process.env.IMAGE_MODEL ?? "gpt-image-2.5-sunburst";
const prompt = readFileSync(promptPath, "utf8").trim();
const hash = createHash("sha256").update(JSON.stringify({ model, size, prompt })).digest("hex").slice(0, 16);
if (existsSync(out) && existsSync(`${out}.hash`) && readFileSync(`${out}.hash`, "utf8").trim() === hash) {
  console.log(`${out} cached`);
  process.exit(0);
}
const key = process.env.OPENAI_API_KEY || execFileSync("skate", ["get", "openai-api@secrets"], { encoding: "utf8" }).trim();
const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model, prompt, size, quality: "high", n: 1 }),
});
const json = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
writeFileSync(out, Buffer.from(json.data[0].b64_json, "base64"));
writeFileSync(`${out}.hash`, `${hash}\n`);
console.log(out);
