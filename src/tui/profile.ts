import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { stateDir } from "../core/paths.js";

import { Jimp } from "jimp";

import type { TerminalGlyphMode } from "./design-contract.js";
import {
  sacredInitialsFor,
  sacredSanitizeText,
  sacredTruncateText,
} from "./sacred.js";

export type TuiAvatarKind = "initials" | "learner" | "custom";

export interface TuiProfile {
  schemaVersion: 1;
  displayName: string;
  avatar: {
    kind: TuiAvatarKind;
    initials?: string;
    path?: string;
  };
}

export interface TerminalAvatar {
  unicode: readonly [string, string];
  ascii: readonly [string, string];
}

export interface AvatarBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export const DEFAULT_TUI_PROFILE: TuiProfile = {
  schemaVersion: 1,
  displayName: "Learner",
  avatar: { kind: "initials", initials: "ME" },
};

export const KEATINGBOT_TERMINAL_AVATAR: TerminalAvatar = {
  unicode: ["╭◉⌒╮", "╰╥╥╯"],
  ascii: ["[oo]", "|__|"],
};

/** Generated learner artwork distilled into Sacred's exact 4ch × 2-row slot. */
export const LEARNER_TERMINAL_AVATAR: TerminalAvatar = {
  unicode: ["⣴⣿⣿⣦", "⠘⢿⡿⠃"],
  ascii: ["/##\\", " /\\ "],
};

const MAX_CUSTOM_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOM_AVATAR_DIMENSION = 4096;
const MAX_CUSTOM_AVATAR_PIXELS = 4 * 1024 * 1024;
const CUSTOM_AVATAR_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff"]);
const BRAILLE_LEFT = [0x01, 0x02, 0x04, 0x40] as const;
const BRAILLE_RIGHT = [0x08, 0x10, 0x20, 0x80] as const;

export function tuiProfilePath(cwd: string): string {
  return join(stateDir(cwd), "tui-profile.json");
}

function cleanText(value: unknown, fallback: string, maximum = 80): string {
  if (typeof value !== "string") return fallback;
  const compact = sacredSanitizeText(value);
  return compact ? sacredTruncateText(compact, maximum) : fallback;
}

function cleanInitials(value: unknown, displayName: string): string {
  const supplied = typeof value === "string" ? value : undefined;
  return sacredInitialsFor(displayName, supplied).trimEnd() || "ME";
}

export function normalizeTuiProfile(value: unknown): TuiProfile {
  const parsed = value && typeof value === "object" ? value as Partial<TuiProfile> : {};
  const displayName = cleanText(parsed.displayName, DEFAULT_TUI_PROFILE.displayName);
  const avatar: Partial<TuiProfile["avatar"]> = parsed.avatar && typeof parsed.avatar === "object"
    ? parsed.avatar
    : {};
  const kind: TuiAvatarKind = avatar.kind === "learner" || avatar.kind === "custom" ? avatar.kind : "initials";
  const path = kind === "custom" && typeof avatar.path === "string" && avatar.path.trim()
    ? avatar.path.trim()
    : undefined;
  if (kind === "custom" && !path) {
    return { schemaVersion: 1, displayName, avatar: { kind: "initials", initials: cleanInitials(avatar.initials, displayName) } };
  }
  return {
    schemaVersion: 1,
    displayName,
    avatar: {
      kind,
      ...(kind === "initials" ? { initials: cleanInitials(avatar.initials, displayName) } : {}),
      ...(path ? { path } : {}),
    },
  };
}

export async function loadTuiProfile(cwd: string): Promise<TuiProfile> {
  try {
    return normalizeTuiProfile(JSON.parse(await readFile(tuiProfilePath(cwd), "utf8")));
  } catch {
    return normalizeTuiProfile(DEFAULT_TUI_PROFILE);
  }
}

