import { relative } from "node:path";

import {
  animateTopicArtifact,
  benchPolicyArtifact,
  currentPolicySummary,
  dueTopicsArtifact,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  evolvePromptArtifact,
  improveArtifact,
  improveHistory,
  listArtifacts,
  mapTopicArtifact,
  planTopicArtifact,
  timelineArtifact,
  verifyTopicArtifact
} from "../core/project.js";
import { learnerStatePath } from "../core/paths.js";
import { loadLearnerState, recordFeedback, recordSessionStart, saveLearnerState } from "../core/learner-state.js";

function topicFromArgs(args: string | string[]): string {
  return (Array.isArray(args) ? args.join(" ") : String(args ?? "")).trim();
}

function info(ctx: any, message: string): void {
  ctx.ui.notify(message, "info");
}

export default function hyperteacher(pi: any): void {
  pi.registerCommand("plan", {
    description: "Generate a deterministic lesson plan artifact for a topic.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args);
      if (!topic) {
        info(ctx, "Usage: /plan <topic>");
        return;
      }
      const artifact = await planTopicArtifact(ctx.cwd, topic);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.planPath)}`);
      info(ctx, `Wrote ${relative(ctx.cwd, artifact.planPath)}`);
    }
  });

  pi.registerCommand("map", {
    description: "Generate a Mermaid lesson map and render it with oxdraw when available.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args);
      if (!topic) {
        info(ctx, "Usage: /map <topic>");
        return;
      }
      const artifact = await mapTopicArtifact(ctx.cwd, topic);
      const outputs = [relative(ctx.cwd, artifact.mmdPath)];
      if (artifact.svgPath) outputs.push(relative(ctx.cwd, artifact.svgPath));
      ctx.ui.setEditorText(`read ${outputs[0]}`);
      info(ctx, `Generated ${outputs.join(" and ")}`);
    }
  });

  pi.registerCommand("animate", {
    description: "Generate a manim-web animation bundle for a topic.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args);
      if (!topic) {
        info(ctx, "Usage: /animate <topic>");
        return;
      }
      const artifact = await animateTopicArtifact(ctx.cwd, topic);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.storyboardPath)}`);
      info(
        ctx,
        `Generated ${relative(ctx.cwd, artifact.playerPath)}, ${relative(ctx.cwd, artifact.scenePath)}, and ${relative(ctx.cwd, artifact.manifestPath)}`
      );
    }
  });

  pi.registerCommand("bench", {
    description: "Run the synthetic learner benchmark suite against the current teaching policy.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args) || undefined;
      const artifact = await benchPolicyArtifact(ctx.cwd, topic);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.reportPath)}`);
      info(
        ctx,
        `Benchmark score ${artifact.overallScore.toFixed(2)} saved to ${relative(ctx.cwd, artifact.reportPath)}${artifact.tracePath ? ` with trace ${relative(ctx.cwd, artifact.tracePath)}` : ""}`
      );
    }
  });

  pi.registerCommand("evolve", {
    description: "Mutate and benchmark teaching policies, then keep the strongest safe candidate.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args) || undefined;
      const artifact = await evolvePolicyArtifact(ctx.cwd, topic);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.reportPath)}`);
      info(
        ctx,
        `Policy evolved to ${artifact.bestScore.toFixed(2)} and saved to ${relative(ctx.cwd, artifact.policyPath)}${artifact.tracePath ? ` with trace ${relative(ctx.cwd, artifact.tracePath)}` : ""}`
      );
    }
  });

  pi.registerCommand("prompt-evolve", {
    description: "Evolve a prompt template using prompt-learning feedback and PROSPER-style selection.",
    handler: async (args: string[], ctx: any) => {
      const promptName = topicFromArgs(args) || "learn";
      const artifact = await evolvePromptArtifact(ctx.cwd, promptName);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.reportPath)}`);
      info(
        ctx,
        `Prompt ${promptName} evolved to ${artifact.bestScore.toFixed(2)} and saved to ${relative(ctx.cwd, artifact.evolvedPromptPath)}`
      );
    }
  });

  pi.registerCommand("policy", {
    description: "Show the active hyperteacher policy.",
    handler: async (_args: string[], ctx: any) => {
      ctx.ui.setEditorText(await currentPolicySummary(ctx.cwd));
      info(ctx, "Loaded current policy into the editor.");
    }
  });

  pi.registerCommand("outputs", {
    description: "Browse Keating plans, maps, benchmark reports, and evolution logs.",
    handler: async (_args: string[], ctx: any) => {
      const artifacts = await listArtifacts(ctx.cwd);
      if (artifacts.length === 0) {
        info(ctx, "No artifacts yet. Use /plan, /map, /bench, or /evolve first.");
        return;
      }
      const selected = await ctx.ui.select("Keating Outputs", artifacts.map((artifact) => artifact.label));
      const artifact = artifacts.find((entry) => entry.label === selected);
      if (artifact) {
        ctx.ui.setEditorText(`read ${artifact.path}`);
      }
    }
  });

  pi.registerCommand("verify", {
    description: "Generate a fact-checking checklist for a topic before teaching it.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args);
      if (!topic) {
        info(ctx, "Usage: /verify <topic>");
        return;
      }
      const result = await verifyTopicArtifact(ctx.cwd, topic);
      if (result.alreadyVerified) {
        info(ctx, `Already verified: ${relative(ctx.cwd, result.checklistPath)}`);
      } else {
        ctx.ui.setEditorText(`read ${relative(ctx.cwd, result.checklistPath)}`);
        info(ctx, `Verification checklist generated. Complete it before teaching this topic.`);
      }
    }
  });

  pi.registerCommand("feedback", {
    description: "Record feedback on the current teaching session (up, down, confused).",
    handler: async (args: string[], ctx: any) => {
      const raw = topicFromArgs(args).toLowerCase();
      const parts = raw.split(/\s+/);
      const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
        up: "thumbs-up",
        down: "thumbs-down",
        confused: "confused"
      };
      const signal = signalMap[parts[0]];
      if (!signal) {
        info(ctx, "Usage: /feedback <up|down|confused> [topic]");
        return;
      }
      const topic = parts.slice(1).join(" ") || "general";
      const statePath = learnerStatePath(ctx.cwd);
      const state = await loadLearnerState(statePath);
      recordFeedback(state, topic, signal);
      await saveLearnerState(statePath, state);
      info(ctx, `Recorded ${signal} feedback for "${topic}".`);
    }
  });

  pi.registerCommand("improve", {
    description: "Generate a self-improvement proposal by diagnosing benchmark weaknesses.",
    handler: async (args: string[], ctx: any) => {
      const sub = topicFromArgs(args).toLowerCase();
      if (sub === "history") {
        const md = await improveHistory(ctx.cwd);
        ctx.ui.setEditorText(md);
        info(ctx, "Loaded improvement history into the editor.");
        return;
      }
      info(ctx, "Running benchmark and diagnosing weaknesses...");
      const artifact = await improveArtifact(ctx.cwd);
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.proposalPath)}`);
      info(
        ctx,
        `Improvement proposal ${artifact.proposal.id} targets ${artifact.proposal.targets.map(t => t.file).join(", ")}`
      );
    }
  });

  pi.registerCommand("trace", {
    description: "Browse persisted benchmark and evolution traces.",
    handler: async (args: string[], ctx: any) => {
      const query = topicFromArgs(args).toLowerCase();
      const artifacts = (await listArtifacts(ctx.cwd)).filter((artifact) =>
        !query ? true : artifact.path.toLowerCase().includes(query) || artifact.label.toLowerCase().includes(query)
      );
      if (artifacts.length === 0) {
        info(ctx, "No matching trace artifacts. Use /bench or /evolve first.");
        return;
      }
      const selected = await ctx.ui.select("Keating Traces", artifacts.map((artifact) => artifact.label));
      const artifact = artifacts.find((entry) => entry.label === selected);
      if (artifact) {
        ctx.ui.setEditorText(`read ${artifact.path}`);
      }
    }
  });

  pi.registerCommand("timeline", {
    description: "Show the engagement timeline for all covered topics, sorted by review urgency.",
    handler: async (_args: string[], ctx: any) => {
      const artifact = await timelineArtifact(ctx.cwd);
      ctx.ui.setEditorText(artifact.markdown);
      info(ctx, `Engagement timeline saved to ${relative(ctx.cwd, artifact.reportPath)}`);
    }
  });

  pi.registerCommand("due", {
    description: "Show topics that are due for review based on spaced repetition.",
    handler: async (_args: string[], ctx: any) => {
      const artifact = await dueTopicsArtifact(ctx.cwd);
      ctx.ui.setEditorText(artifact.markdown);
      if (artifact.count === 0) {
        info(ctx, "All topics are up to date! No reviews needed.");
      } else {
        info(ctx, `${artifact.count} topic${artifact.count === 1 ? "" : "s"} due for review.`);
      }
    }
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    await ensureProjectScaffold(ctx.cwd);
    // Record session start in learner state
    const statePath = learnerStatePath(ctx.cwd);
    const state = await loadLearnerState(statePath);
    recordSessionStart(state);
    await saveLearnerState(statePath, state);
    // Check for due topics and notify
    const dueArtifact = await dueTopicsArtifact(ctx.cwd);
    if (dueArtifact.count > 0) {
      info(ctx, `Keating loaded. ${dueArtifact.count} topic${dueArtifact.count === 1 ? " is" : "s are"} due for review. Use /due to see them.`);
    } else {
      info(ctx, "Keating loaded: use /plan, /map, /animate, /verify, /bench, /evolve, /prompt-evolve, /improve, /trace, /feedback, /timeline, /due, or /policy.");
    }
  });
}
