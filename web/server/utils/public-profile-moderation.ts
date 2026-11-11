/**
 * The minimum moderation process for public profiles: anyone can report a
 * profile, and the operator can hide one from keating.help.
 *
 * Hiding only stops Keating from displaying the profile. The record lives on
 * the learner's own PDS, where Keating cannot change or delete it, and other
 * apps may still read it. The public page says so.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { useStorage } from "nitro/storage";
import { isProfileDid } from "../../src/keating/public-profile-contract";

export const PROFILE_MODERATION_STORE = "keating:profile-moderation";

export const REPORT_REASONS = ["harassment", "impersonation", "spam", "sexual", "private-information", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
	harassment: "Harassment or hate",
	impersonation: "Pretending to be someone else",
	spam: "Spam or advertising",
	sexual: "Sexual or graphic content",
	"private-information": "Shares someone's private information",
	other: "Something else",
};

const MAX_DETAIL = 1_000;
const MAX_REPORTS_PER_PROFILE = 50;

export interface ProfileReport {
	id: string;
	did: string;
	reason: ReportReason;
	detail?: string;
	/** Which published version was reported, so a later edit does not hide what was seen. */
	publicationId?: string;
	createdAt: string;
	/** A salted hash, kept only to spot one visitor filing many reports. Never the address itself. */
	reporter: string;
}

export interface HiddenProfile {
	did: string;
	hiddenAt: string;
	note?: string;
}

const key = (did: string) => createHash("sha256").update(did).digest("hex").slice(0, 40);

export function parseProfileReport(body: unknown): { did: string; reason: ReportReason; detail?: string; publicationId?: string } {
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The report could not be read.");
	const raw = body as Record<string, unknown>;
	if (!isProfileDid(raw.did)) throw new Error("The report does not name a valid profile.");
	const reason = REPORT_REASONS.find((name) => name === raw.reason);
	if (!reason) throw new Error("Choose a reason for the report.");
	let detail: string | undefined;
	if (raw.detail !== undefined && raw.detail !== null && raw.detail !== "") {
		if (typeof raw.detail !== "string") throw new Error("The report details must be text.");
		detail = raw.detail.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, MAX_DETAIL) || undefined;
	}
	if (reason === "other" && !detail) throw new Error("Tell us what is wrong with this profile.");
	const publicationId = typeof raw.publicationId === "string" && raw.publicationId.length <= 100 && /^[\w.:-]+$/u.test(raw.publicationId)
		? raw.publicationId : undefined;
	return { did: raw.did, reason, ...(detail ? { detail } : {}), ...(publicationId ? { publicationId } : {}) };
}

export async function recordProfileReport(
	input: { did: string; reason: ReportReason; detail?: string; publicationId?: string },
	reporterIdentity: string,
	now = new Date(),
): Promise<ProfileReport> {
	const storage = useStorage(PROFILE_MODERATION_STORE);
	const reportsKey = `reports:${key(input.did)}`;
	const existing = (await storage.getItem<ProfileReport[]>(reportsKey)) ?? [];
	const report: ProfileReport = {
		id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
		...input,
		createdAt: now.toISOString(),
		reporter: createHash("sha256").update(`profile-report:${reporterIdentity}`).digest("hex").slice(0, 16),
	};
	// Keep the newest reports; an old pile-on must not push out the report that matters now.
	await storage.setItem(reportsKey, [...existing, report].slice(-MAX_REPORTS_PER_PROFILE));
	const queue = (await storage.getItem<string[]>("report-queue")) ?? [];
	if (!queue.includes(input.did)) await storage.setItem("report-queue", [...queue, input.did].slice(-1_000));
	return report;
}

export async function isProfileHidden(did: string): Promise<boolean> {
	return (await useStorage(PROFILE_MODERATION_STORE).getItem<HiddenProfile>(`hidden:${key(did)}`)) !== null;
}

export async function setProfileHidden(did: string, hidden: boolean, note?: string, now = new Date()): Promise<void> {
	const storage = useStorage(PROFILE_MODERATION_STORE);
	if (hidden) await storage.setItem(`hidden:${key(did)}`, { did, hiddenAt: now.toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) } satisfies HiddenProfile);
	else await storage.removeItem(`hidden:${key(did)}`);
}

export async function listReportedProfiles(): Promise<Array<{ did: string; hidden: boolean; reports: ProfileReport[] }>> {
	const storage = useStorage(PROFILE_MODERATION_STORE);
	const queue = (await storage.getItem<string[]>("report-queue")) ?? [];
	return Promise.all(queue.map(async (did) => ({
		did,
		hidden: await isProfileHidden(did),
		reports: (await storage.getItem<ProfileReport[]>(`reports:${key(did)}`)) ?? [],
	})));
}

/**
 * Operator access is a shared secret in KEATING_MODERATION_TOKEN. With no
 * token configured, the operator routes are closed rather than open.
 */
export function isModerator(authorization: string | undefined | null, env: Record<string, string | undefined> = process.env): boolean {
	const expected = env.KEATING_MODERATION_TOKEN?.trim();
	if (!expected || expected.length < 24) return false;
	const given = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
	const a = createHash("sha256").update(given).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}
