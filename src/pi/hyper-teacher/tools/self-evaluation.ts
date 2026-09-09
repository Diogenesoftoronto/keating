import {
  benchPolicyArtifact,
  currentPolicySummary,
  dueTopicsArtifact,
  listArtifacts,
  timelineArtifact
} from "../../../core/project.js";
import { loadLearnerContext } from "../../../core/learner-context.js";
import { relative } from "node:path";
import { keatingToolMaker, getCwd } from "./shared.js";

export const selfEvaluationTools = [
  keatingToolMaker(
    "bench",
    "bench",
    "Run a learner-feedback benchmark against the current teaching policy. Uses explicit feedback and inferred learner-turn signals.",
    { topic: { type: "string", description: "Optional topic to focus the benchmark on" } },
    async (params) => {
      const topic = (params.topic as string) || undefined;
      const artifact = await benchPolicyArtifact(getCwd(), topic, "pi");
      return {
        content: [{ type: "text", text: `[artifact://benchmark]\nOverall Score: ${artifact.overallScore.toFixed(2)}/100\nReport: ${relative(getCwd(), artifact.reportPath)}` }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "timeline",
    "timeline",
    "Show the engagement timeline for all covered topics with retention decay and review urgency. Use at session start to check if any topics need review.",
    {},
    async () => {
      const artifact = await timelineArtifact(getCwd());
      return {
        content: [{ type: "text", text: artifact.markdown }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "due",
    "due",
    "Show topics that are due for review based on spaced repetition. Use at session start to proactively suggest review.",
    {},
    async () => {
      const artifact = await dueTopicsArtifact(getCwd());
      return {
        content: [{ type: "text", text: artifact.markdown }],
        details: artifact
      };
    }
  ),
  keatingToolMaker(
    "learner_state",
    "learner_state",
    "Read the learner's saved background, goals, feedback and learning history. This context is already loaded at conversation start; call to inspect current saved records without recording a new session.",
    {},
    async () => {
      return { content: [{ type: "text", text: await loadLearnerContext(getCwd()) }] };
    }
  ),
  keatingToolMaker(
    "trace",
    "trace",
    "Browse benchmark and evolution history. Pass type='benchmark' or type='evolution' to filter.",
    { type: { type: "string", enum: ["benchmark", "evolution", "all"], description: "Filter by trace type" } },
    async (params) => {
      const type = (params.type as string) || "all";
      const artifacts = (await listArtifacts(getCwd())).filter((a: any) =>
        type === "all" ? true : a.path.includes(type)
      ).slice(0, 20);
      if (artifacts.length === 0) return { content: [{ type: "text", text: "No traces yet. Run auto_improve or bench first." }] };
      const list = artifacts.map((a: any) => `- ${a.label} (${new Date(a.createdAt).toLocaleDateString()})`).join("\n");
      return { content: [{ type: "text", text: `Keating Traces\n\n${list}` }] };
    }
  ),
  keatingToolMaker(
    "policy",
    "policy",
    "Show the current active teaching policy parameters.",
    {},
    async () => {
      const summary = await currentPolicySummary(getCwd());
      return { content: [{ type: "text", text: summary }] };
    }
  ),
  keatingToolMaker(
    "outputs",
    "outputs",
    "Browse all saved Keating artifacts (plans, maps, benchmarks, evolutions, etc).",
    {},
    async () => {
      const artifacts = await listArtifacts(getCwd());
      if (artifacts.length === 0) return { content: [{ type: "text", text: "No artifacts yet." }] };
      const list = artifacts.slice(0, 20).map((a: any) => `- ${a.label} (${new Date(a.createdAt).toLocaleDateString()})`).join("\n");
      return { content: [{ type: "text", text: `Keating Artifacts (${artifacts.length} total)\n\n${list}` }] };
    }
  ),
];
