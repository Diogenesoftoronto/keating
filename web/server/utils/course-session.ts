import { createError, getCookie, getHeader, getRequestURL, setCookie, type H3Event } from "h3";
import type { NotOrganicProductSession } from "../../src/notorganic-provider/fetch-adapter";
import { CourseAccountSessions, courseAccountToken } from "./course-linked-session";
import {
	isNotOrganicHostedEnabled,
	requireNotOrganicProductSession,
} from "../../src/notorganic-provider/server";

const LOCAL_COURSE_ACCOUNT_COOKIE = "keating_course_account";
const LOCAL_COURSE_SECRET_PATTERN = /^[0-9a-f]{32}$/;
const LOCAL_COURSE_ACCOUNT_MAX_AGE = 60 * 60 * 24 * 365;

export type CourseSessionMode = "development" | "local" | "hosted";

export interface CourseProductSession extends NotOrganicProductSession {
	mode: CourseSessionMode;
}

export function courseDevAccountId(env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.NODE_ENV === "production") return null;
	const accountId = env.KEATING_COURSES_DEV_ACCOUNT_ID?.trim();
	return accountId && accountId.length <= 256 ? accountId : null;
}

export function courseSessionMode(env: NodeJS.ProcessEnv = process.env): CourseSessionMode {
	if (courseDevAccountId(env)) return "development";
	return isNotOrganicHostedEnabled(env) ? "hosted" : "local";
}

export async function localCourseAccountIdFromSecret(secret: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return `local_${Buffer.from(digest).toString("hex")}`;
}

async function localCourseAccountId(event: H3Event): Promise<string> {
	const existing = getCookie(event, LOCAL_COURSE_ACCOUNT_COOKIE)?.toLowerCase();
	const localSecret = existing && LOCAL_COURSE_SECRET_PATTERN.test(existing)
		? existing
		: crypto.randomUUID().replaceAll("-", "");
	if (localSecret !== existing) {
		setCookie(event, LOCAL_COURSE_ACCOUNT_COOKIE, localSecret, {
			httpOnly: true,
			maxAge: LOCAL_COURSE_ACCOUNT_MAX_AGE,
			path: "/",
			sameSite: "lax",
			secure: getRequestURL(event, { xForwardedProto: true, xForwardedHost: false }).protocol === "https:",
		});
	}
	return localCourseAccountIdFromSecret(localSecret);
}

/** Hosted auth stays deployment-owned. Without the hosted provider, Courses use a stable browser-local identity. */
export async function requireCourseProductSession(event: H3Event): Promise<CourseProductSession> {
	const session = await resolveCourseProductSession(event);
	const expected = getHeader(event, "x-keating-course-account");
	if (expected !== undefined && expected !== session.accountId) {
		throw createError({ statusCode: 401, statusMessage: "The course account changed. Your work is still saved on this device." });
	}
	return session;
}

async function resolveCourseProductSession(event: H3Event): Promise<CourseProductSession> {
	const accountToken = courseAccountToken(event);
	if (accountToken !== undefined) {
		const account = await new CourseAccountSessions().read(accountToken);
		return {
			accountId: account.accountId, accessToken: "account-identity-only", mode: "hosted",
			async createDpopProof() { throw new Error("Course identity sessions cannot call hosted provider APIs."); },
		};
	}
	const devAccountId = courseDevAccountId();
	if (devAccountId) {
		return {
			accountId: devAccountId,
			accessToken: "development-only",
			mode: "development",
			async createDpopProof() {
				throw new Error("The Courses development session cannot call hosted provider APIs.");
			},
		};
	}
	if (!isNotOrganicHostedEnabled()) {
		return {
			accountId: await localCourseAccountId(event),
			accessToken: "local-only",
			mode: "local",
			async createDpopProof() {
				throw new Error("A local Courses session cannot call hosted provider APIs.");
			},
		};
	}
	return {
		...(await requireNotOrganicProductSession(event, "keating:courses")),
		mode: "hosted",
	};
}
