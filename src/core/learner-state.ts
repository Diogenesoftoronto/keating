import { readFile, writeFile } from "node:fs/promises";
import { LearnerProfile, LearnerState, TopicDefinition } from "./types.js";
import { clamp } from "./util.js";

const DEFAULT_LEARNER_STATE: Omit<LearnerState, "id"> = {
  coveredTopics: [],
  identifiedMisconceptions: [],
  feedback: [],
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

export function buildProfileFromFeedback(state: LearnerState): LearnerProfile {
  const profile = { ...state.profile };
  if (state.feedback.length === 0) return profile;

  const total = state.feedback.length;
  const confusedCount = state.feedback.filter(f => f.signal === "confused").length;
  const positiveCount = state.feedback.filter(f => f.signal === "thumbs-up").length;
  const negativeCount = state.feedback.filter(f => f.signal === "thumbs-down").length;

  const confusionRate = confusedCount / total;
  const satisfactionRate = positiveCount / total;

  // High confusion suggests lower abstraction comfort and higher anxiety
  profile.abstractionComfort = clamp(profile.abstractionComfort - confusionRate * 0.2);
  profile.anxiety = clamp(profile.anxiety + confusionRate * 0.15);

  // High satisfaction suggests the current teaching style works
  profile.persistence = clamp(profile.persistence + satisfactionRate * 0.1);

  // High negative feedback suggests teaching style mismatch
  profile.dialoguePreference = clamp(profile.dialoguePreference + (negativeCount / total) * 0.1);

  // Update prior knowledge from covered topics
  if (state.coveredTopics.length > 0) {
    const avgMastery = state.coveredTopics.reduce((sum, t) => sum + t.masteryEstimate, 0) / state.coveredTopics.length;
    profile.priorKnowledge = clamp(avgMastery);
  }

  return profile;
}
