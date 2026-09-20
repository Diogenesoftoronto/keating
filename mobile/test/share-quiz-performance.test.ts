import { describe, expect, test } from "bun:test";
import { shareQuizPerformanceEvidence } from "../src/lib/judgement/share-quiz-performance";

function fakeIo(fail?: "write" | "share") {
  const events: string[] = [];
  let output = "";
  return { events, output: () => output, io: {
    async isSharingAvailable() { return true; },
    async createTemporaryJsonFile(name: string) {
      events.push("create");
      return { uri: `cache://${name}`, async writeText(text: string) { events.push("write"); output = text; if (fail === "write") throw new Error("write failed"); }, async delete() { events.push("delete"); } };
    },
    async share() { events.push("share"); if (fail === "share") throw new Error("share failed"); },
  } };
}
describe("native quiz evidence sharing", () => {
  test("shares the exact raw export then removes its temporary file", async () => {
    const fake = fakeIo();
    const evidence = { schemaVersion: 1, predictions: [{ answer: "private answer" }], observations: [] };
    expect(await shareQuizPerformanceEvidence(evidence, fake.io, () => true)).toBe("shared");
    expect(JSON.parse(fake.output())).toEqual(evidence);
    expect(fake.events).toEqual(["create", "write", "share", "delete"]);
  });
  for (const stage of ["write", "share"] as const) test(`cleans up on ${stage} failure`, async () => {
    const fake = fakeIo(stage);
    await expect(shareQuizPerformanceEvidence({}, fake.io, () => true)).rejects.toThrow();
    expect(fake.events.at(-1)).toBe("delete");
  });
  test("source changes during a write prevent stale sharing and still clean up", async () => {
    const fake = fakeIo(); let current = true;
    const original = fake.io.createTemporaryJsonFile;
    fake.io.createTemporaryJsonFile = async name => {
      const file = await original(name);
      return { ...file, async writeText(text) { await file.writeText(text); current = false; } };
    };
    expect(await shareQuizPerformanceEvidence({}, fake.io, () => current)).toBe("cancelled");
    expect(fake.events).toEqual(["create", "write", "delete"]);
  });
  test("cancelled requests create no export", async () => {
    const fake = fakeIo();
    expect(await shareQuizPerformanceEvidence({}, fake.io, () => false)).toBe("cancelled");
    expect(fake.events).toEqual([]);
  });
});
