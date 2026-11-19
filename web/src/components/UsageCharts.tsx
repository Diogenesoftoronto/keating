import { BarList, HeatGrid, LineChart, StackBar, Timeline } from "../design-system/charts";
import type { UsageRange } from "../keating/usage-summary";
import { KeatingGlyph } from "../design-system/glyphs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, Chip, Button, Loading, EmptyState } from "../design-system/kit";
import { keatingStorage } from "../hooks/keating-storage";
import type {
	BenchmarkResult,
	EvolutionResult,
	FeedbackEntry,
	ImprovementAttemptRecord,
	LearnerState,
	Policy,
} from "../keating/storage";
import type { SessionMetadata } from "../types/session";
import {
	buildTopicArtifactGroups,
	buildTopicHierarchy,
	type HierarchyNode,
	type TopicArtifactGroup,
	type TopicArtifactInput,
} from "./usage-topic-groups";
import {
	TOPIC_CATEGORIES_CHANGED_EVENT,
	ensureModelTopicCategories,
	loadTopicCategoryAssignments,
	pickCategorizationModel,
} from "../keating/topic-categorization";
import {
	aggregateFeedback,
	getCurriculumDisplayEnd,
	getPrimaryCurriculumTopic,
	getVisibleCurriculumSessions,
	hasMeaningfulPolicyScores,
	type FeedbackSignalGroup,
} from "./usage-chart-data";
import { css } from "../../styled-system/css";



