/**
 * Pursuits: what a learner is actually working on, as a list with at most one
 * current entry.
 *
 * This exists because a single `goal` field models the wrong thing. A goal is
 * roughly drafted by a person at the moment they know least about the subject,
 * and then real conversation moves. People also open a session about something
 * completely unrelated to the last one. So:
 *
 * - many pursuits per learner, at most one `current` — enforced here rather
 *   than by convention, because "two current pursuits" is the bug this file
 *   exists to prevent;
 * - a pursuit is never automatically carried into a new session. It stays a
 *   fact about the learner, but each session has to confirm it. See
 *   {@link pursuitStanceForSession};
 * - retiring the current pursuit promotes nothing. A person picks what is next,
 *   or the next conversation reveals it.
 *
 * Dependency-free so the web app, the mobile app and the CLI share one shape.
 */

export const PURSUIT_SCHEMA_VERSION = 1;

/** Beyond this the list is history, not a working set. Oldest entries are dropped. */
export const MAX_PURSUITS = 24;
export const MAX_PURSUIT_TITLE_LENGTH = 200;
export const MAX_PURSUIT_MOTIVATION_LENGTH = 400;
export const MAX_PURSUIT_EVIDENCE_LENGTH = 500;

export const PURSUIT_STATUSES = ["current", "dormant", "achieved", "abandoned"] as const;
export type PursuitStatus = (typeof PURSUIT_STATUSES)[number];

/** `declared` came from a person typing it; `observed` came from reading a real message. */
export const PURSUIT_SOURCES = ["declared", "observed"] as const;
export type PursuitSource = (typeof PURSUIT_SOURCES)[number];

export interface PursuitEvidenceProvenance {
  sessionId: string;
  messageId: string;
  start: number;
  end: number;
}

