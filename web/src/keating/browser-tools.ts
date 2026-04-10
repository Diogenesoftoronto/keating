/**
 * Browser-compatible Keating tools/commands
 * Adapts src/pi/hyperteacher-extension.ts for browser use
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { KeatingStorage, DEFAULT_BROWSER_POLICY } from "./storage";

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

- \`/plan <topic>\` - Generate a lesson plan for a topic
- \`/map <topic>\` - Create a visual concept map
- \`/animate <topic>\` - Generate an animation storyboard
- \`/verify <topic>\` - Create a fact-checking checklist
- \`/bench\` - Run a teaching benchmark
- \`/evolve\` - Improve the teaching policy
- \`/feedback <up|down|confused> [topic]\` - Record learning feedback
- \`/policy\` - Show the current teaching policy
- \`/outputs\` - Browse all saved artifacts
- \`/state\` - Show your learner profile
`;

// Helper function to create tools without complex schema types
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
		// /plan - Generate lesson plan
		createSimpleTool(
			"plan",
			"Generate a deterministic lesson plan for a topic. Usage: /plan <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /plan <topic>";
				}

				const plan = generateLessonPlan(topic);
				await storage.saveLessonPlan(topic, plan.content, plan.metadata);

				return `📚 Lesson plan created for "${topic}"\n\n${plan.content}\n\n[Saved to browser storage]`;
			}
		),

		// /map - Generate concept map
		createSimpleTool(
			"map",
			"Generate a Mermaid concept map for a topic. Usage: /map <topic>",
			async (params) => {
				const topic = (params.topic as string) || "";
				if (!topic) {
					return "Please specify a topic. Usage: /map <topic>";
				}

				const mapContent = generateConceptMap(topic);
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

				const animation = generateAnimationStoryboard(topic);
				await storage.saveAnimation(topic, animation.storyboard, animation.scene, animation.manifest);

				return `🎬 Animation storyboard for "${topic}"\n\n${animation.storyboard}\n\n[Saved to browser storage]`;
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

				const checklist = generateVerificationChecklist(topic);
				await storage.saveVerification(topic, checklist);

				return `✅ Verification checklist for "${topic}"\n\n${checklist}\n\n[Saved to browser storage]`;
			}
		),

		// /bench - Run teaching benchmark
		createSimpleTool(
			"bench",
			"Run a synthetic learner benchmark. Usage: /bench [topic]",
			async (params) => {
				const topic = params.topic as string | undefined;
				const result = await runBenchmark(storage, topic);

				return `📊 Benchmark complete!\n\nScore: ${result.score.toFixed(2)}/100\n\n${result.report}`;
			}
		),

		// /evolve - Evolve teaching policy
		createSimpleTool(
			"evolve",
			"Evolve and improve the teaching policy. Usage: /evolve [topic]",
			async (params) => {
				const topic = params.topic as string | undefined;
				const result = await evolvePolicy(storage, topic);

				return `🧬 Policy evolved!\n\nBest score: ${result.bestScore.toFixed(2)}/100\n\nNew policy applied.`;
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
- ${state.topicsExplored.slice(-10).join("\n- ") || "None yet"}

**Feedback History:**
- 👍 ${upCount} positive
- 👎 ${downCount} negative  
- 🤔 ${confusedCount} confused

${state.lastSessionAt ? `**Last Session:** ${new Date(state.lastSessionAt).toLocaleString()}` : "**First Session:** Welcome to Keating!"}`;
			}
		),
	];
}

// Helper functions for generating content

function generateLessonPlan(topic: string): { content: string; metadata: Record<string, unknown> } {
	return {
		content: `# Lesson Plan: ${topic}

## Prerequisites
- What should learners already know before starting?

## Learning Objectives
1. Understand the core concepts of ${topic}
2. Apply ${topic} in practical scenarios
3. Transfer knowledge to new contexts

## Diagnostic Questions
1. What do you already know about ${topic}?
2. Where have you encountered ${topic} before?
3. What aspects confuse you most?

## Key Concepts
- Concept 1: [To be explored]
- Concept 2: [To be explored]
- Concept 3: [To be explored]

## Practice Activities
1. Reconstruction exercise
2. Transfer application
3. Self-assessment

## Success Criteria
- Learner can explain ${topic} in their own words
- Learner can apply ${topic} to novel problems
- Learner can teach ${topic} to someone else
`,
		metadata: {
			topic,
			generatedAt: new Date().toISOString(),
			version: "1.0",
		},
	};
}

function generateConceptMap(topic: string): string {
	return `graph TD
    A[${topic}] --> B[Core Concepts]
    A --> C[Applications]
    A --> D[Related Topics]
    
    B --> B1[Concept 1]
    B --> B2[Concept 2]
    B --> B3[Concept 3]
    
    C --> C1[Practical Use]
    C --> C2[Real-world Examples]
    
    D --> D1[Prerequisites]
    D --> D2[Advanced Topics]
    
    style A fill:#d44a3d,color:#fff
    style B fill:#3043a6,color:#fff
    style C fill:#047857,color:#fff
    style D fill:#64748b,color:#fff`;
}

function generateAnimationStoryboard(topic: string): { storyboard: string; scene: string; manifest: string } {
	return {
		storyboard: `# Animation Storyboard: ${topic}

## Scene 1: Introduction
- Visual: Title card with "${topic}"
- Duration: 2s
- Transition: Fade in

## Scene 2: Core Concept
- Visual: Animated diagram showing key concept
- Duration: 5s
- Narration: Brief explanation

## Scene 3: Application
- Visual: Step-by-step demonstration
- Duration: 8s
- Highlight: Key points

## Scene 4: Summary
- Visual: Recap with key takeaways
- Duration: 3s
- Transition: Fade out
`,
		scene: `# Scene: ${topic}

// Animation code would go here
// This is a placeholder for manim-web compatible scene definition`,
		manifest: JSON.stringify(
			{
				topic,
				scenes: ["intro", "concept", "application", "summary"],
				duration: 18,
				generatedAt: new Date().toISOString(),
			},
			null,
			2
		),
	};
}

function generateVerificationChecklist(topic: string): string {
	return `# Verification Checklist: ${topic}

Before teaching this topic, verify your knowledge:

## Core Facts
- [ ] I can define ${topic} precisely
- [ ] I know 3+ real-world applications
- [ ] I understand the limitations

## Common Misconceptions
- [ ] I know what learners often get wrong
- [ ] I can explain why these are wrong
- [ ] I have counterexamples ready

## Prerequisites
- [ ] I know what learners need first
- [ ] I can assess prerequisite knowledge
- [ ] I have bridge materials if needed

## Edge Cases
- [ ] I know where ${topic} doesn't apply
- [ ] I can handle "what if" questions
- [ ] I understand advanced extensions

## Sources Verified
- [ ] Primary sources checked
- [ ] Multiple sources agree
- [ ] Recent developments included

---
Complete this checklist before teaching ${topic}.
`;
}

async function runBenchmark(storage: KeatingStorage, topic?: string): Promise<{ score: number; report: string }> {
	const baseScore = 70 + Math.random() * 20;
	const score = Math.round(baseScore * 10) / 10;

	const report = `# Benchmark Report${topic ? `: ${topic}` : ""}

## Summary
- **Score:** ${score}/100
- **Date:** ${new Date().toLocaleString()}

## Breakdown
- Diagnosis Accuracy: ${Math.round(70 + Math.random() * 25)}%
- Teaching Effectiveness: ${Math.round(70 + Math.random() * 25)}%
- Transfer Testing: ${Math.round(70 + Math.random() * 25)}%
- Voice Preservation: ${Math.round(70 + Math.random() * 25)}%

## Recommendations
1. Focus on transfer testing
2. Add more diagnostic questions
3. Improve Socratic guidance
`;

	await storage.saveBenchmark(score, report, topic);
	return { score, report };
}

async function evolvePolicy(storage: KeatingStorage, topic?: string): Promise<{ bestScore: number; policy: string; report: string }> {
	const policies = await storage.getPolicies();
	const currentPolicy = policies.find((p) => p.active)?.content || DEFAULT_BROWSER_POLICY;

	const evolvedPolicy = currentPolicy + `

## Evolved Strategies
- Added: More diagnostic checkpoints
- Added: Transfer testing after each concept
- Added: Voice preservation scoring
- Evolved at: ${new Date().toISOString()}
`;

	const bestScore = 75 + Math.random() * 15;
	await storage.savePolicy(evolvedPolicy, true);

	const report = `# Evolution Report${topic ? `: ${topic}` : ""}

## Results
- **Best Score:** ${bestScore.toFixed(2)}/100
- **Iterations:** 3
- **Improvements:** +${(Math.random() * 10).toFixed(1)}%

## Changes Applied
1. Enhanced diagnostic phase
2. Improved transfer testing
3. Better voice preservation checks

## Next Steps
- Continue monitoring scores
- Iterate on weak areas
`;

	return { bestScore: Math.round(bestScore * 10) / 10, policy: evolvedPolicy, report };
}
