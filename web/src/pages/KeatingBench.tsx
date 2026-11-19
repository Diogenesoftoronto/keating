import { IntervalPlot, StackBar, Meter, Timeline } from "../design-system/charts";
import { useId, useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";

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
import { describeRanking, meanInterval, rankByEvidence, type RankResult, type ScoreInterval } from "../keating/bench-stats";


import { useMotionAllowed } from "../design-system/motion";
import "./bench.css";
import { Button, Loading, EmptyState, Card, Chip, DefinitionList, IconButton, Eyebrow, Note, Segmented } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { LearningShell } from "../components/LearningInsightsHeader";

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
	/** 95% interval for the learner-outcome score, on a 0-100 scale. */
	outcomeInterval: ScoreInterval;
	/** Signals read off the transcript by pattern matching, the weakest kind of evidence. */
	inferredSignals: number;
}

interface BenchmarkData {
	samples: SessionSample[];
	quizRecords: QuizResultRecord[];
	feedbackEntries: FeedbackEntry[];
}



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
		keatingStorage.getQuizResults(),
		keatingStorage.getLearnerState(),
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
			outcomeInterval: meanInterval([], [0, 100]),
			inferredSignals: 0,
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
				outcomeInterval: meanInterval(aggregate.outcomes.map((outcome) => outcome.score * 100), [0, 100]),
				inferredSignals: aggregate.outcomes.filter((outcome) => outcome.source === "inferred-turn").length,
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
	return <div className="bench-source"><span>Evidence from</span><Segmented label="Evidence from" size="sm" value={value} onChange={onChange}
		options={[{ value: "shared", label: "Shared" }, { value: "local", label: "Private" }, { value: "all", label: "Both" }]} /></div>;
}

type BenchRow = ModelAggregate & RankResult & { outcome: number; interval: ScoreInterval };

const dimensions: [keyof ProsperVector, string][] = [
	["performance", "Performance"], ["robustness", "Robustness"], ["outcomeLift", "Outcome lift"],
	["sparseCaution", "Sparse caution"], ["personalization", "Personalization"],
	["evidenceQuality", "Evidence quality"], ["retentionTransfer", "Transfer"],
];

function OutcomePlot({ row, leader }: { row: BenchRow; leader?: ScoreInterval }) {
	const value = Math.round(row.outcome);
    return <div className="bench-interval" style={{"--score":value+"%"} as React.CSSProperties}>
      <IntervalPlot label={row.rank === null ? `${row.name}: ${value}. Too few signals for a range` : `${row.name}: ${value}, likely ${Math.round(row.interval.low)} to ${Math.round(row.interval.high)}`} band={leader && [leader.low,leader.high]}
        data={[{label:row.name,value,range:row.rank === null ? undefined : [row.interval.low,row.interval.high]}]}/>
      <small className="bench-mobile">PROSPER {row.prosperScore.toFixed(1)} · {formatNumber(row.signals)} signals</small>
    </div>;
}

