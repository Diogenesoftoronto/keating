import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const filmPath = "public/tapes/keating-spotlight-live.mp4";
export const restoreMarker = "staging-spotlight-film.sha256";
export const filmSha256 = "63a6b4c7445045ab8ca05114e9bf9dc1b07f17f0bbf7c316bb0ae8ac2cc11f97";
const filmUrl = "https://raw.githubusercontent.com/Diogenesoftoronto/keating/5fe12dbd70c7894b7efda363cb501189d8b701cb/web/" + filmPath;

/** The packer writes the marker only when the snapshot contains this exact film. */
export async function restoreStagingFilm(webRoot: string, get: (url: string) => Promise<Response> = fetch) {
  const marker = join(webRoot, restoreMarker);
  const pointer = Bun.file(marker);
  if (!await pointer.exists()) return;
  if ((await pointer.text()).trim() !== filmSha256) throw new Error("Unexpected staging film digest");
  const response = await get(filmUrl);
  if (!response.ok) throw new Error(`Staging film download returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== filmSha256) throw new Error("Staging film checksum mismatch");
  const file = join(webRoot, filmPath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + ".tmp", bytes, { mode: 0o644 });
  await rename(file + ".tmp", file);
  await rm(marker);
}

if (import.meta.main) await restoreStagingFilm(process.cwd());
