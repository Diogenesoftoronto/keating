import { relative } from "node:path";
import {
  autoImproveArtifact,
  evolvePolicyArtifact,
  evolvePromptArtifact,
  improveArtifact,
  improveHistory,
  promptEvalArtifact
} from "../../../core/project.js";
import { keatingToolMaker, getCwd, pick } from "./shared.js";

export const selfEvolutionTools = [
  keatingToolMaker(
    "auto_improve",
    "auto_improve",
    "Run the full autonomous self-improvement loop: benchmark current policy → evolve policy via MAP-Elites → evolve prompt template → record improvement. Use this instead of calling bench/evolve/improve separately. Triggers automatically on first session and periodically thereafter.",
    {
      topic: { type: "string", description: "Optional topic to focus the improvement on" },
      force: { type: "boolean", description: "Set true only when the learner explicitly asks to run auto_improve again in this session" }
    },
    async (params) => {
      const topic = (params.topic as string) || undefined;
      const result = await autoImproveArtifact(getCwd(), topic, { force: params.force === true });
      const verdict = result.delta > 0 ? "IMPROVED" : result.delta < -0.5 ? "REGRESSED" : "NO SIGNIFICANT CHANGE";
      return {
        content: [{ type: "text", text: `Auto-improve: ${result.baselineScore.toFixed(2)} → ${result.afterScore.toFixed(2)} (${verdict}, Δ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(2)})\nReport: ${relative(getCwd(), result.reportPath)}` }],
        details: result
      };
    }
  ),
  keatingToolMaker(
    "evolve",
    "evolve",
    "Evolve the teaching policy using MAP-Elites algorithm. Use to search for better policy parameters when benchmarks show room for improvement.",
    { topic: { type: "string", description: "Optional topic to focus the evolution on" } },
    async (params) => {
      const topic = (params.topic as string) || undefined;
      const artifact = await evolvePolicyArtifact(getCwd(), topic);
      return {
        content: [{ type: "text", text: `[artifact://evolution]\nBest: ${artifact.bestScore.toFixed(2)}\nPolicy: ${relative(getCwd(), artifact.policyPath)}` }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "improve",
    "improve",
    "Generate a targeted improvement proposal by diagnosing benchmark weaknesses. Returns specific areas to improve and suggestions. Pass action='history' to view past improvement attempts.",
    { action: { type: "string", description: "Pass 'history' to view past improvement attempts" } },
    async (params) => {
      const sub = pick((params.action as string) ?? "");
      if (sub === "history") {
        const md = await improveHistory(getCwd());
        return { content: [{ type: "text", text: md }] };
      }
      const artifact = await improveArtifact(getCwd());
      return {
        content: [{ type: "text", text: `Improvement proposal ${artifact.proposal.id} targets ${artifact.proposal.targets.map((t: any) => t.file).join(", ")}\n${relative(getCwd(), artifact.proposalPath)}` }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "prompt_evolve",
    "prompt_evolve",
    "Iteratively evolve a teaching prompt template using PROSPER-style pairwise selection. Runs 4 iterations of candidate generation and evaluation.",
    { name: { type: "string", description: "Name of the prompt template to evolve (defaults to 'learn')" } },
    async (params) => {
      const promptName = (params.name as string) || "learn";
      const artifact = await evolvePromptArtifact(getCwd(), promptName);
      return {
        content: [{ type: "text", text: `Prompt "${promptName}" evolved to ${artifact.bestScore.toFixed(2)}\n${relative(getCwd(), artifact.reportPath)}` }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "prompt_eval",
    "prompt_eval",
    "Evaluate a prompt template for teaching effectiveness in a single pass. Returns score, per-objective breakdown, and improvement feedback.",
    { prompt: { type: "string", description: "The prompt template content to evaluate" } },
    async (params) => {
      const promptContent = (params.prompt as string) || "";
      if (!promptContent) return { content: [{ type: "text", text: "Prompt content required." }] };
      const result = await promptEvalArtifact(getCwd(), promptContent);
      const objectives = Object.entries(result.objectives).map(([k, v]) => `- ${k}: ${Number(v).toFixed(2)}`).join("\n");
      const feedback = result.feedback.length > 0 ? result.feedback.map((f: string) => `- ${f}`).join("\n") : "- No major issues detected.";
      return {
        content: [{ type: "text", text: `Score: ${result.score.toFixed(2)}/100\n\nObjectives:\n${objectives}\n\nFeedback:\n${feedback}` }],
        details: result
      };
    }
  ),
];
