import type { DiagnosticEntry, DiagnosticRuntimeSnapshot } from "./diagnostics";

export type CheckStatus = "ok" | "warning" | "problem";

export interface FixAction {
	label: string;
	/** Settings tab id to open. */
	tab?: string;
	/** Reload the page instead of opening a tab. */
	reload?: boolean;
}

export interface HealthCheck {
	id: string;
	label: string;
	status: CheckStatus;
	detail: string;
	fix?: FixAction;
}

export interface Explanation {
	title: string;
	meaning: string;
	fix?: FixAction;
}

/** Console format directives (%o, %s, %c…) and runs of whitespace make raw messages unreadable. */
export function cleanDiagnosticMessage(message: string, maxLength = 220): string {
	const cleaned = message.replace(/%[osdifOc]/g, "").replace(/[\s^]{2,}/g, " ").trim();
	return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

const RULES: Array<{ test: (e: DiagnosticEntry) => boolean; explain: Explanation }> = [
	{
		test: (e) => /rules of hooks|order of hooks|getSnapshot|hook is null/i.test(e.message),
		explain: {
			title: "The page got out of sync",
			meaning: "Part of the interface crashed, which usually happens right after an update or a live code reload. Reloading fixes it. If it comes back straight after reloading, send a report.",
			fix: { label: "Reload the page", reload: true },
		},
	},
	{
		test: (e) => /restoring session/i.test(e.message) && /timed out/i.test(e.message),
		explain: {
			title: "Couldn't restore your last session",
			meaning: "Loading your saved session timed out. Check your connection, and that the Keating server is running if you host it yourself.",
			fix: { label: "Reload the page", reload: true },
		},
	},
	{
		test: (e) => e.source === "auth" && /api key storage failed/i.test(e.message),
		explain: {
			title: "Couldn't save an API key",
			meaning: "Your device's secure storage refused the write, so the key wasn't kept.",
			fix: { label: "Review provider keys", tab: "models" },
		},
	},
	{
		test: (e) => e.source === "auth" && /sign-in (failed|could not start)/i.test(e.message),
		explain: {
			title: "Sign-in didn't finish",
			meaning: "The provider sign-in was cancelled, expired, or blocked by the browser (pop-up or cookie settings).",
			fix: { label: "Try signing in again", tab: "models" },
		},
	},
	{
		test: (e) => e.source === "model" && /selection failed/i.test(e.message),
		explain: {
			title: "A model couldn't be selected",
			meaning: "The model you picked isn't available right now, so Keating stayed on the previous one.",
			fix: { label: "Choose a model", tab: "models" },
		},
	},
	{
		test: (e) => e.source === "analytics",
		explain: {
			title: "Usage analytics couldn't be sent",
			meaning: "This is harmless: chat and sign-in work normally. Ad blockers commonly cause it.",
		},
	},
	{
		test: (e) => e.source === "stream" && e.level !== "info",
		explain: {
			title: "A reply was interrupted",
			meaning: "The connection to the model dropped mid-reply. Retrying usually works; if it keeps happening, check your key and connection.",
			fix: { label: "Check provider keys", tab: "models" },
		},
	},
];

export function explainDiagnostic(entry: DiagnosticEntry): Explanation {
	const match = RULES.find((rule) => rule.test(entry));
	if (match) return match.explain;
	return {
		title: entry.level === "error" ? "Something went wrong" : "Heads up",
		meaning: cleanDiagnosticMessage(entry.message),
	};
}

export interface ExplainedGroup {
	explanation: Explanation;
	level: "warning" | "error";
	count: number;
	lastSeen: string;
}

/** Collapse repeated warnings and errors into one plain-language line each, newest first. */
export function groupProblems(entries: readonly DiagnosticEntry[]): ExplainedGroup[] {
	const groups = new Map<string, ExplainedGroup>();
	for (const entry of entries) {
		if (entry.level === "info") continue;
		const explanation = explainDiagnostic(entry);
		const key = `${entry.level}:${explanation.title}:${explanation.title === "Something went wrong" ? entry.message : ""}`;
		const existing = groups.get(key);
		if (existing) {
			existing.count += 1;
			if (entry.timestamp > existing.lastSeen) existing.lastSeen = entry.timestamp;
		} else {
			groups.set(key, { explanation, level: entry.level, count: 1, lastSeen: entry.timestamp });
		}
	}
	return [...groups.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function buildHealthChecks(input: {
	runtime: DiagnosticRuntimeSnapshot;
	entries: readonly DiagnosticEntry[];
	connectedProviderCount: number;
}): HealthCheck[] {
	const { runtime, entries, connectedProviderCount } = input;
	const recentErrors = entries.filter((e) => e.level === "error").length;
	return [
		{
			id: "network",
			label: "Internet connection",
			status: runtime.online === false ? "problem" : "ok",
			detail: runtime.online === false ? "Your browser reports that you're offline." : "Connected.",
		},
		{
			id: "provider",
			label: "Model access",
			status: connectedProviderCount > 0 ? "ok" : "problem",
			detail: connectedProviderCount > 0
				? `${connectedProviderCount} provider${connectedProviderCount === 1 ? "" : "s"} connected.`
				: "No provider is connected, so Keating can't answer yet.",
			...(connectedProviderCount > 0 ? {} : { fix: { label: "Connect a provider", tab: "models" } }),
		},
		{
			id: "storage",
			label: "Saved data",
			status: runtime.localStorageAvailable && runtime.indexedDbAvailable ? "ok" : "problem",
			detail: runtime.localStorageAvailable && runtime.indexedDbAvailable
				? "Settings and sessions can be saved on this device."
				: "Browser storage is blocked (private window or strict privacy settings). Settings and sessions won't persist.",
		},
		{
			id: "errors",
			label: "Recent errors",
			status: recentErrors === 0 ? "ok" : "warning",
			detail: recentErrors === 0 ? "None in this session." : `${recentErrors} error${recentErrors === 1 ? "" : "s"} this session. See what happened below.`,
		},
	];
}

export function overallStatus(checks: readonly HealthCheck[]): CheckStatus {
	if (checks.some((c) => c.status === "problem")) return "problem";
	if (checks.some((c) => c.status === "warning")) return "warning";
	return "ok";
}

const STATUS_WORD: Record<CheckStatus, string> = { ok: "OK", warning: "WARNING", problem: "PROBLEM" };

/** Plain-text summary a learner can paste into a message or issue without opening a JSON report. */
export function buildHealthText(input: { checks: readonly HealthCheck[]; problems: readonly ExplainedGroup[] }): string {
	const lines = ["Keating health check", ""];
	for (const c of input.checks) lines.push(`[${STATUS_WORD[c.status]}] ${c.label}: ${c.detail}`);
	if (input.problems.length > 0) {
		lines.push("", "What happened:");
		for (const g of input.problems) {
			lines.push(`- ${g.explanation.title}${g.count > 1 ? ` (${g.count}x)` : ""} [${g.level}] ${g.explanation.meaning}`);
		}
	}
	return `${lines.join("\n")}\n`;
}
