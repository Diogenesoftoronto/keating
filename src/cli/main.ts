import { access } from "node:fs/promises";
import { relative } from "node:path";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { configPath, loadKeatingConfig } from "../core/config.js";
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
import { detectPiRuntime, launchPi } from "../runtime/pi.js";

function printUsage(): void {
  console.log(`keating commands:
  shell [initial prompt...]   Launch the Pi-powered hyperteacher shell
  plan <topic>                Write a deterministic lesson plan artifact
  map <topic>                 Write a Mermaid map and render with oxdraw if present
  animate <topic>             Write a manim-web animation bundle for a topic
  bench [topic]               Run the learner benchmark suite
  evolve [topic]              Evolve the current teaching policy
  policy                      Print the active policy
  trace [substring]           List persisted debug traces and artifacts
  doctor                      Inspect Pi/Feynman and oxdraw availability
`);
}

async function run(): Promise<void> {
  const [command = "shell", ...args] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command) {
    case "shell": {
      const exitCode = await launchPi(cwd, args);
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
    case "doctor": {
      await ensureProjectScaffold(cwd);
      const config = await loadKeatingConfig(cwd);
      const runtime = await detectPiRuntime(cwd);
      const oxdraw = spawnSync("which", ["oxdraw"], { encoding: "utf8" });
      const manimWebPath = join(cwd, "node_modules", "manim-web", "dist", "index.js");
      const manimWebInstalled = await access(manimWebPath).then(
        () => true,
        () => false
      );
      console.log(`config_path=${configPath(cwd)}`);
      console.log(`pi_runtime_preference=${config.pi.runtimePreference}`);
      console.log(`pi_default_provider=${config.pi.defaultProvider ?? "unset"}`);
      console.log(`pi_default_model=${config.pi.defaultModel ?? "unset"}`);
      console.log(`pi_default_thinking=${config.pi.defaultThinking ?? "unset"}`);
      console.log(`debug_persist_traces=${String(config.debug.persistTraces)}`);
      console.log(`debug_trace_top_learners=${String(config.debug.traceTopLearners)}`);
      console.log(`debug_console_summary=${String(config.debug.consoleSummary)}`);
      console.log(`pi_runtime=${runtime.selected ? runtime.selected.kind : "missing"}`);
      console.log(`pi_standalone=${runtime.standalone ? runtime.standalone.command : "missing"}`);
      console.log(`pi_embedded=${runtime.embedded ? runtime.embedded.cliPath ?? runtime.embedded.command : "missing"}`);
      if (runtime.selected) console.log(`pi_command=${runtime.selected.command}`);
      console.log(`oxdraw=${oxdraw.status === 0 ? oxdraw.stdout.trim() : "missing"}`);
      console.log(`manim_web=${manimWebInstalled ? manimWebPath : "missing"}`);
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
