import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
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
	getCurriculumDisplayEnd,
	getPrimaryCurriculumTopic,
	getVisibleCurriculumSessions,
	hasMeaningfulPolicyScores,
} from "./usage-chart-data";

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
		<section className={`rounded-lg border border-border bg-background ${className}`}>
			<div className="border-b border-border px-4 py-3">
				<h2 className="text-sm font-semibold">{title}</h2>
				{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
			</div>
			<div className="p-4">{children}</div>
		</section>
	);
}

interface UsageChartsProps {
	sessionMetadata: SessionMetadata[];
}

export function UsageCharts({ sessionMetadata }: UsageChartsProps) {
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
			<div className="mt-6 rounded-lg border border-border bg-background p-8 text-center text-sm text-muted-foreground">
				Loading charts…
			</div>
		);
	}

	const totalTopicArtifacts = data.topicGroups.reduce((sum, t) => sum + t.count, 0);
	const feedbackMix = aggregateFeedback(data.feedback);

	return (
		<div className="mt-6 flex flex-col gap-6">
			<div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
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
					title="Feedback signal mix"
					subtitle="How sessions are landing — confused, confident, or curious"
				>
					{feedbackMix.length === 0 ? (
						<EmptyState message="No feedback recorded yet." />
					) : (
						<div style={{ width: "100%", height: 260 }}>
							<ResponsiveContainer>
								<PieChart>
									<Pie data={feedbackMix} dataKey="count" nameKey="label" innerRadius={50} outerRadius={90} paddingAngle={2}>
										{feedbackMix.map((entry) => (
											<Cell key={entry.label} fill={entry.color} />
										))}
									</Pie>
									<Tooltip
										contentStyle={{
											background: "var(--background, #fff)",
											border: "1px solid var(--border, #e5e7eb)",
											borderRadius: 6,
											fontSize: 12,
										}}
									/>
									<Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
								</PieChart>
							</ResponsiveContainer>
						</div>
					)}
				</ChartPanel>
			</div>

			<ChartPanel
				title="Curriculum timeline"
				subtitle="Each row is a learning session — bar length is duration, color is the first topic covered"
			>
				<CurriculumGantt sessions={data.sessions} colorFor={(t) => categorizeUsageTopic(t).color} />
			</ChartPanel>

			<ChartPanel
				title="Daily activity"
				subtitle="Sessions per day year by year"
			>
				<ActivityHeatmap sessions={sessionMetadata} />
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

function PolicyGrowthPanel({
 benchmarks,
 evolutions,
 improvements,
 policies,
}: {
 benchmarks: { score: number; createdAt: number }[];
 evolutions: { bestScore: number; createdAt: number }[];
 improvements: { baselineScore: number; afterScore: number | null; scoreDelta: number | null; createdAt: number }[];
 policies: { active: boolean; createdAt: number; updatedAt: number }[];
}) {
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
	const benchmarkScores = benchmarks.map((b) => ({ score: b.score, createdAt: b.createdAt }));
	const evolutionScores = evolutions.map((e) => ({ score: e.bestScore, createdAt: e.createdAt }));
	const allScores = [...benchmarkScores, ...evolutionScores].sort((a, b) => a.createdAt - b.createdAt);
	const scoreSignalsAreMeaningful = hasMeaningfulPolicyScores(allScores);
	const minT = allScores[0]?.createdAt ?? Date.now();
	const maxT = allScores[allScores.length - 1]?.createdAt ?? minT;
	const span = Math.max(maxT - minT, 1);

	const makePoints = (arr: { score: number; createdAt: number }[], color: string, label: string) => {
		if (arr.length === 0) return null;
		const sorted = [...arr].sort((a, b) => a.createdAt - b.createdAt);
		const usableW = 100 - leftPad - rightPad;
		return {
			label,
			color,
			points: sorted.map((d) => ({
				x: leftPad + ((d.createdAt - minT) / span) * usableW,
				y: chartBottom - (d.score / maxScore) * (chartBottom - chartTop),
				score: d.score,
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

	return (
		<div>
			<div className="mb-4 grid gap-3 sm:grid-cols-4">
				<MetricTile label="Latest benchmark" value={latestBenchmark ? latestBenchmark.score.toFixed(1) : "none"} />
				<MetricTile label="Latest evolution" value={latestEvolution ? latestEvolution.bestScore.toFixed(1) : "none"} />
				<MetricTile label="Active policies" value={`${activePolicies}/${policies.length}`} />
				<MetricTile label="Attempts" value={`${acceptedAttempts} kept / ${rejectedAttempts} rejected`} />
			</div>

			<div className="mb-4">
				{allScores.length === 0 ? (
					<EmptyState message="Policy records exist, but no benchmark scores have been recorded yet." />
				) : !scoreSignalsAreMeaningful ? (
					<div className="rounded-md border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
						Scores are recorded, but they are still all 0.0. Add feedback signals and rerun benchmark or evolution before treating this as a trend.
					</div>
				) : (
					<div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
						<div className="relative text-[11px] tabular-nums text-muted-foreground" style={{ height }}>
							{[0, 25, 50, 75, 100].map((tick) => {
								const y = chartBottom - (tick / maxScore) * (chartBottom - chartTop);
								return (
									<div
										key={tick}
										className="absolute right-0 -translate-y-1/2"
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
											<circle key={i} cx={p.x - leftPad} cy={p.y} r={1.2} fill={line.color}>
												<title>{line.label}: {p.score.toFixed(1)} on {p.date}</title>
											</circle>
										))}
									</g>
								);
							})}
						</svg>
					</div>
				)}

				<div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
					{benchmarkLine && (
						<div className="flex items-center gap-1.5">
							<span className="inline-block h-1.5 w-4 rounded-full" style={{ background: benchmarkLine.color }} />
							<span className="text-muted-foreground">Benchmark scores</span>
						</div>
					)}
					{evolutionLine && (
						<div className="flex items-center gap-1.5">
							<span className="inline-block h-1.5 w-4 rounded-full" style={{ background: evolutionLine.color }} />
							<span className="text-muted-foreground">Evolved policy scores</span>
						</div>
					)}
				</div>
			</div>

			{improvementBars.length > 0 && (
				<div>
					<div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Recent improvements</div>
					<div className="flex h-12 items-end gap-1">
						{improvementBars.map((bar, i) => {
							const delta = bar.scoreDelta ?? 0;
							const positive = delta >= 0;
							return (
								<div key={i} className="flex-1">
									<div
										className={`rounded-sm ${positive ? "bg-emerald-500" : "bg-destructive"} transition-all`}
										style={{ height: `${Math.min(Math.abs(delta) * 40 + 4, 40)}px`, opacity: 0.75 }}
										title={`Delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} on ${fmtDate(bar.createdAt)}`}
									/>
								</div>
							);
						})}
					</div>
					<div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
						<span>{improvementBars.length} latest</span>
						<span>{activePolicies} active policy{activePolicies === 1 ? "" : "ies"} / {policies.length} total</span>
					</div>
				</div>
			)}
		</div>
	);
}

function MetricTile({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-border bg-muted/20 px-3 py-2">
			<div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
			<div className="mt-1 text-lg font-semibold">{value}</div>
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
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
			<div className="relative" style={{ width: "100%", height: 400 }}>
				{/* Breadcrumb */}
				<div className="absolute left-3 top-2 z-10 flex flex-wrap items-center gap-1">
					<button
						type="button"
						onClick={() => setSelected(null)}
						className="rounded-md bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
					>
						All domains
					</button>
					{breadcrumbs.map((node, i) => (
						<span key={node.key} className="flex items-center gap-1">
							<span className="text-muted-foreground">/</span>
							<button
								type="button"
								className="rounded-md bg-background/90 px-2 py-0.5 text-[11px] font-medium backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
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
					className="h-full w-full"
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
							className="cursor-pointer transition-opacity duration-150"
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
						className={selected ? "cursor-pointer" : ""}
						onClick={() => selected && setSelected(null)}
					/>
					<text
						x={200}
						y={195}
						textAnchor="middle"
						fontSize={13}
						fontWeight={600}
						fill="currentColor"
						className="pointer-events-none"
					>
						{detailNode.label.length > 18 ? detailNode.label.slice(0, 16) + "…" : detailNode.label}
					</text>
					<text
						x={200}
						y={212}
						textAnchor="middle"
						fontSize={11}
						fill="var(--muted-foreground, #6b7280)"
						className="pointer-events-none"
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
							className="pointer-events-none"
						>
							Click center to zoom out
						</text>
					)}
				</svg>

				{/* Floating tooltip */}
				{hovered && tooltipPos && (
					<div
						className="pointer-events-none absolute z-20 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
						style={{
							left: tooltipPos.x + 12,
							top: tooltipPos.y - 8,
							fontSize: 12,
						}}
					>
						<div className="font-semibold">{hovered.label}</div>
						<div className="text-[11px] text-muted-foreground">
							{hovered.node.count} artifact{hovered.node.count === 1 ? "" : "s"}
							{hovered.level < 2 && hovered.node.children.length > 0
								? ` · ${hovered.node.children.length} sub-categorie${hovered.node.children.length === 1 ? "" : "s"}`
								: ""}
						</div>
						{hovered.level < 2 && (
							<div className="mt-1 text-[10px] text-primary">Click to explore</div>
						)}
					</div>
				)}
			</div>

			{/* Detail panel */}
			<div className="min-w-0 space-y-2">
				<div className="flex items-center justify-between">
					<div className="text-xs font-semibold uppercase text-muted-foreground">
						{selected ? "Sub-categories" : "Domains"}
					</div>
					{selected && (
						<button
							type="button"
							onClick={() => setSelected(null)}
							className="rounded-md px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 transition-colors"
						>
							← Back
						</button>
					)}
				</div>
				{detailChildren.slice(0, 8).map((child) => (
					<div key={child.key} className="rounded-md border border-border bg-muted/20 p-2.5">
						<div className="flex min-w-0 items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-2">
								<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: child.color }} />
								<div className="truncate text-xs font-semibold">{child.label}</div>
							</div>
							<div className="shrink-0 text-xs tabular-nums text-muted-foreground">{child.count}</div>
						</div>
						{child.children.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-1">
								{child.children.slice(0, 4).map((topic) => (
									<span key={topic.key} className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
										{topic.label} ×{topic.count}
									</span>
								))}
								{child.children.length > 4 && (
									<span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
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

function EmptyState({ message }: { message: string }) {
	return <div className="py-12 text-center text-sm text-muted-foreground">{message}</div>;
}

function aggregateFeedback(entries: FeedbackEntry[]) {
	const counts: Record<string, number> = { "thumbs-up": 0, "thumbs-down": 0, confused: 0 };
	for (const e of entries) {
		counts[e.signal] = (counts[e.signal] ?? 0) + 1;
	}
	const out: { label: string; count: number; color: string }[] = [];
	if (counts["thumbs-up"]) out.push({ label: "Confident", count: counts["thumbs-up"], color: "#22c55e" });
	if (counts["thumbs-down"]) out.push({ label: "Off-track", count: counts["thumbs-down"], color: "#ef4444" });
	if (counts["confused"]) out.push({ label: "Confused", count: counts["confused"], color: "#f97316" });
	return out;
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
}: {
	sessions: LearnerState["sessions"];
	colorFor: (topic: string) => string | undefined;
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
		<div className="overflow-x-auto">
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
						<g key={`${s.startedAt}-${i}`}>
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

function ActivityHeatmap({ sessions }: { sessions: SessionMetadata[] }) {
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
	const containerRef = useRef<HTMLDivElement>(null);

	const { days, maxCount } = useMemo(() => {
		const d = buildYearActivity(year, sessions);
		const max = Math.max(1, ...d.map((x) => x.count));
		return { days: d, maxCount: max };
	}, [year, sessions]);

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
		<div ref={containerRef} className="relative">
			{/* Year tabs — GitHub style */}
			<div className="mb-3 flex flex-wrap items-center gap-1.5">
				{allNavYears.map((y) => (
					<button
						key={y}
						type="button"
						className={`rounded-md px-2.5 py-1 text-xs md:text-lg font-medium transition-colors ${
							y === year
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						}`}
						onClick={() => setYear(y)}
					>
						{y}
					</button>
				))}
			</div>

			<div className="overflow-x-auto">
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
									onMouseEnter={(e) => handleCellHover(e, d.date, d.count)}
									onMouseLeave={() => setTooltip(null)}
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
					className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
					style={{
						left: tooltip.x,
						top: tooltip.y - 8,
					}}
				>
					<div className="text-xs font-semibold">
						{tooltip.count} session{tooltip.count === 1 ? "" : "s"}
					</div>
					<div className="text-[11px] text-muted-foreground">
						{tooltip.date.toLocaleDateString(undefined, {
							weekday: "short",
							month: "short",
							day: "numeric",
							year: "numeric",
						})}
					</div>
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
		<div className="grid gap-4 md:grid-cols-3">
			<div>
				<div className="text-xs font-semibold uppercase text-muted-foreground">Open checklists</div>
				{openChecklists.length === 0 ? (
					<div className="mt-2 text-sm text-muted-foreground">All caught up.</div>
				) : (
					<ul className="mt-2 space-y-1.5 text-sm">
						{openChecklists.slice(0, 8).map((v) => (
							<li key={v.id} className="rounded-md border border-border px-2 py-1.5">
								<div className="font-medium truncate">{v.topic}</div>
								<div className="text-xs text-muted-foreground">
									opened {new Date(v.createdAt).toLocaleDateString()}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<div className="text-xs font-semibold uppercase text-muted-foreground">Weak spots</div>
				{weaknesses.length === 0 ? (
					<div className="mt-2 text-sm text-muted-foreground">None flagged.</div>
				) : (
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{weaknesses.map((w) => (
							<li key={w} className="rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive">
								{w}
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<div className="text-xs font-semibold uppercase text-muted-foreground">Strengths</div>
				{strengths.length === 0 ? (
					<div className="mt-2 text-sm text-muted-foreground">Building.</div>
				) : (
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{strengths.map((s) => (
							<li key={s} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary">
								{s}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
