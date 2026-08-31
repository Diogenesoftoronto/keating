import { describe, expect, test } from "bun:test";
import {
  activateCandidate,
  addCandidate,
  addLearnerEvidence,
  createEvolutionState,
  summarizePerformance,
  type EvolutionCandidate,
} from "../src/evolution.js";

const candidate: EvolutionCandidate = {
  id: "candidate-1",
  parentRevision: 0,
  createdAt: "2026-08-30T12:00:00.000Z",
  createdBy: "browser",
  rationale: "Improve verification without reducing transfer.",
  bundle: {
    prompts: [{ name: "learn", content: "Verify, then transfer.", sha256: "a".repeat(64) }],
    evolutionCode: [
      { path: "evolve.ts", content: "export const rate = 0.1", sha256: "b".repeat(64) },
    ],
    parameters: {
      objectiveWeights: {
        voice: 0.1,
        diagnosis: 0.2,
        verification: 0.2,
        retrieval: 0.15,
        transfer: 0.2,
        structure: 0.15,
      },
      mutationRate: 0.1,
      explorationRate: 0.2,
      archiveBins: 8,
      generationSize: 12,
    },
  },
  evidence: [],
};

describe("portable evolution state", () => {
  test("records learner performance before compare-and-swap activation", () => {
    let state = addCandidate(createEvolutionState(), candidate);
    state = addLearnerEvidence(state, {
      id: "evidence-1",
      candidateId: candidate.id,
      learnerRunId: "learner-run-44",
      surface: "mobile",
      scores: {
        voice: 0.7,
        diagnosis: 0.8,
        verification: 0.9,
        retrieval: 0.6,
        transfer: 0.8,
        structure: 0.7,
      },
      aggregate: 0.75,
      observedAt: "2026-08-30T12:05:00.000Z",
    });
    state = activateCandidate(state, {
      candidateId: candidate.id,
      expectedRevision: 0,
      activatedAt: "2026-08-30T12:06:00.000Z",
      activatedBy: "hosted",
      evidenceIds: ["evidence-1"],
    });

    expect(state.revision).toBe(1);
    expect(state.activeCandidateId).toBe(candidate.id);
    expect(state.activations[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(summarizePerformance(state, candidate.id)).toContain("mobile");
  });

  test("rejects stale activation and unrecorded evidence", () => {
    const state = addCandidate(createEvolutionState(), candidate);
    expect(() =>
      activateCandidate(state, {
        candidateId: candidate.id,
        expectedRevision: 1,
        activatedAt: "2026-08-30T12:06:00.000Z",
        activatedBy: "hosted",
        evidenceIds: [],
      })
    ).toThrow("Activation conflict");
    expect(() =>
      activateCandidate(state, {
        candidateId: candidate.id,
        expectedRevision: 0,
        activatedAt: "2026-08-30T12:06:00.000Z",
        activatedBy: "hosted",
        evidenceIds: [],
      })
    ).toThrow("requires at least one learner evidence");
    expect(() =>
      activateCandidate(state, {
        candidateId: candidate.id,
        expectedRevision: 0,
        activatedAt: "2026-08-30T12:06:00.000Z",
        activatedBy: "hosted",
        evidenceIds: ["missing"],
      })
    ).toThrow("missing learner evidence");
  });
});
