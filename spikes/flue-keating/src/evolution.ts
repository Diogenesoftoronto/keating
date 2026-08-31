export const EVOLUTION_SCHEMA_VERSION = 1 as const;

export type EvolutionSurface = "browser" | "mobile" | "hosted";

export interface ObjectiveScores {
  voice: number;
  diagnosis: number;
  verification: number;
  retrieval: number;
  transfer: number;
  structure: number;
}

export interface PromptSource {
  name: string;
  content: string;
  sha256: string;
}

export interface EvolutionCodeSource {
  path: string;
  content: string;
  sha256: string;
}

export interface MapElitesParameters {
  objectiveWeights: ObjectiveScores;
  mutationRate: number;
  explorationRate: number;
  archiveBins: number;
  generationSize: number;
}

export interface EvolutionBundle {
  prompts: PromptSource[];
  evolutionCode: EvolutionCodeSource[];
  parameters: MapElitesParameters;
}

export interface LearnerEvidence {
  id: string;
  candidateId: string;
  learnerRunId: string;
  surface: EvolutionSurface;
  scores: ObjectiveScores;
  aggregate: number;
  observedAt: string;
  notes?: string;
}

export interface EvolutionCandidate {
  id: string;
  parentRevision: number;
  createdAt: string;
  createdBy: EvolutionSurface;
  rationale: string;
  bundle: EvolutionBundle;
  evidence: LearnerEvidence[];
}

export interface ActivationRecord {
  revision: number;
  candidateId: string;
  previousCandidateId: string | null;
  activatedAt: string;
  activatedBy: EvolutionSurface;
  evidenceIds: string[];
}

export interface EvolutionState {
  schemaVersion: typeof EVOLUTION_SCHEMA_VERSION;
  revision: number;
  activeCandidateId: string | null;
  candidates: Record<string, EvolutionCandidate>;
  activations: ActivationRecord[];
}

export function createEvolutionState(): EvolutionState {
  return {
    schemaVersion: EVOLUTION_SCHEMA_VERSION,
    revision: 0,
    activeCandidateId: null,
    candidates: {},
    activations: [],
  };
}

export function addCandidate(state: EvolutionState, candidate: EvolutionCandidate): EvolutionState {
  if (candidate.parentRevision !== state.revision) {
    throw new Error(
      `Candidate ${candidate.id} targets revision ${candidate.parentRevision}; current revision is ${state.revision}.`
    );
  }
  if (state.candidates[candidate.id]) throw new Error(`Candidate ${candidate.id} already exists.`);
  return {
    ...state,
    candidates: { ...state.candidates, [candidate.id]: structuredClone(candidate) },
  };
}

export function addLearnerEvidence(
  state: EvolutionState,
  evidence: LearnerEvidence
): EvolutionState {
  const candidate = state.candidates[evidence.candidateId];
  if (!candidate) throw new Error(`Unknown candidate ${evidence.candidateId}.`);
  if (candidate.evidence.some((entry) => entry.id === evidence.id)) return state;
  return {
    ...state,
    candidates: {
      ...state.candidates,
      [candidate.id]: {
        ...candidate,
        evidence: [...candidate.evidence, structuredClone(evidence)],
      },
    },
  };
}

export function activateCandidate(
  state: EvolutionState,
  request: {
    candidateId: string;
    expectedRevision: number;
    activatedAt: string;
    activatedBy: EvolutionSurface;
    evidenceIds: string[];
  }
): EvolutionState {
  if (request.expectedRevision !== state.revision) {
    throw new Error(
      `Activation conflict: expected revision ${request.expectedRevision}, current revision is ${state.revision}.`
    );
  }
  const candidate = state.candidates[request.candidateId];
  if (!candidate) throw new Error(`Unknown candidate ${request.candidateId}.`);
  if (request.evidenceIds.length === 0) {
    throw new Error("Activation requires at least one learner evidence record.");
  }
  const recordedEvidence = new Set(candidate.evidence.map((entry) => entry.id));
  const missing = request.evidenceIds.filter((id) => !recordedEvidence.has(id));
  if (missing.length > 0) {
    throw new Error(`Activation references missing learner evidence: ${missing.join(", ")}.`);
  }
  const revision = state.revision + 1;
  return {
    ...state,
    revision,
    activeCandidateId: candidate.id,
    activations: [
      ...state.activations,
      {
        revision,
        candidateId: candidate.id,
        previousCandidateId: state.activeCandidateId,
        activatedAt: request.activatedAt,
        activatedBy: request.activatedBy,
        evidenceIds: [...request.evidenceIds],
      },
    ],
  };
}

export function summarizePerformance(state: EvolutionState, candidateId: string): string {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error(`Unknown candidate ${candidateId}.`);
  if (candidate.evidence.length === 0) return `${candidateId}: no learner evidence recorded`;
  const mean =
    candidate.evidence.reduce((total, entry) => total + entry.aggregate, 0) /
    candidate.evidence.length;
  const surfaces = [...new Set(candidate.evidence.map((entry) => entry.surface))].sort();
  return `${candidateId}: mean ${mean.toFixed(3)} over ${candidate.evidence.length} learner runs (${surfaces.join(", ")})`;
}
