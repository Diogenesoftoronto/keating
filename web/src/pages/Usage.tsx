import { Suspense, use, useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, Card, EmptyState, Loading, Segmented } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { motion } from "motion/react";
import { DURATION, EASE, useMotionAllowed } from "../design-system/motion";
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
import { Stat, Meter } from "../design-system/charts";
import { LearningShell } from "../components/LearningInsightsHeader";
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
	panel: css({ mt: "1.5rem", overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--card)" }),
	panelHeader: css({ borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	panelTitle: css({ fontSize: "0.875rem", fontWeight: "600" }),
	panelSubtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	spendWrap: css({ overflowX: "auto", px: "1rem", py: "0.75rem" }),
	spendTable: css({ w: "100%", minW: "32rem", borderCollapse: "collapse", fontSize: "0.8125rem" }),
	spendTh: css({ textAlign: "left", fontWeight: "600", fontSize: "0.75rem", color: "var(--muted-foreground)", px: "0.5rem", py: "0.4rem", borderBottom: "1px solid var(--border)" }),
	spendTd: css({ px: "0.5rem", py: "0.5rem", borderBottom: "1px solid var(--border)", fontVariantNumeric: "tabular-nums", fontWeight: "400" }),
	spendModel: css({ textAlign: "left", overflowWrap: "anywhere", fontWeight: "500" }),
	right: css({ textAlign: "right" }),
	shareRow: css({ display: "flex", alignItems: "center", gap: "0.5rem", minW: "8rem" }),
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
	const [busy, setBusy] = useState<"export" | "import" | null>(null);
	const [result, setResult] = useState<string>("");
	const [error, setError] = useState("");

	const handlePortableExport = async () => {
		setBusy("export");
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
			setBusy(null);
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
		setBusy("import");
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
			setBusy(null);
		}
	};

	return (
		<footer className="lr-footer">
        <strong data-glyph-host><KeatingGlyph name="lock"/> Your data</strong>
        <Button variant="ghost" glyph="export" disabled={!!busy} onClick={handlePortableExport}>{busy === "export" ? "Exporting…" : "Export portable JSON"}</Button>
        <label className="lr-file">{busy === "import" ? "Importing…" : "Import portable JSON"}
          <input type="file" accept="application/json,.json" disabled={!!busy} onChange={event => {
            void handlePortableImport(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}/>
        </label>
        <label className="lr-data-chip"><input type="checkbox" checked={includeSandbox} onChange={event => setIncludeSandbox(event.target.checked)}/> Include sandbox code history</label>
        <Link to="/training-data">Prepare a training dataset <KeatingGlyph name="right"/></Link>
        {result && <p role="status">{result}</p>}
        {error && <p role="alert">{error}</p>}
      </footer>
	);
}

function useArtifactMetrics() {
	const [metrics, setMetrics] = useState<{
		plans: number; maps: number; animations: number;
		benchmarks: number; evolutions: number; promptEvolutions: number; improvements: number;
	} | "failed" | null>(null);

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
		}).catch(() => { if (!cancelled) setMetrics("failed"); });
		return () => { cancelled = true; };
	}, []);

	return metrics;
}

