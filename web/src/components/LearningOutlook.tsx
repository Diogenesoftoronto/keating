import { useEffect, useState } from "react";
import { css } from "../../styled-system/css";
import { learningHistoryId, type LearningForecastProposal, type LearningHistory } from "../keating/learning-intelligence/forecasts";
import { LEARNING_OUTLOOK_CHANGED_EVENT, loadLearningOutlook, type LearningOutlook as Outlook } from "../keating/learning-intelligence/outlook";

const styles = {
	section: css({ mt: "1rem", py: "1rem", borderBottom: "1px solid var(--ink)", color: "var(--ink)" }),
	title: css({ fontFamily: "var(--mono-display)", fontSize: "0.875rem", fontWeight: 700 }),
	copy: css({ mt: "0.375rem", maxW: "70ch", fontSize: "0.75rem", lineHeight: "1.3rem", color: "var(--ink-soft)", overflowWrap: "anywhere" }),
	list: css({ mt: "0.5rem", display: "grid", gap: "0.5rem", paddingLeft: 0, listStyle: "none" }),
	item: css({ display: "grid", gap: "0.25rem", fontSize: "0.8125rem" }),
	band: css({ position: "relative", height: "0.5rem", borderRadius: "999px", background: "var(--muted)", maxW: "18rem" }),
	range: css({ position: "absolute", top: 0, bottom: 0, borderRadius: "999px", background: "color-mix(in srgb, var(--primary) 35%, transparent)" }),
	median: css({ position: "absolute", top: "-0.125rem", bottom: "-0.125rem", width: "2px", background: "var(--primary)" }),
	button: css({ minH: "2.75rem", border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--card)", color: "var(--ink)", px: "0.875rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", justifySelf: "start",
		_hover: { bg: "var(--ink)", color: "var(--paper)" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } }),
};

const RATINGS = ["forgot", "hard", "good", "easy"];

function describe(row: LearningForecastProposal): string {
	if (row.measure === "self-reported-card-rating") {
		const word = (value: number) => RATINGS[Math.max(0, Math.min(3, Math.round(value)))]!;
		const due = row.dueAt ? new Date(row.dueAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "your next review";
		return `At your review on ${due}, you'll most likely rate this card “${word(row.median!)}” (somewhere between “${word(row.p10!)}” and “${word(row.p90!)}”).`;
	}
	const pct = (value: number) => `${Math.round(value * 100)}%`;
	return `Your next graded answer will likely score around ${pct(row.median!)} (between ${pct(row.p10!)} and ${pct(row.p90!)}).`;
}

export function LearningOutlookView({ outlook, onPractice }: { outlook: Outlook | null; onPractice: (question: string) => void }) {
	const forecasts = outlook?.forecasts.filter(row => row.status === "unvalidated-model-proposal" && typeof row.median === "number"
		&& typeof row.p10 === "number" && typeof row.p90 === "number") ?? [];
	if (!outlook || (!forecasts.length && !outlook.revisit.length)) return null;
	return (
		<section className={styles.section} aria-labelledby="learning-outlook-title">
			<h2 id="learning-outlook-title" className={styles.title}>Your outlook</h2>
			<p className={styles.copy}>An estimate from your own saved answers and card ratings. It hasn't been validated, it isn't a grade, and your review dates stay as scheduled.</p>
			{forecasts.length ? (
				<ul className={styles.list}>
					{forecasts.map(row => (
						<li key={row.id} className={styles.item}>
							<strong>{row.label}</strong>
							<span>{describe(row)}</span>
							<span className={styles.band} role="img" aria-label={`Likely range ${row.p10} to ${row.p90}, most likely ${row.median}, on a scale up to ${row.maximum}`}>
								<span className={styles.range} style={{ left: `${(row.p10! / row.maximum) * 100}%`, width: `${Math.max(2, ((row.p90! - row.p10!) / row.maximum) * 100)}%` }} />
								<span className={styles.median} style={{ left: `${(row.median! / row.maximum) * 100}%` }} />
							</span>
							<span className={styles.copy}>Based on {row.observedCount} recorded {row.measure === "self-reported-card-rating" ? "ratings" : "answers"}.</span>
						</li>
					))}
				</ul>
			) : null}
			{outlook.revisit.length ? (
				<>
					<h3 className={styles.title} style={{ marginTop: "1rem" }}>Worth another try</h3>
					<p className={styles.copy}>Questions from your lessons you've missed most often.</p>
					<ul className={styles.list}>
						{outlook.revisit.map(item => (
							<li key={item.question} className={styles.item}>
								<span>“{item.question}”</span>
								<span className={styles.copy}>Missed {item.missedCount} of {item.attempts} attempts.</span>
								<button type="button" className={styles.button} onClick={() => onPractice(item.question)}>Practice this</button>
							</li>
						))}
					</ul>
				</>
			) : null}
		</section>
	);
}

export function LearningOutlook({ history, onPractice }: { history: LearningHistory; onPractice: (question: string) => void }) {
	const [outlook, setOutlook] = useState<Outlook | null>(null);
	useEffect(() => {
		const id = learningHistoryId(history);
		const refresh = () => setOutlook(loadLearningOutlook(id, Date.now()));
		refresh();
		window.addEventListener(LEARNING_OUTLOOK_CHANGED_EVENT, refresh);
		window.addEventListener("storage", refresh);
		return () => {
			window.removeEventListener(LEARNING_OUTLOOK_CHANGED_EVENT, refresh);
			window.removeEventListener("storage", refresh);
		};
	}, [history]);
	return <LearningOutlookView outlook={outlook} onPractice={onPractice} />;
}
