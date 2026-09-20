import { expect, test } from "bun:test";
import { rankingHoldoutAssignment } from "../src/judgement/ranking-holdout.js";

test("pins portable versioned UTF-8 assignments including astral Unicode and encoded separators", () => {
  // Independent Python UTF-8/unsigned FNV-1a calculation, not captured JS output.
  for (const [namespace, key, bucket] of [
    ["course-a", "lesson-1", 5295],
    ["course-a", "lesson-2", 8726],
    ["course-🌱", "résumé/🚀", 2739],
    ["a", "b\0c", 5389],
    ["a\0b", "c", 2941],
  ] as const) {
    expect(rankingHoldoutAssignment(namespace, key, 1000)).toEqual({ policyVersion: "stable-item-v1", bucket, heldOut: bucket < 1000 });
  }
});

test("reordering, inserting, and removing results never changes a retained item's assignment", () => {
  const keys = ["lesson-1", "lesson-2", "quiz-1", "activity-1"];
  const baseline = new Map(keys.map(key => [key, rankingHoldoutAssignment("course-a", key, 1000)]));
  for (const list of [[...keys].reverse(), ["new-first", ...keys, "new-last"], [keys[2]!, keys[0]!]]) {
    for (const key of list) if (baseline.has(key)) expect(rankingHoldoutAssignment("course-a", key, 1000)).toEqual(baseline.get(key)!);
  }
  expect(rankingHoldoutAssignment("course-a", "lesson-1", 1000)).not.toEqual(rankingHoldoutAssignment("course-b", "lesson-1", 1000));
});

test("basis points set only the bucket boundary, including empty and complete control populations", () => {
  const assignment = rankingHoldoutAssignment("course-a", "lesson-1", 1000);
  expect(rankingHoldoutAssignment("course-a", "lesson-1", 0).heldOut).toBe(false);
  expect(rankingHoldoutAssignment("course-a", "lesson-1", 10_000).heldOut).toBe(true);
  expect(rankingHoldoutAssignment("course-a", "lesson-1", assignment.bucket).heldOut).toBe(false);
  expect(rankingHoldoutAssignment("course-a", "lesson-1", assignment.bucket + 1).heldOut).toBe(true);
  for (let index = 0; index < 128; index++) {
    const item = rankingHoldoutAssignment("course-a", `item-${index}`, 1000);
    expect(Number.isInteger(item.bucket) && item.bucket >= 0 && item.bucket < 10_000).toBe(true);
  }
});

test("invalid allocation policy and identities fail instead of coercing or Unicode-aliasing", () => {
  for (const value of [-1, 10_001, 0.1, NaN, Infinity, "1000", null, undefined]) {
    expect(() => rankingHoldoutAssignment("course", "item", value as number)).toThrow(RangeError);
  }
  for (const identity of ["", " \n", "\ud800", "x\udfff", null, undefined, 123]) {
    expect(() => rankingHoldoutAssignment(identity as string, "item", 1000)).toThrow(TypeError);
    expect(() => rankingHoldoutAssignment("course", identity as string, 1000)).toThrow(TypeError);
  }
});
