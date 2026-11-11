import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicProfileView } from "../components/profile/PublicProfileView";
import {
	LEARNING_PROFILE_COLLECTION,
	PROFILE_LIMITS,
	ProfileValidationError,
	isProfileDid,
	publicProfileContent,
	publicProfilePath,
	publicProfileRecord,
	readPublicProfile,
	visibleProfileSections,
} from "../keating/public-profile-contract";
import { EMPTY_PROFILE_DRAFT, clearProfileDraft, draftFromProfile, draftToInput, loadProfileDraft, saveProfileDraft, type ProfileDraft } from "../keating/public-profile-draft";
import { fetchPublicProfile } from "../pages/PublicProfile";
import { clearPublicProfileCache, loadPublicProfile, PublicProfileError, publicHttpsOrigin, type ProfileFetch } from "../../server/utils/public-profile";
import { isModerator, parseProfileReport } from "../../server/utils/public-profile-moderation";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const PDS = "https://pds.example.com";

const full = {
	displayName: "Ada",
	headline: "Working through transformers from first principles",
	about: "I study in the evenings.\n\nMostly ML papers.",
	learning: [{ topic: "Attention", goal: "Implement it from scratch" }, { topic: "Optimisers" }],
	topics: ["Linear algebra", "Bayesian reasoning"],
	work: [{ kind: "assignment", title: "Attention write-up", url: "https://chat.keating.help/s/abc12345", note: "My first one.", tutorFeedback: "Clear derivation; check the scaling factor." }],
	nextSteps: ["Read the BERT paper"],
	links: [{ label: "Blog", url: "https://ada.example.com/blog" }],
	appearance: { accent: "tide", layout: "cards", sections: ["work", "learning", "about", "topics", "next", "links"] },
};

describe("profile content validation", () => {
	test("keeps what the learner wrote and drops fields it does not know", () => {
		const content = publicProfileContent({ ...full, transcript: "secret", grades: [1, 2] } as never);
		expect(content.displayName).toBe("Ada");
		expect(content.work[0]).toMatchObject({ kind: "assignment", tutorFeedback: "Clear derivation; check the scaling factor." });
		expect(content.appearance.accent).toBe("tide");
		expect(JSON.stringify(content)).not.toContain("secret");
		expect(Object.keys(content)).not.toContain("grades");
	});

	test("only plain https links without credentials are publishable", () => {
		for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "http://example.com", "https://user:pw@example.com", "https://localhost", "/relative", "not a url"]) {
			expect(() => publicProfileContent({ links: [{ label: "x", url }] })).toThrow(ProfileValidationError);
			expect(() => publicProfileContent({ work: [{ kind: "project", title: "x", url }] })).toThrow(ProfileValidationError);
		}
	});

	test("appearance accepts only the listed choices, so a record cannot carry CSS", () => {
		expect(() => publicProfileContent({ appearance: { accent: "red; background:url(x)", layout: "stacked", sections: [] } })).toThrow(ProfileValidationError);
		expect(() => publicProfileContent({ appearance: { accent: "ink", layout: "stacked", sections: ["about", "about"] } })).toThrow(ProfileValidationError);
		expect(() => publicProfileContent({ appearance: { accent: "ink", layout: "stacked", sections: ["secrets"] } })).toThrow(ProfileValidationError);
	});

	test("limits, duplicates and multi-line labels are rejected with the field named", () => {
		const problem = (input: Parameters<typeof publicProfileContent>[0]) => { try { publicProfileContent(input); return null; } catch (error) { return (error as ProfileValidationError).field; } };
		expect(problem({ displayName: "x".repeat(PROFILE_LIMITS.displayName + 1) })).toBe("displayName");
		expect(problem({ topics: ["a", "A"] })).toBe("topics");
		expect(problem({ topics: ["two\nlines"] })).toBe("topics");
		expect(problem({ learning: Array.from({ length: PROFILE_LIMITS.learning + 1 }, (_, index) => ({ topic: `t${index}` })) })).toBe("learning");
		expect(problem({ work: [{ kind: "essay", title: "x", url: "https://example.com" }] })).toBe("work");
		expect(problem({ savedSessions: -1 })).toBe("savedSessions");
	});

	test("an empty profile cannot be published", () => {
		expect(() => publicProfileRecord({})).toThrow(/at least one thing/);
		expect(publicProfileRecord({ topics: ["Algebra"] }).visibility).toBe("public");
	});

	test("hidden or empty sections are not shown, and the learner's order is kept", () => {
		const content = publicProfileContent(full);
		expect(visibleProfileSections(content)).toEqual(["work", "learning", "about", "topics", "next", "links"]);
		expect(visibleProfileSections(publicProfileContent({ ...full, about: "", appearance: { ...full.appearance, sections: ["topics", "about"] } }))).toEqual(["topics"]);
	});
});

