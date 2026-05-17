import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { computeTopicEngagement, buildEngagementTimeline, DEFAULT_ENGAGEMENT_POLICY, dueTopics } from "../src/core/engagement.js";
import type { EngagementPolicy, LearnerState } from "../src/core/types.js";

const arbEngagementPolicy: fc.Arbitrary<EngagementPolicy> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 16 }),
  retentionHalfLifeDays: fc.double({ min: 1, max: 365, noNaN: true }),
  dueThreshold: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
  minReviewIntervalDays: fc.integer({ min: 0, max: 7 }),
  urgencyTiers: fc.tuple(
    fc.integer({ min: 7, max: 60 }),
    fc.integer({ min: 5, max: 30 }),
    fc.integer({ min: 2, max: 14 }),
    fc.integer({ min: 1, max: 7 })
  ),
});

const arbCoveredTopic = fc.record({
  slug: fc.string({ minLength: 1, maxLength: 24 }),
  domain: fc.constantFrom("math", "science", "philosophy", "code", "law", "politics", "psychology", "medicine", "arts", "history", "general"),
  lastSeen: fc.integer({ min: 0, max: 365 }).map(daysAgo => {
    const d = new Date(Date.now() - daysAgo * 86400000);
    return d.toISOString();
  }),
  masteryEstimate: fc.double({ min: 0, max: 1, noNaN: true }),
  sessionCount: fc.integer({ min: 1, max: 100 }),
});

const arbLearnerState: fc.Arbitrary<LearnerState> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  coveredTopics: fc.array(arbCoveredTopic, { maxLength: 10 }),
  identifiedMisconceptions: fc.array(fc.record({
    topic: fc.string({ minLength: 1, maxLength: 16 }),
    misconception: fc.string({ minLength: 1, maxLength: 16 }),
    addressed: fc.boolean(),
  }), { maxLength: 5 }),
  feedback: fc.array(fc.record({
    topic: fc.string({ minLength: 1, maxLength: 16 }),
    timestamp: fc.string({ minLength: 1, maxLength: 30 }),
    signal: fc.constantFrom("thumbs-up", "thumbs-down", "confused"),
  }), { maxLength: 5 }),
  sessions: fc.array(fc.record({
    startedAt: fc.string({ minLength: 1, maxLength: 30 }),
    endedAt: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    topicsCovered: fc.array(fc.string({ minLength: 1, maxLength: 16 }), { maxLength: 5 }),
  }), { maxLength: 5 }),
  profile: fc.record({
    id: fc.string({ minLength: 1, maxLength: 16 }),
    priorKnowledge: fc.double({ min: 0, max: 1, noNaN: true }),
    abstractionComfort: fc.double({ min: 0, max: 1, noNaN: true }),
    analogyNeed: fc.double({ min: 0, max: 1, noNaN: true }),
    dialoguePreference: fc.double({ min: 0, max: 1, noNaN: true }),
    diagramAffinity: fc.double({ min: 0, max: 1, noNaN: true }),
    persistence: fc.double({ min: 0, max: 1, noNaN: true }),
    transferDesire: fc.double({ min: 0, max: 1, noNaN: true }),
    anxiety: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
});

// ─── estimateRetention properties (via computeTopicEngagement) ────────────

test("ALWAYS: estimatedRetention is in [0, 1]", () => {
  fc.assert(fc.property(
    arbCoveredTopic, arbEngagementPolicy,
    (topic, policy) => {
      const engagement = computeTopicEngagement(topic, policy);
      expect(engagement.estimatedRetention).toBeGreaterThanOrEqual(0);
      expect(engagement.estimatedRetention).toBeLessThanOrEqual(1);
    }
  ));
});

test("ALWAYS: urgency is in [0, 1]", () => {
  fc.assert(fc.property(
    arbCoveredTopic, arbEngagementPolicy,
    (topic, policy) => {
      const engagement = computeTopicEngagement(topic, policy);
      expect(engagement.urgency).toBeGreaterThanOrEqual(0);
      expect(engagement.urgency).toBeLessThanOrEqual(1);
    }
  ));
});

test("ALWAYS: retention equals mastery for day-zero topics", () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.constantFrom("math", "science", "philosophy"),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.integer({ min: 1, max: 50 }),
    (slug, domain, mastery, sessionCount) => {
      const now = new Date();
      const topic = {
        slug, domain,
        lastSeen: now.toISOString(),
        masteryEstimate: mastery,
        sessionCount,
      };
      const engagement = computeTopicEngagement(topic, DEFAULT_ENGAGEMENT_POLICY, now);
      expect(Math.abs(engagement.estimatedRetention - mastery)).toBeLessThan(0.001);
    }
  ));
});

