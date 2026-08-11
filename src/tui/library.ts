import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

import { listArtifacts } from "../core/project.js";
import { exportsDir, outputsDir, stateDir } from "../core/paths.js";

const MAX_PREVIEW_BYTES = 512 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".mmd", ".txt", ".json", ".jsonl", ".csv", ".tsv", ".html", ".svg", ".typ"]);

export interface TuiLibraryArtifact {
  label: string;
  path: string;
  kind: "text" | "media" | "binary";
}

export type TuiArtifactPreview =
  | { kind: "text"; path: string; content: string; sourceOnly: boolean }
  | { kind: "handoff"; path: string; message: string };

function absoluteArtifactPath(cwd: string, artifactPath: string): string {
  const root = resolve(outputsDir(cwd));
  const target = resolve(cwd, artifactPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("The selected artifact is outside Keating's output library.");
  }
  return target;
}

async function regularArtifact(cwd: string, artifactPath: string): Promise<{ path: string; size: number }> {
  const path = absoluteArtifactPath(cwd, artifactPath);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The selected artifact must be a regular, non-symlink file.");
  }
  return { path, size: metadata.size };
}

function artifactKind(path: string): TuiLibraryArtifact["kind"] {
  const extension = extname(path).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".wav", ".mp4", ".webm"].includes(extension)) return "media";
  return "binary";
}

export async function listTuiLibraryArtifacts(cwd: string): Promise<TuiLibraryArtifact[]> {
  return (await listArtifacts(cwd)).map((artifact) => ({ ...artifact, kind: artifactKind(artifact.path) }));
}

export function libraryArtifactOption(artifact: TuiLibraryArtifact, index: number): string {
  return `${index + 1}. ${artifact.label} · ${artifact.kind}`;
}

export async function previewTuiArtifact(cwd: string, artifactPath: string): Promise<TuiArtifactPreview> {
  const artifact = await regularArtifact(cwd, artifactPath);
  const kind = artifactKind(artifact.path);
  if (kind !== "text") {
    return { kind: "handoff", path: artifactPath, message: `Terminal preview is unavailable for this ${kind} file. Its saved path is preserved for web, desktop, or /shell.` };
  }
  if (artifact.size > MAX_PREVIEW_BYTES) {
    return { kind: "handoff", path: artifactPath, message: `This text artifact is ${Math.ceil(artifact.size / 1024)}KB, above the 512KB terminal preview limit. Open the preserved path through /shell.` };
  }
  const extension = extname(artifact.path).toLowerCase();
  return {
    kind: "text",
    path: artifactPath,
    content: await readFile(artifact.path, "utf8"),
    sourceOnly: extension === ".html" || extension === ".svg",
  };
}

export async function exportTuiArtifact(cwd: string, artifactPath: string): Promise<string> {
  const artifact = await regularArtifact(cwd, artifactPath);
  const directory = exportsDir(cwd);
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${basename(artifact.path)}`);
  await copyFile(artifact.path, target, constants.COPYFILE_EXCL);
  return relative(cwd, target);
}

/** Recoverable delete: artifacts move to an owner-local project trash directory. */
export async function trashTuiArtifact(cwd: string, artifactPath: string): Promise<string> {
  const artifact = await regularArtifact(cwd, artifactPath);
  const directory = join(stateDir(cwd), "trash");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${basename(artifact.path)}`);
  await rename(artifact.path, target);
  return relative(cwd, target);
}
