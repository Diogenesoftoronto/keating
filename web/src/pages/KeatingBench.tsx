import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { Activity, ArrowLeft, BarChart3, BookOpenCheck, ClipboardList, Database, Download, FileText, Info, LineChart, Medal, Scale, UploadCloud } from "lucide-react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, sessions } from "../hooks/keating-storage";
import { sessionUsage } from "../hooks/session-metadata";
import type { SessionData } from "../types/session";
import { feedbackToOutcomeScore, inferBrowserLearnerTurnSignal, MIN_REAL_OUTCOMES } from "../keating/core";
import { listCachedSharedSessions, type SharedModelInfo } from "../keating/shared-sessions";
import { downloadTextFile } from "../lib/browser-download";

type BenchmarkSource = "shared" | "local" | "all";

interface SessionSample {
	id: string;
	title: string;
	source: "shared" | "local";
	createdAt: string;
	model?: SharedModelInfo;
	messages: AgentMessage[];
}

interface ModelAggregate {
	key: string;
	name: string;
	provider: string;
	score: number;
	prosperScore: number;
	prosper: ProsperVector;
	confidence: number;
	sessions: number;
	sharedSessions: number;
	localSessions: number;
	signals: number;
	turns: number;
	tokens: number;
	cost: number;
	latestAt: string;
	readiness: ReadinessBand;
	outcomes: ModelOutcome[];
	replayCases: ReplayCase[];
}

let samplesPromise: Promise<SessionSample[]> | null = null;

type ReadinessBand = "waiting" | "sparse" | "provisional" | "rankable" | "stable";
type ReplayStage = "diagnosis" | "confusion-recovery" | "correction" | "transfer" | "retention";
type FeedbackSignal = "thumbs-up" | "thumbs-down" | "confused";

interface ProsperVector {
	performance: number;
	robustness: number;
	outcomeLift: number;
	sparseCaution: number;
	personalization: number;
	evidenceQuality: number;
	retentionTransfer: number;
}

interface ModelOutcome {
	score: number;
	signal: FeedbackSignal;
	source: "inferred-turn";
	stage: ReplayStage;
	prosper: ProsperVector;
}

interface ReplayCase {
	id: string;
	sessionId: string;
	sessionTitle: string;
	source: SessionSample["source"];
	modelKey: string;
	stage: ReplayStage;
	signal: FeedbackSignal;
	learnerText: string;
	beforeAssistantText: string;
	afterAssistantText: string;
	outcomeScore: number;
	prosper: ProsperVector;
}

const READINESS_THRESHOLDS = {
	sparse: 5,
	provisional: 20,
	rankable: 50,
	stable: 100,
};

