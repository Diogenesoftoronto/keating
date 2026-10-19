/** Post-quiz feedback panels: per-level remediation and benchmark comparison against past sessions. */
import { useMemo, useState } from "react";
import { GraduationCap, TrendingUp } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import type { Quiz } from "../../keating/core";
import type { TopicStats } from "../QuizRenderer";
import { isCorrect } from "./quiz-scoring";
import { quizStyles, shared } from "./quiz-styles";

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
		<div className={quizStyles.section}>
			<div className={quizStyles.sectionTitle}>
				<GraduationCap size={14} className={css({ color: "var(--primary)" })} />
				<span>Review these</span>
			</div>
			<div className={css({ display: "grid", gap: "0.875rem" })}>
				{levels.map((level) => {
					const s = stats[level];
					if (!s || s.missed === 0) return null;
					const pct = s.total > 0 ? s.missed / s.total : 0;
					return (
						<div key={level} className={shared.stack1}>
							<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem" })}>
								<span className={css({ textTransform: "capitalize", fontWeight: 500 })}>{level}</span>
								<span className={shared.mutedText}>{s.missed}/{s.total} missed</span>
							</div>
							<div className={shared.rowCenter2}>
								<div className={css({ height: "0.5rem", flex: 1, overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
									<div
										className={css({ height: "100%", borderRadius: "9999px", background: "var(--destructive)" })}
										style={{ width: `${pct * 100}%` }}
									/>
								</div>
								<button
									type="button"
									disabled={requested.has(level)}
									onClick={() => {
										onRequestRemediation?.(level);
										setRequested((prev) => new Set(prev).add(level));
									}}
									className={css({ flexShrink: 0, fontSize: "0.625rem", fontWeight: 500, color: "var(--primary)", _hover: { textDecoration: "underline" }, _disabled: { color: "var(--muted-foreground)", textDecoration: "none" } })}
								>
									{requested.has(level) ? "Requested ✓" : "Review"}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
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
		<div className={quizStyles.section}>
			<div className={quizStyles.sectionTitle}>
				<TrendingUp size={14} className={css({ color: "var(--primary)" })} />
				<span>vs {stats.count} past sessions</span>
			</div>
			<div className={shared.stack2}>
				{[
					{ label: "Your score", value: pct, color: "var(--primary)" },
					{ label: "Session avg", value: avgPct, color: "var(--muted-foreground)" },
					{ label: "Top quartile", value: qPct, color: "#10b981" },
				].map((row) => (
					<div key={row.label} className={shared.stack1}>
						<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem" })}>
							<span className={shared.mutedText}>{row.label}</span>
							<span className={cx("font-terminal", css({ fontVariantNumeric: "tabular-nums" }))}>
								{Math.round(row.value)}%
							</span>
						</div>
						<div className={css({ height: "0.5rem", overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
							<div
								className={css({ height: "100%", borderRadius: "9999px", background: row.color, transition: "all 150ms" })}
								style={{ width: `${(row.value / maxBar) * 100}%` }}
							/>
						</div>
					</div>
				))}
			</div>
			{typeof partialCreditPoints === "number" && stats.avgPartialCreditPoints > 0 && (
				<div className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					Average partial credit {stats.avgPartialCreditPoints.toFixed(2)}/{total}
				</div>
			)}
		</div>
	);
}
