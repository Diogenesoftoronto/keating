/**
 * The full public learning profile, stored as app.keating.learningProfile.
 *
 * The record keeps schemaVersion 1: every field added here is optional, which
 * is how AT Protocol lexicons evolve, so an older reader still sees the topic
 * labels and an older record (labels and a count only) reads as a profile with
 * just its Topics section.
 *
 * Everything here is authored and chosen by the learner. Nothing is derived
 * from grades, transcripts or learner records, and nothing in this module reads
 * storage. The same functions validate what the editor publishes, what the
 * server fetches from a PDS, and what the public page renders, so a record
 * that passes here is exactly what a visitor sees.
 */
export const LEARNING_PROFILE_COLLECTION = "app.keating.learningProfile";

export const PROFILE_LIMITS = {
	displayName: 64,
	headline: 160,
	about: 1_200,
	learning: 8,
	learningTopic: 80,
	learningGoal: 240,
	topics: 20,
	topic: 80,
	work: 12,
	workTitle: 120,
	workNote: 400,
	workFeedback: 600,
	nextSteps: 6,
	nextStep: 200,
	links: 6,
	linkLabel: 60,
	url: 2_048,
} as const;

export const PROFILE_SECTIONS = ["about", "learning", "topics", "work", "next", "links"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const PROFILE_SECTION_LABELS: Record<ProfileSection, string> = {
	about: "About",
	learning: "Learning now",
	topics: "Topics",
	work: "Shared work",
	next: "Next steps",
	links: "Links",
};

/** Named accents, so a record can never carry arbitrary CSS. */
export const PROFILE_ACCENTS = ["ink", "moss", "ember", "tide", "plum"] as const;
export type ProfileAccent = (typeof PROFILE_ACCENTS)[number];
export const PROFILE_LAYOUTS = ["stacked", "cards"] as const;
export type ProfileLayout = (typeof PROFILE_LAYOUTS)[number];

export const WORK_KINDS = ["session", "assignment", "notes", "project"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export const WORK_KIND_LABELS: Record<WorkKind, string> = {
	session: "Tutoring session",
	assignment: "Assignment",
	notes: "Notes",
	project: "Project",
};

export interface LearningFocus {
	topic: string;
	/** What the learner is trying to be able to do. */
	goal?: string;
}

export interface SharedWork {
	kind: WorkKind;
	title: string;
	url: string;
	note?: string;
	/** Feedback the AI tutor gave on this piece of work. Always rendered with an AI label. */
	tutorFeedback?: string;
}

export interface ProfileLink {
	label: string;
	url: string;
}

export interface ProfileAppearance {
	accent: ProfileAccent;
	layout: ProfileLayout;
	/** Visible sections, in the order the learner wants them. */
	sections: ProfileSection[];
}

/** What a learner fills in. Every field is optional except by validation of its own contents. */
export interface PublicProfileInput {
	displayName?: unknown;
	headline?: unknown;
	about?: unknown;
	learning?: unknown;
	topics?: unknown;
	work?: unknown;
	nextSteps?: unknown;
	links?: unknown;
	appearance?: unknown;
	savedSessions?: unknown;
}

export interface PublicProfileContent {
	displayName?: string;
	headline?: string;
	about?: string;
	learning: LearningFocus[];
	topics: string[];
	work: SharedWork[];
	nextSteps: string[];
	links: ProfileLink[];
	appearance: ProfileAppearance;
	activity?: { savedSessions: number };
}

export interface FullLearningProfile extends PublicProfileContent {
	$type: typeof LEARNING_PROFILE_COLLECTION;
	schemaVersion: 1;
	visibility: "public";
	publicationId: string;
	updatedAt: string;
}

export const DEFAULT_PROFILE_APPEARANCE: ProfileAppearance = {
	accent: "ink",
	layout: "stacked",
	sections: [...PROFILE_SECTIONS],
};

export class ProfileValidationError extends Error {
	constructor(message: string, readonly field: string) {
		super(message);
		this.name = "ProfileValidationError";
	}
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const LINE_BREAK = /[\r\n]/u;

function fail(field: string, message: string): never {
	throw new ProfileValidationError(message, field);
}

function oneLine(value: unknown, max: number, field: string, label: string, required = false): string | undefined {
	if (value === undefined || value === null || value === "") {
		return required ? fail(field, `${label} is required.`) : undefined;
	}
	if (typeof value !== "string") fail(field, `${label} must be text.`);
	const text = value.trim();
	if (!text) return required ? fail(field, `${label} is required.`) : undefined;
	if (CONTROL.test(text) || LINE_BREAK.test(text)) fail(field, `${label} must fit on one line.`);
	if (text.length > max) fail(field, `${label} must be ${max} characters or fewer.`);
	return text;
}

function paragraph(value: unknown, max: number, field: string, label: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") fail(field, `${label} must be text.`);
	const text = value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	if (!text) return undefined;
	if (CONTROL.test(text)) fail(field, `${label} contains characters that cannot be published.`);
	if (text.length > max) fail(field, `${label} must be ${max} characters or fewer.`);
	return text;
}

function list(value: unknown, max: number, field: string, label: string): unknown[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) fail(field, `${label} must be a list.`);
	if (value.length > max) fail(field, `Keep ${label.toLowerCase()} to ${max} or fewer.`);
	return value;
}

function entry(value: unknown, field: string, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, `Each ${label} needs its details filled in.`);
	return value as Record<string, unknown>;
}

/** Public links are plain https addresses: no credentials, no script or data schemes. */
export function publicUrl(value: unknown, field: string, label: string): string {
	if (typeof value !== "string" || !value.trim()) fail(field, `${label} needs a web address.`);
	const text = value.trim();
	if (text.length > PROFILE_LIMITS.url) fail(field, `${label} is too long.`);
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return fail(field, `${label} must be a full web address starting with https://.`);
	}
	if (url.protocol !== "https:") fail(field, `${label} must start with https://.`);
	if (url.username || url.password) fail(field, `${label} must not contain a username or password.`);
	if (!url.hostname.includes(".")) fail(field, `${label} must point to a public website.`);
	return url.toString();
}

