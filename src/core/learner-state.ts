import { readFile, writeFile } from "node:fs/promises";
import { LearnerProfile, LearnerState, TopicDefinition } from "./types.js";
import { clamp } from "./util.js";

const DEFAULT_LEARNER_STATE: Omit<LearnerState, "id"> = {
  coveredTopics: [],
  identifiedMisconceptions: [],
  feedback: [],
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

export async function loadLearnerState(filePath: string): Promise<LearnerState> {
  // Read JSON from filePath. If file doesn't exist or is invalid, return default with id "learner-1"
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as LearnerState;
  } catch {
    return { id: "learner-1", ...DEFAULT_LEARNER_STATE };
  }
}

export async function saveLearnerState(filePath: string, state: LearnerState): Promise<void> {
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
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
  signal: "thumbs-up" | "thumbs-down" | "confused"
): LearnerState {
  state.feedback.push({
    topic,
    timestamp: new Date().toISOString(),
    signal
  });
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
