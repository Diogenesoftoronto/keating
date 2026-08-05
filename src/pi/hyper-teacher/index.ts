import { relative } from "node:path";
import {
  animateTopicArtifact,
  autoImproveArtifact,
  benchPolicyArtifact,
  promptEvalArtifact,
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
} from "../../core/project.js";
import { learnerStatePath } from "../../core/paths.js";
import { loadLearnerState, recordFeedback, recordSessionStart, saveLearnerState } from "../../core/learner-state.js";
import { DEFAULT_PI_PROVIDER, loadKeatingConfig } from "../../core/config.js";
import {
  envWithProviderAliases,
  providerIsConfigured,
  providerSetupMessage
} from "../../core/provider-auth.js";
import {
  KEATING_VOICE_TOOL_NAME,
  speechStrategySummary
} from "../../core/speech.js";
import { KEATING_VERSION } from "../../core/version.js";
import { info } from "./ui-helpers.js";
import { createKeatingHeaderComponent } from "./header-component.js";
export { createKeatingHeaderComponent };
import { runKeatingSetupInTui } from "./setup-wizard.js";
import { runPiPackagesCommand } from "./commands/packages.js";
import { registerKeatingTools, setActiveCtx } from "./tools/index.js";
import { registerSpeechTool } from "./tools/speech.js";
import { feedbackOnlyTopics } from "./tools/shared.js";

function topicFromArgs(args: string | string[]): string {
  return (Array.isArray(args) ? args.join(" ") : String(args ?? "")).trim();
}

