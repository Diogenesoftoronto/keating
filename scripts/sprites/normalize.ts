#!/usr/bin/env bun
/**
 * Normalise a generated stop-motion sheet into a shippable sprite atlas.
 *
 * Image generation does not hold a character at a constant size or baseline
 * across eight cells. Left alone, that drift plays back as a jitter: the
 * character jumps closer and lower halfway through the loop, because
 * `steps(1, end)` shows each cell exactly as drawn. Rather than trying to
 * prompt the drift away, this measures each frame's content box and registers
 * all eight against a common reference, so an imperfect generation still
 * yields a clean loop.
 *
 * Output is always 1024x512 with 256x256 cells in four columns and two rows,
 * row-major, matching `keatingBotFramePosition` in KeatingBot.tsx.
 *
 *   bun scripts/sprites/normalize.ts <input> --state greeting --variant body
 *   bun scripts/sprites/normalize.ts <input> --out /tmp/check.avif --anchor none
 */
import { $ } from "bun";
import { basename, join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const ATLAS_WIDTH = 1024;
const ATLAS_HEIGHT = 512;
const COLUMNS = 4;
const ROWS = 2;
const FRAMES = COLUMNS * ROWS;
const CELL = ATLAS_WIDTH / COLUMNS; // 256, and equal to ATLAS_HEIGHT / ROWS

/** Content is placed this fraction of the cell above the bottom edge. */
const BASELINE_PADDING = 0.06;
/** Content is scaled to at most this fraction of the cell, matching the shipped atlases. */
const MAX_CONTENT_FRACTION = 0.92;

interface Box { readonly width: number; readonly height: number; readonly x: number; readonly y: number }

export interface SpriteNormalizeOptions {
  readonly input: string;
  readonly out: string;
  readonly anchor: "bottom-center" | "none";
  /** Colour distance treated as background when keying white out. */
  readonly fuzz: number;
  /** Skip the white key when the source already carries alpha. */
  readonly keepAlpha: boolean;
  readonly quality: number;
}

function parseArgs(argv: readonly string[]): SpriteNormalizeOptions {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split("=", 2);
    flags.set(name!, inline ?? (argv[index + 1]?.startsWith("--") === false ? argv[++index]! : "true"));
  }
  const input = positional[0];
  if (!input) throw new Error("usage: normalize.ts <input> [--state <state> --variant body|head] [--out <path>]");

  const state = flags.get("state");
  const variant = flags.get("variant") ?? "body";
  const out = flags.get("out")
    ?? (state ? `web/public/brand/stop-motion-v1/keatingbot-${variant}-${state}.avif` : null)
    ?? `${basename(input).replace(/\.[^.]+$/u, "")}.avif`;
  if (variant !== "body" && variant !== "head") throw new Error(`--variant must be body or head, got ${variant}`);

  const anchor = flags.get("anchor") === "none" ? "none" : "bottom-center";
  return {
    input: resolve(input),
    out: resolve(out),
    anchor,
    fuzz: Number(flags.get("fuzz") ?? 8),
    keepAlpha: flags.get("keep-alpha") === "true",
    quality: Number(flags.get("quality") ?? 82),
  };
}