function textFromMessage(message: AgentMessage): string {
	const content = (message as any).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function serializeModel(model: Model<any> | SharedModelInfo | undefined): SharedModelInfo {
	return {
		provider: model?.provider ?? "unknown",
		id: model?.id ?? "unlabeled-model",
		name: model?.name ?? model?.id ?? "Unlabeled model",
		api: "api" in (model ?? {}) ? (model as SharedModelInfo).api : undefined,
		baseUrl: "baseUrl" in (model ?? {}) ? (model as SharedModelInfo).baseUrl : undefined,
	};
}

async function loadBenchmarkSamples(): Promise<SessionSample[]> {
	await getInitPromise();
	const localMetadata = await sessions.getAllMetadata();
	const localSessions = await Promise.all(
		localMetadata.map(async (metadata) => {
			const data = await sessions.loadSession(metadata.id) as SessionData | null;
			if (!data) return null;
			return {
				id: data.id,
				title: data.title,
				source: "local" as const,
				createdAt: data.createdAt,
				model: serializeModel(data.model),
				messages: data.messages,
			};
		}),
	);
	const shared: SessionSample[] = listCachedSharedSessions().map((session) => ({
		id: session.id,
		title: session.title,
		source: "shared" as const,
		createdAt: session.sharedAt,
		model: session.model,
		messages: session.messages,
	}));
	return [
		...shared,
		...localSessions.filter((session): session is NonNullable<typeof session> => Boolean(session)),
	];
}

function useBenchmarkSamples() {
	use(getInitPromise());
	if (!samplesPromise) samplesPromise = loadBenchmarkSamples();
	return use(samplesPromise);
}

function modelKey(model: SharedModelInfo) {
	return `${model.provider}:${model.id}`;
}

function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

function words(text: string) {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasAny(text: string, patterns: RegExp[]) {
	return patterns.some((pattern) => pattern.test(text));
}

function classifyReplayStage(text: string, signal: FeedbackSignal): ReplayStage {
	const lowered = text.toLowerCase();
	if (signal === "confused") return "confusion-recovery";
	if (signal === "thumbs-down" || hasAny(lowered, [/\bwrong\b/, /\bincorrect\b/, /\bnot true\b/, /\bthat's not\b/])) return "correction";
	if (hasAny(lowered, [/\bapply\b/, /\btransfer\b/, /\bnew example\b/, /\bscenario\b/, /\bquiz\b/, /\btest me\b/])) return "transfer";
	if (hasAny(lowered, [/\bremember\b/, /\breview\b/, /\bdue\b/, /\bagain\b/, /\bretention\b/])) return "retention";
	return "diagnosis";
}

function scoreAssistantResponse(caseStage: ReplayStage, learnerText: string, assistantText: string, outcomeScore: number): ProsperVector {
	const response = assistantText.toLowerCase();
	const learner = learnerText.toLowerCase();
	const lengthScore = clamp01(words(assistantText) / 120);
	const checksUnderstanding = hasAny(response, [/\bdoes that make sense\b/, /\btry\b/, /\bwhat would\b/, /\bcan you\b/, /\btell me\b/, /\bcheck\b/]) ? 1 : 0.35;
	const concrete = hasAny(response, [/\bexample\b/, /\bfor instance\b/, /\bbecause\b/, /\bstep\b/, /\bfirst\b/, /\btherefore\b/]) ? 1 : 0.45;
	const acknowledgesState = caseStage === "confusion-recovery"
		? hasAny(response, [/\bconfus/, /\bstuck\b/, /\bslow\b/, /\blet's unpack\b/, /\bstart over\b/]) ? 1 : 0.35
		: caseStage === "correction"
			? hasAny(response, [/\byou're right\b/, /\bcorrection\b/, /\bfix\b/, /\bmistake\b/, /\bmore precise\b/]) ? 1 : 0.35
			: hasAny(response, [/\byou\b/, /\byour\b/, /\bfrom what\b/, /\blooks like\b/]) ? 0.85 : 0.45;
	const transferCue = hasAny(response, [/\bapply\b/, /\bnew case\b/, /\banother example\b/, /\bpractice\b/, /\bquiz\b/, /\brecall\b/]) ? 1 : 0.35;
	const learnerSpecificity = learner.length > 0 && hasAny(response, learner.split(/\W+/).filter((part) => part.length > 5).slice(0, 8).map((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"))) ? 1 : 0.55;

	return {
		performance: outcomeScore,
		robustness: clamp01((concrete + checksUnderstanding + lengthScore) / 3),
		outcomeLift: clamp01(outcomeScore * 0.75 + (caseStage === "confusion-recovery" || caseStage === "correction" ? acknowledgesState * 0.25 : transferCue * 0.15)),
		sparseCaution: 0,
		personalization: clamp01((acknowledgesState + learnerSpecificity) / 2),
		evidenceQuality: clamp01((concrete + lengthScore) / 2),
		retentionTransfer: caseStage === "transfer" || caseStage === "retention" ? transferCue : clamp01(transferCue * 0.65 + checksUnderstanding * 0.35),
	};
}

function prosperMean(values: ProsperVector[]): ProsperVector {
	if (values.length === 0) {
		return {
			performance: 0,
			robustness: 0,
			outcomeLift: 0,
			sparseCaution: 0,
			personalization: 0,
			evidenceQuality: 0,
			retentionTransfer: 0,
		};
	}
	return values.reduce<ProsperVector>((acc, value) => ({
		performance: acc.performance + value.performance / values.length,
		robustness: acc.robustness + value.robustness / values.length,
		outcomeLift: acc.outcomeLift + value.outcomeLift / values.length,
		sparseCaution: acc.sparseCaution + value.sparseCaution / values.length,
		personalization: acc.personalization + value.personalization / values.length,
		evidenceQuality: acc.evidenceQuality + value.evidenceQuality / values.length,
		retentionTransfer: acc.retentionTransfer + value.retentionTransfer / values.length,
	}), {
		performance: 0,
		robustness: 0,
		outcomeLift: 0,
		sparseCaution: 0,
		personalization: 0,
		evidenceQuality: 0,
		retentionTransfer: 0,
	});
}

function prosperTotal(vector: ProsperVector) {
	return (
		vector.performance * 0.2 +
		vector.robustness * 0.14 +
		vector.outcomeLift * 0.18 +
		vector.sparseCaution * 0.14 +
		vector.personalization * 0.12 +
		vector.evidenceQuality * 0.1 +
		vector.retentionTransfer * 0.12
	) * 100;
}

function readinessForSignals(signals: number): ReadinessBand {
	if (signals >= READINESS_THRESHOLDS.stable) return "stable";
	if (signals >= READINESS_THRESHOLDS.rankable) return "rankable";
	if (signals >= READINESS_THRESHOLDS.provisional) return "provisional";
	if (signals >= READINESS_THRESHOLDS.sparse) return "sparse";
	return "waiting";
}

function extractReplayCases(sample: SessionSample, model: SharedModelInfo): ReplayCase[] {
	const key = modelKey(model);
	const cases: ReplayCase[] = [];
	for (let index = 0; index < sample.messages.length; index += 1) {
		const message = sample.messages[index];
		const role = (message as any).role;
		if (role !== "user" && role !== "user-with-attachments") continue;
		const learnerText = textFromMessage(message);
		const inferred = inferBrowserLearnerTurnSignal(learnerText, sample.title);
		if (!inferred) continue;
		const beforeAssistantText = [...sample.messages.slice(0, index)].reverse().find((candidate) => (candidate as any).role === "assistant");
		const afterAssistantText = sample.messages.slice(index + 1).find((candidate) => (candidate as any).role === "assistant");
		const stage = classifyReplayStage(learnerText, inferred.signal);
		const outcomeScore = feedbackToOutcomeScore(inferred.signal);
		const responseText = textFromMessage(afterAssistantText ?? beforeAssistantText ?? message);
		const prosper = scoreAssistantResponse(stage, learnerText, responseText, outcomeScore);
		cases.push({
			id: `${sample.id}:${index}`,
			sessionId: sample.id,
			sessionTitle: sample.title,
			source: sample.source,
			modelKey: key,
			stage,
			signal: inferred.signal,
			learnerText,
			beforeAssistantText: textFromMessage(beforeAssistantText ?? message).slice(0, 420),
			afterAssistantText: textFromMessage(afterAssistantText ?? message).slice(0, 420),
			outcomeScore,
			prosper,
		});
	}
	return cases;
}

function aggregateSamples(samples: SessionSample[], source: BenchmarkSource): ModelAggregate[] {
	const filtered = source === "all" ? samples : samples.filter((sample) => sample.source === source);
	const aggregates = new Map<string, ModelAggregate>();

	for (const sample of filtered) {
		const model = serializeModel(sample.model);
		const key = modelKey(model);
		const existing = aggregates.get(key) ?? {
			key,
			name: model.name ?? model.id,
			provider: model.provider,
			score: 0,
			prosperScore: 0,
			prosper: prosperMean([]),
			confidence: 0,
			sessions: 0,
			sharedSessions: 0,
			localSessions: 0,
			signals: 0,
			turns: 0,
			tokens: 0,
			cost: 0,
			latestAt: sample.createdAt,
			readiness: "waiting" as const,
			outcomes: [],
			replayCases: [],
		};
		existing.sessions += 1;
		existing.sharedSessions += sample.source === "shared" ? 1 : 0;
		existing.localSessions += sample.source === "local" ? 1 : 0;
		existing.latestAt = existing.latestAt.localeCompare(sample.createdAt) > 0 ? existing.latestAt : sample.createdAt;
		const usage = sessionUsage(sample.messages);
		existing.tokens += usage.totalTokens || usage.input + usage.output;
		existing.cost += usage.cost.total;

		existing.turns += sample.messages.filter((message) => {
			const role = (message as any).role;
			return role === "user" || role === "user-with-attachments";
		}).length;
		const replayCases = extractReplayCases(sample, model);
		existing.replayCases.push(...replayCases);
		existing.outcomes.push(...replayCases.map((replayCase) => ({
			signal: replayCase.signal,
			score: replayCase.outcomeScore,
			source: "inferred-turn" as const,
			stage: replayCase.stage,
			prosper: replayCase.prosper,
		})));
		aggregates.set(key, existing);
	}

	return [...aggregates.values()]
		.map((aggregate) => {
			const mean = aggregate.outcomes.length
				? aggregate.outcomes.reduce((sum, outcome) => sum + outcome.score, 0) / aggregate.outcomes.length
				: 0;
			const confidence = Math.min(1, aggregate.outcomes.length / 20);
			const readiness = readinessForSignals(aggregate.outcomes.length);
			const prosperBase = prosperMean(aggregate.outcomes.map((outcome) => outcome.prosper));
			const sparseCaution = readiness === "waiting"
				? 0
				: readiness === "sparse"
					? 0.45
					: readiness === "provisional"
						? 0.7
						: readiness === "rankable"
							? 0.9
							: 1;
			const prosper = { ...prosperBase, sparseCaution };
			return {
				...aggregate,
				score: mean * 100,
				prosper,
				prosperScore: prosperTotal(prosper),
				confidence,
				signals: aggregate.outcomes.length,
				readiness,
			};
		})
		.sort((a, b) => {
			const adjustedA = a.prosperScore * (0.72 + a.confidence * 0.28);
			const adjustedB = b.prosperScore * (0.72 + b.confidence * 0.28);
			return adjustedB - adjustedA || b.signals - a.signals || b.sessions - a.sessions;
		});
}

function formatNumber(value: number) {
	return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number) {
	return value > 0 ? `$${value.toFixed(value < 1 ? 4 : 2)}` : "$0";
}

function formatDate(iso: string) {
	return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date";
}

function percent(value: number) {
	return `${Math.round(value * 100)}%`;
}

function MetricTile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
	return (
		<div className="min-w-0 rounded-md border border-border bg-background p-4">
			<div className="flex items-center justify-between gap-3 text-xs uppercase text-muted-foreground">
				<span className="truncate">{label}</span>
				<span className="shrink-0">{icon}</span>
			</div>
			<div className="mt-3 truncate text-2xl font-semibold">{value}</div>
			<div className="mt-1 min-w-0 break-words text-xs text-muted-foreground">{detail}</div>
		</div>
	);
}

function SourceTabs({ value, onChange }: { value: BenchmarkSource; onChange: (value: BenchmarkSource) => void }) {
	const options: Array<{ value: BenchmarkSource; label: string }> = [
		{ value: "shared", label: "Shared" },
		{ value: "all", label: "All local" },
		{ value: "local", label: "Private" },
	];
	return (
		<div className="inline-flex overflow-hidden rounded-md border border-border">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					className={`h-9 px-3 text-sm ${value === option.value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function ReadinessBadge({ readiness }: { readiness: ModelAggregate["readiness"] }) {
	const label = readiness === "stable" ? "Stable" : readiness === "rankable" ? "Rankable" : readiness === "provisional" ? "Provisional" : readiness === "sparse" ? "Sparse" : "Waiting";
	const className = readiness === "stable" || readiness === "rankable"
		? "border-emerald-600/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
		: readiness === "provisional"
			? "border-sky-600/70 bg-sky-500/10 text-sky-700 dark:text-sky-300"
			: readiness === "sparse"
			? "border-amber-600/70 bg-amber-500/10 text-amber-700 dark:text-amber-300"
			: "border-muted-foreground/30 bg-muted text-muted-foreground";
	return <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${className}`}>{label}</span>;
}

function filteredSamples(samples: SessionSample[], source: BenchmarkSource) {
	return source === "all" ? samples : samples.filter((sample) => sample.source === source);
}

function replayCasesFor(samples: SessionSample[], source: BenchmarkSource) {
	return filteredSamples(samples, source).flatMap((sample) => extractReplayCases(sample, serializeModel(sample.model)));
}

function StagePill({ stage }: { stage: ReplayStage }) {
	return <span className="rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">{stage}</span>;
}

function ExplainerBlock({
	icon,
	title,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0 rounded-md border border-border bg-background p-4">
			<div className="mb-3 flex items-center gap-2">
				<span className="text-muted-foreground">{icon}</span>
				<h3 className="text-sm font-semibold">{title}</h3>
			</div>
			<div className="space-y-2 text-xs leading-5 text-muted-foreground">{children}</div>
		</div>
	);
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1 rounded-md bg-muted p-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
			<div className="text-xs font-medium text-foreground">{label}</div>
			<div className="text-xs leading-5 text-muted-foreground">{value}</div>
		</div>
	);
}

function KeatingBenchExplainer() {
	return (
		<section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
			<ExplainerBlock icon={<BookOpenCheck size={18} />} title="What KeatingBench Tests">
				<p>
					KeatingBench evaluates teaching models by learner outcomes, not by generic chat preference. It looks for moments where a learner signals understanding, confusion, correction, transfer, review need, or dissatisfaction during a teaching session.
				</p>
				<p>
					The current page uses shared sessions cached in this browser plus private local sessions when selected. Shared sessions are the intended benchmark corpus because they preserve real learner interaction patterns.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<Scale size={18} />} title="How The Score Works">
				<p>
					The headline rank is the PROSPER score. Raw learner outcome is shown separately so a model cannot win only by making learners sound happy while ignoring robustness, transfer, or evidence quality.
				</p>
				<p>
					The ranking adjusts for confidence. More replay cases increase trust in the score; sparse evidence remains visible but is marked as weak evidence.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<ClipboardList size={18} />} title="Replay Case Bank">
				<p>
					A replay case is a learner state extracted from a session turn. KeatingBench captures the learner text, nearby assistant context, inferred feedback signal, topic context, and the teaching stage.
				</p>
				<p>
					These cases are the future cross-model harness: the same learner state can be replayed against multiple models, then judged on the same PROSPER dimensions.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<Info size={18} />} title="Current Limitations">
				<p>
					Today this is deterministic scoring over observed session data. Provider replay execution is queued, so the page does not yet call every model on the same extracted learner states.
				</p>
				<p>
					Inferred feedback is useful but imperfect. Explicit thumbs up, thumbs down, confused, quiz outcomes, and retention checks should carry more weight as the corpus grows.
				</p>
			</ExplainerBlock>
		</section>
	);
}

function MethodologyExplainer() {
	return (
		<section className="mt-6 rounded-md border border-border bg-background p-4">
			<div className="mb-4 flex items-center gap-2">
				<FileText size={18} className="text-muted-foreground" />
				<h2 className="text-sm font-semibold">Methodology</h2>
			</div>
			<div className="grid gap-3 lg:grid-cols-2">
				<DefinitionRow label="Outcome" value="A normalized learner signal. Thumbs up maps high, confused maps mid-low, thumbs down maps low. Inferred learner turns use the same score scale." />
				<DefinitionRow label="PROSPER" value="A multi-objective judgement over performance, robustness, outcome lift, sparse-data caution, personalization, evidence quality, and retention or transfer." />
				<DefinitionRow label="Performance" value="How well the observed learner signal turned out for the model in that session context." />
				<DefinitionRow label="Robustness" value="Whether the response appears concrete, checks understanding, and has enough instructional substance to handle similar learners." />
				<DefinitionRow label="Outcome lift" value="Whether the model seems to move the learner state forward, especially after confusion or correction." />
				<DefinitionRow label="Sparse caution" value="A gate that prevents tiny datasets from being treated as reliable model rankings." />
				<DefinitionRow label="Personalization" value="Whether the response acknowledges the learner state instead of giving a generic explanation." />
				<DefinitionRow label="Evidence quality" value="Whether the case has enough observable teaching behavior to support a judgement." />
				<DefinitionRow label="Transfer" value="Whether the response pushes toward practice, application, recall, or a new case." />
				<DefinitionRow label="Readiness" value={`Waiting: under ${READINESS_THRESHOLDS.sparse}; sparse: ${READINESS_THRESHOLDS.sparse}+; provisional: ${READINESS_THRESHOLDS.provisional}+; rankable: ${READINESS_THRESHOLDS.rankable}+; stable: ${READINESS_THRESHOLDS.stable}+ signals.`} />
			</div>
		</section>
	);
}

function KeatingBenchContent() {
	const posthog = usePostHog();
	const navigate = useNavigate();
	const samples = useBenchmarkSamples();
	const [source, setSource] = useState<BenchmarkSource>("shared");
	const rows = useMemo(() => aggregateSamples(samples, source), [samples, source]);
	const replayCases = useMemo(() => replayCasesFor(samples, source), [samples, source]);
	const totals = useMemo(() => rows.reduce(
		(acc, row) => {
			acc.signals += row.signals;
			acc.sessions += row.sessions;
			acc.models += 1;
			acc.ready += row.readiness === "rankable" || row.readiness === "stable" ? 1 : 0;
			return acc;
		},
		{ signals: 0, sessions: 0, models: 0, ready: 0 },
	), [rows]);

	useEffect(() => {
		posthog?.capture("keatingbench_viewed", {
			source,
			models: rows.length,
			signals: totals.signals,
			sessions: totals.sessions,
		});
	}, [posthog, rows.length, source, totals.signals, totals.sessions]);

	const exportLeaderboard = () => {
		downloadTextFile("keatingbench-leaderboard.json", JSON.stringify({
			exportedAt: new Date().toISOString(),
			source,
			minSignalsForPolicyEvolution: MIN_REAL_OUTCOMES,
			readinessThresholds: READINESS_THRESHOLDS,
			models: rows,
		}, null, 2));
		posthog?.capture("keatingbench_exported", {
			source,
			models: rows.length,
			signals: totals.signals,
		});
	};

	return (
		<div className="min-h-screen bg-background text-foreground font-mono">
			<header className="border-b border-border">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
					<div className="min-w-0">
						<p className="text-xs uppercase tracking-wide text-muted-foreground">KeatingBench</p>
						<h1 className="truncate text-2xl font-semibold">Model learning leaderboard</h1>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<SourceTabs value={source} onChange={setSource} />
						<button
							type="button"
							className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
							onClick={exportLeaderboard}
						>
							<Download size={16} />
							Export
						</button>
						<button
							type="button"
							className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
							onClick={() => navigate({ to: "/chat" })}
						>
							<ArrowLeft size={16} />
							Chat
						</button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-7xl px-4 py-6">
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<MetricTile icon={<Database size={18} />} label="Sessions" value={formatNumber(totals.sessions)} detail={`${formatNumber(samples.filter((sample) => sample.source === "shared").length)} shared cached`} />
					<MetricTile icon={<BarChart3 size={18} />} label="Models" value={formatNumber(totals.models)} detail={`${formatNumber(totals.ready)} ready for ranking`} />
					<MetricTile icon={<Activity size={18} />} label="Feedback signals" value={formatNumber(totals.signals)} detail={`${READINESS_THRESHOLDS.rankable} signals for ranked status`} />
					<MetricTile icon={<ClipboardList size={18} />} label="Replay cases" value={formatNumber(replayCases.length)} detail={`${formatNumber(replayCases.filter((item) => item.stage === "confusion-recovery").length)} confusion cases`} />
				</div>

				<KeatingBenchExplainer />

				<section className="mt-6 overflow-hidden rounded-md border border-border bg-background">
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
						<div>
							<h2 className="text-sm font-semibold">Leaderboard</h2>
							<p className="mt-1 text-xs text-muted-foreground">PROSPER is the rank score; outcome is the direct learner signal score.</p>
						</div>
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Scale size={15} />
							<span>{source === "shared" ? "Shared session data" : source === "local" ? "Private session data" : "Shared plus private data"}</span>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[1040px] text-left text-sm">
							<thead className="border-b border-border bg-muted/60 text-xs uppercase text-muted-foreground">
								<tr>
									<th className="w-16 px-4 py-3">Rank</th>
									<th className="px-4 py-3">Model</th>
									<th className="px-4 py-3">PROSPER</th>
									<th className="px-4 py-3">Outcome</th>
									<th className="px-4 py-3">Replay mix</th>
									<th className="px-4 py-3">Signals</th>
									<th className="px-4 py-3">Sessions</th>
									<th className="px-4 py-3">Tokens</th>
									<th className="px-4 py-3">Cost</th>
									<th className="px-4 py-3">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{rows.length === 0 ? (
									<tr>
										<td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
											No benchmarkable sessions in this view.
										</td>
									</tr>
								) : rows.map((row, index) => (
									<tr key={row.key} className="align-top hover:bg-accent/50">
										<td className="px-4 py-4 text-lg font-semibold tabular-nums">{index + 1}</td>
										<td className="max-w-[18rem] px-4 py-4">
											<div className="truncate font-medium">{row.name}</div>
											<div className="mt-1 truncate text-xs text-muted-foreground">{row.provider} | {row.key.split(":").slice(1).join(":")}</div>
										</td>
										<td className="px-4 py-4">
											<div className="flex items-center gap-3">
												<div className="w-20 text-lg font-semibold tabular-nums">{row.prosperScore.toFixed(1)}</div>
												<div className="h-2 w-28 overflow-hidden rounded-sm bg-muted">
													<div className="h-full bg-[linear-gradient(90deg,#1e9b50,#0ea5e9,#f59e0b)]" style={{ width: `${Math.max(2, Math.min(100, row.prosperScore))}%` }} />
												</div>
											</div>
											<div className="mt-1 text-xs text-muted-foreground">Evidence {Math.round(row.confidence * 100)}%</div>
										</td>
										<td className="px-4 py-4">
											<div className="text-lg font-semibold tabular-nums">{row.score.toFixed(1)}</div>
											<div className="mt-1 text-xs text-muted-foreground">Learner outcome</div>
										</td>
										<td className="px-4 py-4">
											<div className="flex flex-wrap gap-1">
												{(["confusion-recovery", "correction", "transfer", "retention"] as ReplayStage[]).map((stage) => {
													const count = row.outcomes.filter((outcome) => outcome.stage === stage).length;
													return count > 0 ? <span key={stage} className="rounded-md bg-muted px-2 py-1 text-[11px]">{stage}: {count}</span> : null;
												})}
											</div>
										</td>
										<td className="px-4 py-4 tabular-nums">{formatNumber(row.signals)}</td>
										<td className="px-4 py-4">
											<div className="tabular-nums">{formatNumber(row.sessions)}</div>
											<div className="mt-1 text-xs text-muted-foreground">{formatNumber(row.sharedSessions)} shared | {formatNumber(row.localSessions)} private</div>
										</td>
										<td className="px-4 py-4 tabular-nums">{formatNumber(row.tokens)}</td>
										<td className="px-4 py-4 tabular-nums">{formatCost(row.cost)}</td>
										<td className="px-4 py-4">
											<ReadinessBadge readiness={row.readiness} />
											<div className="mt-2 text-xs text-muted-foreground">Latest {formatDate(row.latestAt)}</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
					<section className="rounded-md border border-border bg-background p-4">
						<div className="mb-4 flex items-center justify-between gap-3">
							<h2 className="text-sm font-semibold">PROSPER dimensions</h2>
							<LineChart size={18} className="text-muted-foreground" />
						</div>
						<p className="mb-4 text-xs leading-5 text-muted-foreground">
							Each bar shows one objective in the judgement vector. The final score is weighted across these objectives so narrow wins are less likely to outrank balanced teaching behavior.
						</p>
						<div className="space-y-3">
							{rows.slice(0, 5).map((row) => (
								<div key={row.key} className="rounded-md border border-border p-3">
									<div className="mb-3 flex items-center justify-between gap-3">
										<div className="truncate text-sm font-medium">{row.name}</div>
										<div className="text-xs tabular-nums text-muted-foreground">{row.prosperScore.toFixed(1)}</div>
									</div>
									<div className="grid gap-2 sm:grid-cols-2">
										{[
											["Perf", row.prosper.performance],
											["Robust", row.prosper.robustness],
											["Lift", row.prosper.outcomeLift],
											["Sparse", row.prosper.sparseCaution],
											["Personal", row.prosper.personalization],
											["Evidence", row.prosper.evidenceQuality],
											["Transfer", row.prosper.retentionTransfer],
										].map(([label, value]) => (
											<div key={label as string} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2">
												<div className="text-[11px] text-muted-foreground">{label}</div>
												<div className="h-2 overflow-hidden rounded-sm bg-muted">
													<div className="h-full bg-primary" style={{ width: percent(value as number) }} />
												</div>
												<div className="text-right text-[11px] tabular-nums">{percent(value as number)}</div>
											</div>
										))}
									</div>
								</div>
							))}
							{rows.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No PROSPER dimensions yet</div>}
						</div>
					</section>

					<section className="rounded-md border border-border bg-background p-4">
						<div className="mb-4 flex items-center justify-between gap-3">
							<h2 className="text-sm font-semibold">Cross-model replay</h2>
							<UploadCloud size={18} className="text-muted-foreground" />
						</div>
						<p className="mb-4 text-xs leading-5 text-muted-foreground">
							Replay turns human session data into reusable benchmark states. The live steps score observed sessions; the queued provider step will send matched learner states to different models.
						</p>
						<div className="divide-y divide-border text-sm">
							{[
								{ item: "shared-session ingestion", detail: `${formatNumber(replayCases.length)} replay states extracted`, status: "live" },
								{ item: "deterministic replay scoring", detail: "PROSPER vector runs over observed learner states", status: "live" },
								{ item: "provider replay execution", detail: "same state prompts can be sent to each model next", status: "queued" },
							].map(({ item, detail, status }) => (
								<div key={item} className="flex items-center justify-between gap-3 py-3">
									<div className="min-w-0">
										<div className="truncate font-medium">{item}</div>
										<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
									</div>
									<span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">{status}</span>
								</div>
							))}
						</div>
					</section>
				</div>

				<section className="mt-6 overflow-hidden rounded-md border border-border bg-background">
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
						<div>
							<h2 className="text-sm font-semibold">Replay case bank</h2>
							<p className="mt-1 text-xs text-muted-foreground">Inspectable learner states used to build the model judgement.</p>
						</div>
						<Medal size={18} className="text-muted-foreground" />
					</div>
					<div className="divide-y divide-border">
						{replayCases.slice(0, 8).map((replayCase) => (
							<div key={replayCase.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[10rem_minmax(0,1fr)_12rem]">
								<div className="flex flex-wrap items-start gap-2">
									<StagePill stage={replayCase.stage} />
									<span className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">{replayCase.signal}</span>
								</div>
								<div className="min-w-0">
									<div className="truncate text-sm font-medium">{replayCase.sessionTitle}</div>
									<p className="mt-1 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
										{replayCase.learnerText}
									</p>
								</div>
								<div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
									<div className="rounded-md bg-muted p-2">
										<div className="text-muted-foreground">Outcome</div>
										<div className="mt-1 font-medium">{Math.round(replayCase.outcomeScore * 100)}%</div>
									</div>
									<div className="rounded-md bg-muted p-2">
										<div className="text-muted-foreground">PROSPER</div>
										<div className="mt-1 font-medium">{prosperTotal(replayCase.prosper).toFixed(1)}</div>
									</div>
								</div>
							</div>
						))}
						{replayCases.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No replay cases yet</div>}
					</div>
				</section>

				<MethodologyExplainer />
			</main>
		</div>
	);
}

export function KeatingBench() {
	useSeo({
		title: "KeatingBench | Model Learning Leaderboard",
		description: "Rank teaching models by shared learner-session outcomes and feedback signals.",
		canonical: "https://keating.help/bench",
	});
	return (
		<Suspense fallback={
			<div className="min-h-screen bg-background text-foreground">
				<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
					Loading KeatingBench...
				</div>
			</div>
		}>
			<KeatingBenchContent />
		</Suspense>
	);
}
