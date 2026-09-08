#!/usr/bin/env node
import sharp from "sharp";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const headOnly = args.includes("--head-only");
const sourceDir = path.resolve(args.find((argument) => !argument.startsWith("--")) ?? path.join(webRoot, "artwork/keatingbot-v1"));
const brandDir = path.join(webRoot, "public/brand");
const frameDir = path.join(brandDir, "bot-frames-v1");
const FRAME = 256;
const HEAD_ROWS = [
  ["head-idle", "head-idle", "head-blink", "head-idle"],
  ["head-listening", "head-listening", "head-listening", "head-listening"],
  ["head-thinking", "head-thinking", "head-thinking", "head-thinking"],
  ["head-speaking", "head-success", "head-success", "head-speaking"],
];
const BODY_ROWS = [
  ["body-rest", "body-wave", "body-wave", "body-rest"],
  ["body-listen", "body-listen", "body-listen", "body-listen"],
  ["body-work", "body-work", "body-work", "body-work"],
  ["body-cheer", "body-hop", "body-cheer", "body-rest"],
];

/** Flood only neutral near-white pixels reachable from the image boundary. */
function removeBackground(data, width, height, { erodeExisting = false, erosionSteps = 1 } = {}) {
  let existingAlpha = false;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 255) { existingAlpha = true; break; }
  }
  if (existingAlpha && !erodeExisting) return { cleanup: "preserved-existing-alpha", removedPixels: 0 };
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let start = 0;
  let end = 0;
  const enqueue = (pixel) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const offset = pixel * 4;
    const low = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const high = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    if (low >= 220 && high - low <= 22) queue[end++] = pixel;
  };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (start < end) {
    const pixel = queue[start++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    data[pixel * 4 + 3] = 0;
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
  // Remove one original-resolution boundary pixel before downsampling. This
  // targets the white matte fringe without eroding internal cream highlights.
  let erodedPixels = 0;
  for (let step = 0; step < erosionSteps; step++) {
    const alpha = new Uint8Array(width * height);
    for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = data[pixel * 4 + 3];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const pixel = y * width + x;
      if (alpha[pixel] && (!alpha[pixel - 1] || !alpha[pixel + 1] || !alpha[pixel - width] || !alpha[pixel + width])) {
        data[pixel * 4 + 3] = 0;
        erodedPixels++;
      }
    }
  }
  return { cleanup: existingAlpha ? "existing-alpha-boundary-cleaned" : "edge-connected-neutral-white", removedPixels: end, erodedPixels, erosionSteps };
}

