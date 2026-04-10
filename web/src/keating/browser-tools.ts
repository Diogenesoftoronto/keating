/**
 * Browser-compatible Keating tools/commands
 * Uses real implementations from core.ts
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { KeatingStorage, DEFAULT_BROWSER_POLICY } from "./storage";
import {
	buildLessonPlan,
	lessonPlanToMarkdown,
	buildConceptMap,
	runBenchmarkSuite,
	benchmarkToMarkdown,
	evolvePolicy,
	evolutionToMarkdown,
	DEFAULT_POLICY,
	diagnoseBenchmark,
	evaluatePrompt,
	resolveTopic,
	type TeacherPolicy,
	type BenchmarkResult,
	type EvolutionRun,
} from "./core";

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

## Available Commands
Use these slash commands to help learners:

- \`/plan <topic>\` - Generate a structured lesson plan for a topic
- \`/map <topic>\` - Create a visual Mermaid concept map
- \`/animate <topic>\` - Generate an animation storyboard
- \`/verify <topic>\` - Create a fact-checking checklist
- \`/bench\` - Run a synthetic learner benchmark
- \`/evolve\` - Improve the teaching policy through evolution
- \`/feedback <up|down|confused> [topic]\` - Record learning feedback
- \`/policy\` - Show the current teaching policy
- \`/outputs\` - Browse all saved artifacts
- \`/state\` - Show your learner profile
- \`/improve\` - Get improvement suggestions from benchmark diagnosis
- \`/trace\` - Browse benchmark and evolution traces
- \`/prompt-eval\` - Evaluate a prompt template for teaching effectiveness
`;

// Helper function to create tools with proper schema
function createSimpleTool(
	name: string,
	description: string,
	execute: (params: Record<string, unknown>) => Promise<string>
): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true,
		},
		execute: async (params: unknown) => {
			const result = await execute(params as Record<string, unknown>);
			return { success: true, message: result };
		},
	} as unknown as AgentTool;
}

export async function createKeatingTools(storage: KeatingStorage): Promise<AgentTool[]> {
	return [
		// /plan - Generate real lesson plan
		createSimpleTool(
			"plan",
			"Generate a structured lesson plan for a topic. Usage: /plan <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /plan <topic>";
				}

				const policy = await storage.getActivePolicy();
				const teacherPolicy: TeacherPolicy = policy
					? {
							name: policy.id,
							analogyDensity: 0.6,
							socraticRatio: 0.55,
							formalism: 0.5,
							retrievalPractice: 0.7,
							exerciseCount: 4,
							diagramBias: 0.45,
							reflectionBias: 0.5,
							interdisciplinaryBias: 0.4,
							challengeRate: 0.35,
						}
					: DEFAULT_POLICY;

				const plan = buildLessonPlan(topic, teacherPolicy);
				const markdown = lessonPlanToMarkdown(plan);

				await storage.saveLessonPlan(topic, markdown, {
					domain: plan.topic.domain,
					phaseCount: plan.phases.length,
				});

				return `📚 Lesson plan created for "${topic}"\n\n${markdown}\n\n[Saved to browser storage]`;
			}
		),

		// /map - Generate real concept map
		createSimpleTool(
			"map",
			"Generate a Mermaid concept map for a topic. Usage: /map <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /map <topic>";
				}

				const mapContent = buildConceptMap(topic);
				await storage.saveLessonMap(topic, mapContent);

				return `🗺️ Concept map for "${topic}"\n\n\`\`\`mermaid\n${mapContent}\n\`\`\`\n\n[Saved to browser storage]`;
			}
		),

		// /animate - Generate animation storyboard
		createSimpleTool(
			"animate",
			"Generate an animation storyboard for a topic. Usage: /animate <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /animate <topic>";
				}

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

				const scene = `// Scene: ${resolved.title}
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

				const manifest = JSON.stringify(
					{
						topic: resolved.title,
						slug: resolved.slug,
						domain: resolved.domain,
						scenes: ["intro", "intuition", "formal", "misconceptions", "examples", "transfer"],
						duration: 35,
						generatedAt: new Date().toISOString(),
					},
					null,
					2
				);

				await storage.saveAnimation(topic, storyboard, scene, manifest);

				return `🎬 Animation storyboard for "${topic}"\n\n${storyboard}\n\n[Saved to browser storage]`;
			}
		),

		// /verify - Generate verification checklist
		createSimpleTool(
			"verify",
			"Generate a fact-checking checklist for a topic. Usage: /verify <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /verify <topic>";
				}

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
- [ ] Recent developments included

---
Complete this checklist before teaching ${resolved.title}.
`;

				await storage.saveVerification(topic, checklist);

				return `✅ Verification checklist for "${topic}"\n\n${checklist}\n\n[Saved to browser storage]`;
			}
		),

		// /bench - Run real teaching benchmark
		createSimpleTool(
			"bench",
			"Run a synthetic learner benchmark. Usage: /bench [topic]",
			async (params) => {
				const topic = params.topic as string | undefined;
				const policy = await storage.getActivePolicy();
				const teacherPolicy: TeacherPolicy = policy
					? {
							name: policy.id,
							analogyDensity: 0.6,
							socraticRatio: 0.55,
							formalism: 0.5,
							retrievalPractice: 0.7,
							exerciseCount: 4,
							diagramBias: 0.45,
							reflectionBias: 0.5,
							interdisciplinaryBias: 0.4,
							challengeRate: 0.35,
						}
					: DEFAULT_POLICY;

				const result = runBenchmarkSuite(teacherPolicy, topic);
				const report = benchmarkToMarkdown(result);

				await storage.saveBenchmark(result.overallScore, report, topic, JSON.stringify(result.trace, null, 2));

				return `📊 Benchmark complete!\n\n**Overall Score:** ${result.overallScore.toFixed(2)}/100\n\n${report}`;
			}
		),

		// /evolve - Evolve teaching policy
		createSimpleTool(
			"evolve",
			"Evolve and improve the teaching policy. Usage: /evolve [topic]",
			async (params) => {
				const topic = params.topic as string | undefined;
				const policy = await storage.getActivePolicy();
				const basePolicy: TeacherPolicy = policy
					? {
							name: policy.id,
							analogyDensity: 0.6,
							socraticRatio: 0.55,
							formalism: 0.5,
							retrievalPractice: 0.7,
							exerciseCount: 4,
							diagramBias: 0.45,
							reflectionBias: 0.5,
							interdisciplinaryBias: 0.4,
							challengeRate: 0.35,
						}
					: DEFAULT_POLICY;

				const run = evolvePolicy(basePolicy, topic);
				const report = evolutionToMarkdown(run);

				// Save evolved policy
				await storage.savePolicy(
					`# Evolved Teaching Policy\n\n` +
						`Generated: ${new Date().toISOString()}\n` +
						`Score: ${run.best.overallScore.toFixed(2)}/100\n\n` +
						`## Parameters\n` +
						`- analogyDensity: ${run.bestPolicy.analogyDensity.toFixed(3)}\n` +
						`- socraticRatio: ${run.bestPolicy.socraticRatio.toFixed(3)}\n` +
						`- formalism: ${run.bestPolicy.formalism.toFixed(3)}\n` +
						`- exerciseCount: ${run.bestPolicy.exerciseCount}\n` +
						`- diagramBias: ${run.bestPolicy.diagramBias.toFixed(3)}\n`,
					true
				);

				await storage.saveEvolution(
					run.best.overallScore,
					JSON.stringify(run.bestPolicy),
					report,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				return `🧬 Policy evolved!\n\n**Best Score:** ${run.best.overallScore.toFixed(2)}/100\n**Baseline:** ${run.baseline.overallScore.toFixed(2)}/100\n**Accepted:** ${run.acceptedCandidates.length}/${run.exploredCandidates.length} candidates\n\n${report}`;
			}
		),

		// /feedback - Record feedback
		createSimpleTool(
			"feedback",
			"Record learning feedback. Usage: /feedback <up|down|confused> [topic]",
			async (params) => {
				const signalParam = (params.signal as string) || "";
				const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
					up: "thumbs-up",
					down: "thumbs-down",
					confused: "confused",
				};
				const signal = signalMap[signalParam];
				if (!signal) {
					return "Invalid signal. Use: /feedback <up|down|confused> [topic]";
				}

				const topic = (params.topic as string) || "general";
				await storage.recordFeedback(topic, signal);

				const emoji = signal === "thumbs-up" ? "👍" : signal === "thumbs-down" ? "👎" : "🤔";
				return `${emoji} Feedback recorded: ${signal} for "${topic}"`;
			}
		),

		// /policy - Show current policy
		createSimpleTool(
			"policy",
			"Show the current teaching policy. Usage: /policy",
			async () => {
				const policy = await storage.getActivePolicy();
				const content = policy?.content || DEFAULT_BROWSER_POLICY;

				return `📋 Current Teaching Policy\n\n\`\`\`markdown\n${content}\n\`\`\``;
			}
		),

		// /outputs - Browse artifacts
		createSimpleTool(
			"outputs",
			"Browse all saved Keating artifacts. Usage: /outputs",
			async () => {
				const artifacts = await storage.listArtifacts();

				if (artifacts.length === 0) {
					return "No artifacts yet. Use /plan, /map, /animate, /verify, /bench, or /evolve first.";
				}

				const list = artifacts
					.slice(0, 20)
					.map((a) => `- ${a.label} (${new Date(a.createdAt).toLocaleDateString()})`)
					.join("\n");

				return `📚 Keating Artifacts (${artifacts.length} total)\n\n${list}`;
			}
		),

		// /state - Show learner state
		createSimpleTool(
			"state",
			"Show your learner profile and progress. Usage: /state",
			async () => {
				const state = await storage.getLearnerState();

				const upCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-up").length;
				const downCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-down").length;
				const confusedCount = state.feedbackHistory.filter((f) => f.signal === "confused").length;

				return `👤 Learner Profile

**Topics Explored:** ${state.topicsExplored.length}
${state.topicsExplored.slice(-10).map((t) => `- ${t}`).join("\n") || "None yet"}

**Feedback History:**
- 👍 ${upCount} positive
- 👎 ${downCount} negative
- 🤔 ${confusedCount} confused

${state.lastSessionAt ? `**Last Session:** ${new Date(state.lastSessionAt).toLocaleString()}` : "**First Session:** Welcome to Keating!"}`;
			}
		),

		// /improve - Get improvement suggestions
		createSimpleTool(
			"improve",
			"Get improvement suggestions from benchmark diagnosis. Usage: /improve",
			async () => {
				const policy = await storage.getActivePolicy();
				const teacherPolicy: TeacherPolicy = policy
					? {
							name: policy.id,
							analogyDensity: 0.6,
							socraticRatio: 0.55,
							formalism: 0.5,
							retrievalPractice: 0.7,
							exerciseCount: 4,
							diagramBias: 0.45,
							reflectionBias: 0.5,
							interdisciplinaryBias: 0.4,
							challengeRate: 0.35,
						}
					: DEFAULT_POLICY;

				const benchmark = runBenchmarkSuite(teacherPolicy);
				const suggestions = diagnoseBenchmark(benchmark);

				if (suggestions.length === 0) {
					return `✅ Benchmark looks healthy!\n\nOverall score: ${benchmark.overallScore.toFixed(2)}/100\n\nNo major improvement areas identified.`;
				}

				const suggestionList = suggestions
					.map((s, i) => `### ${i + 1}. ${s.area}\n- **Metric**: ${s.metric} = ${s.value.toFixed(2)}\n- **Suggestion**: ${s.suggestion}`)
					.join("\n\n");

				return `🔧 Improvement Suggestions\n\nBenchmark score: ${benchmark.overallScore.toFixed(2)}/100\n\n${suggestionList}`;
			}
		),

		// /trace - Browse benchmark/evolution traces
		createSimpleTool(
			"trace",
			"Browse benchmark and evolution traces. Usage: /trace [type]",
			async (params) => {
				const type = (params.type as string) || "all";

				const benchmarks = await storage.getBenchmarks();
				const evolutions = await storage.getEvolutions();

				if (benchmarks.length === 0 && evolutions.length === 0) {
					return "No traces yet. Use /bench or /evolve first.";
				}

				const lines: string[] = ["📊 Keating Traces\n"];

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

		// /prompt-eval - Evaluate prompt template
		createSimpleTool(
			"prompt-eval",
			"Evaluate a prompt template for teaching effectiveness. Usage: /prompt-eval <prompt>",
			async (params) => {
				const promptContent = (params.prompt as string) || "";
				if (!promptContent) {
					return "Please provide a prompt to evaluate. Usage: /prompt-eval <prompt>";
				}

				const result = evaluatePrompt(promptContent);

				const objectiveList = Object.entries(result.objectives)
					.map(([k, v]) => `- ${k}: ${v.toFixed(2)}`)
					.join("\n");

				const feedbackSection =
					result.feedback.length > 0
						? `\n## Feedback\n${result.feedback.map((f) => `- ${f}`).join("\n")}`
						: "\n## Feedback\n- No major issues detected.";

				return `📝 Prompt Evaluation\n\n**Score:** ${result.score.toFixed(2)}/100\n\n## Objectives\n${objectiveList}${feedbackSection}`;
			}
		),
	];
}
