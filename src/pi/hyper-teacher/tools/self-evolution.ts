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
    "Run fresh teaching episodes, propose one skill, and activate only after independent validation and holdout gates. Changes apply next session. Synthetic behavior evidence does not establish human learning.",
    {
      topic: { type: "string", description: "Optional topic to focus the improvement on" },
      force: { type: "boolean", description: "Set true only when the learner explicitly asks to run auto_improve again in this session" }
    },
    async (params) => {
      const topic = (params.topic as string) || undefined;
      const result = await autoImproveArtifact(getCwd(), topic, { force: params.force === true, surface: "pi" });
      const score = (value: number | null) => value === null ? "unavailable" : value.toFixed(1);
      return {
        content: [{ type: "text", text: `Teaching experiment: ${result.status}. Behavior: ${score(result.baselineScore)} → ${score(result.afterScore)}. Human learning: unmeasured. Accepted revisions apply next session.\nReport: ${relative(getCwd(), result.reportPath)}` }],
        details: result
      };
    }
  ),
  keatingToolMaker(
    "evolve",
    "evolve",
    "Save unvalidated policy parameter proposals from retrospective evidence. This does not change the active teacher. Use auto_improve for fresh episode evaluation and gated skill activation.",
    { topic: { type: "string", description: "Optional topic to focus the evolution on" } },
    async (params) => {
      const topic = (params.topic as string) || undefined;
      const artifact = await evolvePolicyArtifact(getCwd(), topic, "pi");
      return {
        content: [{ type: "text", text: `[artifact://evolution]\nUnvalidated proposals saved. Descriptive baseline: ${artifact.bestScore.toFixed(2)}. Active teaching revision unchanged.\nProposals: ${relative(getCwd(), artifact.policyPath)}` }],
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
      const artifact = await evolvePromptArtifact(getCwd(), promptName, "pi");
      return {
        content: [{ type: "text", text: `Prompt "${promptName}" evolved to ${artifact.bestScore.toFixed(2)}\n${relative(getCwd(), artifact.reportPath)}` }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "prompt_eval",
    "prompt_eval",
    "Inspect prompt wording against pedagogical criteria. This diagnostic does not measure learner outcomes or authorize activation.",
    { prompt: { type: "string", description: "The prompt template content to evaluate" } },
    async (params) => {
      const promptContent = (params.prompt as string) || "";
      if (!promptContent) return { content: [{ type: "text", text: "Prompt content required." }] };
      const result = await promptEvalArtifact(getCwd(), promptContent, "pi");
      const objectives = Object.entries(result.objectives).map(([k, v]) => `- ${k}: ${Number(v).toFixed(2)}`).join("\n");
      const feedback = result.feedback.length > 0 ? result.feedback.map((f: string) => `- ${f}`).join("\n") : "- No major issues detected.";
      return {
        content: [{ type: "text", text: `Score: ${result.score.toFixed(2)}/100\n\nObjectives:\n${objectives}\n\nFeedback:\n${feedback}` }],
        details: result
      };
    }
  ),
];
