import type { H3Event } from "h3";
import type { NotOrganicProductSession } from "../../src/notorganic-provider/fetch-adapter";
import { requireNotOrganicProductSession } from "../../src/notorganic-provider/server";

export function courseDevAccountId(env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.NODE_ENV === "production") return null;
	const accountId = env.KEATING_COURSES_DEV_ACCOUNT_ID?.trim();
	return accountId && accountId.length <= 256 ? accountId : null;
}

/** Account auth stays deployment-owned; this fallback is explicit and development-only. */
export async function requireCourseProductSession(event: H3Event): Promise<NotOrganicProductSession> {
	const devAccountId = courseDevAccountId();
	if (devAccountId) {
		return {
			accountId: devAccountId,
			accessToken: "development-only",
			async createDpopProof() {
				throw new Error("The Courses development session cannot call hosted provider APIs.");
			},
		};
	}
	return requireNotOrganicProductSession(event, "keating:courses");
}