export async function saveTuiProfile(cwd: string, profile: TuiProfile): Promise<void> {
  const path = tuiProfilePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalizeTuiProfile(profile), null, 2)}\n`, "utf8");
}

interface ImageDimensions {
  width: number;
  height: number;
}

function bytesEqual(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => data[offset + index] === byte);
}

function uint16(data: Uint8Array, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 2 > data.length) return null;
  return littleEndian
    ? (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
    : ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function uint32(data: Uint8Array, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 4 > data.length) return null;
  if (littleEndian) {
    return (
      (data[offset] ?? 0)
      + (data[offset + 1] ?? 0) * 0x100
      + (data[offset + 2] ?? 0) * 0x1_0000
      + (data[offset + 3] ?? 0) * 0x100_0000
    );
  }
  return (
    (data[offset] ?? 0) * 0x100_0000
    + (data[offset + 1] ?? 0) * 0x1_0000
    + (data[offset + 2] ?? 0) * 0x100
    + (data[offset + 3] ?? 0)
  );
}

function signed32(value: number): number {
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value;
}

function jpegDimensions(data: Uint8Array): ImageDimensions | null {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 1 < data.length) {
    while (offset < data.length && data[offset] !== 0xff) offset += 1;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = uint16(data, offset, false);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) return null;
      const height = uint16(data, offset + 3, false);
      const width = uint16(data, offset + 5, false);
      return width !== null && height !== null ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function skipGifSubBlocks(data: Uint8Array, start: number): number | null {
  let offset = start;
  while (offset < data.length) {
    const size = data[offset] ?? 0;
    offset += 1;
    if (size === 0) return offset;
    if (offset + size > data.length) return null;
    offset += size;
  }
  return null;
}

function gifDimensions(data: Uint8Array): ImageDimensions | null {
  const screenWidth = uint16(data, 6, true);
  const screenHeight = uint16(data, 8, true);
  if (screenWidth === null || screenHeight === null || data.length < 13) return null;
  const packed = data[10] ?? 0;
  let offset = 13 + ((packed & 0x80) !== 0 ? 3 * (2 ** ((packed & 0x07) + 1)) : 0);
  let width = screenWidth;
  let height = screenHeight;
  while (offset < data.length) {
    const marker = data[offset];
    offset += 1;
    if (marker === 0x3b) return { width, height };
    if (marker === 0x21) {
      if (offset >= data.length) return null;
      offset += 1;
      const next = skipGifSubBlocks(data, offset);
      if (next === null) return null;
      offset = next;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > data.length) return null;
    const frameWidth = uint16(data, offset + 4, true);
    const frameHeight = uint16(data, offset + 6, true);
    if (frameWidth === null || frameHeight === null) return null;
    width = Math.max(width, frameWidth);
    height = Math.max(height, frameHeight);
    const framePacked = data[offset + 8] ?? 0;
    offset += 9;
    if ((framePacked & 0x80) !== 0) offset += 3 * (2 ** ((framePacked & 0x07) + 1));
    if (offset >= data.length) return null;
    offset += 1; // LZW minimum code size.
    const next = skipGifSubBlocks(data, offset);
    if (next === null) return null;
    offset = next;
  }
  return null;
}

function tiffDimensions(data: Uint8Array): ImageDimensions | null {
  const littleEndian = bytesEqual(data, 0, [0x49, 0x49]);
  if (!littleEndian && !bytesEqual(data, 0, [0x4d, 0x4d])) return null;
  if (uint16(data, 2, littleEndian) !== 42) return null;
  const ifdOffset = uint32(data, 4, littleEndian);
  if (ifdOffset === null) return null;
  const entryCount = uint16(data, ifdOffset, littleEndian);
  if (entryCount === null || ifdOffset + 2 + entryCount * 12 > data.length) return null;
  let width: number | null = null;
  let height: number | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = uint16(data, entryOffset, littleEndian);
    if (tag !== 256 && tag !== 257) continue;
    const type = uint16(data, entryOffset + 2, littleEndian);
    const count = uint32(data, entryOffset + 4, littleEndian);
    if (count !== 1) continue;
    const value = type === 3
      ? uint16(data, entryOffset + 8, littleEndian)
      : type === 4 ? uint32(data, entryOffset + 8, littleEndian) : null;
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  return width !== null && height !== null ? { width, height } : null;
}

function encodedImageDimensions(data: Uint8Array): ImageDimensions | null {
  if (bytesEqual(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    && uint32(data, 8, false) === 13
    && bytesEqual(data, 12, [0x49, 0x48, 0x44, 0x52])) {
    const width = uint32(data, 16, false);
    const height = uint32(data, 20, false);
    return width !== null && height !== null ? { width, height } : null;
  }
  if (bytesEqual(data, 0, [0x47, 0x49, 0x46, 0x38]) && (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) {
    return gifDimensions(data);
  }
  if (bytesEqual(data, 0, [0x42, 0x4d])) {
    const dibSize = uint32(data, 14, true);
    if (dibSize === 12) {
      const width = uint16(data, 18, true);
      const height = uint16(data, 20, true);
      return width !== null && height !== null ? { width, height } : null;
    }
    if (dibSize !== null && dibSize >= 40) {
      const rawWidth = uint32(data, 18, true);
      const rawHeight = uint32(data, 22, true);
      return rawWidth !== null && rawHeight !== null
        ? { width: signed32(rawWidth), height: Math.abs(signed32(rawHeight)) }
        : null;
    }
  }
  if (bytesEqual(data, 0, [0xff, 0xd8])) return jpegDimensions(data);
  return tiffDimensions(data);
}

function assertSafeAvatarDimensions(dimensions: ImageDimensions | null): asserts dimensions is ImageDimensions {
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
    || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error("That avatar image could not be decoded.");
  }
  if (dimensions.width > MAX_CUSTOM_AVATAR_DIMENSION || dimensions.height > MAX_CUSTOM_AVATAR_DIMENSION) {
    throw new Error(`Custom TUI avatars must be at most ${MAX_CUSTOM_AVATAR_DIMENSION} pixels on either side.`);
  }
  if (dimensions.width > MAX_CUSTOM_AVATAR_PIXELS / dimensions.height) {
    throw new Error(`Custom TUI avatars must contain at most ${MAX_CUSTOM_AVATAR_PIXELS} decoded pixels.`);
  }
}

type DecodedAvatar = Awaited<ReturnType<typeof Jimp.read>>;

async function loadCustomAvatar(cwd: string, input: string): Promise<{ path: string; image: DecodedAvatar }> {
  const candidate = input.trim();
  if (!candidate) throw new Error("Choose a local PNG, JPEG, GIF, BMP, or TIFF image.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    throw new Error("Custom TUI avatars must be local files; web URLs are not opened.");
  }
  const path = resolve(cwd, candidate.startsWith("~/") ? join(homedir(), candidate.slice(2)) : candidate);
  if (!CUSTOM_AVATAR_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new Error("Custom TUI avatars support PNG, JPEG, GIF, BMP, and TIFF files.");
  }
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new Error("That avatar image is not a readable file.");
  if (metadata.size > MAX_CUSTOM_AVATAR_BYTES) throw new Error("Custom TUI avatars must be 5 MiB or smaller.");
  const encoded = await readFile(path);
  if (encoded.byteLength > MAX_CUSTOM_AVATAR_BYTES) throw new Error("Custom TUI avatars must be 5 MiB or smaller.");
  assertSafeAvatarDimensions(encodedImageDimensions(encoded));
  const image = await Jimp.read(encoded).catch(() => {
    throw new Error("That avatar image could not be decoded.");
  });
  assertSafeAvatarDimensions({ width: image.bitmap.width, height: image.bitmap.height });
  return { path, image };
}

/** Resolve only local, bounded image files; URLs are never fetched by the terminal. */
export async function validateCustomAvatarPath(cwd: string, input: string): Promise<string> {
  return (await loadCustomAvatar(cwd, input)).path;
}

function sampleLuminance(bitmap: AvatarBitmap, normalizedX: number, normalizedY: number): number {
  const size = Math.min(bitmap.width, bitmap.height);
  const offsetX = Math.floor((bitmap.width - size) / 2);
  const offsetY = Math.floor((bitmap.height - size) / 2);
  let total = 0;
  let samples = 0;
  for (const deltaY of [-0.24, 0, 0.24]) {
    for (const deltaX of [-0.24, 0, 0.24]) {
      const x = Math.min(size - 1, Math.max(0, Math.floor((normalizedX + deltaX / 8) * size)));
      const y = Math.min(size - 1, Math.max(0, Math.floor((normalizedY + deltaY / 8) * size)));
      const index = ((offsetY + y) * bitmap.width + offsetX + x) * 4;
      const red = bitmap.data[index] ?? 0;
      const green = bitmap.data[index + 1] ?? 0;
      const blue = bitmap.data[index + 2] ?? 0;
      const alpha = (bitmap.data[index + 3] ?? 255) / 255;
      total += (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha;
      samples += 1;
    }
  }
  return total / Math.max(1, samples);
}

/** Mechanically rasterize a centered square crop into 2×4-dot Braille cells. */
export function bitmapToTerminalAvatar(bitmap: AvatarBitmap): TerminalAvatar {
  if (bitmap.width < 1 || bitmap.height < 1 || bitmap.data.length < bitmap.width * bitmap.height * 4) {
    throw new Error("The avatar image has no readable pixels.");
  }
  const luminance = Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => sampleLuminance(bitmap, (x + 0.5) / 8, (y + 0.5) / 8))
  );
  const values = luminance.flat();
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const cornerMean = [luminance[0]?.[0], luminance[0]?.[7], luminance[7]?.[0], luminance[7]?.[7]]
    .reduce((sum, value) => sum + (value ?? mean), 0) / 4;
  const threshold = minimum + (maximum - minimum) * 0.48;
  const lightForeground = cornerMean < mean;
  const active = (value: number): boolean => maximum - minimum >= 8
    && (lightForeground ? value >= threshold : value <= threshold);

  const unicodeRows: string[] = [];
  const asciiRows: string[] = [];
  const densityGlyphs = " .:*#";
  for (let cellY = 0; cellY < 2; cellY += 1) {
    let unicode = "";
    let ascii = "";
    for (let cellX = 0; cellX < 4; cellX += 1) {
      let bits = 0;
      let activeDots = 0;
      for (let dotY = 0; dotY < 4; dotY += 1) {
        const left = active(luminance[cellY * 4 + dotY]?.[cellX * 2] ?? mean);
        const right = active(luminance[cellY * 4 + dotY]?.[cellX * 2 + 1] ?? mean);
        if (left) {
          bits |= BRAILLE_LEFT[dotY]!;
          activeDots += 1;
        }
        if (right) {
          bits |= BRAILLE_RIGHT[dotY]!;
          activeDots += 1;
        }
      }
      unicode += String.fromCodePoint(0x2800 + bits);
      ascii += densityGlyphs[Math.min(densityGlyphs.length - 1, Math.round(activeDots / 2))]!;
    }
    unicodeRows.push(unicode);
    asciiRows.push(ascii);
  }
  return {
    unicode: [unicodeRows[0]!, unicodeRows[1]!],
    ascii: [asciiRows[0]!, asciiRows[1]!],
  };
}

function initialsAvatar(displayName: string, initials?: string): TerminalAvatar {
  const letters = sacredInitialsFor(displayName, initials);
  return {
    unicode: [`┌${letters}┐`, "└──┘"],
    ascii: [`[${letters}]`, "+--+"],
  };
}

export async function terminalAvatarForProfile(profile: TuiProfile, cwd = process.cwd()): Promise<TerminalAvatar> {
  if (profile.avatar.kind === "learner") return LEARNER_TERMINAL_AVATAR;
  if (profile.avatar.kind !== "custom" || !profile.avatar.path) {
    return initialsAvatar(profile.displayName, profile.avatar.initials);
  }
  try {
    const { image } = await loadCustomAvatar(cwd, profile.avatar.path);
    return bitmapToTerminalAvatar(image.bitmap);
  } catch {
    return initialsAvatar(profile.displayName, profile.avatar.initials);
  }
}

export function avatarLinesForMode(avatar: TerminalAvatar, glyphMode: TerminalGlyphMode): readonly [string, string] {
  return glyphMode === "ascii" ? avatar.ascii : avatar.unicode;
}
