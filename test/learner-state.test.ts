import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { recordTopicCoverage, recordMisconception, recordFeedback, recordSessionStart, recordSessionEnd } from "../src/core/learner-state.js";
import type { LearnerState, TopicDefinition, Domain } from "../src/core/types.js";
import { clamp } from "../src/core/util.js";

const arbLearnerState: fc.Arbitrary<LearnerState> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  coveredTopics: fc.array(fc.record({
    slug: fc.string({ minLength: 1, maxLength: 24 }),
    domain: fc.constantFrom("math", "science", "philosophy", "code", "law", "politics", "psychology", "medicine", "arts", "history", "general") as fc.Arbitrary<Domain>,
    lastSeen: fc.string({ minLength: 1, maxLength: 30 }),
    masteryEstimate: fc.double({ min: 0, max: 1, noNaN: true }),
    sessionCount: fc.integer({ min: 1, max: 50 }),
  }), { maxLength: 5 }),
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

const arbTopicDef: fc.Arbitrary<TopicDefinition> = fc.record({
  slug: fc.string({ minLength: 1, maxLength: 24 }),
  title: fc.string({ minLength: 1, maxLength: 48 }),
  domain: fc.constantFrom("math", "science", "philosophy", "code", "law", "politics", "psychology", "medicine", "arts", "history", "general") as fc.Arbitrary<Domain>,
  summary: fc.string({ maxLength: 200 }),
  intuition: fc.constant([]),
  formalCore: fc.constant([]),
  prerequisites: fc.constant([]),
  misconceptions: fc.constant([]),
  examples: fc.constant([]),
  exercises: fc.constant([]),
  reflections: fc.constant([]),
  diagramNodes: fc.constant([]),
  formalism: fc.double({ min: 0, max: 1, noNaN: true }),
  visualizable: fc.boolean(),
  interdisciplinaryHooks: fc.constant([]),
});

// ─── recordTopicCoverage properties ─────────────────────────────────────────

test("ALWAYS: recordTopicCoverage adds topic to coveredTopics", () => {
  fc.assert(fc.property(
    arbLearnerState, arbTopicDef,
    (state, topic) => {
      const updated = recordTopicCoverage(state, topic, 0.5);
      expect(updated.coveredTopics.some(t => t.slug === topic.slug)).toBe(true);
    }
  ));
});

test("ALWAYS: recordTopicCoverage clamps mastery to [0, 1]", () => {
  fc.assert(fc.property(
    arbLearnerState, arbTopicDef,
    fc.double({ min: -10, max: 10, noNaN: true }),
    (state, topic, mastery) => {
      const updated = recordTopicCoverage(state, topic, mastery);
      const covered = updated.coveredTopics.find(t => t.slug === topic.slug);
      expect(covered!.masteryEstimate).toBeGreaterThanOrEqual(0);
      expect(covered!.masteryEstimate).toBeLessThanOrEqual(1);
    }
  ));
});

test("ALWAYS: recordTopicCoverage is idempotent for same topic (updates existing)", () => {
  fc.assert(fc.property(
    arbLearnerState, arbTopicDef,
    (state, topic) => {
      const first = recordTopicCoverage(state, topic, 0.5);
      const second = recordTopicCoverage(first, topic, 0.7);
      const matching = second.coveredTopics.filter(t => t.slug === topic.slug);
      expect(matching.length).toBe(1);
      expect(matching[0]!.masteryEstimate).toBe(0.7);
    }
  ));
});

test("ALWAYS: recordTopicCoverage increments sessionCount for existing topic", () => {
  fc.assert(fc.property(
    arbLearnerState, arbTopicDef,
    (state, topic) => {
      const first = recordTopicCoverage(state, topic, 0.5);
      const covered = first.coveredTopics.find(t => t.slug === topic.slug);
      const initialCount = covered!.sessionCount;
      const second = recordTopicCoverage(first, topic, 0.6);
      const updated = second.coveredTopics.find(t => t.slug === topic.slug);
      expect(updated!.sessionCount).toBe(initialCount + 1);
    }
  ));
});

// ─── recordMisconception properties ─────────────────────────────────────────

test("ALWAYS: recordMisconception adds entry", () => {
  fc.assert(fc.property(
    arbLearnerState,
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.string({ minLength: 1, maxLength: 60 }),
    (state, topic, misconception) => {
      const updated = recordMisconception(state, topic, misconception);
      expect(updated.identifiedMisconceptions.some(
        m => m.topic === topic && m.misconception === misconception
      )).toBe(true);
    }
  ));
});

test("ALWAYS: recordMisconception is idempotent (no duplicates)", () => {
  fc.assert(fc.property(
    arbLearnerState,
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.string({ minLength: 1, maxLength: 60 }),
    (state, topic, misconception) => {
      const first = recordMisconception(state, topic, misconception);
      const second = recordMisconception(first, topic, misconception);
      const matching = second.identifiedMisconceptions.filter(
        m => m.topic === topic && m.misconception === misconception
      );
      expect(matching.length).toBe(1);
    }
  ));
});

// ─── recordFeedback properties ──────────────────────────────────────────────

test("ALWAYS: recordFeedback appends without modifying existing entries", () => {
  fc.assert(fc.property(
    arbLearnerState,
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.constantFrom("thumbs-up", "thumbs-down", "confused"),
    (state, topic, signal) => {
      const prevLength = state.feedback.length;
      const updated = recordFeedback(state, topic, signal);
      expect(updated.feedback.length).toBe(prevLength + 1);
      const last = updated.feedback[updated.feedback.length - 1];
      expect(last!.signal).toBe(signal);
      expect(last!.topic).toBe(topic);
    }
  ));
});

// ─── recordSessionStart/End properties ──────────────────────────────────────

test("ALWAYS: recordSessionStart adds a session", () => {
  fc.assert(fc.property(arbLearnerState, (state) => {
    const prevCount = state.sessions.length;
    const updated = recordSessionStart(state);
    expect(updated.sessions.length).toBe(prevCount + 1);
    const last = updated.sessions[updated.sessions.length - 1];
    expect(last!.endedAt).toBeUndefined();
  }));
});

test("ALWAYS: recordSessionEnd closes the last session", () => {
  fc.assert(fc.property(arbLearnerState, (state) => {
    const started = recordSessionStart(state);
    const ended = recordSessionEnd(started, ["derivative"]);
    const lastSession = ended.sessions[ended.sessions.length - 1];
    expect(lastSession!.endedAt).toBeDefined();
    expect(lastSession!.topicsCovered).toEqual(["derivative"]);
  }));
});
