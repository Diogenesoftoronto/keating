import { test, expect } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, access, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  prosperStyleWinner,
  evolvePrompt,
  type PromptEvolutionCandidate,
  type PromptEvaluation,
  type PromptObjectiveVector
} from "../src/core/prompt-evolution.js";
import { ensureProjectScaffold } from "../src/core/project.js";

// ─── Mock LLM boundary (Antithesis: controlled entropy at I/O boundary) ────

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

// ─── PROSPER winner properties (pure function, no I/O) ──────────────────────

const arbObjectiveVector: fc.Arbitrary<PromptObjectiveVector> = fc.record({
  voice_divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  diagnosis: fc.double({ min: 0, max: 1, noNaN: true }),
  verification: fc.double({ min: 0, max: 1, noNaN: true }),
  retrieval: fc.double({ min: 0, max: 1, noNaN: true }),
  transfer: fc.double({ min: 0, max: 1, noNaN: true }),
  structure: fc.double({ min: 0, max: 1, noNaN: true }),
});

const arbCandidate: fc.Arbitrary<PromptEvolutionCandidate> = fc.record({
  iteration: fc.integer({ min: 1, max: 100 }),
  label: fc.string({ minLength: 1, maxLength: 16 }),
  prompt: fc.string({ minLength: 1, maxLength: 100 }),
  parentLabel: fc.string({ minLength: 1, maxLength: 16 }),
  accepted: fc.boolean(),
  preferenceScore: fc.double({ min: 0, max: 1, noNaN: true }),
  evaluation: fc.record({
    promptPath: fc.string({ minLength: 1, maxLength: 16 }),
    promptName: fc.string({ minLength: 1, maxLength: 16 }),
    score: fc.double({ min: 0, max: 100, noNaN: true }),
    objectives: arbObjectiveVector,
    feedback: fc.array(fc.string({ maxLength: 50 }), { maxLength: 3 }),
  }),
});

test("ALWAYS: prosperStyleWinner returns one of the candidates", () => {
  fc.assert(fc.property(
    fc.array(arbCandidate, { minLength: 2, maxLength: 10 }),
    (candidates) => {
      const winner = prosperStyleWinner(candidates);
      expect(candidates.some(c => c.label === winner.label)).toBe(true);
    }
  ));
});

test("ALWAYS: prosperStyleWinner prefers balanced objectives over narrow high scores", () => {
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
  expect(winner.label).toBe("balanced");
  expect(winner.preferenceScore).toBeGreaterThan(candidates[0].preferenceScore);
});

test("ALWAYS: prosperStyleWinner sets preferenceScore > 0 for winner", () => {
  fc.assert(fc.property(
    fc.array(arbCandidate, { minLength: 2, maxLength: 8 }),
    (candidates) => {
      const winner = prosperStyleWinner(candidates);
      expect(winner.preferenceScore).toBeGreaterThan(0);
    }
  ));
});

// ─── Integration with mocked LLM ───────────────────────────────────────────

test("prompt evolution works with mocked LLM calls", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-prompt-evolution-mock-"));
  await ensureProjectScaffold(workdir);

  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(
    join(workdir, "pi", "prompts", "learn.md"),
    "Teach the topic."
  );

  const run = await evolvePrompt(workdir, "learn", 2, mockEvaluator, mockGenerator);

  expect(run.baseline.score).toBeLessThan(run.best.evaluation.score);
  expect(run.best.prompt.includes("own voice")).toBe(true);
  expect(run.exploredCandidates.length).toBe(2);
  expect(run.best.accepted).toBe(true);
});

test("ALWAYS: prompt evolution with mock never returns undefined or empty prompt", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-prompt-evolution-"));
  await ensureProjectScaffold(workdir);
  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(join(workdir, "pi", "prompts", "learn.md"), "Teach.");

  const run = await evolvePrompt(workdir, "learn", 2, mockEvaluator, mockGenerator);

  expect(run.best.prompt.length).toBeGreaterThan(0);
  expect(run.baseline.promptName.length).toBeGreaterThan(0);
  for (const candidate of run.exploredCandidates) {
    expect(candidate.prompt.length).toBeGreaterThan(0);
    expect(typeof candidate.evaluation.score === "number" && Number.isFinite(candidate.evaluation.score)).toBe(true);
  }
});