describe("record compatibility", () => {
	test("a record written before profiles grew still reads, with only its topics", () => {
		const legacy = { $type: LEARNING_PROFILE_COLLECTION, schemaVersion: 1, visibility: "public", publicationId: "p1", topics: ["Algebra"], activity: { savedSessions: 3 }, updatedAt: "2026-10-01T00:00:00.000Z" };
		const profile = readPublicProfile(legacy);
		expect(profile.topics).toEqual(["Algebra"]);
		expect(profile.activity).toEqual({ savedSessions: 3 });
		expect(profile.work).toEqual([]);
		expect(visibleProfileSections(profile)).toEqual(["topics"]);
	});

	test("a published record round-trips, and an older reader still sees its topics", () => {
		const record = publicProfileRecord(full, new Date("2026-11-10T12:00:00Z"));
		expect(record.schemaVersion).toBe(1);
		expect(readPublicProfile(JSON.parse(JSON.stringify(record)))).toEqual(record);
		expect(record.topics).toEqual(["Linear algebra", "Bayesian reasoning"]);
	});

	test("unreadable or hostile records throw instead of reading as empty", () => {
		const record = publicProfileRecord(full);
		for (const bad of [null, "x", { ...record, visibility: "private" }, { ...record, schemaVersion: 9 }, { ...record, updatedAt: "never" }, { ...record, links: [{ label: "x", url: "javascript:1" }] }, { ...record, activity: {} }]) {
			expect(() => readPublicProfile(bad)).toThrow();
		}
	});
});

describe("rendering", () => {
	test("learner text is escaped and tutor feedback is labelled as AI", () => {
		const hostile = publicProfileContent({ ...full, displayName: "<script>alert(1)</script>", about: "<img src=x onerror=alert(1)>", work: [{ ...full.work[0]!, title: "<b>bold</b>" }] });
		const markup = renderToStaticMarkup(<PublicProfileView profile={hostile} identity="@ada.example.com" updatedAt="2026-11-10T12:00:00.000Z" />);
		expect(markup).not.toContain("<script>alert");
		expect(markup).not.toContain("<img src=x");
		expect(markup).not.toContain("<b>bold</b>");
		expect(markup).toContain("&lt;script&gt;");
		expect(markup).toContain("Keating’s AI feedback, shared by the learner");
		expect(markup).toContain('rel="noopener noreferrer nofollow ugc"');
		expect(markup).toContain('data-accent="tide"');
		expect(markup).toContain("Keating has not verified these claims");
	});

	test("the preview says so when there is nothing to show", () => {
		const markup = renderToStaticMarkup(<PublicProfileView profile={publicProfileContent({})} preview />);
		expect(markup).toContain("Nothing to show yet");
	});
});

describe("editor draft", () => {
	const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; };

	test("a draft survives a reload and is kept per identity", () => {
		const storage = memory();
		const draft: ProfileDraft = { ...EMPTY_PROFILE_DRAFT, displayName: "Ada", topics: "Algebra\nLogic", learning: [{ topic: "Attention", goal: "" }] };
		expect(saveProfileDraft(DID, draft, storage)).toBe(true);
		expect(loadProfileDraft(DID, storage)).toEqual(draft);
		expect(loadProfileDraft("did:plc:zzzzzzzzzzzzzzzzzzzzzzzz", storage)).toBeNull();
		clearProfileDraft(DID, storage);
		expect(loadProfileDraft(DID, storage)).toBeNull();
	});

	test("a failed save is reported, and corrupt storage reads as no draft", () => {
		const failing = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
		expect(saveProfileDraft(DID, EMPTY_PROFILE_DRAFT, failing)).toBe(false);
		expect(saveProfileDraft(DID, EMPTY_PROFILE_DRAFT, null)).toBe(false);
		expect(loadProfileDraft(DID, failing)).toBeNull();
	});

	test("blank rows are not published and hidden sections keep their place", () => {
		const draft: ProfileDraft = { ...EMPTY_PROFILE_DRAFT, topics: "Algebra\n\n  \nLogic", learning: [{ topic: "", goal: "" }, { topic: "Attention", goal: "" }], links: [{ label: "", url: "" }], hiddenSections: ["links"], includeCount: true };
		const input = draftToInput(draft, 4);
		expect(input.topics).toEqual(["Algebra", "Logic"]);
		expect(input.learning).toEqual([{ topic: "Attention", goal: "" }]);
		expect(input.links).toEqual([]);
		expect((input.appearance as { sections: string[] }).sections).not.toContain("links");
		expect(input.savedSessions).toBe(4);
		expect(draftToInput(draft, undefined).savedSessions).toBeUndefined();
	});

	test("editing a published profile starts from exactly what is public", () => {
		const content = publicProfileContent({ ...full, savedSessions: 2, appearance: { ...full.appearance, sections: ["topics", "work"] } });
		const draft = draftFromProfile(content);
		expect(draft.hiddenSections.sort()).toEqual(["about", "learning", "links", "next"]);
		expect(publicProfileContent(draftToInput(draft, 2))).toEqual(content);
	});
});