/** `%@` reports the trim box as WxH+X+Y, relative to the image it was measured on. */
function parseBox(value: string): Box | null {
  const match = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/u.exec(value.trim());
  if (!match) return null;
  const [, width, height, x, y] = match;
  return { width: Number(width), height: Number(height), x: Number(x), y: Number(y) };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

async function hasAlpha(path: string): Promise<boolean> {
  const channels = (await $`magick identify -format "%[channels]" ${path}`.text()).trim();
  return channels.includes("a");
}

export async function normalizeSheet(options: SpriteNormalizeOptions): Promise<void> {
  const { input, out } = options;
  const size = (await $`magick identify -format "%wx%h" ${input}`.text()).trim();
  const [sheetWidth, sheetHeight] = size.split("x").map(Number) as [number, number];
  if (!sheetWidth || !sheetHeight) throw new Error(`could not read dimensions of ${input}`);

  const sourceAlpha = await hasAlpha(input);
  const keyWhite = !options.keepAlpha && !sourceAlpha;
  const cellWidth = Math.floor(sheetWidth / COLUMNS);
  const cellHeight = Math.floor(sheetHeight / ROWS);

  const work = await mkdtemp(join(tmpdir(), "keating-sprite-"));
  try {
    // 1. Split into cells, keying white to alpha first so trimming measures the
    //    character rather than the background it was drawn on.
    const cells: string[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      const column = frame % COLUMNS;
      const row = Math.floor(frame / COLUMNS);
      const cell = join(work, `cell-${frame}.png`);
      const geometry = `${cellWidth}x${cellHeight}+${column * cellWidth}+${row * cellHeight}`;
      if (keyWhite) {
        await $`magick ${input} -crop ${geometry} +repage -fuzz ${`${options.fuzz}%`} -transparent white ${cell}`.quiet();
      } else {
        await $`magick ${input} -crop ${geometry} +repage ${cell}`.quiet();
      }
      cells.push(cell);
    }

    // 2. Measure each frame's content box.
    const boxes: Box[] = [];
    for (const cell of cells) {
      const raw = (await $`magick ${cell} -format "%@" info:`.text()).trim();
      const box = parseBox(raw);
      if (!box || box.width === 0 || box.height === 0) {
        throw new Error(`frame ${cells.indexOf(cell)} has no visible content (trim box ${raw || "empty"})`);
      }
      boxes.push(box);
    }

    // 3. One reference for all eight frames. The median resists a single
    //    badly-drawn cell in a way that the mean and the extremes do not.
    const referenceHeight = median(boxes.map(box => box.height));
    const maxContent = CELL * MAX_CONTENT_FRACTION;
    const baseline = Math.round(CELL * (1 - BASELINE_PADDING));

    // 4. Rebuild each cell at 256x256, registered against that reference.
    const placed: string[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      const box = boxes[frame]!;
      const cell = cells[frame]!;
      const target = join(work, `placed-${frame}.png`);
      // Scale so every frame's content matches the reference height, then cap
      // so the widest frame still fits the cell.
      const toReference = referenceHeight / box.height;
      const scaled = { width: box.width * toReference, height: referenceHeight };
      const fit = Math.min(1, maxContent / Math.max(scaled.width, scaled.height));
      const width = Math.max(1, Math.round(scaled.width * fit));
      const height = Math.max(1, Math.round(scaled.height * fit));

      const offset = options.anchor === "bottom-center"
        ? { x: Math.round((CELL - width) / 2), y: Math.max(0, baseline - height) }
        : {
          x: Math.round((box.x / cellWidth) * CELL),
          y: Math.round((box.y / cellHeight) * CELL),
        };

      await $`magick ${cell} -crop ${`${box.width}x${box.height}+${box.x}+${box.y}`} +repage \
        -resize ${`${width}x${height}!`} \
        -background none -extent ${`${CELL}x${CELL}-${offset.x}-${offset.y}`} \
        ${target}`.quiet();
      placed.push(target);
    }

    // 5. Composite row-major and encode.
    await $`magick montage ${placed} -tile ${`${COLUMNS}x${ROWS}`} -geometry ${`${CELL}x${CELL}+0+0`} \
      -background none PNG32:${join(work, "atlas.png")}`.quiet();
    await $`magick ${join(work, "atlas.png")} -resize ${`${ATLAS_WIDTH}x${ATLAS_HEIGHT}!`} \
      -quality ${options.quality} ${out}`.quiet();

    const finalSize = (await $`magick identify -format "%wx%h" ${out}`.text()).trim();
    if (finalSize !== `${ATLAS_WIDTH}x${ATLAS_HEIGHT}`) throw new Error(`expected ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, produced ${finalSize}`);
    console.log(`${basename(out)}  ${finalSize}  from ${size}  reference content height ${Math.round(referenceHeight)}px  ${keyWhite ? "white keyed" : "alpha preserved"}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await normalizeSheet(parseArgs(Bun.argv.slice(2)));
}
