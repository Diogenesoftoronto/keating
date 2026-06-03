/**
 * Browser-compatible Keating tools/commands
 * Uses real implementations from core.ts
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingAgentRuntimeConfig } from "./agent-runtime";
import { KeatingStorage, DEFAULT_BROWSER_POLICY } from "./storage";
import { createSpeechTool, type WebSpeechSettings } from "./speech";
import { loadKeatingUiSettings } from "./ui-settings";
import { getProviderApiKey } from "../lib/provider-models";
import { proxiedProviderRequestUrl } from "../lib/provider-proxy";
import {
	buildGoal,
	advanceGoalStep,
	computeGoalProgress,
	type GoalStepInput,
	type GoalStepStatus,
} from "./goals";
import { extractBrowserOutcomes, type BrowserLearnerOutcome } from "./core";
import { DEFAULT_TEACHER_PERSONA } from "./persona";
import {
	buildLessonPlan,
	lessonPlanToMarkdown,
	buildConceptMap,
	runBenchmarkSuite,
	benchmarkToMarkdown,
	evolvePolicy,
	evolvePolicy as _evolvePolicyLegacy,
	evolutionToMarkdown,
	mapElitesEvolve,
	mapElitesToMarkdown,
	mapElitesToEvolutionRun,
	DEFAULT_POLICY,
	DEFAULT_WEIGHTS,
	clampPolicy,
	diagnoseBenchmark,
	evaluatePrompt,
	evolvePromptTemplate,
	promptEvolutionToMarkdown,
	generateImprovementProposal,
	proposalToMarkdown,
	improvementArchiveToMarkdown,
	resolveTopic,
	buildEngagementTimeline,
	getDueTopics,
	engagementTimelineToMarkdown,
	dueTopicsToMarkdown,
	DEFAULT_ENGAGEMENT_POLICY,
	generateQuiz,
	quizToMarkdown,
	quizAnswerKeyToMarkdown,
	type TeacherPolicy,
	type BenchmarkResult,
	type EvolutionRun,
	type CoveredTopic,
	type ImprovementProposal,
	type ImprovementArchive,
} from "./core";
import type { Policy } from "./storage";

/**
 * Fixed operational protocol — the HOW of the system prompt (tools, bootstrap,
 * self-improvement). This is never user-editable; the editable persona (the WHO)
 * lives in persona.ts and is composed with this via composeKeatingSystemPrompt.
 */
export const KEATING_OPERATIONAL_PROTOCOL = `## Self-Evolution Protocol

You are an autonomous agent with direct access to tools. You MUST follow these protocols:

### Session Bootstrap
On every new conversation, you MUST:
1. Call \`agent_runtime\` to inspect whether execution is browser-only, remote, or Keating Cloud-backed
2. Call \`learner_state\` to load the learner's profile and history
3. If the learner has covered topics, call \`timeline\` to check retention decay and review urgency
4. If any topics are due for review, proactively mention them to the learner before they ask
5. Call \`list_learner_goals\` to resume any long-horizon goals; surface the next step so work continues across sessions

### Teaching Loop
When a learner asks about a topic:
1. Call \`plan\` to generate a structured lesson plan adapted to the current policy
2. Call \`verify\` to self-check your knowledge before teaching
3. Teach using the Socratic method, guided by the plan
4. After teaching, call \`feedback\` to record the session outcome (up/down/confused based on the learner's demonstrated understanding)
5. Call \`map\` or \`animate\` yourself when visual aids would help.

**Important**: Run ALL tool calls yourself. NEVER ask the learner to run commands for you. Execute all prerequisites autonomously.

### Self-Improvement Triggers
You MUST autonomously run self-improvement when:
- This is the first session (no benchmarks exist) — call \`auto_improve\` to baseline your teaching policy
- The learner expresses confusion or gives rote responses — call \`auto_improve\` after the session
- 3+ sessions have occurred since the last evolution — call \`auto_improve\`
- The learner explicitly asks you to improve (honor the request via \`auto_improve\`)

### When NOT to self-improve
- Do not interrupt an active teaching moment. Finish helping the learner first, then improve in the background.
- Do not run \`auto_improve\` more than once per conversation unless the learner requests it.

## Tools

You have internal tools for teaching, self-evaluation, and self-evolution. Use them autonomously — the learner does not need to know about them. You are a self-governing agent; execute all steps yourself.

### Teaching (use when helping a learner with a topic)
- \`plan\` — Generate a structured lesson plan for a topic. Run this yourself when structure is needed.
- \`map\` — Create a visual Mermaid concept map for a topic. Run this yourself when visualization helps.
- \`animate\` — Generate an animation storyboard for a topic. Run this yourself when visuals help.
- \`generate_image\` — Create a real image-model picture or browser-local SVG diagram/infographic. Run this yourself when a static visual aid would help; prefer kind="anatomy" for labeled structures and kind="comparison" for size/category comparisons.
- \`verify\` — Self-check knowledge before teaching a topic. Always run this yourself before teaching factual claims.
- \`quiz\` — Generate retrieval practice questions for a topic. Run this yourself to create assessment material.
- \`feedback\` — Record learner feedback (up/down/confused) for a topic. Run this yourself after sessions.
- \`ask_user_question\` — Ask the learner one or more questions as an interactive form (choices, multi-select, free text). Their answers come back automatically. Use it to diagnose, gather goals/preferences, or branch the lesson — prefer it over plain-text questions when you need a concrete answer.

### Goals & long-horizon curriculum (use to build toward what the learner wants to accomplish)
- \`set_learner_goal\` — When a learner wants to accomplish a task or project (not just "learn topic X"), capture it as a goal and design an ordered, multi-step curriculum that scaffolds toward it. Steps persist and are tracked across sessions.
- \`list_learner_goals\` — Resume saved goals and see progress + the next step. Run at session start.
- \`update_goal_step\` — Mark a step not_started/in_progress/done as the learner advances, so the path stays current. (The learner can also tap steps in the rendered goal card.)

### Self-Evaluation (use to measure and track your effectiveness)
- \`bench\` — Run a synthetic learner benchmark against current policy. Run this yourself when measuring effectiveness.
- \`timeline\` — Show engagement timeline with retention decay. Run this yourself at session start.
- \`due\` — Show topics due for spaced-repetition review. Run this yourself at session start.
- \`learner_state\` — Load the learner's profile and session history. Always run this yourself first.
- \`trace\` — Browse benchmark and evolution history
- \`policy\` — Show the current teaching policy
- \`outputs\` — Browse all saved artifacts
- \`agent_runtime\` — Inspect whether agent execution is browser-only, local+remote, or Keating Cloud-backed
- \`remote_execute\` — Hand off remote-only work to the configured microVM/cloud runtime when browser execution cannot do it

### Self-Evolution (use to autonomously improve your teaching)
- \`auto_improve\` — Run the full self-improvement loop: benchmark → evolve policy → evolve prompts → record results. Use this yourself instead of asking the learner to trigger it.
- \`improve\` — Generate a targeted improvement proposal for specific weaknesses. Run this yourself when weaknesses are detected.
- \`evolve\` — Evolve the teaching policy via MAP-Elites. Run this yourself when improvement is needed.
- \`prompt_evolve\` — Iteratively evolve a teaching prompt template via PROSPER-style selection
- \`prompt_eval\` — Single-pass evaluation of a prompt template
`;

const SPEECH_SYSTEM_PROMPT = `
### Optional Speech
- \`keating_voice\` is available only when the learner enables speech in the web UI.
- Use \`keating_voice\` for short learner-facing utterances: one question, one recap, one redirect, or one encouragement.
- Keep deeper reasoning, verification, and tool work in the normal text/tool loop. The voice layer is for conversational delivery, not for independent answers.
`;

/** Compose a full base system prompt from an editable persona + fixed protocol. */
export function composeKeatingSystemPrompt(persona: string = DEFAULT_TEACHER_PERSONA): string {
	const trimmed = persona.trim();
	const front = trimmed.length > 0 ? trimmed : DEFAULT_TEACHER_PERSONA;
	return `${front}\n\n${KEATING_OPERATIONAL_PROTOCOL}`;
}

/** The default base prompt: John Keating persona + operational protocol. */
export const KEATING_SYSTEM_PROMPT = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);

export function buildKeatingSystemPrompt(speechEnabled = false, basePrompt = KEATING_SYSTEM_PROMPT): string {
	return speechEnabled ? `${basePrompt}${SPEECH_SYSTEM_PROMPT}` : basePrompt;
}

export async function getActiveKeatingPrompt(storage: KeatingStorage, promptName = "learn"): Promise<string> {
	const evolutions = await storage.getPromptEvolutions(promptName);
	const latest = evolutions.sort((left, right) => right.createdAt - left.createdAt)[0];
	return latest?.bestPrompt || KEATING_SYSTEM_PROMPT;
}

