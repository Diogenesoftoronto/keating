import { expect, test } from "bun:test";
import { MemoryStorage } from "./helpers/memory-storage";
import { renderToStaticMarkup } from "react-dom/server";
import { learningSourceHash, type LearningEvidenceAnchor } from "@keating/learner-contracts";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { LearningReferenceScope, revealLearningReference } from "../components/LearningReferenceLink";
import { findLearningReference, forgetLearningReferences, learningReferenceFromHref, learningReferenceId, rememberLearningReferences, type LearningReference } from "../keating/learning-intelligence/references";

const message = "I think autonomy matters more than compliance in a classroom.";
const quote = "autonomy matters more than compliance";
const anchor: LearningEvidenceAnchor = { sessionId: "s1", messageId: "m1", quote, start: message.indexOf(quote), end: message.indexOf(quote) + quote.length, sourceHash: learningSourceHash(message) };
const reference: LearningReference = { id: learningReferenceId(anchor), kind: "learner-idea", anchor };


test("reference ids are stable, short, and only #ref- fragments resolve", () => {
  expect(reference.id).toMatch(/^ref-[0-9a-f]{10}$/);
  expect(learningReferenceId({ ...anchor })).toBe(reference.id);
  expect(learningReferenceId({ ...anchor, start: anchor.start + 1 })).not.toBe(reference.id);
  expect(learningReferenceFromHref(`#${reference.id}`)).toBe(reference.id);
  for (const href of [reference.id, `https://example.com/#${reference.id}`, "#ref-XYZ", undefined]) expect(learningReferenceFromHref(href)).toBeNull();
});

test("the index keeps references per conversation, deduplicates, and forgets on opt-out", () => {
  const storage = new MemoryStorage();
  rememberLearningReferences("s1", [reference, reference], storage);
  expect(findLearningReference("s1", reference.id, storage)).toEqual(reference);
  expect(findLearningReference("s2", reference.id, storage)).toBeNull();
  expect(JSON.parse(storage.getItem("keating:learning-references:v1:s1")!)).toHaveLength(1);
  // A reference stored under another conversation is never trusted.
  storage.setItem("keating:learning-references:v1:s3", JSON.stringify([reference]));
  expect(findLearningReference("s3", reference.id, storage)).toBeNull();
  forgetLearningReferences("s1", storage);
  expect(findLearningReference("s1", reference.id, storage)).toBeNull();
});

test("a cited reply renders a chip naming the passage kind; unknown refs stay plain", () => {
  const storage = new MemoryStorage();
  rememberLearningReferences("s1", [reference], storage);
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
  const render = (content: string) => renderToStaticMarkup(<LearningReferenceScope.Provider value="s1"><MarkdownBlock content={content} /></LearningReferenceScope.Provider>);
  const cited = render(`You said [autonomy beats compliance](#${reference.id}).`);
  expect(cited).toContain(`data-learning-reference="${reference.id}"`);
  expect(cited).toContain("<button");
  expect(cited).not.toContain(`href="#${reference.id}"`);
  const unknown = render("See [this](#ref-0000000000).");
  expect(unknown).toContain("no longer available");
  expect(unknown).not.toContain("<button");
  // Ordinary links are untouched.
  expect(render("[site](https://erikatwani.com/)")).toContain('href="https://erikatwani.com/"');
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test("revealing a reference scrolls to its single source row, and declines to guess", () => {
  const rows: Array<{ ids: string[] }> = [];
  let scrolled = 0, focused = 0;
  const root = { querySelectorAll: () => rows.map(row => ({
    dataset: { learningSessionId: "s1", learningMessageIds: JSON.stringify(row.ids) },
    scrollIntoView: () => { scrolled++; }, focus: () => { focused++; },
  })) } as unknown as Pick<Document, "querySelectorAll">;
  rows.push({ ids: ["m1"] });
  expect(revealLearningReference(reference, root)).toBe(true);
  expect([scrolled, focused]).toEqual([1, 1]);
  rows.push({ ids: ["m1"] });
  expect(revealLearningReference(reference, root)).toBe(false);
  rows.splice(0, rows.length, { ids: ["other"] });
  expect(revealLearningReference(reference, root)).toBe(false);
  expect(scrolled).toBe(1);
});
