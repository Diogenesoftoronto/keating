import { relative } from "node:path";
import { homedir } from "node:os";

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
import { generateQuiz, quizToMarkdown, quizAnswerKeyToMarkdown } from "../core/quiz.js";
import { KEATING_VERSION } from "../core/version.js";

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function visibleWidth(text: string): number {
 return text.replace(ANSI_RE, "").length;
}

function truncateVisible(text: string, width: number): string {
 const limit = Math.max(0, width);
 if (visibleWidth(text) <= limit) return text;
 if (limit === 0) return "";

 const suffix = limit > 1 ? "…" : "";
 const contentLimit = Math.max(0, limit - visibleWidth(suffix));
 let visible = 0;
 let output = "";

 for (let index = 0; index < text.length;) {
 const ansi = text.slice(index).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
 if (ansi) {
 output += ansi[0];
 index += ansi[0].length;
 continue;
 }

 if (visible >= contentLimit) break;
 output += text[index];
 visible += 1;
 index += 1;
 }

 return `${output}${suffix}`;
}

function padVisible(text: string, width: number): string {
 const fitted = truncateVisible(text, width);
 const vw = visibleWidth(fitted);
 return vw >= width ? fitted : fitted + " ".repeat(width - vw);
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

export function createKeatingHeaderComponent(pi: any, ctx: any): (tui: any, theme: any) => any {
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

let activeCtx: any = null;
let greetingShown = false;
const speechToolRegistrations = new WeakSet<object>();
const keatingToolRegistrations = new WeakSet<object>();

function getCwd(): string {
 return activeCtx?.cwd ?? process.cwd();
}

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

function feedbackOnlyTopics(state: Awaited<ReturnType<typeof loadLearnerState>>): string[] {
 const covered = new Set(state.coveredTopics.map((topic) => topic.slug));
 return [...new Set(
 state.feedback
 .map((feedback) => feedback.topic.trim())
 .filter((topic) => topic && topic !== "general" && !covered.has(topic))
 )].slice(-10);
}

function keatingToolMaker(name: string, label: string, description: string, parameters: Record<string, unknown>, exec: (params: Record<string, unknown>) => Promise<Record<string, unknown>>) {
 return {
 name,
 label,
 description,
 parameters: { type: "object" as const, additionalProperties: false, properties: parameters },
 async execute(_toolCallId: string, params: Record<string, unknown>) {
 return exec(params);
 }
 };
}

function registerKeatingTools(pi: any): void {
 if (typeof pi.registerTool !== "function") return;
 if (typeof pi === "object" && pi !== null && keatingToolRegistrations.has(pi)) return;

 const pick = (a: string) => a.toLowerCase().trim();
 const up = "thumbs-up";
 const down = "thumbs-down";
 const confused = "confused";

 const tools = [
 // ── Teaching ──
 keatingToolMaker(
 "plan",
 "plan",
 "Generate a structured lesson plan for a topic, adapted to the current teaching policy. Use before teaching any topic to structure your approach.",
 { topic: { type: "string", description: "The topic to generate a lesson plan for" } },
 async (params) => {
 const topic = (params.topic as string) || "";
 if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
 const artifact = await planTopicArtifact(getCwd(), topic);
 return {
 content: [{ type: "text", text: `[artifact://plan]\nWrote ${relative(getCwd(), artifact.planPath)}` }],
 details: artifact
 };
 }
 ),
 keatingToolMaker(
 "map",
 "map",
 "Generate a Mermaid concept map for a topic. Use to visualize knowledge structure before or during teaching.",
 { topic: { type: "string", description: "The topic to generate a concept map for" } },
 async (params) => {
 const topic = (params.topic as string) || "";
 if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
 const artifact = await mapTopicArtifact(getCwd(), topic);
 const outputs = [relative(getCwd(), artifact.mmdPath)];
 if (artifact.svgPath) outputs.push(relative(getCwd(), artifact.svgPath));
 return {
 content: [{ type: "text", text: `[artifact://map]\nGenerated ${outputs.join(" and ")}` }],
 details: artifact
 };
 }
 ),
 keatingToolMaker(
 "animate",
 "animate",
 "Generate an animation storyboard for a topic. Use to create visual teaching materials.",
 { topic: { type: "string", description: "The topic to generate an animation storyboard for" } },
 async (params) => {
 const topic = (params.topic as string) || "";
 if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
 const artifact = await animateTopicArtifact(getCwd(), topic);
 return {
 content: [{ type: "text", text: `[artifact://animation]\nGenerated storyboard and player` }],
 details: artifact
 };
 }
 ),
 keatingToolMaker(
 "verify",
 "verify",
 "Generate a fact-checking checklist for a topic. Always use this BEFORE teaching to self-verify your knowledge.",
 { topic: { type: "string", description: "The topic to generate a verification checklist for" } },
 async (params) => {
 const topic = (params.topic as string) || "";
 if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
 const artifact = await verifyTopicArtifact(getCwd(), topic);
 return {
 content: [{ type: "text", text: `[artifact://verification]\n${artifact.alreadyVerified ? "Already verified" : "Generated checklist"}: ${relative(getCwd(), artifact.checklistPath)}` }],
 details: artifact
 };
 }
 ),
 keatingToolMaker(
 "quiz",
 "quiz",
 "Generate retrieval practice questions for a topic. Creates recall, comprehension, application, and transfer questions with answer keys.",
 { topic: { type: "string", description: "The topic to generate quiz questions for" } },
 async (params) => {
 const topic = (params.topic as string) || "";
 if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
 const quiz = generateQuiz(topic);
 const md = quizToMarkdown(quiz);
 const answers = quizAnswerKeyToMarkdown(quiz);
 const text = `${md}\n---\n${answers}`;
 return {
 content: [{ type: "text", text }],
 details: { quiz, topic }
 };
 }
 ),

 // ── Self-Evaluation ──
 keatingToolMaker(
 "bench",
 "bench",
 "Run a learner-feedback benchmark against the current teaching policy. Uses explicit feedback and inferred learner-turn signals.",
 { topic: { type: "string", description: "Optional topic to focus the benchmark on" } },
 async (params) => {
 const topic = (params.topic as string) || undefined;
 const artifact = await benchPolicyArtifact(getCwd(), topic);
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
 "Load the learner's profile, session history, and topic progress. ALWAYS call this at the start of every new conversation.",
 {},
 async () => {
 const statePath = learnerStatePath(getCwd());
 const state = await loadLearnerState(statePath);
 recordSessionStart(state);
 await saveLearnerState(statePath, state);
 const upCount = state.feedback.filter((f: any) => f.signal === up).length;
 const downCount = state.feedback.filter((f: any) => f.signal === down).length;
 const confusedCount = state.feedback.filter((f: any) => f.signal === confused).length;
 const topicList = state.coveredTopics.slice(-10).map((t: any) => ` - ${t.slug} (${t.domain})`).join("\n") || "None yet";
 const feedbackTopics = feedbackOnlyTopics(state);
 const feedbackTopicList = feedbackTopics.length > 0
 ? `\nFeedback-only topics: ${feedbackTopics.length}\n${feedbackTopics.map((topic) => ` - ${topic}`).join("\n")}`
 : "";
 const text = `Learner Profile:\nSessions: ${state.sessions?.length ?? 0}\nTopics explored: ${state.coveredTopics.length}\n${topicList}${feedbackTopicList}\nFeedback: 👍${upCount} 👎${downCount} 🤔${confusedCount}\nMisconceptions identified: ${state.identifiedMisconceptions.length}`;
 return { content: [{ type: "text", text }] };
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

 // ── Self-Evolution ──
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

 // ── Feedback ──
 keatingToolMaker(
 "feedback",
 "feedback",
 "Record a learner feedback signal for a topic. Call this after teaching to track session outcomes. signal must be 'up', 'down', or 'confused'.",
 {
 signal: { type: "string", enum: ["up", "down", "confused"], description: "Feedback signal: up, down, or confused" },
 topic: { type: "string", description: "The topic the feedback is about (defaults to 'general')" }
 },
 async (params) => {
 const signalMap: Record<string, typeof up | typeof down | typeof confused> = { up, down, confused };
 const s = signalMap[pick(params.signal as string)];
 if (!s) return { content: [{ type: "text", text: "signal must be 'up', 'down', or 'confused'." }] };
 const topic = (params.topic as string) || "general";
 const statePath = learnerStatePath(getCwd());
 const state = await loadLearnerState(statePath);
 recordFeedback(state, topic, s);
 await saveLearnerState(statePath, state);
 return {
 content: [{ type: "text", text: `Recorded ${s} feedback for "${topic}".` }],
 details: { signal: s, topic }
 };
 }
 ),
 keatingToolMaker(
 "ask_user_question",
 "ask_user_question",
 "Ask the learner a direct question with optional multiple-choice, text, fill-in-the-blank, classification-table, or matching-worksheet answers. Use to check understanding, prompt reflection, or gather the learner's thinking before explaining a concept. The agent waits for the user's answer in the next message.",
 {
 question: { type: "string", description: "The question to ask the learner" },
 choices: { type: "array", items: { type: "string" }, description: "Optional list of answer choices. For classification questions, these are categories/slots; for matching questions, answer-bank entries." },
 items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
 type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type. Use 'classification' to assign each item to a category; use 'matching' for worksheet-style prompt-to-answer matching." },
 allow_text: { type: "boolean", description: "Whether to also allow free-text input (default: true if no choices, false if choices provided)" },
 require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
 unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
 correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order. Enables red/green feedback after submission." },
 item_label: { type: "string", description: "Column label for classification items." },
 choice_label: { type: "string", description: "Column label for classification choices or matching answer bank." },
 reason_label: { type: "string", description: "Column label for classification justifications." },
 hint: { type: "string", description: "Optional hint to display below the question" },
 },
 async (params) => {
 const question = (params.question as string) || "";
 if (!question) return { content: [{ type: "text", text: "Question text is required." }] };
 const choices = Array.isArray(params.choices) ? params.choices.filter((c: unknown) => typeof c === "string") as string[] : undefined;
 const items = Array.isArray(params.items) ? params.items.filter((item: unknown) => typeof item === "string") as string[] : undefined;
 const correctMatches = Array.isArray(params.correct_matches) ? params.correct_matches.filter((item: unknown) => typeof item === "string") as string[] : undefined;
 const type = typeof params.type === "string" ? params.type : undefined;
 if ((type === "classification" || type === "matching") && (!items || items.length === 0 || !choices || choices.length === 0)) {
 return { content: [{ type: "text", text: "Classification and matching questions require both items and choices." }] };
 }
 const allowText = type === "classification" || type === "matching" ? false : typeof params.allow_text === "boolean" ? params.allow_text : !choices || choices.length === 0;
 const hint = (params.hint as string) || undefined;
 const payload = JSON.stringify({
 question,
 type,
 choices,
 items,
 allow_text: allowText,
 require_reasons: typeof params.require_reasons === "boolean" ? params.require_reasons : undefined,
 unique_matches: typeof params.unique_matches === "boolean" ? params.unique_matches : undefined,
 correct_matches: correctMatches && correctMatches.length > 0 ? correctMatches : undefined,
 item_label: typeof params.item_label === "string" ? params.item_label : undefined,
 choice_label: typeof params.choice_label === "string" ? params.choice_label : undefined,
 reason_label: typeof params.reason_label === "string" ? params.reason_label : undefined,
 hint
 });
 return {
 content: [{ type: "text", text: `[question] Asking learner: ${question}${choices ? ` (choices: ${choices.join(", ")})` : ""}\n<keating-question json=${JSON.stringify(payload)} />` }],
 details: { question, choices, allow_text: allowText, hint }
 };
 }
 ),
 ];

 for (const tool of tools) {
 pi.registerTool(tool as any);
 }

 if (typeof pi === "object" && pi !== null) {
 keatingToolRegistrations.add(pi);
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
 description: "Run the learner-feedback benchmark suite against the current teaching policy.",
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

 pi.registerCommand("prompt-eval", {
 description: "Evaluate a prompt template for teaching effectiveness in a single pass.",
 handler: async (args: string[], ctx: any) => {
 const promptContent = topicFromArgs(args);
 if (!promptContent) {
 info(ctx, "Usage: /prompt-eval <prompt text>");
 return;
 }
 const result = await promptEvalArtifact(ctx.cwd, promptContent);
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
 const result = await autoImproveArtifact(ctx.cwd, topic);
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
 activeCtx = ctx;
 registerKeatingTools(pi);
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
