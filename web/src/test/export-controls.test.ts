import { describe, expect, it } from "bun:test";
import { buildWebFineTuneExportFromSources, type WebFineTuneExportOptions } from "../keating/export";
import type { SessionData } from "../types/session";

const options: WebFineTuneExportOptions = { source: "all", format: "both", redact: false, minAssistantChars: 1, now: 0 };
const session = (id: string, outputs: string[]): SessionData => ({
 id, title: "Practice", model: {} as SessionData["model"], thinkingLevel: "medium", createdAt: "2026-09-08T00:00:00Z", lastModified: "2026-09-08T00:00:00Z",
 messages: outputs.flatMap((output, index) => [{ role: "user", content: `Prompt ${index}`, timestamp: index * 2 }, { role: "assistant", content: output, timestamp: index * 2 + 1 }]) as SessionData["messages"],
});
const records = (jsonl?: string): any[] => jsonl?.trim() ? jsonl.trim().split("\n").map((line) => JSON.parse(line)) : [];

describe("training export controls", () => {
 it("keeps short, error-like, and low-scoring responses while preserving all source messages", async () => {
  const source = session("everything", ["OK", "Error: failed", "Low quality response", "OK"]);
  source.messages.push({ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "Raw tool result" }] } as any, { role: "assistant", content: "", timestamp: 99 } as any);
  const result = await buildWebFineTuneExportFromSources({ sessions: [source] }, {
   ...options, keepAllResponses: true, minAssistantChars: 200, maxAssistantChars: 2, maxRecords: 1, deduplicate: true,
   judge: async (turns) => turns.map(() => ({ masteryGain: 0, retention: 0, engagement: 0, transfer: 0, confusion: 1 })),
  });
  expect(result.recordCount).toBe(4);
  expect(result.exampleCount).toBe(4);
  expect(records(result.alpacaJsonl).map((row) => row.output)).toEqual(["OK", "Error: failed", "Low quality response", "OK"]);
  expect(records(result.chatmlJsonl)[0].messages.filter((message: any) => message.role === "assistant")).toHaveLength(4);
  expect(records(result.canonicalJsonl).every((row) => row.quality.status === "rejected")).toBe(true);
  expect(JSON.parse(result.sourceDataJson!).sessions[0].messages).toEqual(source.messages);
  expect(JSON.parse(result.manifestJson)).toMatchObject({ keepAllResponses: true, sourceSnapshotIncluded: true, minimumAssistantCharacters: 1, maximumAssistantCharacters: null, maximumRecords: null, deduplicationEnabled: false });
 });
 it("redacts source snapshot string values and respects the source selector", async () => {
  const secret = "sk-testsecret1234567890";
  const source = session("raw", [secret]);
  source.messages.push({ role: "toolResult", content: [{ type: "text", text: `PROVIDER_API_KEY=${secret}` }] } as any);
  const sources = { sessions: [source], persona: `Contact teacher@example.com`, plans: [{ id: "p1", topic: "Private artifact", content: "Artifact content", createdAt: 0, updatedAt: 0 }] };
  const result = await buildWebFineTuneExportFromSources(sources, { ...options, source: "sessions", keepAllResponses: true, redact: true });
  expect(result.sourceDataJson).not.toContain(secret);
  expect(result.sourceDataJson).not.toContain("teacher@example.com");
  expect(result.sourceDataJson).not.toContain("Private artifact");
  expect(result.sourceDataJson).toContain("[REDACTED]");
  expect(JSON.parse(result.sourceDataJson!).sessions[0].messages).toHaveLength(3);
  expect((await buildWebFineTuneExportFromSources(sources, options)).sourceDataJson).toBeUndefined();
 });
 it("rejects invalid bounds before exporting", async () => {
  for (const invalid of [{ maxAssistantChars: 0 }, { maxRecords: 1.5 }, { validationPercent: 51 }, { validationPercent: NaN }, { minAssistantChars: 20, maxAssistantChars: 10 }]) {
   await expect(buildWebFineTuneExportFromSources({}, { ...options, ...invalid })).rejects.toThrow();
  }
 });
 it("excludes long completions from all payloads and judges only retained responses", async () => {
  const excluded = "EXCLUDED_LONG_RESPONSE_".repeat(10);
  let judged = 0;
  const result = await buildWebFineTuneExportFromSources({ sessions: [session("bounded", ["Keep this", excluded, "Keep later"])] }, { ...options, maxAssistantChars: 20, judge: async (turns) => { judged = turns.length; return []; } });
  expect(result.recordCount).toBe(2);
  expect(judged).toBe(2);
  expect(JSON.stringify(result)).not.toContain(excluded);
  expect(records(result.chatmlJsonl)[0].keating.messages).toBeUndefined();
  expect(JSON.parse(result.manifestJson).counts.lengthExcluded).toBe(1);
 });
 it("removes an excluded first turn without joining its prompt to the retained second turn", async () => {
  for (const timestamps of [true, false]) {
   const source = session("two-turn", ["EXCLUDED_FIRST_RESPONSE_".repeat(10), "Retained second response"]);
   if (!timestamps) source.messages = source.messages.map((message) => { const { timestamp, ...rest } = message as any; return rest; });
   const result = await buildWebFineTuneExportFromSources({ sessions: [source] }, { ...options, maxAssistantChars: 30 });
   expect(result.recordCount).toBe(1);
   expect(JSON.stringify(result)).not.toContain("EXCLUDED_FIRST_RESPONSE");
   for (const jsonl of [result.canonicalJsonl, result.chatmlJsonl, result.alpacaJsonl, result.rewardedJsonl, result.ktoJsonl, result.preferenceJsonl, result.dpoTextJsonl, result.grpoPromptsJsonl]) {
    expect(jsonl ?? "").not.toContain("Prompt 0");
   }
   expect(records(result.canonicalJsonl)[0].prompt).toEqual([{ role: "user", content: "Prompt 1" }]);
   expect(records(result.chatmlJsonl)[0].messages).toEqual([{ role: "user", content: "Prompt 1" }, { role: "assistant", content: "Retained second response" }]);
   expect(records(result.alpacaJsonl)[0].instruction).toBe("Prompt 1");
  }
 });
 it("makes prompt/completion deduplication optional and applies it to every format", async () => {
  const sources = { sessions: [session("first", ["Same response"]), session("second", ["Same response"])] };
  const all = await buildWebFineTuneExportFromSources(sources, options);
  const unique = await buildWebFineTuneExportFromSources(sources, { ...options, deduplicate: true });
  expect(all.recordCount).toBe(2);
  expect(unique.recordCount).toBe(1);
  expect(records(unique.chatmlJsonl)).toHaveLength(1);
  expect(records(unique.alpacaJsonl)).toHaveLength(1);
  expect(records(unique.rewardedJsonl)).toHaveLength(1);
  expect(JSON.parse(unique.manifestJson).counts.duplicatesRemoved).toBe(1);
 });
 it("caps canonical records in source order without leaking capped responses through history", async () => {
  const result = await buildWebFineTuneExportFromSources({ sessions: [session("limited", ["First", "EXCLUDED_SECOND", "EXCLUDED_THIRD"])] }, { ...options, maxRecords: 1 });
  expect(result.recordCount).toBe(1);
  expect(JSON.stringify(result)).not.toContain("EXCLUDED_");
  expect(records(result.rewardedJsonl)).toHaveLength(1);
  expect(JSON.parse(result.manifestJson).counts.limitExcluded).toBe(2);
 });
 it("keeps source groups together with stable configurable validation allocation", async () => {
  const sources = { sessions: Array.from({ length: 30 }, (_, index) => session(`group-${index}`, ["One", "Two"])) };
  const result = await buildWebFineTuneExportFromSources(sources, { ...options, validationPercent: 50 });
  const rows = records(result.canonicalJsonl);
  expect(new Set(rows.map((row) => row.split)).size).toBe(2);
  for (const source of sources.sessions) expect(new Set(rows.filter((row) => row.source.sessionId === source.id).map((row) => row.split)).size).toBe(1);
  const trainOnly = await buildWebFineTuneExportFromSources(sources, { ...options, validationPercent: 0 });
  expect(records(trainOnly.canonicalJsonl).every((row) => row.split === "train")).toBe(true);
  expect((await buildWebFineTuneExportFromSources(sources, { ...options, validationPercent: 50 })).canonicalJsonl).toBe(result.canonicalJsonl);
 });
});
