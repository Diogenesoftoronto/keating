import { expect, test } from "bun:test";
import { boundaryError, boundaryRequest, probeProviderBoundary } from "../scripts/context-window/jev-provider-boundary.js";

test("boundary search uses measured success and rejection, and tests each question from the rejected batch", async () => {
  for (const axis of ["state-question", "request"] as const) {
    const recorded = new Map<string, ReturnType<typeof boundaryRequest>>();
    const cap = axis === "state-question" ? 32_768 : 65_536;
    const result = await probeProviderBoundary(axis, async (kind, chars, group) => {
      const request = boundaryRequest(kind, chars, group);
      recorded.set(`${chars}:${group}`, request);
      const inputTokens = Math.ceil(JSON.stringify(request).length * .72);
      return inputTokens <= cap ? { result: "accepted", inputTokens, recall: true }
        : { result: "max_tokens_exceeded", inputTokens: null, recall: null };
    });
    expect(result.closestAccepted.inputTokens).toBeGreaterThan(cap * .99);
    expect(result.closestAccepted.inputTokens).toBeLessThanOrEqual(cap);
    expect(result.fillerGapFraction).toBeLessThanOrEqual(.005);
    expect(recorded.size).toBeLessThan(15);
    if (axis === "request") {
      const all = recorded.get(`${result.closestRejectedChars}:all`)!;
      const first = recorded.get(`${result.closestRejectedChars}:first-half`)!;
      const second = recorded.get(`${result.closestRejectedChars}:second-half`)!;
      expect(first.state).toEqual(all.state);
      expect(second.state).toEqual(all.state);
      expect({ ...first.questions, ...second.questions }).toEqual(all.questions);
      expect(Object.keys(all.questions)).toHaveLength(4);
    }
  }
});

test("missing provider usage and a failing split do not verify a boundary", async () => {
  await expect(probeProviderBoundary("state-question", async () => ({ result: "accepted", inputTokens: null, recall: true })))
    .rejects.toThrow("missing_usage_or_answer");
  await expect(probeProviderBoundary("request", async (_axis, chars, group) =>
    chars * 4 > 64_000 || group !== "all" ? { result: "max_tokens_exceeded", inputTokens: null, recall: null }
      : { result: "accepted", inputTokens: chars * 4, recall: false }
  )).rejects.toThrow("individual_question_limit_not_excluded");
});

test("provider error records retain context category and numeric fields without echoed requests", () => {
  expect(boundaryError({ detail: { error_type: "max_tokens_exceeded", observed: { per_question_context: 32_770 },
    input: { sensitiveTokenCount: 123 }, msg: "potentially echoed material" } }))
    .toEqual({ contextExceeded: true, numericFields: { "detail.observed.per_question_context": 32_770 } });
  expect(boundaryError({ detail: "invalid encoding", input: { reason: "max_tokens_exceeded" } }).contextExceeded).toBe(false);
  expect(boundaryError({ detail: { message: "max_tokens_exceeded" } }).contextExceeded).toBe(false);
});

test("dry-run reports the hard reservation and rejects an excessive requested number of dispatches", () => {
  const program = new URL("../scripts/context-window/jev-provider-boundary.ts", import.meta.url).pathname;
  const dry = Bun.spawnSync([process.execPath, program], { stdout: "pipe" });
  expect(dry.exitCode).toBe(0);
  expect(JSON.parse(dry.stdout.toString())).toMatchObject({ mode: "dry-run", maxCalls: 42,
    reservePerCallMicrousd: 2_800, maximumReservedMicrousd: 117_600, longContext: false });
  const oversized = Bun.spawnSync([process.execPath, program, "--max-calls", "43"], { stderr: "pipe" });
  expect(oversized.exitCode).toBe(1);
  expect(oversized.stderr.toString()).toContain("max_calls_out_of_range");
});