describe("loading a profile from a learner's PDS", () => {
	const record = publicProfileRecord(full, new Date("2026-11-10T12:00:00Z"));
	const didDocument = { id: DID, alsoKnownAs: ["at://ada.example.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] };
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	const fetcher = (routes: Record<string, () => Response>, seen: string[] = []): ProfileFetch => async (url, init) => {
		seen.push(url);
		expect(init.redirect).toBe("error");
		const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
		if (!route) throw new Error(`unexpected fetch ${url}`);
		return route[1]();
	};
	beforeEach(clearPublicProfileCache);
	afterEach(clearPublicProfileCache);

	test("resolves the DID, reads the record and returns the handle", async () => {
		const seen: string[] = [];
		const result = await loadPublicProfile(DID, { fetcher: fetcher({
			"https://plc.directory/": () => json(didDocument),
			[`${PDS}/xrpc/com.atproto.repo.getRecord`]: () => json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid: "c", value: record }),
		}, seen) });
		expect(result).toMatchObject({ status: "public", did: DID, handle: "ada.example.com" });
		expect(result.status === "public" && result.profile.displayName).toBe("Ada");
		expect(seen[1]).toContain(`repo=${encodeURIComponent(DID)}`);
	});

	test("never published and withdrawn look the same to a visitor", async () => {
		const missing = await loadPublicProfile(DID, { fetcher: fetcher({ "https://plc.directory/": () => json(didDocument), [PDS]: () => json({ error: "RecordNotFound" }, 400) }) });
		clearPublicProfileCache();
		const withdrawn = await loadPublicProfile(DID, { fetcher: fetcher({ "https://plc.directory/": () => json(didDocument), [PDS]: () => json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, value: { $type: LEARNING_PROFILE_COLLECTION, schemaVersion: 1, visibility: "private", publicationId: "p", updatedAt: "2026-11-10T00:00:00Z" } }) }) });
		expect(missing).toEqual({ status: "not_public", did: DID });
		expect(withdrawn).toEqual(missing);
	});

	test("a hidden profile is not fetched at all", async () => {
		const result = await loadPublicProfile(DID, { isHidden: async () => true, fetcher: async () => { throw new Error("must not fetch"); } });
		expect(result).toEqual({ status: "hidden", did: DID });
	});

	test("upstream failures and bad data are errors, never 'no profile'", async () => {
		const failing: Array<[Record<string, () => Response>, PublicProfileError["code"]]> = [
			[{ "https://plc.directory/": () => json({}, 500) }, "upstream_unavailable"],
			[{ "https://plc.directory/": () => json({}, 404) }, "unresolvable"],
			[{ "https://plc.directory/": () => json({ ...didDocument, id: "did:plc:someoneelsesomeoneelse22" }) }, "invalid_data"],
			[{ "https://plc.directory/": () => json(didDocument), [PDS]: () => json({}, 503) }, "upstream_unavailable"],
			[{ "https://plc.directory/": () => json(didDocument), [PDS]: () => json({ uri: "at://did:plc:other/app.keating.learningProfile/self", value: record }) }, "invalid_data"],
			[{ "https://plc.directory/": () => json(didDocument), [PDS]: () => json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, value: { ...record, links: [{ label: "x", url: "javascript:1" }] } }) }, "invalid_data"],
			[{ "https://plc.directory/": () => json(didDocument), [PDS]: () => new Response("x".repeat(200_000), { status: 200 }) }, "invalid_data"],
		];
		for (const [routes, code] of failing) {
			clearPublicProfileCache();
			const error = await loadPublicProfile(DID, { fetcher: fetcher(routes) }).catch((problem) => problem);
			expect(error).toBeInstanceOf(PublicProfileError);
			expect((error as PublicProfileError).code).toBe(code);
		}
	});

	test("a DID cannot point the server at a private or non-https host", async () => {
		for (const endpoint of ["http://pds.example.com", "https://127.0.0.1", "https://localhost", "https://10.0.0.5", "https://169.254.169.254", "https://[::1]", "https://user:pw@pds.example.com", "file:///etc/passwd"]) {
			expect(() => publicHttpsOrigin(endpoint)).toThrow(PublicProfileError);
			clearPublicProfileCache();
			const contacted: string[] = [];
			const error = await loadPublicProfile(DID, { fetcher: fetcher({ "https://plc.directory/": () => json({ ...didDocument, service: [{ ...didDocument.service[0]!, serviceEndpoint: endpoint }] }) }, contacted) }).catch((problem) => problem);
			expect(error).toBeInstanceOf(PublicProfileError);
			expect(contacted).toHaveLength(1);
		}
		for (const did of ["did:web:localhost", "did:web:127.0.0.1", "did:web:10.0.0.1"]) {
			clearPublicProfileCache();
			const error = await loadPublicProfile(did, { fetcher: async () => { throw new Error("must not fetch"); } }).catch((problem) => problem);
			expect(error).toBeInstanceOf(PublicProfileError);
		}
	});

	test("malformed identities are refused before any request", async () => {
		for (const bad of ["", "did:plc:short", "did:key:z6Mk", "https://example.com", `${DID}/../x`, "did:plc:ABCDEFGHIJKLMNOPQRSTUVWX"]) {
			expect(isProfileDid(bad)).toBe(false);
			const error = await loadPublicProfile(bad, { fetcher: async () => { throw new Error("must not fetch"); } }).catch((problem) => problem);
			expect((error as PublicProfileError).code).toBe("invalid_did");
		}
		expect(publicProfilePath(DID)).toBe(`/u/${encodeURIComponent(DID)}`);
	});

	test("a result is cached briefly, and a withdrawal is picked up after the cache lapses", async () => {
		let calls = 0, time = 1_000;
		let current: unknown = { uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, value: record };
		const routed = fetcher({ "https://plc.directory/": () => json(didDocument), [PDS]: () => { calls += 1; return json(current, (current as { error?: string }).error ? 400 : 200); } });
		const options = { fetcher: routed, now: () => time };
		expect((await loadPublicProfile(DID, options)).status).toBe("public");
		expect((await loadPublicProfile(DID, options)).status).toBe("public");
		expect(calls).toBe(1);
		current = { error: "RecordNotFound" };
		time += 61_000;
		expect((await loadPublicProfile(DID, options)).status).toBe("not_public");
		expect(calls).toBe(2);
	});
});

