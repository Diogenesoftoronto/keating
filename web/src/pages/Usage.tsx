import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpenCheck, Brain, CalendarDays, Clock3, Cpu, Download, Flame, Gem, MessageSquareText, TrendingUp, Upload } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { UsageCharts } from "../components/UsageCharts";
import { buildWebFineTuneExport, type WebExportSource, type WebFineTuneFormat } from "../keating/export";
import { importFineTuneFiles, type WebFineTuneImportResult } from "../keating/import";
import { downloadTextFile } from "../lib/browser-download";
import {
	buildKeatingPortableDataBundle,
	importKeatingPortableDataBundle,
	parseKeatingPortableDataBundle,
	type KeatingPortableImportResult,
} from "../keating/portable-data";
import { css, cx } from "../../styled-system/css";

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

function daysBetween(start: string, end: string) {
	return Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1);
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
	page: css({ minH: "100vh", bg: "var(--background)", color: "var(--foreground)", fontFamily: "monospace" }),
	header: css({ borderBottom: "1px solid var(--border)" }),
	headerInner: css({ mx: "auto", display: "flex", maxW: "72rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", px: "1rem", py: "1rem" }),
	kicker: css({ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }),
	title: css({ fontSize: "1.5rem", fontWeight: "600" }),
	main: css({ mx: "auto", minW: 0, maxW: "72rem", overflow: "hidden", px: "1rem", py: "1.5rem" }),
	metricGrid: css({ display: "grid", minW: 0, gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, lg: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }),
	metricGridThree: css({ mt: "1.5rem", display: "grid", minW: 0, gap: "0.75rem", sm: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	card: css({ minW: 0, borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--background)", p: "1rem" }),
	cardHead: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
	cardLabel: css({ fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	muted: css({ color: "var(--muted-foreground)" }),
	cardValue: css({ mt: "0.75rem", fontSize: "1.5rem", fontWeight: "600" }),
	cardDetail: css({ mt: "0.25rem", minW: 0, overflowWrap: "break-word", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	controlWrap: css({ w: "100%", maxW: "100%", sm: { minW: "18rem", flex: "1 1 0%" }, lg: { minW: "22rem" } }),
	labelText: css({ mb: "0.5rem", fontSize: "0.75rem", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }),
	segmented: css({ display: "grid", minW: 0, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", overflow: "hidden", borderRadius: "0.375rem", border: "1px solid var(--border)", sm: { display: "flex", flexWrap: "nowrap", overflowX: "auto" } }),
	segmentButton: css({ minW: 0, whiteSpace: "nowrap", px: "0.375rem", py: "0.125rem", fontSize: "10px", transitionProperty: "color, background-color", transitionDuration: "150ms", sm: { minW: "max-content", flex: "1 0 auto", px: "0.5rem", py: "0.25rem", fontSize: "11px" }, lg: { px: "0.75rem", py: "0.375rem", fontSize: "0.75rem" } }),
	segmentActive: css({ bg: "var(--primary)", color: "var(--primary-foreground)" }),
	segmentInactive: css({ _hover: { bg: "var(--accent)" } }),
	panel: css({ mt: "1.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--background)" }),
	panelHeader: css({ borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	panelTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	panelSubtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	exportBody: css({ display: "flex", minW: 0, flexDir: "column", gap: "1rem", p: "1rem", xl: { flexDir: "row", alignItems: "flex-end", justifyContent: "space-between" } }),
	formGroup: css({ display: "flex", minW: 0, flex: "1 1 0%", flexWrap: "wrap", alignItems: "flex-end", gap: "1rem" }),
	inputLabel: css({ display: "flex", minW: "9rem", maxW: "100%", flexDir: "column", gap: "0.5rem" }),
	numberInput: css({ h: "2.25rem", minW: 0, borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "var(--background)", px: "0.5rem", fontSize: "0.875rem" }),
	checkLabel: css({ display: "flex", h: "2.25rem", maxW: "100%", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.75rem", fontSize: "0.875rem" }),
	checkLabelRedact: css({ minW: "14rem" }),
	checkLabelJudge: css({ minW: "18rem" }),
	checkbox: css({ h: "1rem", w: "1rem", flexShrink: 0 }),
	truncate: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
	actionColumn: css({ display: "flex", flexShrink: 0, flexDir: "column", alignItems: "flex-start", gap: "0.5rem", xl: { alignItems: "flex-end" } }),
	actionRow: css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", xl: { justifyContent: "flex-end" } }),
	button: css({ display: "inline-flex", h: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", px: "0.75rem", fontSize: "0.875rem" }),
	primaryButton: css({ bg: "var(--primary)", fontWeight: "500", color: "var(--primary-foreground)", _hover: { bg: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.5 } }),
	borderButton: css({ border: "1px solid var(--border)", _hover: { bg: "var(--accent)" }, _disabled: { opacity: 0.5 } }),
	fileLabel: css({ cursor: "pointer", "&:has(:disabled)": { cursor: "not-allowed", opacity: 0.5 } }),
	srOnly: css({ position: "absolute", w: "1px", h: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 }),
	smallMuted: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	error: css({ maxW: "24rem", fontSize: "0.75rem", color: "var(--destructive)" }),
	portableBody: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", p: "1rem" }),
	inlineLabel: css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }),
	basisFull: css({ flexBasis: "100%", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	errorFull: css({ flexBasis: "100%", fontSize: "0.75rem", color: "var(--destructive)" }),
	contentGrid: css({ mt: "1.5rem", display: "grid", minW: 0, gap: "1.5rem", lg: { gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.75fr)" } }),
	section: css({ minW: 0, overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--background)" }),
	dividerList: css({ "& > * + *": { borderTop: "1px solid var(--border)" } }),
	emptyState: css({ px: "1rem", py: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	stack3: css({ "& > * + *": { mt: "0.75rem" }, p: "1rem" }),
	deepRow: css({ display: "flex", minW: 0, alignItems: "flex-start", gap: "0.75rem" }),
	rankBox: css({ display: "flex", h: "1.75rem", w: "1.75rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", bg: "var(--muted)", fontSize: "0.75rem", fontWeight: "500" }),
	flex1: css({ minW: 0, flex: "1 1 0%" }),
	lineClamp2: css({ overflow: "hidden", textOverflow: "ellipsis", lineClamp: 2 }),
	lineClamp4: css({ overflow: "hidden", textOverflow: "ellipsis", lineClamp: 4 }),
	metaRow: css({ mt: "0.25rem", display: "flex", minW: 0, flexWrap: "wrap", alignItems: "center", columnGap: "0.5rem", rowGap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	sessionRow: css({ display: "flex", minH: "9rem", minW: 0, flexDir: "column", gap: "0.75rem", px: "1rem", py: "0.75rem" }),
	sessionTitle: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: "500" }),
	sessionPreview: css({ mt: "0.5rem", overflow: "hidden", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)", lineClamp: 4 }),
	badgeRow: css({ display: "flex", minW: 0, flexWrap: "wrap", gap: "0.5rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	badge: css({ display: "inline-flex", minW: 0, alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", bg: "var(--muted)", px: "0.5rem", py: "0.25rem" }),
	shrink0: css({ flexShrink: 0 }),
	centerPage: css({ minH: "100vh", bg: "var(--background)", color: "var(--foreground)" }),
	centerContent: css({ display: "flex", minH: "100vh", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
};

function useSessionMetadata() {
	use(getInitPromise());
	if (!metadataPromise) {
		metadataPromise = sessions.getAllMetadata();
	}
	return use(metadataPromise);
}

function MetricCard({
	icon,
	label,
	value,
	detail,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className={styles.card}>
			<div className={styles.cardHead}>
				<div className={styles.cardLabel}>{label}</div>
				<div className={styles.muted}>{icon}</div>
			</div>
			<div className={styles.cardValue}>{value}</div>
			<div className={styles.cardDetail}>{detail}</div>
		</div>
	);
}

function SegmentedControl<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: Array<{ value: T; label: string }>;
	onChange: (value: T) => void;
}) {
	return (
		<div className={styles.controlWrap}>
			<div className={styles.labelText}>{label}</div>
			<div className={styles.segmented}>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						className={cx(styles.segmentButton, value === option.value ? styles.segmentActive : styles.segmentInactive)}
						onClick={() => onChange(option.value)}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

function FineTuneExportPanel() {
	const [format, setFormat] = useState<WebFineTuneFormat>("both");
	const [source, setSource] = useState<WebExportSource>("all");
	const [redact, setRedact] = useState(true);
	const [minAssistantChars, setMinAssistantChars] = useState(80);
	const [judgeScoring, setJudgeScoring] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [result, setResult] = useState<{ examples: number; skipped: number; redactions: number; scored?: number; unscored?: number } | null>(null);
	const [importResult, setImportResult] = useState<WebFineTuneImportResult | null>(null);
	const [error, setError] = useState("");

	const handleExport = async () => {
		setExporting(true);
		setError("");
		try {
			const judge = judgeScoring
				? (await import("../keating/export-judge")).createKeatingExportJudge()
				: undefined;
			const bundle = await buildWebFineTuneExport({
				source,
				format,
				redact,
				minAssistantChars,
				judge,
			});
			if (bundle.exampleCount === 0) {
				setError("No fine-tuning examples were generated. Create sessions or artifacts first.");
				setResult({
					examples: 0,
					skipped: bundle.skippedCount,
					redactions: bundle.redactionCount,
					scored: bundle.rewardStats?.scored,
					unscored: bundle.rewardStats?.unscored,
				});
				return;
			}
			if (bundle.chatmlJsonl) downloadTextFile("keating-finetune.chatml.jsonl", bundle.chatmlJsonl);
			if (bundle.alpacaJsonl) downloadTextFile("keating-finetune.alpaca.jsonl", bundle.alpacaJsonl);
			if (bundle.rewardedJsonl) downloadTextFile("train.rewarded.jsonl", bundle.rewardedJsonl);
			if (bundle.ktoJsonl) downloadTextFile("train.kto.jsonl", bundle.ktoJsonl);
			if (bundle.preferenceJsonl) downloadTextFile("train.preference.jsonl", bundle.preferenceJsonl);
			if (bundle.dpoTextJsonl) downloadTextFile("train.dpo.text.jsonl", bundle.dpoTextJsonl);
			if (bundle.grpoPromptsJsonl) downloadTextFile("prompts.grpo.jsonl", bundle.grpoPromptsJsonl);
			downloadTextFile("keating-finetune.manifest.json", bundle.manifestJson);
			setResult({
				examples: bundle.exampleCount,
				skipped: bundle.skippedCount,
				redactions: bundle.redactionCount,
				scored: bundle.rewardStats?.scored,
				unscored: bundle.rewardStats?.unscored,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	};

	const handleImport = async (fileList: FileList | null) => {
		const files = Array.from(fileList ?? []);
		if (!files.length) return;
		setExporting(true);
		setError("");
		setImportResult(null);
		try {
			const imported = await importFineTuneFiles(await Promise.all(files.map(async (file) => ({
				name: file.name,
				text: await file.text(),
			}))));
			if (imported.examplesImported === 0) {
				setError("No importable fine-tune examples were found. Choose ChatML or Alpaca JSONL files.");
			}
			metadataPromise = null;
			setImportResult(imported);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	};

	return (
		<section className={styles.panel}>
			<div className={styles.panelHeader}>
				<h2 className={styles.panelTitle}>Fine-tune export</h2>
				<p className={styles.panelSubtitle}>Download training JSONL from Keating sessions, artifacts, and sandbox self-edit history.</p>
			</div>
			<div className={styles.exportBody}>
				<div className={styles.formGroup}>
					<SegmentedControl
						label="Format"
						value={format}
						onChange={setFormat}
						options={[
							{ value: "chatml", label: "ChatML" },
							{ value: "alpaca", label: "Alpaca" },
							{ value: "both", label: "Both" },
						]}
					/>
					<SegmentedControl
						label="Source"
						value={source}
						onChange={setSource}
						options={[
							{ value: "all", label: "All" },
							{ value: "artifacts", label: "Artifacts" },
							{ value: "sessions", label: "Sessions" },
							{ value: "sandbox", label: "Sandbox" },
						]}
					/>
					<label className={styles.inputLabel}>
						<span className={styles.labelText}>Minimum assistant length</span>
						<input
							type="number"
							min={1}
							className={styles.numberInput}
							value={minAssistantChars}
							onChange={(event) => setMinAssistantChars(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
						/>
					</label>
					<label className={cx(styles.checkLabel, styles.checkLabelRedact)}>
						<input
							type="checkbox"
							className={styles.checkbox}
							checked={redact}
							onChange={(event) => setRedact(event.target.checked)}
						/>
						<span className={styles.truncate}>Redact secrets</span>
					</label>
					<label className={cx(styles.checkLabel, styles.checkLabelJudge)}>
						<input
							type="checkbox"
							className={styles.checkbox}
							checked={judgeScoring}
							onChange={(event) => setJudgeScoring(event.target.checked)}
						/>
						<span className={styles.truncate}>LLM judge scoring (slower, uses API credits)</span>
					</label>
				</div>
				<div className={styles.actionColumn}>
					<div className={styles.actionRow}>
						<button
							type="button"
							className={cx(styles.button, styles.primaryButton)}
							onClick={handleExport}
							disabled={exporting}
						>
							<Download size={16} />
							{exporting ? "Working..." : "Export fine-tune data"}
						</button>
						<label className={cx(styles.button, styles.borderButton, styles.fileLabel)}>
							<Upload size={16} />
							Import JSONL
							<input
								type="file"
								accept=".jsonl,application/jsonl,application/x-ndjson"
								multiple
								className={styles.srOnly}
								disabled={exporting}
								onChange={(event) => {
									void handleImport(event.target.files);
									event.currentTarget.value = "";
								}}
							/>
						</label>
					</div>
					{result && (
						<div className={styles.smallMuted}>
							{formatNumber(result.examples)} examples · {formatNumber(result.skipped)} skipped · {formatNumber(result.redactions)} redactions
							{typeof result.scored === "number" && typeof result.unscored === "number"
								? ` · ${formatNumber(result.scored)} scored · ${formatNumber(result.unscored)} unscored`
								: ""}
						</div>
					)}
					{importResult && (
						<div className={styles.smallMuted}>
							Imported {formatNumber(importResult.examplesImported)} examples into {formatNumber(importResult.sessionsImported)} session{importResult.sessionsImported === 1 ? "" : "s"} · {formatNumber(importResult.skipped)} skipped
						</div>
					)}
					{error && <div className={styles.error}>{error}</div>}
				</div>
			</div>
		</section>
	);
}

function PortableDataPanel() {
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
			setResult(`Exported ${formatNumber(bundle.sessions.length)} sessions and ${formatNumber(bundle.storage.feedback.length)} feedback records.`);
		} catch (err) {
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
			setResult(summarizeImport(imported));
		} catch (err) {
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
	const metadata = useSessionMetadata().sort((a, b) => b.lastModified.localeCompare(a.lastModified));
	const artifactMetrics = useArtifactMetrics();
	const totals = metadata.reduce(
		(acc, session) => {
			acc.messages += session.messageCount;
			acc.input += session.usage.input;
			acc.output += session.usage.output;
			acc.tokens += session.usage.totalTokens;
			acc.cost += session.usage.cost.total;
			return acc;
		},
		{ messages: 0, input: 0, output: 0, tokens: 0, cost: 0 },
	);
	const activeSpan = metadata.length
		? daysBetween(metadata[metadata.length - 1].createdAt, metadata[0].lastModified)
		: 0;
	const recent = metadata.slice(0, 8);
	const deepest = [...metadata].sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
	const dailyMessages = activeSpan ? totals.messages / activeSpan : 0;

	const selfImprovement = artifactMetrics ? artifactMetrics.benchmarks + artifactMetrics.evolutions + artifactMetrics.promptEvolutions + artifactMetrics.improvements : 0;
	const teachingMats = artifactMetrics ? artifactMetrics.plans + artifactMetrics.maps + artifactMetrics.animations : 0;

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<div className={styles.headerInner}>
					<div>
						<p className={styles.kicker}>Keating usage</p>
						<h1 className={styles.title}>Learning activity</h1>
					</div>
					<button
						className={cx(styles.button, styles.borderButton)}
						onClick={() => navigate({ to: "/chat" })}
					>
						<ArrowLeft size={16} />
						Back to chat
					</button>
				</div>
			</header>

			<main className={styles.main}>
				<div className={styles.metricGrid}>
					<MetricCard
						icon={<BookOpenCheck size={18} />}
						label="Learning sessions"
						value={formatNumber(metadata.length)}
						detail={activeSpan ? `${activeSpan} day learning window` : "No sessions yet"}
					/>
					<MetricCard
						icon={<MessageSquareText size={18} />}
						label="Socratic turns"
						value={formatNumber(totals.messages)}
						detail={`${dailyMessages.toFixed(1)} messages per active day`}
					/>
					<MetricCard
						icon={<Brain size={18} />}
						label="Model tokens"
						value={formatNumber(totals.tokens || totals.input + totals.output)}
						detail={`${formatNumber(totals.input)} in / ${formatNumber(totals.output)} out`}
					/>
					<MetricCard
						icon={<TrendingUp size={18} />}
						label="Estimated spend"
						value={formatCost(totals.cost)}
						detail="Based on provider usage metadata"
					/>
				</div>

				{/* Self-improvement vs Learning distinction */}
				<div className={styles.metricGridThree}>
					<MetricCard
						icon={<Gem size={18} />}
						label="Teaching materials"
						value={formatNumber(teachingMats)}
						detail={`${formatNumber(artifactMetrics?.plans ?? 0)} plans · ${formatNumber(artifactMetrics?.maps ?? 0)} maps · ${formatNumber(artifactMetrics?.animations ?? 0)} animations`}
					/>
					<MetricCard
						icon={<Cpu size={18} />}
						label="Self-improvement runs"
						value={formatNumber(selfImprovement)}
						detail={`${formatNumber(artifactMetrics?.evolutions ?? 0)} evolutions · ${formatNumber(artifactMetrics?.promptEvolutions ?? 0)} prompt evos`}
					/>
					<MetricCard
						icon={<Flame size={18} />}
						label="Improvement attempts"
						value={formatNumber(artifactMetrics?.improvements ?? 0)}
						detail={artifactMetrics && artifactMetrics.improvements > 0 ? `${formatNumber(artifactMetrics.benchmarks)} benchmarks measured` : "No improvements logged yet"}
					/>
				</div>

				<PortableDataPanel />
				<FineTuneExportPanel />

				<div className={styles.contentGrid}>
					<section className={styles.section}>
						<div className={styles.panelHeader}>
							<h2 className={styles.panelTitle}>Recent learning</h2>
							<p className={styles.panelSubtitle}>Latest saved sessions and their focus</p>
						</div>
						<div className={styles.dividerList}>
							{recent.length === 0 ? (
								<div className={styles.emptyState}>
									Start a chat and Keating will track your learning activity here.
								</div>
							) : recent.map((session) => (
								<SessionRow key={session.id} session={session} />
							))}
						</div>
					</section>

					<section className={styles.section}>
						<div className={styles.panelHeader}>
							<h2 className={styles.panelTitle}>Deepest dives</h2>
							<p className={styles.panelSubtitle}>Sessions with the most back-and-forth</p>
						</div>
						<div className={styles.stack3}>
							{deepest.length === 0 ? (
								<div className={styles.emptyState}>No learning history yet</div>
							) : deepest.map((session, index) => (
								<div key={session.id} className={styles.deepRow}>
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
								</div>
							))}
						</div>
					</section>
				</div>

				<UsageCharts sessionMetadata={metadata} />
			</main>
		</div>
	);
}

function SessionRow({ session }: { session: SessionMetadata }) {
	const tokens = session.usage.totalTokens || session.usage.input + session.usage.output;
	const modelLabel = sessionModelLabel(session);
	return (
		<div className={styles.sessionRow}>
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
			</div>
		</div>
	);
}

export function Usage() {
	useSeo({
		title: "Keating Dashboard — Usage & Analytics",
		description: "View your Keating usage statistics, session history, and learning analytics.",
		canonical: "https://keating.help/usage",
	});
	return (
		<Suspense fallback={
			<div className={styles.centerPage}>
				<div className={styles.centerContent}>
					Loading usage...
				</div>
			</div>
		}>
			<UsageContent />
		</Suspense>
	);
}
