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
import { LIVE_MODEL_CHOICES } from "@keating/runtime-config";

export type LiveProviderId = "tavus" | "gemini-live" | "openai-realtime" | "gpt-live";

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
	/** Whether this model has a genuine live video lane. */
	video: "native" | "none";
	/** Whether this model accepts a deliberate still image during the session. */
	image: boolean;
	/** One line explaining the trade-off, shown next to the option. */
	note?: string;
	/** Tavus owns the WebRTC controls and renders its video/canvas in an embed. */
	surface?: "embedded";
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
  ...LIVE_MODEL_CHOICES.notorganic, ...LIVE_MODEL_CHOICES.tavus,
  ...LIVE_MODEL_CHOICES.google, ...LIVE_MODEL_CHOICES.openai,
];

export function isLiveProviderId(id: string): id is LiveProviderId {
	return id === "tavus" || id === "gemini-live" || id === "openai-realtime" || id === "gpt-live";
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
		video: providerId === "openai-realtime" || providerId === "gpt-live" ? "none" : "native",
		image: providerId !== "tavus" && providerId !== "gpt-live",
		surface: providerId === "tavus" ? "embedded" : undefined,
		note: "Not in Keating's tested list — it may refuse the session.",
	};
}
