import { describe, expect, test } from "bun:test";
import { describeRanking, intervalsOverlap, meanInterval, rankByEvidence } from "../keating/bench-stats";
import {
	buildReviewQueue,
	filterReviewQueue,
	loadReviewIndexPrefs,
	nextSessionToReview,
	reviewStateLabel,
	saveReviewIndexPrefs,
	sortReviewQueue,
	summarizeReviewQueue,
} from "../keating/review-index";
import type { TrajectoryAnnotation, TrajectoryReview } from "../keating/trajectory-review";
import {
	describeChange,
	formatMicros,
	hostedChargeTotal,
	loadUsageRange,
	modelSpend,
	normalizeHostedUsage,
	saveUsageRange,
	sessionsInRange,
	summarizeUsage,
	usageWindow,
} from "../keating/usage-summary";
import { loadHostedCredits } from "../components/usage/HostedCreditsPanel";
import type { SessionMetadata } from "../types/session";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T12:00:00Z");

function session(id: string, daysAgo: number, overrides: Partial<SessionMetadata> = {}): SessionMetadata {
	const at = new Date(NOW - daysAgo * DAY).toISOString();
	return {
		id, title: `Session ${id}`, createdAt: at, lastModified: at, messageCount: 6, preview: "", thinkingLevel: "off",
		usage: { input: 1_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1_500, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
		modelProvider: "openai", modelId: "gpt-x", modelName: "GPT X",
		...overrides,
	} as SessionMetadata;
}

function review(id: string, sessionId: string, overrides: Partial<TrajectoryReview> = {}): TrajectoryReview {
	return { id, sessionId, status: "draft", verdict: "undecided", ratings: {}, createdAt: NOW - DAY, updatedAt: NOW - DAY, ...overrides } as TrajectoryReview;
}
const note = (reviewId: string, kind: TrajectoryAnnotation["kind"]) => ({ id: `${reviewId}-${kind}-${Math.random()}`, reviewId, kind } as TrajectoryAnnotation);

describe("review queue", () => {
	const sessions = [session("a", 1), session("b", 2), session("c", 3), session("d", 4, { messageCount: 1 })];
	const reviews = [
		review("r-a", "a", { status: "final", overallRating: 4, updatedAt: NOW - 2 * DAY }),
		review("r-b", "b", { overallRating: 2, updatedAt: NOW - DAY }),
		review("r-c", "c"),
	];
	const annotations = new Map([["r-a", [note("r-a", "problem"), note("r-a", "strength")]], ["r-b", [note("r-b", "suggestion")]]]);
	const rows = buildReviewQueue(sessions, reviews, annotations);

	test("an opened but empty review is not counted as work in progress", () => {
		expect(rows.map((row) => row.state)).toEqual(["final", "draft", "unreviewed", "unreviewed"]);
		expect(rows.map(reviewStateLabel)).toEqual(["Final", "In progress", "Not reviewed", "Not reviewed"]);
	});

	test("the summary counts states, notes and the average of rated reviews only", () => {
		expect(summarizeReviewQueue(rows)).toEqual({ sessions: 4, unreviewed: 2, draft: 1, final: 1, notes: { problem: 1, strength: 1, suggestion: 1 }, averageRating: 3 });
		expect(summarizeReviewQueue(buildReviewQueue(sessions, [], new Map())).averageRating).toBeUndefined();
	});

	test("filters narrow by state", () => {
		expect(filterReviewQueue(rows, "all")).toHaveLength(4);
		expect(filterReviewQueue(rows, "draft").map((row) => row.session.id)).toEqual(["b"]);
		expect(filterReviewQueue(rows, "unreviewed").map((row) => row.session.id)).toEqual(["c", "d"]);
		expect(filterReviewQueue(rows, "final").map((row) => row.session.id)).toEqual(["a"]);
	});

	test("sorting: newest, recently reviewed, most notes, and lowest rated with unrated last", () => {
		const ids = (sort: Parameters<typeof sortReviewQueue>[1]) => sortReviewQueue(rows, sort).map((row) => row.session.id);
		expect(ids("recent")).toEqual(["a", "b", "c", "d"]);
		expect(ids("reviewed").slice(0, 2)).toEqual(["b", "c"]);
		expect(ids("notes")).toEqual(["a", "b", "c", "d"]);
		expect(ids("rating")).toEqual(["b", "a", "c", "d"]);
	});

	test("next up is the review in progress, then the newest substantial unreviewed session", () => {
		expect(nextSessionToReview(rows)?.session.id).toBe("b");
		const withoutDraft = buildReviewQueue(sessions, [reviews[0]!], annotations);
		expect(nextSessionToReview(withoutDraft)?.session.id).toBe("b");
		const onlyTrivial = buildReviewQueue([session("d", 4, { messageCount: 1 })], [], new Map());
		expect(nextSessionToReview(onlyTrivial)).toBeUndefined();
	});

	test("the most recently touched review wins when a session has two", () => {
		const duplicated = buildReviewQueue([session("a", 1)], [review("old", "a", { updatedAt: NOW - 5 * DAY }), review("new", "a", { status: "final", updatedAt: NOW })], new Map());
		expect(duplicated[0]!.review?.id).toBe("new");
		expect(duplicated[0]!.state).toBe("final");
	});

	test("the chosen filter and sort are remembered, and bad storage falls back", () => {
		const data = new Map<string, string>();
		const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
		expect(loadReviewIndexPrefs(storage)).toEqual({ filter: "all", sort: "recent" });
		saveReviewIndexPrefs({ filter: "draft", sort: "rating" }, storage);
		expect(loadReviewIndexPrefs(storage)).toEqual({ filter: "draft", sort: "rating" });
		expect(loadReviewIndexPrefs({ getItem: () => "{broken", setItem: () => {} })).toEqual({ filter: "all", sort: "recent" });
		expect(loadReviewIndexPrefs({ getItem: () => JSON.stringify({ filter: "everything", sort: 7 }), setItem: () => {} })).toEqual({ filter: "all", sort: "recent" });
		expect(() => saveReviewIndexPrefs({ filter: "all", sort: "recent" }, { getItem: () => null, setItem: () => { throw new Error("quota"); } })).not.toThrow();
	});
});

describe("benchmark statistics", () => {
	test("too little data gives the whole range, not a falsely narrow interval", () => {
		expect(meanInterval([], [0, 100])).toEqual({ mean: 0, low: 0, high: 100, n: 0 });
		expect(meanInterval([80], [0, 100])).toEqual({ mean: 80, low: 0, high: 100, n: 1 });
	});

	test("identical scores are still uncertain, and the interval narrows with more data", () => {
		const few = meanInterval(Array(5).fill(90), [0, 100]);
		const many = meanInterval(Array(200).fill(90), [0, 100]);
		expect(few.high - few.low).toBeGreaterThan(20);
		expect(many.high - many.low).toBeLessThan(few.high - few.low);
		expect(few.low).toBeGreaterThanOrEqual(0);
		expect(few.high).toBeLessThanOrEqual(100);
	});

	test("the interval reflects spread and ignores non-finite values", () => {
		const tight = meanInterval([50, 50, 50, 50, 50, 50, 50, 50, 50, 51, 49, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], [0, 100]);
		const wide = meanInterval([0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100, 0, 100], [0, 100]);
		expect(wide.high - wide.low).toBeGreaterThan(tight.high - tight.low);
		expect(meanInterval([1, Number.NaN, 0, Number.POSITIVE_INFINITY]).n).toBe(2);
	});

	const input = (key: string, score: number, low: number, high: number, signals: number) => ({ key, score, signals, interval: { mean: score, low, high, n: signals } });

	test("a model below the threshold is listed but never placed", () => {
		const ranked = rankByEvidence([input("lucky", 99, 0, 100, 3), input("steady", 70, 65, 75, 60)], 20);
		expect(ranked.map((row) => [row.key, row.rank])).toEqual([["steady", 1], ["lucky", null]]);
		expect(ranked[1]!.signalsNeeded).toBe(17);
	});

	test("overlapping intervals are reported as ties, separated ones are not", () => {
		const ranked = rankByEvidence([input("a", 80, 74, 86, 40), input("b", 78, 71, 85, 40), input("c", 50, 45, 55, 40)], 20);
		expect(ranked.map((row) => [row.key, row.rank, row.tiedWithRank])).toEqual([["a", 1, null], ["b", 2, 1], ["c", 3, null]]);
		expect(intervalsOverlap(ranked[0]!.interval, ranked[1]!.interval)).toBe(true);
		expect(intervalsOverlap(ranked[1]!.interval, ranked[2]!.interval)).toBe(false);
	});

	test("the summary sentence matches what the ranking supports", () => {
		expect(describeRanking([], 20)).toContain("No sessions");
		expect(describeRanking(rankByEvidence([input("a", 90, 0, 100, 3)], 20), 20)).toContain("enough evidence to be ranked yet");
		expect(describeRanking(rankByEvidence([input("a", 90, 85, 95, 30)], 20), 20)).toContain("needs a second one");
		expect(describeRanking(rankByEvidence([input("a", 90, 85, 95, 30), input("b", 50, 45, 55, 30)], 20), 20)).toContain("ahead by more than the uncertainty");
		expect(describeRanking(rankByEvidence([input("a", 80, 70, 90, 30), input("b", 78, 68, 88, 30)], 20), 20)).toContain("All 2 ranked models overlap");
		expect(describeRanking(rankByEvidence([input("a", 80, 74, 86, 40), input("b", 78, 71, 85, 40), input("c", 50, 45, 55, 40)], 20), 20)).toContain("top 2 models overlap");
	});
});

describe("usage summary", () => {
	const sessions = [
		session("today", 0),
		session("week", 5, { modelId: "claude-y", modelName: "Claude Y", modelProvider: "anthropic", usage: { input: 4_000, output: 1_000, cacheRead: 300, cacheWrite: 0, totalTokens: 5_000, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } } }),
		session("lastweek", 10),
		session("old", 200, { modelId: undefined, modelName: undefined, modelProvider: undefined }),
	];

	test("a period contains sessions last active inside it, and 'all' contains everything", () => {
		expect(sessionsInRange(sessions, "7d", NOW).map((item) => item.id)).toEqual(["today", "week"]);
		expect(sessionsInRange(sessions, "30d", NOW).map((item) => item.id)).toEqual(["today", "week", "lastweek"]);
		expect(sessionsInRange(sessions, "all", NOW)).toHaveLength(4);
	});

	test("totals add up and count distinct active days", () => {
		const totals = summarizeUsage(sessionsInRange(sessions, "7d", NOW));
		expect(totals).toMatchObject({ sessions: 2, messages: 12, inputTokens: 5_000, outputTokens: 1_500, cachedTokens: 300, tokens: 6_500, activeDays: 2 });
		expect(totals.cost).toBeCloseTo(0.33);
	});

	test("missing or malformed usage does not poison the totals", () => {
		const broken = [session("x", 0, { usage: undefined as never }), session("y", 0, { usage: { input: Number.NaN, output: -5, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: Number.NaN } } as never }), session("z", 0, { lastModified: "not a date" })];
		const totals = summarizeUsage(broken);
		// Only "z" carries valid usage; the missing and non-finite values count as zero.
		expect(totals).toMatchObject({ sessions: 3, inputTokens: 1_000, outputTokens: 500, tokens: 1_500 });
		expect(totals.cost).toBeCloseTo(0.03);
		// "z" has an unreadable date, so it adds usage but no active day.
		expect(totals.activeDays).toBe(1);
	});

	test("the previous period is the equally long window before, and 'all' has none", () => {
		const window = usageWindow(sessions, "7d", NOW);
		expect(window.current.sessions).toBe(2);
		expect(window.previous?.sessions).toBe(1);
		expect(usageWindow(sessions, "all", NOW).previous).toBeUndefined();
	});

	test("change is described in words and never as a percentage of zero", () => {
		expect(describeChange(2, undefined, "7 days")).toBeNull();
		expect(describeChange(0, 0, "7 days")).toBeNull();
		expect(describeChange(3, 0, "7 days")).toBe("None in the previous 7 days");
		expect(describeChange(4, 4, "7 days")).toBe("Same as the previous 7 days");
		expect(describeChange(6, 4, "7 days")).toBe("50% more than the previous 7 days");
		expect(describeChange(1, 4, "7 days")).toBe("75% less than the previous 7 days");
		expect(describeChange(1000, 1, "7 days")).toContain("More than 10×");
	});

	test("spend by model shares sum to one and fall back to tokens when nothing is priced", () => {
		const priced = modelSpend(sessionsInRange(sessions, "30d", NOW));
		expect(priced.basis).toBe("cost");
		expect(priced.rows[0]!.label).toBe("Claude Y");
		expect(priced.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
		const free = modelSpend([session("a", 0, { usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })]);
		expect(free.basis).toBe("tokens");
		expect(free.rows[0]!.share).toBe(1);
		expect(modelSpend([session("old", 200, { modelId: undefined, modelName: undefined })]).rows[0]!.label).toBe("Model not recorded");
		expect(modelSpend([])).toEqual({ rows: [], basis: "tokens" });
	});

	test("the period choice is remembered and defaults to 30 days", () => {
		const data = new Map<string, string>();
		const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
		expect(loadUsageRange(storage)).toBe("30d");
		saveUsageRange("7d", storage);
		expect(loadUsageRange(storage)).toBe("7d");
		expect(loadUsageRange({ getItem: () => "forever", setItem: () => {} })).toBe("30d");
		expect(loadUsageRange({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toBe("30d");
	});
});

describe("hosted charges", () => {
	const gateway = { object: "list", data: [
		{ requestId: "r1", model: "balanced", feature: "keating:chat", state: "succeeded", inputTokens: 1200, outputTokens: 300, billedMicros: 4_500, createdAt: NOW - 1000, completedAt: NOW - 500, did: "did:plc:secret", requestHash: "h", reservationId: "x" },
		{ requestId: "r2", model: "fast", feature: "keating:search", state: "failed", createdAt: NOW - 5000 },
		{ requestId: "r3", model: "", state: "succeeded", createdAt: NOW },
		{ model: "balanced", state: "running", createdAt: NOW - 100, billedMicros: -3 },
		"junk", null,
	] };

	test("keeps only what a learner needs and drops malformed rows", () => {
		const charges = normalizeHostedUsage(gateway);
		expect(charges.map((charge) => charge.id)).toEqual([expect.stringContaining("balanced"), "r1", "r2"]);
		expect(charges[1]).toEqual({ id: "r1", at: NOW - 500, model: "balanced", feature: "chat", inputTokens: 1200, outputTokens: 300, billedMicros: 4_500, state: "succeeded" });
		expect(JSON.stringify(charges)).not.toContain("did:plc:secret");
		expect(charges[0]!.billedMicros).toBe(0);
		expect(normalizeHostedUsage(null)).toEqual([]);
		expect(normalizeHostedUsage({ data: "nope" })).toEqual([]);
	});

	test("totals count billed and unbilled requests", () => {
		expect(hostedChargeTotal(normalizeHostedUsage(gateway))).toEqual({ billedMicros: 4_500, requests: 3, unbilled: 2 });
	});

	test("small charges are not rounded to nothing", () => {
		expect(formatMicros(0)).toBe("$0.00");
		expect(formatMicros(4_500)).toBe("under 1¢");
		expect(formatMicros(10_000)).toBe("$0.01");
		expect(formatMicros(12_345_678)).toBe("$12.35");
	});

	test("a failed usage list does not hide a balance that loaded, and the reverse", async () => {
		const wallet = { availableMicros: 5_000_000 };
		const signedOut = await loadHostedCredits({ signedIn: () => false, wallet: async () => wallet, usage: async () => gateway });
		expect(signedOut.status).toBe("signed-out");

		const usageDown = await loadHostedCredits({ signedIn: () => true, wallet: async () => wallet, usage: async () => { throw new Error("503"); } });
		expect(usageDown).toMatchObject({ status: "ready", usageUnavailable: true, charges: [] });
		expect(usageDown.status === "ready" && usageDown.balance).toBeTruthy();

		const walletDown = await loadHostedCredits({ signedIn: () => true, wallet: async () => { throw new Error("503"); }, usage: async () => gateway });
		expect(walletDown).toMatchObject({ status: "ready", balance: null, usageUnavailable: false });
		expect(walletDown.status === "ready" && walletDown.charges).toHaveLength(3);

		const bothDown = await loadHostedCredits({ signedIn: () => true, wallet: async () => { throw new Error("503"); }, usage: async () => { throw new Error("503"); } });
		expect(bothDown.status).toBe("error");
	});
});
