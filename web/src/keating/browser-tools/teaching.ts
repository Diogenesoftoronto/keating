import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingStorage } from "../storage";
import {
	resolveTopic,
	buildEngagementTimeline,
	getDueTopics,
	engagementTimelineToMarkdown,
	dueTopicsToMarkdown,
	DEFAULT_ENGAGEMENT_POLICY,
	type CoveredTopic,
} from "../core";
import { initialSrsState, validateDeckDraft } from "../srs";
import { buildGoal, advanceGoalStep, computeGoalProgress, type GoalStepInput, type GoalStepStatus } from "../goals";
import { createTool } from "./shared";

export function createTeachingTools(storage: KeatingStorage): AgentTool[] {
	return [
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

		// bench - Run learner-feedback benchmark
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
			"Legacy on-demand learner profile inspection. The complete durable learner profile and its underlying evidence are loaded automatically before the first model turn, so do not call this at session start.",
			{},
			async () => {
				const state = await storage.getLearnerState();

				const upCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-up").length;
				const downCount = state.feedbackHistory.filter((f) => f.signal === "thumbs-down").length;
				const confusedCount = state.feedbackHistory.filter((f) => f.signal === "confused").length;

				const topicList = state.topicsExplored.slice(-10).map((t) => `- ${t}`).join("\n") || "None yet";
				const profileBeliefs = (state.profileBeliefs ?? []).slice(-10).map((belief) =>
					`- ${belief.category}: ${belief.value} (${belief.source}, ${Math.round(belief.confidence * 100)}%)`
				).join("\n") || "- None recorded yet";

				return `Learner Profile:
- Sessions: ${state.sessionsCount || 0}
- Topics explored: ${state.topicsExplored.length}
${topicList}
- Feedback: 👍${upCount} 👎${downCount} 🤔${confusedCount}
- Motivations and preferences:
${profileBeliefs}
- Last session: ${state.lastSessionAt ? new Date(state.lastSessionAt).toLocaleString() : "First session"}`;
			}
		),

		// auto_improve - Full autonomous self-improvement loop
		createTool(
			"timeline",
			"Legacy on-demand engagement timeline. Complete learner history and review evidence are loaded automatically before the first model turn.",
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
			"Legacy on-demand due-review inspection. Complete topic and flashcard review evidence are loaded automatically before the first model turn.",
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
			"remember_learner_profile",
			"Preserve a useful, non-sensitive fact about how this learner wants to learn or communicate. Use this proactively when the learner states a preference, motivation, or interest, or when repeated behavior provides concrete evidence. Explicit statements are certain; observations must remain tentative. Never infer protected, medical, psychological, or identity traits.",
			{
				category: {
					type: "string",
					enum: ["motivation", "communication-preference", "learning-preference", "interest"],
					description: "The kind of learner-specific fact being remembered.",
				},
				value: { type: "string", description: "A short, actionable description, such as 'prefers concise answers followed by examples'." },
				source: { type: "string", enum: ["explicit", "observed"], description: "Use explicit only when the learner actually said it; otherwise observed." },
				evidence: { type: "string", description: "The learner statement or repeated interaction pattern supporting this belief." },
				confidence: { type: "number", minimum: 0, maximum: 1, description: "Optional confidence for observed evidence. Observations are capped at 0.65." },
			},
			async (params) => {
				const category = String(params.category ?? "") as import("../storage").LearnerProfileCategory;
				const allowed = new Set(["motivation", "communication-preference", "learning-preference", "interest"]);
				if (!allowed.has(category)) return "Choose a valid learner profile category.";
				const source = params.source === "explicit" ? "explicit" : "observed";
				const belief = await storage.rememberLearnerProfileBelief({
					category,
					value: String(params.value ?? ""),
					source,
					evidence: String(params.evidence ?? ""),
					confidence: typeof params.confidence === "number" ? params.confidence : undefined,
				});
				return `Remembered ${belief.category}: ${belief.value} (${belief.source}, ${Math.round(belief.confidence * 100)}% confidence).`;
			},
			["category", "value", "source", "evidence"],
		),

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
			"Legacy on-demand goal listing. Every saved goal and curriculum step is loaded automatically before the first model turn.",
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
	];
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
