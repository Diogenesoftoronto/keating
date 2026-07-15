import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, ExternalLink, GitCompareArrows } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { keatingStorage } from "../hooks/keating-storage";
import type { EvolutionResult } from "../keating/storage";
import {
	parseEvolutionTrace,
	resolveEvolutionPolicyDiff,
	type EvolutionPolicyDiff,
} from "../keating/evolution-diff";
import { css, cx } from "../../styled-system/css";

const styles = {
	page: css({ minH: "100vh", bg: "var(--background)", color: "var(--foreground)", fontFamily: "monospace" }),
	header: css({ borderBottom: "1px solid var(--border)" }),
	headerInner: css({ mx: "auto", display: "flex", maxW: "72rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", px: "1rem", py: "1rem" }),
	title: css({ fontSize: "1.25rem", fontWeight: "650" }),
	subtitle: css({ mt: "0.25rem", maxW: "70ch", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	main: css({ mx: "auto", display: "flex", maxW: "72rem", flexDir: "column", gap: "1rem", px: "1rem", py: "1.5rem" }),
	button: css({ display: "inline-flex", h: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.75rem", fontSize: "0.875rem", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } }),
	section: css({ overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)" }),
	sectionHeader: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	sectionTitle: css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: "600" }),
	sectionBody: css({ p: "1rem" }),
	meta: css({ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	badge: css({ borderRadius: "9999px", bg: "var(--muted)", px: "0.625rem", py: "0.25rem" }),
	diffHeader: css({ display: "none", gridTemplateColumns: "minmax(10rem, 1.4fr) repeat(3, minmax(6rem, 0.7fr))", gap: "0.75rem", borderBottom: "1px solid var(--border)", px: "1rem", py: "0.5rem", fontSize: "0.7rem", color: "var(--muted-foreground)", md: { display: "grid" } }),
	diffRow: css({ display: "grid", gap: "0.375rem", borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)", px: "1rem", py: "0.75rem", _last: { borderBottom: 0 }, md: { gridTemplateColumns: "minmax(10rem, 1.4fr) repeat(3, minmax(6rem, 0.7fr))", alignItems: "center", gap: "0.75rem" } }),
	field: css({ fontSize: "0.8rem", fontWeight: "600" }),
	value: css({ fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }),
	valueLabel: css({ mr: "0.5rem", color: "var(--muted-foreground)", md: { display: "none" } }),
	deltaGood: css({ color: "#15803d" }),
	deltaBad: css({ color: "var(--destructive)" }),
	details: css({ borderTop: "1px solid var(--border)", _first: { borderTop: 0 } }),
	summary: css({ display: "flex", cursor: "pointer", listStyle: "none", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", px: "1rem", py: "0.75rem", fontSize: "0.8rem", _hover: { bg: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }),
	candidateBody: css({ borderTop: "1px solid var(--border)", bg: "color-mix(in srgb, var(--muted) 18%, transparent)", p: "1rem" }),
	reasonList: css({ mt: "0.75rem", pl: "1.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)", listStyleType: "disc" }),
	pre: css({ maxH: "32rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.75rem", lineHeight: "1.5" }),
	empty: css({ p: "2rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	errorMain: css({ mx: "auto", display: "grid", minH: "100vh", maxW: "42rem", placeItems: "center", px: "1rem", py: "3rem" }),
	errorCard: css({ w: "100%", borderRadius: "0.75rem", border: "1px solid color-mix(in srgb, var(--destructive) 35%, var(--border))", bg: "var(--background)", p: "clamp(1.25rem, 5vw, 2.5rem)", textAlign: "center" }),
	errorIcon: css({ mx: "auto", mb: "1rem", color: "var(--destructive)" }),
	errorTitle: css({ fontSize: "1.25rem", fontWeight: "650" }),
	errorText: css({ mx: "auto", mt: "0.5rem", maxW: "52ch", fontSize: "0.875rem", lineHeight: "1.6", color: "var(--muted-foreground)" }),
	errorActions: css({ mt: "1.5rem", display: "flex", justifyContent: "center" }),
};

function humanField(value: string): string {
	return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function formatValue(value: number | string | null): string {
	if (value === null) return "not recorded";
	return typeof value === "number" ? Number(value.toFixed(4)).toString() : value;
}

function DiffRows({ rows }: { rows: EvolutionPolicyDiff[] }) {
	return (
		<div>
			<div className={styles.diffHeader} aria-hidden="true">
				<span>Field</span><span>Before</span><span>After</span><span>Delta</span>
			</div>
			{rows.map((row) => (
				<div key={row.field} className={styles.diffRow}>
					<div className={styles.field}>{humanField(row.field)}</div>
					<div className={styles.value}><span className={styles.valueLabel}>Before</span>{formatValue(row.before)}</div>
					<div className={styles.value}><span className={styles.valueLabel}>After</span>{formatValue(row.after)}</div>
					<div className={cx(styles.value, (row.delta ?? 0) >= 0 ? styles.deltaGood : styles.deltaBad)}>
						<span className={styles.valueLabel}>Delta</span>
						{row.delta === null ? "changed" : `${row.delta >= 0 ? "+" : ""}${formatValue(row.delta)}`}
					</div>
				</div>
			))}
		</div>
	);
}

function DiffUnavailablePage({
	title,
	description,
	onBack,
}: {
	title: string;
	description: string;
	onBack: () => void;
}) {
	return (
		<div className={styles.page}>
			<main className={styles.errorMain}>
				<section className={styles.errorCard} role="alert" aria-labelledby="evolution-diff-error-title">
					<AlertTriangle className={styles.errorIcon} size={32} aria-hidden="true" />
					<h1 id="evolution-diff-error-title" className={styles.errorTitle}>{title}</h1>
					<p className={styles.errorText}>{description}</p>
					<div className={styles.errorActions}>
						<button type="button" className={styles.button} onClick={onBack}>
							<ArrowLeft size={16} /> Back to usage
						</button>
					</div>
				</section>
			</main>
		</div>
	);
}

export function EvolutionDetail() {
	const { evolutionId } = useParams({ strict: false }) as { evolutionId: string };
	const navigate = useNavigate();
	const [runs, setRuns] = useState<EvolutionResult[] | null>(null);
	useSeo({
		title: "Evolution diff | Keating",
		description: "Inspect the exact policy changes and accepted candidates from a Keating self-evolution run.",
		canonical: `https://keating.help/usage/evolution/${encodeURIComponent(evolutionId)}`,
	});

	useEffect(() => {
		let cancelled = false;
		keatingStorage.getEvolutions().then((items) => {
			if (!cancelled) setRuns(items.sort((left, right) => left.createdAt - right.createdAt));
		}).catch(() => {
			if (!cancelled) setRuns([]);
		});
		return () => { cancelled = true; };
	}, []);

	const detail = useMemo(() => {
		if (!runs) return null;
		const index = runs.findIndex((run) => run.id === evolutionId);
		if (index < 0) return { run: null, previous: null, resolution: null, trace: [] };
		const run = runs[index];
		const previous = index > 0 ? runs[index - 1] : null;
		return {
			run,
			previous,
			resolution: resolveEvolutionPolicyDiff(run.policy, previous?.policy ?? null),
			trace: parseEvolutionTrace(run.trace),
		};
	}, [evolutionId, runs]);

	if (!runs || !detail) return <div className={styles.page}><div className={styles.empty}>Loading evolution details...</div></div>;
	const backToUsage = () => navigate({ to: "/usage" });
	if (!detail.run || !detail.resolution) return (
		<DiffUnavailablePage
			title="Evolution run unavailable"
			description="This saved evolution could not be found. It may have been removed from local storage or imported without its source record."
			onBack={backToUsage}
		/>
	);
	if (!detail.resolution.ok) {
		const messages = {
			"invalid-policy": "The saved evolved policy is missing or malformed, so Keating cannot produce a trustworthy field-by-field comparison.",
			"invalid-baseline": "The previous saved policy is missing or malformed, so Keating cannot establish a trustworthy comparison baseline.",
			"no-changes": "The saved policy is identical to its comparison baseline. There are no changed fields to present as an exact diff.",
		} as const;
		return (
			<DiffUnavailablePage
				title="Exact diff unavailable"
				description={messages[detail.resolution.reason]}
				onBack={backToUsage}
			/>
		);
	}

	const accepted = detail.trace.filter((candidate) => candidate.accepted);
	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<div className={styles.headerInner}>
					<div>
						<h1 className={styles.title}>{detail.run.topic || "General teaching policy"}</h1>
						<p className={styles.subtitle}>Exact policy changes, candidate decisions, and the original evolution report.</p>
					</div>
					<button type="button" className={styles.button} onClick={() => navigate({ to: "/usage" })}>
						<ArrowLeft size={16} /> Back to usage
					</button>
				</div>
			</header>

			<main className={styles.main}>
				<div className={styles.meta}>
					<span className={styles.badge}>Score {detail.run.bestScore.toFixed(2)}</span>
					<span className={styles.badge}>{new Date(detail.run.createdAt).toLocaleString()}</span>
					<span className={styles.badge}>{accepted.length} accepted of {detail.trace.length} explored</span>
					{detail.run.sessionId && (
						<button type="button" className={styles.badge} onClick={() => navigate({ to: "/chat", search: { session: detail.run.sessionId } })}>
							Open source session <ExternalLink size={12} />
						</button>
					)}
				</div>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<h2 className={styles.sectionTitle}><GitCompareArrows size={16} /> Final policy diff</h2>
						<span className={styles.subtitle}>{detail.previous ? `Compared with ${new Date(detail.previous.createdAt).toLocaleString()}` : "First saved evolution; all fields are shown"}</span>
					</div>
					<DiffRows rows={detail.resolution.diff} />
				</section>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<h2 className={styles.sectionTitle}><CheckCircle2 size={16} /> Accepted candidate steps</h2>
						<span className={styles.subtitle}>Expand a step to inspect its exact field changes and decision reasons.</span>
					</div>
					{accepted.length === 0 ? <div className={styles.empty}>No accepted candidate trace was recorded for this run.</div> : accepted.map((candidate) => (
						<details key={candidate.iteration} className={styles.details}>
							<summary className={styles.summary}>
								<span>Iteration {candidate.iteration}: {candidate.parameterDelta.length} changed field{candidate.parameterDelta.length === 1 ? "" : "s"}</span>
								<span className={candidate.decision.scoreDelta >= 0 ? styles.deltaGood : styles.deltaBad}>Score {candidate.decision.scoreDelta >= 0 ? "+" : ""}{candidate.decision.scoreDelta.toFixed(2)}</span>
							</summary>
							<div className={styles.candidateBody}>
								<DiffRows rows={candidate.parameterDelta.map((change) => ({ ...change }))} />
								{candidate.decision.reasons.length > 0 && <ul className={styles.reasonList}>{candidate.decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
							</div>
						</details>
					))}
				</section>

				<section className={styles.section}>
					<details>
						<summary className={styles.summary}><span className={styles.sectionTitle}><CircleDot size={16} /> Full evolution report</span><span className={styles.subtitle}>Raw saved evidence</span></summary>
						<div className={styles.sectionBody}><pre className={styles.pre}>{detail.run.report}</pre></div>
					</details>
				</section>
			</main>
		</div>
	);
}
