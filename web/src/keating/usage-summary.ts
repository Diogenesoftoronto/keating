/**
 * Numbers behind the usage panel: activity and spend for a chosen period, the
 * change against the period before it, spend by model, and hosted-credit
 * charges. Pure, so what the panel claims can be tested.
 *
 * A session is counted in the period it was last active. A long-running
 * session is therefore attributed to its most recent day, which the panel
 * states next to the period control.
 */
import type { SessionMetadata } from "../types/session";

export const USAGE_RANGES = ["7d", "30d", "90d", "all"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];
export const USAGE_RANGE_LABELS: Record<UsageRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" };
const RANGE_DAYS: Record<Exclude<UsageRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

export interface UsageTotals {
	sessions: number;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	tokens: number;
	cost: number;
	/** Distinct calendar days with at least one session last active on them. */
	activeDays: number;
}

export interface UsageWindow {
	range: UsageRange;
	current: UsageTotals;
	/** The equally long period immediately before. Absent for "all time". */
	previous?: UsageTotals;
}

function activeAt(session: SessionMetadata): number {
	const parsed = Date.parse(session.lastModified);
	return Number.isFinite(parsed) ? parsed : 0;
}

const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function summarizeUsage(sessions: readonly SessionMetadata[]): UsageTotals {
	const days = new Set<string>();
	const totals: UsageTotals = { sessions: 0, messages: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, tokens: 0, cost: 0, activeDays: 0 };
	for (const session of sessions) {
		const usage = session.usage;
		totals.sessions += 1;
		totals.messages += count(session.messageCount);
		totals.inputTokens += count(usage?.input);
		totals.outputTokens += count(usage?.output);
		totals.cachedTokens += count(usage?.cacheRead);
		// Some providers omit a total; fall back to what was reported.
		totals.tokens += count(usage?.totalTokens) || count(usage?.input) + count(usage?.output);
		totals.cost += count(usage?.cost?.total);
		const at = activeAt(session);
		if (at) {
			const day = new Date(at);
			days.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
		}
	}
	totals.activeDays = days.size;
	return totals;
}

export function sessionsInRange(sessions: readonly SessionMetadata[], range: UsageRange, now = Date.now()): SessionMetadata[] {
	if (range === "all") return [...sessions];
	const start = now - RANGE_DAYS[range] * DAY_MS;
	return sessions.filter((session) => { const at = activeAt(session); return at > start && at <= now; });
}

export function usageWindow(sessions: readonly SessionMetadata[], range: UsageRange, now = Date.now()): UsageWindow {
	const current = summarizeUsage(sessionsInRange(sessions, range, now));
	if (range === "all") return { range, current };
	const length = RANGE_DAYS[range] * DAY_MS;
	const previous = summarizeUsage(sessions.filter((session) => { const at = activeAt(session); return at > now - 2 * length && at <= now - length; }));
	return { range, current, previous };
}

/**
 * Change against the previous period, in words. Returns null when there is
 * nothing to compare with, so the panel never shows "+100%" from zero.
 */
export function describeChange(current: number, previous: number | undefined, rangeLabel: string): string | null {
	if (previous === undefined) return null;
	if (previous === 0) return current === 0 ? null : `None in the previous ${rangeLabel}`;
	if (current === previous) return `Same as the previous ${rangeLabel}`;
	const percent = Math.round(Math.abs(current - previous) / previous * 100);
	if (percent === 0) return `About the same as the previous ${rangeLabel}`;
	return `${percent > 999 ? "More than 10×" : `${percent}%`} ${current > previous ? "more" : "less"} than the previous ${rangeLabel}`;
}

export interface ModelSpend {
	key: string;
	label: string;
	sessions: number;
	messages: number;
	tokens: number;
	cost: number;
	/** Share of the period's cost, or of tokens when nothing in the period was priced. */
	share: number;
}

