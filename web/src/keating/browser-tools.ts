/**
 * Browser-compatible Keating tools/commands
 * Uses real implementations from core.ts
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingAgentRuntimeConfig } from "./agent-runtime";
import { KeatingStorage, DEFAULT_BROWSER_POLICY } from "./storage";
import { createSpeechTool, type WebSpeechSettings } from "./speech";
import { getProviderApiKey } from "../lib/provider-models";
import { proxiedProviderRequestUrl } from "../lib/provider-proxy";
import { DEFAULT_IMAGE_GENERATOR_ID, getImageGenerator, localImageEndpoint } from "../lib/image-generators";
import { loadKeatingUiSettings } from "./ui-settings";
import {
	buildGoal,
	advanceGoalStep,
	computeGoalProgress,
	type GoalStepInput,
	type GoalStepStatus,
} from "./goals";
import { extractBrowserOutcomes, type BrowserLearnerOutcome } from "./core";
import { DEFAULT_TEACHER_PERSONA } from "./persona";
import operationalProtocolMarkdown from "./prompts/operational-protocol.md?raw";
import speechSystemPromptMarkdown from "./prompts/speech-system-prompt.md?raw";
import {
	runBenchmarkSuite,
	benchmarkToMarkdown,
	hasEnoughRealData,
	MIN_REAL_OUTCOMES,
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
	buildAuthoredQuestions,
	quizToMarkdown,
	quizAnswerKeyToMarkdown,
	type AuthoredQuestion,
	type TeacherPolicy,
	type BenchmarkResult,
	type EvolutionRun,
	type CoveredTopic,
	type ImprovementProposal,
	type ImprovementArchive,
} from "./core";
import type { Policy } from "./storage";
import { initialSrsState, validateDeckDraft } from "./srs";
import {
	isNodePodActive,
	nodePodExecute,
	nodePodApplyEdit,
	nodePodApplyEdits,
	nodePodRollbackEdits,
	nodePodDiffFile,
	nodePodChangedFiles,
	nodePodCreateSnapshot,
	nodePodFindSnapshot,
	nodePodRestoreSnapshot,
	nodePodRunScript,
	nodePodValidateEdit,
	writeJsCounterpart,
	clearPreEditSnapshots,
	NODEPOD_LOCAL_ENDPOINT,
	nodePodInfo,
} from "./nodepod-runtime";

/**
 * Fixed operational protocol — the HOW of the system prompt (tools, bootstrap,
 * self-improvement). This is never user-editable; the editable persona (the WHO)
 * lives in persona.ts and is composed with this via composeKeatingSystemPrompt.
 */
export const KEATING_OPERATIONAL_PROTOCOL = operationalProtocolMarkdown.trim();

