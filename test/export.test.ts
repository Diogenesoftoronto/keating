import { test, expect } from "bun:test";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureProjectScaffold,
  exportKeatingData,
  importKeatingData,
  planTopicArtifact,
  quizTopicArtifact,
  verifyTopicArtifact
} from "../src/core/project.js";
import { sessionsDir } from "../src/core/paths.js";

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

test("keating finetune export skips assistant turns shorter than the minimum", async () => {
  const workdir = await tempProject();
  await mkdir(join(workdir, ".keating", "sessions"), { recursive: true });
  await writeFile(
    join(workdir, ".keating", "sessions", "session-1.json"),
    JSON.stringify({
      id: "session-1",
      messages: [
        { role: "user", content: "Teach me recursion briefly." },
        { role: "assistant", content: "No." },
        { role: "user", content: "Teach me recursion with enough detail." },
        {
          role: "assistant",
          content: "Recursion solves a problem by reducing it to smaller versions of itself until a base case stops the process and the call stack unwinds.",
        },
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

  expect(result.manifest.counts.examplesWritten).toBe(1);
  expect(result.manifest.counts.skipped).toBeGreaterThanOrEqual(1);
  const jsonl = await readFile(join(result.outDir, "train.chatml.jsonl"), "utf8");
  expect(jsonl).not.toContain("No.");
  expect(jsonl).toContain("call stack unwinds");
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

test("keating finetune import reconstructs sessions from exported ChatML", async () => {
  const source = await tempProject();
  await planTopicArtifact(source, "derivative");
  const exported = await exportKeatingData(source, {
    mode: "finetune",
    source: "artifacts",
    format: "chatml",
    redact: true,
    minAssistantChars: 80,
  });

  const target = await tempProject();
  const imported = await importKeatingData(target, {
    sourcePath: exported.outDir,
    format: "auto",
  });

  expect(imported.examplesImported).toBeGreaterThanOrEqual(1);
  expect(await exists(imported.sessionPath)).toBe(true);
  const session = JSON.parse(await readFile(imported.sessionPath, "utf8"));
  expect(session.source).toBe("keating-finetune-import");
  expect(session.messages.some((message: { role: string }) => message.role === "user")).toBe(true);
  expect(session.messages.some((message: { role: string }) => message.role === "assistant")).toBe(true);
});

test("keating finetune import deduplicates paired ChatML and Alpaca exports", async () => {
  const source = await tempProject();
  await planTopicArtifact(source, "derivative");
  const exported = await exportKeatingData(source, {
    mode: "finetune",
    source: "artifacts",
    format: "both",
    redact: true,
    minAssistantChars: 80,
  });

  const target = await tempProject();
  const imported = await importKeatingData(target, {
    sourcePath: exported.outDir,
    format: "auto",
  });

  expect(imported.examplesImported).toBe(exported.manifest.counts.examplesWritten);
  // Each example becomes its own session — never flattened into one.
  expect(imported.sessionsImported).toBe(exported.manifest.counts.examplesWritten);
  expect(imported.sessionPaths).toHaveLength(exported.manifest.counts.examplesWritten);
  const session = JSON.parse(await readFile(imported.sessionPath, "utf8"));
  expect(session.messages).toHaveLength(2);
});

test("keating finetune import supports Alpaca JSONL files", async () => {
  const workdir = await tempProject();
  const file = join(workdir, "train.alpaca.jsonl");
  await writeFile(
    file,
    `${JSON.stringify({ instruction: "Teach recursion.", input: "Use stacks.", output: "Recursion uses a base case and smaller subproblems." })}\n`,
    "utf8"
  );

  const imported = await importKeatingData(workdir, {
    sourcePath: file,
    format: "auto",
  });

  expect(imported.examplesImported).toBe(1);
  const session = JSON.parse(await readFile(imported.sessionPath, "utf8"));
  expect(session.messages[0].content).toContain("Use stacks.");
  expect(session.messages[1].content).toContain("base case");
});

test("keating lossless session export round-trips into a resumable session", async () => {
  const source = await tempProject();
  await mkdir(sessionsDir(source), { recursive: true });
  const original = {
    id: "sess-resume",
    title: "Resume me",
    model: { id: "gpt-x", name: "GPT X", provider: "openai", api: "openai-responses" },
    thinkingLevel: "low",
    messages: [
      { role: "system", content: [{ type: "text", text: "Tutor persona" }] },
      { role: "user", content: [{ type: "text", text: "Explain recursion in depth please." }] },
      { role: "assistant", content: [{ type: "text", text: "Recursion is when a function calls itself with a smaller input until it reaches a base case." }] },
    ],
  };
  await writeFile(join(sessionsDir(source), "sess-resume.json"), `${JSON.stringify(original, null, 2)}\n`, "utf8");

  const exported = await exportKeatingData(source, {
    mode: "finetune",
    source: "sessions",
    format: "chatml",
    redact: false,
    minAssistantChars: 10,
  });

  const target = await tempProject();
  const imported = await importKeatingData(target, { sourcePath: exported.outDir, format: "auto" });

  expect(imported.sessionsImported).toBe(1);
  const session = JSON.parse(await readFile(imported.sessionPath, "utf8"));
  // Lossless: model, thinkingLevel, and the system turn survive the round-trip.
  expect(session.model.id).toBe("gpt-x");
  expect(session.thinkingLevel).toBe("low");
  expect(session.source).toBe("keating-session-export");
  expect(session.messages[0].role).toBe("system");
  expect(session.messages).toHaveLength(3);
});
