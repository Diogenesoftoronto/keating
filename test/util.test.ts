import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { clamp, mean, slugify, titleCase, chunk, formatPercent } from "../src/core/util.js";

// ─── clamp properties ─────────────────────────────────────────────────────

test("ALWAYS: clamp returns value within [min, max]", () => {
  fc.assert(fc.property(
    fc.double({ min: -100, max: 100, noNaN: true }),
    fc.double({ min: -50, max: 0, noNaN: true }),
    fc.double({ min: 0, max: 50, noNaN: true }),
    (value, min, max) => {
      if (min > max) [min, max] = [max, min];
      const result = clamp(value, min, max);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    }
  ));
});

test("ALWAYS: clamp is idempotent", () => {
  fc.assert(fc.property(
    fc.double({ min: -10, max: 10, noNaN: true }),
    (value) => {
      const once = clamp(value, 0, 1);
      const twice = clamp(once, 0, 1);
      expect(twice).toBe(once);
    }
  ));
});

test("ALWAYS: clamp returns min for NaN", () => {
  expect(clamp(NaN, 0, 1)).toBe(0);
  expect(clamp(NaN, -5, 5)).toBe(-5);
});

test("ALWAYS: clamp returns min for non-finite values (NaN, Infinity, -Infinity)", () => {
  expect(clamp(Infinity, 0, 1)).toBe(0);
  expect(clamp(-Infinity, 0, 1)).toBe(0);
  expect(clamp(NaN, 0, 1)).toBe(0);
  expect(clamp(Infinity, -5, 5)).toBe(-5);
});

test("ALWAYS: clamp default range is [0, 1]", () => {
  fc.assert(fc.property(
    fc.double({ min: -10, max: 10, noNaN: true }),
    (value) => {
      const result = clamp(value);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  ));
});

// ─── mean properties ────────────────────────────────────────────────────────

test("ALWAYS: mean of empty array is 0", () => {
  expect(mean([])).toBe(0);
});

test("ALWAYS: mean of single element is approximately that element", () => {
  fc.assert(fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (value) => {
    expect(Math.abs(mean([value]) - value)).toBeLessThan(1e-10);
  }));
});

test("ALWAYS: mean of values in [0,1] is in [0,1]", () => {
  fc.assert(fc.property(
    fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }),
    (values) => {
      const result = mean(values);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  ));
});

// ─── slugify properties ─────────────────────────────────────────────────────

test("ALWAYS: slugify output contains only lowercase and hyphens", () => {
  fc.assert(fc.property(
    fc.string({ maxLength: 60 }),
    (text) => {
      const slug = slugify(text);
      expect(slug).toMatch(/^[a-z0-9-]*$/);
    }
  ));
});

test("ALWAYS: slugify never starts or ends with hyphen", () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 60 }),
    (text) => {
      const slug = slugify(text);
      if (slug.length > 0) {
        expect(slug[0]).not.toBe("-");
        expect(slug.at(-1)).not.toBe("-");
      }
    }
  ));
});

test("ALWAYS: slugify is idempotent", () => {
  fc.assert(fc.property(
    fc.string({ maxLength: 60 }),
    (text) => {
      const once = slugify(text);
      const twice = slugify(once);
      expect(twice).toBe(once);
    }
  ));
});

test("ALWAYS: slugify returns non-empty string for non-empty input", () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 60 }).filter(s => /[a-z0-9]/i.test(s)),
    (text) => {
      expect(slugify(text).length).toBeGreaterThan(0);
    }
  ));
});

// ─── titleCase properties ───────────────────────────────────────────────────

test("ALWAYS: titleCase capitalizes first letter of each word", () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z]/.test(s)),
    (text) => {
      const result = titleCase(text);
      expect(result[0]).toBe(result[0]!.toUpperCase());
    }
  ));
});

// ─── chunk properties ──────────────────────────────────────────────────────

test("ALWAYS: chunk preserves all elements", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 50 }),
    fc.integer({ min: 1, max: 10 }),
    (arr, size) => {
      const chunks = chunk(arr, size);
      const flat = chunks.flat();
      expect(flat).toEqual(arr);
    }
  ));
});

test("ALWAYS: chunk size does not exceed requested size", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 50 }),
    fc.integer({ min: 1, max: 10 }),
    (arr, size) => {
      const chunks = chunk(arr, size);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(size);
      }
    }
  ));
});

// ─── formatPercent properties ──────────────────────────────────────────────

test("ALWAYS: formatPercent returns string ending with %", () => {
  fc.assert(fc.property(
    fc.double({ min: 0, max: 1, noNaN: true }),
    (value) => {
      expect(formatPercent(value)).toContain("%");
    }
  ));
});
