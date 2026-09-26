import { expect, test } from "bun:test";
import { FIELDS, FIELD_FAMILY, FIELD_PROTOTYPES, guessField } from "../shared/pedagogy/domains.js";
import type { Domain } from "../shared/pedagogy/types.js";
import { resolveTopic } from "../src/core/topics.js";

const DOMAINS: readonly Domain[] = ["math", "science", "philosophy", "code", "law", "politics", "psychology", "medicine", "arts", "history", "general"];

test("guessField fixes the verified compound misroutes", () => {
  expect(guessField("memory-management")).toBe("computing");
  expect(guessField("wave-function")).toBe("physics");
  expect(guessField("photosynthesis")).toBe("biology");
  expect(guessField("recursion")).toBe("computing");
  expect(guessField("machine-learning")).toBe("data-science");
  expect(guessField("the-krebs-cycle")).toBe("biology");
  expect(guessField("quantum-computing")).toBe("computing");
  expect(guessField("class-inheritance")).toBe("computing");
  expect(guessField("civil-rights")).toBe("law");
  expect(guessField("anatomy")).toBe("biology");
});

test("guessField abstains rather than claiming a subject", () => {
  expect(guessField("supply-and-demand")).toBeNull();
  expect(guessField("flibbertigibbet")).toBeNull();
  expect(guessField("")).toBeNull();
});

test("the field taxonomy is total and maps onto valid families", () => {
  expect(new Set(FIELDS).size).toBe(FIELDS.length);
  for (const field of FIELDS) {
    expect(FIELD_FAMILY[field]).toBeDefined();
    expect(DOMAINS).toContain(FIELD_FAMILY[field]);
    expect(typeof FIELD_PROTOTYPES[field]).toBe("string");
    expect(FIELD_PROTOTYPES[field]!.length).toBeGreaterThan(20);
  }
});

test("resolveTopic keeps its synchronous family fallback and curated exactness", () => {
  expect(resolveTopic("photosynthesis").domain).toBe("science");
  expect(resolveTopic("memory management").domain).toBe("code");
  expect(resolveTopic("quantum computing").domain).toBe("code");
  expect(resolveTopic("flibbertigibbet").domain).toBe("general");
  expect(resolveTopic("derivative").domain).toBe("math");
});