function distinct<T>(items: T[], key: (item: T) => string, field: string, label: string): T[] {
	const seen = new Set<string>();
	for (const item of items) {
		const id = key(item).toLocaleLowerCase();
		if (seen.has(id)) fail(field, `Remove the duplicate ${label}.`);
		seen.add(id);
	}
	return items;
}

function appearanceFrom(value: unknown): ProfileAppearance {
	if (value === undefined || value === null) return { ...DEFAULT_PROFILE_APPEARANCE, sections: [...PROFILE_SECTIONS] };
	const raw = entry(value, "appearance", "appearance setting");
	const accent = PROFILE_ACCENTS.find((name) => name === raw.accent) ?? fail("appearance", "Choose one of the listed accent colours.");
	const layout = PROFILE_LAYOUTS.find((name) => name === raw.layout) ?? fail("appearance", "Choose one of the listed layouts.");
	const sections = list(raw.sections, PROFILE_SECTIONS.length, "appearance", "Sections").map((section) =>
		PROFILE_SECTIONS.find((name) => name === section) ?? fail("appearance", "The profile lists a section this version does not know."));
	distinct(sections, (section) => section, "appearance", "section");
	return { accent, layout, sections };
}

/** Validates and normalises learner input. Unknown fields are dropped, never published. */
export function publicProfileContent(input: PublicProfileInput): PublicProfileContent {
	const displayName = oneLine(input.displayName, PROFILE_LIMITS.displayName, "displayName", "Your name");
	const headline = oneLine(input.headline, PROFILE_LIMITS.headline, "headline", "Your headline");
	const about = paragraph(input.about, PROFILE_LIMITS.about, "about", "About");

	const learning = distinct(
		list(input.learning, PROFILE_LIMITS.learning, "learning", "Things you are learning").map((value) => {
			const raw = entry(value, "learning", "learning item");
			const topic = oneLine(raw.topic, PROFILE_LIMITS.learningTopic, "learning", "What you are learning", true)!;
			const goal = oneLine(raw.goal, PROFILE_LIMITS.learningGoal, "learning", "The goal");
			return { topic, ...(goal ? { goal } : {}) };
		}),
		(item) => item.topic, "learning", "learning item",
	);

	const topics = distinct(
		list(input.topics, PROFILE_LIMITS.topics, "topics", "Topic labels").map((value) =>
			oneLine(value, PROFILE_LIMITS.topic, "topics", "Each topic", true)!),
		(topic) => topic, "topics", "topic",
	);

	const work = distinct(
		list(input.work, PROFILE_LIMITS.work, "work", "Shared work").map((value) => {
			const raw = entry(value, "work", "piece of work");
			const kind = WORK_KINDS.find((name) => name === raw.kind) ?? fail("work", "Choose what kind of work each item is.");
			const title = oneLine(raw.title, PROFILE_LIMITS.workTitle, "work", "The title of your work", true)!;
			const url = publicUrl(raw.url, "work", `The link for “${title}”`);
			const note = paragraph(raw.note, PROFILE_LIMITS.workNote, "work", "Your note");
			const tutorFeedback = paragraph(raw.tutorFeedback, PROFILE_LIMITS.workFeedback, "work", "The tutor feedback");
			return { kind, title, url, ...(note ? { note } : {}), ...(tutorFeedback ? { tutorFeedback } : {}) };
		}),
		(item) => item.url, "work", "work link",
	);

	const nextSteps = distinct(
		list(input.nextSteps, PROFILE_LIMITS.nextSteps, "nextSteps", "Next steps").map((value) =>
			oneLine(value, PROFILE_LIMITS.nextStep, "nextSteps", "Each next step", true)!),
		(step) => step, "nextSteps", "next step",
	);

	const links = distinct(
		list(input.links, PROFILE_LIMITS.links, "links", "Links").map((value) => {
			const raw = entry(value, "links", "link");
			const label = oneLine(raw.label, PROFILE_LIMITS.linkLabel, "links", "The link label", true)!;
			return { label, url: publicUrl(raw.url, "links", `The link “${label}”`) };
		}),
		(item) => item.url, "links", "link",
	);

	const { savedSessions } = input;
	if (savedSessions !== undefined && (!Number.isSafeInteger(savedSessions) || (savedSessions as number) < 0)) {
		fail("savedSessions", "The saved-session count is invalid.");
	}

	return {
		...(displayName ? { displayName } : {}),
		...(headline ? { headline } : {}),
		...(about ? { about } : {}),
		learning, topics, work, nextSteps, links,
		appearance: appearanceFrom(input.appearance),
		...(savedSessions === undefined ? {} : { activity: { savedSessions: savedSessions as number } }),
	};
}