function ModelRow({ row, leader, index, partner }: { partner?:string; row: BenchRow; leader?: ScoreInterval; index: number }) {
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	const [visited, setVisited] = useState(false);
	const split = [row.quizCount, row.explicitSignals, row.inferredSignals];
	const splitText = split.map((n, i) => formatNumber(n) + " " + ["quiz", "explicit", "inferred"][i]).join(" · ");
	const quiz = row.quizAverage === null ? "—" : percent(row.quizAverage);
	const replayMix = Object.entries(row.outcomes.reduce<Partial<Record<ReplayStage, number>>>((counts, item) => {
		counts[item.stage] = (counts[item.stage] ?? 0) + 1;
		return counts;
	}, {})).map(([stage, n]) => stage + " " + n).join(" · ");
	return <tbody className="bench-model" data-unranked={row.rank === null} style={{ "--bench-order": Math.min(index, 12) } as React.CSSProperties}>
		<tr onClick={event => { if (!(event.target as Element).closest("button,details,summary,a")) {setVisited(true); setExpanded(!expanded);} }}>
			<td className="bench-rank">{row.rank ?? "—"}{row.tiedWithRank !== null && <small>tied with {row.tiedWithRank}{row.tiedWithRank !== 1 && partner && ` · ${partner}`}</small>}</td>
			<th scope="row"><button type="button" className="bench-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => { setVisited(true); setExpanded(!expanded); }}>
				<KeatingGlyph name={expanded ? "chev" : "chevr"} />{row.name}
			</button><small>{row.provider}</small></th>
			<td className="bench-desktop"><b>{row.prosperScore.toFixed(1)}</b><Meter label="PROSPER" value={row.prosperScore} max={100} tone="data" /></td>
			<td className="bench-outcome"><OutcomePlot row={row} leader={leader} /></td>
			<td className="bench-desktop">{quiz}<small>{row.quizCount ? formatNumber(row.quizCount) + " graded" : "No quizzes yet"}</small></td>
			<td className="bench-desktop">{formatNumber(row.signals)}<StackBar label={splitText} data={split.map((value,i) => ({label:["Quiz","Explicit","Inferred"][i],value}))}/></td>
			<td className="bench-status"><Chip>{row.readiness[0].toUpperCase() + row.readiness.slice(1)}</Chip>{row.rank === null && <small>{row.signalsNeeded} more signals to rank</small>}</td>
		</tr>
		<tr className="bench-detail-row"><td colSpan={7}><div className="bench-reveal" id={id} aria-hidden={!expanded} data-open={expanded}><div>
			{(expanded || visited) && <div className="bench-detail"><div><Eyebrow muted>PROSPER dimensions</Eyebrow>
				{dimensions.map(([key, label]) => <div className="bench-dimension" key={key}><span>{label}</span>
					<Meter label={label} max={1} value={row.prosper[key]} tone="data" /><b>{percent(row.prosper[key])}</b></div>)}</div>
				<DefinitionList items={[
					{ term: "Sessions", detail: formatNumber(row.sessions) + " · " + row.sharedSessions + " shared, " + row.localSessions + " private" },
					{ term: "Signals", detail: splitText }, { term: "Replay mix", detail: replayMix || "—" },
					{ term: "Tokens", detail: formatNumber(row.tokens) }, { term: "Cost", detail: formatCost(row.cost) },
					{ term: "Latest", detail: formatDate(row.latestAt) }, { term: "Model ID", detail: row.key },
					{ term: "Evidence", detail: percent(row.confidence) }, { term: "Quiz average", detail: quiz + " · " + row.quizCount + " graded" },
				]} /></div>}
		</div></div></td></tr>
	</tbody>;
}

function filteredSamples(samples: SessionSample[], source: BenchmarkSource) {
	return source === "all" ? samples : samples.filter((sample) => sample.source === source);
}

function replayCasesFor(samples: SessionSample[], source: BenchmarkSource) {
	return filteredSamples(samples, source).flatMap((sample) => extractReplayCases(sample, serializeModel(sample.model)));
}

function ReplayBank({ cases }: { cases: ReplayCase[] }) {
	const [stage, setStage] = useState<ReplayStage | "All">("All");
	const [limit, setLimit] = useState(8);
	const stages = Array.from(new Set(cases.map(item => item.stage)));
	const visible = stage === "All" ? cases : cases.filter(item => item.stage === stage);
	return <Card as="section" className="bench-bank">
		<h2>Replay case bank</h2><p>Inspectable learner states used to build the model judgement.</p>
		<div role="group" aria-label="Filter replay cases by stage" className="bench-chips">
			{(["All", ...stages] as const).map(value => <Chip as="button" key={value} selected={stage === value}
				onClick={() => { setStage(value); setLimit(8); }}>{value}</Chip>)}</div>
		{visible.slice(0, limit).map(item => <article key={item.source + ":" + item.id} className="bench-case">
			<div><Chip>{item.stage}</Chip><small>{item.signal}</small></div>
			<div><h3>{item.sessionTitle}</h3><p>{item.learnerText}</p></div>
			<div><b>{percent(item.outcomeScore)}</b><small>outcome</small></div>
			<div><b>{prosperTotal(item.prosper).toFixed(1)}</b><small>PROSPER</small></div>
		</article>)}
		{!visible.length && <EmptyState heading="No replay cases yet"/>}
		{visible.length > limit && <Button onClick={() => setLimit(limit + 8)}>Show more</Button>}
	</Card>;
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
		<div className="bench-block">
			<div className="bench-block-head" data-glyph-host>
				<span className="bench-muted-icon">{icon}</span>
				<h3 className="bench-block-title">{title}</h3>
			</div>
			<div className="bench-body-text">{children}</div>
		</div>
	);
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="bench-definition-row">
			<div className="bench-definition-label">{label}</div>
			<div className="bench-definition-value">{value}</div>
		</div>
	);
}

