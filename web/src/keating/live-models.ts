/**
 * The curated catalog of models that can actually hold a live session.
 *
 * The provider descriptors list everything an endpoint might accept; this list
 * is opinionated about what a learner should be pointed at. Realtime models are
 * shipped and withdrawn far faster than chat models, and a preview id that 404s
 * on one account works fine on another — so every entry carries a grade and an
 * explicit fallback order, and the live surface uses that order to recover
 * instead of dead-ending on "model not found".
 *
 * Pure data plus lookups: no DOM, no provider imports, so it can be unit tested
 * and reused by the settings tab and the live surface alike.
 */

export type LiveProviderId = "gemini-live" | "openai-realtime";

/**
 * How much we trust a model to carry a whole lesson.
 *
 * "recommended" — the default we hand a learner who has expressed no opinion.
 * "capable"     — fully supported, chosen deliberately or used as a fallback.
 * "legacy"      — still connects, but gives up something (usually vision).
 */
export type LiveModelGrade = "recommended" | "capable" | "legacy";

export interface LiveModelOption {
	providerId: LiveProviderId;
	value: string;
	label: string;
	grade: LiveModelGrade;
	/** How this model can see the learner, if at all. */
	video: "native" | "sampled" | "none";
	/** One line explaining the trade-off, shown next to the option. */
	note?: string;
}

/**
 * The subset of live-model metadata a speech-model picker needs. Keeping this
 * projection here means speech settings cannot quietly grow a separate list of
 * realtime ids with different availability or ordering.
 */
export interface LiveSpeechModelOption {
	value: string;
	label: string;
}

/**
 * Ordered best-first per provider. The order is the fallback chain: when a
 * session fails in a way that implicates the model, the live surface offers the
 * next entry that is not the one that just failed.
 */
export const LIVE_MODELS: readonly LiveModelOption[] = [
	{
		providerId: "gemini-live",
		value: "gemini-3.1-flash-live-preview",
		label: "Gemini 3.1 Flash Live",
		grade: "recommended",
		video: "native",
		note: "Native live video and the fastest turn-taking.",
	},
	{
		providerId: "gemini-live",
		value: "gemini-2.5-flash-live-preview",
		label: "Gemini 2.5 Flash Live",
		grade: "capable",
		video: "native",
		note: "Widest availability. Runs tools without pausing the conversation.",
	},
	{
		providerId: "gemini-live",
		value: "gemini-3.0-flash-live-preview",
		label: "Gemini 3.0 Flash Live",
		grade: "capable",
		video: "native",
	},
	{
		providerId: "gemini-live",
		value: "gemini-2.0-flash-live-001",
		label: "Gemini 2.0 Flash Live",
		grade: "legacy",
		video: "native",
		note: "Older generation. Keep it for accounts without preview access.",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-realtime-2.1",
		label: "gpt-realtime-2.1",
		grade: "recommended",
		video: "sampled",
		note: "Sees sampled frames rather than live video.",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-realtime",
		label: "gpt-realtime",
		grade: "capable",
		video: "sampled",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-realtime-2.1-mini",
		label: "gpt-realtime-2.1-mini",
		grade: "capable",
		video: "sampled",
		note: "Cheaper and quicker; less patient with a long explanation.",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-realtime-mini",
		label: "gpt-realtime-mini",
		grade: "capable",
		video: "sampled",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-4o-realtime-preview-2024-12-17",
		label: "gpt-4o-realtime-preview",
		grade: "legacy",
		video: "none",
		note: "Voice only — this generation cannot look at your camera or screen.",
	},
	{
		providerId: "openai-realtime",
		value: "gpt-4o-mini-realtime-preview-2024-12-17",
		label: "gpt-4o-mini-realtime-preview",
		grade: "legacy",
		video: "none",
		note: "Voice only — this generation cannot look at your camera or screen.",
	},
] as const;

export function isLiveProviderId(id: string): id is LiveProviderId {
	return id === "gemini-live" || id === "openai-realtime";
}

export function liveModelsFor(providerId: string): LiveModelOption[] {
	return LIVE_MODELS.filter((model) => model.providerId === providerId);
}

/** Model options for a duplex speech picker, in the live fallback order. */
export function liveSpeechModelsFor(providerId: string): LiveSpeechModelOption[] {
	return liveModelsFor(providerId).map(({ value, label }) => ({ value, label }));
}

export function findLiveModel(providerId: string, value: string): LiveModelOption | undefined {
	return LIVE_MODELS.find((model) => model.providerId === providerId && model.value === value);
}

export function recommendedLiveModel(providerId: string): LiveModelOption | undefined {
	const models = liveModelsFor(providerId);
	return models.find((model) => model.grade === "recommended") ?? models[0];
}

/**
 * The model to offer after `failing` let the learner down.
 *
 * Walks the provider's list in order, skipping the failed model and anything
 * already tried in this session, so repeatedly hitting "try another model"
 * works down the chain instead of bouncing between the same two entries.
 */
export function nextBestLiveModel(
	providerId: string,
	failing: string,
	alreadyTried: readonly string[] = [],
): LiveModelOption | undefined {
	const exhausted = new Set([failing, ...alreadyTried]);
	return liveModelsFor(providerId).find((model) => !exhausted.has(model.value));
}

/** Label for a model id that is not in the catalog (a hand-typed override). */
export function describeLiveModel(providerId: string, value: string): LiveModelOption {
	return findLiveModel(providerId, value) ?? {
		providerId: (isLiveProviderId(providerId) ? providerId : "gemini-live"),
		value,
		label: value,
		grade: "capable",
		video: providerId === "gemini-live" ? "native" : "sampled",
		note: "Not in Keating's tested list — it may refuse the session.",
	};
}