function Dashboard({ children }: { children: React.ReactNode }) {
  const allowed = useMotionAllowed();
  const [tip, setTip] = useState<{text: string; x: number; y: number} | null>(null);
  function show(target: EventTarget | null) {
    const mark = target instanceof Element ? target.closest("[data-lr-tip]") : null;
    if (!mark) { setTip(null); return; }
    const bounds = mark.getBoundingClientRect();
    setTip({text: mark.getAttribute("data-lr-tip")!, x: Math.max(8, Math.min(bounds.left, window.innerWidth - 210)), y: Math.max(8,bounds.top - 40)});
  }
  return <motion.main className="lr-dashboard" data-motion={allowed}
    initial={false} animate={{ y: allowed ? [6,0] : 0 }} transition={{duration: DURATION.play, ease:EASE}}
    onFocus={e => show(e.target)} onBlur={() => setTip(null)} onMouseOver={e => show(e.target)}
    onMouseOut={() => setTip(null)} onScrollCapture={() => setTip(null)} onKeyDown={e => {if(e.key === "Escape") setTip(null);}}>
    {children}{tip && <span className="lr-tooltip" role="tooltip" style={{left:tip.x,top:tip.y}}>{tip.text}</span>}
  </motion.main>;
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

	const [deep, setDeep] = useState(false);
  const counts = artifactMetrics && artifactMetrics !== "failed" ? artifactMetrics : null;
  const pendingCounts = artifactMetrics === "failed" ? "Artifact counts could not be read." : <Loading size="inline" label="Loading artifact counts…"/>;
  const openSession = (sessionId: string) => navigate({ to: "/chat", search: { session: sessionId } });
  const metrics = [
    {label:"Learning sessions", value:formatNumber(totals.sessions), detail:totals.sessions ? `${totals.activeDays} active ${totals.activeDays === 1 ? "day" : "days"}` : "No sessions yet", comparison:change(totals.sessions, previous?.sessions)},
    {label:"Turns", value:formatNumber(totals.messages), detail:`${dailyMessages.toFixed(1)} messages per active day`, comparison:change(totals.messages, previous?.messages)},
    {label:"Estimated spend", value:formatCost(totals.cost), detail:"From the usage each provider reported", comparison:change(totals.cost, previous?.cost)},
  ];
  const visibleSessions = deep ? deepest : recent;
  const models = <Card as="section" className="lr-card lr-models" aria-labelledby="model-spend-heading">
					<div className={styles.panelHeader}>
						<h2 id="model-spend-heading" className={styles.panelTitle}>Models and cost</h2>
						<p className={styles.panelSubtitle}>
							{spend.basis === "cost"
								? "Estimated from the token counts and prices each provider reported. Your provider's own bill is the authority."
								: "No prices were reported in this period, so models are compared by tokens."}
						</p>
					</div>
					{spend.rows.length === 0 ? (
						<EmptyState heading="No model usage in this period."/>
					) : (
						<div className={styles.spendWrap}>
							<table className={styles.spendTable} aria-label={`Models and cost: ${spend.rows[0].label} has the largest share of ${spend.basis === "cost" ? "spend" : "tokens"} at ${Math.round(spend.rows[0].share*100)}%`}>
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
												<div className={styles.shareRow} tabIndex={0} data-lr-tip={`${row.label}: ${Math.round(row.share*100)}%`}>
													<Meter label={`${row.label} share of ${spend.basis === "cost" ? "spend" : "tokens"}`} max={100} value={row.share*100}/>
													<span>{Math.round(row.share * 100)}%</span>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>;
  return <LearningShell current="activity" controls={<><span className="lr-period-label">Period</span>
    <Segmented label="Period" size="sm" value={range} onChange={chooseRange} options={USAGE_RANGES.map(value => ({value, label: <><span className="lr-long">{USAGE_RANGE_LABELS[value]}</span><span className="lr-short">{value === "all" ? "All" : value}</span></>}))}/></>}>
    <Dashboard>
      <p className="lr-caption">{range === "all" ? `All ${formatNumber(metadata.length)} saved sessions on this device.` : `Sessions last active in the past ${rangeLabel}, on this device.`}</p>
      {emptyRange && <EmptyState role="status" heading={`Nothing in the past ${rangeLabel}.`} actions={<Button onClick={() => chooseRange("all")}>Show all time</Button>}/>}
      <UsageCharts range={range} sessionMetadata={inRange} onOpenSession={openSession}
        tiles={<div className="lr-tiles">{metrics.map(metric => <div className="lr-tile" key={metric.label}><Stat label={metric.label} value={metric.value} support={metric.detail}/>{metric.comparison && <small className="lr-comparison">{metric.comparison}</small>}</div>)}</div>}
        recent={<Card as="section" className="lr-card"><header className="k-halftone"><h2>Recent learning</h2>
          <Button variant="ghost" aria-pressed={deep} onClick={() => setDeep(!deep)}>Deepest dives</Button></header>
          <p className="lr-caption">{deep ? "Sessions with the most back-and-forth in this period" : "Latest saved sessions in this period and their focus"}</p>
          {visibleSessions.length ? visibleSessions.map((session,i) => <SessionRow key={session.id} session={session} onOpen={openSession} rank={deep ? i+1 : undefined}/>) :
            <EmptyState heading={emptyRange ? "No sessions in this period." : deep ? "No learning history yet" : "Start a chat and Keating will track your learning activity here."}/>}
        </Card>}
        costs={<div className="lr-row lr-costs">{models}<HostedCreditsPanel/></div>}
        materials={counts ? `${counts.plans+counts.maps+counts.animations} teaching materials · ${counts.plans} plans · ${counts.maps} maps · ${counts.animations} animations` : pendingCounts}
        runs={counts ? `${counts.benchmarks+counts.evolutions+counts.promptEvolutions+counts.improvements} self-improvement runs · ${counts.benchmarks} benchmarks · ${counts.evolutions} evolutions · ${counts.promptEvolutions} prompt evolutions · ${counts.improvements} improvement attempts` : pendingCounts}
      />
      <PortableDataPanel/>
    </Dashboard>
  </LearningShell>;
}

function SessionRow({ session, onOpen, rank }: { session: SessionMetadata; onOpen: (id: string) => void; rank?: number }) {
  const tokens = session.usage?.totalTokens || (session.usage?.input ?? 0) + (session.usage?.output ?? 0);
  return <button className="lr-session" type="button" onClick={() => onOpen(session.id)} aria-label={`Open session ${session.title}`} aria-describedby={`lr-session-details-${session.id}`}>
    <b>{rank && `${rank}. `}{session.title}</b><span>{firstSentence(session.preview)}</span>
    <small className="lr-time">{formatDate(session.lastModified)} · {session.messageCount} turns</small><small id={`lr-session-details-${session.id}`} className="lr-extra">{[`${formatNumber(tokens)} tokens`,
      sessionModelLabel(session), `Thinking: ${session.thinkingLevel}`].filter(Boolean).join(" · ")} <KeatingGlyph name="chevr"/></small>
  </button>;
}

export function Usage() {
	useSeo({
		title: "Keating Dashboard — Usage & Analytics",
		description: "View your Keating usage statistics, session history, and learning analytics.",
		canonical: "https://keating.help/usage",
	});
	return (
		<div className={cx("retro-layout", "retro-page", styles.page)}>
			<Suspense fallback={
				<LearningShell current="activity"><Loading size="page" label="Loading usage..."/></LearningShell>
			}>
				<UsageContent />
			</Suspense>
		</div>
	);
}
