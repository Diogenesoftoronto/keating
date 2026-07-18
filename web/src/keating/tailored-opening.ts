import type { Api, Context, Model } from "@earendil-works/pi-ai/compat";
import { hybridStreamFn } from "../hooks/keating-stream";
import { keatingStorage } from "../hooks/keating-storage";
import { getProviderApiKey } from "../lib/provider-models";
import { isUsableForBackgroundCalls, stripCodeFences } from "./topic-categorization";
import type { StarterPrompt } from "./starter-prompts";

export interface TailoredOpening {
	greeting: string;
	prompts: StarterPrompt[];
}

const STORAGE_KEY = "keating:tailored-opening";
const VALID_LABELS = new Set<StarterPrompt["label"]>(["Learn", "Plan", "Map", "Assess", "Create"]);

interface CachedOpening {
	day: string;
	modelKey: string;
	opening: TailoredOpening;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function cacheKeyFor(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function loadCached(model: Model<Api>): TailoredOpening | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const cached = JSON.parse(raw) as CachedOpening;
		if (cached.day !== today() || cached.modelKey !== cacheKeyFor(model)) return null;
		return cached.opening;
	} catch {
		return null;
	}
}

function saveCached(model: Model<Api>, opening: TailoredOpening): void {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ day: today(), modelKey: cacheKeyFor(model), opening } satisfies CachedOpening),
		);
	} catch {
		// Non-fatal: the opening is regenerated next time.
	}
}

export function parseTailoredOpening(text: string): TailoredOpening | null {
	try {
		const parsed = JSON.parse(stripCodeFences(text)) as {
			greeting?: unknown;
			suggestions?: Array<{ label?: unknown; text?: unknown }>;
		};
		const greeting = typeof parsed.greeting === "string" ? parsed.greeting.trim().slice(0, 160) : "";
		const prompts: StarterPrompt[] = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
			.filter((entry) => typeof entry?.text === "string" && (entry.text as string).trim().length > 0)
			.slice(0, 4)
			.map((entry) => ({
				label: VALID_LABELS.has(entry.label as StarterPrompt["label"])
					? (entry.label as StarterPrompt["label"])
					: "Learn",
				text: (entry.text as string).trim().slice(0, 140),
				domain: "tailored",
			}));
		if (!greeting && prompts.length === 0) return null;
		return { greeting: greeting || "Pick up where you left off", prompts };
	} catch {
		return null;
	}
}

async function learnerSummary(): Promise<string | null> {
	const [state, goals] = await Promise.all([
		keatingStorage.getLearnerState(),
		keatingStorage.getGoals(),
	]);
	const activeGoals = goals.filter((goal) => goal.status === "active").slice(0, 4);
	const topics = state.topicProfiles.slice(0, 8);
	if (state.sessionsCount === 0 && topics.length === 0 && activeGoals.length === 0) return null;

	return [
		`Sessions so far: ${state.sessionsCount}`,
		topics.length > 0
			? `Recent topics:\n${topics.map((topic) => `- ${topic.topic} (${topic.status}, mastery ${Math.round(topic.mastery * 100)}%)`).join("\n")}`
			: "",
		state.weaknesses.length > 0 ? `Needs review: ${state.weaknesses.slice(0, 6).join(", ")}` : "",
		activeGoals.length > 0
			? `Active goals:\n${activeGoals.map((goal) => `- ${goal.title}`).join("\n")}`
			: "",
	].filter(Boolean).join("\n");
}

/**
 * Ask the selected model for a short personalized greeting plus starter
 * suggestions grounded in the learner's history. Returns null when there is
 * no usable model or no learner history yet — callers fall back to the
 * generic "Start a conversation" experience.
 */
export async function getTailoredOpening(model: Model<Api> | null | undefined): Promise<TailoredOpening | null> {
	if (!model || !(await isUsableForBackgroundCalls(model))) return null;

	const cached = loadCached(model);
	if (cached) return cached;

	const summary = await learnerSummary();
	if (!summary) return null;

	const context: Context = {
		systemPrompt:
			"You write the opening screen of a learning app for a returning learner. Respond with JSON only — no prose, no code fences.",
		messages: [{
			role: "user",
			timestamp: Date.now(),
			content: [
				"Learner history:",
				summary,
				"",
				"Write a warm one-sentence greeting (max 12 words) that references their learning, plus 3 short next-step suggestions grounded in this history.",
				'Each suggestion has a label from exactly: Learn, Plan, Map, Assess, Create — and a "text" phrased as a request (max 12 words).',
				'Return JSON: {"greeting":"...","suggestions":[{"label":"Learn","text":"..."}]}',
			].join("\n"),
		}],
	};

	const apiKey = await getProviderApiKey(model.provider);
	const stream = await hybridStreamFn(model, context, {
		apiKey,
		maxTokens: 300,
		temperature: 0.6,
		reasoning: "minimal",
	});
	const message = await stream.result();
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const opening = parseTailoredOpening(text);
	if (opening) saveCached(model, opening);
	return opening;
}
