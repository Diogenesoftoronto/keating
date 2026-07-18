import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { keatingLifecycle } from "./lifecycle";
import {
	categorizeTextWithModel,
	isUsableForBackgroundCalls,
	type CompleteTextFn,
} from "./topic-categorization";
import { categorizeUsageTopic } from "../components/usage-topic-groups";

/** Fired on `window` when a session's conversation moves to a new topic category. */
export const TOPIC_SHIFT_EVENT = "keating:topic-shift";

const SESSION_CATEGORY_STORAGE_KEY = "keating:session-topic-category";

export interface TopicShiftDetail {
	sessionId: string;
	fromCategory: string;
	toCategory: string;
}

function loadSessionCategories(): Record<string, string> {
	try {
		const raw = localStorage.getItem(SESSION_CATEGORY_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Record<string, string>) : {};
	} catch {
		return {};
	}
}

function saveSessionCategory(sessionId: string, category: string): void {
	try {
		const all = loadSessionCategories();
		all[sessionId] = category;
		localStorage.setItem(SESSION_CATEGORY_STORAGE_KEY, JSON.stringify(all));
	} catch {
		// Non-fatal: shift detection degrades to per-page-load memory.
	}
}

export function latestUserText(messages: ReadonlyArray<{ role?: unknown; content?: unknown }>): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role !== "user" && message.role !== "user-with-attachments") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const text = content
				.filter((part) => part?.type === "text" && typeof part.text === "string")
				.map((part) => part.text as string)
				.join(" ");
			if (text.trim()) return text;
		}
	}
	return "";
}

/**
 * Categorize the latest learner message (model-authored, deterministic
 * fallback) and compare it with the session's previously recorded category.
 * On a change, emits a `topic_shift` lifecycle event and a
 * `keating:topic-shift` window event so hosts can react.
 */
export async function detectTopicCategoryShift(
	model: Model<Api> | null,
	sessionId: string,
	messages: ReadonlyArray<{ role?: unknown; content?: unknown }>,
	completeText?: CompleteTextFn,
): Promise<TopicShiftDetail | null> {
	const text = latestUserText(messages).trim();
	if (!text) return null;

	const useModel = completeText !== undefined || (model && (await isUsableForBackgroundCalls(model)));
	const category = useModel && model
		? await categorizeTextWithModel(model, text, ...(completeText ? [completeText] as const : []))
		: categorizeUsageTopic(text).key;

	const previous = loadSessionCategories()[sessionId];
	if (previous === category) return null;
	saveSessionCategory(sessionId, category);
	if (previous === undefined) return null;

	const detail: TopicShiftDetail = { sessionId, fromCategory: previous, toCategory: category };
	await keatingLifecycle.emit({
		type: "topic_shift",
		sessionId,
		fromCategory: previous,
		toCategory: category,
		sampleText: text.slice(0, 200),
	});
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent<TopicShiftDetail>(TOPIC_SHIFT_EVENT, { detail }));
	}
	return detail;
}
