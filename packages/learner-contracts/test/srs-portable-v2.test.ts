import { describe, expect, test } from "bun:test";
import {
  ContractValidationError,
  LEARNER_CONTRACT_VERSION,
  MergeConflictError,
  PORTABLE_LEARNER_DATA_KIND,
  applyReview,
  createPortableLearnerEnvelope,
  formatDueIn,
  formatInterval,
  initialSrsState,
  isDue,
  mergePortableLearnerData,
  mergeStudyPriorities,
  parsePortableLearnerEnvelope,
} from "../src/index.js";
import { portableLearnerFixture } from "./fixtures.js";

const T0 = "2026-08-10T00:00:00.000Z";

describe("portable v2 SRS and review contracts", () => {
  test("matches web SM-2 outcomes exactly, including Again's ten-minute re-show", () => {
    const fresh = initialSrsState(T0);
    expect(fresh).toMatchObject({ ease: 2.5, intervalDays: 0, repetitions: 0, lapses: 0, dueAt: T0, lastReviewedAt: null, lastRating: null });

    const again = applyReview(fresh, 0, T0);
    expect(again).toMatchObject({ appliedIntervalDays: 0, isLapse: true });
    expect(again.next).toMatchObject({ ease: 2.3, repetitions: 0, lapses: 1, dueAt: "2026-08-10T00:10:00.000Z", lastRating: 0 });

    const hard = applyReview(again.next, 1, "2026-08-10T00:10:00.000Z");
    expect(hard.next).toMatchObject({ ease: 2.15, intervalDays: 1, repetitions: 1, lapses: 1, dueAt: "2026-08-11T00:10:00.000Z" });
    const good = applyReview(hard.next, 2, "2026-08-11T00:10:00.000Z");
    expect(good.next).toMatchObject({ ease: 2.15, intervalDays: 6, repetitions: 2, dueAt: "2026-08-17T00:10:00.000Z" });
    const easy = applyReview(good.next, 3, "2026-08-17T00:10:00.000Z");
    expect(easy.next).toMatchObject({ ease: 2.3, intervalDays: 18, repetitions: 3, dueAt: "2026-09-04T00:10:00.000Z" });
    expect(isDue(easy.next, "2026-09-04T00:10:00.000Z")).toBe(true);
    expect(formatInterval(1 / 24 / 6 - 0.000001)).toBe("10m");
    expect(formatDueIn("2026-08-10T00:10:00.000Z", T0)).toBe("in 10m");
  });

  test("migrates v1 cards and reviews explicitly without claiming a historical schedule", () => {
    const v2 = portableLearnerFixture();
    const v1Payload = structuredClone(v2) as unknown as Record<string, unknown>;
    delete v1Payload.studyPriorities;
    delete v1Payload.benchmarks;
    delete v1Payload.evolutions;
    const decks = v1Payload.decks as Array<{ cards: Array<Record<string, unknown>> }>;
    for (const card of decks[0]!.cards) delete card.srs;
    const reviews = v1Payload.cardReviews as Array<Record<string, unknown>>;
    for (const review of reviews) {
      delete review.previousIntervalDays;
      delete review.nextDueAt;
      delete review.repetitionsAfter;
      delete review.lapsesAfter;
      delete review.isLapse;
      delete review.legacyScheduleUnknown;
    }
    const migrated = parsePortableLearnerEnvelope({
      kind: PORTABLE_LEARNER_DATA_KIND,
      schemaVersion: 1,
      payload: v1Payload,
    });

    expect(migrated.schemaVersion).toBe(LEARNER_CONTRACT_VERSION);
    expect(migrated.payload.studyPriorities).toEqual([]);
    expect(migrated.payload.benchmarks).toEqual([]);
    expect(migrated.payload.evolutions).toEqual([]);
    expect(migrated.payload.decks[0]!.cards[0]!.srs).toEqual(initialSrsState(T0));
    expect(migrated.payload.cardReviews[0]).toMatchObject({ legacyScheduleUnknown: true });
    expect(migrated.payload.cardReviews[0]!.nextDueAt).toBeUndefined();
    expect(createPortableLearnerEnvelope(migrated.payload).schemaVersion).toBe(LEARNER_CONTRACT_VERSION);
  });

  test("validates immutable review outcomes against the current card schedule", () => {
    const mismatch = portableLearnerFixture();
    mismatch.cardReviews[0]!.nextDueAt = "2026-08-12T00:00:00.000Z";
    expect(() => createPortableLearnerEnvelope(mismatch)).toThrow(ContractValidationError);

    const staleCard = portableLearnerFixture();
    staleCard.decks[0]!.cards[0]!.srs.dueAt = "2026-08-12T00:00:00.000Z";
    expect(() => createPortableLearnerEnvelope(staleCard)).toThrow(ContractValidationError);
  });

  test("keeps one explicit priority per target and merges by target rather than device-local id", () => {
    const withPriority = portableLearnerFixture();
    withPriority.studyPriorities = [{ id: "priority-device-a", targetType: "deck", targetId: "deck-1", priority: "focus", updatedAt: T0 }];
    expect(createPortableLearnerEnvelope(withPriority).payload.studyPriorities).toHaveLength(1);

    const duplicate = structuredClone(withPriority);
    duplicate.studyPriorities.push({ id: "priority-device-b", targetType: "deck", targetId: "deck-1", priority: "low", updatedAt: "2026-08-11T00:00:00.000Z" });
    expect(() => createPortableLearnerEnvelope(duplicate)).toThrow(ContractValidationError);

    const missingReference = structuredClone(withPriority);
    missingReference.studyPriorities[0]!.targetId = "missing-deck";
    expect(() => createPortableLearnerEnvelope(missingReference)).toThrow(ContractValidationError);

    const later = [{ id: "priority-device-b", targetType: "deck" as const, targetId: "deck-1", priority: "maintain" as const, updatedAt: "2026-08-11T00:00:00.000Z" }];
    expect(mergeStudyPriorities(withPriority.studyPriorities, later)).toEqual(later);
    expect(() => mergeStudyPriorities(withPriority.studyPriorities, [{ ...later[0]!, priority: "low", updatedAt: T0 }])).toThrow(MergeConflictError);

    const other = portableLearnerFixture();
    other.studyPriorities = later;
    const merged = mergePortableLearnerData(withPriority, other);
    expect(merged.studyPriorities).toEqual(later);
  });
});
