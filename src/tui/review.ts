import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { dueTopics } from "../core/engagement.js";
import { loadLearnerState } from "../core/learner-state.js";
import { learnerStatePath, stateDir } from "../core/paths.js";
import {
  applyReview,
  formatDueIn,
  initialSrsState,
  isDue,
  validateCardSrsState,
  type CardSrsState,
  type SrsRating,
} from "./learner-contracts.js";
import { listTuiLibraryArtifacts, previewTuiArtifact } from "./library.js";

const REVIEW_STATE_VERSION = 1;
const MAX_REVIEW_STATE_BYTES = 2 * 1024 * 1024;

interface TuiReviewState {
  version: typeof REVIEW_STATE_VERSION;
  cards: Record<string, CardSrsState>;
}

export interface TuiReviewCard {
  key: string;
  id: string;
  deckId: string;
  topic: string;
  front: string;
  back: string;
  sourcePath: string;
  srs: CardSrsState;
}

export interface TuiReviewDashboard {
  cards: TuiReviewCard[];
  dueCards: TuiReviewCard[];
  dueTopics: ReturnType<typeof dueTopics>;
  provenance: string;
}

function reviewStatePath(cwd: string): string {
  return join(stateDir(cwd), "tui-review.json");
}

function validReviewState(value: unknown): value is TuiReviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<TuiReviewState>;
  return state.version === REVIEW_STATE_VERSION
    && !!state.cards && typeof state.cards === "object" && !Array.isArray(state.cards)
    && Object.entries(state.cards).every(([key, card]) => key.length > 0 && key.length <= 256 && validateCardSrsState(card));
}

async function loadReviewState(cwd: string): Promise<TuiReviewState> {
  const path = reviewStatePath(cwd);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: REVIEW_STATE_VERSION, cards: {} };
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REVIEW_STATE_BYTES) {
    throw new Error("The terminal review schedule is not a bounded regular file.");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("The terminal review schedule is not owned by the current user.");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("The terminal review schedule contains invalid JSON. Preserve it and repair or move it before retrying.");
  }
  if (!validReviewState(candidate)) throw new Error("The terminal review schedule failed schema validation. No review state was changed.");
  return candidate;
}

async function saveReviewState(cwd: string, state: TuiReviewState): Promise<void> {
  if (!validReviewState(state)) throw new Error("Refusing to persist an invalid terminal review schedule.");
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_REVIEW_STATE_BYTES) throw new Error("The terminal review schedule exceeds its storage limit.");
  const directory = stateDir(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = reviewStatePath(cwd);
  const temporary = join(directory, `.tui-review.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export function parseTuiFlashcardDeck(sourcePath: string, markdown: string, now: string): TuiReviewCard[] {
  const topic = markdown.match(/^# Flash Cards:\s*(.+)$/m)?.[1]?.trim();
  if (!topic) return [];
  const deckId = basename(sourcePath).replace(/\.md$/i, "");
  const cards: TuiReviewCard[] = [];
  const pattern = /^##\s+([^\s]+)\s+\[[^\]\n]+\]\s*\n\*\*Front:\*\*\s*([^\n]+)\s*\n\s*\n\*\*Back:\*\*\s*([^\n]+)/gm;
  for (const match of markdown.matchAll(pattern)) {
    const id = match[1]?.trim();
    const front = match[2]?.trim();
    const back = match[3]?.trim();
    if (!id || !front || !back) continue;
    cards.push({ key: `${deckId}:${id}`, id, deckId, topic, front, back, sourcePath, srs: initialSrsState(now) });
  }
  return cards;
}

export async function loadTuiReviewDashboard(cwd: string, now = new Date().toISOString()): Promise<TuiReviewDashboard> {
  const [state, artifacts, learner] = await Promise.all([
    loadReviewState(cwd),
    listTuiLibraryArtifacts(cwd),
    loadLearnerState(learnerStatePath(cwd)),
  ]);
  const cards: TuiReviewCard[] = [];
  for (const artifact of artifacts) {
    const normalized = artifact.path.replace(/\\/g, "/");
    if (!normalized.includes("/.keating/outputs/flashcards/") && !normalized.includes(".keating/outputs/flashcards/")) continue;
    if (!normalized.endsWith(".md")) continue;
    const preview = await previewTuiArtifact(cwd, artifact.path);
    if (preview.kind !== "text") continue;
    for (const card of parseTuiFlashcardDeck(artifact.path, preview.content, now)) {
      card.srs = state.cards[card.key] ?? card.srs;
      cards.push(card);
    }
  }
  cards.sort((left, right) => Date.parse(left.srs.dueAt) - Date.parse(right.srs.dueAt) || left.key.localeCompare(right.key));
  return {
    cards,
    dueCards: cards.filter((card) => isDue(card.srs, now)),
    dueTopics: dueTopics(learner, undefined, new Date(now)),
    provenance: "Card schedules are observed terminal review records. Topic urgency is an estimate derived from local learner history, not provider usage or proven mastery.",
  };
}

export function reviewCardOption(card: TuiReviewCard, index: number, now: string): string {
  return `${index + 1}. ${card.front} · ${card.topic} · ${formatDueIn(card.srs.dueAt, now)}`;
}

export async function rateTuiReviewCard(cwd: string, card: TuiReviewCard, rating: SrsRating, now = new Date().toISOString()) {
  const state = await loadReviewState(cwd);
  const current = state.cards[card.key] ?? card.srs;
  const outcome = applyReview(current, rating, now);
  state.cards[card.key] = outcome.next;
  await saveReviewState(cwd, state);
  return outcome;
}
