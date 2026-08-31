import * as v from "valibot";

const boundedScore = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const contentHash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));

export const objectiveScoresSchema = v.strictObject({
  voice: boundedScore,
  diagnosis: boundedScore,
  verification: boundedScore,
  retrieval: boundedScore,
  transfer: boundedScore,
  structure: boundedScore,
});

const promptSourceSchema = v.strictObject({
  name: v.string(),
  content: v.string(),
  sha256: contentHash,
});

const evolutionCodeSourceSchema = v.strictObject({
  path: v.string(),
  content: v.string(),
  sha256: contentHash,
});

const mapElitesParametersSchema = v.strictObject({
  objectiveWeights: v.pipe(
    objectiveScoresSchema,
    v.check((weights) => {
      const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      return Math.abs(total - 1) < 1e-9;
    }, "Objective weights must sum to 1.")
  ),
  mutationRate: boundedScore,
  explorationRate: boundedScore,
  archiveBins: v.pipe(v.number(), v.integer(), v.minValue(1)),
  generationSize: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export const learnerEvidenceSchema = v.strictObject({
  id: v.string(),
  candidateId: v.string(),
  learnerRunId: v.string(),
  surface: v.picklist(["browser", "mobile", "hosted"]),
  scores: objectiveScoresSchema,
  aggregate: boundedScore,
  observedAt: v.string(),
  notes: v.optional(v.string()),
});

export const evolutionCandidateSchema = v.strictObject({
  id: v.string(),
  parentRevision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  createdAt: v.string(),
  createdBy: v.picklist(["browser", "mobile", "hosted"]),
  rationale: v.string(),
  bundle: v.strictObject({
    prompts: v.array(promptSourceSchema),
    evolutionCode: v.array(evolutionCodeSourceSchema),
    parameters: mapElitesParametersSchema,
  }),
  evidence: v.array(learnerEvidenceSchema),
});
