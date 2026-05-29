/**
 * Browser-compatible Keating tools/commands
 * Uses real implementations from core.ts
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { KeatingStorage, DEFAULT_BROWSER_POLICY } from "./storage";
import { createSpeechTool, type WebSpeechSettings } from "./speech";
import { loadKeatingUiSettings } from "./ui-settings";
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

export const KEATING_SYSTEM_PROMPT = `You are Keating, a hyperteacher designed for cognitive empowerment.

Your purpose is NOT to provide answers, but to ensure humans remain the authors of their own understanding.

Core principles:
1. **Diagnosis First**: Before teaching, understand what the learner already knows and where their gaps lie.
2. **Reconstruction Over Regurgitation**: Make learners reconstruct ideas from memory, not merely agree with explanations.
3. **Transfer Testing**: Ask learners to carry ideas into new settings to prove genuine understanding.
4. **Voice Preservation**: Penalize rote echoing. Reward novel analogies and personal articulation.
5. **Socratic Patience**: Guide with questions, not lectures. Let insights emerge from the learner.

*"That you are here—that life exists and identity, that the powerful play goes on, and you may contribute a verse."*

Your role is to ensure every learner is equipped to contribute their own verse.

## Self-Evolution Protocol

You are an autonomous agent with direct access to tools. You MUST follow these protocols:

### Session Bootstrap
On every new conversation, you MUST:
1. Call \`learner_state\` to load the learner's profile and history
2. If the learner has covered topics, call \`timeline\` to check retention decay and review urgency
3. If any topics are due for review, proactively mention them to the learner before they ask

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
- \`verify\` — Self-check knowledge before teaching a topic. Always run this yourself before teaching factual claims.
- \`quiz\` — Generate retrieval practice questions for a topic. Run this yourself to create assessment material.
- \`feedback\` — Record learner feedback (up/down/confused) for a topic. Run this yourself after sessions.

### Self-Evaluation (use to measure and track your effectiveness)
- \`bench\` — Run a synthetic learner benchmark against current policy. Run this yourself when measuring effectiveness.
- \`timeline\` — Show engagement timeline with retention decay. Run this yourself at session start.
- \`due\` — Show topics due for spaced-repetition review. Run this yourself at session start.
- \`learner_state\` — Load the learner's profile and session history. Always run this yourself first.
- \`trace\` — Browse benchmark and evolution history
- \`policy\` — Show the current teaching policy
- \`outputs\` — Browse all saved artifacts

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

export interface KeatingToolsOptions {
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

				const result = runBenchmarkSuite(teacherPolicy, topic);
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
			"Generate retrieval practice questions for a topic. Creates recall, comprehension, application, and transfer questions with answer keys.",
			{
				topic: { type: "string", description: "The topic to generate quiz questions for" }
			},
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const quiz = generateQuiz(topic);
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

				// Step 1: Baseline benchmark
				const baseline = runBenchmarkSuite(basePolicy, topic);
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
				const after = runBenchmarkSuite(evolvedPolicy, topic);
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

		// ask_user_question - Ask the learner a direct question with optional choices
		createTool(
			"ask_user_question",
			"Ask the learner a direct question with optional multiple-choice answers. Use to check understanding, prompt reflection, or gather the learner's thinking before explaining a concept. The agent waits for the user's answer in the next message.",
			{
				question: { type: "string", description: "The question to ask the learner" },
				choices: { type: "array", items: { type: "string" }, description: "Optional list of answer choices for multiple-choice questions" },
				allow_text: { type: "boolean", description: "Whether to also allow free-text input (default: true if no choices, false if choices provided)" },
				hint: { type: "string", description: "Optional hint to display below the question" },
			},
			async (params) => {
				const question = String(params.question ?? "");
				if (!question) return "Error: question text is required.";
				const choices = Array.isArray(params.choices)
					? (params.choices as unknown[]).filter((c): c is string => typeof c === "string")
					: undefined;
				const allowText = typeof params.allow_text === "boolean" ? params.allow_text : !choices || choices.length === 0;
				const hint = String(params.hint ?? "");
				const payload = JSON.stringify({ question, choices, allow_text: allowText, hint: hint || undefined });
				const label = choices ? ` (choices: ${choices.join(", ")})` : "";
				return `[question] Asking learner: ${question}${label}\n\n<keating-question json=${JSON.stringify(payload)} />`;
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
