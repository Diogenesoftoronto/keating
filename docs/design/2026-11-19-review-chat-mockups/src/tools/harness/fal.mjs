// node fal.mjs <outDir> ; reads the key from the environment and never prints it.
import { writeFileSync, mkdirSync } from "node:fs";
const key = process.env.fal_api_key || process.env.FAL_KEY;
if (!key) { console.error("no fal key in env"); process.exit(1); }
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const jobs = {
  paper: "Seamless tileable texture: a sheet of cream handmade laid paper scanned flat, fine cotton fibers, faint horizontal laid lines, tiny flecks, even diffuse lighting, no shadows, no folds, no text, low contrast, warm off-white",
  marble: "Seamless tileable traditional combed marbled endpaper, Turkish ebru marbling, swirling veins in deep forest green, bright phosphor green, cream and near-black ink, flat top-down scan, even lighting, no text, no border",
  doodles: "Seamless tileable pattern of small hand-engraved line drawings scattered evenly: quill pen, open book, magnifying glass, drafting compass, ruler, light bulb, chess knight, hourglass, small retro computer terminal. Single dark green ink line on a plain cream background, flat vector style, uniform line weight, no text, no shading",
};
const only = process.argv.slice(3);
await Promise.all(Object.entries(jobs).filter(([n]) => !only.length || only.includes(n)).map(async ([name, prompt]) => {
  const res = await fetch("https://fal.run/ideogram/v4/tiling", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, tiling_mode: "both", image_size: "square_hd", rendering_speed: "TURBO", output_format: "png", expansion_model: "None", num_images: 1 }),
  });
  const text = await res.text();
  if (!res.ok) { console.log(name, "HTTP", res.status, text.slice(0, 300)); return; }
  const data = JSON.parse(text);
  const img = data.images?.[0];
  if (!img?.url) { console.log(name, "no image", text.slice(0, 200)); return; }
  const bytes = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  writeFileSync(`${out}/${name}.png`, bytes);
  console.log(name, "ok", img.width, "x", img.height, bytes.length, "bytes, seed", data.seed);
}));