function KeatingBenchExplainer() {
	return (
		<section className="bench-explainer-grid">
			<ExplainerBlock icon={<KeatingGlyph name="help" size={18} />} title="What KeatingBench Tests">
				<p>
					KeatingBench evaluates teaching models by learner outcomes, not by generic chat preference. It looks for moments where a learner signals understanding, confusion, correction, transfer, review need, or dissatisfaction during a teaching session.
				</p>
				<p>
					The current page uses shared sessions cached in this browser plus private local sessions when selected. Shared sessions are the intended benchmark corpus because they preserve real learner interaction patterns.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<KeatingGlyph name="ruler" size={18} />} title="How The Score Works">
				<p>
					The headline rank is the PROSPER score. Raw learner outcome is shown separately so a model cannot win only by making learners sound happy while ignoring robustness, transfer, or evidence quality.
				</p>
				<p>
					Models with enough evidence are ordered by PROSPER. More replay cases increase trust in the score; sparse evidence remains visible but is marked as weak evidence.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<KeatingGlyph name="layers" size={18} />} title="Replay Case Bank">
				<p>
					A replay case is a learner state extracted from a session turn. KeatingBench captures the learner text, nearby assistant context, inferred feedback signal, topic context, and the teaching stage.
				</p>
				<p>
					These cases are the future cross-model harness: the same learner state can be replayed against multiple models, then judged on the same PROSPER dimensions.
				</p>
			</ExplainerBlock>

			<ExplainerBlock icon={<KeatingGlyph name="alert" size={18} />} title="Current Limitations">
				<p>
					Today this is deterministic scoring over observed session data. Provider replay execution is not built, so the page does not yet call every model on the same extracted learner states.
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
		<section className="bench-methodology">
			<div className="bench-methodology-head" data-glyph-host>
				<KeatingGlyph name="book" size={18} className="bench-muted-icon" />
				<h2 className="bench-block-title">Methodology</h2>
			</div>
			<div className="bench-two-grid">
				<DefinitionRow label="Outcome" value="A normalized learner signal. Thumbs up maps high, confused maps mid-low, thumbs down maps low. Inferred learner turns use the same score scale." />
				<DefinitionRow label="Quiz evidence" value="Graded quiz results (objective auto-grading plus teacher-judged open answers) attributed to the model that taught the session. Scored as fraction correct; the highest-quality evidence in the vector." />
				<DefinitionRow label="PROSPER" value="A weighted composite over performance, robustness, outcome lift, sparse-data caution, personalization, evidence quality, and retention or transfer. Most of these are scored by looking for keyword patterns in the tutor's reply, so treat it as a rough heuristic for ordering models, not a measurement of how much anyone learned." />
				<DefinitionRow label="Ranking" value={`A model is placed only once it has ${READINESS_THRESHOLDS.provisional} signals. Each outcome score carries a 95% range; models whose ranges overlap are shown as tied, because the evidence cannot separate them.`} />
				<DefinitionRow label="What this cannot show" value="Models are scored on the sessions they happened to teach, with different learners and topics, so a difference between two models may come from who and what they taught. Inferred signals come from pattern matching on learner messages and are the weakest evidence here." />
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

