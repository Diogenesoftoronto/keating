import { expect, test } from "bun:test";
import { createMobileNeedleRecall, mobileNeedleArtifactSources, mobileNeedleSources } from "../src/lib/needle-retrieval";
import type { ChatSession } from "../src/lib/types";

const sessions: ChatSession[] = [{ id: "s", title: "Lesson", createdAt: 1, updatedAt: 4, messages: [
  { id: "prior", role: "user", content: "I grow tomatoes.", createdAt: 1 },
  { id: "assistant", role: "assistant", content: "Fabricated learner fact", createdAt: 2 },
  { id: "now", role: "user", content: "Explain photosynthesis", createdAt: 3 },
  { id: "future", role: "user", content: "Later fact", createdAt: 4 },
] }];
const turn = { sessionId: "s", messageId: "now", createdAt: 3, query: "Explain photosynthesis" };
const vector = [1, ...Array(3071).fill(0)];
test("mobile recall uses only exact earlier learner text", async () => {
  const sources = mobileNeedleSources(sessions, turn);
  expect(sources.map(row => row.text)).toEqual(["I grow tomatoes."]);
  const recall = createMobileNeedleRecall(async texts => ({ model: "pinned", dimensions: 3072, vectors: texts.map(() => vector) }));
  const prompt = await recall.prompt(sessions, turn, { signal: new AbortController().signal, current: () => true, currentSessions: () => sessions });
  expect(prompt).toContain("I grow tomatoes.");
  expect(prompt).not.toContain("Fabricated learner fact");
  expect(prompt).not.toContain("Later fact");
  expect(prompt).toContain('"messageId":"prior"');
});
test("source edits during inference and account invalidation discard recalled text", async () => {
  let current = true;
  let live = structuredClone(sessions);
  const recall = createMobileNeedleRecall(async texts => {
    live[0].messages[0].content = "Changed";
    return { model: "pinned", dimensions: 3072, vectors: texts.map(() => vector) };
  });
  expect(await recall.prompt(sessions, turn, { signal: new AbortController().signal, current: () => current, currentSessions: () => live })).toBe("");
  current = false; live = structuredClone(sessions);
  expect(await recall.prompt(sessions, turn, { signal: new AbortController().signal, current: () => current, currentSessions: () => live })).toBe("");
});
test("library windows retain exact artifact offsets and separate provenance", () => {
  const text = "photosynthesis ".repeat(100);
  const sources = mobileNeedleArtifactSources([{ id: "a", kind: "note", title: "Plants", content: text, createdAt: 1 }]);
  expect(sources).toHaveLength(2);
  expect(sources[1].text).toBe(text.slice(500, 1000));
  expect(sources[0].kind).toBe("artifact");
  expect(sources[0].artifactId).toBe("a");
});

test("equal-clock later messages and an edited triggering query cannot become historical recall", async () => {
  const sameClock = structuredClone(sessions);
  sameClock[0].messages.at(-1)!.createdAt = turn.createdAt;
  expect(mobileNeedleSources(sameClock, turn).map(row => row.text)).toEqual(["I grow tomatoes."]);
  const recall = createMobileNeedleRecall(async texts => {
    sameClock[0].messages.find(row => row.id === "now")!.content = "Different question";
    return { model: "pinned", dimensions: 3072, vectors: texts.map(() => vector) };
  });
  expect(await recall.prompt(sameClock, turn, { signal: new AbortController().signal, current: () => true, currentSessions: () => sameClock })).toBe("");
});
