import { expect, test } from "bun:test";
import * as v from "valibot";
import { evolutionCandidateSchema } from "../src/schemas.js";

test("candidate wire schema rejects vendor fields and non-normalized weights", () => {
  const result = v.safeParse(evolutionCandidateSchema, {
    id: "candidate-1",
    parentRevision: 0,
    createdAt: "2026-08-30T12:00:00.000Z",
    createdBy: "mobile",
    provider: "cloudflare",
    rationale: "test",
    bundle: {
      prompts: [],
      evolutionCode: [],
      parameters: {
        objectiveWeights: {
          voice: 0.1,
          diagnosis: 0.1,
          verification: 0.1,
          retrieval: 0.1,
          transfer: 0.1,
          structure: 0.1,
        },
        mutationRate: 0.1,
        explorationRate: 0.1,
        archiveBins: 4,
        generationSize: 4,
      },
    },
    evidence: [],
  });
  expect(result.success).toBe(false);
});