function pixelBounds(data, width, height, predicate) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] === 0 || !predicate(data[offset], data[offset + 1], data[offset + 2])) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** The main screen is the largest green island, not the detached ear pieces. */
function greenScreenBounds(data, width, height) {
  const seen = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let largest = null;
  let largestCount = 0;
  const green = (pixel) => {
    const offset = pixel * 4;
    return data[offset + 3] >= 128 && data[offset + 1] >= 55
      && data[offset + 1] > data[offset] * 1.2
      && data[offset + 1] > data[offset + 2] * 1.1;
  };
  for (let seed = 0; seed < width * height; seed++) {
    if (seen[seed] || !green(seed)) continue;
    let start = 0; let end = 1;
    queue[0] = seed; seen[seed] = 1;
    let left = width; let top = height; let right = -1; let bottom = -1;
    const enqueue = (pixel) => {
      if (seen[pixel]) return;
      seen[pixel] = 1;
      if (green(pixel)) queue[end++] = pixel;
    };
    while (start < end) {
      const pixel = queue[start++];
      const x = pixel % width; const y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
    if (end > largestCount) {
      largestCount = end;
      largest = { left, top, width: right - left + 1, height: bottom - top + 1 };
    }
  }
  return largest;
}

async function prepareFrame(name, source = path.join(sourceDir, `${name}.png`), region) {
  let image = sharp(source).rotate().ensureAlpha();
  if (region) image = image.extract(region);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const cleanup = removeBackground(data, info.width, info.height, { erodeExisting: name.startsWith("status-"), erosionSteps: region || name.startsWith("status-") ? 2 : 1 });
  const trim = pixelBounds(data, info.width, info.height, () => true);
  if (!trim) throw new Error(`${name}: source contains no visible pixels`);
  const screen = greenScreenBounds(data, info.width, info.height);
  const hasScreen = screen && screen.width > trim.width * 0.15 && screen.height > trim.height * 0.1;
  const alignHead = name.startsWith("head-") && hasScreen;
  return { name, source, region, data, info, cleanup, trim, screen, hasScreen, alignHead };
}

async function normalizeFrame(name, prepared, sharedScale) {
  const { source, region, data, info, cleanup, trim, screen, hasScreen, alignHead } = prepared ?? await prepareFrame(name);
  const scale = sharedScale ?? (alignHead
    ? Math.min(156 / screen.width, 120 / screen.height, 224 / trim.width, 232 / trim.height)
    : Math.min(224 / trim.width, 224 / trim.height));
  const width = Math.max(1, Math.round(trim.width * scale));
  const height = Math.max(1, Math.round(trim.height * scale));
  let left;
  let top;
  if (alignHead) {
    left = Math.round(128 - (screen.left - trim.left + screen.width / 2) * scale);
    top = Math.round(128 - (screen.top - trim.top + screen.height / 2) * scale);
    left = Math.max(8, Math.min(FRAME - width - 8, left));
    top = Math.max(8, Math.min(FRAME - height - 8, top));
  } else {
    left = hasScreen
      ? Math.round(128 - (screen.left - trim.left + screen.width / 2) * scale)
      : Math.round((FRAME - width) / 2);
    left = Math.max(4, Math.min(FRAME - width - 4, left));
    top = (name === "body-hop" ? 224 : name.startsWith("body-") ? 236 : 240) - height;
  }
  const normalized = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(trim).resize(width, height, { kernel: "lanczos3" }).png().toBuffer();
  const output = path.join(frameDir, `${name}.png`);
  await sharp({ create: { width: FRAME, height: FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: normalized, left, top }]).png().toFile(output);
  return {
    name, source: path.relative(webRoot, source), sourceRegion: region ?? null, output: `/brand/bot-frames-v1/${name}.png`,
    sourceSize: { width: info.width, height: info.height }, ...cleanup,
    alphaTrim: trim, greenScreenBounds: hasScreen ? screen : null,
    normalization: alignHead ? "green-screen-center" : name.startsWith("body-") ? "screen-center-and-feet-baseline" : "centered-fit",
    geometry: { left, top, width, height, scale, baseline: name.startsWith("body-") ? top + height : null },
  };
}

async function atlas(filename, rows) {
  await sharp({ create: { width: FRAME * 4, height: FRAME * 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(rows.flatMap((row, y) => row.map((name, x) => ({ input: path.join(frameDir, `${name}.png`), left: x * FRAME, top: y * FRAME }))))
    .png().toFile(path.join(brandDir, filename));
  return { path: `/brand/${filename}`, width: 1024, height: 1024, frameSize: FRAME, rows };
}

async function sequence(variant, state) {
  const source = path.join(sourceDir, `${variant}-${state === "waving" ? "wave" : state}-sequence.png`);
  try { await access(source); } catch { return null; }
  const columns = state === "thinking" ? 2 : 4;
  const rows = state === "waving" ? 3 : 2;
  const version = state === "waving" ? "v3" : "v2";
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${source}: sequence source has no dimensions`);
  const cellWidth = metadata.width / columns;
  const cellHeight = metadata.height / rows;
  // Authored wave rows drift vertically; these white gutters preserve antennas.
  const rowBoundaries = state === "waving" ? [0, 331 / 1086, 667 / 1086, 1].map(value => Math.round(value * metadata.height)) : Array.from({ length: rows + 1 }, (_, row) => Math.round(row * cellHeight));
  const prepared = [];
  for (let index = 0; index < columns * rows; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = Math.round(column * cellWidth);
    const top = rowBoundaries[row];
    const right = Math.round((column + 1) * cellWidth);
    const bottom = rowBoundaries[row + 1];
    prepared.push(await prepareFrame(`${variant}-${state}-${version}-${index}`, source, { left, top, width: right - left, height: bottom - top }));
  }
  const hashes = prepared.map((frame) => createHash("sha256").update(frame.data).digest("hex"));
  if (new Set(hashes).size !== prepared.length) throw new Error(`${source}: sequence contains duplicate cells; distinct artwork is required`);
  // One scale across the sequence prevents a raised hand or mouth shape from
  // resizing the character. Each frame then registers on its green face and feet.
  const sharedScale = Math.min(...prepared.map((frame) => Math.min(224 / frame.trim.width, (variant === "head" ? 232 : 224) / frame.trim.height)));
  const normalized = [];
  for (const frame of prepared) normalized.push(await normalizeFrame(frame.name, frame, sharedScale));
  const filename = `keatingbot-${variant}-${state}-${version}.png`;
  await sharp({ create: { width: FRAME * normalized.length, height: FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(normalized.map((frame, index) => ({ input: path.join(frameDir, `${frame.name}.png`), left: index * FRAME, top: 0 })))
    .png().toFile(path.join(brandDir, filename));
  return {
    variant, state, path: `/brand/${filename}`, width: FRAME * normalized.length, height: FRAME,
    outputSha256: createHash("sha256").update(await readFile(path.join(brandDir, filename))).digest("hex"),
    frameSize: FRAME, frameCount: normalized.length, sourceGrid: { columns, rows, cellWidth, cellHeight, rowBoundaries },
    source: path.relative(webRoot, source), sourceSha256: createHash("sha256").update(await readFile(source)).digest("hex"),
    sharedScale, frames: await Promise.all(normalized.map(async (frame, index) => ({ ...frame, index, sourceCellSha256: hashes[index], outputSha256: createHash("sha256").update(await readFile(path.join(frameDir, `${frame.name}.png`))).digest("hex") }))),
  };
}

async function statusArtwork(status) {
  const source = path.join(sourceDir, `status-${status}.png`);
  try { await access(source); } catch { return null; }
  const frame = await prepareFrame(`status-${status}`, source);
  const scale = Math.min(448 / frame.trim.width, 448 / frame.trim.height);
  const width = Math.max(1, Math.round(frame.trim.width * scale));
  const height = Math.max(1, Math.round(frame.trim.height * scale));
  const left = Math.round((512 - width) / 2);
  const top = 480 - height;
  const directory = path.join(brandDir, "bot-status-v1");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${status}.png`);
  const resized = await sharp(frame.data, { raw: { width: frame.info.width, height: frame.info.height, channels: 4 } })
    .extract(frame.trim).resize(width, height, { kernel: "lanczos3" }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left, top }]).png().toFile(filename);
  return {
    status, source: path.relative(webRoot, source), path: `/brand/bot-status-v1/${status}.png`,
    width: 512, height: 512, ...frame.cleanup, alphaTrim: frame.trim,
    geometry: { left, top, width, height, scale, baseline: 480 },
    sourceSha256: createHash("sha256").update(await readFile(source)).digest("hex"),
    outputSha256: createHash("sha256").update(await readFile(filename)).digest("hex"),
  };
}

await mkdir(frameDir, { recursive: true });
const names = [...new Set([...HEAD_ROWS.flat(), ...(headOnly ? [] : BODY_ROWS.flat())])];
const frames = [];
for (const name of names) frames.push(await normalizeFrame(name));
const head = await atlas("keatingbot-sprites-v1.png", HEAD_ROWS);
const body = headOnly ? null : await atlas("keatingbot-body-sprites-v1.png", BODY_ROWS);
const sequences = [];
for (const variant of headOnly ? ["head"] : ["head", "body"]) for (const state of ["thinking", "speaking"]) { const built = await sequence(variant, state); if (built) sequences.push(built); }
if (!headOnly) { const waving = await sequence("body", "waving"); if (waving) sequences.push(waving); }
const statuses = [];
for (const name of ["loading", "404", "403", "500"]) { const built = await statusArtwork(name); if (built) statuses.push(built); }
const manifest = { schemaVersion: 2, sourceDirectory: path.relative(webRoot, sourceDir), frameSize: FRAME, backgroundRule: "Only edge-connected pixels with min RGB >= 220 and RGB range <= 22, then one source-pixel alpha boundary erosion; existing alpha is preserved.", atlases: { head, body }, sequences, statuses, frames };
await writeFile(path.join(brandDir, "keatingbot-sprites-v1.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${frames.length} transparent frames and ${headOnly ? "one" : "two"} 1024x1024 sprite sheets, plus ${sequences.length} distinct-frame sequence strips and ${statuses.length} status images.`);
