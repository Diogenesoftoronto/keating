import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LearnerProfile, LearnerState, TopicDefinition } from "./types.js";
import { clamp } from "./util.js";
import { learnerProfileNameFromPath } from "./learner-profile-selection.js";

const DEFAULT_LEARNER_STATE: Omit<LearnerState, "id"> = {
  coveredTopics: [],
  identifiedMisconceptions: [],
  feedback: [],
  quizResults: [],
  sessions: [],
  profile: {
    id: "default",
    priorKnowledge: 0.5,
    abstractionComfort: 0.5,
    analogyNeed: 0.5,
    dialoguePreference: 0.5,
    diagramAffinity: 0.5,
    persistence: 0.5,
    transferDesire: 0.5,
    anxiety: 0.3
  }
};

function defaultLearnerState(): LearnerState {
  return JSON.parse(JSON.stringify({ id: "learner-1", ...DEFAULT_LEARNER_STATE })) as LearnerState;
}

export async function loadLearnerState(filePath: string): Promise<LearnerState> {
  const name = learnerProfileNameFromPath(filePath);
  if (name !== undefined) {
    const defaults = defaultLearnerState();
    defaults.id = name;
    defaults.profile.id = name;
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(filePath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults;
      throw new Error(`Cannot load learner profile ${name}: expected a valid JSON learner-state object.`, { cause: error });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid learner profile ${name}: expected an object.`);
    const value = parsed as Record<string, unknown>;
    if (value.profile !== undefined && (!value.profile || typeof value.profile !== "object" || Array.isArray(value.profile))) {
      throw new Error(`Invalid learner profile ${name}: profile must be an object.`);
    }
    for (const key of ["coveredTopics", "identifiedMisconceptions", "feedback", "quizResults", "sessions"] as const) {
      if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`Invalid learner profile ${name}: ${key} must be an array.`);
    }
    const profile = value.profile as Record<string, unknown> | undefined;
    if (profile?.background !== undefined && typeof profile.background !== "string") throw new Error(`Invalid learner profile ${name}: background must be text.`);
    for (const key of Object.keys(defaults.profile).filter((key) => key !== "id")) {
      if (profile?.[key] !== undefined && (typeof profile[key] !== "number" || !Number.isFinite(profile[key]) || Number(profile[key]) < 0 || Number(profile[key]) > 1)) {
        throw new Error(`Invalid learner profile ${name}: ${key} must be a number from 0 to 1.`);
      }
    }
    if ((value.id !== undefined && (typeof value.id !== "string" || !value.id.trim())) ||
      (profile?.id !== undefined && (typeof profile.id !== "string" || !profile.id.trim()))) throw new Error(`Invalid learner profile ${name}: ids must be nonempty text.`);
    return { ...defaults, ...value, profile: { ...defaults.profile, ...profile } } as LearnerState;
  }
  // Read JSON from filePath. If file doesn't exist or is invalid, return default with id "learner-1"
  try {
    const raw = await readFile(filePath, "utf8");
    const state = JSON.parse(raw) as LearnerState;
    if (!Array.isArray(state.quizResults)) state.quizResults = [];
    return state;
  } catch {
    return defaultLearnerState();
  }
}

export async function saveLearnerState(filePath: string, state: LearnerState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

/** Create a selected profile once; validate existing user-edited files without rewriting them. */
export async function ensureNamedLearnerState(filePath: string): Promise<void> {
  if (learnerProfileNameFromPath(filePath) === undefined) return;
  const state = await loadLearnerState(filePath);
  await mkdir(dirname(filePath), { recursive: true });
  try { await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

export function recordTopicCoverage(
  state: LearnerState,
  topic: TopicDefinition,
  masteryEstimate: number
): LearnerState {
  const existing = state.coveredTopics.find(t => t.slug === topic.slug);
  if (existing) {
    existing.lastSeen = new Date().toISOString();
    existing.masteryEstimate = clamp(masteryEstimate);
    existing.sessionCount += 1;
  } else {
    state.coveredTopics.push({
      slug: topic.slug,
      domain: topic.domain,
      lastSeen: new Date().toISOString(),
      masteryEstimate: clamp(masteryEstimate),
      sessionCount: 1
    });
  }
  return state;
}

export function recordMisconception(
  state: LearnerState,
  topic: string,
  misconception: string
): LearnerState {
  const existing = state.identifiedMisconceptions.find(
    m => m.topic === topic && m.misconception === misconception
  );
  if (!existing) {
    state.identifiedMisconceptions.push({ topic, misconception, addressed: false });
  }
  return state;
}

export function recordFeedback(
  state: LearnerState,
  topic: string,
  signal: "thumbs-up" | "thumbs-down" | "confused",
  comment?: string
): LearnerState {
  state.feedback.push({
    topic,
    timestamp: new Date().toISOString(),
    signal,
    comment
  });
  return state;
}

export function recordQuizResult(
  state: LearnerState,
  topicSlug: string,
  correct: number,
  total: number
): LearnerState {
  if (total <= 0) return state;
  if (!state.quizResults) state.quizResults = [];
  const score = clamp(correct / total);
  state.quizResults.push({
    topic: topicSlug,
    timestamp: new Date().toISOString(),
    correct,
    total,
    score
  });
  const covered = state.coveredTopics.find((t) => t.slug === topicSlug);
  if (covered) {
    covered.masteryEstimate = clamp(covered.masteryEstimate * 0.6 + score * 0.4);
  }
  return state;
}

export function recordSessionStart(state: LearnerState): LearnerState {
  if (!state.sessions) state.sessions = [];
  state.sessions.push({
    startedAt: new Date().toISOString(),
    topicsCovered: []
  });
  return state;
}

export function recordSessionEnd(
  state: LearnerState,
  topicsCovered: string[]
): LearnerState {
  if (!state.sessions) state.sessions = [];
  const current = state.sessions[state.sessions.length - 1];
  if (current && !current.endedAt) {
    current.endedAt = new Date().toISOString();
    current.topicsCovered = topicsCovered;
  }
  return state;
}

import { piCompleteJson } from "./pi-agent.js";

export async function buildProfileFromFeedback(cwd: string, state: LearnerState): Promise<LearnerProfile> {
  if (state.feedback.length === 0) return { ...state.profile };

  const prompt = `You are updating a learner's pedagogical profile based on their history.
Current Profile: ${JSON.stringify(state.profile, null, 2)}
Recent Feedback: ${JSON.stringify(state.feedback, null, 2)}
Covered Topics: ${JSON.stringify(state.coveredTopics, null, 2)}

Given this feedback, how should the learner's traits (priorKnowledge, abstractionComfort, analogyNeed, dialoguePreference, diagramAffinity, persistence, transferDesire, anxiety) be updated? Each trait is a scalar from 0.0 to 1.0. 
Respond ONLY with a JSON object exactly matching the LearnerProfile schema (include all fields, even 'id'). Use thoughtful inferences. For example, if they are confused frequently, they may need more analogies and less abstraction. If they give thumbs-up on highly formal topics, they have high abstraction comfort.`;

  try {
    const updated = await piCompleteJson<LearnerProfile>(cwd, prompt, { thinking: "low" });
    return {
      ...updated,
      id: state.profile.id // Preserve ID
    };
  } catch (error) {
    console.error("Failed to dynamically update profile, falling back to current:", error);
    return { ...state.profile };
  }
}
