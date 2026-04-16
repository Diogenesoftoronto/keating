import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { createGrid, placeInGrid, mapElitesToEvolutionRun } from "../src/core/map-elites.js";
import { clampPolicy, clampWeights, DEFAULT_POLICY, DEFAULT_WEIGHTS } from "../src/core/policy.js";
import type { TeacherPolicy, SimulationWeights, BenchmarkResult } from "../src/core/types.js";
import {
  arbPolicy, arbWeights, arbDescriptors, arbResolution, arbScore,
  stubBenchmarkResult, policyIsBounded, weightsAreNormalized, weightsAreBounded,
  benchmarkScoresAreBounded
} from "./helpers.js";

// ─── Pure-function property tests (no I/O, no LLM) ────────────────────────

test("ALWAYS: createGrid produces empty grid with correct metadata", () => {
  fc.assert(fc.property(
    arbDescriptors, arbResolution,
    (descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      expect(grid.descriptors.length).toBe(descriptors.length);
      expect(grid.resolution).toBe(resolution);
      expect(grid.cells.size).toBe(0);
      for (const d of descriptors) {
        expect(grid.descriptors.includes(d)).toBe(true);
      }
    }
  ));
});

test("ALWAYS: placeInGrid cell key is deterministic for same inputs", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights, arbScore, arbDescriptors, arbResolution,
    (policy, weights, score, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const p = clampPolicy(policy);
      const benchmark = stubBenchmarkResult(p, weights, 42);

      placeInGrid(grid, p, weights, score, benchmark, 0);
      const key1 = Array.from(grid.cells.keys())[0];

      const grid2 = createGrid(descriptors, resolution);
      placeInGrid(grid2, p, weights, score, benchmark, 0);
      const key2 = Array.from(grid2.cells.keys())[0];

      expect(key1).toBe(key2);
    }
  ));
});

test("ALWAYS: placeInGrid with higher score replaces existing cell", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights,
    fc.double({ min: 0, max: 49, noNaN: true }),
    fc.double({ min: 50, max: 100, noNaN: true }),
    arbDescriptors, arbResolution,
    (policy, weights, lowScore, highScore, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const p = clampPolicy(policy);
      const benchmark1 = stubBenchmarkResult(p, weights, 1);
      const benchmark2 = stubBenchmarkResult(p, weights, 2);

      placeInGrid(grid, p, weights, lowScore, benchmark1, 0);
      placeInGrid(grid, p, weights, highScore, benchmark2, 1);

      const cell = Array.from(grid.cells.values())[0];
      expect(cell).not.toBeNull();
      expect(cell!.score).toBe(highScore);
      expect(cell!.iteration).toBe(1);
    }
  ));
});

test("ALWAYS: placeInGrid with lower score does NOT replace existing cell", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights,
    fc.double({ min: 50, max: 100, noNaN: true }),
    fc.double({ min: 0, max: 49, noNaN: true }),
    arbDescriptors, arbResolution,
    (policy, weights, highScore, lowScore, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const p = clampPolicy(policy);
      const benchmark1 = stubBenchmarkResult(p, weights, 1);
      const benchmark2 = stubBenchmarkResult(p, weights, 2);

      placeInGrid(grid, p, weights, highScore, benchmark1, 0);
      const replaced = placeInGrid(grid, p, weights, lowScore, benchmark2, 1);

      expect(replaced).toBe(false);
      const cell = Array.from(grid.cells.values())[0];
      expect(cell).not.toBeNull();
      expect(cell!.score).toBe(highScore);
      expect(cell!.iteration).toBe(0);
    }
  ));
});

test("ALWAYS: equal score does NOT replace existing cell (stability)", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights, arbScore, arbDescriptors, arbResolution,
    (policy, weights, score, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const p = clampPolicy(policy);
      const benchmark = stubBenchmarkResult(p, weights, 1);

      placeInGrid(grid, p, weights, score, benchmark, 0);
      const replaced = placeInGrid(grid, p, weights, score, benchmark, 1);

      expect(replaced).toBe(false);
      const cell = Array.from(grid.cells.values())[0];
      expect(cell?.iteration).toBe(0);
    }
  ));
});

test("ALWAYS: archive never shrinks in quality per cell", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights,
    fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 2, maxLength: 10 }),
    (policy, weights, scores) => {
      const grid = createGrid(["formalism", "socraticRatio"], 5);
      const p = clampPolicy(policy);
      let maxScoreSeen = -1;

      for (let i = 0; i < scores.length; i++) {
        const benchmark = stubBenchmarkResult(p, weights, i);
        placeInGrid(grid, p, weights, scores[i], benchmark, i);
        maxScoreSeen = Math.max(maxScoreSeen, scores[i]);

        for (const cell of grid.cells.values()) {
          if (cell !== null) {
            expect(cell.score).toBeLessThanOrEqual(maxScoreSeen + 0.001);
          }
        }
      }
    }
  ));
});

test("ALWAYS: grid size never exceeds totalCells", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights,
    fc.array(arbScore, { minLength: 0, maxLength: 50 }),
    arbDescriptors, arbResolution,
    (policy, weights, scores, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const totalCells = resolution ** descriptors.length;
      const p = clampPolicy(policy);

      for (let i = 0; i < scores.length; i++) {
        placeInGrid(grid, p, weights, scores[i], stubBenchmarkResult(p, weights, i), i);
      }

      expect(grid.cells.size).toBeLessThanOrEqual(totalCells);
    }
  ));
});

