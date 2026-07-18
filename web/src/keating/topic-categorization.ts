import type { Api, Context, Model } from "@earendil-works/pi-ai/compat";
import { hybridStreamFn, DEFAULT_MODEL } from "../hooks/keating-stream";
import { getProviderApiKey, resolveAvailableChatModel } from "../lib/provider-models";
import {
	USAGE_TOPIC_CATEGORIES,
	normalizeUsageTopic,
	usageTopicCategoryByKey,
	categorizeUsageTopic,
} from "../components/usage-topic-groups";

/** Fired on `window` whenever model-authored topic assignments change. */
export const TOPIC_CATEGORIES_CHANGED_EVENT = "keating:topic-categories-changed";

const ASSIGNMENTS_STORAGE_KEY = "keating:topic-category-assignments";
const MAX_TOPICS_PER_REQUEST = 40;

/** A model completion function; injectable so tests can stub the network. */
export type CompleteTextFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

function defaultCompleteText(model: Model<Api>): CompleteTextFn {
	return async (systemPrompt, userPrompt) => {
		const apiKey = model.provider === "browser" ? undefined : await getProviderApiKey(model.provider);
		const context: Context = {
			systemPrompt,
			messages: [{ role: "user", timestamp: Date.now(), content: userPrompt }],
		};
		const stream = await hybridStreamFn(model, context, {
			apiKey,
			maxTokens: 800,
			temperature: 0,
			reasoning: "minimal",
		});
		const message = await stream.result();
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	};
}

/** Model-authored topic → category assignments (normalized topic → category key). */
export function loadTopicCategoryAssignments(): Record<string, string> {
	try {
		const raw = localStorage.getItem(ASSIGNMENTS_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const assignments: Record<string, string> = {};
		for (const [topic, key] of Object.entries(parsed)) {
			if (typeof key === "string" && usageTopicCategoryByKey(key)) assignments[topic] = key;
		}
		return assignments;
	} catch {
		return {};
	}
}

function saveTopicCategoryAssignments(next: Record<string, string>): void {
	try {
		localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Quota or privacy-mode failure: assignments simply stay session-local.
	}
	window.dispatchEvent(new CustomEvent(TOPIC_CATEGORIES_CHANGED_EVENT));
}

export function stripCodeFences(text: string): string {
	return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function categoryCatalogPrompt(): string {
	return USAGE_TOPIC_CATEGORIES
		.map((category) => `- ${category.key}: ${category.label}`)
		.join("\n");
}

/**
 * Parse a model response mapping topics to category keys. Unknown category
 * keys and topics that were not requested are dropped.
 */
export function parseTopicAssignments(
	text: string,
	requestedTopics: readonly string[],
): Record<string, string> {
	const requested = new Map(requestedTopics.map((topic) => [normalizeUsageTopic(topic), true]));
	try {
		const parsed = JSON.parse(stripCodeFences(text)) as Record<string, unknown>;
		const assignments: Record<string, string> = {};
		for (const [topic, key] of Object.entries(parsed)) {
			const normalized = normalizeUsageTopic(topic);
			if (!requested.has(normalized)) continue;
			if (typeof key === "string" && usageTopicCategoryByKey(key)) assignments[normalized] = key;
		}
		return assignments;
	} catch {
		return {};
	}
}

/** True when the model can be used for silent background work (no key prompts, no local-model downloads). */
export async function isUsableForBackgroundCalls(model: Model<Api> | null | undefined): Promise<boolean> {
	if (!model) return false;
	if (model.provider === "browser") return false;
	return Boolean(await getProviderApiKey(model.provider));
}

/** Resolve a model suitable for background categorization, or null when none is configured. */
export async function pickCategorizationModel(): Promise<Model<Api> | null> {
	try {
		const model = await resolveAvailableChatModel(DEFAULT_MODEL as Model<Api>);
		return (await isUsableForBackgroundCalls(model)) ? model : null;
	} catch {
		return null;
	}
}

const CATEGORIZE_SYSTEM_PROMPT =
	"You classify learning topics into a fixed set of categories. Respond with JSON only — no prose, no code fences.";

/**
 * Ask the model to categorize every not-yet-assigned topic, persisting the
 * results so charts and hooks can read them synchronously. Returns true when
 * new assignments were stored.
 */
export async function ensureModelTopicCategories(
	model: Model<Api>,
	topics: readonly string[],
	completeText: CompleteTextFn = defaultCompleteText(model),
): Promise<boolean> {
	const existing = loadTopicCategoryAssignments();
	const pending = [...new Set(
		topics
			.map((topic) => normalizeUsageTopic(topic))
			.filter((topic) => topic && existing[topic] === undefined),
	)].slice(0, MAX_TOPICS_PER_REQUEST);
	if (pending.length === 0) return false;

	const userPrompt = [
		"Category keys (use exactly one key per topic):",
		categoryCatalogPrompt(),
		"",
		"Topics to classify:",
		...pending.map((topic) => `- ${topic}`),
		"",
		'Return a single JSON object mapping each topic to its category key, e.g. {"linear algebra":"math"}.',
	].join("\n");

	const response = await completeText(CATEGORIZE_SYSTEM_PROMPT, userPrompt);
	const assignments = parseTopicAssignments(response, pending);
	if (Object.keys(assignments).length === 0) return false;
	saveTopicCategoryAssignments({ ...existing, ...assignments });
	return true;
}

/**
 * Categorize a single piece of conversation text with the model, falling back
 * to the deterministic keyword scan when the model call fails or returns an
 * unknown key. Returns a category key.
 */
export async function categorizeTextWithModel(
	model: Model<Api>,
	text: string,
	completeText: CompleteTextFn = defaultCompleteText(model),
): Promise<string> {
	const fallback = () => categorizeUsageTopic(text).key;
	try {
		const userPrompt = [
			"Category keys (answer with exactly one key):",
			categoryCatalogPrompt(),
			"",
			"Text to classify:",
			text.slice(0, 1200),
			"",
			'Return JSON: {"category":"<key>"}',
		].join("\n");
		const response = await completeText(CATEGORIZE_SYSTEM_PROMPT, userPrompt);
		const parsed = JSON.parse(stripCodeFences(response)) as { category?: unknown };
		if (typeof parsed.category === "string" && usageTopicCategoryByKey(parsed.category)) {
			return parsed.category;
		}
		return fallback();
	} catch {
		return fallback();
	}
}
