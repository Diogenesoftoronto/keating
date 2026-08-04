import { test, expect } from "bun:test";
import { learnPrompt } from "../src/core/ax-prompt-learner.js";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProjectScaffold } from "../src/core/project.js";

test("GEPA prompt learner persists a deterministic optimizer playbook", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-ax-gepa-"));
  await ensureProjectScaffold(workdir);

  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(join(workdir, "pi", "prompts", "test.md"), "Teach something.");

  const expectedPlaybook = {
    optimizerType: "deterministic-test",
    componentMap: { "test::instruction": "Teach with one concrete example." },
  };
  const result = await learnPrompt(workdir, "test", {
    maxEpochs: 1,
    optimizer: async (input) => {
      expect(input.promptName).toBe("test");
      expect(input.basePrompt).toBe("Teach something.");
      expect(input.maxEpochs).toBe(1);
      return expectedPlaybook;
    },
  });

  expect(result.playbook).toEqual(expectedPlaybook);
  const persisted = JSON.parse(
    await readFile(
      join(workdir, ".keating", "state", "gepa-prompt-playbook.json"),
      "utf8",
    ),
  );
  expect(persisted).toEqual(expectedPlaybook);
});
