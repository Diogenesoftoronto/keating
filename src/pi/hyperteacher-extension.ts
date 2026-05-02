import { relative } from "node:path";
import { homedir } from "node:os";

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
import { type KeatingConfig, loadKeatingConfig } from "../core/config.js";
import { shellCommandSections } from "../core/commands.js";
import {
  KEATING_VOICE_TOOL_NAME,
  VOICE_TAGS,
  normalizeVoiceUtterance,
  speechStrategySummary,
  voiceTagLine
} from "../core/speech.js";
import { KEATING_ASCII_LOGO, KEATING_SUBTITLE_LINES } from "../core/terminal.js";

const KEATING_VERSION = "0.3.0";
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

function padVisible(text: string, width: number): string {
  const vw = visibleWidth(text);
  return vw >= width ? text : text + " ".repeat(width - vw);
}

function truncatePlain(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, Math.max(0, width));
  return `${text.slice(0, width - 1)}…`;
}

function centerPlain(text: string, width: number): string {
  const truncated = truncatePlain(text, width);
  const gap = Math.max(0, width - truncated.length);
  const left = Math.floor(gap / 2);
  return `${" ".repeat(left)}${truncated}${" ".repeat(gap - left)}`;
}

function wrapWords(text: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const raw of words) {
    const word = truncatePlain(raw, width);
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function formatHeaderPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function getCurrentModelLabel(ctx: any): string {
  if (typeof ctx?.model === "string" && ctx.model.trim()) return ctx.model.trim();
  if (ctx?.model?.provider && ctx?.model?.id) return `${ctx.model.provider}/${ctx.model.id}`;

  const branch = ctx?.sessionManager?.getBranch?.();
  if (Array.isArray(branch)) {
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index];
      if (entry?.type === "model_change" && entry.provider && entry.modelId) {
        return `${entry.provider}/${entry.modelId}`;
      }
    }
  }

  return "not set";
}

function getSessionLabel(ctx: any): string {
  const manager = ctx?.sessionManager;
  return manager?.getSessionName?.()?.trim() || manager?.getSessionId?.() || "new session";
}

function summarizeLastActivity(ctx: any): string {
  const branch = ctx?.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return "";

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    const role = message?.role === "assistant" ? "agent" : message?.role === "user" ? "you" : message?.role;
    const content = message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((item: any) => item?.text ?? (item?.name ? `[${item.name}]` : "")).filter(Boolean).join(" ")
        : "";
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact) return `${role ?? "message"}: ${compact}`;
  }

  return "";
}

function topicFromArgs(args: string | string[]): string {
  return (Array.isArray(args) ? args.join(" ") : String(args ?? "")).trim();
}

function info(ctx: any, message: string): void {
  ctx.ui.notify(message, "info");
}

