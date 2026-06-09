import { test, expect } from "bun:test";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureProjectScaffold,
  exportKeatingData,
  planTopicArtifact,
  quizTopicArtifact,
  verifyTopicArtifact
} from "../src/core/project.js";

async function tempProject() {
  const workdir = await mkdtemp(join(tmpdir(), "keating-export-"));
  await ensureProjectScaffold(workdir);
  return workdir;
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

test("keating finetune export writes manifest and both JSONL formats", async () => {
  const workdir = await tempProject();
  await planTopicArtifact(workdir, "derivative");
  await quizTopicArtifact(workdir, "derivative");
  await verifyTopicArtifact(workdir, "derivative", false);

  const result = await exportKeatingData(workdir, {
    mode: "finetune",
    source: "artifacts",
    format: "both",
    redact: true,
    minAssistantChars: 80,
  });

  expect(result.manifest.counts.artifactsRead).toBeGreaterThanOrEqual(3);
  expect(result.manifest.counts.examplesWritten).toBeGreaterThanOrEqual(3);
  expect(await exists(join(result.outDir, "manifest.json"))).toBe(true);
  expect(await exists(join(result.outDir, "train.chatml.jsonl"))).toBe(true);
  expect(await exists(join(result.outDir, "train.alpaca.jsonl"))).toBe(true);
  expect(await exists(join(result.outDir, "unsloth_train.py"))).toBe(true);
  expect(await exists(join(result.outDir, "runpod", "start.sh"))).toBe(true);
  await expect(readFile(join(result.outDir, "unsloth_train.py"), "utf8")).resolves.toBe(
    await readFile("src/core/templates/finetune/unsloth_train.py", "utf8")
  );
  await expect(readFile(join(result.outDir, "runpod", "start.sh"), "utf8")).resolves.toBe(
    await readFile("src/core/templates/finetune/runpod/start.sh", "utf8")
  );

  const chatml = await readFile(join(result.outDir, "train.chatml.jsonl"), "utf8");
  const first = JSON.parse(chatml.trim().split("\n")[0]);
  expect(first.messages[0].role).toBe("user");
  expect(first.messages[1].role).toBe("assistant");
});

test("keating finetune export respects format selection", async () => {
  const workdir = await tempProject();
  await planTopicArtifact(workdir, "stoicism");

  const chatml = await exportKeatingData(workdir, {
    mode: "finetune",
    source: "artifacts",
    format: "chatml",
    redact: true,
    minAssistantChars: 80,
  });
  expect(await exists(join(chatml.outDir, "train.chatml.jsonl"))).toBe(true);
  expect(await exists(join(chatml.outDir, "train.alpaca.jsonl"))).toBe(false);

  const alpaca = await exportKeatingData(workdir, {
    mode: "finetune",
    source: "artifacts",
    format: "alpaca",
    redact: true,
    minAssistantChars: 80,
  });
  expect(await exists(join(alpaca.outDir, "train.chatml.jsonl"))).toBe(false);
  expect(await exists(join(alpaca.outDir, "train.alpaca.jsonl"))).toBe(true);
});

test("keating finetune export can use sessions only and redacts secrets", async () => {
  const workdir = await tempProject();
  await mkdir(join(workdir, ".keating", "sessions"), { recursive: true });
  await writeFile(
    join(workdir, ".keating", "sessions", "session-1.json"),
    JSON.stringify({
      id: "session-1",
      messages: [
        { role: "user", content: "Teach me recursion. My key is sk-testsecret1234567890." },
        {
          role: "assistant",
          content: "Recursion is a way to solve a problem by defining it in terms of smaller copies of itself, with a base case that stops the chain.",
        },
        { role: "toolResult", content: "ignored" },
      ],
    }),
    "utf8"
  );

  const result = await exportKeatingData(workdir, {
    mode: "finetune",
    source: "sessions",
    format: "chatml",
    redact: true,
    minAssistantChars: 40,
  });

  expect(result.manifest.counts.sessionsRead).toBe(1);
  expect(result.manifest.counts.artifactsRead).toBe(0);
  expect(result.manifest.counts.redactions).toBeGreaterThanOrEqual(1);
  const jsonl = await readFile(join(result.outDir, "train.chatml.jsonl"), "utf8");
  expect(jsonl).toContain("[REDACTED]");
  expect(jsonl).not.toContain("sk-testsecret");
});

test("keating finetune export fails clearly for empty projects", async () => {
  const workdir = await tempProject();

  await expect(exportKeatingData(workdir, {
    mode: "finetune",
    source: "artifacts",
    format: "chatml",
    redact: true,
    minAssistantChars: 80,
  })).rejects.toThrow("No fine-tuning examples found");
});
