import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import benchmarkHarnessExtension from "./benchmark_harness_v3_extension.js";

test("resource readiness accepts only the inventoried base prompt and rejects ambient context", async () => {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "keating-resource-proof-"));
  const journal = join(directory, ".keating", "benchmark-harness");
  const prompt = "An authored fixture base prompt.\n";
  const hash = createHash("sha256").update(prompt).digest("hex");
  let ready: (args: string, context: unknown) => Promise<void>;
  try {
    mkdirSync(journal, { recursive: true });
    writeFileSync(join(journal, "request.json"), JSON.stringify({
      transport: { kind: "tape", responses: [] }, limits: { max_output_tokens: 20 },
      allowed_tools: [], readonly_resources: {}, system_prompt_sha256: hash,
    }));
    process.chdir(directory);
    benchmarkHarnessExtension({
      registerCommand: (_name: string, command: { handler: typeof ready }) => { ready = command.handler; },
      on: () => {}, registerProvider: () => {},
    } as unknown as ExtensionAPI);
    for (const [options, expected] of [
      [{ customPrompt: prompt }, "resources_verified"],
      [{ customPrompt: prompt + "An unpinned instruction." }, "fatal"],
      [{ customPrompt: prompt, contextFiles: [{ path: "ambient.md", content: "outside" }] }, "fatal"],
      [{ customPrompt: prompt, skills: [{ filePath: "/outside/SKILL.md" }] }, "fatal"],
    ] as const) {
      await ready!("", { getSystemPromptOptions: () => options });
      const receipt = JSON.parse(readFileSync(join(journal, "events.jsonl"), "utf8").trim().split("\n").at(-1)!);
      expect(receipt.kind).toBe(expected);
      if (expected === "resources_verified") expect(receipt.data.custom_prompt_sha256).toBe(hash);
      else expect(receipt.data.code).toBe("harness_unpinned_runtime_resources");
    }
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
