import { test, expect } from "bun:test";
import { learnPrompt } from "../src/core/ax-prompt-learner.js";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProjectScaffold } from "../src/core/project.js";

test("ACE prompt learner runs and returns a playbook", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-ax-ace-"));
  await ensureProjectScaffold(workdir);
  
  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(join(workdir, "pi", "prompts", "test.md"), "Teach something.");

  process.env.GOOGLE_API_KEY = "dummy-key";
  const result = await learnPrompt(workdir, "test", {
    maxEpochs: 1
  });

  expect(result.playbook).toBeDefined();
  expect(typeof result.playbook).toBe("object");
}, 30000);
