import { access } from "node:fs/promises";
import { relative } from "node:path";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { configPath, loadKeatingConfig } from "../core/config.js";
import { learnerStatePath } from "../core/paths.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../core/learner-state.js";
import {
  animateTopicArtifact,
  autoImproveArtifact,
  benchPolicyArtifact,
  promptEvalArtifact,
  currentPolicySummary,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  evolvePromptArtifact,
  improveArtifact,
  improveHistory,
  listArtifacts,
  mapTopicArtifact,
  planTopicArtifact,
  quizTopicArtifact,
  verifyTopicArtifact,
  timelineArtifact,
  dueTopicsArtifact
} from "../core/project.js";
import { detectAiRuntime, launchShell } from "../runtime/pi.js";
import { serveWeb } from "./web.js";
import { color, bold, cliCommands } from "../core/theme.js";
import { printAsciiHeader } from "../core/terminal.js";

function printUsage(): void {
  printAsciiHeader();
  console.log(bold("primary", "Keating CLI") + "  " + color.dim + color.sepia + "v0.3.5" + color.reset);
  console.log(color.parchment + "The Hyperteacher — cognitive empowerment through Socratic AI." + color.reset);
  console.log("");
  console.log(cliCommands());
  console.log("");
  console.log(bold("primary", "General Commands"));
  console.log(`  ${color.primary}shell${color.reset}  [initial prompt...]  Launch the AI-powered hyperteacher shell`);
  console.log(`  ${color.primary}doctor${color.reset}                    Inspect AI runtime and oxdraw availability`);
  console.log(`  ${color.primary}web${color.reset}     [port]             Start a local server for the browser UI`);
  console.log(`  ${color.primary}policy${color.reset}                    Print the active teaching policy`);
  console.log(`  ${color.primary}trace${color.reset}   [substring]        Browse debug traces and artifacts`);
  console.log("");
}

