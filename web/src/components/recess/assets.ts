import { HABIT_KIT } from "../../keating/habits/quest-catalog";
import blasters from "../habits/art/kit-blasters.webp?url";
import packs from "../habits/art/kit-packs.webp?url";
import toppers from "../habits/art/kit-toppers.webp?url";
import manifest from "./art-manifest.json";
import type { RecessBotArt } from "./types";

const files = import.meta.glob<string>("./art/*.webp", { query: "?url&no-inline", import: "default", eager: true });
const url = (name: string) => files[`./art/${name}`];
export const sittingBot = url(manifest.sit);

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A Recess sprite did not load."));
    image.src = src;
  }).catch((error: unknown) => {
    if (imageCache.get(src) === loading) imageCache.delete(src);
    throw error;
  });
  imageCache.set(src, loading);
  if (imageCache.size > 32) {
    const earliest = imageCache.keys().next().value;
    if (earliest) imageCache.delete(earliest);
  }
  return loading;
}

type Cast = keyof typeof manifest.toys;
function findCast(value: string): Cast | undefined {
  if (Object.hasOwn(manifest.toys, value)) return value as Cast;
  if (["french", "japanese", "spanish"].includes(value)) return "languages";
  return undefined;
}

async function loadToy(key: string): Promise<RecessBotArt["toy"]> {
  const cast = findCast(key);
  if (!cast) return null;
  const { src, ...art } = manifest.toys[cast];
  const img = await loadImage(url(src)).catch(() => null);
  if (!img) return null;
  const poses = await Promise.all(Object.entries(manifest.poses[cast]).map(async ([role, path]) => {
    const pose = await loadImage(url(path)).catch(() => null);
    return pose ? [[role, pose] as const] : [];
  }));
  return { ...art, img, cast, poses: Object.fromEntries(poses.flat()) };
}

const kitSheets = { blasters, packs, toppers };

async function loadEquipment(ids: readonly string[]): Promise<RecessBotArt["equipment"]> {
  const selected = HABIT_KIT.filter(piece =>
    piece.parts > 0 && piece.art && ids.includes(piece.id)
    && (piece.slot === "topper" || piece.slot === "pack" || piece.slot === "blaster"));
  const sprites = await Promise.all(selected.map(async ({ art, slot }) => {
    if (!art) return [];
    const image = await loadImage(kitSheets[art.sheet]).catch(() => null);
    return image ? [[slot, { image, cell: art.cell }] as const] : [];
  }));
  return Object.fromEntries(sprites.flat());
}

export async function loadRecessArt(cast: string, toy: boolean, kit: readonly string[]): Promise<RecessBotArt> {
  const [sheet, flip, selectedToy, equipment] = await Promise.all([
    loadImage(url(manifest.sheet)),
    loadImage(url(manifest.fx.src)).then(img => ({ img, rows: manifest.fx.rows, cell: manifest.fx.cell })).catch(() => null),
    toy ? loadToy(cast) : Promise.resolve(null),
    loadEquipment(kit),
  ]);
  return { sheet, flip, toy: selectedToy, equipment, keycapBoots: kit.includes("keyboots"), rows: manifest.rows, hasJetpack: manifest.hasJetpack };
}