export function KeatingBenchContent({ samples, quizRecords, feedbackEntries }: BenchmarkData) {
	const posthog = usePostHog();
	const allowed = useMotionAllowed();
	const [source, setSource] = useState<BenchmarkSource>("shared");
	const aggregates = useMemo(() => aggregateSamples(samples, source, quizRecords, feedbackEntries), [samples, source, quizRecords, feedbackEntries]);
	// Only models with enough evidence get a place; the rest are listed as collecting evidence.
	const rows = useMemo(() => rankByEvidence(
		aggregates.map((row) => ({ ...row, interval: row.outcomeInterval, score: row.prosperScore, outcome: row.score })),
		READINESS_THRESHOLDS.provisional,
	), [aggregates]);
	const rankingSummary = useMemo(() => describeRanking(rows, READINESS_THRESHOLDS.provisional), [rows]);
	const replayCases = useMemo(() => replayCasesFor(samples, source), [samples, source]);
	const totals = useMemo(() => rows.reduce(
		(acc, row) => {
			acc.signals += row.signals;
			acc.sessions += row.sessions;
			acc.models += 1;
			acc.ready += row.rank === null ? 0 : 1;
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
			minSignalsToRank: READINESS_THRESHOLDS.provisional,
			rankingSummary,
			scoreNotes: {
				prosperScore: "Weighted composite of seven dimensions, most of them scored by keyword patterns in the reply. A heuristic, not a measured learning outcome.",
				outcome: "Mean learner-outcome score, 0-100, over quiz results, explicit feedback and transcript-inferred signals.",
				outcomeInterval: "95% interval for the outcome mean. Models whose intervals overlap are reported as tied.",
			},
			models: rows.map(({ interval: _interval, score: prosperRank, outcome, ...row }) => ({ ...row, score: outcome, prosperScore: prosperRank })),
		}, null, 2));
		posthog?.capture("keatingbench_exported", {
			source,
			models: rows.length,
			signals: totals.signals,
		});
	};

	return (
		<LearningShell current="benchmark" actions={<IconButton className="bench-export-mobile" glyph="export" label="Export results" onClick={exportLeaderboard} />} controls={<>
			<SourceTabs value={source} onChange={setSource} />
			<Button className="bench-export-desktop" size="sm" variant="ghost" glyph="export" onClick={exportLeaderboard}>Export results</Button>
		</>}>
			<main className="bench-main" data-motion={allowed}>
				<div className="bench-overview">
					<Card as="section" tone="hard" className="bench-verdict k-halftone">
						<Eyebrow>Ranking</Eyebrow>
						<h2 role="status"><span className="bench-desktop">{rankingSummary}</span><span className="bench-mobile">{rankingSummary.split(". ")[0].split(": ")[0].replace(/[.]?$/, ".")}</span></h2>
                        <p className="bench-mobile">{totals.ready >= 2 ? (rows[1].tiedWithRank === 1 ? "The current evidence cannot separate the top two models." : "The two leading models have separate outcome ranges.") : totals.ready === 1 ? "Ranking needs a second model to compare." : `A model needs ${READINESS_THRESHOLDS.provisional} signals to rank.`}</p>
						{totals.ready >= 2 && <p>{rows[0].name} and {rows[1].name} score {rows[0].prosperScore.toFixed(1)} and {rows[1].prosperScore.toFixed(1)} on PROSPER, a gap of {(rows[0].prosperScore - rows[1].prosperScore).toFixed(1)} points.
							{" "}{rows[1].tiedWithRank === 1 ? "The first two models’ outcome ranges overlap." : "The first two models’ outcome ranges are separate."}</p>}
						<div className="bench-chips">
							<Chip>{formatNumber(totals.models)} {totals.models === 1 ? "model" : "models"}</Chip><Chip>{formatNumber(totals.ready)} ranked</Chip>
							<Chip>{formatNumber(totals.signals)} {totals.signals === 1 ? "signal" : "signals"}</Chip><Chip>{formatNumber(totals.quizzes)} graded {totals.quizzes === 1 ? "quiz" : "quizzes"}</Chip>
						</div>
						<small>{formatNumber(totals.sessions)} sessions · {formatNumber(samples.filter(sample => sample.source === "shared").length)} shared cached · {formatNumber(totals.explicit)} explicit signals</small>
						<Note data-glyph-host glyph="alert"><span className="bench-mobile">Different learners and topics can affect the scores.</span><span className="bench-desktop">Each model is scored on the sessions it happened to teach, with different learners and topics. A gap may come from who and what it taught.</span></Note>
					</Card>
					<Card as="section" className="bench-threshold">
						<h2><Eyebrow muted>How much evidence a model needs</Eyebrow></h2>
						<div className="bench-threshold-chart">
              <Timeline domain={[0,100]} label="Readiness thresholds in signals" lanes={[{label:"Signals",bands:Object.entries(READINESS_THRESHOLDS).map(([band,end],index,entries) => ({
                label:`To ${band === "provisional" ? "ranked" : band} threshold`, start:index ? entries[index-1][1] : 0,end,
              }))}]}/>
              <div className="bench-threshold-labels">{Object.entries(READINESS_THRESHOLDS).map(([band,value]) =>
                <span key={band} style={{left:value+"%"}}><b>{value}</b>{band === "provisional" ? "ranked" : band}</span>)}</div>
            </div>
						<p>A model is placed once it has {READINESS_THRESHOLDS.provisional} signals. Graded quizzes are the strongest evidence. Inferred signals are the weakest.</p>
					</Card>
				</div>
				<Card as="section" className="bench-board" aria-label="Leaderboard">
					<table><caption className="bench-sr">Leaderboard. PROSPER orders the ranked models.</caption>
						<thead><tr>{["Rank", "Model", "PROSPER"].map(label => <th key={label}>{label}</th>)}
							<th>Outcome, with its 95% range<span className="bench-axis"><i>0</i><i>50</i><i>100</i></span></th>
							<th>Quizzes</th><th>Signals</th><th>Status</th>
						</tr></thead>
						{rows.map((row, index) => <ModelRow key={row.key} row={row} index={index} partner={row.tiedWithRank ? rows[row.tiedWithRank-1]?.name : undefined} leader={rows[0]?.rank === 1 ? rows[0].interval : undefined} />)}
					</table>
					{!rows.length && <EmptyState heading="No benchmarkable sessions in this view."/>}
					<div className="bench-legend">
						{["quiz", "explicit", "inferred"].map((label, i) => <span key={label}><i style={{ background: "var(--series-" + (i + 1) + ")" }} />{label}</span>)}
						<span><i className="bench-band-key" />The shaded band is the leader’s range. Ranked models that touch it are tied with the leader.</span>
					</div>
				</Card>
				<div className="bench-lower">
					<ReplayBank key={source} cases={replayCases} />
					<Card as="section" className="bench-guide">
						<h2>How to read this</h2>
						<DefinitionList items={[
							{ term: "Outcome", detail: "A learner signal from 0 to 100, drawn from feedback, transcript cues and graded quizzes." },
							{ term: "PROSPER", detail: "A weighted mix of seven dimensions. Most use keyword patterns, so treat it as a rough ordering." },
							{ term: "Not built", detail: "Sending the same learner moment to every model for a like-for-like comparison." },
						]} />
						<details><summary>How these scores are computed, and what they cannot show</summary>
							<KeatingBenchExplainer /><MethodologyExplainer />
						</details>
						<h3>Cross-model replay</h3>
						<DefinitionList items={[
							{ term: "Session ingestion", detail: formatNumber(replayCases.length) + " replay states extracted · live" },
							{ term: "Deterministic replay scoring", detail: "PROSPER vector runs over observed learner states · live" },
							{ term: "Provider replay execution", detail: "Matched learner states sent to every model for a like-for-like comparison · not built" },
						]} />
					</Card>
				</div>
			</main>
		</LearningShell>
	);
}

