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
	evolvePolicy as _evolvePolicyLegacy,
	evolutionToMarkdown,
	mapElitesEvolve,
	mapElitesToMarkdown,
	mapElitesToEvolutionRun,
	DEFAULT_POLICY,
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
	type TeacherPolicy,
	type BenchmarkResult,
	type EvolutionRun,
	type CoveredTopic,
	type ImprovementProposal,
	type ImprovementArchive,
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
		// plan - Generate lesson plan
		createSimpleTool(
			"plan",
			"Generate a structured lesson plan for a topic, adapted to the current teaching policy. Use before teaching any topic to structure your approach.",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Topic required. Pass a topic parameter.";
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

				return markdown;
			}
		),

		// map - Generate concept map
		createSimpleTool(
			"map",
			"Generate a Mermaid concept map for a topic. Use to visualize knowledge structure before or during teaching.",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) return "Topic required.";

				const mapContent = buildConceptMap(topic);
				await storage.saveLessonMap(topic, mapContent);

				return `\`\`\`mermaid\n${mapContent}\n\`\`\``;
			}
		),

		// animate - Generate animation storyboard
		createSimpleTool(
			"animate",
			"Generate an animation storyboard for a topic. Use to create visual teaching materials.",
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

				return storyboard;
			}
		),

		// verify - Self-check knowledge before teaching
		createSimpleTool(
			"verify",
			"Generate a fact-checking checklist for a topic. Always use this BEFORE teaching to self-verify your knowledge.",
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

				await storage.saveVerification(topic, checklist);

				return checklist;
			}
		),

		// bench - Run synthetic learner benchmark
		createSimpleTool(
			"bench",
			"Run a synthetic learner benchmark against the current teaching policy. Use to measure teaching effectiveness and identify weaknesses.",
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

				return `**Overall Score:** ${result.overallScore.toFixed(2)}/100\n\n${report}`;
			}
		),

		// evolve - Evolve teaching policy via MAP-Elites
		createSimpleTool(
			"evolve",
			"Evolve the teaching policy using MAP-Elites algorithm. Use to search for better policy parameters when benchmarks show room for improvement.",
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

				const meRun = mapElitesEvolve(basePolicy, topic);
				const run = mapElitesToEvolutionRun(meRun);
				const report = mapElitesToMarkdown(meRun);

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

				return `**Policy evolved (MAP-Elites)**\n\nBest: ${run.best.overallScore.toFixed(2)}/100 | Baseline: ${run.baseline.overallScore.toFixed(2)}/100 | Filled cells: ${meRun.filledCellCount}/${meRun.totalCells} | Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length}\n\n${report}`;
			}
		),

		// feedback - Record learner feedback
		createSimpleTool(
			"feedback",
			"Record a learner feedback signal for a topic. Call this after teaching to track session outcomes. signal must be 'up', 'down', or 'confused'.",
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
		createSimpleTool(
			"policy",
			"Show the current active teaching policy parameters.",
			async () => {
				const policy = await storage.getActivePolicy();
				const content = policy?.content || DEFAULT_BROWSER_POLICY;

				return `\`\`\`markdown\n${content}\n\`\`\``;
			}
		),

		// outputs - Browse artifacts
		createSimpleTool(
			"outputs",
			"Browse all saved Keating artifacts (plans, maps, benchmarks, evolutions, etc).",
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
		createSimpleTool(
			"learner_state",
			"Load the learner's profile, session history, and topic progress. ALWAYS call this at the start of every new conversation.",
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
		createSimpleTool(
			"auto_improve",
			"Run the full autonomous self-improvement loop: benchmark current policy → evolve policy via MAP-Elites → evolve prompt template → record improvement. Use this instead of calling bench/evolve/improve separately. Triggers automatically on first session and periodically thereafter.",
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

				// Step 1: Baseline benchmark
				const baseline = runBenchmarkSuite(basePolicy, topic);
				const baselineReport = benchmarkToMarkdown(baseline);
				await storage.saveBenchmark(baseline.overallScore, baselineReport, topic);

				// Step 2: Evolve policy via MAP-Elites
				const meRun = mapElitesEvolve(basePolicy, topic);
				const run = mapElitesToEvolutionRun(meRun);
				const evolveReport = mapElitesToMarkdown(meRun);

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
					evolveReport,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				// Step 3: Evolve prompt template
				const promptRun = evolvePromptTemplate(KEATING_SYSTEM_PROMPT, "learn", 4);
				const promptReport = promptEvolutionToMarkdown(promptRun);
				await storage.savePromptEvolution("learn", {
					bestScore: promptRun.best.score,
					bestPrompt: promptRun.best.prompt,
					report: promptReport,
				});

				// Step 4: Post-evolution benchmark
				const evolvedPolicy = run.bestPolicy;
				const after = runBenchmarkSuite(evolvedPolicy, topic);
				const afterReport = benchmarkToMarkdown(after);
				await storage.saveBenchmark(after.overallScore, afterReport, topic);

				// Step 5: Record improvement
				const delta = after.overallScore - baseline.overallScore;
				const proposalId = `auto-${Date.now().toString(36)}`;
				await storage.saveImprovementAttempt({
					proposalId,
					baselineScore: baseline.overallScore,
					afterScore: after.overallScore,
					scoreDelta: delta,
					accepted: delta > 0,
					targets: diagnoseBenchmark(baseline).map((s) => s.area).join(","),
					hypothesis: `Auto-improve: evolved policy (${run.acceptedCandidates.length} accepted) + evolved prompt (${promptRun.acceptedCandidates.length} accepted)`,
				});

				const verdict = delta > 0
					? `IMPROVED by +${delta.toFixed(2)}`
					: delta < -0.5
						? `REGRESSED by ${delta.toFixed(2)} (evolved policy reverted)`
						: `NO SIGNIFICANT CHANGE (Δ${delta.toFixed(2)})`;

				return `Self-improvement complete.

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
		createSimpleTool(
			"improve",
			"Generate a targeted improvement proposal by diagnosing benchmark weaknesses. Returns specific areas to improve and suggestions. Pass action='history' to view past improvement attempts.",
			async (params) => {
				const sub = (params.action as string) || "";

				if (sub === "history") {
					const archive = await storage.getImprovementArchive();
					return improvementArchiveToMarkdown(archive as ImprovementArchive);
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

				const benchmark = runBenchmarkSuite(teacherPolicy);
				const proposal = generateImprovementProposal(benchmark);
				const report = proposalToMarkdown(proposal);

				return report;
			}
		),

		// trace - Browse benchmark/evolution traces
		createSimpleTool(
			"trace",
			"Browse benchmark and evolution history. Pass type='benchmark' or type='evolution' to filter.",
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
		createSimpleTool(
			"prompt_evolve",
			"Iteratively evolve a teaching prompt template using PROSPER-style pairwise selection. Runs 4 iterations of candidate generation and evaluation.",
			async (params) => {
				const promptName = (params.name as string) || "learn";
				const basePrompt = KEATING_SYSTEM_PROMPT;

				const run = evolvePromptTemplate(basePrompt, promptName, 4);
				const report = promptEvolutionToMarkdown(run);

				await storage.savePromptEvolution(promptName, {
					bestScore: run.best.score,
					bestPrompt: run.best.prompt,
					report,
				});

				const improved = run.best.score > run.baselineScore;

				return `Prompt "${promptName}" evolved.\n\nBaseline: ${run.baselineScore.toFixed(2)} → Best: ${run.best.score.toFixed(2)} | Improved: ${improved}\n\n${report}`;
			}
		),

		// prompt_eval - Single-pass prompt evaluation
		createSimpleTool(
			"prompt_eval",
			"Evaluate a prompt template for teaching effectiveness in a single pass. Returns score, per-objective breakdown, and improvement feedback.",
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
		createSimpleTool(
			"timeline",
			"Show the engagement timeline for all covered topics with retention decay and review urgency. Use at session start to check if any topics need review.",
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
		createSimpleTool(
			"due",
			"Show topics that are due for review based on spaced repetition. Use at session start to proactively suggest review.",
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
	];
}
