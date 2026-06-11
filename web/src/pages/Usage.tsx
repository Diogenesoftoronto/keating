import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpenCheck, Brain, CalendarDays, Clock3, Cpu, Download, Flame, Gem, MessageSquareText, TrendingUp, Upload } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { UsageCharts } from "../components/UsageCharts";
import { buildWebFineTuneExport, type WebExportSource, type WebFineTuneFormat } from "../keating/export";
import { downloadTextFile } from "../lib/browser-download";
import {
	buildKeatingPortableDataBundle,
	importKeatingPortableDataBundle,
	parseKeatingPortableDataBundle,
	type KeatingPortableImportResult,
} from "../keating/portable-data";

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
		<div className="min-w-0 rounded-lg border border-border bg-background p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="text-sm text-muted-foreground">{label}</div>
				<div className="text-muted-foreground">{icon}</div>
			</div>
			<div className="mt-3 text-2xl font-semibold">{value}</div>
			<div className="mt-1 min-w-0 break-words text-xs text-muted-foreground">{detail}</div>
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
		<div className="w-full max-w-full sm:min-w-[18rem] sm:flex-1 lg:min-w-[22rem]">
			<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-md border border-border sm:flex sm:flex-nowrap sm:overflow-x-auto">
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						className={`min-w-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] transition-colors sm:min-w-max sm:flex-1 sm:shrink-0 sm:px-2 sm:py-1 sm:text-[11px] lg:px-3 lg:py-1.5 lg:text-xs ${value === option.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
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
	const [exporting, setExporting] = useState(false);
	const [result, setResult] = useState<{ examples: number; skipped: number; redactions: number } | null>(null);
	const [error, setError] = useState("");

	const handleExport = async () => {
		setExporting(true);
		setError("");
		try {
			const bundle = await buildWebFineTuneExport({
				source,
				format,
				redact,
				minAssistantChars,
			});
			if (bundle.exampleCount === 0) {
				setError("No fine-tuning examples were generated. Create sessions or artifacts first.");
				setResult({ examples: 0, skipped: bundle.skippedCount, redactions: bundle.redactionCount });
				return;
			}
			if (bundle.chatmlJsonl) downloadTextFile("keating-finetune.chatml.jsonl", bundle.chatmlJsonl);
			if (bundle.alpacaJsonl) downloadTextFile("keating-finetune.alpaca.jsonl", bundle.alpacaJsonl);
			downloadTextFile("keating-finetune.manifest.json", bundle.manifestJson);
			setResult({ examples: bundle.exampleCount, skipped: bundle.skippedCount, redactions: bundle.redactionCount });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	};

	return (
		<section className="mt-6 rounded-lg border border-border bg-background">
			<div className="border-b border-border px-4 py-3">
				<h2 className="text-sm font-semibold">Fine-tune export</h2>
				<p className="mt-1 text-xs text-muted-foreground">Download training JSONL from Keating sessions, artifacts, and sandbox self-edit history.</p>
			</div>
			<div className="flex min-w-0 flex-col gap-4 p-4 xl:flex-row xl:items-end xl:justify-between">
				<div className="flex min-w-0 flex-1 flex-wrap items-end gap-4">
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
					<label className="flex min-w-[9rem] max-w-full flex-col gap-2">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Minimum assistant length</span>
						<input
							type="number"
							min={1}
							className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm"
							value={minAssistantChars}
							onChange={(event) => setMinAssistantChars(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
						/>
					</label>
					<label className="flex h-9 min-w-[14rem] max-w-full items-center gap-2 rounded-md border border-border px-3 text-sm">
						<input
							type="checkbox"
							className="h-4 w-4 shrink-0"
							checked={redact}
							onChange={(event) => setRedact(event.target.checked)}
						/>
						<span className="min-w-0 truncate">Redact secrets</span>
					</label>
				</div>
				<div className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
					<button
						type="button"
						className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						onClick={handleExport}
						disabled={exporting}
					>
						<Download size={16} />
						{exporting ? "Exporting..." : "Export fine-tune data"}
					</button>
					{result && (
						<div className="text-xs text-muted-foreground">
							{formatNumber(result.examples)} examples · {formatNumber(result.skipped)} skipped · {formatNumber(result.redactions)} redactions
						</div>
					)}
					{error && <div className="max-w-sm text-xs text-destructive">{error}</div>}
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
		<section className="mt-6 rounded-lg border border-border bg-background">
			<div className="border-b border-border px-4 py-3">
				<h2 className="text-sm font-semibold">Portable data</h2>
				<p className="mt-1 text-xs text-muted-foreground">Move Keating sessions, learner state, artifacts, goals, and sandbox history between browsers.</p>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-4 p-4">
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={includeSandbox}
						onChange={(event) => setIncludeSandbox(event.target.checked)}
					/>
					Include sandbox code history
				</label>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
						onClick={handlePortableExport}
						disabled={busy}
					>
						<Download size={16} />
						Export portable JSON
					</button>
					<label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
						<Upload size={16} />
						Import portable JSON
						<input
							type="file"
							accept="application/json,.json"
							className="sr-only"
							disabled={busy}
							onChange={(event) => {
								const file = event.target.files?.[0] ?? null;
								void handlePortableImport(file);
								event.currentTarget.value = "";
							}}
						/>
					</label>
				</div>
				{result && <div className="basis-full text-xs text-muted-foreground">{result}</div>}
				{error && <div className="basis-full text-xs text-destructive">{error}</div>}
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
		<div className="min-h-screen bg-background text-foreground font-mono">
			<header className="border-b border-border">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
					<div>
						<p className="text-xs uppercase tracking-wide text-muted-foreground">Keating usage</p>
						<h1 className="text-2xl font-semibold">Learning activity</h1>
					</div>
					<button
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
						onClick={() => navigate({ to: "/chat" })}
					>
						<ArrowLeft size={16} />
						Back to chat
					</button>
				</div>
			</header>

			<main className="mx-auto min-w-0 max-w-6xl overflow-hidden px-4 py-6">
				<div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
				<div className="mt-6 grid min-w-0 gap-3 sm:grid-cols-3">
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

				<div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
					<section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
						<div className="border-b border-border px-4 py-3">
							<h2 className="text-sm font-semibold">Recent learning</h2>
							<p className="mt-1 text-xs text-muted-foreground">Latest saved sessions and their focus</p>
						</div>
						<div className="divide-y divide-border">
							{recent.length === 0 ? (
								<div className="px-4 py-8 text-center text-sm text-muted-foreground">
									Start a chat and Keating will track your learning activity here.
								</div>
							) : recent.map((session) => (
								<SessionRow key={session.id} session={session} />
							))}
						</div>
					</section>

					<section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
						<div className="border-b border-border px-4 py-3">
							<h2 className="text-sm font-semibold">Deepest dives</h2>
							<p className="mt-1 text-xs text-muted-foreground">Sessions with the most back-and-forth</p>
						</div>
						<div className="space-y-3 p-4">
							{deepest.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">No learning history yet</div>
							) : deepest.map((session, index) => (
								<div key={session.id} className="flex min-w-0 items-start gap-3">
									<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
										{index + 1}
									</div>
									<div className="min-w-0 flex-1">
										<div className="overflow-hidden text-ellipsis text-sm font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
											{session.title}
										</div>
										<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
	return (
		<div className="flex min-h-36 min-w-0 flex-col gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{session.title}</div>
				<p className="mt-2 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4]">
					{firstSentence(session.preview)}
				</p>
			</div>
			<div className="flex min-w-0 flex-wrap gap-2 text-[11px] text-muted-foreground">
				<span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
					<CalendarDays size={12} className="shrink-0" />
					<span className="truncate">{formatDate(session.lastModified)}</span>
				</span>
				<span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
					<MessageSquareText size={12} className="shrink-0" />
					<span className="truncate">{session.messageCount} turns</span>
				</span>
				<span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
					<Brain size={12} className="shrink-0" />
					<span className="truncate">{formatNumber(tokens)} tokens</span>
				</span>
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
			<div className="min-h-screen bg-background text-foreground">
				<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
					Loading usage...
				</div>
			</div>
		}>
			<UsageContent />
		</Suspense>
	);
}