test("ALWAYS: retention decreases over time for any mastery < 1", () => {
  fc.assert(fc.property(
    fc.double({ min: 0.1, max: 0.9, noNaN: true }),
    fc.integer({ min: 1, max: 100 }),
    (mastery, daysAgo) => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 86400000);
      const oldDate = new Date(now.getTime() - daysAgo * 86400000);

      const recentTopic = {
        slug: "test", domain: "math" as const,
        lastSeen: recentDate.toISOString(),
        masteryEstimate: mastery,
        sessionCount: 5,
      };
      const oldTopic = {
        slug: "test", domain: "math" as const,
        lastSeen: oldDate.toISOString(),
        masteryEstimate: mastery,
        sessionCount: 5,
      };

      const recentEngagement = computeTopicEngagement(recentTopic, DEFAULT_ENGAGEMENT_POLICY, now);
      const oldEngagement = computeTopicEngagement(oldTopic, DEFAULT_ENGAGEMENT_POLICY, now);

      expect(oldEngagement.estimatedRetention).toBeLessThanOrEqual(recentEngagement.estimatedRetention + 0.001);
    }
  ));
});

test("ALWAYS: computeTopicEngagement returns valid urgency label", () => {
  fc.assert(fc.property(
    arbCoveredTopic, arbEngagementPolicy,
    (topic, policy) => {
      const engagement = computeTopicEngagement(topic, policy);
      expect(["critical", "high", "moderate", "low", "fresh"]).toContain(engagement.urgencyLabel);
    }
  ));
});

// ─── buildEngagementTimeline properties ─────────────────────────────────────

test("ALWAYS: buildEngagementTimeline returns valid summary", () => {
  fc.assert(fc.property(
    arbLearnerState, arbEngagementPolicy,
    (state, policy) => {
      const timeline = buildEngagementTimeline(state, policy);
      expect(timeline.summary.totalTopics).toBe(state.coveredTopics.length);
      expect(timeline.summary.dueCount).toBeGreaterThanOrEqual(0);
      expect(timeline.summary.criticalCount).toBeGreaterThanOrEqual(0);
      expect(timeline.summary.averageRetention).toBeGreaterThanOrEqual(0);
      expect(timeline.summary.averageRetention).toBeLessThanOrEqual(1);
    }
  ));
});

test("ALWAYS: timeline topics are sorted by urgency descending", () => {
  fc.assert(fc.property(
    arbLearnerState.filter(s => s.coveredTopics.length >= 2),
    (state) => {
      const stateCopy: LearnerState = JSON.parse(JSON.stringify(state));
      const timeline = buildEngagementTimeline(stateCopy);
      for (let i = 1; i < timeline.topics.length; i++) {
        expect(timeline.topics[i]!.urgency).toBeLessThanOrEqual(timeline.topics[i - 1]!.urgency + 0.001);
      }
    }
  ));
});

test("ALWAYS: empty learner state produces empty timeline", () => {
  const emptyState: LearnerState = {
    id: "test",
    coveredTopics: [],
    identifiedMisconceptions: [],
    feedback: [],
    sessions: [],
    profile: {
      id: "test",
      priorKnowledge: 0.5,
      abstractionComfort: 0.5,
      analogyNeed: 0.5,
      dialoguePreference: 0.5,
      diagramAffinity: 0.5,
      persistence: 0.5,
      transferDesire: 0.5,
      anxiety: 0.3,
    },
  };
  const timeline = buildEngagementTimeline(emptyState);
  expect(timeline.summary.totalTopics).toBe(0);
  expect(timeline.summary.dueCount).toBe(0);
  expect(timeline.topics.length).toBe(0);
});

test("ALWAYS: dueCount never exceeds totalTopics", () => {
  fc.assert(fc.property(
    arbLearnerState,
    (state) => {
      const timeline = buildEngagementTimeline(state);
      expect(timeline.summary.dueCount).toBeLessThanOrEqual(timeline.summary.totalTopics);
    }
  ));
});

// ─── dueTopics properties ──────────────────────────────────────────────────

test("ALWAYS: dueTopics returns subset of covered topics", () => {
  fc.assert(fc.property(
    arbLearnerState,
    (state) => {
      const due = dueTopics(state);
      for (const topic of due) {
        expect(topic.isDue).toBe(true);
      }
    }
  ));
});
