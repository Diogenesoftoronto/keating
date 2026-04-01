import { relative } from "node:path";

import {
  animateTopicArtifact,
  benchPolicyArtifact,
  currentPolicySummary,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  listArtifacts,
  mapTopicArtifact,
  planTopicArtifact
} from "../core/project.js";

function topicFromArgs(args: string[]): string {
  return args.join(" ").trim();
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

  pi.on("session_start", async (_event: any, ctx: any) => {
    await ensureProjectScaffold(ctx.cwd);
    info(ctx, "Keating loaded: use /plan, /map, /animate, /bench, /evolve, /trace, or /policy.");
  });
}