async function run(): Promise<void> {
  const [command = "shell", ...args] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command) {
    case "web": {
      const port = args[0] ? parseInt(args[0], 10) : 3000;
      await serveWeb(port);
      return;
    }
    case "shell": {
      const exitCode = await launchShell(cwd, args);
      process.exitCode = exitCode;
      return;
    }
    case "plan": {
      const topic = args.join(" ").trim();
      if (!topic) throw new Error("plan requires a topic.");
      const artifact = await planTopicArtifact(cwd, topic);
      console.log(relative(cwd, artifact.planPath));
      return;
    }
    case "map": {
      const topic = args.join(" ").trim();
      if (!topic) throw new Error("map requires a topic.");
      const artifact = await mapTopicArtifact(cwd, topic);
      console.log(relative(cwd, artifact.mmdPath));
      if (artifact.svgPath) console.log(relative(cwd, artifact.svgPath));
      return;
    }
    case "animate": {
      const topic = args.join(" ").trim();
      if (!topic) throw new Error("animate requires a topic.");
      const artifact = await animateTopicArtifact(cwd, topic);
      console.log(relative(cwd, artifact.playerPath));
      console.log(relative(cwd, artifact.scenePath));
      console.log(relative(cwd, artifact.storyboardPath));
      console.log(relative(cwd, artifact.manifestPath));
      return;
    }
    case "verify": {
      const topic = args.join(" ").trim();
      if (!topic) throw new Error("verify requires a topic.");
      const result = await verifyTopicArtifact(cwd, topic);
      if (result.alreadyVerified) {
        console.log(`Already verified: ${relative(cwd, result.checklistPath)}`);
      } else {
        console.log(`Verification checklist: ${relative(cwd, result.checklistPath)}`);
      }
      return;
    }
    case "quiz": {
      const topic = args.join(" ").trim();
      if (!topic) throw new Error("quiz requires a topic.");
      const result = await quizTopicArtifact(cwd, topic);
      console.log(relative(cwd, result.quizPath));
      console.log(relative(cwd, result.answersPath));
      return;
    }
    case "bench": {
      const topic = args.join(" ").trim() || undefined;
      const result = await benchPolicyArtifact(cwd, topic);
      console.log(`${result.overallScore.toFixed(2)} ${relative(cwd, result.reportPath)}`);
      if (result.tracePath) console.log(relative(cwd, result.tracePath));
      return;
    }
    case "evolve": {
      const topic = args.join(" ").trim() || undefined;
      const result = await evolvePolicyArtifact(cwd, topic);
      console.log(`${result.bestScore.toFixed(2)} ${relative(cwd, result.reportPath)}`);
      if (result.tracePath) console.log(relative(cwd, result.tracePath));
      return;
    }
    case "prompt-evolve": {
      const promptName = args.join(" ").trim() || "learn";
      const result = await evolvePromptArtifact(cwd, promptName);
      console.log(`${result.bestScore.toFixed(2)} ${relative(cwd, result.reportPath)}`);
      console.log(relative(cwd, result.evolvedPromptPath));
      return;
    }
    case "prompt-eval": {
      const promptContent = args.join(" ").trim();
      if (!promptContent) throw new Error("prompt-eval requires prompt text to evaluate.");
      const result = await promptEvalArtifact(cwd, promptContent);
      console.log(`${result.score.toFixed(2)} ${relative(cwd, result.reportPath)}`);
      return;
    }
    case "improve": {
      if (args[0] === "history") {
        const md = await improveHistory(cwd);
        console.log(md);
        return;
      }
      const artifact = await improveArtifact(cwd);
      console.log(`Proposal: ${artifact.proposal.id}`);
      console.log(`Targets: ${artifact.proposal.targets.map(t => t.file).join(", ")}`);
      console.log(relative(cwd, artifact.proposalPath));
      return;
    }
    case "auto-improve": {
      const topic = args.join(" ").trim() || undefined;
      const result = await autoImproveArtifact(cwd, topic);
      const verdict = result.delta > 0
        ? `${color.ok}IMPROVED by +${result.delta.toFixed(2)}${color.reset}`
        : result.delta < -0.5
          ? `${color.err}REGRESSED by ${result.delta.toFixed(2)}${color.reset}`
          : `${color.sepia}NO SIGNIFICANT CHANGE (Δ${result.delta.toFixed(2)})${color.reset}`;
      console.log(`Baseline: ${result.baselineScore.toFixed(2)} → After: ${result.afterScore.toFixed(2)} — ${verdict}`);
      console.log(relative(cwd, result.reportPath));
      return;
    }
    case "policy": {
      await ensureProjectScaffold(cwd);
      console.log(await currentPolicySummary(cwd));
      return;
    }
    case "trace": {
      await ensureProjectScaffold(cwd);
      const query = args.join(" ").trim().toLowerCase();
      const artifacts = await listArtifacts(cwd);
      for (const artifact of artifacts) {
        if (!query || artifact.path.toLowerCase().includes(query) || artifact.label.toLowerCase().includes(query)) {
          console.log(artifact.path);
        }
      }
      return;
    }
    case "learner-state": {
      await ensureProjectScaffold(cwd);
      const statePath = learnerStatePath(cwd);
      const state = await loadLearnerState(statePath);
      const upCount = state.feedback.filter((f) => f.signal === "thumbs-up").length;
      const downCount = state.feedback.filter((f) => f.signal === "thumbs-down").length;
      const confusedCount = state.feedback.filter((f) => f.signal === "confused").length;
      console.log(`${bold("primary", "Learner Profile")}`);
      console.log(`  Sessions: ${state.sessions?.length ?? 0}`);
      console.log(`  Topics covered: ${state.coveredTopics.length}`);
      for (const t of state.coveredTopics.slice(-10)) console.log(`    - ${t.slug} (${t.domain})`);
      console.log(`  Feedback: 👍${upCount} 👎${downCount} 🤔${confusedCount}`);
      console.log(`  Misconceptions identified: ${state.identifiedMisconceptions.length}`);
      return;
    }
    case "timeline": {
      const { markdown } = await timelineArtifact(cwd);
      console.log(markdown);
      return;
    }
    case "due": {
      const { markdown } = await dueTopicsArtifact(cwd);
      console.log(markdown);
      return;
    }
    case "feedback": {
      const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
        up: "thumbs-up",
        down: "thumbs-down",
        confused: "confused"
      };
      const signal = signalMap[args[0]?.toLowerCase() ?? ""];
      if (!signal) {
        throw new Error("Usage: keating feedback <up|down|confused> [topic] [--comment=message]");
      }
      let comment: string | undefined;
      const filtered = args.filter((arg) => {
        if (arg.startsWith("--comment=")) {
          comment = arg.slice("--comment=".length);
          return false;
        }
        return true;
      });
      const topic = filtered.slice(1).join(" ") || "general";
      const statePath = learnerStatePath(cwd);
      const state = await loadLearnerState(statePath);
      recordFeedback(state, topic, signal, comment);
      await saveLearnerState(statePath, state);
      const sigLabel = { "thumbs-up": "👍 up", "thumbs-down": "👎 down", "confused": "🤔 confused" }[signal];
      const commentHint = comment ? ` (comment: "${comment}")` : "";
      console.log(`${color.ok}Recorded ${sigLabel} feedback for "${topic}"${commentHint}.${color.reset}`);
      return;
    }
    case "doctor": {
      await ensureProjectScaffold(cwd);
      const config = await loadKeatingConfig(cwd);
      const runtime = await detectAiRuntime(cwd);
      const oxdraw = spawnSync("which", ["oxdraw"], { encoding: "utf8" });
      const manimWebPath = join(cwd, "node_modules", "manim-web", "dist", "index.js");
      const manimWebInstalled = await access(manimWebPath).then(
        () => true,
        () => false
      );
      console.log(`${bold("primary", "Keating Doctor")}  ${color.sepia}diagnostic report${color.reset}\n`);
      console.log(`  ${color.cream}config_path${color.reset}           ${color.sepia}${configPath(cwd)}${color.reset}`);
      console.log(`  ${color.cream}ai_runtime_preference${color.reset} ${color.primary}${config.pi.runtimePreference}${color.reset}`);
      console.log(`  ${color.cream}ai_default_provider${color.reset}   ${config.pi.defaultProvider ?? color.sepia + "unset" + color.reset}`);
      console.log(`  ${color.cream}ai_default_model${color.reset}      ${config.pi.defaultModel ?? color.sepia + "unset" + color.reset}`);
      console.log(`  ${color.cream}ai_default_thinking${color.reset}   ${config.pi.defaultThinking ?? color.sepia + "unset" + color.reset}`);
      console.log(`  ${color.cream}debug_persist_traces${color.reset}  ${color.primary}${String(config.debug.persistTraces)}${color.reset}`);
      console.log(`  ${color.cream}debug_trace_top_learners${color.reset} ${color.primary}${String(config.debug.traceTopLearners)}${color.reset}`);
      console.log(`  ${color.cream}debug_console_summary${color.reset} ${color.primary}${String(config.debug.consoleSummary)}${color.reset}`);
      console.log(`  ${color.cream}ai_runtime${color.reset}            ${runtime.selected ? color.ok + runtime.selected.kind : color.err + "missing"}${color.reset}`);
      console.log(`  ${color.cream}ai_standalone${color.reset}         ${runtime.standalone ? color.primary + runtime.standalone.command : color.err + "missing"}${color.reset}`);
      console.log(`  ${color.cream}ai_embedded${color.reset}           ${runtime.embedded ? color.primary + (runtime.embedded.cliPath ?? runtime.embedded.command) : color.err + "missing"}${color.reset}`);
      if (runtime.selected) console.log(`  ${color.cream}ai_command${color.reset}            ${color.primary}${runtime.selected.command}${color.reset}`);
      console.log(`  ${color.cream}oxdraw${color.reset}                ${oxdraw.status === 0 ? color.ok + oxdraw.stdout.trim() : color.err + "missing"}${color.reset}`);
      console.log(`  ${color.cream}manim_web${color.reset}             ${manimWebInstalled ? color.ok + manimWebPath : color.err + "missing"}${color.reset}`);
      return;
    }
    case "help":
    case "--help":
    case "-h": {
      printUsage();
      return;
    }
    default: {
      throw new Error(`Unknown command: ${command}`);
    }
  }
}

run().catch((error) => {
  console.error(`${color.err}${color.bold}Error:${color.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
