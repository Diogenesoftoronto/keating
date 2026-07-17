import { Suspense, use, useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Activity, BarChart3, BookOpenCheck, ClipboardList, Database, Download, FileText, Info, LineChart, Medal, Scale, UploadCloud } from "lucide-react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import type { FeedbackEntry, QuizResultRecord } from "../keating/storage";
import { sessionUsage } from "../hooks/session-metadata";
import type { SessionData } from "../types/session";
import { feedbackToOutcomeScore, inferBrowserLearnerTurnSignal, MIN_REAL_OUTCOMES } from "../keating/core";
import { listCachedSharedSessions, type SharedModelInfo } from "../keating/shared-sessions";
import { downloadTextFile } from "../lib/browser-download";
import { css, cx } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { LearningInsightsHeader, LearningMetric } from "../components/LearningInsightsHeader";

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
	quizCount: number;
	quizAverage: number | null;
	explicitSignals: number;
}

interface BenchmarkData {
	samples: SessionSample[];
	quizRecords: QuizResultRecord[];
	feedbackEntries: FeedbackEntry[];
}

let dataPromise: Promise<BenchmarkData> | null = null;

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
	source: "inferred-turn" | "explicit-feedback" | "quiz";
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

const styles = {
	page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
	min0: css({ minW: 0 }),
	main: css({ mx: "auto", maxW: "72rem", px: "1rem", py: "1.5rem" }),
	button: css({ display: "inline-flex", h: "2.25rem", w: "100%", alignItems: "center", justifyContent: "center", gap: "0.5rem", border: "1px solid var(--ink)", bg: "var(--card)", px: "0.75rem", fontSize: "0.875rem", sm: { w: "auto" }, _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" } }),
	sourceTabs: css({ display: "grid", w: "100%", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", overflow: "hidden", border: "1px solid var(--ink)", sm: { display: "inline-flex", w: "auto" } }),
	sourceButton: css({ minW: 0, h: "2.25rem", px: "0.25rem", fontSize: "0.75rem", sm: { px: "0.75rem", fontSize: "0.875rem" } }),
	sourceCompactLabel: css({ sm: { display: "none" } }),
	sourceWideLabel: css({ display: "none", sm: { display: "inline" } }),
	sourceActive: css({ bg: "var(--ink)", color: "var(--paper)" }),
	sourceInactive: css({ bg: "var(--card)", _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" } }),
	metricGrid: css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, xl: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }),
	truncate: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
	shrink0: css({ flexShrink: 0 }),
	readinessBase: css({ display: "inline-flex", borderRadius: "0.375rem", border: "1px solid", px: "0.5rem", py: "0.25rem", fontSize: "11px", fontWeight: "500" }),
	readinessGood: css({ borderColor: "color-mix(in srgb, #059669 70%, transparent)", bg: "color-mix(in srgb, #22c55e 10%, transparent)", color: "#047857" }),
	readinessProvisional: css({ borderColor: "color-mix(in srgb, #0284c7 70%, transparent)", bg: "color-mix(in srgb, #0ea5e9 10%, transparent)", color: "#0369a1" }),
	readinessSparse: css({ borderColor: "color-mix(in srgb, #d97706 70%, transparent)", bg: "color-mix(in srgb, #f59e0b 10%, transparent)", color: "#b45309" }),
	readinessWaiting: css({ borderColor: "color-mix(in srgb, var(--muted-foreground) 30%, transparent)", bg: "var(--muted)", color: "var(--muted-foreground)" }),
	pill: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "var(--muted)", px: "0.5rem", py: "0.25rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	block: css({ minW: 0, border: "1px solid var(--border)", bg: "var(--card)", p: "1rem" }),
	blockHead: css({ mb: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }),
	mutedIcon: css({ color: "var(--muted-foreground)" }),
	blockTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	bodyText: css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" }),
	definitionRow: css({ display: "grid", gap: "0.25rem", borderRadius: "0.375rem", bg: "var(--muted)", p: "0.75rem", sm: { gridTemplateColumns: "8rem minmax(0, 1fr)", gap: "0.75rem" } }),
	definitionLabel: css({ fontSize: "0.75rem", fontWeight: "500", color: "var(--foreground)" }),
	definitionValue: css({ fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" }),
	explainerGrid: css({ mt: "1.5rem", display: "grid", gap: "1rem", lg: { gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)" } }),
	methodology: css({ mt: "1.5rem", border: "1px solid var(--ink)", bg: "var(--card)", p: "1rem" }),
	methodologyHead: css({ mb: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }),
	twoGrid: css({ display: "grid", gap: "0.75rem", lg: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
	section: css({ mt: "1.5rem", overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--card)" }),
	sectionHeader: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	sectionTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	sectionSubtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	inlineMuted: css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	overflowX: css({ overflowX: "auto" }),
	table: css({ w: "100%", minW: "1140px", textAlign: "left", fontSize: "0.875rem" }),
	thead: css({ borderBottom: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 60%, transparent)", fontSize: "0.75rem", textTransform: "uppercase", color: "var(--muted-foreground)" }),
	thRank: css({ w: "4rem", px: "1rem", py: "0.75rem" }),
	th: css({ px: "1rem", py: "0.75rem" }),
	tbody: css({ "& > * + *": { borderTop: "1px solid var(--border)" } }),
	emptyCell: css({ px: "1rem", py: "3rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	tableRow: css({ verticalAlign: "top", _hover: { bg: "color-mix(in srgb, var(--accent) 50%, transparent)" } }),
	tdRank: css({ px: "1rem", py: "1rem", fontSize: "1.125rem", fontWeight: "600", fontVariantNumeric: "tabular-nums" }),
	td: css({ px: "1rem", py: "1rem" }),
	modelCell: css({ maxW: "18rem", px: "1rem", py: "1rem" }),
	fontMedium: css({ fontWeight: "500" }),
	smallMuted: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	tinyMuted: css({ fontSize: "11px", color: "var(--muted-foreground)" }),
	scoreRow: css({ display: "flex", alignItems: "center", gap: "0.75rem" }),
	scoreNumber: css({ w: "5rem", fontSize: "1.125rem", fontWeight: "600", fontVariantNumeric: "tabular-nums" }),
	barTrack: css({ h: "0.5rem", w: "7rem", overflow: "hidden", borderRadius: "0.125rem", bg: "var(--muted)" }),
	prosperFill: css({ h: "100%", bg: "linear-gradient(90deg, #1e9b50, #0ea5e9, #f59e0b)" }),
	outcomeScore: css({ fontSize: "1.125rem", fontWeight: "600", fontVariantNumeric: "tabular-nums" }),
	wrapGap1: css({ display: "flex", flexWrap: "wrap", gap: "0.25rem" }),
	stageCount: css({ borderRadius: "0.375rem", bg: "var(--muted)", px: "0.5rem", py: "0.25rem", fontSize: "11px" }),
	tabular: css({ fontVariantNumeric: "tabular-nums" }),
	belowGrid: css({ mt: "1.5rem", display: "grid", gap: "1.5rem", lg: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.85fr)" } }),
	cardSection: css({ border: "1px solid var(--ink)", bg: "var(--card)", p: "1rem" }),
	cardSectionHead: css({ mb: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
	paragraph: css({ mb: "1rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" }),
	stack3: css({ "& > * + *": { mt: "0.75rem" } }),
	dimensionCard: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", p: "0.75rem" }),
	dimensionHead: css({ mb: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
	dimensionGrid: css({ display: "grid", gap: "0.5rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
	dimensionRow: css({ display: "grid", gridTemplateColumns: "4.5rem minmax(0, 1fr) 2.5rem", alignItems: "center", gap: "0.5rem" }),
	progressTrack: css({ h: "0.5rem", overflow: "hidden", borderRadius: "0.125rem", bg: "var(--muted)" }),
	progressFill: css({ h: "100%", bg: "var(--primary)" }),
	rightTiny: css({ textAlign: "right", fontSize: "11px", fontVariantNumeric: "tabular-nums" }),
	empty: css({ py: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	divideText: css({ fontSize: "0.875rem", "& > * + *": { borderTop: "1px solid var(--border)" } }),
	replayStep: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", py: "0.75rem" }),
	statusPill: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.5rem", py: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	replayList: css({ "& > * + *": { borderTop: "1px solid var(--border)" } }),
	replayCase: css({ display: "grid", gap: "0.75rem", px: "1rem", py: "0.75rem", lg: { gridTemplateColumns: "10rem minmax(0, 1fr) 12rem" } }),
	replayLeft: css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0.5rem" }),
	lineClamp2: css({ mt: "0.25rem", overflow: "hidden", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)", lineClamp: 2 }),
	twoColNums: css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }),
	statBox: css({ borderRadius: "0.375rem", bg: "var(--muted)", p: "0.5rem" }),
	mt1FontMedium: css({ mt: "0.25rem", fontWeight: "500" }),
	centerContent: css({ display: "flex", minH: "16rem", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "var(--ink-soft)" }),
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

async function loadBenchmarkData(): Promise<BenchmarkData> {
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
	const [quizRecords, learnerState] = await Promise.all([
		keatingStorage.getQuizResults().catch(() => [] as QuizResultRecord[]),
		keatingStorage.getLearnerState().catch(() => null),
	]);
	return {
		samples: [
			...shared,
			...localSessions.filter((session): session is NonNullable<typeof session> => Boolean(session)),
		],
		quizRecords,
		feedbackEntries: learnerState?.feedbackHistory ?? [],
	};
}

function useBenchmarkData() {
	use(getInitPromise());
	if (!dataPromise) dataPromise = loadBenchmarkData();
	return use(dataPromise);
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

function aggregateSamples(
	samples: SessionSample[],
	source: BenchmarkSource,
	quizRecords: QuizResultRecord[] = [],
	feedbackEntries: FeedbackEntry[] = []
): ModelAggregate[] {
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
			quizCount: 0,
			quizAverage: null,
			explicitSignals: 0,
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

	// Graded quizzes and explicit feedback attach to the model that taught the
	// session they were recorded in. Records without a session in the current
	// view are skipped rather than mis-attributed.
	const aggregateBySessionId = new Map(
		filtered.map((sample) => [sample.id, aggregates.get(modelKey(serializeModel(sample.model)))])
	);
	for (const record of quizRecords) {
		if (!(record.totalQuestions > 0) || !record.sessionId) continue;
		const aggregate = aggregateBySessionId.get(record.sessionId);
		if (!aggregate) continue;
		const score = clamp01(record.score / record.totalQuestions);
		aggregate.quizCount += 1;
		aggregate.outcomes.push({
			score,
			signal: score >= 0.75 ? "thumbs-up" : score < 0.4 ? "thumbs-down" : "confused",
			source: "quiz",
			stage: "retention",
			prosper: {
				performance: score,
				robustness: 0.5,
				outcomeLift: score,
				sparseCaution: 0,
				personalization: 0.4,
				evidenceQuality: 1,
				retentionTransfer: score,
			},
		});
	}
	for (const entry of feedbackEntries) {
		// Turn-analysis entries duplicate the transcript-inferred replay cases.
		if (entry.source === "turn-analysis" || !entry.sessionId) continue;
		const aggregate = aggregateBySessionId.get(entry.sessionId);
		if (!aggregate) continue;
		const score = feedbackToOutcomeScore(entry.signal);
		aggregate.explicitSignals += 1;
		aggregate.outcomes.push({
			score,
			signal: entry.signal,
			source: "explicit-feedback",
			stage: classifyReplayStage(entry.evidence ?? "", entry.signal),
			prosper: {
				performance: score,
				robustness: 0.5,
				outcomeLift: score,
				sparseCaution: 0,
				personalization: 0.5,
				evidenceQuality: 0.8,
				retentionTransfer: 0.4,
			},
		});
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
			const quizScores = aggregate.outcomes.filter((outcome) => outcome.source === "quiz").map((outcome) => outcome.score);
			return {
				...aggregate,
				quizAverage: quizScores.length > 0 ? quizScores.reduce((sum, value) => sum + value, 0) / quizScores.length : null,
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

function SourceTabs({ value, onChange }: { value: BenchmarkSource; onChange: (value: BenchmarkSource) => void }) {
	const options: Array<{ value: BenchmarkSource; label: string; compactLabel: string; accessibleLabel: string }> = [
		{ value: "shared", label: "Shared", compactLabel: "Shared", accessibleLabel: "Shared sessions" },
		{ value: "all", label: "All local", compactLabel: "All", accessibleLabel: "Shared and private sessions" },
		{ value: "local", label: "Private", compactLabel: "Local", accessibleLabel: "Private local sessions" },
	];
	return (
		<div className={styles.sourceTabs}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-label={option.accessibleLabel}
					className={cx(styles.sourceButton, value === option.value ? styles.sourceActive : styles.sourceInactive)}
					onClick={() => onChange(option.value)}
				>
					<span className={styles.sourceCompactLabel}>{option.compactLabel}</span>
					<span className={styles.sourceWideLabel}>{option.label}</span>
				</button>
			))}
		</div>
	);
}

function ReadinessBadge({ readiness }: { readiness: ModelAggregate["readiness"] }) {
	const label = readiness === "stable" ? "Stable" : readiness === "rankable" ? "Rankable" : readiness === "provisional" ? "Provisional" : readiness === "sparse" ? "Sparse" : "Waiting";
	const className = readiness === "stable" || readiness === "rankable"
		? styles.readinessGood
		: readiness === "provisional"
			? styles.readinessProvisional
			: readiness === "sparse"
			? styles.readinessSparse
			: styles.readinessWaiting;
	return <span className={cx(styles.readinessBase, className)}>{label}</span>;
}

function filteredSamples(samples: SessionSample[], source: BenchmarkSource) {
	return source === "all" ? samples : samples.filter((sample) => sample.source === source);
}

function replayCasesFor(samples: SessionSample[], source: BenchmarkSource) {
	return filteredSamples(samples, source).flatMap((sample) => extractReplayCases(sample, serializeModel(sample.model)));
}

function StagePill({ stage }: { stage: ReplayStage }) {
	return <span className={styles.pill}>{stage}</span>;
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
		<div className={styles.block}>
			<div className={styles.blockHead}>
				<span className={styles.mutedIcon}>{icon}</span>
				<h3 className={styles.blockTitle}>{title}</h3>
			</div>
			<div className={styles.bodyText}>{children}</div>
		</div>
	);
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
	return (
		<div className={styles.definitionRow}>
			<div className={styles.definitionLabel}>{label}</div>
			<div className={styles.definitionValue}>{value}</div>
		</div>
	);
}

function KeatingBenchExplainer() {
	return (
		<section className={styles.explainerGrid}>
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
					Inferred feedback is useful but imperfect. Explicit thumbs up / down / confused signals and graded quiz results are now folded into each model's score — quizzes are the strongest evidence because they measure observed retrieval, not sentiment.
				</p>
			</ExplainerBlock>
		</section>
	);
}

function MethodologyExplainer() {
	return (
		<section className={styles.methodology}>
			<div className={styles.methodologyHead}>
				<FileText size={18} className={styles.mutedIcon} />
				<h2 className={styles.blockTitle}>Methodology</h2>
			</div>
			<div className={styles.twoGrid}>
				<DefinitionRow label="Outcome" value="A normalized learner signal. Thumbs up maps high, confused maps mid-low, thumbs down maps low. Inferred learner turns use the same score scale." />
				<DefinitionRow label="Quiz evidence" value="Graded quiz results (objective auto-grading plus teacher-judged open answers) attributed to the model that taught the session. Scored as fraction correct; the highest-quality evidence in the vector." />
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
	const { samples, quizRecords, feedbackEntries } = useBenchmarkData();
	const [source, setSource] = useState<BenchmarkSource>("shared");
	const rows = useMemo(() => aggregateSamples(samples, source, quizRecords, feedbackEntries), [samples, source, quizRecords, feedbackEntries]);
	const replayCases = useMemo(() => replayCasesFor(samples, source), [samples, source]);
	const totals = useMemo(() => rows.reduce(
		(acc, row) => {
			acc.signals += row.signals;
			acc.sessions += row.sessions;
			acc.models += 1;
			acc.ready += row.readiness === "rankable" || row.readiness === "stable" ? 1 : 0;
			acc.quizzes += row.quizCount;
			acc.explicit += row.explicitSignals;
			return acc;
		},
		{ signals: 0, sessions: 0, models: 0, ready: 0, quizzes: 0, explicit: 0 },
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
		<>
			<LearningInsightsHeader
				current="bench"
				context="Learning intelligence // Benchmark"
				title="Model learning benchmark"
				description="Compare teaching models using learner outcomes, quiz evidence, feedback signals, and inspectable replay cases."
				actions={
					<>
						<SourceTabs value={source} onChange={setSource} />
						<button
							type="button"
							className={styles.button}
							onClick={exportLeaderboard}
						>
							<Download size={16} />
							Export results
						</button>
					</>
				}
			/>
			<main className={styles.main}>
				<div className={styles.metricGrid}>
					<LearningMetric icon={<Database size={18} />} label="Sessions" value={formatNumber(totals.sessions)} detail={`${formatNumber(samples.filter((sample) => sample.source === "shared").length)} shared cached`} />
					<LearningMetric icon={<BarChart3 size={18} />} label="Models" value={formatNumber(totals.models)} detail={`${formatNumber(totals.ready)} ready for ranking`} />
					<LearningMetric icon={<Activity size={18} />} label="Feedback signals" value={formatNumber(totals.signals)} detail={`${formatNumber(totals.explicit)} explicit | ${READINESS_THRESHOLDS.rankable} for ranked status`} />
					<LearningMetric icon={<BookOpenCheck size={18} />} label="Graded quizzes" value={formatNumber(totals.quizzes)} detail="Strongest evidence: observed retrieval performance" />
				</div>

				<KeatingBenchExplainer />

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<div>
							<h2 className={styles.sectionTitle}>Leaderboard</h2>
							<p className={styles.sectionSubtitle}>PROSPER is the rank score; outcome is the direct learner signal score.</p>
						</div>
						<div className={styles.inlineMuted}>
							<Scale size={15} />
							<span>{source === "shared" ? "Shared session data" : source === "local" ? "Private session data" : "Shared plus private data"}</span>
						</div>
					</div>
					<div className={styles.overflowX}>
						<table className={styles.table}>
							<thead className={styles.thead}>
								<tr>
									<th className={styles.thRank}>Rank</th>
									<th className={styles.th}>Model</th>
									<th className={styles.th}>PROSPER</th>
									<th className={styles.th}>Outcome</th>
									<th className={styles.th}>Quiz avg</th>
									<th className={styles.th}>Replay mix</th>
									<th className={styles.th}>Signals</th>
									<th className={styles.th}>Sessions</th>
									<th className={styles.th}>Tokens</th>
									<th className={styles.th}>Cost</th>
									<th className={styles.th}>Status</th>
								</tr>
							</thead>
							<tbody className={styles.tbody}>
								{rows.length === 0 ? (
									<tr>
										<td colSpan={11} className={styles.emptyCell}>
											No benchmarkable sessions in this view.
										</td>
									</tr>
								) : rows.map((row, index) => (
									<tr key={row.key} className={styles.tableRow}>
										<td className={styles.tdRank}>{index + 1}</td>
										<td className={styles.modelCell}>
											<div className={cx(styles.truncate, styles.fontMedium)}>{row.name}</div>
											<div className={cx(styles.smallMuted, styles.truncate, css({ mt: "0.25rem" }))}>{row.provider} | {row.key.split(":").slice(1).join(":")}</div>
										</td>
										<td className={styles.td}>
											<div className={styles.scoreRow}>
												<div className={styles.scoreNumber}>{row.prosperScore.toFixed(1)}</div>
												<div className={styles.barTrack}>
													<div className={styles.prosperFill} style={{ width: `${Math.max(2, Math.min(100, row.prosperScore))}%` }} />
												</div>
											</div>
											<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>Evidence {Math.round(row.confidence * 100)}%</div>
										</td>
										<td className={styles.td}>
											<div className={styles.outcomeScore}>{row.score.toFixed(1)}</div>
											<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>Learner outcome</div>
										</td>
										<td className={styles.td}>
											<div className={styles.outcomeScore}>{row.quizAverage === null ? "—" : `${Math.round(row.quizAverage * 100)}%`}</div>
											<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>{row.quizCount > 0 ? `${formatNumber(row.quizCount)} graded` : "No quizzes yet"}</div>
										</td>
										<td className={styles.td}>
											<div className={styles.wrapGap1}>
												{(["confusion-recovery", "correction", "transfer", "retention"] as ReplayStage[]).map((stage) => {
													const count = row.outcomes.filter((outcome) => outcome.stage === stage).length;
													return count > 0 ? <span key={stage} className={styles.stageCount}>{stage}: {count}</span> : null;
												})}
											</div>
										</td>
										<td className={styles.td}>
												<div className={styles.tabular}>{formatNumber(row.signals)}</div>
												<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>{formatNumber(row.explicitSignals)} explicit | {formatNumber(row.quizCount)} quiz</div>
											</td>
										<td className={styles.td}>
											<div className={styles.tabular}>{formatNumber(row.sessions)}</div>
											<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>{formatNumber(row.sharedSessions)} shared | {formatNumber(row.localSessions)} private</div>
										</td>
										<td className={cx(styles.td, styles.tabular)}>{formatNumber(row.tokens)}</td>
										<td className={cx(styles.td, styles.tabular)}>{formatCost(row.cost)}</td>
										<td className={styles.td}>
											<ReadinessBadge readiness={row.readiness} />
											<div className={cx(styles.smallMuted, css({ mt: "0.5rem" }))}>Latest {formatDate(row.latestAt)}</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				<div className={styles.belowGrid}>
					<section className={styles.cardSection}>
						<div className={styles.cardSectionHead}>
							<h2 className={styles.sectionTitle}>PROSPER dimensions</h2>
							<LineChart size={18} className={styles.mutedIcon} />
						</div>
						<p className={styles.paragraph}>
							Each bar shows one objective in the judgement vector. The final score is weighted across these objectives so narrow wins are less likely to outrank balanced teaching behavior.
						</p>
						<div className={styles.stack3}>
							{rows.slice(0, 5).map((row) => (
								<div key={row.key} className={styles.dimensionCard}>
									<div className={styles.dimensionHead}>
										<div className={cx(styles.truncate, css({ fontSize: "0.875rem", fontWeight: "500" }))}>{row.name}</div>
										<div className={cx(styles.smallMuted, styles.tabular)}>{row.prosperScore.toFixed(1)}</div>
									</div>
									<div className={styles.dimensionGrid}>
										{[
											["Perf", row.prosper.performance],
											["Robust", row.prosper.robustness],
											["Lift", row.prosper.outcomeLift],
											["Sparse", row.prosper.sparseCaution],
											["Personal", row.prosper.personalization],
											["Evidence", row.prosper.evidenceQuality],
											["Transfer", row.prosper.retentionTransfer],
										].map(([label, value]) => (
											<div key={label as string} className={styles.dimensionRow}>
												<div className={styles.tinyMuted}>{label}</div>
												<div className={styles.progressTrack}>
													<div className={styles.progressFill} style={{ width: percent(value as number) }} />
												</div>
												<div className={styles.rightTiny}>{percent(value as number)}</div>
											</div>
										))}
									</div>
								</div>
							))}
							{rows.length === 0 && <div className={styles.empty}>No PROSPER dimensions yet</div>}
						</div>
					</section>

					<section className={styles.cardSection}>
						<div className={styles.cardSectionHead}>
							<h2 className={styles.sectionTitle}>Cross-model replay</h2>
							<UploadCloud size={18} className={styles.mutedIcon} />
						</div>
						<p className={styles.paragraph}>
							Replay turns human session data into reusable benchmark states. The live steps score observed sessions; the queued provider step will send matched learner states to different models.
						</p>
						<div className={styles.divideText}>
							{[
								{ item: "shared-session ingestion", detail: `${formatNumber(replayCases.length)} replay states extracted`, status: "live" },
								{ item: "deterministic replay scoring", detail: "PROSPER vector runs over observed learner states", status: "live" },
								{ item: "provider replay execution", detail: "same state prompts can be sent to each model next", status: "queued" },
							].map(({ item, detail, status }) => (
								<div key={item} className={styles.replayStep}>
									<div className={styles.min0}>
										<div className={cx(styles.truncate, styles.fontMedium)}>{item}</div>
										<div className={cx(styles.smallMuted, css({ mt: "0.25rem" }))}>{detail}</div>
									</div>
									<span className={styles.statusPill}>{status}</span>
								</div>
							))}
						</div>
					</section>
				</div>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<div>
							<h2 className={styles.sectionTitle}>Replay case bank</h2>
							<p className={styles.sectionSubtitle}>Inspectable learner states used to build the model judgement.</p>
						</div>
						<Medal size={18} className={styles.mutedIcon} />
					</div>
					<div className={styles.replayList}>
						{replayCases.slice(0, 8).map((replayCase) => (
							<div key={replayCase.id} className={styles.replayCase}>
								<div className={styles.replayLeft}>
									<StagePill stage={replayCase.stage} />
									<span className={styles.pill}>{replayCase.signal}</span>
								</div>
								<div className={styles.min0}>
									<div className={cx(styles.truncate, css({ fontSize: "0.875rem", fontWeight: "500" }))}>{replayCase.sessionTitle}</div>
									<p className={styles.lineClamp2}>
										{replayCase.learnerText}
									</p>
								</div>
								<div className={styles.twoColNums}>
									<div className={styles.statBox}>
										<div className={styles.mutedIcon}>Outcome</div>
										<div className={styles.mt1FontMedium}>{Math.round(replayCase.outcomeScore * 100)}%</div>
									</div>
									<div className={styles.statBox}>
										<div className={styles.mutedIcon}>PROSPER</div>
										<div className={styles.mt1FontMedium}>{prosperTotal(replayCase.prosper).toFixed(1)}</div>
									</div>
								</div>
							</div>
						))}
						{replayCases.length === 0 && <div className={styles.empty}>No replay cases yet</div>}
					</div>
				</section>

				<MethodologyExplainer />
			</main>
		</>
	);
}

export function KeatingBench() {
	useSeo({
		title: "KeatingBench | Model Learning Leaderboard",
		description: "Rank teaching models by shared learner-session outcomes and feedback signals.",
		canonical: "https://keating.help/bench",
	});
	return (
		<div className={cx("retro-layout", "retro-page", styles.page)}>
			<Nav />
			<Suspense fallback={
				<div className={styles.centerContent}>
					Loading KeatingBench...
				</div>
			}>
				<KeatingBenchContent />
			</Suspense>
		</div>
	);
}
