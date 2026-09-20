import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runHarnessEpisode, validateHarnessRequest, type HarnessV3Request } from "./benchmark_harness_v3.js";

const cases = JSON.parse(readFileSync(new URL("./benchmarks/tutormoments-keating-v1/cases.json", import.meta.url), "utf8")).cases;

test("every adapted TutorMoments episode is accepted by the actual harness", () => {
  for (const episode of cases) {
    const request: HarnessV3Request = {
      id: episode.id, steps: episode.steps, transport: { kind: "tape", responses: [] },
    };
    expect(() => validateHarnessRequest(request)).not.toThrow();
    expect(JSON.stringify(request)).not.toContain(episode.source.moment_id);
  }
});

test("adapted learner events record real feedback and reopen the actual Pi session", async () => {
  const episode = cases.find((c: any) => c.id === "tm-fraction-visual-guess-resume");
  const result = await runHarnessEpisode({
    id: episode.id, steps: episode.steps,
    transport: { kind: "tape", responses: [
      { text: "Let us compare equal-sized wholes." },
      { tool_calls: [{ id: "tm-feedback", name: "feedback", arguments: { signal: "confused", topic: "fractions" } }] },
      { text: "The confusion is recorded. Let us look at two equal rectangles." },
      { text: "Compare one eighth and two eighths of the same rectangle." },
      { text: "For different-sized wholes we need their sizes too." },
    ] }, limits: { turn_timeout_ms: 20_000 },
  });
  expect(result.status).toBe("completed");
  expect(result.measurement).toBe("offline_integration");
  expect(result.steps[2]!.state.sessionId).toBe(result.steps[1]!.state.sessionId);
  const learner = JSON.parse(result.files.find((f: any) => f.path === ".keating/state/learner.json")!.content);
  expect(learner.feedback.some((f: any) => f.topic === "fractions" && f.signal === "confused")).toBe(true);
  expect(JSON.stringify(result.requests)).not.toContain(episode.source.moment_id);
}, 90_000);
