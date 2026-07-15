import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { keatingStorage } from "../hooks/keating-storage";
import type {
	BenchmarkResult,
	EvolutionResult,
	FeedbackEntry,
	ImprovementAttemptRecord,
	LearnerState,
	Policy,
	Verification,
} from "../keating/storage";
import type { SessionMetadata } from "../types/session";
import {
	buildTopicArtifactGroups,
	buildTopicHierarchy,
	categorizeUsageTopic,
	type HierarchyNode,
	type TopicArtifactGroup,
	type TopicArtifactInput,
} from "./usage-topic-groups";
import {
	buildModelUsageBreakdown,
	aggregateFeedback,
	getCurriculumDisplayEnd,
	getPrimaryCurriculumTopic,
	getVisibleCurriculumSessions,
	hasMeaningfulPolicyScores,
	type ModelUsageBreakdown,
	type ModelUsageEntry,
	type FeedbackSignalGroup,
} from "./usage-chart-data";
import { css, cx } from "../../styled-system/css";
import { EmptyState } from "./EmptyState";

const styles = {
	panel: css({ borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--background)" }),
	panelHeader: css({ borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	panelTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	panelSubtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	panelBody: css({ p: "1rem" }),
	loading: css({ mt: "1.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", bg: "var(--background)", p: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	stack: css({ mt: "1.5rem", display: "flex", flexDir: "column", gap: "1.5rem" }),
	threeGrid: css({ display: "grid", gap: "1.5rem", lg: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	modelWheelGrid: css({ display: "grid", gap: "1rem", xl: { gridTemplateColumns: "minmax(0, 0.9fr) minmax(12rem, 1fr)", alignItems: "center" } }),
	pieBox: css({ h: "14rem", minW: 0 }),
	stack2: css({ minW: 0, "& > * + *": { mt: "0.5rem" } }),
	modelRow: css({ minW: 0, borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)", pb: "0.5rem", _last: { borderBottom: 0, pb: 0 } }),
	modelButton: css({ w: "100%", minW: 0, borderRadius: "0.375rem", border: "1px solid transparent", px: "0.5rem", py: "0.5rem", textAlign: "left", transitionProperty: "background-color, border-color", transitionDuration: "150ms", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	selectedButton: css({ borderColor: "var(--border)", bg: "color-mix(in srgb, var(--accent) 65%, transparent)" }),
	between: css({ display: "flex", minW: 0, alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
	row: css({ display: "flex", minW: 0, alignItems: "center", gap: "0.5rem" }),
	dot: css({ h: "0.625rem", w: "0.625rem", flexShrink: 0, borderRadius: "9999px" }),
	truncateStrong: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: "600" }),
	smallMuted: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	shareText: css({ flexShrink: 0, fontSize: "0.75rem", fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" }),
	modelDetail: css({ mt: "0.25rem", minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pl: "1rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	metricGrid: css({ mb: "1rem", display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }),
	mutedNotice: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", px: "1rem", py: "1.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	chartGrid: css({ display: "grid", gridTemplateColumns: "2.75rem minmax(0, 1fr)", gap: "0.75rem" }),
	axisLabels: css({ position: "relative", fontSize: "11px", fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" }),
	axisLabel: css({ position: "absolute", right: 0, transform: "translateY(-50%)" }),
	legendRow: css({ mt: "0.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", fontSize: "0.75rem" }),
	legendItem: css({ display: "flex", alignItems: "center", gap: "0.375rem" }),
	legendSwatch: css({ display: "inline-block", h: "0.375rem", w: "1rem", borderRadius: "9999px" }),
	improvementTitle: css({ mb: "0.5rem", fontSize: "0.75rem", fontWeight: "600", textTransform: "uppercase", color: "var(--muted-foreground)" }),
	barWrap: css({ display: "flex", h: "3rem", alignItems: "flex-end", gap: "0.25rem" }),
	flex1: css({ flex: "1 1 0%" }),
	improvementBar: css({ borderRadius: "0.125rem", transitionProperty: "all", transitionDuration: "150ms" }),
	improvementBarGood: css({ bg: "#22c55e" }),
	improvementBarBad: css({ bg: "var(--destructive)" }),
	barFooter: css({ mt: "0.25rem", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted-foreground)" }),
	evolutionList: css({ mt: "1rem", borderTop: "1px solid var(--border)" }),
	evolutionButton: css({ display: "flex", w: "100%", minW: 0, alignItems: "center", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)", px: "0.75rem", py: "0.625rem", textAlign: "left", _last: { borderBottom: 0 }, _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }),
	evolutionName: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: "600" }),
	evolutionMeta: css({ mt: "0.125rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	viewDiff: css({ flexShrink: 0, fontSize: "0.75rem", color: "var(--primary)" }),
	metricTile: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", px: "0.75rem", py: "0.5rem" }),
	metricTileLabel: css({ fontSize: "11px", fontWeight: "500", textTransform: "uppercase", color: "var(--muted-foreground)" }),
	metricTileValue: css({ mt: "0.25rem", fontSize: "1.125rem", fontWeight: "600" }),
	wheelGrid: css({ display: "grid", gap: "1rem", xl: { gridTemplateColumns: "minmax(0, 1fr) minmax(16rem, 0.8fr)" } }),
	relative: css({ position: "relative" }),
	breadcrumbs: css({ position: "absolute", left: "0.75rem", top: "0.5rem", zIndex: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem" }),
	crumbButton: css({ borderRadius: "0.375rem", bg: "color-mix(in srgb, var(--background) 90%, transparent)", px: "0.5rem", py: "0.125rem", fontSize: "11px", fontWeight: "500", color: "var(--muted-foreground)", backdropFilter: "blur(8px)", transitionProperty: "color, background-color", transitionDuration: "150ms", _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" } }),
	crumbColored: css({ borderRadius: "0.375rem", bg: "color-mix(in srgb, var(--background) 90%, transparent)", px: "0.5rem", py: "0.125rem", fontSize: "11px", fontWeight: "500", backdropFilter: "blur(8px)", transitionProperty: "color, background-color", transitionDuration: "150ms", _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" } }),
	mutedSlash: css({ color: "var(--muted-foreground)" }),
	fullSvg: css({ h: "100%", w: "100%" }),
	clickPath: css({ cursor: "pointer", transitionProperty: "opacity", transitionDuration: "150ms" }),
	cursorPointer: css({ cursor: "pointer" }),
	noPointer: css({ pointerEvents: "none" }),
	tooltip: css({ pointerEvents: "none", position: "absolute", zIndex: 20, borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "var(--popover)", px: "0.75rem", py: "0.5rem", color: "var(--popover-foreground)", boxShadow: "var(--shadow, 0 4px 6px rgb(0 0 0 / 0.1))" }),
	semibold: css({ fontWeight: "600" }),
	tinyMuted: css({ fontSize: "11px", color: "var(--muted-foreground)" }),
	tinyPrimary: css({ mt: "0.25rem", fontSize: "10px", color: "var(--primary)" }),
	detailPanel: css({ minW: 0, "& > * + *": { mt: "0.5rem" } }),
	detailHeader: css({ display: "flex", alignItems: "center", justifyContent: "space-between" }),
	sectionLabel: css({ fontSize: "0.75rem", fontWeight: "600", textTransform: "uppercase", color: "var(--muted-foreground)" }),
	backButton: css({ borderRadius: "0.375rem", px: "0.5rem", py: "0.125rem", fontSize: "11px", color: "var(--primary)", transitionProperty: "background-color", transitionDuration: "150ms", _hover: { bg: "color-mix(in srgb, var(--primary) 10%, transparent)" } }),
	detailCard: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", p: "0.625rem" }),
	selectionCard: css({ mt: "0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", p: "0.75rem" }),
	selectionTitle: css({ fontSize: "0.8rem", fontWeight: "600" }),
	selectionMeta: css({ mt: "0.25rem", fontSize: "0.75rem", lineHeight: "1.5", color: "var(--muted-foreground)" }),
	selectionActions: css({ mt: "0.625rem", display: "flex", flexWrap: "wrap", gap: "0.375rem" }),
	selectionAction: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.625rem", py: "0.375rem", fontSize: "0.75rem", color: "var(--primary)", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	childTopics: css({ mt: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" }),
	topicPill: css({ borderRadius: "9999px", bg: "var(--background)", px: "0.5rem", py: "0.125rem", fontSize: "10px", color: "var(--muted-foreground)" }),
	overflowX: css({ overflowX: "auto" }),
	heatmapRoot: css({ position: "relative" }),
	yearTabs: css({ mb: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" }),
	yearButton: css({ borderRadius: "0.375rem", px: "0.625rem", py: "0.25rem", fontSize: "0.75rem", fontWeight: "500", transitionProperty: "color, background-color", transitionDuration: "150ms", md: { fontSize: "1.125rem" } }),
	yearActive: css({ bg: "var(--primary)", color: "var(--primary-foreground)" }),
	yearInactive: css({ color: "var(--muted-foreground)", _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" } }),
	heatTooltip: css({ pointerEvents: "none", position: "absolute", zIndex: 20, transform: "translate(-50%, -100%)", borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "var(--popover)", px: "0.75rem", py: "0.5rem", color: "var(--popover-foreground)", boxShadow: "var(--shadow, 0 4px 6px rgb(0 0 0 / 0.1))" }),
	dayDetail: css({ mt: "1rem", borderTop: "1px solid var(--border)", pt: "0.75rem" }),
	dayTitle: css({ mb: "0.5rem", fontSize: "0.75rem", fontWeight: "600" }),
	daySession: css({ display: "flex", w: "100%", minW: 0, alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderRadius: "0.375rem", px: "0.625rem", py: "0.5rem", textAlign: "left", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	daySessionTitle: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: "600" }),
	daySessionMeta: css({ mt: "0.125rem", minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--muted-foreground)" }),
	comingGrid: css({ display: "grid", gap: "1rem", md: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	mt2SmallMuted: css({ mt: "0.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	listStack: css({ mt: "0.5rem", fontSize: "0.875rem", "& > * + *": { mt: "0.375rem" } }),
	checkItem: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.5rem", py: "0.375rem" }),
	fontMediumTruncate: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: "500" }),
	wrapPills: css({ mt: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.375rem" }),
	weakPill: css({ borderRadius: "9999px", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", bg: "color-mix(in srgb, var(--destructive) 5%, transparent)", px: "0.625rem", py: "0.25rem", fontSize: "0.75rem", color: "var(--destructive)" }),
	strongPill: css({ borderRadius: "9999px", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)", bg: "color-mix(in srgb, var(--primary) 5%, transparent)", px: "0.625rem", py: "0.25rem", fontSize: "0.75rem", color: "var(--primary)" }),
};

function ChartPanel({
	title,
	subtitle,
	children,
	className = "",
}: {
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className={cx(styles.panel, className)}>
			<div className={styles.panelHeader}>
				<h2 className={styles.panelTitle}>{title}</h2>
				{subtitle && <p className={styles.panelSubtitle}>{subtitle}</p>}
			</div>
			<div className={styles.panelBody}>{children}</div>
		</section>
	);
}

interface UsageChartsProps {
	sessionMetadata: SessionMetadata[];
	onOpenSession: (sessionId: string) => void;
}

export function UsageCharts({ sessionMetadata, onOpenSession }: UsageChartsProps) {
	const navigate = useNavigate();
	const [data, setData] = useState<{
		topicGroups: TopicArtifactGroup[];
		sessions: LearnerState["sessions"];
		openChecklists: Verification[];
		weaknesses: string[];
		strengths: string[];
		feedback: FeedbackEntry[];
		benchmarks: BenchmarkResult[];
		evolutions: EvolutionResult[];
		improvements: ImprovementAttemptRecord[];
		policies: Policy[];
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const [
					plans,
					maps,
					animations,
					verifications,
					learnerState,
					feedback,
					benchmarks,
					evolutions,
					improvements,
					policies,
				] = await Promise.all([
					keatingStorage.getLessonPlans(),
					keatingStorage.getLessonMaps(),
					keatingStorage.getAnimations(),
					keatingStorage.getVerifications(),
					keatingStorage.getLearnerState(),
					keatingStorage.getFeedback(),
					keatingStorage.getBenchmarks(),
					keatingStorage.getEvolutions(),
					keatingStorage.getImprovementAttempts(),
					keatingStorage.getPolicies(),
				]);

				const topicArtifacts: TopicArtifactInput[] = [
					...plans.map((p) => ({ topic: p.topic, type: "plan" as const })),
					...maps.map((m) => ({ topic: m.topic, type: "map" as const })),
					...animations.map((a) => ({ topic: a.topic, type: "animation" as const })),
					...verifications.map((v) => ({ topic: v.topic, type: "verification" as const })),
				];
				const topicGroups = buildTopicArtifactGroups(topicArtifacts);

				if (cancelled) return;
				setData({
					topicGroups,
					sessions: learnerState.sessions ?? [],
					openChecklists: verifications.filter((v) => !v.completed),
					weaknesses: learnerState.weaknesses ?? [],
					strengths: learnerState.strengths ?? [],
					feedback,
					benchmarks,
					evolutions,
					improvements,
					policies,
				});
			} catch (err) {
				console.error("Failed to load chart data", err);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (!data) {
		return (
			<div className={styles.loading}>
				Loading charts…
			</div>
		);
	}

	const totalTopicArtifacts = data.topicGroups.reduce((sum, t) => sum + t.count, 0);
	const feedbackMix = aggregateFeedback(data.feedback);
	const modelMix = buildModelUsageBreakdown(sessionMetadata, Math.max(1, sessionMetadata.length));

	return (
		<div className={styles.stack}>
			<div className={styles.threeGrid}>
				<ChartPanel
					title="Topic mix"
					subtitle={`Artifacts grouped into learning domains${totalTopicArtifacts ? ` (${totalTopicArtifacts} total)` : ""}`}
				>
					{data.topicGroups.length === 0 ? (
						<EmptyState message="No topic artifacts yet — start a lesson to see this fill in." />
					) : (
						<TopicGroupWheel groups={data.topicGroups} />
					)}
				</ChartPanel>

				<ChartPanel
					title="Model mix"
					subtitle={modelMix.basis === "tokens" ? "Share of token usage by model" : "Share of message usage by model"}
				>
					{modelMix.entries.length === 0 || modelMix.total === 0 ? (
						<EmptyState message="No model usage recorded yet." />
					) : (
						<ModelUsageWheel breakdown={modelMix} />
					)}
				</ChartPanel>

				<ChartPanel
					title="Feedback signal mix"
					subtitle="How sessions are landing — confused, confident, or curious"
				>
					{feedbackMix.length === 0 ? (
						<EmptyState message="No feedback recorded yet." />
					) : (
						<FeedbackSignalWheel groups={feedbackMix} onOpenSession={onOpenSession} />
					)}
				</ChartPanel>
			</div>

			<ChartPanel
				title="Curriculum timeline"
				subtitle="Each row is a learning session — bar length is duration, color is the first topic covered"
			>
				<CurriculumGantt sessions={data.sessions} colorFor={(t) => categorizeUsageTopic(t).color} onOpenSession={onOpenSession} />
			</ChartPanel>

			<ChartPanel
				title="Daily activity"
				subtitle="Select an active day to see what you discussed"
			>
				<ActivityHeatmap sessions={sessionMetadata} onOpenSession={onOpenSession} />
			</ChartPanel>

			<ChartPanel
				title="Self-evolution health"
				subtitle="Benchmark scores, evolved policy scores, rollback attempts, and active policy count"
			>
				<PolicyGrowthPanel
					benchmarks={data.benchmarks}
					evolutions={data.evolutions}
					improvements={data.improvements}
					policies={data.policies}
					onOpenEvolution={(evolutionId) => navigate({ to: "/usage/evolution/$evolutionId", params: { evolutionId } })}
				/>
			</ChartPanel>

			<ChartPanel
				title="Coming up"
				subtitle="Open checklists and weak spots that could use another pass"
			>
				<ComingUpPanel
					openChecklists={data.openChecklists}
					weaknesses={data.weaknesses}
					strengths={data.strengths}
				/>
			</ChartPanel>
		</div>
	);
}

function formatCompactNumber(value: number) {
	return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function modelUsageTooltipLabel(basis: ModelUsageBreakdown["basis"]) {
	return basis === "tokens" ? "tokens" : "messages";
}

function ModelUsageWheel({ breakdown }: { breakdown: ModelUsageBreakdown }) {
	const metricLabel = modelUsageTooltipLabel(breakdown.basis);
	const [selectedKey, setSelectedKey] = useState(breakdown.entries[0]?.key ?? "");
	const selected = breakdown.entries.find((entry) => entry.key === selectedKey) ?? breakdown.entries[0];
	return (
		<div>
			<div className={styles.modelWheelGrid}>
				<div className={styles.pieBox}>
					<ResponsiveContainer>
						<PieChart>
							<Pie
								data={breakdown.entries}
								dataKey="value"
								nameKey="label"
								innerRadius={52}
								outerRadius={84}
								paddingAngle={2}
								stroke="var(--background, #fff)"
								strokeWidth={1}
								onClick={(_, index) => setSelectedKey(breakdown.entries[index]?.key ?? selectedKey)}
							>
								{breakdown.entries.map((entry) => (
									<Cell key={entry.key} fill={entry.color} opacity={entry.key === selected?.key ? 1 : 0.52} className={styles.cursorPointer} />
								))}
							</Pie>
							<Tooltip
								formatter={(value, _name, item) => {
									const entry = item.payload as ModelUsageEntry;
									return [
										`${formatCompactNumber(Number(value))} ${metricLabel} (${Math.round(entry.share * 100)}%)`,
										entry.label,
									];
								}}
								contentStyle={{
									background: "var(--background, #fff)",
									border: "1px solid var(--border, #e5e7eb)",
									borderRadius: 6,
									fontSize: 12,
								}}
							/>
						</PieChart>
					</ResponsiveContainer>
				</div>
				<div className={styles.stack2} aria-label="Select a model to inspect">
					{breakdown.entries.map((entry) => (
						<button key={entry.key} type="button" className={cx(styles.modelButton, entry.key === selected?.key ? styles.selectedButton : "")} onClick={() => setSelectedKey(entry.key)}>
							<div className={styles.between}>
								<div className={styles.row}>
									<span className={styles.dot} style={{ background: entry.color }} />
									<div className={styles.truncateStrong}>{entry.label}</div>
								</div>
								<div className={styles.shareText}>{Math.round(entry.share * 100)}%</div>
							</div>
							<div className={styles.modelDetail}>{entry.provider}/{entry.modelId}</div>
						</button>
					))}
				</div>
			</div>
			{selected && (
				<div className={styles.selectionCard} aria-live="polite">
					<div className={styles.selectionTitle}>{selected.label}</div>
					<div className={styles.selectionMeta}>
						{selected.provider}/{selected.modelId} · {formatCompactNumber(selected.tokens)} tokens · {selected.messages} messages · {selected.sessions} session{selected.sessions === 1 ? "" : "s"} · {Math.round(selected.share * 100)}% of recorded {metricLabel}
					</div>
				</div>
			)}
		</div>
	);
}

function PolicyGrowthPanel({
 benchmarks,
 evolutions,
 improvements,
 policies,
 onOpenEvolution,
}: {
 benchmarks: BenchmarkResult[];
 evolutions: EvolutionResult[];
 improvements: { baselineScore: number; afterScore: number | null; scoreDelta: number | null; createdAt: number }[];
 policies: { active: boolean; createdAt: number; updatedAt: number }[];
 onOpenEvolution: (evolutionId: string) => void;
}) {
	const [selectedTrend, setSelectedTrend] = useState<{
		kind: "Benchmark" | "Evolution";
		id?: string;
		score: number;
		createdAt: number;
	} | null>(null);
	const hasAny = benchmarks.length > 0 || evolutions.length > 0 || improvements.length > 0 || policies.length > 0;
	if (!hasAny) {
		return <EmptyState message="No self-evolution records yet — run a benchmark or evolution to see health signals here." />;
	}

	const maxScore = 100;
	const height = 132;
	const leftPad = 10;
	const rightPad = 3;
	const chartBottom = height - 28;
	const chartTop = 12;

	const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	const benchmarkScores = benchmarks.map((b) => ({ id: b.id, score: b.score, createdAt: b.createdAt }));
	const evolutionScores = evolutions.map((e) => ({ id: e.id, score: e.bestScore, createdAt: e.createdAt }));
	const allScores = [...benchmarkScores, ...evolutionScores].sort((a, b) => a.createdAt - b.createdAt);
	const scoreSignalsAreMeaningful = hasMeaningfulPolicyScores(allScores);
	const minT = allScores[0]?.createdAt ?? Date.now();
	const maxT = allScores[allScores.length - 1]?.createdAt ?? minT;
	const span = Math.max(maxT - minT, 1);

	const makePoints = (
		arr: Array<{ id?: string; score: number; createdAt: number }>,
		color: string,
		label: "Benchmark" | "Evolution",
	) => {
		if (arr.length === 0) return null;
		const sorted = [...arr].sort((a, b) => a.createdAt - b.createdAt);
		const usableW = 100 - leftPad - rightPad;
		return {
			label,
			color,
			points: sorted.map((d) => ({
				id: d.id,
				x: leftPad + ((d.createdAt - minT) / span) * usableW,
				y: chartBottom - (d.score / maxScore) * (chartBottom - chartTop),
				score: d.score,
				createdAt: d.createdAt,
				date: fmtDate(d.createdAt),
			})),
		};
	};

	const benchmarkLine = makePoints(benchmarkScores, "#6366f1", "Benchmark");
	const evolutionLine = makePoints(evolutionScores, "#22c55e", "Evolution");
	const orderedBenchmarks = [...benchmarks].sort((a, b) => a.createdAt - b.createdAt);
	const orderedEvolutions = [...evolutions].sort((a, b) => a.createdAt - b.createdAt);
	const latestBenchmark = orderedBenchmarks[orderedBenchmarks.length - 1];
	const latestEvolution = orderedEvolutions[orderedEvolutions.length - 1];
	const activePolicies = policies.filter((p) => p.active).length;

	const improvementBars = improvements
		.filter((i) => i.scoreDelta !== null)
		.sort((a, b) => a.createdAt - b.createdAt)
		.slice(-12);
	const acceptedAttempts = improvements.filter((i) => (i.scoreDelta ?? -Infinity) >= 0).length;
	const rejectedAttempts = improvements.filter((i) => (i.scoreDelta ?? 0) < 0).length;
	const recentEvolutions = [...evolutions].sort((left, right) => right.createdAt - left.createdAt).slice(0, 6);

	return (
		<div>
			<div className={styles.metricGrid}>
				<MetricTile label="Latest benchmark" value={latestBenchmark ? latestBenchmark.score.toFixed(1) : "none"} />
				<MetricTile label="Latest evolution" value={latestEvolution ? latestEvolution.bestScore.toFixed(1) : "none"} />
				<MetricTile label="Active policies" value={`${activePolicies}/${policies.length}`} />
				<MetricTile label="Attempts" value={`${acceptedAttempts} kept / ${rejectedAttempts} rejected`} />
			</div>

			<div className={css({ mb: "1rem" })}>
				{allScores.length === 0 ? (
					<EmptyState message="Policy records exist, but no benchmark scores have been recorded yet." />
				) : !scoreSignalsAreMeaningful ? (
					<div className={styles.mutedNotice}>
						Scores are recorded, but they are still all 0.0. Add feedback signals and rerun benchmark or evolution before treating this as a trend.
					</div>
				) : (
					<div className={styles.chartGrid}>
						<div className={styles.axisLabels} style={{ height }}>
							{[0, 25, 50, 75, 100].map((tick) => {
								const y = chartBottom - (tick / maxScore) * (chartBottom - chartTop);
								return (
									<div
										key={tick}
										className={styles.axisLabel}
										style={{ top: `${(y / height) * 100}%` }}
									>
										{tick}
									</div>
								);
							})}
						</div>
						<svg width="100%" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label="Self-evolution score trend">
							{[0, 25, 50, 75, 100].map((tick) => {
								const y = chartBottom - (tick / maxScore) * (chartBottom - chartTop);
								return (
									<line key={tick} x1={0} y1={y} x2={100 - rightPad} y2={y} stroke="currentColor" strokeOpacity={0.08} />
								);
							})}

							{[benchmarkLine, evolutionLine].filter(Boolean).map((line) => {
								if (!line) return null;
								const d = line.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x - leftPad} ${p.y}`).join(" ");
								return (
									<g key={line.label}>
										<path d={d} fill="none" stroke={line.color} strokeWidth={0.8} opacity={0.8} />
										{line.points.map((p, i) => (
											<circle
												key={i}
												cx={p.x - leftPad}
												cy={p.y}
												r={selectedTrend?.kind === line.label && selectedTrend.createdAt === p.createdAt ? 2.1 : 1.4}
												fill={line.color}
												stroke="var(--background)"
												strokeWidth={0.5}
												className={styles.cursorPointer}
												role="button"
												tabIndex={0}
												aria-label={`Inspect ${line.label.toLowerCase()} score ${p.score.toFixed(1)} on ${p.date}`}
												onClick={() => setSelectedTrend({ kind: line.label, id: p.id, score: p.score, createdAt: p.createdAt })}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault();
														setSelectedTrend({ kind: line.label, id: p.id, score: p.score, createdAt: p.createdAt });
													}
												}}
											>
												<title>{line.label}: {p.score.toFixed(1)} on {p.date}</title>
											</circle>
										))}
									</g>
								);
							})}
						</svg>
					</div>
				)}

				<div className={styles.legendRow}>
					{benchmarkLine && (
						<div className={styles.legendItem}>
							<span className={styles.legendSwatch} style={{ background: benchmarkLine.color }} />
							<span className={styles.smallMuted}>Benchmark scores</span>
						</div>
					)}
					{evolutionLine && (
						<div className={styles.legendItem}>
							<span className={styles.legendSwatch} style={{ background: evolutionLine.color }} />
							<span className={styles.smallMuted}>Evolved policy scores</span>
						</div>
					)}
				</div>
				{selectedTrend && (
					<div className={styles.selectionCard} aria-live="polite">
						<div className={styles.selectionTitle}>{selectedTrend.kind} score {selectedTrend.score.toFixed(2)}</div>
						<div className={styles.selectionMeta}>{new Date(selectedTrend.createdAt).toLocaleString()}</div>
						{selectedTrend.kind === "Evolution" && selectedTrend.id && (
							<div className={styles.selectionActions}>
								<button type="button" className={styles.selectionAction} onClick={() => onOpenEvolution(selectedTrend.id!)}>
									View exact diff
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			{improvementBars.length > 0 && (
				<div>
					<div className={styles.improvementTitle}>Recent improvements</div>
					<div className={styles.barWrap}>
						{improvementBars.map((bar, i) => {
							const delta = bar.scoreDelta ?? 0;
							const positive = delta >= 0;
							return (
								<div key={i} className={styles.flex1}>
									<div
										className={cx(styles.improvementBar, positive ? styles.improvementBarGood : styles.improvementBarBad)}
										style={{ height: `${Math.min(Math.abs(delta) * 40 + 4, 40)}px`, opacity: 0.75 }}
										title={`Delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} on ${fmtDate(bar.createdAt)}`}
									/>
								</div>
							);
						})}
					</div>
					<div className={styles.barFooter}>
						<span>{improvementBars.length} latest</span>
						<span>{activePolicies} active policy{activePolicies === 1 ? "" : "ies"} / {policies.length} total</span>
					</div>
				</div>
			)}

			{recentEvolutions.length > 0 && (
				<div className={styles.evolutionList}>
					{recentEvolutions.map((evolution) => (
						<button key={evolution.id} type="button" className={styles.evolutionButton} onClick={() => onOpenEvolution(evolution.id)}>
							<div className={styles.flex1}>
								<div className={styles.evolutionName}>{evolution.topic || "General teaching policy"}</div>
								<div className={styles.evolutionMeta}>Score {evolution.bestScore.toFixed(2)} · {new Date(evolution.createdAt).toLocaleString()}</div>
							</div>
							<span className={styles.viewDiff}>View exact diff</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function MetricTile({ label, value }: { label: string; value: string }) {
	return (
		<div className={styles.metricTile}>
			<div className={styles.metricTileLabel}>{label}</div>
			<div className={styles.metricTileValue}>{value}</div>
		</div>
	);
}

function artifactTypeSummary(group: TopicArtifactGroup): string {
	const labels: Array<[keyof TopicArtifactGroup["types"], string]> = [
		["plan", "plans"],
		["map", "maps"],
		["animation", "animations"],
		["verification", "checks"],
	];
	return labels
		.filter(([key]) => group.types[key] > 0)
		.map(([key, label]) => `${group.types[key]} ${label}`)
		.join(" · ");
}

/* ── Interactive 3-level sunburst wheel ─────────────────────────────────── */

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
	const rad = ((angleDeg - 90) * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r0: number, r1: number, startDeg: number, endDeg: number): string {
	if (endDeg - startDeg >= 360 - 0.01) {
		// Full circle — use two semi-circles to avoid arc rendering artifacts
		const p0s = polarToCartesian(cx, cy, r1, startDeg);
		const p0e = polarToCartesian(cx, cy, r1, startDeg + 180);
		const p1s = polarToCartesian(cx, cy, r0, startDeg + 180);
		const p1e = polarToCartesian(cx, cy, r0, startDeg);
		return [
			`M ${p0s.x} ${p0s.y}`,
			`A ${r1} ${r1} 0 1 1 ${p0e.x} ${p0e.y}`,
			`A ${r1} ${r1} 0 1 1 ${p0s.x} ${p0s.y}`,
			`M ${p1e.x} ${p1e.y}`,
			`A ${r0} ${r0} 0 1 0 ${p1s.x} ${p1s.y}`,
			`A ${r0} ${r0} 0 1 0 ${p1e.x} ${p1e.y}`,
			"Z",
		].join(" ");
	}
	const outerStart = polarToCartesian(cx, cy, r1, startDeg);
	const outerEnd = polarToCartesian(cx, cy, r1, endDeg);
	const innerEnd = polarToCartesian(cx, cy, r0, endDeg);
	const innerStart = polarToCartesian(cx, cy, r0, startDeg);
	const largeArc = endDeg - startDeg > 180 ? 1 : 0;
	return [
		`M ${outerStart.x} ${outerStart.y}`,
		`A ${r1} ${r1} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
		`L ${innerEnd.x} ${innerEnd.y}`,
		`A ${r0} ${r0} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
		"Z",
	].join(" ");
}

interface SunburstSegment {
	node: HierarchyNode;
	path: string;
	color: string;
	label: string;
	level: number;
	startAngle: number;
	endAngle: number;
	parentColor: string;
}

function buildSunburstSegments(
	root: HierarchyNode,
	cx: number,
	cy: number,
	selectedNode: HierarchyNode | null,
): SunburstSegment[] {
	const segments: SunburstSegment[] = [];

	if (root.count === 0) return segments;

	// Determine what to render based on selection
	let renderRoot: HierarchyNode;
	let levelOffset: number;

	if (selectedNode && selectedNode !== root) {
		// Zoomed in — show selected node and its children
		renderRoot = selectedNode;
		levelOffset = selectedNode.children[0]?.children?.length ? 0 : 1;
		// If selected is a leaf (topic), zoom to its parent category instead
		if (renderRoot.children.length === 0 && selectedNode.key.startsWith("topic-")) {
			return segments;
		}
	} else {
		renderRoot = root;
		levelOffset = 0;
	}

	const innerR = 55;
	const outerR = 175;
	const ringThickness = (outerR - innerR) / 3;

	function walk(node: HierarchyNode, startAngle: number, endAngle: number, level: number, parentColor: string) {
		if (node.count === 0 || endAngle <= startAngle) return;

		const r0 = innerR + (level - levelOffset) * ringThickness;
		const r1 = r0 + ringThickness - 1.5;
		if (r0 >= outerR) return;

		const clampedR1 = Math.min(r1, outerR);
		const color = node.color || parentColor;

		segments.push({
			node,
			path: arcPath(cx, cy, Math.max(r0, innerR), clampedR1, startAngle, endAngle),
			color,
			label: node.label,
			level,
			startAngle,
			endAngle,
			parentColor: color,
		});

		if (node.children.length > 0) {
			const total = node.children.reduce((s, c) => s + c.count, 0);
			let cursor = startAngle;
			for (const child of node.children) {
				const span = total > 0 ? ((child.count / total) * (endAngle - startAngle)) : 0;
				walk(child, cursor, cursor + span, level + 1, color);
				cursor += span;
			}
		}
	}

	walk(renderRoot, 0, 360, 0, renderRoot.color || "#64748b");
	return segments;
}

function TopicGroupWheel({ groups }: { groups: TopicArtifactGroup[] }) {
	const [selected, setSelected] = useState<HierarchyNode | null>(null);
	const [hovered, setHovered] = useState<SunburstSegment | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
	const svgRef = useRef<SVGSVGElement>(null);

	const hierarchy = useMemo(() => buildTopicHierarchy(groups), [groups]);

	const segments = useMemo(
		() => buildSunburstSegments(hierarchy, 200, 200, selected),
		[hierarchy, selected],
	);

	const breadcrumbs = useMemo(() => {
		const trail: HierarchyNode[] = [];
		if (!selected || selected === hierarchy) return trail;
		// Walk up from selected to root
		function findPath(node: HierarchyNode, target: HierarchyNode): boolean {
			if (node === target) return true;
			for (const child of node.children) {
				if (findPath(child, target)) {
					trail.unshift(child);
					return true;
				}
			}
			return false;
		}
		findPath(hierarchy, selected);
		return trail;
	}, [selected, hierarchy]);

	const handleSegmentClick = (segment: SunburstSegment) => {
		if (segment.node.children.length > 0) {
			setSelected(segment.node);
		}
	};

	const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
		if (!svgRef.current) return;
		const rect = svgRef.current.getBoundingClientRect();
		setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
	};

	// Detail cards for the selected node (or root)
	const detailNode = selected || hierarchy;
	const detailChildren = detailNode.children.filter((c) => c.count > 0);

	return (
		<div className={styles.wheelGrid}>
			<div className={styles.relative} style={{ width: "100%", height: 400 }}>
				{/* Breadcrumb */}
				<div className={styles.breadcrumbs}>
					<button
						type="button"
						onClick={() => setSelected(null)}
						className={styles.crumbButton}
					>
						All domains
					</button>
					{breadcrumbs.map((node, i) => (
						<span key={node.key} className={styles.row}>
							<span className={styles.mutedSlash}>/</span>
							<button
								type="button"
								className={styles.crumbColored}
								style={{ color: node.color }}
								onClick={() => setSelected(i === breadcrumbs.length - 1 ? node : breadcrumbs[i])}
							>
								{node.label}
							</button>
						</span>
					))}
				</div>

				<svg
					ref={svgRef}
					viewBox="0 0 400 400"
					className={styles.fullSvg}
					onMouseMove={handleMouseMove}
					onMouseLeave={() => { setHovered(null); setTooltipPos(null); }}
				>
					{segments.map((seg, i) => (
						<path
							key={`${seg.node.key}-${i}`}
							d={seg.path}
							fill={seg.color}
							stroke="var(--background, #fff)"
							strokeWidth={1.5}
							opacity={hovered && hovered !== seg ? 0.45 : 0.92}
							className={styles.clickPath}
							onMouseEnter={() => setHovered(seg)}
							onClick={() => handleSegmentClick(seg)}
						>
							<title>{seg.label} — {seg.node.count} artifact{seg.node.count === 1 ? "" : "s"}</title>
						</path>
					))}

					{/* Center circle — click to zoom out */}
					<circle
						cx={200}
						cy={200}
						r={53}
						fill="var(--background, #fff)"
						stroke="var(--border, #e5e7eb)"
						strokeWidth={1}
						className={selected ? styles.cursorPointer : undefined}
						onClick={() => selected && setSelected(null)}
					/>
					<text
						x={200}
						y={195}
						textAnchor="middle"
						fontSize={13}
						fontWeight={600}
						fill="currentColor"
						className={styles.noPointer}
					>
						{detailNode.label.length > 18 ? detailNode.label.slice(0, 16) + "…" : detailNode.label}
					</text>
					<text
						x={200}
						y={212}
						textAnchor="middle"
						fontSize={11}
						fill="var(--muted-foreground, #6b7280)"
						className={styles.noPointer}
					>
						{detailNode.count} artifact{detailNode.count === 1 ? "" : "s"}
					</text>
					{selected && (
						<text
							x={200}
							y={228}
							textAnchor="middle"
							fontSize={10}
							fill="var(--primary, #6366f1)"
							className={styles.noPointer}
						>
							Click center to zoom out
						</text>
					)}
				</svg>

				{/* Floating tooltip */}
				{hovered && tooltipPos && (
					<div
						className={styles.tooltip}
						style={{
							left: tooltipPos.x + 12,
							top: tooltipPos.y - 8,
							fontSize: 12,
						}}
					>
						<div className={styles.semibold}>{hovered.label}</div>
						<div className={styles.tinyMuted}>
							{hovered.node.count} artifact{hovered.node.count === 1 ? "" : "s"}
							{hovered.level < 2 && hovered.node.children.length > 0
								? ` · ${hovered.node.children.length} sub-categorie${hovered.node.children.length === 1 ? "" : "s"}`
								: ""}
						</div>
						{hovered.level < 2 && (
							<div className={styles.tinyPrimary}>Click to explore</div>
						)}
					</div>
				)}
			</div>

			{/* Detail panel */}
			<div className={styles.detailPanel}>
				<div className={styles.detailHeader}>
					<div className={styles.sectionLabel}>
						{selected ? "Sub-categories" : "Domains"}
					</div>
					{selected && (
						<button
							type="button"
							onClick={() => setSelected(null)}
							className={styles.backButton}
						>
							← Back
						</button>
					)}
				</div>
				{detailChildren.slice(0, 8).map((child) => (
					<div key={child.key} className={styles.detailCard}>
						<div className={styles.between}>
							<div className={styles.row}>
								<span className={styles.dot} style={{ background: child.color }} />
								<div className={styles.truncateStrong}>{child.label}</div>
							</div>
							<div className={styles.shareText}>{child.count}</div>
						</div>
						{child.children.length > 0 && (
							<div className={styles.childTopics}>
								{child.children.slice(0, 4).map((topic) => (
									<span key={topic.key} className={styles.topicPill}>
										{topic.label} ×{topic.count}
									</span>
								))}
								{child.children.length > 4 && (
									<span className={styles.topicPill}>
										+{child.children.length - 4}
									</span>
								)}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function FeedbackSignalWheel({
	groups,
	onOpenSession,
}: {
	groups: FeedbackSignalGroup[];
	onOpenSession: (sessionId: string) => void;
}) {
	const [selectedLabel, setSelectedLabel] = useState(groups[0]?.label ?? "");
	const selected = groups.find((group) => group.label === selectedLabel) ?? groups[0];
	const total = groups.reduce((sum, group) => sum + group.count, 0);
	const latestWithSession = selected?.entries.find((entry) => entry.sessionId || entry.referent?.sessionId);

	return (
		<div>
			<div className={styles.modelWheelGrid}>
				<div className={styles.pieBox}>
					<ResponsiveContainer>
						<PieChart>
							<Pie
								data={groups}
								dataKey="count"
								nameKey="label"
								innerRadius={52}
								outerRadius={84}
								paddingAngle={2}
								onClick={(_, index) => setSelectedLabel(groups[index]?.label ?? selectedLabel)}
							>
								{groups.map((entry) => (
									<Cell key={entry.label} fill={entry.color} opacity={entry.label === selected?.label ? 1 : 0.52} className={styles.cursorPointer} />
								))}
							</Pie>
							<Tooltip
								formatter={(value) => [`${value} signal${Number(value) === 1 ? "" : "s"}`, "Feedback"]}
								contentStyle={{ background: "var(--background, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, fontSize: 12 }}
							/>
						</PieChart>
					</ResponsiveContainer>
				</div>
				<div className={styles.stack2} aria-label="Select a feedback signal to inspect">
					{groups.map((group) => (
						<button key={group.label} type="button" className={cx(styles.modelButton, group.label === selected?.label ? styles.selectedButton : "")} onClick={() => setSelectedLabel(group.label)}>
							<div className={styles.between}>
								<div className={styles.row}>
									<span className={styles.dot} style={{ background: group.color }} />
									<span className={styles.truncateStrong}>{group.label}</span>
								</div>
								<span className={styles.shareText}>{Math.round((group.count / total) * 100)}%</span>
							</div>
							<div className={styles.modelDetail}>{group.count} signal{group.count === 1 ? "" : "s"}</div>
						</button>
					))}
				</div>
			</div>
			{selected && (
				<div className={styles.selectionCard} aria-live="polite">
					<div className={styles.selectionTitle}>{selected.label}: {selected.count} signal{selected.count === 1 ? "" : "s"}</div>
					<div className={styles.selectionMeta}>
						{selected.entries.slice(0, 3).map((entry) => entry.topic || "Untitled topic").join(" · ")}
						{selected.entries[0]?.evidence ? ` · Latest evidence: ${selected.entries[0].evidence}` : ""}
					</div>
					{latestWithSession && (
						<div className={styles.selectionActions}>
							<button type="button" className={styles.selectionAction} onClick={() => onOpenSession(latestWithSession.sessionId ?? latestWithSession.referent!.sessionId)}>
								Open latest source session
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function getAvailableYears(sessions: SessionMetadata[]): number[] {
	if (sessions.length === 0) {
		const now = new Date().getFullYear();
		return [now];
	}
	const years = new Set<number>();
	for (const s of sessions) {
		years.add(new Date(s.lastModified).getFullYear());
	}
	return Array.from(years).sort((a, b) => a - b);
}

function buildYearActivity(year: number, sessions: SessionMetadata[]) {
	const dayCounts = new Map<string, number>();
	for (const s of sessions) {
		const d = new Date(s.lastModified);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
	}

	const start = new Date(year, 0, 1);
	const end = new Date(year, 11, 31);
	const days: { date: Date; count: number }[] = [];
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		days.push({ date: new Date(d), count: dayCounts.get(key) ?? 0 });
	}
	return days;
}

function CurriculumGantt({
	sessions,
	colorFor,
	onOpenSession,
}: {
	sessions: LearnerState["sessions"];
	colorFor: (topic: string) => string | undefined;
	onOpenSession: (sessionId: string) => void;
}) {
	if (!sessions || sessions.length === 0) {
		return <EmptyState message="No sessions yet — once you start exploring topics, your curriculum timeline appears here." />;
	}

	const ordered = getVisibleCurriculumSessions(sessions);

	if (ordered.length === 0) {
		return <EmptyState message="No topic-bearing sessions yet — finish a lesson with covered topics to build the curriculum timeline." />;
	}

	const minStart = ordered[0].startedAt;
	const now = Date.now();
	const maxEnd = ordered.reduce((m, s) => Math.max(m, getCurriculumDisplayEnd(s, now)), minStart);
	const span = Math.max(maxEnd - minStart, 1);

	const rowH = 22;
	const rowGap = 6;
	const leftPad = 110;
	const rightPad = 12;
	const topPad = 24;
	const totalHeight = topPad + ordered.length * (rowH + rowGap) + 8;

	const fmt = (ts: number) =>
		new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

	return (
		<div className={styles.overflowX}>
			<svg
				width="100%"
				viewBox={`0 0 800 ${totalHeight}`}
				preserveAspectRatio="none"
				style={{ minWidth: 480, height: totalHeight }}
				role="img"
				aria-label="Curriculum timeline"
			>
				<text x={4} y={14} fontSize={10} fill="currentColor" opacity={0.6}>
					{fmt(minStart)}
				</text>
				<text x={796} y={14} fontSize={10} fill="currentColor" opacity={0.6} textAnchor="end">
					{fmt(maxEnd)}
				</text>
				<line x1={leftPad} y1={topPad - 6} x2={800 - rightPad} y2={topPad - 6} stroke="currentColor" opacity={0.15} />

				{ordered.map((s, i) => {
					const y = topPad + i * (rowH + rowGap);
					const startFrac = (s.startedAt - minStart) / span;
					const displayEnd = getCurriculumDisplayEnd(s, now);
					const endFrac = (displayEnd - minStart) / span;
					const usableW = 800 - leftPad - rightPad;
					const x = leftPad + startFrac * usableW;
					const w = Math.max(2, (endFrac - startFrac) * usableW);
					const primary = getPrimaryCurriculumTopic(s) ?? "Untitled";
					const color = colorFor(primary) ?? "#94a3b8";
					const label = primary.length > 16 ? primary.slice(0, 15) + "…" : primary;
					return (
						<g
							key={`${s.startedAt}-${i}`}
							role={s.id ? "button" : undefined}
							tabIndex={s.id ? 0 : undefined}
							className={s.id ? styles.cursorPointer : undefined}
							aria-label={s.id ? `Open ${primary} learning session` : undefined}
							onClick={() => { if (s.id) onOpenSession(s.id); }}
							onKeyDown={(event) => {
								if (s.id && (event.key === "Enter" || event.key === " ")) {
									event.preventDefault();
									onOpenSession(s.id);
								}
							}}
						>
							<text
								x={leftPad - 8}
								y={y + rowH / 2 + 3}
								fontSize={11}
								fill="currentColor"
								opacity={0.75}
								textAnchor="end"
							>
								{label}
							</text>
							<rect
								x={x}
								y={y}
								width={w}
								height={rowH}
								rx={3}
								fill={color}
								opacity={s.endedAt ? 0.85 : 0.55}
							>
								<title>
									{primary}
									{"\n"}Started: {new Date(s.startedAt).toLocaleString()}
									{s.endedAt ? `\nEnded: ${new Date(s.endedAt).toLocaleString()}` : "\n(in progress)"}
									{s.topicsCovered && s.topicsCovered.length > 1
										? `\nAlso: ${s.topicsCovered.slice(1).join(", ")}`
										: ""}
								</title>
							</rect>
						</g>
					);
				})}
			</svg>
		</div>
	);
}

function ActivityHeatmap({ sessions, onOpenSession }: { sessions: SessionMetadata[]; onOpenSession: (sessionId: string) => void }) {
	const availableYears = useMemo(() => getAvailableYears(sessions), [sessions]);
	const [year, setYear] = useState(() => {
		const now = new Date().getFullYear();
		return availableYears.includes(now) ? now : availableYears[availableYears.length - 1] ?? now;
	});
	const [tooltip, setTooltip] = useState<{
		x: number;
		y: number;
		date: Date;
		count: number;
	} | null>(null);
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const { days, maxCount } = useMemo(() => {
		const d = buildYearActivity(year, sessions);
		const max = Math.max(1, ...d.map((x) => x.count));
		return { days: d, maxCount: max };
	}, [year, sessions]);
	const selectedSessions = useMemo(() => {
		if (!selectedDate) return [];
		return sessions
			.filter((session) => {
				const date = new Date(session.lastModified);
				return date.getFullYear() === selectedDate.getFullYear()
					&& date.getMonth() === selectedDate.getMonth()
					&& date.getDate() === selectedDate.getDate();
			})
			.sort((left, right) => right.lastModified.localeCompare(left.lastModified));
	}, [selectedDate, sessions]);

	const handleCellHover = useCallback(
		(e: React.MouseEvent<SVGRectElement>, date: Date, count: number) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const containerRect = containerRef.current?.getBoundingClientRect();
			setTooltip({
				x: rect.left + rect.width / 2 - (containerRect?.left ?? 0),
				y: rect.top - (containerRect?.top ?? 0),
				date,
				count,
			});
		},
		[],
	);

	if (days.length === 0) return <EmptyState message="No daily activity yet." />;

	const cell = 14;
	const gap = 3;
	const startWeekday = days[0].date.getDay();
	const weeks = Math.ceil((days.length + startWeekday) / 7);
	const gridWidth = weeks * (cell + gap);
	const gridHeight = 7 * (cell + gap);
	const labelOffsetY = 16;
	const svgHeight = gridHeight + labelOffsetY + 28;

	const shade = (count: number) => {
		if (count === 0) return "var(--muted, #f3f4f6)";
		const t = maxCount <= 1 ? 1 : count / maxCount;
		const alpha = 0.25 + t * 0.75;
		return `rgba(99, 102, 241, ${alpha.toFixed(2)})`;
	};

	// month labels — first day of each unique month
	const months: { name: string; x: number }[] = [];
	let lastMonth = -1;
	for (let i = 0; i < days.length; i++) {
		const d = days[i];
		if (d.date.getMonth() !== lastMonth) {
			lastMonth = d.date.getMonth();
			const col = Math.floor((i + startWeekday) / 7);
			months.push({
				name: d.date.toLocaleDateString(undefined, { month: "short" }),
				x: col * (cell + gap),
			});
		}
	}

	const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	// Build the full year range from earliest data year to now
	const earliestYear = availableYears[0];
	const latestYear = availableYears[availableYears.length - 1];
	const allNavYears = Array.from(
		{ length: latestYear - earliestYear + 1 },
		(_, i) => earliestYear + i,
	).reverse();

	return (
		<div ref={containerRef} className={styles.heatmapRoot}>
			{/* Year tabs — GitHub style */}
			<div className={styles.yearTabs}>
				{allNavYears.map((y) => (
					<button
						key={y}
						type="button"
						className={cx(styles.yearButton, y === year ? styles.yearActive : styles.yearInactive)}
						onClick={() => { setYear(y); setSelectedDate(null); }}
					>
						{y}
					</button>
				))}
			</div>

			<div className={styles.overflowX}>
				<svg
					width="100%"
					viewBox={`0 0 ${gridWidth + 28} ${svgHeight}`}
					preserveAspectRatio="xMinYMin meet"
					role="img"
					aria-label={`Daily activity heatmap for ${year}`}
					style={{ minWidth: gridWidth + 28 }}
				>
					{/* Weekday labels (sparse: just Mon / Wed / Fri) */}
					{[1, 3, 5].map((row) => (
						<text
							key={row}
							x={0}
							y={row * (cell + gap) + cell - 1}
							fontSize={9}
							fill="currentColor"
							opacity={0.55}
						>
							{weekdayLabels[row]}
						</text>
					))}

					<g transform="translate(28, 0)">
						{days.map((d, i) => {
							const slot = i + startWeekday;
							const col = Math.floor(slot / 7);
							const row = slot % 7;
							const x = col * (cell + gap);
							const y = row * (cell + gap);
							return (
								<rect
									key={i}
									x={x}
									y={y}
									width={cell}
									height={cell}
									rx={2}
									fill={shade(d.count)}
									stroke="currentColor"
									strokeOpacity={0.05}
									role={d.count > 0 ? "button" : undefined}
									tabIndex={d.count > 0 ? 0 : undefined}
									className={d.count > 0 ? styles.cursorPointer : undefined}
									aria-label={d.count > 0 ? `${d.count} sessions on ${d.date.toLocaleDateString()}` : undefined}
									onMouseEnter={(e) => handleCellHover(e, d.date, d.count)}
									onMouseLeave={() => setTooltip(null)}
									onClick={() => { if (d.count > 0) setSelectedDate(d.date); }}
									onKeyDown={(event) => {
										if (d.count > 0 && (event.key === "Enter" || event.key === " ")) {
											event.preventDefault();
											setSelectedDate(d.date);
										}
									}}
								/>
							);
						})}

						{/* Month labels */}
						{months.map((m, i) => (
							<text
								key={i}
								x={m.x}
								y={gridHeight + 12}
								fontSize={10}
								fill="currentColor"
								opacity={0.55}
							>
								{m.name}
							</text>
						))}
					</g>

					{/* Legend */}
					<g transform={`translate(${gridWidth + 28 - 100}, ${svgHeight - 20})`}>
						<text x={-6} y={10} fontSize={10} fill="currentColor" opacity={0.5} textAnchor="end">
							Less
						</text>
						{[0, 1, 2, 3, 4].map((level) => {
							const count = Math.round((maxCount / 4) * level);
							return (
								<rect
									key={level}
									x={level * (cell + gap)}
									y={0}
									width={cell}
									height={cell}
									rx={2}
									fill={shade(count)}
								>
									<title>{count} session{count === 1 ? "" : "s"}</title>
								</rect>
							);
						})}
						<text x={5 * (cell + gap) + 4} y={10} fontSize={10} fill="currentColor" opacity={0.5}>
							More
						</text>
					</g>
				</svg>
			</div>

			{/* Rich tooltip */}
			{tooltip && (
				<div
					className={styles.heatTooltip}
					style={{
						left: tooltip.x,
						top: tooltip.y - 8,
					}}
				>
					<div className={styles.truncateStrong}>
						{tooltip.count} session{tooltip.count === 1 ? "" : "s"}
					</div>
					<div className={styles.tinyMuted}>
						{tooltip.date.toLocaleDateString(undefined, {
							weekday: "short",
							month: "short",
							day: "numeric",
							year: "numeric",
						})}
					</div>
				</div>
			)}

			{selectedDate && (
				<div className={styles.dayDetail}>
					<div className={styles.dayTitle}>
						{selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
					</div>
					{selectedSessions.map((session) => {
						const model = session.modelName?.trim() || session.modelId?.trim() || "Unknown model";
						return (
							<button key={session.id} type="button" className={styles.daySession} onClick={() => onOpenSession(session.id)}>
								<div className={styles.flex1}>
									<div className={styles.daySessionTitle}>{session.title}</div>
									<div className={styles.daySessionMeta}>{model} · thinking {session.thinkingLevel} · {session.messageCount} turns</div>
								</div>
								<span className={styles.viewDiff}>Open session</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function ComingUpPanel({
	openChecklists,
	weaknesses,
	strengths,
}: {
	openChecklists: Verification[];
	weaknesses: string[];
	strengths: string[];
}) {
	const hasAny = openChecklists.length > 0 || weaknesses.length > 0 || strengths.length > 0;
	if (!hasAny) {
		return <EmptyState message="Nothing on the runway yet — checklists and weak spots will surface here as you learn." />;
	}
	return (
		<div className={styles.comingGrid}>
			<div>
				<div className={styles.sectionLabel}>Open checklists</div>
				{openChecklists.length === 0 ? (
					<div className={styles.mt2SmallMuted}>All caught up.</div>
				) : (
					<ul className={styles.listStack}>
						{openChecklists.slice(0, 8).map((v) => (
							<li key={v.id} className={styles.checkItem}>
								<div className={styles.fontMediumTruncate}>{v.topic}</div>
								<div className={styles.smallMuted}>
									opened {new Date(v.createdAt).toLocaleDateString()}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<div className={styles.sectionLabel}>Weak spots</div>
				{weaknesses.length === 0 ? (
					<div className={styles.mt2SmallMuted}>None flagged.</div>
				) : (
					<ul className={styles.wrapPills}>
						{weaknesses.map((w) => (
							<li key={w} className={styles.weakPill}>
								{w}
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<div className={styles.sectionLabel}>Strengths</div>
				{strengths.length === 0 ? (
					<div className={styles.mt2SmallMuted}>Building.</div>
				) : (
					<ul className={styles.wrapPills}>
						{strengths.map((s) => (
							<li key={s} className={styles.strongPill}>
								{s}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
