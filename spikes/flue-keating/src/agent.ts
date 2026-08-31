'use agent';

import {
  useInitialData,
  useInstruction,
  useMcpConnection,
  useModel,
  usePersistentState,
  useSandbox,
  useSkill,
  useSubagent,
  useTool,
  type Agent,
  type SandboxFactory,
} from "@flue/runtime";
import * as v from "valibot";
import {
  activateCandidate,
  addCandidate,
  addLearnerEvidence,
  createEvolutionState,
  summarizePerformance,
  type EvolutionState,
} from "./evolution.js";
import { evolutionCandidateSchema, learnerEvidenceSchema } from "./schemas.js";
import { learnerEvaluationSkill, promptEvolutionSkill } from "./skills.js";
import { evolutionResearcher, learnerEvaluator } from "./subagents.js";
import type { KeatingAgentInitialData } from "./surface.js";

export interface KeatingAgentDependencies {
  sandbox: SandboxFactory;
  resolveMcpToken?: (evolutionNamespace: string) => Promise<string | undefined>;
}

export function createKeatingAgent(dependencies: KeatingAgentDependencies): Agent {
  const KeatingAgent = function KeatingAgent(): string {
    const initial = useInitialData<KeatingAgentInitialData>();
    useModel(initial.model, {
      compaction: { reserveTokens: 20_000, keepRecentTokens: 8_000 },
    });
    useSandbox(dependencies.sandbox, { cwd: "/workspace" });

    const [evolution, setEvolution] = usePersistentState<EvolutionState>(
      "evolution",
      createEvolutionState()
    );

    useSkill(promptEvolutionSkill);
    useSkill(learnerEvaluationSkill);
    useSubagent(evolutionResearcher);
    useSubagent(learnerEvaluator);

    if (initial.mcp) {
      useMcpConnection({
        name: "keating-account",
        url: initial.mcp.url,
        tools: initial.mcp.toolAllowlist,
        optional: true,
        auth: async () => {
          const token = await dependencies.resolveMcpToken?.(initial.evolutionNamespace);
          if (!token) throw new Error("No current Not Organic account capability is available.");
          return token;
        },
      });
    }

    useTool({
      name: "propose_evolution_candidate",
      description: "Record a complete, inspectable evolution candidate without activating it.",
      input: v.strictObject({ candidate: evolutionCandidateSchema }),
      run: ({ data }) => {
        const candidate = data.candidate;
        setEvolution((current) => addCandidate(current, candidate));
        return `Recorded candidate ${candidate.id} at parent revision ${candidate.parentRevision}.`;
      },
    });

    useTool({
      name: "record_learner_evidence",
      description: "Attach an attributable learner evaluation to an existing candidate.",
      input: v.strictObject({ evidence: learnerEvidenceSchema }),
      run: ({ data }) => {
        const evidence = data.evidence;
        setEvolution((current) => addLearnerEvidence(current, evidence));
        return `Recorded learner evidence ${evidence.id} for ${evidence.candidateId}.`;
      },
    });

    useTool({
      name: "activate_evolution_candidate",
      description: "Activate an evaluated candidate with compare-and-swap revision protection.",
      input: v.strictObject({
        candidateId: v.string(),
        expectedRevision: v.number(),
        activatedAt: v.string(),
        activatedBy: v.picklist(["browser", "mobile", "hosted"]),
        evidenceIds: v.array(v.string()),
      }),
      run: ({ data }) => {
        setEvolution((current) => activateCandidate(current, data));
        return `Activated ${data.candidateId} if revision ${data.expectedRevision} remains current.`;
      },
    });

    useTool({
      name: "summarize_candidate_performance",
      description:
        "Summarize how a candidate performed with the learner across all connected surfaces.",
      input: v.strictObject({ candidateId: v.string() }),
      run: ({ data }) => summarizePerformance(evolution, data.candidateId),
    });

    useInstruction(
      "Prompts, self-evolution code, MAP-Elites variables/weights, and learner evidence are first-class versioned state. Propose, evaluate, and activate are separate operations. Never persist credentials in agent state."
    );

    return `# Keating agent\n\nEvolution namespace: ${initial.evolutionNamespace}. Active revision: ${evolution.revision}. Active candidate: ${evolution.activeCandidateId ?? "none"}. Use delegates for independent proposal and evaluation work.`;
  } as Agent;

  KeatingAgent.agentName = "keating-agent";
  KeatingAgent.initialData = v.object({
    evolutionNamespace: v.string(),
    surface: v.picklist(["browser-local", "mobile-remote", "hosted"]),
    model: v.string(),
    mcp: v.optional(
      v.object({
        url: v.string(),
        toolAllowlist: v.array(v.string()),
      })
    ),
  });
  return KeatingAgent;
}
