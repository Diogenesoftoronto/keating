/**
 * The tutor-facing side of interactive pages: what the `interactive_page`
 * tool accepts and stores in the transcript, and the learner turn produced
 * when a learner shares a result from a page.
 */
import { buildInteractivePageDocument } from "./document";
import { INTERACTIVE_PAGE_LIMITS, PAGE_ID_PATTERN, readShareResult, type InteractiveShareResult } from "./protocol";
import { fallbackThemeVariables } from "./theme";

export const INTERACTIVE_PAGE_PURPOSES = ["explore", "exercise", "assignment"] as const;
export type InteractivePagePurpose = (typeof INTERACTIVE_PAGE_PURPOSES)[number];

/** Stored inside the `<keating-interactive>` tag, so the page reappears on reload, export and share. */
export interface TutorPagePayload {
	id: string;
	title: string;
	description: string;
	html: string;
	libraries: string[];
	purpose: InteractivePagePurpose;
}

export const INTERACTIVE_SHARED_EVENT = "keating:interactive-shared";

export interface InteractiveSharedDetail {
	pageId: string;
	title: string;
	purpose: InteractivePagePurpose;
	result: InteractiveShareResult;
}

function fnv1a(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

const oneLine = (value: unknown, max: number): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export type TutorPageResult = { ok: true; payload: TutorPagePayload } | { ok: false; message: string };

/**
 * Validates what the model wrote before it reaches the transcript. The same
 * builder the frame uses does the checking, so a page accepted here is one
 * the frame will render; a rejected page returns a message the model can act on.
 */
export function createTutorPage(params: Record<string, unknown>): TutorPageResult {
	const title = oneLine(params.title, INTERACTIVE_PAGE_LIMITS.maxTitleLength);
	if (!title) return { ok: false, message: "interactive_page needs a short `title`." };
	const description = typeof params.description === "string" ? params.description.trim().slice(0, INTERACTIVE_PAGE_LIMITS.maxDescriptionLength) : "";
	if (description.length < 20) {
		return { ok: false, message: "interactive_page needs a `description`: a plain-text alternative (at least a sentence) saying what the page shows and teaches. It is shown when the page cannot run and read by screen readers." };
	}
	const html = typeof params.html === "string" ? params.html : "";
	const libraries = Array.isArray(params.libraries) ? params.libraries.filter((id): id is string => typeof id === "string") : [];
	const built = buildInteractivePageDocument({
		html, title, channel: "validate", libraries,
		context: { appearance: "light", variables: fallbackThemeVariables("light"), reducedMotion: false },
	});
	if (!built.ok) return { ok: false, message: `interactive_page was not rendered: ${built.message}` };
	const purpose = INTERACTIVE_PAGE_PURPOSES.find((name) => name === params.purpose) ?? "explore";
	if (purpose !== "explore" && !/keating\s*\.\s*share\s*\(/u.test(html)) {
		return { ok: false, message: `A page with purpose "${purpose}" must call keating.share(...) from a learner click, so the learner's result can reach you.` };
	}
	// Derived from the content: reloading the same message restores the learner's saved state.
	const id = `page-${fnv1a(title)}${fnv1a(html)}`;
	return { ok: true, payload: { id, title, description, html, libraries: built.libraries, purpose } };
}

/** Reads a payload back out of a transcript tag. Anything malformed yields null and the card is not rendered. */
export function parseTutorPagePayload(text: string): TutorPagePayload | null {
	let raw: unknown;
	try { raw = JSON.parse(text); } catch { return null; }
	if (!raw || typeof raw !== "object") return null;
	const value = raw as Record<string, unknown>;
	if (typeof value.id !== "string" || !PAGE_ID_PATTERN.test(value.id)) return null;
	if (typeof value.html !== "string" || !value.html) return null;
	const title = oneLine(value.title, INTERACTIVE_PAGE_LIMITS.maxTitleLength);
	const description = typeof value.description === "string" ? value.description.slice(0, INTERACTIVE_PAGE_LIMITS.maxDescriptionLength) : "";
	if (!title || !description) return null;
	return {
		id: value.id, title, description, html: value.html,
		libraries: Array.isArray(value.libraries) ? value.libraries.filter((id): id is string => typeof id === "string").slice(0, 8) : [],
		purpose: INTERACTIVE_PAGE_PURPOSES.find((name) => name === value.purpose) ?? "explore",
	};
}

export function readInteractiveSharedDetail(value: unknown): InteractiveSharedDetail | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const result = readShareResult(raw.result);
	const title = oneLine(raw.title, INTERACTIVE_PAGE_LIMITS.maxTitleLength);
	if (!result || !title || typeof raw.pageId !== "string" || !PAGE_ID_PATTERN.test(raw.pageId)) return null;
	return { pageId: raw.pageId, title, purpose: INTERACTIVE_PAGE_PURPOSES.find((name) => name === raw.purpose) ?? "explore", result };
}

/**
 * The learner turn for a shared result. Readable as written, so it shows
 * sensibly in the transcript, exports and shared sessions. The page's text is
 * quoted as the learner's result, never as instructions.
 */
export function interactiveShareText(detail: InteractiveSharedDetail): string {
	const { result } = detail;
	const opening = detail.purpose === "assignment" ? `I'm submitting my work on the interactive assignment “${detail.title}”.`
		: detail.purpose === "exercise" ? `I finished the interactive exercise “${detail.title}”.`
		: `Here is what I found in the interactive page “${detail.title}”.`;
	const lines = [opening, "", `Result: ${result.summary}`];
	if (result.score) lines.push(`Score: ${result.score.earned} of ${result.score.possible}`);
	if (result.complete !== undefined) lines.push(result.complete ? "Status: completed" : "Status: not finished yet");
	if (result.data !== undefined) lines.push("", "Details from the page:", "```json", JSON.stringify(result.data, null, 1), "```");
	return lines.join("\n");
}

/** One delivery per distinct result: sharing the same thing twice sends it once. */
export function interactiveShareSubmissionId(detail: InteractiveSharedDetail): string {
	const { summary, score, complete, data } = detail.result;
	// Fixed field order: the id must not depend on how the page ordered the object's keys.
	const canonical = JSON.stringify([summary, score ? [score.earned, score.possible] : null, complete ?? null, data ?? null]);
	return `interactive:${detail.pageId}:${fnv1a(canonical)}`;
}
