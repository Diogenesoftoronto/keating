import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { keatingStorage } from "../hooks/keating-storage";
import type { LearnerState, Verification, FeedbackEntry } from "../keating/storage";
import type { SessionMetadata } from "../types/session";

const TOPIC_PALETTE = [
	"#6366f1", "#22c55e", "#f97316", "#ec4899", "#06b6d4",
	"#a855f7", "#eab308", "#14b8a6", "#ef4444", "#3b82f6",
	"#84cc16", "#f43f5e", "#0ea5e9", "#d946ef", "#10b981",
];

function colorForTopic(index: number) {
	return TOPIC_PALETTE[index % TOPIC_PALETTE.length];
}

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
		topicCounts: { topic: string; count: number; color: string }[];
		sessions: LearnerState["sessions"];
		openChecklists: Verification[];
		weaknesses: string[];
		strengths: string[];
		feedback: FeedbackEntry[];
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const [plans, maps, animations, verifications, learnerState, feedback] = await Promise.all([
					keatingStorage.getLessonPlans(),
					keatingStorage.getLessonMaps(),
					keatingStorage.getAnimations(),
					keatingStorage.getVerifications(),
					keatingStorage.getLearnerState(),
					keatingStorage.getFeedback(),
				]);

				const counts = new Map<string, number>();
				const addTopic = (t: string | undefined) => {
					if (!t) return;
					counts.set(t, (counts.get(t) ?? 0) + 1);
				};
				plans.forEach((p) => addTopic(p.topic));
				maps.forEach((m) => addTopic(m.topic));
				animations.forEach((a) => addTopic(a.topic));
				verifications.forEach((v) => addTopic(v.topic));

				const topicCounts = Array.from(counts.entries())
					.sort((a, b) => b[1] - a[1])
					.map(([topic, count], i) => ({ topic, count, color: colorForTopic(i) }));

				if (cancelled) return;
				setData({
					topicCounts,
					sessions: learnerState.sessions ?? [],
					openChecklists: verifications.filter((v) => !v.completed),
					weaknesses: learnerState.weaknesses ?? [],
					strengths: learnerState.strengths ?? [],
					feedback,
				});
			} catch (err) {
				console.error("Failed to load chart data", err);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const dailyActivity = useMemo(() => {
		return buildDailyActivity(sessionMetadata);
	}, [sessionMetadata]);

	if (!data) {
		return (
			<div className="mt-6 rounded-lg border border-border bg-background p-8 text-center text-sm text-muted-foreground">
				Loading charts…
			</div>
		);
	}

	const totalTopicArtifacts = data.topicCounts.reduce((sum, t) => sum + t.count, 0);
	const feedbackMix = aggregateFeedback(data.feedback);
	const topicColorLookup = new Map(data.topicCounts.map((t) => [t.topic, t.color] as const));

	return (
		<div className="mt-6 flex flex-col gap-6">
			<div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
				<ChartPanel
					title="Topic mix"
					subtitle={`How your learning artifacts distribute across topics${totalTopicArtifacts ? ` (${totalTopicArtifacts} total)` : ""}`}
				>
					{data.topicCounts.length === 0 ? (
						<EmptyState message="No topic artifacts yet — start a lesson to see this fill in." />
					) : (
						<div style={{ width: "100%", height: 260 }}>
							<ResponsiveContainer>
								<PieChart>
									<Pie
										data={data.topicCounts}
										dataKey="count"
										nameKey="topic"
										innerRadius={60}
										outerRadius={95}
										paddingAngle={2}
									>
										{data.topicCounts.map((entry) => (
											<Cell key={entry.topic} fill={entry.color} />
										))}
									</Pie>
									<Tooltip
										contentStyle={{
											background: "var(--background, #fff)",
											border: "1px solid var(--border, #e5e7eb)",
											borderRadius: 6,
											fontSize: 12,
										}}
										formatter={(value, name) => [`${value} artifacts`, name as string]}
									/>
									<Legend
										verticalAlign="bottom"
										wrapperStyle={{ fontSize: 11 }}
										formatter={(value) => <span style={{ color: "var(--muted-foreground, #6b7280)" }}>{value}</span>}
									/>
								</PieChart>
							</ResponsiveContainer>
						</div>
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
				<CurriculumGantt sessions={data.sessions} colorFor={(t) => topicColorLookup.get(t)} />
			</ChartPanel>

			<ChartPanel
				title="Daily activity"
				subtitle="Sessions per day across the last 12 weeks"
			>
				<ActivityHeatmap days={dailyActivity} />
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

function buildDailyActivity(sessions: SessionMetadata[]) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days: { date: Date; count: number }[] = [];
	const dayCounts = new Map<string, number>();
	for (const s of sessions) {
		const d = new Date(s.lastModified);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
	}
	const span = 84;
	for (let i = span - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		days.push({ date: d, count: dayCounts.get(key) ?? 0 });
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

	const ordered = [...sessions]
		.filter((s) => typeof s.startedAt === "number")
		.sort((a, b) => a.startedAt - b.startedAt);

	if (ordered.length === 0) {
		return <EmptyState message="No session timestamps recorded yet." />;
	}

	const minStart = ordered[0].startedAt;
	const now = Date.now();
	const maxEnd = ordered.reduce((m, s) => Math.max(m, s.endedAt ?? now), minStart);
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
					const endFrac = ((s.endedAt ?? now) - minStart) / span;
					const usableW = 800 - leftPad - rightPad;
					const x = leftPad + startFrac * usableW;
					const w = Math.max(2, (endFrac - startFrac) * usableW);
					const primary = s.topicsCovered?.[0] ?? "Untitled";
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

function ActivityHeatmap({ days }: { days: { date: Date; count: number }[] }) {
	if (days.length === 0) return <EmptyState message="No daily activity yet." />;
	const max = days.reduce((m, d) => Math.max(m, d.count), 0);
	const cell = 14;
	const gap = 3;
	const weeks = Math.ceil(days.length / 7);
	const width = weeks * (cell + gap);
	const height = 7 * (cell + gap) + 16;

	const shade = (count: number) => {
		if (count === 0) return "var(--muted, #f3f4f6)";
		const t = max <= 1 ? 1 : count / max;
		const alpha = 0.25 + t * 0.75;
		return `rgba(99, 102, 241, ${alpha.toFixed(2)})`;
	};

	const firstDay = days[0].date;
	const startWeekday = firstDay.getDay();

	return (
		<div className="overflow-x-auto">
			<svg width={width} height={height} role="img" aria-label="Daily activity heatmap" style={{ minWidth: width }}>
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
						>
							<title>
								{d.date.toLocaleDateString()} — {d.count} session{d.count === 1 ? "" : "s"}
							</title>
						</rect>
					);
				})}
				<text x={0} y={height - 2} fontSize={10} fill="currentColor" opacity={0.55}>
					{firstDay.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
				</text>
				<text x={width} y={height - 2} fontSize={10} fill="currentColor" opacity={0.55} textAnchor="end">
					Today
				</text>
			</svg>
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
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open checklists</div>
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
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weak spots</div>
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
				<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Strengths</div>
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
