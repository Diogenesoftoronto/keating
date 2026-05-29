import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";

export interface SourceEdit {
  file: string;
  search: string;
  replace: string;
  reason: string;
}

export interface EditResult {
  success: boolean;
  file: string;
  message: string;
  diff?: {
    linesRemoved: number;
    linesAdded: number;
    charDelta: number;
  };
}

export interface EditBatchResult {
  results: EditResult[];
  rollbackSnapshots: Map<string, string>;
}

/**
 * Apply a single search/replace edit to a source file.
 * The search block must match exactly (including whitespace).
 */
export async function applySourceEdit(
  cwd: string,
  edit: SourceEdit,
  backupDir?: string
): Promise<EditResult> {
  const filePath = join(cwd, edit.file);

  let original: string;
  try {
    original = await readFile(filePath, "utf8");
  } catch (error) {
    return {
      success: false,
      file: edit.file,
      message: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const searchNormalized = edit.search.replace(/\r\n/g, "\n");
  const contentNormalized = original.replace(/\r\n/g, "\n");

  if (!contentNormalized.includes(searchNormalized)) {
    return {
      success: false,
      file: edit.file,
      message:
        `Search block not found in file. Ensure the search text matches exactly, including ` +
        `indentation and newlines. File: ${edit.file}`,
    };
  }

  // Count occurrences
  const occurrences = contentNormalized.split(searchNormalized).length - 1;
  if (occurrences > 1) {
    return {
      success: false,
      file: edit.file,
      message:
        `Search block appears ${occurrences} times in the file. ` +
        `Edit rejected for safety — include more surrounding context to make the search unique.`,
    };
  }

  const nextContent = contentNormalized.replace(searchNormalized, edit.replace);

  // Create backup if requested
  if (backupDir) {
    const backupPath = join(backupDir, edit.file.replace(/[/\\]/g, "__"));
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, original, "utf8");
  }

  await writeFile(filePath, nextContent, "utf8");

  const linesRemoved = searchNormalized.split("\n").length;
  const linesAdded = edit.replace.split("\n").length;

  return {
    success: true,
    file: edit.file,
    message: `Edited ${edit.file}: ${linesRemoved} lines removed, ${linesAdded} lines added. Reason: ${edit.reason}`,
    diff: {
      linesRemoved,
      linesAdded,
      charDelta: edit.replace.length - searchNormalized.length,
    },
  };
}

/**
 * Apply multiple edits in sequence.
 * If any edit fails, returns immediately with rollback info for the edits that succeeded.
 */
export async function applySourceEdits(
  cwd: string,
  edits: SourceEdit[],
  backupDir?: string
): Promise<EditBatchResult> {
  const results: EditResult[] = [];
  const rollbackSnapshots = new Map<string, string>();

  for (const edit of edits) {
    // Read current content for snapshot (in case prior edit touched the same file)
    const filePath = join(cwd, edit.file);
    let currentContent: string;
    try {
      currentContent = await readFile(filePath, "utf8");
    } catch {
      // File doesn't exist — snapshot is empty
      currentContent = "";
    }

    // Store snapshot keyed by file path for rollback
    if (!rollbackSnapshots.has(edit.file)) {
      rollbackSnapshots.set(edit.file, currentContent);
    }

    const result = await applySourceEdit(cwd, edit, backupDir);
    results.push(result);

    if (!result.success) {
      break;
    }
  }

  return { results, rollbackSnapshots };
}

/**
 * Rollback files to their pre-edit state.
 */
export async function rollbackEdits(
  cwd: string,
  snapshots: Map<string, string>
): Promise<void> {
  for (const [file, content] of snapshots) {
    const filePath = join(cwd, file);
    await writeFile(filePath, content, "utf8");
  }
}

/**
 * Format an edit result as human-readable markdown.
 */
export function editResultToMarkdown(results: EditResult[]): string {
  const lines = ["# Source Edit Report", ""];

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  lines.push(`- Succeeded: ${succeeded.length}`);
  lines.push(`- Failed: ${failed.length}`);
  lines.push("");

  if (succeeded.length > 0) {
    lines.push("## Applied Changes");
    lines.push("");
    for (const r of succeeded) {
      lines.push(`- **${r.file}** — ${r.message}`);
      if (r.diff) {
        lines.push(
          `  - Δ ${r.diff.charDelta >= 0 ? "+" : ""}${r.diff.charDelta} chars, ` +
            `${r.diff.linesRemoved}→${r.diff.linesAdded} lines`
        );
      }
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const r of failed) {
      lines.push(`- **${r.file}** — ${r.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