const styles = {
	mutedNotice: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", px: "1rem", py: "1.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	improvementTitle: css({ mb: "0.5rem", fontSize: "0.75rem", fontWeight: "600", textTransform: "uppercase", color: "var(--muted-foreground)" }),
	flex1: css({ flex: "1 1 0%" }),
	barFooter: css({ mt: "0.25rem", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted-foreground)" }),
	evolutionList: css({ mt: "1rem", borderTop: "1px solid var(--border)" }),
	evolutionButton: css({ display: "flex", w: "100%", minW: 0, alignItems: "center", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)", px: "0.75rem", py: "0.625rem", textAlign: "left", _last: { borderBottom: 0 }, _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }),
	evolutionName: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: "600" }),
	evolutionMeta: css({ mt: "0.125rem", fontSize: "11px", color: "var(--muted-foreground)" }),
	viewDiff: css({ flexShrink: 0, fontSize: "0.75rem", color: "var(--primary)" }),
	selectionCard: css({ mt: "0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 20%, transparent)", p: "0.75rem" }),
	selectionTitle: css({ fontSize: "0.8rem", fontWeight: "600" }),
	selectionMeta: css({ mt: "0.25rem", fontSize: "0.75rem", lineHeight: "1.5", color: "var(--muted-foreground)" }),
	selectionActions: css({ mt: "0.625rem", display: "flex", flexWrap: "wrap", gap: "0.375rem" }),
	selectionAction: css({ borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.625rem", py: "0.375rem", fontSize: "0.75rem", color: "var(--primary)", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
};

function ChartPanel({ title, subtitle, children }: {
  title: string; subtitle?: React.ReactNode; children: React.ReactNode;
}) {
  return <Card as="section" className="lr-card">
    <header className="k-halftone"><h2>{title}</h2><Chip>all time</Chip></header>
    {subtitle && <div className="lr-caption">{subtitle}</div>}
    {children}
  </Card>;
}

interface UsageChartsProps {
  range?: UsageRange;
  sessionMetadata: SessionMetadata[];
  onOpenSession: (id: string) => void;
  tiles?: React.ReactNode;
  recent?: React.ReactNode;
  costs?: React.ReactNode;
  materials?: React.ReactNode;
  runs?: React.ReactNode;
}

export function UsageCharts({ range = "all", sessionMetadata, onOpenSession, tiles, recent, costs, materials, runs }: UsageChartsProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
	const [data, setData] = useState<{
		topicArtifacts: TopicArtifactInput[];
		sessions: LearnerState["sessions"];
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
				if (cancelled) return;
				setData({
					topicArtifacts,
					sessions: learnerState.sessions ?? [],
					feedback,
					benchmarks,
					evolutions,
					improvements,
					policies,
				});
			} catch {
				if (!cancelled) setFailed(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [attempt]);

	// Model-authored topic → category assignments; keyword matching is only the
	// fallback while a topic is still unclassified.
	const [assignments, setAssignments] = useState<Record<string, string>>(() => loadTopicCategoryAssignments());
	useEffect(() => {
		const onChanged = () => setAssignments(loadTopicCategoryAssignments());
		window.addEventListener(TOPIC_CATEGORIES_CHANGED_EVENT, onChanged);
		return () => window.removeEventListener(TOPIC_CATEGORIES_CHANGED_EVENT, onChanged);
	}, []);

	// Ask a configured model to classify any topics the cache hasn't seen yet.
	useEffect(() => {
		if (!data || data.topicArtifacts.length === 0) return;
		void (async () => {
			try {
				const model = await pickCategorizationModel();
				if (!model) return;
				const topics = data.topicArtifacts
					.map((artifact) => artifact.topic ?? "")
					.filter(Boolean);
				await ensureModelTopicCategories(model, topics);
			} catch (error) {
				console.warn("Background topic categorization failed:", error);
			}
		})();
	}, [data]);

	const topicGroups = useMemo(
		() => (data ? buildTopicArtifactGroups(data.topicArtifacts, assignments) : []),
		[data, assignments],
	);

  const feedback = data ? aggregateFeedback(data.feedback) : [];
  const totalTopics = topicGroups.reduce((total, group) => total + group.count, 0);
  const loading = <Loading size="inline" label="Loading charts…"/>;
  const retry = <Button onClick={() => { setFailed(false); setAttempt(n => n+1); }}>Try again</Button>;
  return <>
    <div className="lr-row lr-overview">
      <ActivityHeatmap key={range} range={range} sessions={sessionMetadata} onOpenSession={onOpenSession}/>
      {tiles}
    </div>
    <div className="lr-row lr-learning">{recent}
      <ChartPanel title="Topics" subtitle={materials}>
        {data ? topicGroups.length ? <TopicBars groups={topicGroups}/> :
          <EmptyState heading="No topic artifacts yet — start a lesson to see this fill in."/> :
          failed ? <p role="alert">Chart data could not be loaded. {retry}</p> : loading}
        {data && <p className="lr-caption">{totalTopics} total artifacts grouped into learning domains</p>}
      </ChartPanel>
    </div>
    {costs}
    <div className="lr-row lr-health">
      <ChartPanel title="How sessions are landing">
        {data ? feedback.length ? <FeedbackMix groups={feedback} onOpenSession={onOpenSession}/> : <EmptyState heading="No feedback recorded yet."/> :
          failed ? <p role="alert">Feedback could not be loaded. {retry}</p> : loading}
      </ChartPanel>
      <ChartPanel title="Is Keating improving?">
        {data ? <PolicyGrowthPanel benchmarks={data.benchmarks} evolutions={data.evolutions} improvements={data.improvements}
          policies={data.policies} onOpenEvolution={evolutionId => navigate({ to: "/usage/evolution/$evolutionId", params: { evolutionId } })}/> :
          failed ? <p role="alert">Improvement history could not be loaded. {retry}</p> : loading}
        <div className="lr-caption">{runs}</div>
      </ChartPanel>
    </div>
    <details className="lr-disclosure"><summary>Curriculum timeline <Chip>all time</Chip></summary>
      {data ? <CurriculumGantt sessions={data.sessions} onOpenSession={onOpenSession}/> :
        failed ? <p role="alert">Timeline could not be loaded. {retry}</p> : loading}
    </details>
  </>;
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
 improvements: ImprovementAttemptRecord[];
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
		return <EmptyState heading="No self-evolution records yet — run a benchmark or evolution to see health signals here." />;
	}

	const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	const benchmarkScores = benchmarks.map((b) => ({ kind:"Benchmark" as const, id: b.id, score: b.score, createdAt: b.createdAt }));
	const evolutionScores = evolutions.map((e) => ({ kind:"Evolution" as const, id: e.id, score: e.bestScore, createdAt: e.createdAt }));
	const allScores = [...benchmarkScores, ...evolutionScores].sort((a, b) => a.createdAt - b.createdAt);
	const scoreSignalsAreMeaningful = hasMeaningfulPolicyScores(allScores);
	const series = [{label:"Benchmark",scores:benchmarkScores},{label:"Evolved policy",scores:evolutionScores}].map(({label,scores}) => ({
      label, points:scores.map(point => ({x:point.createdAt,y:point.score,label:fmtDate(point.createdAt)}))
    }));
    const orderedBenchmarks = [...benchmarks].sort((a, b) => a.createdAt - b.createdAt);
	const orderedEvolutions = [...evolutions].sort((a, b) => a.createdAt - b.createdAt);
	const latestBenchmark = orderedBenchmarks[orderedBenchmarks.length - 1];
	const latestEvolution = orderedEvolutions[orderedEvolutions.length - 1];
	const activePolicies = policies.filter((p) => p.active).length;

	const improvementBars = improvements
		.filter((i) => i.scoreDelta !== null)
		.sort((a, b) => a.createdAt - b.createdAt)
		.slice(-12);
	const acceptedAttempts = improvements.filter((i) => i.accepted).length;
	const rejectedAttempts = improvements.filter((i) => !i.accepted).length;
	const recentEvolutions = [...evolutions].sort((left, right) => right.createdAt - left.createdAt).slice(0, 6);

	return (
		<div>
			<p className="lr-caption">Latest benchmark {latestBenchmark?.score.toFixed(1) ?? "none"} · latest evolution {latestEvolution?.bestScore.toFixed(1) ?? "none"} · {activePolicies}/{policies.length} active policies</p>
            <div className={css({ mb: "1rem" })}>
				{allScores.length === 0 ? (
					<EmptyState heading="Policy records exist, but no benchmark scores have been recorded yet." />
				) : !scoreSignalsAreMeaningful ? (
					<div className={styles.mutedNotice}>
						Scores are recorded, but they are still all 0.0. Add feedback signals and rerun benchmark or evolution before treating this as a trend.
					</div>
				) : (
					<div className="lr-policy-line"><LineChart label="Teaching scores out of 100" domain={[0,100]} series={series}/>
              <label>Inspect a score <select value={selectedTrend ? selectedTrend.kind+selectedTrend.id : ""} onChange={event => {
                const match = allScores.find(p => p.kind+p.id === event.target.value);
                setSelectedTrend(match ?? null);
              }}><option value="">Choose a run</option>{allScores.map(p => <option key={p.kind+p.id} value={p.kind+p.id}>{p.kind} · {fmtDate(p.createdAt)} · {p.score}</option>)}</select></label>
              </div>)}
              <p className="lr-caption">{improvements.length} attempts · {acceptedAttempts} kept, {rejectedAttempts} rejected</p>
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
					<LineChart label="Recent improvement score changes" connect={false} series={[{label:"Score change",points:improvementBars.map(bar => ({x:bar.createdAt,y:bar.scoreDelta!,label:fmtDate(bar.createdAt)}))}]}/>
                    <div className={styles.barFooter}>
						<span>{improvementBars.length} latest</span>
						<span>{activePolicies} active {activePolicies === 1 ? "policy" : "policies"} / {policies.length} total</span>
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

function TopicBars({ groups }: { groups: TopicArtifactGroup[] }) {
  const root = useMemo(() => buildTopicHierarchy(groups), [groups]);
  const [path, setPath] = useState<string[]>([]);
  const trail: HierarchyNode[] = [root];
  for (const key of path) {
    const match = trail[trail.length - 1].children.find(node => node.key === key);
    if (!match) break;
    trail.push(match);
  }
  const current = trail[trail.length - 1];
  const bars = current.children;
  const reading = bars.length ? `${current.label}: ${bars[0].label} leads with ${bars[0].count} of ${current.count} artifacts` : current.label;
  return <div>
    {trail.length > 1 && <nav className="lr-crumbs" aria-label="Topic hierarchy">{trail.map((node, i) =>
      i === trail.length - 1 ? <strong key={node.key}>{node.label}</strong> : <button key={node.key} onClick={() => setPath(path.slice(0,i))}>{node.label} <KeatingGlyph name="chevr" size={12} /></button>)}</nav>}
    <BarList data={bars.map(node => ({label:node.label,value:node.count}))} label={reading} onSelect={bars.some(node => node.children.length) ? label => {
      const node = bars.find(entry => entry.label === label);
      if (node?.children.length) setPath([...trail.slice(1).map(n => n.key),node.key]);
    } : undefined}/>
  </div>;
}

function FeedbackMix({
	groups,
	onOpenSession,
}: {
	groups: FeedbackSignalGroup[];
	onOpenSession: (sessionId: string) => void;
}) {
	const [selectedLabel, setSelectedLabel] = useState(groups[0]?.label ?? "");
	const selected = groups.find((group) => group.label === selectedLabel) ;
	const total = groups.reduce((sum, group) => sum + group.count, 0);
	const latestWithSession = selected?.entries.find((entry) => entry.sessionId || entry.referent?.sessionId);

	return (
		<div>
			<StackBar size="lg" data={["Confident","Confused","Off-track"].map(label => ({label,value:groups.find(g => g.label === label)?.count ?? 0}))} selected={selectedLabel} onSelect={setSelectedLabel}/>
      {selected && (
				<div className={styles.selectionCard} aria-live="polite">
					<div className={styles.selectionTitle}>{selected.label}: {Math.round(selected.count/total*100)}% · {selected.count} signal{selected.count === 1 ? "" : "s"}</div>
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
		const year = new Date(s.lastModified).getFullYear();
		if (Number.isFinite(year)) years.add(year);
	}
	return years.size ? Array.from(years).sort((a, b) => a - b) : [new Date().getFullYear()];
}

function CurriculumGantt({sessions,onOpenSession}: {sessions:LearnerState["sessions"];onOpenSession:(id:string)=>void}) {
    if (!sessions || sessions.length === 0) {
		return <EmptyState heading="No sessions yet — once you start exploring topics, your curriculum timeline appears here." />;
	}

	const ordered = getVisibleCurriculumSessions(sessions);

	if (ordered.length === 0) {
		return <EmptyState heading="No topic-bearing sessions yet — finish a lesson with covered topics to build the curriculum timeline." />;
	}

	const now = Date.now();
    const start = ordered[0].startedAt;
    const minutes = (time:number) => Math.round((time-start)/600)/100;
    return <div><Timeline label={`Curriculum timeline, minutes since ${new Date(start).toLocaleString()}`} lanes={ordered.map((session,i) => ({
      label:`${i+1}. ${getPrimaryCurriculumTopic(session)}`,bands:[{label:session.topicsCovered.join(", "),start:minutes(session.startedAt),end:minutes(getCurriculumDisplayEnd(session,now))}]
    }))}/>
      <details><summary>Session details</summary>{ordered.map((session,i) => <p key={i}>{session.id ? <Button onClick={() => onOpenSession(session.id!)}>{session.topicsCovered.join(", ")}</Button> : session.topicsCovered.join(", ")} · {new Date(session.startedAt).toLocaleString()} · {session.endedAt ? new Date(session.endedAt).toLocaleString() : "In progress"}</p>)}</details>
    </div>;
}

function ActivityHeatmap({range,sessions,onOpenSession}: {range:UsageRange;sessions:SessionMetadata[];onOpenSession:(id:string)=>void}) {
    const years = getAvailableYears(sessions);
    const [requestedYear,setYear] = useState(years.at(-1)!);
    const year = years.includes(requestedYear) ? requestedYear : years.at(-1)!;
    const [choice,setChoice] = useState("");
    const byDay = new Map<string,SessionMetadata[]>();
    for (const session of sessions) {
      const key = new Date(session.lastModified).toDateString();
      const group = byDay.get(key) ?? [];
      group.push(session);
      byDay.set(key,group);
    }
    const today = new Date();
    const start = range === "all" ? new Date(year,0,1) : new Date(today.getTime()-parseInt(range)*86400000);
    start.setHours(0,0,0,0);
    const end = range === "all" ? new Date(year,11,31) : today;
    const days = [];
    for (const day = new Date(start); day <= end; day.setDate(day.getDate()+1)) {
      const label = day.toDateString();
      days.push({label,value:byDay.get(label)?.length ?? 0});
    }
    const active = days.filter(day => day.value);
    const selected = days.some(day => day.label === choice) ? choice : active.at(-1)?.label;
    const count = days.reduce((sum,day) => sum+day.value,0);
    const reading = `${count} session${count === 1 ? "" : "s"} across ${active.length} active day${active.length === 1 ? "" : "s"}`;
    return <Card as="section" className="lr-card lr-calendar"><header className="k-halftone"><h2>Daily activity</h2></header><p className="lr-caption">{reading}</p>
      {range === "all" && <div className="lr-years">{years.map(y => <Chip key={y} as="button" selected={year === y} onClick={() => {setYear(y);setChoice("");}}>{y}</Chip>)}</div>}
      <label className="lr-inspect-day">Inspect a day <select value={selected ?? ""} onChange={event => setChoice(event.target.value)}>
        {!selected && <option value="">Choose a day</option>}{days.map(day => <option key={day.label} value={day.label}>{day.label} · {day.value}</option>)}
      </select></label>
      <div className="lr-calendar-grid" style={{"--first-weekday":start.getDay()+1,"--week-count":Math.ceil((days.length+start.getDay())/7)} as React.CSSProperties}>
        <HeatGrid label={reading} columns={Math.ceil((days.length+start.getDay())/7)} data={days} selected={selected} onSelect={setChoice}/>
      </div>
      {selected && <div className="lr-day" aria-live="polite"><strong>{selected}</strong>{byDay.get(selected)?.length ? byDay.get(selected)!.map(session =>
        <button key={session.id} type="button" className="lr-day-session" onClick={() => onOpenSession(session.id)}><b>{session.title}</b><small>{session.modelName || session.modelId || "Unknown model"} · thinking {session.thinkingLevel} · {session.messageCount} turns</small></button>) : <EmptyState heading="No sessions on this day."/>}</div>}
    </Card>;
}