describe("reports and operator access", () => {
	test("a report needs a valid profile and a reason, and 'other' needs detail", () => {
		expect(parseProfileReport({ did: DID, reason: "spam" })).toEqual({ did: DID, reason: "spam" });
		expect(parseProfileReport({ did: DID, reason: "other", detail: "  shares my address\u0000 ", publicationId: "abc-1" })).toEqual({ did: DID, reason: "other", detail: "shares my address", publicationId: "abc-1" });
		for (const bad of [null, {}, { did: "nope", reason: "spam" }, { did: DID, reason: "boring" }, { did: DID, reason: "other" }, { did: DID, reason: "spam", detail: 5 }]) {
			expect(() => parseProfileReport(bad)).toThrow();
		}
		expect(parseProfileReport({ did: DID, reason: "spam", detail: "x".repeat(5_000) }).detail).toHaveLength(1_000);
	});

	test("operator routes are closed unless a long token is configured and matches", () => {
		const token = "t".repeat(32);
		expect(isModerator(`Bearer ${token}`, { KEATING_MODERATION_TOKEN: token })).toBe(true);
		expect(isModerator(`Bearer ${token}x`, { KEATING_MODERATION_TOKEN: token })).toBe(false);
		expect(isModerator(token, { KEATING_MODERATION_TOKEN: token })).toBe(false);
		expect(isModerator("Bearer ", {})).toBe(false);
		expect(isModerator(undefined, { KEATING_MODERATION_TOKEN: "" })).toBe(false);
		expect(isModerator("Bearer short", { KEATING_MODERATION_TOKEN: "short" })).toBe(false);
	});
});

describe("the public page's loader", () => {
	const respond = (status: number, body?: unknown): typeof fetch => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as never;

	test("each outcome maps to its own state", async () => {
		const record = publicProfileRecord(full);
		expect((await fetchPublicProfile("nope", respond(200))).status).toBe("invalid");
		expect((await fetchPublicProfile(DID, respond(200, { status: "public", did: DID, profile: record, handle: "ada.example.com" }))).status).toBe("public");
		expect((await fetchPublicProfile(DID, respond(200, { status: "not_public", did: DID }))).status).toBe("not_public");
		expect((await fetchPublicProfile(DID, respond(200, { status: "hidden", did: DID }))).status).toBe("hidden");
		expect((await fetchPublicProfile(DID, respond(404))).status).toBe("not_public");
		expect((await fetchPublicProfile(DID, respond(502))).status).toBe("unavailable");
		expect((await fetchPublicProfile(DID, respond(429))).status).toBe("unavailable");
		expect((await fetchPublicProfile(DID, (async () => { throw new Error("offline"); }) as never)).status).toBe("unavailable");
	});
});
