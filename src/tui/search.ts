import type { TranscriptEntry } from "./view-model.js";

export interface SearchOption {
  label: string;
  description?: string;
  value?: string;
}
export interface RankedSearchOption extends SearchOption {
  score: number;
}

export interface TranscriptSearchResult {
  entry: TranscriptEntry;
  index: number;
  score: number;
  /** A short line that explains why the entry matched. */
  excerpt: string;
}

function tokens(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 12);
}

/** A small subsequence scorer suitable for command palettes and selectors. */
export function searchScore(value: string, query: string): number {
  const candidate = value.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 0;
  if (candidate === needle) return 1_000;
  if (candidate.startsWith(needle)) return 800 - candidate.length;
  if (candidate.includes(needle)) return 600 - candidate.indexOf(needle);
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const index = candidate.indexOf(character, cursor);
    if (index === -1) return -1;
    score += index === cursor ? 12 : 2;
    cursor = index + 1;
  }
  return score;
}

/** Filter an option list while retaining stable, keyboard-friendly ordering. */
export function filterSearchOptions(
  options: readonly SearchOption[],
  query: string,
  limit = options.length,
): RankedSearchOption[] {
  const needle = query.trim();
  return options
    .map((option, index) => {
      const labelScore = searchScore(option.label, needle);
      const descriptionScore = option.description ? searchScore(option.description, needle) : -1;
      const score = !needle ? 0 : Math.max(labelScore, descriptionScore);
      return { ...option, score, index };
    })
    .filter((option) => !needle || option.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ index: _index, ...option }) => option);
}

function excerpt(body: string, queryTokens: readonly string[]): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const match = queryTokens
    .map((token) => ({ token, index: lower.indexOf(token) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  if (!match) return compact.slice(0, 120);
  const start = Math.max(0, match.index - 42);
  const end = Math.min(compact.length, start + 140);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

/** Search transcript titles and bodies, returning the original entry object. */
export function searchTranscript(
  entries: readonly TranscriptEntry[],
  query: string,
  limit = 25,
): TranscriptSearchResult[] {
  const needle = query.trim();
  const queryTokens = tokens(needle);
  if (!needle) return [];
  return entries
    .map((entry, index) => {
      const haystack = `${entry.title}\n${entry.body}`.toLowerCase();
      const score = queryTokens.reduce((total, token) => {
        const match = searchScore(haystack, token);
        return match < 0 ? -1 : total + match;
      }, 0);
      return { entry, index, score, excerpt: excerpt(entry.body, queryTokens) };
    })
    .filter((result) => result.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit));
}