export function KeatingBench() {
	useSeo({
		title: "KeatingBench | Model Learning Leaderboard",
		description: "Rank teaching models by shared learner-session outcomes and feedback signals.",
		canonical: "https://keating.help/bench",
	});
	const [attempt, setAttempt] = useState(0);
	const [data, setData] = useState<BenchmarkData | null>(null);
	const [failure, setFailure] = useState<"startup" | "evidence" | null>(null);
	useEffect(() => {
		let active = true;
		async function load() {
			try {
				await getInitPromise();
			} catch {
				if (active) setFailure("startup");
				return;
			}
			if (!active) return;
			try {
				const result = await loadBenchmarkData();
				if (active) setData(result);
			} catch {
				if (active) setFailure("evidence");
			}
		}
		void load();
		return () => { active = false; };
	}, [attempt]);

	function retry() {
		// Storage initialization is cached for the lifetime of the app.
		if (failure === "startup") {
			window.location.reload();
			return;
		}
		setFailure(null);
		setAttempt(value => value + 1);
	}

	return <div className="bench-page">
		{data ? <KeatingBenchContent {...data} /> : <LearningShell current="benchmark">
			<main className="bench-state">{failure ? <>
				<p role="alert">Could not load benchmark evidence.</p>
				<Button onClick={retry}>Try again</Button>
			</> : <Loading size="page" label="Loading KeatingBench..."/>}</main>
		</LearningShell>}
	</div>;
}