export function modelSpend(sessions: readonly SessionMetadata[]): { rows: ModelSpend[]; basis: "cost" | "tokens" } {
	const groups = new Map<string, ModelSpend>();
	for (const session of sessions) {
		const id = session.modelId ?? session.modelName;
		const key = id ? `${session.modelProvider ?? ""}:${id}` : "unknown";
		const group = groups.get(key) ?? {
			key,
			label: session.modelName ?? session.modelId ?? "Model not recorded",
			sessions: 0, messages: 0, tokens: 0, cost: 0, share: 0,
		};
		group.sessions += 1;
		group.messages += count(session.messageCount);
		group.tokens += count(session.usage?.totalTokens) || count(session.usage?.input) + count(session.usage?.output);
		group.cost += count(session.usage?.cost?.total);
		groups.set(key, group);
	}
	const rows = [...groups.values()];
	const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
	const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
	const basis = totalCost > 0 ? "cost" : "tokens";
	for (const row of rows) row.share = basis === "cost" ? row.cost / totalCost : totalTokens > 0 ? row.tokens / totalTokens : 0;
	rows.sort((a, b) => b.share - a.share || b.sessions - a.sessions || a.label.localeCompare(b.label));
	return { rows, basis };
}

export interface HostedCharge {
	id: string;
	at: number;
	model: string;
	/** What the request was for, e.g. chat or search. */
	feature?: string;
	inputTokens: number;
	outputTokens: number;
	/** Credits charged, in millionths of a dollar. Zero when the request was not billed. */
	billedMicros: number;
	state: string;
}

/**
 * Reads the gateway's usage list. The gateway returns its full request rows;
 * only the fields a learner needs are kept, and anything malformed is dropped.
 */
export function normalizeHostedUsage(input: unknown): HostedCharge[] {
	const data = input && typeof input === "object" && Array.isArray((input as { data?: unknown }).data) ? (input as { data: unknown[] }).data : [];
	const charges: HostedCharge[] = [];
	for (const value of data) {
		if (!value || typeof value !== "object") continue;
		const row = value as Record<string, unknown>;
		const at = typeof row.completedAt === "number" ? row.completedAt : typeof row.createdAt === "number" ? row.createdAt : NaN;
		if (!Number.isFinite(at) || typeof row.model !== "string" || !row.model) continue;
		charges.push({
			id: typeof row.requestId === "string" && row.requestId ? row.requestId : `${at}:${row.model}:${charges.length}`,
			at,
			model: row.model.slice(0, 120),
			...(typeof row.feature === "string" && row.feature ? { feature: row.feature.replace(/^keating:/, "").slice(0, 60) } : {}),
			inputTokens: count(row.inputTokens),
			outputTokens: count(row.outputTokens),
			billedMicros: Number.isSafeInteger(row.billedMicros) && (row.billedMicros as number) > 0 ? row.billedMicros as number : 0,
			state: typeof row.state === "string" ? row.state.slice(0, 40) : "unknown",
		});
	}
	return charges.sort((a, b) => b.at - a.at);
}

export function hostedChargeTotal(charges: readonly HostedCharge[]): { billedMicros: number; requests: number; unbilled: number } {
	return {
		billedMicros: charges.reduce((sum, charge) => sum + charge.billedMicros, 0),
		requests: charges.length,
		unbilled: charges.filter((charge) => charge.billedMicros === 0).length,
	};
}

/** Dollars from millionths, shown to the cent, or as "under 1¢" so small charges are not rounded to nothing. */
export function formatMicros(micros: number): string {
	if (micros <= 0) return "$0.00";
	if (micros < 10_000) return "under 1¢";
	return `$${(micros / 1_000_000).toFixed(2)}`;
}

const RANGE_KEY = "keating:usage-range:v1";
type RangeStorage = Pick<Storage, "getItem" | "setItem">;
function deviceStorage(): RangeStorage | null {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
export function loadUsageRange(storage: RangeStorage | null = deviceStorage()): UsageRange {
	try { return USAGE_RANGES.find((range) => range === storage?.getItem(RANGE_KEY)) ?? "30d"; } catch { return "30d"; }
}
export function saveUsageRange(range: UsageRange, storage: RangeStorage | null = deviceStorage()): void {
	try { storage?.setItem(RANGE_KEY, range); } catch { /* A remembered period is a convenience only. */ }
}