function createKeatingHeaderComponent(pi: any, ctx: any): (tui: any, theme: any) => any {
  const sections = shellCommandSections();
  const commandCount = sections.reduce((sum, section) => sum + section.commands.length, 0);

  return (_tui: any, theme: any): any => {
    const t = theme.fg.bind(theme);
    const b = theme.bold.bind(theme);
    const border = (text: string) => t("borderMuted", text);
    const dim = (text: string) => t("dim", text);
    const accent = (text: string) => t("accent", text);
    const heading = (text: string) => b(t("mdHeading", text));
    const text = (value: string) => t("text", value);

    return {
      render(width: number): string[] {
        const maxWidth = Math.max(width - 2, 1);
        const cardWidth = Math.min(maxWidth, 120);
        const innerWidth = Math.max(cardWidth - 2, 1);
        const contentWidth = Math.max(innerWidth - 2, 1);
        const outerPad = " ".repeat(Math.max(0, Math.floor((width - cardWidth) / 2)));
        const lines: string[] = [];
        const push = (line: string) => lines.push(`${outerPad}${line}`);
        const row = (content: string) => `${border("│")} ${padVisible(content, contentWidth)} ${border("│")}`;
        const emptyRow = () => `${border("│")}${" ".repeat(innerWidth)}${border("│")}`;
        const separator = () => `${border("├")}${border("─".repeat(innerWidth))}${border("┤")}`;
        const useWideLayout = contentWidth >= 72;

        push("");
        if (cardWidth >= 72) {
          const logoWidth = Math.max(...KEATING_ASCII_LOGO.map(line => line.length));
          const logoPad = " ".repeat(Math.max(0, Math.floor((cardWidth - logoWidth) / 2)));
          const palette = ["accent", "accent", "mdHeading", "mdHeading", "text", "text"];
          for (let index = 0; index < KEATING_ASCII_LOGO.length; index += 1) {
            push(b(t(palette[index] ?? "text", `${logoPad}${KEATING_ASCII_LOGO[index]}`)));
          }
          push("");
        }

        const versionTag = ` v${KEATING_VERSION} `;
        const versionGap = Math.max(0, innerWidth - versionTag.length);
        const versionLeft = Math.floor(versionGap / 2);
        push(
          border(`╭${"─".repeat(versionLeft)}`) +
            dim(versionTag) +
            border(`${"─".repeat(versionGap - versionLeft)}╮`),
        );

        if (useWideLayout) {
          const leftWidth = Math.min(38, Math.floor(contentWidth * 0.35));
          const dividerWidth = 3;
          const rightWidth = contentWidth - leftWidth - dividerWidth;
          const leftValueWidth = Math.max(1, leftWidth - 11);
          const commandNameWidth = 18;
          const commandDescWidth = Math.max(12, rightWidth - commandNameWidth - 2);
          const leftLines: string[] = [""];
          const rightLines: string[] = ["", heading("Teaching Workflows")];
          const leftLabel = (label: string, value: string, color: "text" | "dim") => {
            const wrapped = wrapWords(value, leftValueWidth);
            leftLines.push(`${dim(label.padEnd(10))} ${color === "text" ? text(wrapped[0]!) : dim(wrapped[0]!)}`);
            for (const line of wrapped.slice(1)) {
              leftLines.push(`${" ".repeat(11)}${color === "text" ? text(line) : dim(line)}`);
            }
          };
          const listBlock = (label: string, value: string) => {
            if (!value) return;
            leftLines.push("");
            leftLines.push(accent(b(label)));
            for (const line of wrapWords(value, leftWidth)) {
              leftLines.push(dim(line));
            }
          };

          leftLabel("model", getCurrentModelLabel(ctx), "text");
          leftLabel("directory", formatHeaderPath(ctx.cwd), "text");
          leftLabel("session", getSessionLabel(ctx), "dim");
          leftLines.push("");
          leftLines.push(dim(`${pi.getAllTools?.().length ?? 0} tools · ${commandCount} commands`));
          listBlock("Purpose", KEATING_SUBTITLE_LINES[0] ?? "The Hyperteacher");
          listBlock("Last Activity", truncatePlain(summarizeLastActivity(ctx), leftWidth * 2));

          for (const section of sections) {
            rightLines.push("");
            rightLines.push(accent(b(section.title)));
            for (const command of section.commands) {
              const wrapped = wrapWords(command.description, commandDescWidth);
              rightLines.push(`${accent(command.usage.padEnd(commandNameWidth))}${dim(wrapped[0]!)}`);
              for (const line of wrapped.slice(1)) {
                rightLines.push(`${" ".repeat(commandNameWidth)}${dim(line)}`);
              }
            }
          }

          const maxRows = Math.max(leftLines.length, rightLines.length);
          for (let index = 0; index < maxRows; index += 1) {
            push(row(
              `${padVisible(leftLines[index] ?? "", leftWidth)}` +
              `${border(" │ ")}` +
              `${padVisible(rightLines[index] ?? "", rightWidth)}`,
            ));
          }
        } else {
          push(emptyRow());
          push(row(heading(centerPlain(KEATING_SUBTITLE_LINES[0] ?? "Keating", contentWidth))));
          push(row(dim(centerPlain(KEATING_SUBTITLE_LINES[1] ?? "The Hyperteacher", contentWidth))));
          push(row(dim(centerPlain(`${pi.getAllTools?.().length ?? 0} tools · ${commandCount} commands`, contentWidth))));
          push(emptyRow());
          push(separator());
          for (const section of sections) {
            push(row(accent(b(section.title))));
            for (const command of section.commands) {
              const descWidth = Math.max(1, contentWidth - 18);
              push(row(`${accent(command.usage.padEnd(17))}${dim(truncatePlain(command.description, descWidth))}`));
            }
          }
        }

        push(border(`╰${"─".repeat(innerWidth)}╯`));
        push("");
        return lines;
      },
      invalidate(): void {},
      dispose(): void {},
    };
  };
}

let greetingShown = false;
const speechToolRegistrations = new WeakSet<object>();

function voiceToolParameters(): any {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description: "Short learner-facing sentence or question to speak. Keep it conversational and concise."
      },
      voice: {
        type: "string",
        description: "Optional voice identity. Defaults to Keating's configured speech.defaultVoice."
      },
      tags: {
        type: "array",
        description: "Voice tags that describe the teaching move.",
        items: {
          type: "string",
          enum: VOICE_TAGS
        }
      },
      pace: {
        type: "string",
        enum: ["slow", "normal", "quick"],
        description: "Delivery pace."
      },
      affect: {
        type: "string",
        enum: ["warm", "curious", "firm", "celebratory"],
        description: "Conversational affect."
      },
      listenFor: {
        type: "string",
        description: "What the supervising reasoning loop should listen for or verify after this utterance."
      }
    }
  };
}

function registerSpeechTool(pi: any, config: KeatingConfig): void {
  if (!config.speech.enabled || typeof pi.registerTool !== "function") return;
  if (typeof pi === "object" && pi !== null && speechToolRegistrations.has(pi)) return;

  pi.registerTool({
    name: KEATING_VOICE_TOOL_NAME,
    label: "Keating Voice",
    description: "Emit a concise voice-tagged teaching utterance for an optional conversational speech layer.",
    promptSnippet: "Speak brief learner-facing utterances with voice tags while the normal model continues reasoning, questioning, and verification.",
    promptGuidelines: [
      "Use keating_voice only when speech is useful for a learner-facing sentence, question, redirect, recap, or encouragement.",
      "Use keating_voice for short conversational delivery; keep deeper reasoning, verification, and tool-backed correction in normal text and normal tools.",
      "Use keating_voice tags to mark the teaching move, especially question, verify, redirect, encourage, pause, recap, and explain.",
      "Do not use keating_voice for citations, long derivations, file paths, code blocks, or private reasoning."
    ],
    parameters: voiceToolParameters(),
    async execute(_toolCallId: string, params: any) {
      const utterance = normalizeVoiceUtterance(params, config.speech);
      return {
        content: [{ type: "text", text: voiceTagLine(utterance) }],
        details: {
          provider: "tags-only",
          fastModel: config.speech.fastModel,
          steeringModel: config.speech.steeringModel,
          utterance
        }
      };
    }
  });

  if (typeof pi === "object" && pi !== null) {
    speechToolRegistrations.add(pi);
  }
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
    const config = await loadKeatingConfig(ctx.cwd);
    registerSpeechTool(pi, config);

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