export interface Pursuit {
  id: string;
  title: string;
  motivation: string;
  status: PursuitStatus;
  source: PursuitSource;
  /** Verbatim learner span when observed, so an inferred pursuit can show its grounds. */
  evidence: string | null;
  /** Hash and exact message offsets supplied by Needle; null for learner-declared pursuits. */
  evidenceQuoteSha256: string | null;
  evidenceProvenance: PursuitEvidenceProvenance | null;
  /** Null when declared outside a conversation, such as onboarding or settings. */
  startedInSessionId: string | null;
  /** The last session that actually worked on this, which is what makes carry-over checkable. */
  lastSeenSessionId: string | null;
  /** Optional link to a full LearnerGoal once the pursuit earns a curriculum. */
  goalId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PursuitInput {
  title: string;
  motivation?: string;
  source?: PursuitSource;
  evidence?: string | null;
  evidenceQuoteSha256?: string | null;
  evidenceProvenance?: PursuitEvidenceProvenance | null;
  startedInSessionId?: string | null;
  goalId?: string | null;
  /** Injected so callers stay deterministic in tests. */
  now?: number;
  id?: string;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function optionalText(value: unknown, limit: number): string | null {
  const trimmed = text(value, limit);
  return trimmed.length > 0 ? trimmed : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function evidenceProvenance(value: unknown): PursuitEvidenceProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const sessionId = text(input.sessionId, 200);
  const messageId = text(input.messageId, 200);
  const start = timestamp(input.start, -1);
  const end = timestamp(input.end, -1);
  return sessionId && messageId && start >= 0 && end >= start
    ? { sessionId, messageId, start, end }
    : null;
}

/** Case- and whitespace-insensitive, so "Learn Rust" and "learn  rust" are one pursuit. */
export function pursuitKey(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

let sequence = 0;
function makePursuitId(now: number): string {
  sequence += 1;
  return `pursuit-${now.toString(36)}-${sequence.toString(36)}`;
}

export function buildPursuit(input: PursuitInput): Pursuit | null {
  const title = text(input.title, MAX_PURSUIT_TITLE_LENGTH);
  if (!title) return null;
  const now = timestamp(input.now, Date.now());
  const source = oneOf(input.source, PURSUIT_SOURCES, "declared");
  const evidence = optionalText(input.evidence, MAX_PURSUIT_EVIDENCE_LENGTH);
  const evidenceQuoteSha256 = sha256(input.evidenceQuoteSha256);
  const provenance = evidenceProvenance(input.evidenceProvenance);
  // "Observed" is a provenance claim. Without a grounded span it is unusable,
  // not a weaker observation and not something to relabel as learner-declared.
  if (source === "observed" && (!evidence || !evidenceQuoteSha256 || !provenance)) return null;
  return {
    id: text(input.id, 100) || makePursuitId(now),
    title,
    motivation: text(input.motivation, MAX_PURSUIT_MOTIVATION_LENGTH),
    // A new pursuit is dormant until something makes it current, so building one
    // can never silently displace what the learner is already doing.
    status: "dormant",
    source,
    evidence,
    evidenceQuoteSha256,
    evidenceProvenance: provenance,
    startedInSessionId: optionalText(input.startedInSessionId, 200),
    lastSeenSessionId: optionalText(input.startedInSessionId, 200),
    goalId: optionalText(input.goalId, 100),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The single place the "at most one current" invariant is enforced.
 *
 * Also de-duplicates by title and bounds the list. When storage somehow holds
 * two current pursuits — a merge, a race, a hand-edited file — the most
 * recently updated one wins and the rest become dormant rather than throwing,
 * because losing the list would be worse than resolving it.
 */
export function normalizePursuits(value: unknown): Pursuit[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, Pursuit>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const title = text(entry.title, MAX_PURSUIT_TITLE_LENGTH);
    if (!title) continue;
    const createdAt = timestamp(entry.createdAt, 0);
    const pursuit: Pursuit = {
      id: text(entry.id, 100) || makePursuitId(createdAt || Date.now()),
      title,
      motivation: text(entry.motivation, MAX_PURSUIT_MOTIVATION_LENGTH),
      status: oneOf(entry.status, PURSUIT_STATUSES, "dormant"),
      source: oneOf(entry.source, PURSUIT_SOURCES, "declared"),
      evidence: optionalText(entry.evidence, MAX_PURSUIT_EVIDENCE_LENGTH),
      evidenceQuoteSha256: sha256(entry.evidenceQuoteSha256),
      evidenceProvenance: evidenceProvenance(entry.evidenceProvenance),
      startedInSessionId: optionalText(entry.startedInSessionId, 200),
      lastSeenSessionId: optionalText(entry.lastSeenSessionId, 200),
      goalId: optionalText(entry.goalId, 100),
      createdAt,
      updatedAt: timestamp(entry.updatedAt, createdAt),
    };
    if (pursuit.source === "observed"
      && (!pursuit.evidence || !pursuit.evidenceQuoteSha256 || !pursuit.evidenceProvenance)) continue;
    const key = pursuitKey(title);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, pursuit);
      continue;
    }
    // A duplicate refresh may be newer, but it cannot accidentally demote the
    // current copy. Prefer current; otherwise prefer the latest valid record.
    if (existing.status !== "current" && pursuit.status === "current") byKey.set(key, pursuit);
    else if (existing.status === pursuit.status && pursuit.updatedAt >= existing.updatedAt) byKey.set(key, pursuit);
    else if (existing.status !== "current" && pursuit.updatedAt >= existing.updatedAt) byKey.set(key, pursuit);
  }

  // Bound by recency, not input order. Merged/local files are not guaranteed to
  // arrive chronologically.
  const pursuits = [...byKey.values()]
    .sort((left, right) => left.updatedAt - right.updatedAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-MAX_PURSUITS);
  const currents = pursuits.filter((pursuit) => pursuit.status === "current");
  if (currents.length <= 1) return pursuits;
  const winner = currents.reduce((latest, pursuit) => (pursuit.updatedAt >= latest.updatedAt ? pursuit : latest));
  return pursuits.map((pursuit) =>
    pursuit.status === "current" && pursuit.id !== winner.id ? { ...pursuit, status: "dormant" as const } : pursuit,
  );
}

export function currentPursuit(pursuits: readonly Pursuit[]): Pursuit | null {
  return pursuits.find((pursuit) => pursuit.status === "current") ?? null;
}

/** Candidates a learner could plausibly return to: dormant only, newest first. */
export function dormantPursuits(pursuits: readonly Pursuit[]): Pursuit[] {
  return pursuits
    .filter((pursuit) => pursuit.status === "dormant")
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function addPursuit(pursuits: readonly Pursuit[], input: PursuitInput): Pursuit[] {
  const pursuit = buildPursuit(input);
  if (!pursuit) return [...pursuits];
  const key = pursuitKey(pursuit.title);
  // Re-stating an existing pursuit refreshes it instead of forking a duplicate.
  if (pursuits.some((existing) => pursuitKey(existing.title) === key)) {
    return normalizePursuits(pursuits.map((existing) =>
      pursuitKey(existing.title) === key
        ? { ...existing, motivation: pursuit.motivation || existing.motivation, updatedAt: pursuit.updatedAt }
        : existing,
    ));
  }
  return normalizePursuits([...pursuits, pursuit]);
}

/**
 * Add or resume a pursuit and make it the single current one.
 *
 * Used by onboarding/settings when the learner explicitly chooses a starting
 * point. Model proposals must go through `applyPursuitSwitchProposal`, which
 * requires a separate approval flag.
 */
export function startPursuit(pursuits: readonly Pursuit[], input: PursuitInput): Pursuit[] {
  const next = addPursuit(pursuits, input);
  const key = pursuitKey(input.title);
  const target = next.find((pursuit) => pursuitKey(pursuit.title) === key);
  return target ? setCurrentPursuit(next, target.id, { now: input.now, sessionId: input.startedInSessionId }) : next;
}

/**
 * Switch the current pursuit. The outgoing one becomes dormant, never
 * abandoned: coming back to something is the normal case, not an exception.
 */
export function setCurrentPursuit(
  pursuits: readonly Pursuit[],
  id: string,
  options: { now?: number; sessionId?: string | null } = {},
): Pursuit[] {
  const normalized = normalizePursuits(pursuits);
  if (!normalized.some((pursuit) => pursuit.id === id)) return normalized;
  const now = timestamp(options.now, Date.now());
  const sessionId = optionalText(options.sessionId, 200);
  return normalized.map((pursuit) => {
    if (pursuit.id === id) {
      return {
        ...pursuit,
        status: "current" as const,
        updatedAt: now,
        lastSeenSessionId: sessionId ?? pursuit.lastSeenSessionId,
      };
    }
    return pursuit.status === "current" ? { ...pursuit, status: "dormant" as const, updatedAt: now } : pursuit;
  });
}

/**
 * Finish or drop a pursuit. Nothing is promoted in its place — the learner
 * decides what is next, or the next conversation shows it.
 */
export function retirePursuit(
  pursuits: readonly Pursuit[],
  id: string,
  status: "achieved" | "abandoned",
  options: { now?: number } = {},
): Pursuit[] {
  const normalized = normalizePursuits(pursuits);
  const now = timestamp(options.now, Date.now());
  return normalized.map((pursuit) => (pursuit.id === id ? { ...pursuit, status, updatedAt: now } : pursuit));
}

/** Pause a current pursuit without implying success or abandonment. */
export function setAsidePursuit(
  pursuits: readonly Pursuit[],
  id: string,
  options: { now?: number } = {},
): Pursuit[] {
  const normalized = normalizePursuits(pursuits);
  const now = timestamp(options.now, Date.now());
  return normalized.map((pursuit) =>
    pursuit.id === id && pursuit.status === "current"
      ? { ...pursuit, status: "dormant" as const, updatedAt: now }
      : pursuit,
  );
}

/** Records that a session actually worked on a pursuit, which is what confirms carry-over. */
export function touchPursuitSession(
  pursuits: readonly Pursuit[],
  id: string,
  sessionId: string,
  options: { now?: number } = {},
): Pursuit[] {
  const normalized = normalizePursuits(pursuits);
  const session = optionalText(sessionId, 200);
  if (!session) return normalized;
  const now = timestamp(options.now, Date.now());
  return normalized.map((pursuit) =>
    pursuit.id === id ? { ...pursuit, lastSeenSessionId: session, updatedAt: now } : pursuit,
  );
}

export type PursuitStance =
  /** Nothing is current; do not invent one. */
  | { readonly kind: "none" }
  /** Current, and this very session has already worked on it. */
  | { readonly kind: "confirmed"; readonly pursuit: Pursuit }
  /** Current as a standing fact, but this session has not touched it yet. */
  | { readonly kind: "unconfirmed"; readonly pursuit: Pursuit };

/**
 * What a new session may assume about the current pursuit: nothing, until this
 * session touches it.
 *
 * This is the rule that stops a session inheriting last week's subject. A
 * pursuit only reads as `confirmed` once `lastSeenSessionId` matches the
 * session asking, so the opening turn of every new conversation treats the
 * standing pursuit as a maybe.
 */
export function pursuitStanceForSession(
  pursuits: readonly Pursuit[],
  sessionId: string | null | undefined,
): PursuitStance {
  const pursuit = currentPursuit(normalizePursuits(pursuits));
  if (!pursuit) return { kind: "none" };
  const session = optionalText(sessionId, 200);
  if (session && pursuit.lastSeenSessionId === session) return { kind: "confirmed", pursuit };
  return { kind: "unconfirmed", pursuit };
}

/**
 * Prompt lines for the tutor. The unconfirmed case is deliberately explicit:
 * without it the model reads a current pursuit as the subject of this
 * conversation, which is exactly the carry-over mistake.
 */
export function pursuitPromptLines(pursuits: readonly Pursuit[], stance: PursuitStance): string[] {
  const lines: string[] = [];
  if (stance.kind === "none") {
    lines.push("Current pursuit: none recorded. Follow whatever the learner raises; do not ask them to name a goal before helping.");
  } else {
    const { pursuit } = stance;
    lines.push(`Current pursuit: ${pursuit.title}${pursuit.motivation ? ` — ${pursuit.motivation}` : ""}`);
    lines.push(stance.kind === "confirmed"
      ? "This session is already working on that pursuit."
      : "This session has not touched that pursuit yet. It is what they were doing last, not necessarily what they want now. If they open with something unrelated, follow them there instead of steering back.");
  }
  const dormant = dormantPursuits(pursuits).slice(0, 5);
  if (dormant.length > 0) {
    lines.push(`Set aside for now: ${dormant.map((pursuit) => pursuit.title).join("; ")}. Mention one only if the learner returns to it.`);
  }
  return lines;
}
