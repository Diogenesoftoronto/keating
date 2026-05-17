import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { Prng } from "../src/core/random.js";

// ─── Prng next() properties ────────────────────────────────────────────────

test("ALWAYS: Prng.next() returns value in [0, 1)", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 999999 }),
    (seed) => {
      const prng = new Prng(seed);
      for (let i = 0; i < 100; i++) {
        const val = prng.next();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    }
  ));
});

test("ALWAYS: Prng is deterministic for same seed", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 999999 }),
    (seed) => {
      const a = new Prng(seed);
      const b = new Prng(seed);
      for (let i = 0; i < 50; i++) {
        expect(a.next()).toBe(b.next());
      }
    }
  ));
});

test("ALWAYS: Prng.int() returns value in [min, max]", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 999999 }),
    fc.integer({ min: -100, max: 100 }),
    fc.integer({ min: -100, max: 100 }),
    (seed, min, max) => {
      if (min > max) [min, max] = [max, min];
      const prng = new Prng(seed);
      for (let i = 0; i < 50; i++) {
        const val = prng.int(min, max);
        expect(val).toBeGreaterThanOrEqual(min);
        expect(val).toBeLessThanOrEqual(max);
      }
    }
  ));
});

test("ALWAYS: Prng.pick() returns an element from the array", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 999999 }),
    fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 10 }),
    (seed, items) => {
      const prng = new Prng(seed);
      for (let i = 0; i < 20; i++) {
        const picked = prng.pick(items);
        expect(items.includes(picked)).toBe(true);
      }
    }
  ));
});

test("ALWAYS: different seeds produce different sequences", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 999999 }),
    fc.integer({ min: 0, max: 999999 }).filter(s2 => s2 !== 0),
    (seed, offset) => {
      const a = new Prng(seed);
      const b = new Prng(seed + offset);
      let sameCount = 0;
      for (let i = 0; i < 10; i++) {
        if (a.next() === b.next()) sameCount++;
      }
      expect(sameCount).toBeLessThan(10);
    }
  ));
});
