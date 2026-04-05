import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  prosperStyleWinner,
  evolvePrompt,
  type PromptEvolutionCandidate,
  type PromptEvaluation
} from "../src/core/prompt-evolution.js";
import { ensureProjectScaffold } from "../src/core/project.js";

async function mockEvaluator(_cwd: string, promptPath: string, prompt: string): Promise<PromptEvaluation> {
  const isGood = prompt.includes("own voice");
  return {
    promptPath,
    promptName: "learn",
    score: isGood ? 90 : 50,
    objectives: {
      voice_divergence: isGood ? 1 : 0.2,
      diagnosis: 0.5,
      verification: 0.5,
      retrieval: 0.5,
      transfer: 0.5,
      structure: 0.5
    },
    feedback: isGood ? [] : ["Add voice"]
  };
}

async function mockGenerator(_cwd: string, basePrompt: string, _evaluation: PromptEvaluation, _iteration: number): Promise<string> {
  return basePrompt + "\nHelp the learner find their own voice.";
}

test("PROSPER-style winner prefers candidates that win across multiple objectives", () => {
  const candidates: PromptEvolutionCandidate[] = [
    {
      iteration: 1,
      label: "narrow",
      prompt: "narrow",
      parentLabel: "learn",
      accepted: false,
      preferenceScore: 0,
      evaluation: {
        promptPath: "learn.md",
        promptName: "learn",
        score: 78,
        objectives: {
          voice_divergence: 1,
          diagnosis: 0.2,
          verification: 0.2,
          retrieval: 0.2,
          transfer: 0.2,
          structure: 1
        },
        feedback: []
      }
    },
    {
      iteration: 2,
      label: "balanced",
      prompt: "balanced",
      parentLabel: "learn",
      accepted: false,
      preferenceScore: 0,
      evaluation: {
        promptPath: "learn.md",
        promptName: "learn",
        score: 84,
        objectives: {
          voice_divergence: 0.8,
          diagnosis: 0.8,
          verification: 0.8,
          retrieval: 0.8,
          transfer: 0.8,
          structure: 0.8
        },
        feedback: []
      }
    }
  ];

  const winner = prosperStyleWinner(candidates);
  assert.equal(winner.label, "balanced");
  assert.ok(winner.preferenceScore > candidates[0].preferenceScore);
});

test("prompt evolution works with mocked LLM calls", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-prompt-evolution-mock-"));
  await ensureProjectScaffold(workdir);

  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(
    join(workdir, "pi", "prompts", "learn.md"),
    "Teach the topic."
  );

  const run = await evolvePrompt(workdir, "learn", 2, mockEvaluator, mockGenerator);

  assert.ok(run.baseline.score < run.best.evaluation.score);
  assert.ok(run.best.prompt.includes("own voice"));
  assert.equal(run.exploredCandidates.length, 2);
  assert.ok(run.best.accepted);
});
