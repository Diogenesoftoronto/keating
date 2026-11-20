import { Meter } from "../../design-system/charts";
/** Post-quiz feedback panels: per-level remediation and benchmark comparison against past sessions. */
import { useMemo, useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import type { Quiz } from "../../keating/core";
import type { TopicStats } from "../QuizRenderer";
import { isCorrect } from "./quiz-scoring";

export function RemediationDashboard({
	quiz,
	answers,
	onRequestRemediation,
}: {
	quiz: Quiz;
	answers: Record<string, string>;
	onRequestRemediation?: (level: string) => void;
}) {
	const levels = ["recall", "comprehension", "application", "analysis", "transfer"] as const;
	const stats = useMemo(() => {
		const map: Record<string, { total: number; missed: number }> = {};
		for (const level of levels) {
			const questions = quiz.questions.filter((q) => q.level === level && !q.fallbackFor);
			if (questions.length === 0) continue;
			let missed = 0;
			for (const q of questions) {
				if (!isCorrect(q, answers[q.id] || "")) missed++;
			}
			map[level] = { total: questions.length, missed };
		}
		return map;
	}, [quiz, answers]);

	const [requested, setRequested] = useState<Set<string>>(new Set());

	const hasMissed = Object.values(stats).some((s) => s.missed > 0);
	if (!hasMissed) return null;

	return (
		<section className="lesson-section quiz-review-panel">
			<h4 data-glyph-host className="lesson-section-title">
				<KeatingGlyph name="target" size={13} />
				<span>Review these</span>
			</h4>
			<ul className="lesson-rows">
				{levels.map((level) => {
					const s = stats[level];
					if (!s || s.missed === 0) return null;
					return (
						<li key={level}>
							<span>{level}</span>
							<Meter value={s.missed} max={s.total} label={level + " missed"} tone="bad" valueText={`${s.missed}/${s.total} missed`}/>
							<button
								type="button"
								className="lesson-quiet"
								disabled={requested.has(level)}
								onClick={() => {
									onRequestRemediation?.(level);
									setRequested((prev) => new Set(prev).add(level));
								}}
							>
								{requested.has(level) ? <><KeatingGlyph name="check" size={13} /> Requested</> : <><KeatingGlyph name="book" size={13} /> Review</>}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

export function BenchmarkComparison({
	score,
	partialCreditPoints,
	total,
	stats,
}: {
	score: number;
	partialCreditPoints: number;
	total: number;
	stats: TopicStats | null | undefined;
}) {
	if (!stats || stats.count < 5 || total <= 0) return null;
	const pct = (score / total) * 100;
	const avgPct = (stats.avgScore / total) * 100;
	const qPct = (stats.topQuartile / total) * 100;
	const maxBar = Math.max(pct, avgPct, qPct, 1);

	return (
		<section className="lesson-section quiz-review-panel">
			<h4 data-glyph-host className="lesson-section-title">
				<KeatingGlyph name="trend" size={13} />
				<span>Against {stats.count} past sessions</span>
			</h4>
			<ul className="lesson-rows">
				{[
					{ label: "Your score", value: pct },
					{ label: "Session avg", value: avgPct },
					{ label: "Top quartile", value: qPct },
				].map((row) => (
					<li key={row.label}>
						<span>{row.label}</span>
						<Meter value={row.value} max={maxBar} label={row.label} tone={row.label === "Your score" ? "series1" : "ink"}/>
						<span className="lesson-meta">{Math.round(row.value)}%</span>
					</li>
				))}
			</ul>
			{typeof partialCreditPoints === "number" && stats.avgPartialCreditPoints > 0 && (
				<p className="lesson-hint">
					Average partial credit {stats.avgPartialCreditPoints.toFixed(2)}/{total}
				</p>
			)}
		</section>
	);
}