test("ALWAYS: filled cells contain bounded policies and weights", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights,
    fc.array(arbScore, { minLength: 1, maxLength: 20 }),
    arbDescriptors, arbResolution,
    (policy, weights, scores, descriptors, resolution) => {
      const grid = createGrid(descriptors, resolution);
      const p = clampPolicy(policy);

      for (let i = 0; i < scores.length; i++) {
        placeInGrid(grid, p, weights, scores[i], stubBenchmarkResult(p, weights, i), i);
      }

      for (const cell of grid.cells.values()) {
        if (cell !== null) {
          expect(policyIsBounded(cell.policy)).toBe(true);
          expect(weightsAreBounded(cell.weights)).toBe(true);
        }
      }
    }
  ));
});

test("SOMETIMES: placing diverse policies fills more than one cell", () => {
  let filledMultiple = false;
  fc.assert(fc.property(
    fc.integer({ min: 10, max: 30 }),
    (seed) => {
      const grid = createGrid(["formalism", "socraticRatio"], 5);
      for (let i = 0; i < 10; i++) {
        const p = clampPolicy({
          name: `policy-${seed}-${i}`,
          analogyDensity: (seed + i * 0.1) % 1,
          socraticRatio: (i * 0.11) % 1,
          formalism: (i * 0.13) % 1,
          retrievalPractice: 0.5,
          exerciseCount: 3,
          diagramBias: 0.5,
          reflectionBias: 0.5,
          interdisciplinaryBias: 0.5,
          challengeRate: 0.5,
        });
        const w = clampWeights({ masteryGain: 0.34, retention: 0.2, engagement: 0.16, transfer: 0.18, confusion: 0.18 });
        placeInGrid(grid, p, w, 50 + i, stubBenchmarkResult(p, w, seed + i), i);
      }
      if (grid.cells.size > 1) filledMultiple = true;
    }
  ), { numRuns: 20 });
  expect(filledMultiple).toBe(true);
});

// ─── Conversion invariants ─────────────────────────────────────────────────

test("ALWAYS: mapElitesToEvolutionRun preserves candidate counts and best score", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights, arbScore,
    (policy, weights, score) => {
      const p = clampPolicy(policy);
      const w = clampWeights(weights);
      const baseline = stubBenchmarkResult(DEFAULT_POLICY, DEFAULT_WEIGHTS, 1);
      const best = stubBenchmarkResult(p, w, 2);

      const grid = createGrid(["formalism"], 5);
      placeInGrid(grid, p, w, score, best, 0);

      const run = {
        baseline,
        best,
        grid,
        filledCellCount: grid.cells.size,
        totalCells: grid.resolution ** grid.descriptors.length,
        exploredCandidates: [{
          policy: p, benchmark: best, parentName: null, iteration: 1,
          novelty: 1, accepted: true,
          decision: { improves: true, safe: true, novelEnough: true, scoreDelta: 0, weakestTopicDelta: 0, reasons: [] },
          parameterDelta: []
        }]
      };

      const evoRun = mapElitesToEvolutionRun(run);

      expect(evoRun.exploredCandidates.length).toBe(run.exploredCandidates.length);
      expect(evoRun.acceptedCandidates.length).toBe(run.exploredCandidates.filter(c => c.accepted).length);
      expect(evoRun.best.overallScore).toBe(run.best.overallScore);
      expect(benchmarkScoresAreBounded(evoRun.best)).toBe(true);
    }
  ));
});

test("ALWAYS: mapElitesToEvolutionRun archive bestScore matches run best", () => {
  fc.assert(fc.property(
    arbPolicy, arbWeights, arbScore,
    (policy, weights, score) => {
      const p = clampPolicy(policy);
      const w = clampWeights(weights);
      const baseline = stubBenchmarkResult(DEFAULT_POLICY, DEFAULT_WEIGHTS, 1);
      const best = stubBenchmarkResult(p, w, 2);
      const grid = createGrid(["formalism"], 5);
      placeInGrid(grid, p, w, score, best, 0);

      const run = {
        baseline, best, grid,
        filledCellCount: grid.cells.size,
        totalCells: grid.resolution ** grid.descriptors.length,
        exploredCandidates: []
      };

      const evoRun = mapElitesToEvolutionRun(run);
      expect(evoRun.archive.bestScore).toBe(run.best.overallScore);
    }
  ));
});

// ─── Integration test with real mapElitesEvolve (algebraic fallback) ───────

test("mapElitesEvolve fills grid and never regresses cell quality", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(process.tmpdir ?? "/tmp", "me-pbt-"));

    const { mapElitesEvolve } = await import("../src/core/map-elites.js");
    const run = await mapElitesEvolve(tmp, DEFAULT_POLICY, {
      iterations: 8,
      seed: 12345,
      descriptors: ["formalism", "socraticRatio"],
      resolution: 4,
      initRandom: 4,
    });

    expect(run.filledCellCount).toBeGreaterThanOrEqual(1);
    expect(run.exploredCandidates.length).toBe(8);
    expect(run.best.overallScore).toBeGreaterThanOrEqual(run.baseline.overallScore - 0.01);

    for (const cell of run.grid.cells.values()) {
      if (cell !== null) {
        expect(policyIsBounded(cell.policy)).toBe(true);
        expect(weightsAreBounded(cell.weights)).toBe(true);
      }
    }
  } finally {
    console.error = origError;
  }
}, 60000);