/** True when a profile would publish nothing a visitor could read. */
export function isEmptyProfile(content: PublicProfileContent): boolean {
	return !content.displayName && !content.headline && !content.about && !content.learning.length
		&& !content.topics.length && !content.work.length && !content.nextSteps.length && !content.links.length;
}

export function publicProfileRecord(input: PublicProfileInput, now = new Date()): FullLearningProfile {
	const content = publicProfileContent(input);
	if (isEmptyProfile(content)) fail("profile", "Add at least one thing to share before publishing.");
	return {
		$type: LEARNING_PROFILE_COLLECTION,
		schemaVersion: 1,
		visibility: "public",
		publicationId: crypto.randomUUID(),
		...content,
		updatedAt: now.toISOString(),
	};
}

/**
 * Reads a published record into the full shape. A record written before
 * profiles grew (topic labels and an optional count) simply has the other
 * sections empty. Anything unreadable throws: a bad record is never treated as
 * empty or private.
 */
export function readPublicProfile(value: unknown): FullLearningProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The public profile could not be read.");
	const record = value as Record<string, unknown>;
	const valid = record.$type === LEARNING_PROFILE_COLLECTION
		&& record.schemaVersion === 1
		&& record.visibility === "public"
		&& typeof record.publicationId === "string" && !!record.publicationId && record.publicationId.length <= 100
		&& typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt));
	if (!valid) throw new Error("This public profile uses an unsupported format.");
	const activity = record.activity;
	if (activity !== undefined && (!activity || typeof activity !== "object" || !Object.hasOwn(activity, "savedSessions"))) {
		throw new Error("The public activity summary is invalid.");
	}
	const savedSessions = (activity as { savedSessions?: unknown } | undefined)?.savedSessions;
	return {
		$type: LEARNING_PROFILE_COLLECTION,
		schemaVersion: 1,
		visibility: "public",
		publicationId: record.publicationId as string,
		...publicProfileContent({ ...record, savedSessions }),
		updatedAt: new Date(record.updatedAt as string).toISOString(),
	};
}

/** Sections that have something to show, in the learner's chosen order. */
export function visibleProfileSections(profile: PublicProfileContent): ProfileSection[] {
	const has: Record<ProfileSection, boolean> = {
		about: !!profile.about,
		learning: profile.learning.length > 0,
		topics: profile.topics.length > 0,
		work: profile.work.length > 0,
		next: profile.nextSteps.length > 0,
		links: profile.links.length > 0,
	};
	return profile.appearance.sections.filter((section) => has[section]);
}

const DID_PATTERN = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%:_-]{1,253})$/u;

export function isProfileDid(value: unknown): value is string {
	return typeof value === "string" && value.length <= 300 && DID_PATTERN.test(value);
}

export function publicProfilePath(did: string): string {
	return `/u/${encodeURIComponent(did)}`;
}
