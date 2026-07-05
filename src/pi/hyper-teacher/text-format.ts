const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

export function truncateVisible(text: string, width: number): string {
  const limit = Math.max(0, width);
  if (visibleWidth(text) <= limit) return text;
  if (limit === 0) return "";

  const suffix = limit > 1 ? "…" : "";
  const contentLimit = Math.max(0, limit - visibleWidth(suffix));
  let visible = 0;
  let output = "";

  for (let index = 0; index < text.length;) {
    const ansi = text.slice(index).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
    if (ansi) {
      output += ansi[0];
      index += ansi[0].length;
      continue;
    }

    if (visible >= contentLimit) break;
    output += text[index];
    visible += 1;
    index += 1;
  }

  return `${output}${suffix}`;
}

export function padVisible(text: string, width: number): string {
  const fitted = truncateVisible(text, width);
  const vw = visibleWidth(fitted);
  return vw >= width ? fitted : fitted + " ".repeat(width - vw);
}

export function truncatePlain(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, Math.max(0, width));
  return `${text.slice(0, width - 1)}…`;
}

export function centerPlain(text: string, width: number): string {
  const truncated = truncatePlain(text, width);
  const gap = Math.max(0, width - truncated.length);
  const left = Math.floor(gap / 2);
  return `${" ".repeat(left)}${truncated}${" ".repeat(gap - left)}`;
}

export function wrapWords(text: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const raw of words) {
    const word = truncatePlain(raw, width);
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
