/**
 * Deterministic participation signals for a study room. Teachers see these in
 * the oversight panel and Keating reads them so it can draw quieter learners
 * in. They count contributions; they say nothing about understanding.
 */
import type { RoomMember, RoomMessage } from "./contracts";

export type ParticipationStatus = "silent" | "quiet" | "balanced" | "dominant";

export interface LearnerParticipation {
  accountId: string;
  displayName: string;
  messages: number;
  words: number;
  questions: number;
  /** Keating messages addressed to this learner by name. */
  addressedByKeating: number;
  /** This learner's share of all learner messages, in [0, 1]. */
  share: number;
  lastSpokeAt?: string;
  status: ParticipationStatus;
}

export interface RoomParticipation {
  learners: LearnerParticipation[];
  learnerMessages: number;
  keatingMessages: number;
  teacherMessages: number;
  /**
   * Normalized entropy of learner message shares in [0, 1]: 1 means every
   * learner contributed equally. Undefined with fewer than two learners or
   * too few messages to judge.
   */
  balance?: number;
}

/** Below this many learner messages, shares are too noisy to label. */
const MIN_MESSAGES_FOR_SHARES = 6;
const QUIET_AFTER_MS = 10 * 60_000;

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function statusFor(
  share: number,
  learnerCount: number,
  total: number,
  messages: number,
  quietForMs: number | undefined,
): ParticipationStatus {
  if (messages === 0) return "silent";
  if (learnerCount < 2 || total < MIN_MESSAGES_FOR_SHARES) {
    return quietForMs !== undefined && quietForMs > QUIET_AFTER_MS ? "quiet" : "balanced";
  }
  const even = 1 / learnerCount;
  // A threshold of 2 * even is unreachable in a two-learner room.
  if (share > Math.min(0.75, Math.max(0.5, 2 * even))) return "dominant";
  if (share < 0.5 * even) return "quiet";
  if (quietForMs !== undefined && quietForMs > QUIET_AFTER_MS) return "quiet";
  return "balanced";
}

export function summarizeParticipation(
  members: readonly RoomMember[],
  messages: readonly RoomMessage[],
  now = Date.now(),
): RoomParticipation {
  const learners = members.filter((member) => member.role === "learner");
  const stats = new Map(
    learners.map((member) => [
      member.accountId,
      {
        accountId: member.accountId,
        displayName: member.displayName,
        messages: 0,
        words: 0,
        questions: 0,
        addressedByKeating: 0,
        lastSpokeAt: undefined as string | undefined,
      },
    ]),
  );
  const byName = new Map<string, string | null>();
  for (const learner of learners) {
    const name = learner.displayName.toLowerCase();
    byName.set(name, byName.has(name) ? null : learner.accountId);
  }
  let learnerMessages = 0;
  let keatingMessages = 0;
  let teacherMessages = 0;
  let latestActivity: number | undefined;

  for (const message of messages) {
    if (message.hidden || message.audience !== "room") continue;
    if (message.kind === "keating") {
      keatingMessages += 1;
      for (const name of new Set((message.addressedTo ?? []).map((name) => name.toLowerCase()))) {
        const accountId = byName.get(name);
        const entry = accountId ? stats.get(accountId) : undefined;
        if (entry) entry.addressedByKeating += 1;
      }
      continue;
    }
    if (message.kind !== "chat") continue;
    const at = Date.parse(message.createdAt);
    latestActivity = latestActivity === undefined ? at : Math.max(latestActivity, at);
    if (message.authorRole === "host" || message.authorRole === "teacher") {
      teacherMessages += 1;
      continue;
    }
    const entry = message.authorAccountId ? stats.get(message.authorAccountId) : undefined;
    if (!entry) continue;
    learnerMessages += 1;
    entry.messages += 1;
    entry.words += wordCount(message.body);
    if (message.body.includes("?")) entry.questions += 1;
    if (!entry.lastSpokeAt || at > Date.parse(entry.lastSpokeAt)) entry.lastSpokeAt = message.createdAt;
  }

  const summaries = [...stats.values()].map((entry): LearnerParticipation => {
    const share = learnerMessages > 0 ? entry.messages / learnerMessages : 0;
    // "Quiet" means the room kept talking without them, not that the room idled.
    const quietForMs =
      entry.lastSpokeAt && latestActivity !== undefined
        ? Math.min(now, latestActivity) - Date.parse(entry.lastSpokeAt)
        : undefined;
    return {
      ...entry,
      share,
      status: statusFor(share, learners.length, learnerMessages, entry.messages, quietForMs),
    };
  });
  summaries.sort((left, right) => right.messages - left.messages || left.displayName.localeCompare(right.displayName));

  let balance: number | undefined;
  if (learners.length >= 2 && learnerMessages >= MIN_MESSAGES_FOR_SHARES) {
    const entropy = summaries.reduce(
      (sum, entry) => (entry.share > 0 ? sum - entry.share * Math.log(entry.share) : sum),
      0,
    );
    balance = Math.min(1, Math.max(0, entropy / Math.log(learners.length)));
  }

  return {
    learners: summaries,
    learnerMessages,
    keatingMessages,
    teacherMessages,
    ...(balance !== undefined ? { balance } : {}),
  };
}