const SPEECH_SYSTEM_PROMPT = `\n${speechSystemPromptMarkdown.trim()}\n`;

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
	execute: (params: Record<string, unknown>) => Promise<string>,
	required?: string[],
): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: {
			type: "object",
			properties: parameters,
			...(required?.length ? { required } : {}),
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

function buildManimScene(resolved: ResolvedTopic, storyboard: string): string {
	// Pull the agent-authored scene list out of the storyboard so the generated
	// manim scene source actually reflects the lesson beats (titles + visuals)
	// rather than the generic placeholder template we used to ship.
	const scenes = parseStoryboardScenes(storyboard);
	if (scenes.length === 0) {
		return `// Scene: ${resolved.title}
// Manim-web compatible scene definition (no authored scenes found)
async function construct(scene, M) {
  const title = new M.Text({ text: ${JSON.stringify(resolved.title)}, fontSize: 48, color: "#f4f1e8" });
  title.moveTo([0, 1.2, 0]);
  const summary = new M.Text({ text: ${JSON.stringify(resolved.summary)}, fontSize: 26, color: "#c7d2fe" });
  summary.moveTo([0, -0.4, 0]);
  await scene.play(new M.Write(title));
  await scene.play(new M.FadeIn(summary));
  await scene.wait(1.5);
}`;
	}

	const body = scenes
		.map((scene, index) => {
			const titleLiteral = JSON.stringify(scene.title);
			const visualLiteral = JSON.stringify(scene.visual || scene.highlight || "");
			const y = index % 2 === 0 ? 0.7 : -0.7;
			return [
				`  const title${index} = new M.Text({ text: ${titleLiteral}, fontSize: 38, color: "#f4f1e8" });`,
				`  title${index}.moveTo([0, ${y + 0.8}, 0]);`,
				`  const visual${index} = new M.Text({ text: ${visualLiteral}, fontSize: 24, color: "#c7d2fe" });`,
				`  visual${index}.moveTo([0, ${y - 0.05}, 0]);`,
				`  await scene.play(new M.FadeIn(title${index}), new M.Write(visual${index}));`,
				`  await scene.wait(${parseStoryboardDurationSeconds(scene.duration).toFixed(2)});`,
				`  await scene.play(new M.FadeOut(title${index}), new M.FadeOut(visual${index}));`,
			].join("\n");
		})
		.join("\n");

	return `// Scene: ${resolved.title}
// Manim-web compatible scene definition (agent-authored scenes)
async function construct(scene, M) {
${body}
}`;
}

interface StoryboardScene {
	number: number;
	title: string;
	duration: string;
	visual: string;
	audio?: string;
	transition?: string;
	highlight?: string;
}

/** Extract agent-authored scenes from a storyboard markdown document. */
export function parseStoryboardScenes(markdown: string): StoryboardScene[] {
	const lines = markdown.split(/\r?\n/);
	const scenes: StoryboardScene[] = [];
	let current: Partial<StoryboardScene> = {};
	for (const line of lines) {
		const titleMatch = line.match(/^#\s+Animation Storyboard:\s*(.+)$/);
		if (titleMatch) continue;
		const sceneMatch = line.match(/^##\s+Scene\s+(\d+):\s*(.+?)\s*\((\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?s)\)\s*$/);
		if (sceneMatch) {
			if (current.title) scenes.push(current as StoryboardScene);
			current = {
				number: Number(sceneMatch[1]),
				title: sceneMatch[2].trim(),
				duration: sceneMatch[3].trim(),
			};
			continue;
		}
		const visualMatch = line.match(/^-\s*\*\*Visual\*\*:\s*(.+)$/);
		if (visualMatch) current.visual = visualMatch[1].trim();
		const audioMatch = line.match(/^-\s*\*\*(?:Audio|Narration)\*\*:\s*(.+)$/);
		if (audioMatch) current.audio = audioMatch[1].trim();
		const transMatch = line.match(/^-\s*\*\*Transition\*\*:\s*(.+)$/);
		if (transMatch) current.transition = transMatch[1].trim();
		const durMatch = line.match(/^-\s*\*\*Duration\*\*:\s*(\d+)s\s*$/);
		if (durMatch) current.duration = `${durMatch[1]}s`;
		const highlightMatch = line.match(/^-\s*\*\*(?:Highlight|Overlay|Step-through)\*\*:\s*(.+)$/);
		if (highlightMatch) current.highlight = highlightMatch[1].trim();
	}
	if (current.title) scenes.push(current as StoryboardScene);
	return scenes;
}

function parseStoryboardDurationSeconds(label: string): number {
	const cleaned = label.trim().replace(/s$/i, "");
	const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
	if (range) return Math.max(0.5, Number(range[2]) - Number(range[1]));
	const value = Number(cleaned);
	return Number.isFinite(value) ? Math.max(0.5, value) : 4;
}

function storyboardTitle(markdown: string): string {
	const match = markdown.match(/^#\s+Animation Storyboard:\s*(.+)$/m);
	return match ? match[1].trim() : "";
}

function buildAuthoredAnimationStoryboard(resolved: ResolvedTopic, kind: "manim" | "hyperframes", summary: string): string {
	const premise = summary || resolved.summary;
	return [
		`# Animation Storyboard: ${resolved.title}`,
		"",
		"## Scene 1: Establish the question (0-3s)",
		`- **Visual**: Open with the core structure of ${resolved.title} and make the learner's starting question visible.`,
		`- **Narration**: ${premise}`,
		"- **Highlight**: Name the thing that will change on screen.",
		"",
		"## Scene 2: Show the motion (3-8s)",
		`- **Visual**: Use the authored ${kind} scene to animate the central relationship, not just a static title card.`,
		"- **Narration**: Point to the moving parts and connect them to the learner's intuition.",
		"- **Highlight**: The animation source is stored in the scene field.",
		"",
		"## Scene 3: Lock the takeaway (8-12s)",
		"- **Visual**: End on the key contrast, equation, or diagram state that should remain in memory.",
		"- **Narration**: State the transfer rule the learner can reuse.",
		"- **Transition**: Fade out after the final state is legible.",
		"",
	].join("\n");
}

function buildHyperframesComposition(resolved: ResolvedTopic, storyboard: string): string {
	// Use the agent-authored storyboard so every visible label, body line, and
	// duration reflects actual teaching content — not a generic template.
	const title = storyboardTitle(storyboard) || resolved.title;
	const scenes = parseStoryboardScenes(storyboard);
	const compositionId = `${resolved.slug}-lesson`;

	const clips =
		scenes.length > 0
			? scenes.map((scene, index) => {
				const start = scenes.slice(0, index).reduce((sum, prev) => sum + parseStoryboardDurationSeconds(prev.duration), 0);
				const duration = parseStoryboardDurationSeconds(scene.duration);
				return {
					start,
					duration,
					label: `Scene ${scene.number}`,
					title: scene.title,
					body: scene.visual || scene.highlight || scene.audio || scene.transition || "",
				};
			})
			: [{ start: 0, duration: 6, label: "Lesson", title: resolved.title, body: resolved.summary }];

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

async function generateImageViaEndpoint(params: {
	endpoint: string;
	apiKey?: string;
	prompt: string;
	model: string;
	size: string;
	quality: string;
}): Promise<{ dataUrl: string; mimeType: string }> {
	const proxied = proxiedProviderRequestUrl(params.endpoint);
	const headers: Record<string, string> = {
		accept: "application/json",
		"content-type": "application/json",
		"x-target-url": proxied.targetBaseUrl,
	};
	if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

	const response = await fetch(proxied.url, {
		method: "POST",
		headers,
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
		throw new Error(`Image generation failed (${response.status}): ${String(message).slice(0, 500)}`);
	}

	const b64 = payload?.data?.[0]?.b64_json;
	if (!b64 || typeof b64 !== "string") {
		throw new Error("Image generation returned no base64 image data.");
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

				const nodePodActive = isNodePodActive();
				const nodePod = nodePodActive
					? [
						"",
						"## NodePod Sandbox",
						`- active: true`,
						`- local endpoint: ${NODEPOD_LOCAL_ENDPOINT}`,
						`- operations: shell.exec, fs.read, fs.write, snapshot.create`,
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
					nodePod,
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
				const operation = typeof params.operation === "string" ? params.operation.trim() : "";
				if (!operation) return "Operation required. Pass an operation parameter.";

				// Route through NodePod browser sandbox when active
				if (isNodePodActive()) {
					try {
						const result = await nodePodExecute(operation, params.payload);
						return [
							"# Remote Execution Result (NodePod)",
							"",
							`- mode: browser-nodepod`,
							`- operation: ${operation}`,
							"",
							stringifyRemoteResult(result),
						].join("\n");
					} catch (error) {
						return [
							"# Remote Execution Failed (NodePod)",
							"",
							`- operation: ${operation}`,
							`- error: ${error instanceof Error ? error.message : String(error)}`,
						].join("\n");
					}
				}

				if (!runtime || runtime.mode === "browser-only" || !runtime.executionEndpoint) {
					return unavailableRemoteRuntimeMessage(runtime);
				}

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

		// animate - The model authors and renders a real manim-web or hyperframes animation
		createTool(
			"animate",
			"You write the animation itself. The tool renders whatever you author in a sandboxed iframe inline in the chat. Pass `kind` (manim|hyperframes) and authored `body`. For `manim`, write an `async function construct(scene, M) { ... }` that uses manim-web primitives (M.Text, M.FadeIn, M.Create, M.Axes, M.BarChart, M.Transform, M.Write, M.LaggedStart, M.Succession, etc.) to drive a real motion-based explanation. For `hyperframes`, write a full HTML document with GSAP timelines. The tool does not synthesize a template. Calling without authored `body` is rejected with the exact shape required.",
			{
				topic: { type: "string", description: "The topic this animation explains" },
				kind: { type: "string", enum: ["manim", "hyperframes"], description: "Renderer: manim (raw JS scene using manim-web) or hyperframes (HTML + GSAP)." },
				summary: { type: "string", description: "One-line summary shown above the animation. Recommended." },
				body: { type: "string", description: "REQUIRED. The JavaScript construct function or full HTML document you author — must explain THIS topic with real content, not a placeholder." },
				storyboard: { type: "string", description: "Optional markdown storyboard with `# Animation Storyboard:` and `## Scene N: Title (start-ends)` sections. If omitted, Keating saves a concise generated storyboard around the authored scene." },
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const kindRaw = typeof params.kind === "string" ? params.kind : "";
				if (kindRaw && kindRaw !== "manim" && kindRaw !== "hyperframes") {
					return [
						"Pick a valid `kind`: manim or hyperframes.",
						"  - `manim`: write an `async function construct(scene, M) { ... }` using manim-web primitives. The construct function runs against a real Scene and animates with real motion.",
						"  - `hyperframes`: write a full HTML document with GSAP timelines.",
						"You MUST pass `body` with real content for THIS topic. No template fallback exists.",
					].join("\n");
				}

				const kind: "manim" | "hyperframes" = kindRaw === "manim" ? "manim" : "hyperframes";
				const body = typeof params.body === "string" ? params.body : "";
				const summary = typeof params.summary === "string" ? params.summary.trim() : "";

				if ((kind === "manim" || kind === "hyperframes") && body.trim().length < 50) {
					const manimExample =
						"async function construct(scene, M) {\n" +
						"  const title = new M.Text({ text: 'How DNS works', fontSize: 48, color: '#f4f1e8' });\n" +
						"  title.moveTo([0, 3, 0]);\n" +
						"  await scene.play(new M.Write(title));\n" +
						"  await scene.wait(0.5);\n" +
						"  const laptop = new M.Text({ text: 'Laptop', fontSize: 28 });\n" +
						"  laptop.moveTo([-4, 1, 0]);\n" +
						"  await scene.play(new M.FadeIn(laptop));\n" +
						"  const resolver = new M.Text({ text: 'Recursive resolver', fontSize: 28 });\n" +
						"  resolver.moveTo([4, 1, 0]);\n" +
						"  await scene.play(new M.FadeIn(resolver));\n" +
						"  await scene.play(new M.Create(new M.Arrow([-3, 0.5, 0], [3, 0.5, 0], { color: '#0f766e' })));\n" +
						"  await scene.wait(1.5);\n" +
						"}\n\n" +
						"Use any manim-web primitive via M.* and drive scene.play(...) / scene.wait(...) for real motion.";
					const hyperframesExample =
						"<!doctype html><html><body style=\"background:#0a0a0a;color:#f4f1e8;font-family:ui-monospace,monospace;margin:0;\">\n" +
						"  <section id=\"clip-0\" data-start=\"0\" data-duration=\"3\" style=\"opacity:0;\"><h2>Browser cache</h2><p>The OS asks the resolver</p></section>\n" +
						"  <section id=\"clip-3\" data-start=\"3\" data-duration=\"4\" style=\"opacity:0;\"><h2>Recursive resolver</h2><p>The heavy lifting happens here</p></section>\n" +
						"  <script src=\"https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js\"></script>\n" +
						"  <script>\n" +
						"    const tl = gsap.timeline({paused:true});\n" +
						"    tl.to('#clip-0', {opacity:1, duration:0.4}, 0);\n" +
						"    tl.to('#clip-0', {opacity:0, duration:0.3}, 3);\n" +
						"    tl.to('#clip-3', {opacity:1, duration:0.4}, 3);\n" +
						"    tl.play(0);\n" +
						"  </script>\n</body></html>";
					return [
						`Author the ${kind} animation yourself. Pass \`body\` as real, non-placeholder ${kind === "manim" ? "JavaScript" : "HTML"} code for THIS topic (>=50 chars).`,
						"",
						"Example body shape:",
						"",
						kind === "manim" ? manimExample : hyperframesExample,
					].join("\n");
				}

				const resolved = resolveTopic(topic);

				const storyboard =
					typeof params.storyboard === "string" && params.storyboard.trim()
						? params.storyboard.trim()
						: buildAuthoredAnimationStoryboard(resolved, kind, summary);
				const scene = body;
				const renderer: "manim" | "hyperframes" = kind === "hyperframes" ? "hyperframes" : "manim";
				const animationPayload: Record<string, unknown> = {
					topic: resolved.title,
					kind,
					summary: summary || undefined,
					body,
				};

				const manifest = JSON.stringify(
					{
						topic: resolved.title,
						slug: resolved.slug,
						domain: resolved.domain,
						renderer,
						kind,
						sourceBytes: body.length,
						generatedAt: new Date().toISOString(),
					},
					null,
					2,
				);
				const saved = await storage.saveAnimation(topic, storyboard, scene, manifest, renderer);

				return [
					`[artifact://animation/${saved.id}]`,
					"",
					`<keating-animation json=${JSON.stringify(JSON.stringify(animationPayload))} />`,
				].join("\n");
			}
		),

		createTool(
			"deck",
			"Build a spaced-repetition flashcard deck that the chat renders inline. You must author the cards yourself from the material the learner actually covered. Pass `cards` as an array of {front, back, tags?}; generic or duplicate cards are rejected. Keating persists the deck and initializes real SM-2 review state for each card.",
			{
				topic: { type: "string", description: "The topic this deck covers" },
				title: { type: "string", description: "Optional deck title shown in the inline review card. Defaults to '<topic> flashcards'." },
				description: { type: "string", description: "Optional one-line note about what the learner should practice with this deck." },
				cards: {
					type: "array",
					description: "REQUIRED. Model-authored flashcards: [{ front, back, tags? }]. Write concrete retrieval prompts and answers from the lesson; no placeholders or generic cards.",
					items: {
						type: "object",
						properties: {
							front: { type: "string", description: "Prompt side of the card." },
							back: { type: "string", description: "Answer side of the card." },
							tags: { type: "array", items: { type: "string" }, description: "Optional topic tags for the card." },
						},
					},
				},
			},
			async (params) => {
				const topic = String(params.topic ?? "").trim();
				if (!topic) return "Topic required.";

				const validated = validateDeckDraft(params.cards);
				if (!validated.ok) {
					return `Author the flashcards yourself. ${validated.error} No template fallback exists.`;
				}

				const resolved = resolveTopic(topic);
				const title = String(params.title ?? "").trim() || `${resolved.title} flashcards`;
				const description = String(params.description ?? "").trim() || undefined;
				const baseSlug = slugifyDeckTitle(title) || `${resolved.slug}-flashcards`;
				const existing = await storage.getDeckBySlug(baseSlug);
				const now = Date.now();
				const cards = (validated.cards ?? []).map((card, index) => ({
					id: existing?.cards[index]?.id ?? draftDeckCardId(baseSlug, index),
					front: card.front,
					back: card.back,
					...(card.tags ? { tags: card.tags } : {}),
					srs: existing?.cards[index]?.srs ?? initialSrsState(now),
					createdAt: existing?.cards[index]?.createdAt ?? now,
					updatedAt: now,
				}));

				const saved = await storage.saveDeck({
					id: existing?.id,
					createdAt: existing?.createdAt,
					topic: resolved.title,
					slug: baseSlug,
					title,
					description,
					cards,
				});

				return [
					`Created deck **${saved.title}** with ${saved.cards.length} cards.`,
					"",
					`<keating-deck json=${JSON.stringify(JSON.stringify(saved))} />`,
				].join("\n");
			}
		),

		// plan - Generate lesson plan
		createTool(
			"plan",
			"Save a lesson plan you author yourself, grounded in the real material — for EVERY topic, including familiar ones. There is no template: you must pass `content`. Format it as markdown: a `- Summary: ...` line, then `## Phase Title` sections each with a one-line purpose followed by `- ` action bullets. The plan is its own artifact; do NOT also build a quiz here — quizzes are crafted separately, after the learner has gone through the lesson.",
			{
				topic: { type: "string", description: "The topic this lesson plan covers" },
				content: { type: "string", description: "REQUIRED. Agent-authored lesson plan markdown grounded in the real material. Use `- Summary:` plus `## Phase` sections with purpose lines and `- ` bullets." },
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Topic required. Pass a topic parameter.";
				}

				const authoredContent = typeof params.content === "string" ? params.content.trim() : "";
				if (authoredContent.length < 80) {
					return "Author the lesson plan yourself. Pass `content` as markdown grounded in the real material: a `- Summary:` line, then `## Phase` sections each with a one-line purpose and `- ` action bullets. No template fallback exists.";
				}

				const saved = await storage.saveLessonPlan(topic, authoredContent, {
					domain: resolveTopic(topic).domain,
					authored: true,
				});
				return `[artifact://plan/${saved.id}]\n\n${authoredContent}`;
			}
		),

		// map - Generate concept map
		createTool(
			"map",
			"Save a Mermaid concept map you author yourself, with real concepts and the actual relationships between them — for EVERY topic, including familiar ones. There is no template: you must pass `mermaid`.",
			{
				topic: { type: "string", description: "The topic this concept map covers" },
				mermaid: { type: "string", description: "REQUIRED. Agent-authored Mermaid diagram (e.g. `graph TD; A[Concept]-->B[...]`) with real nodes and edges grounded in the material." },
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const authoredMermaid = typeof params.mermaid === "string" ? params.mermaid.trim() : "";
				if (authoredMermaid.length < 20) {
					return "Author the concept map yourself. Pass a `mermaid` diagram (e.g. `graph TD; A[Concept]-->B[Related]`) with real nodes and relationships grounded in the material. No template fallback exists.";
				}
				const saved = await storage.saveLessonMap(topic, authoredMermaid);

				return `[artifact://map/${saved.id}]\n\n\`\`\`mermaid\n${authoredMermaid}\n\`\`\``;
			}
		),

		createTool(
			"generate_image",
			"Generate a real raster learning image with the image generator the learner has configured in Settings → Image generation (OpenAI, or a local OpenAI-compatible server). You MUST author the content yourself by passing `title`, `subtitle`, and at least 3 `points` describing what the visual should communicate — generic titles like 'Learning visual' or empty point lists are rejected. Use `kind` to shape the prompt: 'anatomy' for labeled structures, 'comparison' for size/category bars, 'process' for ordered step-by-step flows, 'cards' for grouped concepts. If no image generator is configured/available, the tool returns a short message instead of an image — there is no template fallback.",
			{
				title: { type: "string", description: "REQUIRED. Short, specific title for the visual that reflects THIS topic (e.g. 'DNS resolution steps' or 'IgG antibody anatomy'), not 'Learning visual'." },
				subtitle: { type: "string", description: "REQUIRED. One-sentence framing caption that names the specific idea being illustrated." },
				prompt: { type: "string", description: "Optional explicit image-model prompt. If omitted, one is composed from title/subtitle/points/labels/kind/style." },
				kind: { type: "string", description: "cards, anatomy, comparison, or process. Shapes the composed prompt. Use 'process' for ordered step-by-step flows; 'anatomy' for labeled structures; 'comparison' for size/category bars; 'cards' for grouped concepts." },
				imageModel: { type: "string", description: "Optional override for the image model. Defaults to the model selected in Settings → Image generation, then the generator's default." },
				size: { type: "string", description: "Optional size override (e.g. 1024x1024, 1536x1024, 1024x1536). Defaults to the configured size." },
				quality: { type: "string", description: "Optional quality override: low, medium, or high. Defaults to the configured quality." },
				points: {
					type: "array",
					description: "REQUIRED (>=3). Concrete teaching points to visualize. For 'process' these become the steps; for 'anatomy' the label callouts; for 'comparison' the bar values; for 'cards' the card body text. Generic points like 'Core idea' are rejected.",
					items: { type: "string" },
				},
				labels: {
					type: "array",
					description: "Optional labels for the visual blocks (step titles, structure names, etc.).",
					items: { type: "string" },
				},
				style: {
					type: "string",
					description: "Visual style hint added to the prompt: light or dark",
				},
			},
			async (params) => {
				const title = String(params.title ?? "").trim();
				const subtitle = String(params.subtitle ?? "").trim();
				const points = asStringArray(params.points, []);
				const labels = asStringArray(params.labels, []);
				const style = String(params.style ?? "light").toLowerCase() === "dark" ? "dark" : "light";
				const kindRaw = String(params.kind ?? "cards").toLowerCase();
				const kind = ["anatomy", "comparison", "process", "cards"].includes(kindRaw) ? kindRaw : "cards";

				// Reject generic/templated content the same way plan/map/verify/quiz
				// do — the visual must be grounded in real material.
				const genericTitle = !title || title.toLowerCase() === "learning visual";
				const genericSubtitle = !subtitle || subtitle.toLowerCase() === "a compact visual summary for this concept.";
				const genericPoints = points.length < 3 || points.every((p) => /^(core idea|key relationship|learner takeaway)$/i.test(p.trim()));
				if (genericTitle || genericSubtitle || genericPoints) {
					return [
						"Author the image content yourself. The tool will not synthesize a generic visual. Pass:",
						"- `title`: a topic-specific title (e.g. 'How DNS resolves a name', 'IgG Y-shape anatomy') — not 'Learning visual'.",
						"- `subtitle`: a one-sentence framing that names the actual idea.",
						`- \`points\`: >=3 concrete points that will become the visual's content${
							kind === "process"
								? " (for process kind, these are the numbered steps in order)"
								: kind === "anatomy"
									? " (for anatomy kind, these are the labeled-structure callouts)"
									: kind === "comparison"
										? " (for comparison kind, include the value/size in each point, e.g. '150 kDa full Y')"
										: " (real concepts grounded in the material)"
						}.`,
						"- `labels` (optional): per-block labels for the visual.",
						"No template fallback exists.",
					].join("\n");
				}

				const finalTitle = title;
				const finalSubtitle = subtitle;

				// Resolve the configured image generator from the central config +
				// the learner's settings. No template/SVG fallback exists.
				const settings = loadKeatingUiSettings();
				const generator = getImageGenerator(settings.imageGenerator) ?? getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;

				const endpoint = generator.needsBaseUrl
					? localImageEndpoint(settings.localImageBaseUrl)
					: generator.fixedEndpoint ?? "";
				const apiKey = await getProviderApiKey(generator.providerKey);

				// No image generator available → return a plain message, never an image.
				if (generator.needsBaseUrl && !endpoint) {
					return `No image generation model is available. Set a base URL for the local image server in Settings → Image generation (selected generator: ${generator.label}).`;
				}
				if (!generator.needsBaseUrl && !apiKey) {
					return `No image generation model is available. Add an API key for ${generator.label} in Settings → Providers & Models, or pick a different generator in Settings → Image generation.`;
				}

				const imageModel = (settings.imageModel || String(params.imageModel ?? "")).trim() || generator.models[0] || "";
				if (!imageModel) {
					return `No image model is configured for ${generator.label}. Set one in Settings → Image generation.`;
				}

				const sizeCandidate = (String(params.size ?? "") || settings.imageSize).trim();
				const size = generator.sizes.includes(sizeCandidate) ? sizeCandidate : generator.sizes[0];
				const qualityCandidate = (String(params.quality ?? "") || settings.imageQuality).trim().toLowerCase();
				const quality = generator.qualities.includes(qualityCandidate) ? qualityCandidate : generator.qualities[0];

				const prompt = String(params.prompt ?? "").trim() || [
					`Create a clear educational ${kind === "cards" ? "infographic" : `${kind} diagram`} titled "${finalTitle}".`,
					finalSubtitle,
					points.length > 0 ? `Include these ideas: ${points.join("; ")}.` : "",
					labels.length > 0 ? `Use labels: ${labels.join(", ")}.` : "",
					`Use a ${style} visual style.`,
					"Make it legible, accurate, and suitable for a learner studying from the image.",
				].filter(Boolean).join(" ");

				// A genuine request failure (HTTP error, billing/quota, network)
				// propagates so it surfaces through the standard classified-error
				// UI like every other API error. The plain-message returns above
				// are reserved for the "no generator configured" case.
				const generated = await generateImageViaEndpoint({ endpoint, apiKey, prompt, model: imageModel, size, quality });

				const payload = {
					title: finalTitle,
					alt: finalSubtitle,
					dataUrl: generated.dataUrl,
					mimeType: generated.mimeType,
					model: imageModel,
					prompt,
				};

				return [
					`# Generated Image: ${finalTitle}`,
					"",
					finalSubtitle,
					"",
					`<keating-image json=${JSON.stringify(JSON.stringify(payload))} />`,
				].join("\n");
			}
		),

		// verify - Self-check knowledge before teaching
		createTool(
			"verify",
			"Self-check your knowledge BEFORE teaching. You must pass a `checklist` you author yourself naming the specific facts, definitions, misconceptions, and edge cases you must get right for THIS topic — for EVERY topic, including familiar ones. There is no template.",
			{
				topic: { type: "string", description: "The topic this verification checklist covers" },
				checklist: { type: "string", description: "REQUIRED. Agent-authored markdown checklist of concrete claims to verify for this topic (specific definitions, named misconceptions, edge cases, sources)." },
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const authoredChecklist = typeof params.checklist === "string" ? params.checklist.trim() : "";
				if (authoredChecklist.length < 40) {
					return "Author the checklist yourself. Pass a `checklist` in markdown naming the specific facts, definitions, named misconceptions, edge cases, and sources you must get right for THIS topic before teaching it. No template fallback exists.";
				}
				const saved = await storage.saveVerification(topic, authoredChecklist);
				return `[artifact://verification/${saved.id}]\n\n${authoredChecklist}`;
			}
		),

		// bench - Run learner-feedback benchmark
		createTool(
			"bench",
			"Run a learner-feedback benchmark against the current teaching policy. Uses explicit feedback and inferred learner-turn signals.",
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
				if (!hasEnoughRealData(realOutcomesRef)) {
					return `Not ready to evolve: need at least ${MIN_REAL_OUTCOMES} learner feedback signals; found ${realOutcomesRef.length}. Keep teaching and collecting explicit or inferred feedback.`;
				}

				const meRun = mapElitesEvolve(basePolicy, topic, 24, 20260401, undefined, undefined, realOutcomesRef);
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
				"Build a retrieval-practice quiz AFTER the learner has gone through the lesson — it is a separate artifact, never auto-paired with the plan. You MUST pass `questions` you author yourself, grounded in the specific material the learner covered — for EVERY topic. Each question needs a real prompt, the correct answer, an explanation, and (for multiple-choice) plausible distractors. There is no template: calling this without 2+ valid questions is rejected with an instruction to author them. Choose concise character limits before generating; the engine clamps unsafe values and records them in quiz.review. Pass adaptive=true for adaptive branching, or reframes=[\"eli5\",\"debug\"] to pre-generate reframes. After calling this tool, do NOT repeat the quiz questions in your response — the interactive quiz UI renders them directly. Simply say 'Quiz ready' and wait.",
				{
					topic: { type: "string", description: "The topic to generate quiz questions for" },
					questions: {
						type: "array",
						minItems: 2,
						description: "Author each question yourself from the real lesson material. Provide 4-10 for a good quiz. When 2+ valid questions are given, they fully replace the generic templates.",
						items: {
							type: "object",
							properties: {
								question: { type: "string", description: "The actual question prompt. For fill_in with multiple blanks, use ___ or {{blank}} as placeholders in the text." },
								type: { type: "string", enum: ["multiple_choice", "short_answer", "true_false", "fill_in", "transfer"], description: "Defaults to multiple_choice when options are given, otherwise short_answer. Use 'fill_in' for blanks: supply 'blanks' array for multi-blank questions (each blank is an ___) or just 'correctAnswer' for a single blank." },
								level: { type: "string", enum: ["recall", "comprehension", "application", "analysis", "transfer"], description: "Bloom level. Aim for a spread from recall to transfer." },
								options: { type: "array", items: { type: "string" }, description: "For multiple_choice: 3-4 plausible options. Include the correct answer; it is added automatically if missing." },
								blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "For fill_in with multiple blanks: one entry per ___ placeholder in the question text. The learner gets an input for each blank." },
								correctAnswer: { type: "string", description: "The correct answer (must match one option for multiple_choice). For multi-blank fill_in, use pipe-separated answers: '2x|2' or supply correctAnswers array." },
								correctAnswers: { type: "array", items: { type: "string" }, description: "Array of correct answers for multi-blank fill_in questions, one per blank in order." },
								explanation: { type: "string", description: "Why the answer is correct — the teaching moment." },
								rubric: { type: "string", description: "For open-ended questions: how to award partial credit. A sensible default is supplied if omitted." },
							},
							required: ["question", "correctAnswer", "explanation"],
							additionalProperties: false,
						},
					},
					adaptive: { type: "boolean", description: "Enable adaptive branching with fallback questions (default false)" },
					reframes: { type: "array", items: { type: "string" }, description: "Reframe modes to pre-generate, e.g. [\"eli5\", \"debug\", \"cooking\"]" },
					limits: {
						type: "object",
						description: "Optional concise output limits chosen for this quiz. Values are clamped to safe ranges.",
						properties: {
							question_chars: { type: "number", description: "Maximum characters per question, clamped to 80-320." },
							answer_chars: { type: "number", description: "Maximum characters per answer, clamped to 80-500." },
							explanation_chars: { type: "number", description: "Maximum characters per explanation, clamped to 80-500." },
							rubric_chars: { type: "number", description: "Maximum characters per rubric, clamped to 60-220." },
							option_chars: { type: "number", description: "Maximum characters per multiple-choice option, clamped to 40-220." },
						},
						additionalProperties: false,
					},
				},
				async (params) => {
					const topic = (params.topic as string) || "";
					if (!topic) throw new Error("Topic required.");

					const reframeModes = Array.isArray(params.reframes)
						? params.reframes.filter((r): r is string => typeof r === "string")
						: undefined;
					const rawLimits = params.limits && typeof params.limits === "object"
						? params.limits as Record<string, unknown>
						: undefined;
					const authored = Array.isArray(params.questions)
						? (params.questions as unknown[])
							.filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
							.map((q) => ({
								question: typeof q.question === "string" ? q.question : "",
								type: typeof q.type === "string" ? q.type as AuthoredQuestion["type"] : undefined,
								level: typeof q.level === "string" ? q.level as AuthoredQuestion["level"] : undefined,
								options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : undefined,
								blanks: Array.isArray(q.blanks)
									? q.blanks
										.filter((blank): blank is Record<string, unknown> => !!blank && typeof blank === "object")
										.map((blank) => ({
											placeholder: typeof blank.placeholder === "string" ? blank.placeholder : undefined,
											hint: typeof blank.hint === "string" ? blank.hint : undefined,
										}))
									: undefined,
								correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : "",
								correctAnswers: Array.isArray(q.correctAnswers) ? q.correctAnswers.filter((a): a is string => typeof a === "string") : undefined,
								explanation: typeof q.explanation === "string" ? q.explanation : "",
								rubric: typeof q.rubric === "string" ? q.rubric : undefined,
							}))
						: [];
					// No templates. The agent must author the questions itself, grounded in the
					// lesson the learner just went through. A quiz is built only AFTER the lesson
					// — it is a separate artifact, never auto-paired with the plan.
					const validAuthored = buildAuthoredQuestions(resolveTopic(topic), authored);
					if (validAuthored.length < 2) {
						throw new Error("Author the quiz yourself. Pass a `questions` array (4-10 items), each grounded in the specific lesson the learner just completed, with a real prompt, correctAnswer, explanation, and (for multiple-choice) plausible distractors. Build the quiz only after the learner has gone through the lesson — it is a separate artifact, not a companion to the plan. No template fallback exists.");
					}
					const quiz = generateQuiz(topic, 42, {
						adaptive: params.adaptive === true,
						reframes: reframeModes,
						authored,
						limits: rawLimits ? {
							questionChars: Number(rawLimits.question_chars),
							answerChars: Number(rawLimits.answer_chars),
							explanationChars: Number(rawLimits.explanation_chars),
							rubricChars: Number(rawLimits.rubric_chars),
							optionChars: Number(rawLimits.option_chars),
						} : undefined,
					});
					const md = quizToMarkdown(quiz);
					const answers = quizAnswerKeyToMarkdown(quiz);

					const saved = await storage.saveLessonPlan(topic, md, { type: "quiz", questionCount: quiz.questions.length });

					return `[artifact://plan/${saved.id}]\n\n${md}\n---\n${answers}\n\n<keating-quiz json=${JSON.stringify(JSON.stringify(quiz))} />`;
				},
				["topic", "questions"],
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

				// Snapshot NodePod VFS before any changes (if active)
				let nodePodSnapId: string | null = null;
				if (isNodePodActive()) {
					try {
						const snap = await nodePodCreateSnapshot(`auto-improve-${Date.now()}`);
						nodePodSnapId = snap.id;
					} catch {
						// ignore snapshot failures
					}
				}

				const basePolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const learnerState = await storage.getLearnerState();
				const realOutcomes = extractBrowserOutcomes(learnerState.feedbackHistory, learnerState.topicsExplored);
				if (!hasEnoughRealData(realOutcomes)) {
					return `Not ready to auto-improve: need at least ${MIN_REAL_OUTCOMES} learner feedback signals; found ${realOutcomes.length}.`;
				}

				// Step 1: Baseline benchmark
				const baseline = runBenchmarkSuite(basePolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const baselineReport = benchmarkToMarkdown(baseline);
				await storage.saveBenchmark(baseline.overallScore, baselineReport, topic);

				// Step 2: Evolve policy via MAP-Elites
				const meRun = mapElitesEvolve(basePolicy, topic, 24, 20260401, undefined, undefined, realOutcomes);
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

				const nodePodNote = nodePodSnapId
					? `\n**NodePod snapshot:** ${nodePodSnapId} (created before improvement, can restore if needed via \`source_restore\`)`
					: "";

				return `[artifact://evolution/${saved.id}] [artifact://prompt-evolution/${promptSaved.id}] [artifact://benchmark/${benchmarkSaved.id}] [artifact://improvement/${improvementSaved.id}]\n\nSelf-improvement complete.

**Benchmark:** ${baseline.overallScore.toFixed(2)} → ${after.overallScore.toFixed(2)} (${verdict})

**Policy Evolution (MAP-Elites):**
- Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length} candidates
- Filled cells: ${meRun.filledCellCount}/${meRun.totalCells}
- Best policy: analogyDensity=${evolvedPolicy.analogyDensity.toFixed(3)} socraticRatio=${evolvedPolicy.socraticRatio.toFixed(3)} formalism=${evolvedPolicy.formalism.toFixed(3)}

**Prompt Evolution (PROSPER):**
- Baseline: ${promptRun.baselineScore.toFixed(2)} → Best: ${promptRun.best.score.toFixed(2)}
- Accepted: ${promptRun.acceptedCandidates.length}/${promptRun.exploredCandidates.length} candidates${nodePodNote}

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
			"Ask the learner one or more questions as an interactive form (choices, multi-select, free text, fill-in-the-blank, classification table, or matching worksheet). The learner fills it in and their answers are sent back automatically. Use to check understanding, gather goals/preferences, or branch the lesson. Pass `questions` for a multi-field form, or the single-question fields for a quick one-off.",
			{
				question: { type: "string", description: "A single question to ask (use `questions` for a multi-field form). For fill-in-the-blank, use ___ or {{blank}} as placeholders." },
				choices: { type: "array", items: { type: "string" }, description: "Optional answer choices. For classification questions, these are categories/slots; for matching questions, these are the answer-bank entries." },
				items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
				multi_select: { type: "boolean", description: "Allow selecting multiple choices for the single question (default false)" },
				allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices, false if choices provided)" },
				type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type. 'choice' = multiple choice, 'text' = free text, 'blanks' = fill-in-the-blank, 'classification' = classify each item into one category, 'matching' = match each item to one answer-bank entry." },
				blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "Define blanks for fill-in-the-blank questions. Each entry corresponds to one ___ placeholder in the question text." },
				require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
				unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
				correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order. Enables red/green feedback after submission." },
				item_label: { type: "string", description: "Column label for classification items (default 'Item')." },
				choice_label: { type: "string", description: "Column label for classification choices or matching answer bank (default 'Choice')." },
				reason_label: { type: "string", description: "Column label for classification justifications (default 'Justification')." },
				hint: { type: "string", description: "Optional hint shown below the single question" },
				intro: { type: "string", description: "Optional intro text shown above the form" },
				questions: {
					type: "array",
					description: "Multiple questions to ask at once, each with its own header and input format",
					items: {
						type: "object",
						properties: {
							header: { type: "string", description: "Short label/chip shown above the question (e.g. 'Goal', 'Approach')" },
							question: { type: "string", description: "The question text. For blanks type, use ___ or {{blank}} as placeholders" },
							choices: { type: "array", items: { type: "string" }, description: "Optional answer choices. For classification questions, these are categories/slots; for matching questions, answer-bank entries." },
							items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
							multi_select: { type: "boolean", description: "Allow selecting multiple choices (default false)" },
							allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices)" },
							type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type: choice, text, blanks, classification, or matching" },
							blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "Blank definitions for fill-in-the-blank, one per ___ placeholder" },
							require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
							unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
							correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order." },
							item_label: { type: "string", description: "Column label for classification items." },
							choice_label: { type: "string", description: "Column label for classification choices or matching answer bank." },
							reason_label: { type: "string", description: "Column label for classification justifications." },
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
					type?: string;
					choices?: string[];
					items?: string[];
					multi_select: boolean;
					allow_text: boolean;
					require_reasons?: boolean;
					unique_matches?: boolean;
					correct_matches?: string[];
					item_label?: string;
					choice_label?: string;
					reason_label?: string;
					hint?: string;
				};

				const buildField = (raw: Record<string, unknown>): FormField | null => {
					const question = String(raw.question ?? "");
					if (!question) return null;
					const choices = toStringArray(raw.choices);
					const items = toStringArray(raw.items);
					const correctMatches = toStringArray(raw.correct_matches);
					const hasChoices = !!choices && choices.length > 0;
					const type = typeof raw.type === "string" ? raw.type : undefined;
					if ((type === "classification" || type === "matching") && (!items || items.length === 0 || !hasChoices)) {
						return null;
					}
					return {
						header: raw.header ? String(raw.header) : undefined,
						question,
						type,
						choices: hasChoices ? choices : undefined,
						items: items && items.length > 0 ? items : undefined,
						multi_select: raw.multi_select === true,
						allow_text:
							type === "classification" || type === "matching"
								? false
								: typeof raw.allow_text === "boolean" ? raw.allow_text : !hasChoices,
						require_reasons:
							typeof raw.require_reasons === "boolean" ? raw.require_reasons : undefined,
						unique_matches:
							typeof raw.unique_matches === "boolean" ? raw.unique_matches : undefined,
						correct_matches:
							correctMatches && correctMatches.length > 0 ? correctMatches : undefined,
						item_label: raw.item_label ? String(raw.item_label) : undefined,
						choice_label: raw.choice_label ? String(raw.choice_label) : undefined,
						reason_label: raw.reason_label ? String(raw.reason_label) : undefined,
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

		// source_edit - Apply a search/replace edit inside the NodePod VFS
		createTool(
			"source_edit",
			"Apply a precise source code edit using search/replace blocks inside the NodePod sandbox. The file path must be absolute within the sandbox (e.g. /workspace/src/core/policy.ts). Always include enough surrounding context (5-10 lines) in the search block to make it unique. Creates a pre-edit snapshot automatically if none exists for this session.",
			{
				file: { type: "string", description: "Absolute path in NodePod VFS (e.g. /workspace/src/core/policy.ts)" },
				search: { type: "string", description: "Exact code block to search for. Must be unique in the file. Include surrounding lines for safety." },
				replace: { type: "string", description: "Replacement code block." },
				reason: { type: "string", description: "Short explanation of why this change is being made." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active. Boot it first via the NodePod Visualizer or wait for it to initialize.";
				}
				const file = String(params.file ?? "");
				const search = String(params.search ?? "");
				const replace = String(params.replace ?? "");
				const reason = String(params.reason ?? "agent edit");

				if (!file || !search) {
					return "Error: file and search are required.";
				}

				const result = await nodePodApplyEdit({ file, search, replace, reason });
				if (!result.success) {
					return `# Edit Failed: ${file}\n\n${result.message}`;
				}

				// Auto-transpile .ts → .js so require() works in NodePod
				let jsCounterpart = "";
				if (file.endsWith(".ts")) {
					try {
						jsCounterpart = await writeJsCounterpart(file);
					} catch {
						// transpilation failed — agent can try manually
					}
				}

				return [
					`# Edit Applied: ${file}`,
					"",
					result.message,
					result.diff ? `\n**Diff:** ${result.diff.linesRemoved} removed, ${result.diff.linesAdded} added, Δ${result.diff.charDelta >= 0 ? "+" : ""}${result.diff.charDelta} chars` : "",
					jsCounterpart ? `\n**Transpiled:** ${jsCounterpart} (auto-generated for require())` : "",
					"",
					"Next steps:",
					"- Call `validate_source_edit` with a test script to confirm the change works.",
					"- Call `source_diff` to review all changes.",
				].join("\n");
			}
		),

		// source_diff - Show differences between baseline and current VFS
		createTool(
			"source_diff",
			"Show all files in the NodePod sandbox that differ from their baseline (as bundled at boot). Use after source_edit to review what changed.",
			{},
			async () => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const changed = await nodePodChangedFiles();
				if (changed.length === 0) {
					return "No changes from baseline. All files are at their original state.";
				}
				const lines = ["# Changed Files", ""];
				for (const entry of changed) {
					const diff = await nodePodDiffFile(entry.file);
					lines.push(`## ${entry.file}`);
					lines.push(`Δ ${entry.charDelta >= 0 ? "+" : ""}${entry.charDelta} chars`);
					if (diff?.baseline && diff.current) {
						// Simple diff: show last 5 lines of baseline vs current context
						lines.push("```diff");
						lines.push("// Current state (first 40 lines):");
						lines.push(diff.current.split("\n").slice(0, 40).join("\n"));
						lines.push("```");
					}
					lines.push("");
				}
				return lines.join("\n");
			}
		),

		// run_script - Execute a Node.js script inside the NodePod sandbox
		createTool(
			"run_script",
			"Write and execute a Node.js script inside the NodePod sandbox. Use this to test edited modules, run small experiments, or validate logic changes. The script runs in the /workspace directory and can require any module in the VFS.",
			{
				code: { type: "string", description: "JavaScript code to execute. Can use require() for built-in modules or files in the VFS." },
				filename: { type: "string", description: "Optional filename for the temp script (default: /workspace/_agent_script.js)" },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const code = String(params.code ?? "");
				const filename = String(params.filename ?? "/workspace/_agent_script.js");
				if (!code.trim()) {
					return "Error: code is required.";
				}
				const session = await nodePodRunScript(code, filename);
				return [
					"# Script Result",
					"",
					`- exit code: ${session.exitCode ?? "unknown"}`,
					`- duration: ${session.durationMs ?? "?"}ms`,
					"",
					session.stdout ? `## stdout\n\`\`\`\n${session.stdout}\n\`\`\`` : "",
					session.stderr ? `## stderr\n\`\`\`\n${session.stderr}\n\`\`` : "",
				].filter(Boolean).join("\n");
			}
		),

		// validate_source_edit - Run a test to confirm an edit is correct
		createTool(
			"validate_source_edit",
			"Validate a source edit by running a test script inside the NodePod sandbox. If the test fails, the edit is automatically rolled back to the pre-edit snapshot. Use this AFTER every source_edit to confirm the change works.",
			{
				file: { type: "string", description: "The .ts file that was edited (e.g. /workspace/src/core/policy.ts)" },
				testScript: { type: "string", description: "JavaScript test code. Should import the edited module (use .js extension) and assert expected behavior. Example: `const { clampPolicy } = require('/workspace/src/core/policy.js'); console.assert(clampPolicy({...}).analogyDensity === 0.5);`" },
				autoRollback: { type: "boolean", description: "If true (default), automatically restore the pre-edit snapshot on test failure." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const file = String(params.file ?? "");
				const testScript = String(params.testScript ?? "");
				const autoRollback = params.autoRollback !== false;

				if (!file || !testScript) {
					return "Error: file and testScript are required.";
				}

				const result = await nodePodValidateEdit(file, testScript, { autoRollback });

				const lines = [
					`# Validation Result: ${result.passed ? "PASSED" : "FAILED"}`,
					"",
					`- File: ${file}`,
					`- Exit code: ${result.exitCode ?? "unknown"}`,
					`- Duration: ${result.durationMs}ms`,
					`- Rollback: ${result.restored ? "performed" : "not needed / unavailable"}`,
					"",
					"## Test Output",
					result.stdout ? `\`\`\`\n${result.stdout}\n\`\`\`` : "(no stdout)",
					result.stderr ? `\`\`\`\n${result.stderr}\n\`\`\`` : "",
				];
				return lines.filter(Boolean).join("\n");
			}
		),

		// source_snapshot - Capture the current NodePod VFS state for rollback
		createTool(
			"source_snapshot",
			"Create a snapshot of the current NodePod sandbox state. Use BEFORE making source edits so you can restore if the change causes a regression. Returns a snapshot ID you can pass to source_restore.",
			{
				label: { type: "string", description: "Human-readable label for the snapshot (e.g. before-policy-tweak)" },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const label = String(params.label ?? "manual");
				const snap = await nodePodCreateSnapshot(label);
				return [
					"# Snapshot Created",
					"",
					`- id: ${snap.id}`,
					`- instanceId: ${snap.instanceId}`,
					`- createdAt: ${snap.createdAt}`,
					"",
					"Restore later with `source_restore` and `id` set to this snapshot id.",
				].join("\n");
			}
		),

		// source_restore - Rollback NodePod VFS to a previous snapshot
		createTool(
			"source_restore",
			"Restore the NodePod sandbox to a previous snapshot. Use this when source edits caused a regression and you want to undo them. Pass either an `id` from source_snapshot or full snapshot `data`.",
			{
				id: { type: "string", description: "Snapshot id returned by source_snapshot." },
				data: { type: "object", description: "Full snapshot data object, if available." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const id = typeof params.id === "string" ? params.id : "";
				let data = params.data;
				if (!data && id) {
					const found = await nodePodFindSnapshot(id);
					data = found?.data;
				}
				if (!data) {
					return "Error: snapshot id or data is required. Pass `id` from source_snapshot, or a full snapshot object.";
				}
				try {
					await nodePodRestoreSnapshot(data);
					return `# Snapshot Restored\n\nNodePod sandbox rolled back${id ? ` to ${id}` : ""}.`;
				} catch (e) {
					return `# Restore Failed\n\n${e instanceof Error ? e.message : String(e)}`;
				}
			}
		),
	];

	if (options.speech?.settings.enabled) {
		tools.push(createSpeechTool(options.speech.settings, options.speech.getApiKey));
	}

	return tools;
}


function slugifyDeckTitle(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function draftDeckCardId(deckSlug: string, index: number): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return `${deckSlug}-${crypto.randomUUID()}`;
	}
	return `${deckSlug}-${Date.now()}-${index + 1}`;
}
// Internal-only exports so unit tests can drive the helpers without needing
// to instantiate the full agent tool set.
export {
	buildManimScene as __test_buildManimScene,
	buildHyperframesComposition as __test_buildHyperframesComposition,
	parseStoryboardDurationSeconds as __test_parseStoryboardDurationSeconds,
	storyboardTitle as __test_storyboardTitle,
};
