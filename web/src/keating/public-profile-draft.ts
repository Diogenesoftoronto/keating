/**
 * The profile editor's working copy. It lives only on this device until the
 * learner publishes, so an interrupted edit (a sign-in redirect, a closed tab)
 * is not lost and nothing half-written is ever public.
 */
import {
	DEFAULT_PROFILE_APPEARANCE,
	PROFILE_ACCENTS,
	PROFILE_LAYOUTS,
	PROFILE_SECTIONS,
	WORK_KINDS,
	type ProfileAccent,
	type ProfileLayout,
	type ProfileSection,
	type PublicProfileContent,
	type PublicProfileInput,
	type WorkKind,
} from "./public-profile-contract";

export interface ProfileDraft {
	displayName: string;
	headline: string;
	about: string;
	learning: Array<{ topic: string; goal: string }>;
	/** One label per line. */
	topics: string;
	work: Array<{ kind: WorkKind; title: string; url: string; note: string; tutorFeedback: string }>;
	/** One step per line. */
	nextSteps: string;
	links: Array<{ label: string; url: string }>;
	appearance: { accent: ProfileAccent; layout: ProfileLayout };
	/** Every section, in display order, including hidden ones so re-showing keeps its place. */
	sectionOrder: ProfileSection[];
	hiddenSections: ProfileSection[];
	includeCount: boolean;
}

export const EMPTY_PROFILE_DRAFT: ProfileDraft = {
	displayName: "", headline: "", about: "", learning: [], topics: "", work: [], nextSteps: "", links: [],
	appearance: { accent: DEFAULT_PROFILE_APPEARANCE.accent, layout: DEFAULT_PROFILE_APPEARANCE.layout },
	sectionOrder: [...PROFILE_SECTIONS], hiddenSections: [], includeCount: false,
};

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);
const blank = (value: string): boolean => !value.trim();

/** Rows the learner added but left empty are not validation errors; they are simply not published. */
export function draftToInput(draft: ProfileDraft, savedSessions?: number): PublicProfileInput {
	return {
		displayName: draft.displayName,
		headline: draft.headline,
		about: draft.about,
		learning: draft.learning.filter((item) => !blank(item.topic) || !blank(item.goal)),
		topics: lines(draft.topics),
		work: draft.work.filter((item) => !blank(item.title) || !blank(item.url) || !blank(item.note) || !blank(item.tutorFeedback)),
		nextSteps: lines(draft.nextSteps),
		links: draft.links.filter((link) => !blank(link.label) || !blank(link.url)),
		appearance: {
			accent: draft.appearance.accent,
			layout: draft.appearance.layout,
			sections: draft.sectionOrder.filter((section) => !draft.hiddenSections.includes(section)),
		},
		...(draft.includeCount && savedSessions !== undefined ? { savedSessions } : {}),
	};
}

export function draftFromProfile(profile: PublicProfileContent): ProfileDraft {
	const shown = profile.appearance.sections;
	return {
		displayName: profile.displayName ?? "",
		headline: profile.headline ?? "",
		about: profile.about ?? "",
		learning: profile.learning.map((item) => ({ topic: item.topic, goal: item.goal ?? "" })),
		topics: profile.topics.join("\n"),
		work: profile.work.map((item) => ({ kind: item.kind, title: item.title, url: item.url, note: item.note ?? "", tutorFeedback: item.tutorFeedback ?? "" })),
		nextSteps: profile.nextSteps.join("\n"),
		links: profile.links.map((link) => ({ ...link })),
		appearance: { accent: profile.appearance.accent, layout: profile.appearance.layout },
		sectionOrder: [...shown, ...PROFILE_SECTIONS.filter((section) => !shown.includes(section))],
		hiddenSections: PROFILE_SECTIONS.filter((section) => !shown.includes(section)),
		includeCount: profile.activity !== undefined,
	};
}

const KEY_PREFIX = "keating:public-profile-draft:v1:";
const MAX_DRAFT_BYTES = 64_000;

const text = (value: unknown, max: number): string => typeof value === "string" ? value.slice(0, max) : "";
const rows = (value: unknown, max: number): Array<Record<string, unknown>> =>
	Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object").slice(0, max) : [];

/** Stored drafts are untrusted input like anything else in storage: coerce every field. */
function coerceDraft(value: unknown): ProfileDraft | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const appearance = (raw.appearance && typeof raw.appearance === "object" ? raw.appearance : {}) as Record<string, unknown>;
	const sections = (list: unknown): ProfileSection[] => Array.isArray(list)
		? [...new Set(list.filter((name): name is ProfileSection => PROFILE_SECTIONS.includes(name as ProfileSection)))] : [];
	const order = sections(raw.sectionOrder);
	return {
		displayName: text(raw.displayName, 200),
		headline: text(raw.headline, 400),
		about: text(raw.about, 4_000),
		learning: rows(raw.learning, 20).map((row) => ({ topic: text(row.topic, 200), goal: text(row.goal, 600) })),
		topics: text(raw.topics, 4_000),
		work: rows(raw.work, 30).map((row) => ({
			kind: WORK_KINDS.find((kind) => kind === row.kind) ?? "project",
			title: text(row.title, 300), url: text(row.url, 2_100), note: text(row.note, 1_000), tutorFeedback: text(row.tutorFeedback, 1_500),
		})),
		nextSteps: text(raw.nextSteps, 3_000),
		links: rows(raw.links, 20).map((row) => ({ label: text(row.label, 200), url: text(row.url, 2_100) })),
		appearance: {
			accent: PROFILE_ACCENTS.find((accent) => accent === appearance.accent) ?? DEFAULT_PROFILE_APPEARANCE.accent,
			layout: PROFILE_LAYOUTS.find((layout) => layout === appearance.layout) ?? DEFAULT_PROFILE_APPEARANCE.layout,
		},
		sectionOrder: [...order, ...PROFILE_SECTIONS.filter((section) => !order.includes(section))],
		hiddenSections: sections(raw.hiddenSections),
		includeCount: raw.includeCount === true,
	};
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function deviceStorage(): DraftStorage | null {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadProfileDraft(did: string, storage: DraftStorage | null = deviceStorage()): ProfileDraft | null {
	try {
		const raw = storage?.getItem(`${KEY_PREFIX}${did}`);
		return raw ? coerceDraft(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

/** Returns false when the draft could not be kept, so the editor can say so instead of losing work silently. */
export function saveProfileDraft(did: string, draft: ProfileDraft, storage: DraftStorage | null = deviceStorage()): boolean {
	try {
		const serialized = JSON.stringify(draft);
		if (!storage || serialized.length > MAX_DRAFT_BYTES) return false;
		storage.setItem(`${KEY_PREFIX}${did}`, serialized);
		return true;
	} catch {
		return false;
	}
}

export function clearProfileDraft(did: string, storage: DraftStorage | null = deviceStorage()): void {
	try { storage?.removeItem(`${KEY_PREFIX}${did}`); } catch { /* Nothing to clear when storage is unavailable. */ }
}
