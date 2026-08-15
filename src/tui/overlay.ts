export type OverlayResponseTone = "accent" | "success" | "warning" | "danger" | "info" | "mutedText";

/**
 * Bound one piece of terminal chrome without changing the underlying value.
 * The caller can therefore show an ellipsis while still returning the exact
 * command, model, answer, or path selected by the learner.
 */
export function truncateOverlayLabel(value: string, width: number): string {
  const limit = Math.max(1, Math.floor(width));
  const glyphs = [...value.replace(/\s+/g, " ").trim()];
  if (glyphs.length <= limit) return glyphs.join("");
  if (limit === 1) return "…";
  return `${glyphs.slice(0, limit - 1).join("")}…`;
}

/** Wrap an overlay heading, then visibly mark vertical truncation. */
export function overlayTitleLines(value: string, width: number, maxLines = 2): string[] {
  const lineWidth = Math.max(1, Math.floor(width));
  const lineLimit = Math.max(1, Math.floor(maxLines));
  const sourceLines = value.replace(/\r\n?/g, "\n").split("\n");
  const words = sourceLines.flatMap((line, index) => [
    ...line.trim().split(/\s+/).filter(Boolean),
    ...(index < sourceLines.length - 1 ? ["\n"] : []),
  ]);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word === "\n") {
      if (current) lines.push(current);
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if ([...candidate].length <= lineWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = truncateOverlayLabel(word, lineWidth);
    if ([...word].length > lineWidth) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);

  if (lines.length <= lineLimit) return lines;
  const visible = lines.slice(0, lineLimit);
  const last = visible.at(-1) ?? "";
  visible[visible.length - 1] = truncateOverlayLabel(`${last}…`, lineWidth);
  return visible;
}

/** Keep familiar response labels while using color as a secondary cue. */
export function overlayResponseTone(label: string): OverlayResponseTone {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  if (/^(yes\b|3\s*[·.)-]|easy\b)/.test(normalized)) return "success";
  if (/^(no\b|0\s*[·.)-]|again\b)/.test(normalized) || /\b(delete|trash|reject)\b/.test(normalized)) return "danger";
  if (/^(1\s*[·.)-]|hard\b)/.test(normalized)) return "warning";
  if (/^(2\s*[·.)-]|good\b)/.test(normalized)) return "info";
  if (/^(cancel|close)\b/.test(normalized)) return "mutedText";
  return "accent";
}