let greetingShown = false;

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
    description: "Generate a Mermaid lesson map.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args);
      if (!topic) {
        info(ctx, "Usage: /map <topic>");
        return;
      }
      const artifact = await mapTopicArtifact(ctx.cwd, topic);
      const outputs = [relative(ctx.cwd, artifact.mmdPath)];
      ctx.ui.setEditorText(`read ${outputs[0]}`);
      info(ctx, `Generated ${outputs.join(" and ")}`);
    }
  });

  pi.registerCommand("animate", {
    description: "Generate a Hyperframes animation bundle for a topic.",
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
    description: "Run the learner-feedback benchmark suite against the current teaching policy.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args) || undefined;
      const artifact = await benchPolicyArtifact(ctx.cwd, topic, "pi");
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
      const artifact = await evolvePolicyArtifact(ctx.cwd, topic, "pi");
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
      const artifact = await evolvePromptArtifact(ctx.cwd, promptName, "pi");
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, artifact.reportPath)}`);
      info(
        ctx,
        `Prompt ${promptName} evolved to ${artifact.bestScore.toFixed(2)} and saved to ${relative(ctx.cwd, artifact.evolvedPromptPath)}`
      );
    }
  });

  pi.registerCommand("prompt-eval", {
    description: "Evaluate a prompt template for teaching effectiveness in a single pass.",
    handler: async (args: string[], ctx: any) => {
      const promptContent = topicFromArgs(args);
      if (!promptContent) {
        info(ctx, "Usage: /prompt-eval <prompt text>");
        return;
      }
      const result = await promptEvalArtifact(ctx.cwd, promptContent, "pi");
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, result.reportPath)}`);
      info(ctx, `Prompt scored ${result.score.toFixed(2)}/100`);
    }
  });

  pi.registerCommand("policy", {
    description: "Show the active hyperteacher policy.",
    handler: async (_args: string[], ctx: any) => {
      ctx.ui.setEditorText(await currentPolicySummary(ctx.cwd));
      info(ctx, "Loaded current policy into the editor.");
    }
  });

  pi.registerCommand("speech", {
    description: "Show optional voice-tool status.",
    handler: async (_args: string[], ctx: any) => {
      const config = await loadKeatingConfig(ctx.cwd);
      ctx.ui.setEditorText(speechStrategySummary(config.speech));
      if (config.speech.enabled) {
        info(ctx, `Speech is enabled. The model can call ${KEATING_VOICE_TOOL_NAME}.`);
      } else {
        info(ctx, "Speech is disabled. Set speech.enabled=true in keating.config.json to expose the voice tool.");
      }
    }
  });

  pi.registerCommand("setup", {
    description: "Configure Keating provider/model defaults inside the TUI.",
    handler: async (_args: string[], ctx: any) => {
      await runKeatingSetupInTui(ctx);
    }
  });

  pi.registerCommand("packages", {
    description: "Manage extra Pi packages loaded by Keating.",
    handler: async (args: string | string[], ctx: any) => {
      await runPiPackagesCommand(args, ctx);
    }
  });

  pi.registerCommand("version", {
    description: "Show the current Keating version.",
    handler: async (_args: string[], ctx: any) => {
      info(ctx, `Keating v${KEATING_VERSION}`);
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
    description: "Record feedback on the current teaching session (up, down, confused) with an optional comment.",
    handler: async (args: string | string[], ctx: any) => {
      const parts = Array.isArray(args) ? args : String(args ?? "").trim().split(/\s+/);
      const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
        up: "thumbs-up",
        down: "thumbs-down",
        confused: "confused"
      };
      const signal = signalMap[parts[0]?.toLowerCase() ?? ""];
      if (!signal) {
        info(ctx, "Usage: /feedback <up|down|confused> [topic] [--comment=message]");
        return;
      }
      let comment: string | undefined;
      const filtered = parts.filter((arg: string) => {
        if (arg.startsWith("--comment=")) {
          comment = arg.slice("--comment=".length);
          return false;
        }
        return true;
      });
      const topic = filtered.slice(1).join(" ") || "general";
      const statePath = learnerStatePath(ctx.cwd);
      const state = await loadLearnerState(statePath);
      recordFeedback(state, topic, signal, comment);
      await saveLearnerState(statePath, state);
      const commentHint = comment ? ` with comment` : "";
      info(ctx, `Recorded ${signal} feedback for "${topic}".${commentHint}`);
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

  pi.registerCommand("auto-improve", {
    description: "Run the full self-improvement loop: benchmark → evolve policy → evolve prompt → benchmark again.",
    handler: async (args: string[], ctx: any) => {
      const topic = topicFromArgs(args) || undefined;
      info(ctx, "Running auto-improve loop (bench → evolve → prompt-evolve → bench)...");
      const result = await autoImproveArtifact(ctx.cwd, topic, { surface: "pi" });
      const verdict = result.delta > 0 ? "IMPROVED" : result.delta < -0.5 ? "REGRESSED" : "NO SIGNIFICANT CHANGE";
      ctx.ui.setEditorText(`read ${relative(ctx.cwd, result.reportPath)}`);
      info(ctx, `Auto-improve: ${result.baselineScore.toFixed(2)} → ${result.afterScore.toFixed(2)} (${verdict}, Δ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(2)})`);
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

  pi.registerCommand("learner-state", {
    description: "Show the learner's profile and session history.",
    handler: async (_args: string[], ctx: any) => {
      const statePath = learnerStatePath(ctx.cwd);
      const state = await loadLearnerState(statePath);
      const upCount = state.feedback.filter((f) => f.signal === "thumbs-up").length;
      const downCount = state.feedback.filter((f) => f.signal === "thumbs-down").length;
      const confusedCount = state.feedback.filter((f) => f.signal === "confused").length;
      const feedbackTopics = feedbackOnlyTopics(state);
      const lines = [
        `Sessions: ${state.sessions?.length ?? 0}`,
        `Topics covered: ${state.coveredTopics.length}`,
        ...state.coveredTopics.slice(-10).map((t) => ` - ${t.slug} (${t.domain})`),
        ...(feedbackTopics.length > 0
          ? [`Feedback-only topics: ${feedbackTopics.length}`, ...feedbackTopics.map((topic) => ` - ${topic}`)]
          : []),
        `Feedback: 👍${upCount} 👎${downCount} 🤔${confusedCount}`,
        `Misconceptions identified: ${state.identifiedMisconceptions.length}`,
      ];
      ctx.ui.setEditorText(lines.join("\n"));
      info(ctx, "Learner profile loaded.");
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
    const config = await loadKeatingConfig(ctx.cwd);
    setActiveCtx(ctx);
    registerKeatingTools(pi);
    registerSpeechTool(pi, config);
    const configuredProvider = config.pi.defaultProvider ?? DEFAULT_PI_PROVIDER;
    const missingProvider = process.env.KEATING_AUTH_MISSING_PROVIDER || "";
    const hasConfiguredProvider = providerIsConfigured(ctx.cwd, envWithProviderAliases(process.env), configuredProvider);
    if (missingProvider || (!hasConfiguredProvider && config.debug.consoleSummary)) {
      info(ctx, providerSetupMessage(missingProvider || configuredProvider));
    }

    // ─── Branded greeting on first session in this process ───────────────
    if (!greetingShown) {
      greetingShown = true;
      if (ctx.hasUI !== false && typeof ctx.ui.setHeader === "function") {
        ctx.ui.setHeader(createKeatingHeaderComponent(pi, ctx));
      } else if (typeof ctx.ui.setWidget === "function") {
        ctx.ui.setWidget("keating-greeting", createKeatingHeaderComponent(pi, ctx));
      }
    }

    // Check for due topics and notify
    const dueArtifact = await dueTopicsArtifact(ctx.cwd);
    if (config.debug.consoleSummary) {
      if (dueArtifact.count > 0) {
        info(ctx, `Keating loaded. ${dueArtifact.count} topic${dueArtifact.count === 1 ? " is" : "s are"} due for review. Use /due to see them.`);
      } else {
        info(ctx, `Keating loaded — ready to teach. Type a topic or a command.`);
      }
    }
  });
}