const POLICY_FIELDS: Array<keyof Omit<TeacherPolicy, "name">> = [
	"analogyDensity",
	"socraticRatio",
	"formalism",
	"retrievalPractice",
	"exerciseCount",
	"diagramBias",
	"reflectionBias",
	"interdisciplinaryBias",
	"challengeRate",
];

function parsePolicyFromStorage(policy: Policy | null): TeacherPolicy {
	if (!policy) return DEFAULT_POLICY;

	const parsed = parsePolicyContent(policy.content);
	return clampPolicy({
		...DEFAULT_POLICY,
		...parsed,
		name: policy.id,
	});
}

function parsePolicyContent(content: string): Partial<TeacherPolicy> {
	const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? content;
	try {
		const parsed = JSON.parse(jsonBlock) as Partial<TeacherPolicy>;
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		const parsed: Partial<Record<keyof Omit<TeacherPolicy, "name">, number>> = {};
		for (const field of POLICY_FIELDS) {
			const match = content.match(new RegExp(`${field}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
			if (match) {
				parsed[field] = Number(match[1]);
			}
		}
		return parsed;
	}
}

function policyToMarkdown(policy: TeacherPolicy, score: number): string {
	return [
		"# Evolved Teaching Policy",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Score: ${score.toFixed(2)}/100`,
		"",
		"## Parameters",
		...POLICY_FIELDS.map((field) => `- ${field}: ${policy[field].toFixed(field === "exerciseCount" ? 0 : 3)}`),
		"",
		"```json",
		JSON.stringify(policy, null, 2),
		"```",
	].join("\n");
}

// Helper function to create tools with proper schema
function createTool(
	name: string,
	description: string,
	parameters: Record<string, unknown>,
	execute: (params: Record<string, unknown>) => Promise<string>
): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: {
			type: "object",
			properties: parameters,
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: Record<string, unknown>) => {
			const result = await execute(params as Record<string, unknown>);
			return {
				content: [{ type: "text", text: result }],
				details: { tool: name },
			};
		},
	} as unknown as AgentTool;
}

type ResolvedTopic = ReturnType<typeof resolveTopic>;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function buildManimScene(resolved: ResolvedTopic): string {
	return `// Scene: ${resolved.title}
// Manim-web compatible scene definition

class ${resolved.slug.replace(/-/g, "_").replace(/^(.)/, (c) => c.toUpperCase())}Scene extends Scene {
  construct() {
    // Scene 1: Introduction
    this.play(FadeIn(title("${resolved.title}")));
    
    // Scene 2: Intuition
    this.play(Create(intuitionDiagram));
    
    // Scene 3: Formal
    this.play(Write(formalDefinition));
    
    // Scene 4: Misconceptions
    this.play(Indicate(commonMistake), Transform(commonMistake, correctVersion));
    
    // Scene 5: Examples
    this.play(Create(exampleVisual));
    
    // Scene 6: Transfer
    this.play(FadeOut(title("${resolved.title}")));
  }
}`;
}

function buildHyperframesComposition(resolved: ResolvedTopic): string {
	const compositionId = `${resolved.slug}-lesson`;
	const clips = [
		{ start: 0, duration: 2, label: "Intro", title: resolved.title, body: resolved.summary },
		{ start: 2, duration: 6, label: "Intuition", title: "Start concrete", body: resolved.intuition[0] ?? "Animate the core idea before naming it." },
		{ start: 8, duration: 7, label: "Formal", title: "Name the structure", body: resolved.formalCore[0] ?? "Reveal the definition one relationship at a time." },
		{ start: 15, duration: 5, label: "Repair", title: "Fix the trap", body: resolved.misconceptions[0] ?? "Contrast a common mistake with the corrected model." },
		{ start: 20, duration: 8, label: "Example", title: "Work it through", body: resolved.examples[0] ?? "Step through a representative example." },
		{ start: 28, duration: 7, label: "Transfer", title: "Carry it elsewhere", body: `Bridge to ${resolved.interdisciplinaryHooks.slice(0, 2).join(", ") || "a neighboring domain"}.` },
	];
	const encodedClips = JSON.stringify(clips.map((clip) => ({ selector: `#clip-${clip.start}`, start: clip.start })));

	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0a0a0a; color: #f4f1e8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: linear-gradient(135deg, #0b0b0b 0%, #161616 55%, #211706 100%); }
    .clip { position: absolute; inset: 96px; display: grid; align-content: center; gap: 28px; opacity: 0; }
    .label { color: #f59e0b; font-size: 34px; letter-spacing: .16em; text-transform: uppercase; }
    h1, h2 { margin: 0; max-width: 1380px; font-size: 112px; line-height: 1; letter-spacing: 0; }
    p { margin: 0; max-width: 1220px; color: #d6d3ca; font-size: 48px; line-height: 1.24; }
    .rule { width: 420px; height: 8px; background: #f59e0b; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-width="1920" data-height="1080">
${clips.map((clip, index) => `    <section id="clip-${clip.start}" class="clip" data-start="${clip.start}" data-duration="${clip.duration}" data-track-index="${index}">
      <div class="label">${escapeHtml(clip.label)}</div>
      <${index === 0 ? "h1" : "h2"}>${escapeHtml(clip.title)}</${index === 0 ? "h1" : "h2"}>
      <div class="rule"></div>
      <p>${escapeHtml(clip.body)}</p>
    </section>`).join("\n")}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    const clips = ${encodedClips};
    for (const clip of clips) {
      tl.to(clip.selector, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, clip.start);
      tl.to(clip.selector, { opacity: 0, y: -28, duration: 0.35, ease: "power2.in" }, clip.start + 1.65);
    }
    window.__timelines = window.__timelines || {};
    window.__timelines[${JSON.stringify(compositionId)}] = tl;
    tl.play(0);
  </script>
</body>
</html>`;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
	if (!Array.isArray(value)) return fallback;
	return value
		.map((entry) => String(entry ?? "").trim())
		.filter(Boolean)
		.slice(0, 6);
}

function wrapSvgText(text: string, maxChars: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length > maxChars && line) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines.slice(0, 3);
}

function svgTextLines(lines: string[], x: number, y: number, options: { size?: number; fill?: string; weight?: number; anchor?: "start" | "middle" } = {}): string {
	const size = options.size ?? 28;
	const fill = options.fill ?? "#171717";
	const weight = options.weight ?? 500;
	const anchor = options.anchor ?? "start";
	return lines
		.map((line, index) => `<text x="${x}" y="${y + index * size * 1.25}" text-anchor="${anchor}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(line)}</text>`)
		.join("\n");
}

function buildInfographicSvg(params: {
	title: string;
	subtitle: string;
	points: string[];
	labels: string[];
	style: string;
}): string {
	const points = params.points.length > 0 ? params.points : ["Core idea", "Key relationship", "Learner takeaway"];
	const labels = params.labels.length > 0 ? params.labels : points.map((_, index) => `Step ${index + 1}`);
	const palette = params.style === "dark"
		? { bg: "#101214", panel: "#181c20", ink: "#f6f1e7", muted: "#c9c1b3", accent: "#f59e0b", line: "#3f4650" }
		: { bg: "#f8f7f2", panel: "#ffffff", ink: "#171717", muted: "#525252", accent: "#0f766e", line: "#d8d3c7" };
	const cardWidth = 336;
	const startX = 72;
	const startY = 282;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-label="${escapeHtml(params.title)}">
  <rect width="1200" height="760" fill="${palette.bg}"/>
  <rect x="40" y="40" width="1120" height="680" rx="18" fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"/>
  <text x="72" y="116" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="54" font-weight="760" fill="${palette.ink}">${escapeHtml(params.title)}</text>
  ${svgTextLines(wrapSvgText(params.subtitle, 82), 74, 166, { size: 24, fill: palette.muted, weight: 450 })}
  <line x1="72" y1="238" x2="1128" y2="238" stroke="${palette.line}" stroke-width="2"/>
  ${points.slice(0, 3).map((point, index) => {
		const x = startX + index * (cardWidth + 24);
		const label = labels[index] ?? `Part ${index + 1}`;
		const lineX1 = index === 0 ? "" : `<line x1="${x - 24}" y1="${startY + 82}" x2="${x}" y2="${startY + 82}" stroke="${palette.accent}" stroke-width="4" stroke-linecap="round"/>`;
		return `${lineX1}
  <rect x="${x}" y="${startY}" width="${cardWidth}" height="300" rx="16" fill="${palette.bg}" stroke="${palette.line}" stroke-width="2"/>
  <circle cx="${x + 38}" cy="${startY + 46}" r="18" fill="${palette.accent}"/>
  <text x="${x + 38}" y="${startY + 54}" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="800" fill="${params.style === "dark" ? "#111827" : "#ffffff"}">${index + 1}</text>
  <text x="${x + 74}" y="${startY + 54}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="23" font-weight="720" fill="${palette.ink}">${escapeHtml(label)}</text>
  ${svgTextLines(wrapSvgText(point, 32), x + 28, startY + 116, { size: 24, fill: palette.ink, weight: 500 })}
  <rect x="${x + 28}" y="${startY + 246}" width="${cardWidth - 56}" height="8" rx="4" fill="${palette.line}"/>
  <rect x="${x + 28}" y="${startY + 246}" width="${Math.round((cardWidth - 56) * ((index + 1) / Math.min(3, points.length)))}" height="8" rx="4" fill="${palette.accent}"/>`;
	}).join("\n")}
  <text x="72" y="660" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="18" fill="${palette.muted}">Generated by Keating as a browser-local SVG learning image. Copy the SVG to reuse or edit.</text>
</svg>`;
}

function buildAnatomySvg(params: {
	title: string;
	subtitle: string;
	points: string[];
	labels: string[];
	style: string;
}): string {
	const palette = params.style === "dark"
		? { bg: "#101214", panel: "#181c20", ink: "#f6f1e7", muted: "#c9c1b3", accent: "#f59e0b", fab: "#38bdf8", fc: "#34d399", line: "#3f4650" }
		: { bg: "#f8f7f2", panel: "#ffffff", ink: "#171717", muted: "#525252", accent: "#0f766e", fab: "#0284c7", fc: "#059669", line: "#d8d3c7" };
	const labels = params.labels.length > 0 ? params.labels : ["Fab arms", "Antigen-binding tips", "Fc stem", "Hinge", "Size variants"];
	const points = params.points.length > 0 ? params.points : [
		"Fab arms form the Y tips that grab antigen.",
		"The Fc stem is the immune-system flag.",
		"Smaller fragments keep the binding idea but remove bulk.",
	];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-label="${escapeHtml(params.title)}">
  <rect width="1200" height="760" fill="${palette.bg}"/>
  <rect x="40" y="40" width="1120" height="680" rx="18" fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"/>
  <text x="72" y="112" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="50" font-weight="760" fill="${palette.ink}">${escapeHtml(params.title)}</text>
  ${svgTextLines(wrapSvgText(params.subtitle, 82), 74, 160, { size: 23, fill: palette.muted, weight: 450 })}

  <g transform="translate(130 210)">
    <path d="M330 390 L430 220 L510 86" fill="none" stroke="${palette.fc}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M430 220 L288 82" fill="none" stroke="${palette.fab}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M430 220 L572 82" fill="none" stroke="${palette.fab}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="288" cy="82" r="38" fill="${palette.accent}"/>
    <circle cx="572" cy="82" r="38" fill="${palette.accent}"/>
    <circle cx="430" cy="220" r="30" fill="${palette.panel}" stroke="${palette.line}" stroke-width="6"/>
    <path d="M290 74 C236 38 178 58 158 104 C210 122 248 120 298 98" fill="none" stroke="${palette.accent}" stroke-width="12" stroke-linecap="round"/>
    <path d="M570 74 C624 38 682 58 702 104 C650 122 612 120 562 98" fill="none" stroke="${palette.accent}" stroke-width="12" stroke-linecap="round"/>
    <text x="430" y="470" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="26" font-weight="760" fill="${palette.ink}">IgG Y-shape</text>
    <text x="430" y="505" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="21" fill="${palette.muted}">~150 kDa full antibody</text>

    <line x1="288" y1="82" x2="120" y2="34" stroke="${palette.line}" stroke-width="2"/>
    <line x1="572" y1="82" x2="760" y2="34" stroke="${palette.line}" stroke-width="2"/>
    <line x1="430" y1="220" x2="760" y2="240" stroke="${palette.line}" stroke-width="2"/>
    <line x1="330" y1="390" x2="116" y2="430" stroke="${palette.line}" stroke-width="2"/>
  </g>

  <g>
    <rect x="74" y="226" width="250" height="82" rx="12" fill="${palette.bg}" stroke="${palette.line}"/>
    <text x="96" y="260" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="21" font-weight="720" fill="${palette.ink}">${escapeHtml(labels[0] ?? "Fab arms")}</text>
    ${svgTextLines(wrapSvgText(points[0] ?? "The Y arms carry binding specificity.", 28), 96, 292, { size: 16, fill: palette.muted, weight: 450 })}

    <rect x="828" y="226" width="290" height="82" rx="12" fill="${palette.bg}" stroke="${palette.line}"/>
    <text x="850" y="260" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="21" font-weight="720" fill="${palette.ink}">${escapeHtml(labels[1] ?? "Binding tips")}</text>
    ${svgTextLines(wrapSvgText(points[1] ?? "Tips recognize antigen by shape complementarity.", 32), 850, 292, { size: 16, fill: palette.muted, weight: 450 })}

    <rect x="828" y="428" width="290" height="82" rx="12" fill="${palette.bg}" stroke="${palette.line}"/>
    <text x="850" y="462" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="21" font-weight="720" fill="${palette.ink}">${escapeHtml(labels[2] ?? "Fc stem")}</text>
    ${svgTextLines(wrapSvgText(points[2] ?? "The stem recruits immune machinery.", 32), 850, 494, { size: 16, fill: palette.muted, weight: 450 })}

    <rect x="74" y="600" width="1044" height="58" rx="12" fill="${palette.bg}" stroke="${palette.line}"/>
    <text x="96" y="636" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="20" font-weight="650" fill="${palette.ink}">Variant scale: IgG ~150 kDa -> scFv ~25 kDa -> nanobody ~15 kDa -> minibinder ~5-20 kDa</text>
  </g>
</svg>`;
}

function buildComparisonSvg(params: {
	title: string;
	subtitle: string;
	points: string[];
	labels: string[];
	style: string;
}): string {
	const palette = params.style === "dark"
		? { bg: "#101214", panel: "#181c20", ink: "#f6f1e7", muted: "#c9c1b3", accent: "#f59e0b", line: "#3f4650" }
		: { bg: "#f8f7f2", panel: "#ffffff", ink: "#171717", muted: "#525252", accent: "#0f766e", line: "#d8d3c7" };
	const labels = params.labels.length > 0 ? params.labels : ["IgG", "scFv", "Nanobody", "Minibinder"];
	const points = params.points.length > 0 ? params.points : ["150 kDa full Y", "25 kDa binding fragment", "15 kDa single-domain binder", "5-20 kDa designed binder"];
	const max = Math.max(...points.map((point) => Number(point.match(/\d+/)?.[0] ?? 20)), 20);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-label="${escapeHtml(params.title)}">
  <rect width="1200" height="760" fill="${palette.bg}"/>
  <rect x="40" y="40" width="1120" height="680" rx="18" fill="${palette.panel}" stroke="${palette.line}" stroke-width="2"/>
  <text x="72" y="112" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="50" font-weight="760" fill="${palette.ink}">${escapeHtml(params.title)}</text>
  ${svgTextLines(wrapSvgText(params.subtitle, 84), 74, 160, { size: 23, fill: palette.muted, weight: 450 })}
  <g transform="translate(110 250)">
    ${labels.slice(0, 6).map((label, index) => {
		const y = index * 72;
		const point = points[index] ?? "";
		const value = Number(point.match(/\d+/)?.[0] ?? 20);
		const width = Math.max(80, Math.round((value / max) * 690));
		return `<text x="0" y="${y + 28}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="720" fill="${palette.ink}">${escapeHtml(label)}</text>
    <rect x="180" y="${y}" width="760" height="42" rx="10" fill="${palette.bg}" stroke="${palette.line}"/>
    <rect x="180" y="${y}" width="${width}" height="42" rx="10" fill="${palette.accent}" opacity="${0.9 - index * 0.08}"/>
    <text x="${Math.min(900, 198 + width)}" y="${y + 28}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="640" fill="${palette.ink}">${escapeHtml(point)}</text>`;
	}).join("\n")}
  </g>
  <text x="110" y="690" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="20" fill="${palette.muted}">Read left to right: shorter bars mean smaller proteins, often easier for tissue penetration or inhaled delivery.</text>
</svg>`;
}

function buildLocalImageSvg(params: {
	title: string;
	subtitle: string;
	points: string[];
	labels: string[];
	style: string;
	kind: string;
}): string {
	if (params.kind === "anatomy") return buildAnatomySvg(params);
	if (params.kind === "comparison") return buildComparisonSvg(params);
	return buildInfographicSvg(params);
}

async function generateOpenAiImage(params: {
	prompt: string;
	model: string;
	size: string;
	quality: string;
}): Promise<{ dataUrl: string; mimeType: string }> {
	const apiKey = await getProviderApiKey("openai");
	if (!apiKey) {
		throw new Error("No OpenAI API key configured. Add one in Settings -> Providers & Models -> OpenAI.");
	}

	const proxied = proxiedProviderRequestUrl("https://api.openai.com/v1/images/generations");
	const response = await fetch(proxied.url, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"x-target-url": proxied.targetBaseUrl,
		},
		body: JSON.stringify({
			model: params.model,
			prompt: params.prompt,
			size: params.size,
			quality: params.quality,
			n: 1,
		}),
	});

	const payload = await response.json().catch(async () => ({ error: { message: await response.text().catch(() => response.statusText) } }));
	if (!response.ok) {
		const message = payload?.error?.message ?? response.statusText;
		throw new Error(`OpenAI image generation failed (${response.status}): ${String(message).slice(0, 500)}`);
	}

	const b64 = payload?.data?.[0]?.b64_json;
	if (!b64 || typeof b64 !== "string") {
		throw new Error("OpenAI image generation returned no base64 image data.");
	}

	return { dataUrl: `data:image/png;base64,${b64}`, mimeType: "image/png" };
}

function unavailableRemoteRuntimeMessage(runtime: KeatingAgentRuntimeConfig | undefined): string {
	if (!runtime || runtime.mode === "browser-only" || !runtime.executionEndpoint) {
		return [
			"# Remote Execution Unavailable",
			"",
			"Keating is running in browser-only mode. Run supported work in the browser and surface this fallback for operations that require native binaries, durable background compute, secure server-side secrets, public inbound networking, Docker/microVM isolation, or unrestricted host filesystem access.",
		].join("\n");
	}

	return "";
}

function stringifyRemoteResult(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	if (text.length <= 12000) return text;
	return `${text.slice(0, 12000)}\n\n[remote output truncated]`;
}

export interface KeatingToolsOptions {
	agentRuntime?: KeatingAgentRuntimeConfig;
	speech?: {
		settings: WebSpeechSettings;
		getApiKey: (provider: string) => Promise<string | undefined>;
	};
	setSystemPrompt?: (basePrompt: string) => void;
}

export async function createKeatingTools(
	storage: KeatingStorage,
	options: KeatingToolsOptions = {}
): Promise<AgentTool[]> {
	const tools: AgentTool[] = [
		// agent_runtime - Inspect current agent execution mode and fallback policy
		createTool(
			"agent_runtime",
			"Inspect current agent execution mode, available sandbox capabilities, and fallback policy. Use before attempting source execution, native tooling, secret-backed work, or remote-only operations.",
			{},
			async () => {
				const runtime = options.agentRuntime;
				if (!runtime) {
					return "Agent runtime config is unavailable. Assume browser-only local execution and surface clear fallback errors for remote-only work.";
				}

				const capabilities = Object.entries(runtime.capabilities)
					.map(([key, value]) => `- ${key}: ${String(value)}`)
					.join("\n");
				const remote = runtime.remote
					? [
						"",
						"## Remote Sandbox",
						`- provider: ${runtime.remote.provider}`,
						`- endpoint: ${runtime.remote.endpoint ?? "local server default"}`,
						`- region: ${runtime.remote.region ?? "default"}`,
						`- snapshot: ${runtime.remote.snapshot ?? "default"}`,
						`- cpu: ${runtime.remote.cpu ?? "default"}`,
						`- memory: ${runtime.remote.memory ?? "default"}`,
						`- disk: ${runtime.remote.disk ?? "default"}`,
					].join("\n")
					: "";

				return [
					`# Agent Runtime`,
					"",
					`- mode: ${runtime.mode}`,
					`- label: ${runtime.label}`,
					`- execution endpoint: ${runtime.executionEndpoint ?? "none"}`,
					`- cloud endpoint: ${runtime.cloudEndpoint ?? "none"}`,
					"",
					"## Capabilities",
					capabilities,
					remote,
					"",
					"## Fallback Policy",
					`- local first: ${runtime.fallback.localFirst}`,
					`- remote available: ${runtime.fallback.remoteAvailable}`,
					`- message: ${runtime.fallback.message}`,
				].join("\n");
			}
		),

		// remote_execute - Send remote-only work to the configured microVM/cloud runtime
		createTool(
			"remote_execute",
			"Execute remote-only agent work through the configured microVM or Keating Cloud backend. Use only when browser-local tools cannot satisfy the request.",
			{
				operation: {
					type: "string",
					description: "Remote operation name, such as shell.exec, fs.read, fs.write, snapshot.create, or sandbox.provision",
				},
				payload: {
					type: "object",
					description: "Operation-specific JSON payload. For shell.exec, use { command, args, cwd, env, timeoutMs }.",
					additionalProperties: true,
				},
			},
			async (params) => {
				const runtime = options.agentRuntime;
				if (!runtime || runtime.mode === "browser-only" || !runtime.executionEndpoint) {
					return unavailableRemoteRuntimeMessage(runtime);
				}

				const operation = typeof params.operation === "string" ? params.operation.trim() : "";
				if (!operation) return "Operation required. Pass an operation parameter.";

				const response = await fetch(`${runtime.executionEndpoint}/execute`, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
					body: JSON.stringify({
						operation,
						payload: params.payload && typeof params.payload === "object" ? params.payload : {},
					}),
				});

				const contentType = response.headers.get("content-type") ?? "";
				const body = contentType.includes("application/json")
					? await response.json().catch(() => null)
					: await response.text();

				if (!response.ok) {
					return [
						"# Remote Execution Failed",
						"",
						`- status: ${response.status}`,
						`- mode: ${runtime.mode}`,
						`- endpoint: ${runtime.executionEndpoint}`,
						"",
						stringifyRemoteResult(body || response.statusText),
					].join("\n");
				}

				return [
					"# Remote Execution Result",
					"",
					`- mode: ${runtime.mode}`,
					`- operation: ${operation}`,
					"",
					stringifyRemoteResult(body),
				].join("\n");
			}
		),

		// plan - Generate lesson plan
		createTool(
			"plan",
			"Generate a structured lesson plan for a topic, adapted to the current teaching policy. Use before teaching any topic to structure your approach.",
			{
				topic: { type: "string", description: "The topic to generate a lesson plan for" }
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Topic required. Pass a topic parameter.";
				}

				const teacherPolicy = parsePolicyFromStorage(await storage.getActivePolicy());

				const plan = buildLessonPlan(topic, teacherPolicy);
				const markdown = lessonPlanToMarkdown(plan);

				const saved = await storage.saveLessonPlan(topic, markdown, {
					domain: plan.topic.domain,
					phaseCount: plan.phases.length,
				});

				return `[artifact://plan/${saved.id}]\n\n${markdown}`;
			}
		),

		// map - Generate concept map
		createTool(
			"map",
			"Generate a Mermaid concept map for a topic. Use to visualize knowledge structure before or during teaching.",
			{
				topic: { type: "string", description: "The topic to generate a concept map for" }
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const mapContent = buildConceptMap(topic);
				const saved = await storage.saveLessonMap(topic, mapContent);

				return `[artifact://map/${saved.id}]\n\n\`\`\`mermaid\n${mapContent}\n\`\`\``;
			}
		),

		// animate - Generate animation storyboard
		createTool(
			"animate",
			"Generate an animation storyboard for a topic. Use to create visual teaching materials.",
			{
				topic: { type: "string", description: "The topic to generate an animation storyboard for" }
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const resolved = resolveTopic(topic);
				const storyboard = `# Animation Storyboard: ${resolved.title}

## Scene 1: Introduction (0-2s)
- **Visual**: Title card with "${resolved.title}"
- **Transition**: Fade in
- **Audio**: Brief hook from summary

## Scene 2: Intuition Phase (2-8s)
- **Visual**: ${resolved.intuition[0] || "Animated diagram showing key concept"}
- **Duration**: 6s
- **Narration**: Concrete example before formal language

## Scene 3: Formal Structure (8-15s)
- **Visual**: ${resolved.formalCore[0] || "Step-by-step formal definition"}
- **Duration**: 7s
- **Highlight**: Key definitions and relationships

## Scene 4: Misconception Repair (15-20s)
- **Visual**: Common mistake vs correct understanding
- **Duration**: 5s
- **Overlay**: Warning indicators

## Scene 5: Examples (20-28s)
- **Visual**: ${resolved.examples[0] || "Worked example"}
- **Duration**: 8s
- **Step-through**: Incremental reveal

## Scene 6: Transfer (28-35s)
- **Visual**: Bridge to ${resolved.interdisciplinaryHooks.slice(0, 2).join(", ")}
- **Duration**: 7s
- **Transition**: Fade out with summary
`;

				const renderer = loadKeatingUiSettings().animationRenderer;
				const scene = renderer === "hyperframes" ? buildHyperframesComposition(resolved) : buildManimScene(resolved);

				const manifest = JSON.stringify(
					{
						topic: resolved.title,
						slug: resolved.slug,
						domain: resolved.domain,
						renderer,
						compositionId: renderer === "hyperframes" ? `${resolved.slug}-lesson` : undefined,
						width: renderer === "hyperframes" ? 1920 : undefined,
						height: renderer === "hyperframes" ? 1080 : undefined,
						scenes: ["intro", "intuition", "formal", "misconceptions", "examples", "transfer"],
						duration: 35,
						generatedAt: new Date().toISOString(),
					},
					null,
					2
				);

				const saved = await storage.saveAnimation(topic, storyboard, scene, manifest, renderer);

				return `[artifact://animation/${saved.id}]\n\n${storyboard}\n\n<keating-scene markdown=${JSON.stringify(JSON.stringify(storyboard))} />`;
			}
		),

		createTool(
			"generate_image",
			"Create a learning image. Supports real OpenAI image models for raster images and browser-local SVG diagrams for labeled anatomy/comparison/process visuals. Use kind='anatomy' for labeled structures like an antibody Y-shape, kind='comparison' for size/category charts, and mode='model' when the learner asks for an actual generated picture.",
			{
				title: { type: "string", description: "Short title for the learning image" },
				subtitle: { type: "string", description: "One-sentence explanation or framing caption" },
				prompt: { type: "string", description: "Detailed image-model prompt. Required for mode=model; should describe labels, diagram layout, style, and educational goal." },
				mode: { type: "string", description: "auto, model, or svg. auto tries the image model when an OpenAI key is configured, then falls back to SVG." },
				kind: { type: "string", description: "cards, anatomy, comparison, or process. Used for local SVG fallback and diagram layout." },
				imageModel: { type: "string", description: "OpenAI image model, such as gpt-image-1.5, gpt-image-1, or gpt-image-1-mini." },
				size: { type: "string", description: "Image size for model mode: 1024x1024, 1536x1024, or 1024x1536." },
				quality: { type: "string", description: "Image quality for model mode: low, medium, or high." },
				points: {
					type: "array",
					description: "Three to six concise teaching points to visualize",
					items: { type: "string" },
				},
				labels: {
					type: "array",
					description: "Optional labels for the visual blocks, such as stages or categories",
					items: { type: "string" },
				},
				style: {
					type: "string",
					description: "Visual style: light or dark",
				},
			},
			async (params) => {
				const title = String(params.title ?? "").trim() || "Learning visual";
				const subtitle = String(params.subtitle ?? "").trim() || "A compact visual summary for this concept.";
				const points = asStringArray(params.points, []);
				const labels = asStringArray(params.labels, []);
				const style = String(params.style ?? "light").toLowerCase() === "dark" ? "dark" : "light";
				const requestedMode = String(params.mode ?? "auto").toLowerCase();
				const mode = requestedMode === "model" || requestedMode === "svg" ? requestedMode : "auto";
				const kindRaw = String(params.kind ?? "cards").toLowerCase();
				const kind = ["anatomy", "comparison", "process", "cards"].includes(kindRaw) ? kindRaw : "cards";
				const imageModel = String(params.imageModel ?? "gpt-image-1.5").trim() || "gpt-image-1.5";
				const sizeRaw = String(params.size ?? "1024x1024");
				const size = ["1024x1024", "1536x1024", "1024x1536"].includes(sizeRaw) ? sizeRaw : "1024x1024";
				const qualityRaw = String(params.quality ?? "medium").toLowerCase();
				const quality = ["low", "medium", "high"].includes(qualityRaw) ? qualityRaw : "medium";
				const prompt = String(params.prompt ?? "").trim() || [
					`Create a clear educational ${kind === "cards" ? "infographic" : `${kind} diagram`} titled "${title}".`,
					subtitle,
					points.length > 0 ? `Include these ideas: ${points.join("; ")}.` : "",
					labels.length > 0 ? `Use labels: ${labels.join(", ")}.` : "",
					"Make it legible, accurate, and suitable for a learner studying from the image.",
				].filter(Boolean).join(" ");

				let payload: Record<string, string>;
				let note = "";
				if (mode !== "svg") {
					try {
						const generated = await generateOpenAiImage({ prompt, model: imageModel, size, quality });
						payload = {
							title,
							alt: subtitle,
							dataUrl: generated.dataUrl,
							mimeType: generated.mimeType,
							model: imageModel,
							prompt,
						};
					} catch (error) {
						if (mode === "model") throw error;
						note = `\n\n_Image model unavailable, rendered a local SVG fallback instead: ${error instanceof Error ? error.message : String(error)}_`;
						payload = {
							title,
							alt: subtitle,
							svg: buildLocalImageSvg({ title, subtitle, points, labels, style, kind }),
							model: "svg-local",
							prompt,
						};
					}
				} else {
					payload = {
						title,
						alt: subtitle,
						svg: buildLocalImageSvg({ title, subtitle, points, labels, style, kind }),
						model: "svg-local",
						prompt,
					};
				}

				return [
					`# Generated Image: ${title}`,
					"",
					subtitle,
					note,
					"",
					`<keating-image json=${JSON.stringify(JSON.stringify(payload))} />`,
				].join("\n");
			}
		),

		// verify - Self-check knowledge before teaching
		createTool(
			"verify",
			"Generate a fact-checking checklist for a topic. Always use this BEFORE teaching to self-verify your knowledge.",
			{
				topic: { type: "string", description: "The topic to generate a verification checklist for" }
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const resolved = resolveTopic(topic);
				const checklist = `# Verification Checklist: ${resolved.title}

Before teaching this topic, verify your knowledge:

## Core Facts
- [ ] I can define ${resolved.title} precisely
- [ ] I know 3+ real-world applications
- [ ] I understand the limitations

## Common Misconceptions
${resolved.misconceptions.map((m) => `- [ ] I can explain why "${m}" is wrong`).join("\n")}
- [ ] I have counterexamples ready

## Prerequisites
${resolved.prerequisites.map((p) => `- [ ] Learners need: ${p}`).join("\n")}
- [ ] I can assess prerequisite knowledge
- [ ] I have bridge materials if needed

## Edge Cases
- [ ] I know where ${resolved.title} doesn't apply
- [ ] I can handle "what if" questions
- [ ] I understand advanced extensions

## Sources Verified
- [ ] Primary sources checked
- [ ] Multiple sources agree
- [ ] Recent developments included`;

				const saved = await storage.saveVerification(topic, checklist);

				return `[artifact://verification/${saved.id}]\n\n${checklist}`;
			}
		),

		// bench - Run synthetic learner benchmark
		createTool(
			"bench",
			"Run a synthetic learner benchmark against the current teaching policy. Use to measure teaching effectiveness and identify weaknesses.",
			{
				topic: { type: "string", description: "Optional topic to focus the benchmark on" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const teacherPolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const learnerState = await storage.getLearnerState();
				const realOutcomes = extractBrowserOutcomes(learnerState.feedbackHistory, learnerState.topicsExplored);

				const result = runBenchmarkSuite(teacherPolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const report = benchmarkToMarkdown(result);

				const saved = await storage.saveBenchmark(result.overallScore, report, topic, JSON.stringify(result.trace, null, 2));

				return `[artifact://benchmark/${saved.id}]\n\n**Overall Score:** ${result.overallScore.toFixed(2)}/100\n\n${report}`;
			}
		),

		// evolve - Evolve teaching policy via MAP-Elites
		createTool(
			"evolve",
			"Evolve the teaching policy using MAP-Elites algorithm. Use to search for better policy parameters when benchmarks show room for improvement.",
			{
				topic: { type: "string", description: "Optional topic to focus the evolution on" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const basePolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const learnerState = await storage.getLearnerState();
				const realOutcomesRef = extractBrowserOutcomes(learnerState.feedbackHistory, learnerState.topicsExplored);
				void realOutcomesRef;

				const meRun = mapElitesEvolve(basePolicy, topic);
				const run = mapElitesToEvolutionRun(meRun);
				const report = mapElitesToMarkdown(meRun);

				await storage.savePolicy(policyToMarkdown(run.bestPolicy, run.best.overallScore), true);

				const saved = await storage.saveEvolution(
					run.best.overallScore,
					JSON.stringify(run.bestPolicy),
					report,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				return `[artifact://evolution/${saved.id}]\n\n**Policy evolved (MAP-Elites)**\n\nBest: ${run.best.overallScore.toFixed(2)}/100 | Baseline: ${run.baseline.overallScore.toFixed(2)}/100 | Filled cells: ${meRun.filledCellCount}/${meRun.totalCells} | Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length}\n\n${report}`;
			}
		),

		// quiz - Generate retrieval practice questions
		createTool(
			"quiz",
			"Generate retrieval practice questions for a topic. Creates recall, comprehension, application, and transfer questions with answer keys. Pass adaptive=true to enable adaptive branching (skips fallbacks when learner answers correctly). Pass reframes=[\"eli5\",\"debug\"] to pre-generate question reframes.",
			{
				topic: { type: "string", description: "The topic to generate quiz questions for" },
				adaptive: { type: "boolean", description: "Enable adaptive branching with fallback questions (default false)" },
				reframes: { type: "array", items: { type: "string" }, description: "Reframe modes to pre-generate, e.g. [\"eli5\", \"debug\", \"cooking\"]" },
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const reframeModes = Array.isArray(params.reframes)
					? params.reframes.filter((r): r is string => typeof r === "string")
					: undefined;
				const quiz = generateQuiz(topic, 42, {
					adaptive: params.adaptive === true,
					reframes: reframeModes,
				});
				const md = quizToMarkdown(quiz);
				const answers = quizAnswerKeyToMarkdown(quiz);

				const saved = await storage.saveLessonPlan(topic, md, { type: "quiz", questionCount: quiz.questions.length });

				return `[artifact://plan/${saved.id}]\n\n${md}\n---\n${answers}\n\n<keating-quiz json=${JSON.stringify(JSON.stringify(quiz))} />`;
			}
		),

		// feedback - Record learner feedback
		createTool(
			"feedback",
			"Record a learner feedback signal for a topic. Call this after teaching to track session outcomes. signal must be 'up', 'down', or 'confused'.",
			{
				signal: { type: "string", enum: ["up", "down", "confused"], description: "Feedback signal: up, down, or confused" },
				topic: { type: "string", description: "The topic the feedback is about (defaults to 'general')" }
			},
			async (params) => {
				const signalParam = (params.signal as string) || "";
				const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
					up: "thumbs-up",
					down: "thumbs-down",
					confused: "confused",
				};
				const signal = signalMap[signalParam];
				if (!signal) {
					return "signal must be 'up', 'down', or 'confused'.";
				}

				const topic = (params.topic as string) || "general";
				await storage.recordFeedback(topic, signal);

				return `Recorded ${signal} feedback for "${topic}".`;
			}
		),

		// policy - Show current teaching policy
		createTool(
			"policy",
			"Show the current active teaching policy parameters.",
			{},
			async () => {
				const policy = await storage.getActivePolicy();
				const content = policy?.content || DEFAULT_BROWSER_POLICY;

				return `\`\`\`markdown\n${content}\n\`\`\``;
			}
		),

		// outputs - Browse artifacts
		createTool(
			"outputs",
			"Browse all saved Keating artifacts (plans, maps, benchmarks, evolutions, etc).",
			{},
			async () => {
				const artifacts = await storage.listArtifacts();

				if (artifacts.length === 0) {
					return "No artifacts yet.";
				}

				const list = artifacts
					.slice(0, 20)
					.map((a) => `- ${a.label} (${new Date(a.createdAt).toLocaleDateString()})`)
					.join("\n");

				return `Keating Artifacts (${artifacts.length} total)\n\n${list}`;
			}
		),

		// learner_state - Load learner profile (agent-facing, renamed from /state)
		createTool(
			"learner_state",
			"Load the learner's profile, session history, and topic progress. ALWAYS call this at the start of every new conversation.",
			{},
			async () => {
				await storage.recordSessionStart();
				const state = await storage.getLearnerState();

				const upCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-up").length;
				const downCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-down").length;
				const confusedCount = state.feedbackHistory.filter((f) => f.signal === "confused").length;

				const topicList = state.topicsExplored.slice(-10).map((t) => `- ${t}`).join("\n") || "None yet";

				return `Learner Profile:
- Sessions: ${state.sessionsCount || 0}
- Topics explored: ${state.topicsExplored.length}
${topicList}
- Feedback: 👍${upCount} 👎${downCount} 🤔${confusedCount}
- Last session: ${state.lastSessionAt ? new Date(state.lastSessionAt).toLocaleString() : "First session"}`;
			}
		),

		// auto_improve - Full autonomous self-improvement loop
		createTool(
			"auto_improve",
			"Run the full autonomous self-improvement loop: benchmark current policy → evolve policy via MAP-Elites → evolve prompt template → record improvement. Use this instead of calling bench/evolve/improve separately. Triggers automatically on first session and periodically thereafter.",
			{
				topic: { type: "string", description: "Optional topic to focus the improvement on" },
				force: { type: "boolean", description: "Set true only when the learner explicitly asks to run auto_improve again in this session" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const force = params.force === true;
				const previousPolicy = await storage.getActivePolicy();
				const alreadyRanThisSession = (await storage.getImprovementAttempts()).some(
					(attempt) => attempt.sessionId === storage.currentSessionId
				);
				if (alreadyRanThisSession && !force) {
					return "auto_improve already ran in this session. Pass force=true only if the learner explicitly asks to run it again.";
				}

				const basePolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const learnerState = await storage.getLearnerState();
				const realOutcomes = extractBrowserOutcomes(learnerState.feedbackHistory, learnerState.topicsExplored);

				// Step 1: Baseline benchmark
				const baseline = runBenchmarkSuite(basePolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const baselineReport = benchmarkToMarkdown(baseline);
				await storage.saveBenchmark(baseline.overallScore, baselineReport, topic);

				// Step 2: Evolve policy via MAP-Elites
				const meRun = mapElitesEvolve(basePolicy, topic);
				const run = mapElitesToEvolutionRun(meRun);
				const evolveReport = mapElitesToMarkdown(meRun);

				await storage.savePolicy(policyToMarkdown(run.bestPolicy, run.best.overallScore), true);
				const saved = await storage.saveEvolution(
					run.best.overallScore,
					JSON.stringify(run.bestPolicy),
					evolveReport,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				// Step 3: Evolve prompt template
				const promptBase = await getActiveKeatingPrompt(storage, "learn");
				const promptRun = evolvePromptTemplate(promptBase, "learn", 4);
				const promptReport = promptEvolutionToMarkdown(promptRun);
				const promptSaved = await storage.savePromptEvolution("learn", {
					bestScore: promptRun.best.score,
					bestPrompt: promptRun.best.prompt,
					report: promptReport,
				});
				options.setSystemPrompt?.(promptRun.best.prompt);

				// Step 4: Post-evolution benchmark
				const evolvedPolicy = run.bestPolicy;
				const after = runBenchmarkSuite(evolvedPolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const afterReport = benchmarkToMarkdown(after);
				const benchmarkSaved = await storage.saveBenchmark(after.overallScore, afterReport, topic);

				// Step 5: Record improvement
				const delta = after.overallScore - baseline.overallScore;
				if (delta < -0.5) {
					await storage.savePolicy(previousPolicy?.content ?? policyToMarkdown(basePolicy, baseline.overallScore), true);
				}
				const proposalId = `auto-${Date.now().toString(36)}`;
				const improvementSaved = await storage.saveImprovementAttempt({
					proposalId,
					baselineScore: baseline.overallScore,
					afterScore: after.overallScore,
					scoreDelta: delta,
					accepted: delta > -0.5,
					targets: diagnoseBenchmark(baseline).map((s) => s.area).join(","),
					hypothesis: `Auto-improve: evolved policy (${run.acceptedCandidates.length} accepted) + evolved prompt (${promptRun.acceptedCandidates.length} accepted)`,
				});

				const verdict = delta > 0
					? `IMPROVED by +${delta.toFixed(2)}`
					: delta < -0.5
						? `REGRESSED by ${delta.toFixed(2)} (evolved policy reverted)`
						: `NO SIGNIFICANT CHANGE (Δ${delta.toFixed(2)})`;

				return `[artifact://evolution/${saved.id}] [artifact://prompt-evolution/${promptSaved.id}] [artifact://benchmark/${benchmarkSaved.id}] [artifact://improvement/${improvementSaved.id}]\n\nSelf-improvement complete.

**Benchmark:** ${baseline.overallScore.toFixed(2)} → ${after.overallScore.toFixed(2)} (${verdict})

**Policy Evolution (MAP-Elites):**
- Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length} candidates
- Filled cells: ${meRun.filledCellCount}/${meRun.totalCells}
- Best policy: analogyDensity=${evolvedPolicy.analogyDensity.toFixed(3)} socraticRatio=${evolvedPolicy.socraticRatio.toFixed(3)} formalism=${evolvedPolicy.formalism.toFixed(3)}

**Prompt Evolution (PROSPER):**
- Baseline: ${promptRun.baselineScore.toFixed(2)} → Best: ${promptRun.best.score.toFixed(2)}
- Accepted: ${promptRun.acceptedCandidates.length}/${promptRun.exploredCandidates.length} candidates

**Weaknesses diagnosed:** ${diagnoseBenchmark(baseline).map((s) => s.area).join(", ") || "none"}`;
			}
		),

		// improve - Targeted improvement proposal
		createTool(
			"improve",
			"Generate a targeted improvement proposal by diagnosing benchmark weaknesses. Returns specific areas to improve and suggestions. Pass action='history' to view past improvement attempts.",
			{
				action: { type: "string", description: "Pass 'history' to view past improvement attempts" }
			},
			async (params) => {
				const sub = (params.action as string) || "";

				if (sub === "history") {
					const archive = await storage.getImprovementArchive();
					return improvementArchiveToMarkdown(archive as ImprovementArchive);
				}

				const teacherPolicy = parsePolicyFromStorage(await storage.getActivePolicy());

				const benchmark = runBenchmarkSuite(teacherPolicy);
				const proposal = generateImprovementProposal(benchmark);
				const report = proposalToMarkdown(proposal);

				return report;
			}
		),

		// trace - Browse benchmark/evolution traces
		createTool(
			"trace",
			"Browse benchmark and evolution history. Pass type='benchmark' or type='evolution' to filter.",
			{
				type: { type: "string", enum: ["benchmark", "evolution", "all"], description: "Filter by trace type" }
			},
			async (params) => {
				const type = (params.type as string) || "all";

				const benchmarks = await storage.getBenchmarks();
				const evolutions = await storage.getEvolutions();

				if (benchmarks.length === 0 && evolutions.length === 0) {
					return "No traces yet. Run auto_improve or bench first.";
				}

				const lines: string[] = ["Keating Traces\n"];

				if (type === "all" || type === "benchmark") {
					lines.push("## Benchmarks");
					for (const b of benchmarks.slice(0, 10)) {
						lines.push(`- ${b.topic || "general"}: ${b.score.toFixed(2)} (${new Date(b.createdAt).toLocaleDateString()})`);
					}
					lines.push("");
				}

				if (type === "all" || type === "evolution") {
					lines.push("## Evolutions");
					for (const e of evolutions.slice(0, 10)) {
						lines.push(`- ${e.topic || "general"}: ${e.bestScore.toFixed(2)} (${new Date(e.createdAt).toLocaleDateString()})`);
					}
				}

				return lines.join("\n");
			}
		),

		// prompt_evolve - Iteratively evolve a teaching prompt template
		createTool(
			"prompt_evolve",
			"Iteratively evolve a teaching prompt template using PROSPER-style pairwise selection. Runs 4 iterations of candidate generation and evaluation.",
			{
				name: { type: "string", description: "Name of the prompt template to evolve (defaults to 'learn')" }
			},
			async (params) => {
				const promptName = (params.name as string) || "learn";
				const basePrompt = await getActiveKeatingPrompt(storage, promptName);

				const run = evolvePromptTemplate(basePrompt, promptName, 4);
				const report = promptEvolutionToMarkdown(run);

				await storage.savePromptEvolution(promptName, {
					bestScore: run.best.score,
					bestPrompt: run.best.prompt,
					report,
				});
				options.setSystemPrompt?.(run.best.prompt);

				const improved = run.best.score > run.baselineScore;

				return `Prompt "${promptName}" evolved.\n\nBaseline: ${run.baselineScore.toFixed(2)} → Best: ${run.best.score.toFixed(2)} | Improved: ${improved}\n\n${report}`;
			}
		),

		// prompt_eval - Single-pass prompt evaluation
		createTool(
			"prompt_eval",
			"Evaluate a prompt template for teaching effectiveness in a single pass. Returns score, per-objective breakdown, and improvement feedback.",
			{
				prompt: { type: "string", description: "The prompt template content to evaluate" }
			},
			async (params) => {
				const promptContent = (params.prompt as string) || "";
				if (!promptContent) {
					return "Prompt content required.";
				}

				const result = evaluatePrompt(promptContent);

				const objectiveList = Object.entries(result.objectives)
					.map(([k, v]) => `- ${k}: ${v.toFixed(2)}`)
					.join("\n");

				const feedbackSection =
					result.feedback.length > 0
						? `\n## Feedback\n${result.feedback.map((f) => `- ${f}`).join("\n")}`
						: "\n## Feedback\n- No major issues detected.";

				return `**Score:** ${result.score.toFixed(2)}/100\n\n## Objectives\n${objectiveList}${feedbackSection}`;
			}
		),

		// timeline - Show engagement timeline
		createTool(
			"timeline",
			"Show the engagement timeline for all covered topics with retention decay and review urgency. Use at session start to check if any topics need review.",
			{},
			async () => {
				const state = await storage.getLearnerState();
				const coveredTopics: CoveredTopic[] = (state.topicsExplored || []).map((slug) => {
					const topicFeedback = state.feedbackHistory.filter((f) => f.topic === slug);
					const lastEntry = topicFeedback[topicFeedback.length - 1];
					const upCount = topicFeedback.filter((f) => f.signal === "thumbs-up").length;
					const totalCount = topicFeedback.length || 1;
					const resolved = resolveTopic(slug);
					return {
						slug: resolved.slug,
						domain: resolved.domain,
						lastSeenAt: lastEntry?.createdAt ?? (state.lastSessionAt ?? Date.now()),
						masteryEstimate: Math.min(1, 0.3 + (upCount / totalCount) * 0.5),
						sessionCount: totalCount,
					};
				});

				if (coveredTopics.length === 0) {
					return "No topics covered yet.";
				}

				const timeline = buildEngagementTimeline(coveredTopics, DEFAULT_ENGAGEMENT_POLICY);
				return engagementTimelineToMarkdown(timeline);
			}
		),

		// due - Show topics due for review
		createTool(
			"due",
			"Show topics that are due for review based on spaced repetition. Use at session start to proactively suggest review.",
			{},
			async () => {
				const state = await storage.getLearnerState();
				const coveredTopics: CoveredTopic[] = (state.topicsExplored || []).map((slug) => {
					const topicFeedback = state.feedbackHistory.filter((f) => f.topic === slug);
					const lastEntry = topicFeedback[topicFeedback.length - 1];
					const upCount = topicFeedback.filter((f) => f.signal === "thumbs-up").length;
					const totalCount = topicFeedback.length || 1;
					const resolved = resolveTopic(slug);
					return {
						slug: resolved.slug,
						domain: resolved.domain,
						lastSeenAt: lastEntry?.createdAt ?? (state.lastSessionAt ?? Date.now()),
						masteryEstimate: Math.min(1, 0.3 + (upCount / totalCount) * 0.5),
						sessionCount: totalCount,
					};
				});

				if (coveredTopics.length === 0) {
					return "No topics covered yet.";
				}

				const due = getDueTopics(coveredTopics, DEFAULT_ENGAGEMENT_POLICY);
				if (due.length === 0) {
					return "All topics are up to date. No reviews needed.";
				}

				return dueTopicsToMarkdown(due);
			}
		),

		// ask_user_question - Ask the learner one or more questions as an interactive form
		createTool(
			"ask_user_question",
			"Ask the learner one or more questions as an interactive form (choices, multi-select, and/or free text). The learner fills it in and their answers are sent back automatically. Use to check understanding, gather goals/preferences, or branch the lesson. Pass `questions` for a multi-field form, or the single-question fields for a quick one-off.",
			{
				question: { type: "string", description: "A single question to ask (use `questions` for a multi-field form)" },
				choices: { type: "array", items: { type: "string" }, description: "Optional answer choices for the single question" },
				multi_select: { type: "boolean", description: "Allow selecting multiple choices for the single question (default false)" },
				allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices, false if choices provided)" },
				hint: { type: "string", description: "Optional hint shown below the single question" },
				intro: { type: "string", description: "Optional intro text shown above the form" },
				questions: {
					type: "array",
					description: "Multiple questions to ask at once, each with its own header and choices",
					items: {
						type: "object",
						properties: {
							header: { type: "string", description: "Short label/chip shown above the question (e.g. 'Goal', 'Approach')" },
							question: { type: "string", description: "The question text" },
							choices: { type: "array", items: { type: "string" }, description: "Optional answer choices" },
							multi_select: { type: "boolean", description: "Allow selecting multiple choices (default false)" },
							allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices)" },
							hint: { type: "string", description: "Optional hint shown below this question" },
						},
					},
				},
			},
			async (params) => {
				const toStringArray = (value: unknown): string[] | undefined =>
					Array.isArray(value)
						? value.filter((c): c is string => typeof c === "string")
						: undefined;

				type FormField = {
					header?: string;
					question: string;
					choices?: string[];
					multi_select: boolean;
					allow_text: boolean;
					hint?: string;
				};

				const buildField = (raw: Record<string, unknown>): FormField | null => {
					const question = String(raw.question ?? "");
					if (!question) return null;
					const choices = toStringArray(raw.choices);
					const hasChoices = !!choices && choices.length > 0;
					return {
						header: raw.header ? String(raw.header) : undefined,
						question,
						choices: hasChoices ? choices : undefined,
						multi_select: raw.multi_select === true,
						allow_text:
							typeof raw.allow_text === "boolean" ? raw.allow_text : !hasChoices,
						hint: raw.hint ? String(raw.hint) : undefined,
					};
				};

				const fields: FormField[] = [];
				if (Array.isArray(params.questions)) {
					for (const item of params.questions) {
						if (item && typeof item === "object") {
							const field = buildField(item as Record<string, unknown>);
							if (field) fields.push(field);
						}
					}
				}
				if (fields.length === 0) {
					const single = buildField(params);
					if (single) fields.push(single);
				}
				if (fields.length === 0) return "Error: at least one question is required.";

				const intro = params.intro ? String(params.intro) : undefined;
				const payload = JSON.stringify({ intro, questions: fields });
				const summary = fields.map((f) => f.question).join(" | ");
				return `[question] Asking learner: ${summary}\n\n<keating-question json=${JSON.stringify(payload)} />`;
			}
		),

		// set_learner_goal - Capture a long-horizon goal and scaffold a tracked curriculum
		createTool(
			"set_learner_goal",
			"Capture what the learner wants to ACCOMPLISH (a task or project) and build a long-horizon, multi-step curriculum that scaffolds toward it. The goal is persisted and its progress is tracked across sessions. Design the `steps` yourself as an ordered path (concept → practice → project → reflection); if you omit steps, a scaffold is generated from the anchor topic. Use update_goal_step to advance it later.",
			{
				title: { type: "string", description: "The goal/task the learner wants to accomplish (e.g. 'Build a personal-finance tracker app')" },
				description: { type: "string", description: "What success looks like / scope of the goal" },
				motivation: { type: "string", description: "Why the learner wants this — used to keep them oriented" },
				target_date: { type: "string", description: "Optional target date or timeframe (free text)" },
				topic: { type: "string", description: "Anchor topic used to auto-scaffold steps when `steps` is omitted" },
				steps: {
					type: "array",
					description: "Ordered curriculum steps building toward the goal",
					items: {
						type: "object",
						properties: {
							title: { type: "string", description: "Step title" },
							description: { type: "string", description: "What the learner does in this step" },
							kind: { type: "string", description: "One of: concept, practice, project, milestone, reflection" },
							topic: { type: "string", description: "Topic this step centers on (enables plan/quiz tooling)" },
							success_criteria: { type: "array", items: { type: "string" }, description: "How the learner knows this step is done" },
						},
					},
				},
			},
			async (params) => {
				const title = String(params.title ?? "").trim();
				if (!title) return "Error: a goal title is required.";

				const rawSteps = Array.isArray(params.steps) ? params.steps : [];
				const steps: GoalStepInput[] = rawSteps
					.filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
					.map((s) => ({
						title: String(s.title ?? ""),
						description: s.description ? String(s.description) : undefined,
						kind: s.kind ? (String(s.kind) as GoalStepInput["kind"]) : undefined,
						topic: s.topic ? String(s.topic) : undefined,
						successCriteria: Array.isArray(s.success_criteria)
							? (s.success_criteria as unknown[]).filter((c): c is string => typeof c === "string")
							: undefined,
					}));

				const goal = buildGoal({
					title,
					description: params.description ? String(params.description) : undefined,
					motivation: params.motivation ? String(params.motivation) : undefined,
					targetDate: params.target_date ? String(params.target_date) : undefined,
					topic: params.topic ? String(params.topic) : undefined,
					steps: steps.length > 0 ? steps : undefined,
				});

				const saved = await storage.saveGoal(goal);
				const progress = computeGoalProgress(saved);
				const summary = [
					`Created goal **${saved.title}** with ${saved.steps.length} steps.`,
					progress.nextStep ? `First up: ${progress.nextStep.title}.` : "",
					"The learner can tap steps in the card below to track progress.",
				]
					.filter(Boolean)
					.join(" ");
				return `${summary}\n\n<keating-goal json=${JSON.stringify(JSON.stringify(saved))} />`;
			}
		),

		// list_learner_goals - Show the learner's goals and progress
		createTool(
			"list_learner_goals",
			"List the learner's saved goals with their progress and next step. Use at the start of a session to resume long-horizon work.",
			{
				status: { type: "string", description: "Optional filter: active, completed, or paused" },
			},
			async (params) => {
				const filter = params.status ? String(params.status) : undefined;
				let goals = await storage.getGoals();
				if (filter) goals = goals.filter((g) => g.status === filter);
				if (goals.length === 0) return "No saved goals yet. Use set_learner_goal to create one.";
				const lines = goals.map((g) => {
					const p = computeGoalProgress(g);
					const next = p.nextStep ? ` — next: ${p.nextStep.title}` : "";
					return `- **${g.title}** (${g.status}) — ${p.done}/${p.total} steps, ${p.percent}%${next}  \`${g.id}\``;
				});
				return `## Learner goals\n\n${lines.join("\n")}`;
			}
		),

		// update_goal_step - Advance a step in a goal's curriculum
		createTool(
			"update_goal_step",
			"Mark a curriculum step's status to track progress toward a goal. Persists across sessions and recomputes overall goal completion.",
			{
				goal_id: { type: "string", description: "The goal id (from set_learner_goal or list_learner_goals)" },
				step_id: { type: "string", description: "The step id to update" },
				status: { type: "string", description: "New status: not_started, in_progress, or done" },
			},
			async (params) => {
				const goalId = String(params.goal_id ?? "");
				const stepId = String(params.step_id ?? "");
				const status = String(params.status ?? "") as GoalStepStatus;
				if (!goalId || !stepId) return "Error: goal_id and step_id are required.";
				if (!["not_started", "in_progress", "done"].includes(status)) {
					return "Error: status must be not_started, in_progress, or done.";
				}
				const goal = await storage.getGoal(goalId);
				if (!goal) return `Error: no goal found with id ${goalId}.`;
				if (!goal.steps.some((s) => s.id === stepId)) {
					return `Error: goal ${goalId} has no step ${stepId}.`;
				}
				const updated = advanceGoalStep(goal, stepId, status);
				const saved = await storage.saveGoal(updated);
				const progress = computeGoalProgress(saved);
				const next = progress.nextStep ? `Next: ${progress.nextStep.title}` : "All steps complete! 🎉";
				return `Updated "${saved.title}" → ${progress.done}/${progress.total} steps (${progress.percent}%). ${next}\n\n<keating-goal json=${JSON.stringify(JSON.stringify(saved))} />`;
			}
		),

		// edit_source - Propose a source code edit (web: produces diff; CLI: applies directly)
		createTool(
			"edit_source",
			"Propose a precise source code edit using search/replace blocks. In the browser this returns a formatted diff for manual application; on the CLI it can apply directly. Use for bug fixes, refactoring, or adding small features. Always include enough surrounding context in the search block to make it unique.",
			{
				file: { type: "string", description: "Relative file path to edit (e.g. src/core/lesson-plan.ts)" },
				search: { type: "string", description: "Exact code block to search for. Must be unique in the file. Include surrounding lines for safety." },
				replace: { type: "string", description: "Replacement code block." },
				reason: { type: "string", description: "Short explanation of why this change is being made." },
			},
			async (params) => {
				const file = String(params.file ?? "");
				const search = String(params.search ?? "");
				const replace = String(params.replace ?? "");
				const reason = String(params.reason ?? "agent edit");

				if (!file || !search) {
					return "Error: file and search are required.";
				}

				// Web context: we cannot write to the filesystem, so produce a formatted diff
				const searchLines = search.split("\n").length;
				const replaceLines = replace.split("\n").length;
				const charDelta = replace.length - search.length;

				return [
					`## Proposed Edit: ${file}`,
					"",
					`**Reason:** ${reason}`,
					`**Lines:** ${searchLines} → ${replaceLines}  |  **Char Δ:** ${charDelta >= 0 ? "+" : ""}${charDelta}`,
					"",
					"### Search",
					"```",
					search,
					"```",
					"",
					"### Replace",
					"```",
					replace,
					"```",
					"",
					"---",
					"**To apply this edit in the CLI:**",
					`echo '{"search":${JSON.stringify(search)},"replace":${JSON.stringify(replace)}}' | keating edit ${file}`,
					"",
					"**Or manually:** copy the Replace block into the file where the Search block currently appears.",
				].join("\n");
			}
		),
	];

	if (options.speech?.settings.enabled) {
		tools.push(createSpeechTool(options.speech.settings, options.speech.getApiKey));
	}

	return tools;
}
