import { Suspense, use, useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenCheck, Brain, CalendarDays, ChevronRight, Clock3, Cpu, Download, Flame, Gem, MessageSquareText, TrendingUp, Upload } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { UsageCharts } from "../components/UsageCharts";
import { downloadTextFile } from "../lib/browser-download";
import {
	buildKeatingPortableDataBundle,
	importKeatingPortableDataBundle,
	parseKeatingPortableDataBundle,
	type KeatingPortableImportResult,
} from "../keating/portable-data";
import { css, cx } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { LearningInsightsHeader, LearningMetric } from "../components/LearningInsightsHeader";
import { HostedCreditsPanel } from "../components/usage/HostedCreditsPanel";
import {
	USAGE_RANGES,
	USAGE_RANGE_LABELS,
	describeChange,
	loadUsageRange,
	modelSpend,
	saveUsageRange,
	sessionsInRange,
	usageWindow,
	type UsageRange,
} from "../keating/usage-summary";

let metadataPromise: Promise<SessionMetadata[]> | null = null;

function formatNumber(value: number) {
	return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number) {
	return value > 0 ? `$${value.toFixed(value < 1 ? 4 : 2)}` : "$0";
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function firstSentence(text: string) {
	const clean = text
		.replace(/Learner Profile:[\s\S]*$/i, "")
		.replace(/Feedback:[\s\S]*$/i, "")
		.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	return clean.split(/[.!?]\s/)[0]?.slice(0, 220) || "No preview saved";
}

function sessionModelLabel(session: SessionMetadata): string | null {
	const model = session.modelName?.trim() || session.modelId?.trim();
	if (!model) return null;
	const provider = session.modelProvider?.trim();
	return provider ? `${provider}/${model}` : model;
}

const styles = {
	page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
	main: css({ mx: "auto", minW: 0, maxW: "72rem", overflow: "hidden", px: "1rem", py: "1.5rem" }),
	metricGrid: css({ display: "grid", minW: 0, gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, lg: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }),
	metricGridThree: css({ mt: "1.5rem", display: "grid", minW: 0, gap: "0.75rem", sm: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	panel: css({ mt: "1.5rem", overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--card)" }),
	panelHeader: css({ borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	panelTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	panelSubtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	truncate: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
	actionRow: css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", xl: { justifyContent: "flex-end" } }),
	button: css({ display: "inline-flex", minH: "2.25rem", minW: 0, maxW: "100%", py: "0.5rem", overflowWrap: "anywhere", lineHeight: "1.4", "& svg": { flexShrink: 0 }, alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", px: "0.75rem", fontSize: "0.875rem" }),
	primaryButton: css({ bg: "var(--primary)", fontWeight: "500", color: "var(--primary-foreground)", _hover: { bg: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.5 } }),
	borderButton: css({ border: "1px solid var(--border)", _hover: { bg: "var(--accent)" }, _disabled: { opacity: 0.5 } }),
	fileLabel: css({ cursor: "pointer", "&:has(:disabled)": { cursor: "not-allowed", opacity: 0.5 } }),
	srOnly: css({ position: "absolute", w: "1px", h: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 }),
	error: css({ maxW: "24rem", fontSize: "0.75rem", color: "var(--destructive)" }),
	portableBody: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", p: "1rem" }),
	inlineLabel: css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }),
	basisFull: css({ flexBasis: "100%", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	errorFull: css({ flexBasis: "100%", fontSize: "0.75rem", color: "var(--destructive)" }),
	contentGrid: css({ mt: "1.5rem", display: "grid", minW: 0, gap: "1.5rem", lg: { gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.75fr)" } }),
	section: css({ minW: 0, overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--card)" }),
	dividerList: css({ "& > * + *": { borderTop: "1px solid var(--border)" } }),
	emptyState: css({ px: "1rem", py: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	stack3: css({ "& > * + *": { mt: "0.75rem" }, p: "1rem" }),
	deepButton: css({ display: "flex", w: "100%", minW: 0, cursor: "pointer", alignItems: "flex-start", gap: "0.75rem", borderRadius: "0.375rem", p: "0.5rem", textAlign: "left", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	rankBox: css({ display: "flex", h: "1.75rem", w: "1.75rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", bg: "var(--muted)", fontSize: "0.75rem", fontWeight: "500" }),
	flex1: css({ minW: 0, flex: "1 1 0%" }),
	lineClamp2: css({ overflow: "hidden", textOverflow: "ellipsis", lineClamp: 2 }),
	metaRow: css({ mt: "0.25rem", display: "flex", minW: 0, flexWrap: "wrap", alignItems: "center", columnGap: "0.5rem", rowGap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	sessionRow: css({ display: "flex", minH: "9rem", w: "100%", minW: 0, cursor: "pointer", flexDir: "column", gap: "0.75rem", px: "1rem", py: "0.75rem", textAlign: "left", transitionProperty: "background-color", transitionDuration: "150ms", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }),
	sessionTitle: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: "500" }),
	sessionPreview: css({ mt: "0.5rem", overflow: "hidden", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)", lineClamp: 4 }),
	badgeRow: css({ display: "flex", minW: 0, flexWrap: "wrap", gap: "0.5rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	badge: css({ display: "inline-flex", minW: 0, alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", bg: "var(--muted)", px: "0.5rem", py: "0.25rem" }),
	shrink0: css({ flexShrink: 0 }),
	rangeBar: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", mb: "1rem" }),
	rangeGroup: css({ display: "inline-flex", flexWrap: "wrap", gap: "0.4rem" }),
	rangeButton: css({ minH: "2.75rem", px: "0.85rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", bg: "var(--card)", color: "var(--ink)", fontSize: "0.8125rem", cursor: "pointer", transitionProperty: "background-color, color, border-color", transitionDuration: "{durations.fast}", transitionTimingFunction: "{easings.standard}", _hover: { borderColor: "var(--ink)" }, "&[aria-pressed=true]": { bg: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)", fontWeight: "650" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } }),
	rangeEmpty: css({ mb: "1rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", px: "1rem", py: "0.75rem", fontSize: "0.875rem" }),
	linkButton: css({ textDecoration: "underline", cursor: "pointer", minH: "2rem", _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } }),
	spendWrap: css({ overflowX: "auto", px: "1rem", py: "0.75rem" }),
	spendTable: css({ w: "100%", minW: "32rem", borderCollapse: "collapse", fontSize: "0.8125rem" }),
	spendTh: css({ textAlign: "left", fontWeight: "600", fontSize: "0.75rem", color: "var(--muted-foreground)", px: "0.5rem", py: "0.4rem", borderBottom: "1px solid var(--border)" }),
	spendTd: css({ px: "0.5rem", py: "0.5rem", borderBottom: "1px solid var(--border)", fontVariantNumeric: "tabular-nums", fontWeight: "400" }),
	spendModel: css({ textAlign: "left", overflowWrap: "anywhere", fontWeight: "500" }),
	right: css({ textAlign: "right" }),
	shareRow: css({ display: "flex", alignItems: "center", gap: "0.5rem", minW: "8rem" }),
	shareTrack: css({ flex: "1 1 0%", h: "0.5rem", borderRadius: "0.125rem", bg: "var(--muted)", overflow: "hidden" }),
	shareFill: css({ w: "100%", h: "100%", bg: "var(--ink)", transformOrigin: "left center", transitionProperty: "transform", transitionDuration: "{durations.base}", transitionTimingFunction: "{easings.standard}" }),
	centerContent: css({ display: "flex", minH: "16rem", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "var(--ink-soft)" }),
};

function useSessionMetadata() {
	use(getInitPromise());
	if (!metadataPromise) {
		metadataPromise = sessions.getAllMetadata();
	}
	return use(metadataPromise);
}

function PortableDataPanel() {
	const posthog = usePostHog();
	const [includeSandbox, setIncludeSandbox] = useState(true);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string>("");
	const [error, setError] = useState("");

	const handlePortableExport = async () => {
		setBusy(true);
		setError("");
		setResult("");
		try {
			const bundle = await buildKeatingPortableDataBundle({ includeSandbox });
			downloadTextFile("keating-portable-data.json", `${JSON.stringify(bundle, null, 2)}\n`);
			posthog?.capture("portable_data_exported", {
				success: true,
				include_sandbox: includeSandbox,
				session_count: bundle.sessions.length,
				feedback_count: bundle.storage.feedback.length,
			});
			setResult(`Exported ${formatNumber(bundle.sessions.length)} sessions and ${formatNumber(bundle.storage.feedback.length)} feedback records.`);
		} catch (err) {
			posthog?.capture("portable_data_exported", {
				success: false,
				include_sandbox: includeSandbox,
				failure_type: err instanceof Error ? err.name : "unknown",
			});
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const summarizeImport = (imported: KeatingPortableImportResult) => {
		const artifactCount =
			imported.lessonPlans +
			imported.lessonMaps +
			imported.animations +
			imported.verifications +
			imported.benchmarks +
			imported.evolutions +
			imported.promptEvolutions +
			imported.improvements +
			imported.quizResults;
		return `Imported ${formatNumber(imported.sessions)} sessions, ${formatNumber(imported.feedback)} feedback records, ${formatNumber(artifactCount)} artifacts, ${formatNumber(imported.goals)} goals, and ${formatNumber(imported.sandboxCommitsImported)} sandbox commits.`;
	};

	const handlePortableImport = async (file: File | null) => {
		if (!file) return;
		setBusy(true);
		setError("");
		setResult("");
		try {
			const text = await file.text();
			const bundle = parseKeatingPortableDataBundle(JSON.parse(text));
			const imported = await importKeatingPortableDataBundle(bundle);
			metadataPromise = null;
			posthog?.capture("portable_data_imported", {
				success: true,
				session_count: imported.sessions,
				feedback_count: imported.feedback,
				sandbox_commit_count: imported.sandboxCommitsImported,
			});
			setResult(summarizeImport(imported));
		} catch (err) {
			posthog?.capture("portable_data_imported", {
				success: false,
				failure_type: err instanceof Error ? err.name : "unknown",
			});
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className={styles.panel}>
			<div className={styles.panelHeader}>
				<h2 className={styles.panelTitle}>Portable data</h2>
				<p className={styles.panelSubtitle}>Move Keating sessions, learner state, artifacts, goals, and sandbox history between browsers.</p>
			</div>
			<div className={styles.portableBody}>
				<label className={styles.inlineLabel}>
					<input
						type="checkbox"
						checked={includeSandbox}
						onChange={(event) => setIncludeSandbox(event.target.checked)}
					/>
					Include sandbox code history
				</label>
				<div className={styles.actionRow}>
					<button
						type="button"
						className={cx(styles.button, styles.borderButton)}
						onClick={handlePortableExport}
						disabled={busy}
					>
						<Download size={16} />
						Export portable JSON
					</button>
					<label className={cx(styles.button, styles.primaryButton, styles.fileLabel)}>
						<Upload size={16} />
						Import portable JSON
						<input
							type="file"
							accept="application/json,.json"
							className={styles.srOnly}
							disabled={busy}
							onChange={(event) => {
								const file = event.target.files?.[0] ?? null;
								void handlePortableImport(file);
								event.currentTarget.value = "";
							}}
						/>
					</label>
				</div>
				{result && <div className={styles.basisFull}>{result}</div>}
				{error && <div className={styles.errorFull}>{error}</div>}
			</div>
		</section>
	);
}

function useArtifactMetrics() {
	const [metrics, setMetrics] = useState<{
		plans: number; maps: number; animations: number;
		benchmarks: number; evolutions: number; promptEvolutions: number; improvements: number;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			keatingStorage.getLessonPlans(),
			keatingStorage.getLessonMaps(),
			keatingStorage.getAnimations(),
			keatingStorage.getBenchmarks(),
			keatingStorage.getEvolutions(),
			keatingStorage.getPromptEvolutions(),
			keatingStorage.getImprovementAttempts(),
		]).then(([plans, maps, animations, benchmarks, evolutions, promptEvolutions, improvements]) => {
			if (!cancelled) {
				setMetrics({ plans: plans.length, maps: maps.length, animations: animations.length, benchmarks: benchmarks.length, evolutions: evolutions.length, promptEvolutions: promptEvolutions.length, improvements: improvements.length });
			}
		}).catch(() => {});
		return () => { cancelled = true; };
	}, []);

	return metrics;
}

function UsageContent() {
	const navigate = useNavigate();
	const allSessions = useSessionMetadata();
	// Sort a copy: the cached list is shared with other readers of the same promise.
	const metadata = useMemo(() => [...allSessions].sort((a, b) => b.lastModified.localeCompare(a.lastModified)), [allSessions]);
	const artifactMetrics = useArtifactMetrics();
	const [range, setRange] = useState<UsageRange>(loadUsageRange);
	const chooseRange = (next: UsageRange) => { setRange(next); saveUsageRange(next); };
	const window_ = useMemo(() => usageWindow(metadata, range), [metadata, range]);
	const inRange = useMemo(() => sessionsInRange(metadata, range), [metadata, range]);
	const spend = useMemo(() => modelSpend(inRange), [inRange]);
	const totals = window_.current;
	const previous = window_.previous;
	const rangeLabel = USAGE_RANGE_LABELS[range].toLowerCase();
	const change = (current: number, before: number | undefined) => describeChange(current, before, rangeLabel);
	const recent = inRange.slice(0, 8);
	const deepest = [...inRange].sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
	const dailyMessages = totals.activeDays ? totals.messages / totals.activeDays : 0;
	const emptyRange = metadata.length > 0 && inRange.length === 0;

	const selfImprovement = artifactMetrics ? artifactMetrics.benchmarks + artifactMetrics.evolutions + artifactMetrics.promptEvolutions + artifactMetrics.improvements : 0;
	const teachingMats = artifactMetrics ? artifactMetrics.plans + artifactMetrics.maps + artifactMetrics.animations : 0;
	const openSession = (sessionId: string) => navigate({ to: "/chat", search: { session: sessionId } });

	return (
		<>
			<LearningInsightsHeader
				current="usage"
				context="Learning intelligence // Activity"
				title="Learning activity"
				description="Your sessions, learning materials, model usage, and improvement history in one local-first view."
			/>
			<main className={styles.main}>
				<div className={styles.rangeBar}>
					<div role="group" aria-label="Period" className={styles.rangeGroup}>
						{USAGE_RANGES.map((option) => (
							<button key={option} type="button" aria-pressed={range === option} className={styles.rangeButton} onClick={() => chooseRange(option)}>
								{USAGE_RANGE_LABELS[option]}
							</button>
						))}
					</div>
					<p className={styles.panelSubtitle}>
						{range === "all" ? `All ${formatNumber(metadata.length)} saved sessions on this device.` : `Sessions last active in the past ${rangeLabel}, on this device.`}
					</p>
				</div>
				{emptyRange && (
					<p role="status" className={styles.rangeEmpty}>
						Nothing in the past {rangeLabel}. <button type="button" className={styles.linkButton} onClick={() => chooseRange("all")}>Show all time</button>
					</p>
				)}
				<div className={styles.metricGrid}>
					<LearningMetric
						icon={<BookOpenCheck size={18} />}
						label="Learning sessions"
						value={formatNumber(totals.sessions)}
						detail={change(totals.sessions, previous?.sessions) ?? (totals.sessions ? `${totals.activeDays} active ${totals.activeDays === 1 ? "day" : "days"}` : "No sessions yet")}
					/>
					<LearningMetric
						icon={<MessageSquareText size={18} />}
						label="Socratic turns"
						value={formatNumber(totals.messages)}
						detail={change(totals.messages, previous?.messages) ?? `${dailyMessages.toFixed(1)} messages per active day`}
					/>
					<LearningMetric
						icon={<Brain size={18} />}
						label="Model tokens"
						value={formatNumber(totals.tokens)}
						detail={`${formatNumber(totals.inputTokens)} in / ${formatNumber(totals.outputTokens)} out${totals.cachedTokens ? ` · ${formatNumber(totals.cachedTokens)} cached` : ""}`}
					/>
					<LearningMetric
						icon={<TrendingUp size={18} />}
						label="Estimated spend"
						value={formatCost(totals.cost)}
						detail={change(totals.cost, previous?.cost) ?? "From the usage each provider reported"}
					/>
				</div>

				<section className={styles.panel} aria-labelledby="model-spend-heading">
					<div className={styles.panelHeader}>
						<h2 id="model-spend-heading" className={styles.panelTitle}>Spend by model</h2>
						<p className={styles.panelSubtitle}>
							{spend.basis === "cost"
								? "Estimated from the token counts and prices each provider reported. Your provider's own bill is the authority."
								: "No prices were reported in this period, so models are compared by tokens."}
						</p>
					</div>
					{spend.rows.length === 0 ? (
						<div className={styles.emptyState}>No model usage in this period.</div>
					) : (
						<div className={styles.spendWrap}>
							<table className={styles.spendTable}>
								<thead><tr>
									<th scope="col" className={styles.spendTh}>Model</th>
									<th scope="col" className={cx(styles.spendTh, styles.right)}>Sessions</th>
									<th scope="col" className={cx(styles.spendTh, styles.right)}>Tokens</th>
									<th scope="col" className={cx(styles.spendTh, styles.right)}>Est. cost</th>
									<th scope="col" className={styles.spendTh}>Share of {spend.basis === "cost" ? "spend" : "tokens"}</th>
								</tr></thead>
								<tbody>
									{spend.rows.map((row) => (
										<tr key={row.key}>
											<th scope="row" className={cx(styles.spendTd, styles.spendModel)}>{row.label}</th>
											<td className={cx(styles.spendTd, styles.right)}>{formatNumber(row.sessions)}</td>
											<td className={cx(styles.spendTd, styles.right)}>{formatNumber(row.tokens)}</td>
											<td className={cx(styles.spendTd, styles.right)}>{row.cost > 0 ? formatCost(row.cost) : "Not priced"}</td>
											<td className={styles.spendTd}>
												<div className={styles.shareRow}>
													<div className={styles.shareTrack} aria-hidden="true"><div className={styles.shareFill} style={{ transform: `scaleX(${row.share.toFixed(3)})` }} /></div>
													<span>{Math.round(row.share * 100)}%</span>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				<HostedCreditsPanel />

				{/* Self-improvement vs Learning distinction */}
				<div className={styles.metricGridThree}>
					<LearningMetric
						icon={<Gem size={18} />}
						label="Teaching materials"
						value={formatNumber(teachingMats)}
						detail={`${formatNumber(artifactMetrics?.plans ?? 0)} plans · ${formatNumber(artifactMetrics?.maps ?? 0)} maps · ${formatNumber(artifactMetrics?.animations ?? 0)} animations`}
					/>
					<LearningMetric
						icon={<Cpu size={18} />}
						label="Self-improvement runs"
						value={formatNumber(selfImprovement)}
						detail={`${formatNumber(artifactMetrics?.evolutions ?? 0)} evolutions · ${formatNumber(artifactMetrics?.promptEvolutions ?? 0)} prompt evos`}
					/>
					<LearningMetric
						icon={<Flame size={18} />}
						label="Improvement attempts"
						value={formatNumber(artifactMetrics?.improvements ?? 0)}
						detail={artifactMetrics && artifactMetrics.improvements > 0 ? `${formatNumber(artifactMetrics.benchmarks)} benchmarks measured` : "No improvements logged yet"}
					/>
				</div>

				<PortableDataPanel />
				<div className={styles.panelHeader}><Link to="/training-data">Prepare a training dataset <ChevronRight size={16} /></Link><p className={styles.panelSubtitle}>Filter, inspect, import, and download training data in its dedicated workspace.</p></div>

				<div className={styles.contentGrid}>
					<section className={styles.section}>
						<div className={styles.panelHeader}>
							<h2 className={styles.panelTitle}>Recent learning</h2>
							<p className={styles.panelSubtitle}>Latest saved sessions in this period and their focus</p>
						</div>
						<div className={styles.dividerList}>
							{recent.length === 0 ? (
								<div className={styles.emptyState}>
									{emptyRange ? "No sessions in this period." : "Start a chat and Keating will track your learning activity here."}
								</div>
							) : recent.map((session) => (
								<SessionRow key={session.id} session={session} onOpen={openSession} />
							))}
						</div>
					</section>

					<section className={styles.section}>
						<div className={styles.panelHeader}>
							<h2 className={styles.panelTitle}>Deepest dives</h2>
							<p className={styles.panelSubtitle}>Sessions with the most back-and-forth in this period</p>
						</div>
						<div className={styles.stack3}>
							{deepest.length === 0 ? (
								<div className={styles.emptyState}>{emptyRange ? "No sessions in this period." : "No learning history yet"}</div>
							) : deepest.map((session, index) => (
								<button key={session.id} type="button" className={styles.deepButton} onClick={() => openSession(session.id)}>
									<div className={styles.rankBox}>
										{index + 1}
									</div>
									<div className={styles.flex1}>
										<div className={cx(styles.lineClamp2, css({ fontSize: "0.875rem", fontWeight: "500" }))}>
											{session.title}
										</div>
										<div className={styles.metaRow}>
											<Clock3 size={13} />
											<span>{session.messageCount} messages</span>
											<span aria-hidden="true">|</span>
											<span>{formatDate(session.lastModified)}</span>
										</div>
									</div>
									<ChevronRight size={16} className={styles.shrink0} aria-hidden="true" />
								</button>
							))}
						</div>
					</section>
				</div>

				<UsageCharts sessionMetadata={metadata} onOpenSession={openSession} />
			</main>
		</>
	);
}

function SessionRow({ session, onOpen }: { session: SessionMetadata; onOpen: (sessionId: string) => void }) {
	const tokens = session.usage.totalTokens || session.usage.input + session.usage.output;
	const modelLabel = sessionModelLabel(session);
	return (
		<button type="button" className={styles.sessionRow} onClick={() => onOpen(session.id)} aria-label={`Open session ${session.title}`}>
			<div className={styles.flex1}>
				<div className={styles.sessionTitle}>{session.title}</div>
				<p className={styles.sessionPreview}>
					{firstSentence(session.preview)}
				</p>
			</div>
			<div className={styles.badgeRow}>
				<span className={styles.badge}>
					<CalendarDays size={12} className={styles.shrink0} />
					<span className={styles.truncate}>{formatDate(session.lastModified)}</span>
				</span>
				<span className={styles.badge}>
					<MessageSquareText size={12} className={styles.shrink0} />
					<span className={styles.truncate}>{session.messageCount} turns</span>
				</span>
				<span className={styles.badge}>
					<Brain size={12} className={styles.shrink0} />
					<span className={styles.truncate}>{formatNumber(tokens)} tokens</span>
				</span>
				{modelLabel && (
					<span className={styles.badge}>
						<Cpu size={12} className={styles.shrink0} />
						<span className={styles.truncate}>{modelLabel}</span>
					</span>
				)}
				<span className={styles.badge}>
					<Brain size={12} className={styles.shrink0} />
					<span className={styles.truncate}>Thinking: {session.thinkingLevel}</span>
				</span>
				<span className={styles.badge}>
					<span>Open session</span>
					<ChevronRight size={12} className={styles.shrink0} />
				</span>
			</div>
		</button>
	);
}

export function Usage() {
	useSeo({
		title: "Keating Dashboard — Usage & Analytics",
		description: "View your Keating usage statistics, session history, and learning analytics.",
		canonical: "https://keating.help/usage",
	});
	return (
		<div className={cx("retro-layout", "retro-page", styles.page)}>
			<Nav />
			<Suspense fallback={
				<div className={styles.centerContent}>
					Loading usage...
				</div>
			}>
				<UsageContent />
			</Suspense>
		</div>
	);
}
