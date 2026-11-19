import { useEffect, useState } from "react";
import { IntervalPlot } from "../design-system/charts";
import { Button, Card } from "../design-system/kit";
import { learningHistoryId, type LearningForecastProposal, type LearningHistory } from "../keating/learning-intelligence/forecasts";
import { LEARNING_OUTLOOK_CHANGED_EVENT, loadLearningOutlook, type LearningOutlook as Outlook } from "../keating/learning-intelligence/outlook";

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
		<Card as="section" className="cu-panel" aria-labelledby="learning-outlook-title">
			<h2 id="learning-outlook-title" className="cu-title">Your outlook</h2>
			<p className="cu-copy">An estimate from your own saved answers and card ratings. It hasn't been validated, it isn't a grade, and your review dates stay as scheduled.</p>
			{forecasts.length ? (
				<ul className="cu-list">
					{forecasts.map(row => (
						<li key={row.id} className="cu-item">
							<strong>{row.label}</strong>
							<span>{describe(row)}</span>
							<IntervalPlot domain={[0,row.maximum]} label={describe(row)} data={[{label:row.label,value:row.median!,range:[row.p10!,row.p90!]}]}/>
							<span className="cu-copy">Based on {row.observedCount} recorded {row.measure === "self-reported-card-rating" ? "ratings" : "answers"}.</span>
						</li>
					))}
				</ul>
			) : null}
			{outlook.revisit.length ? (
				<>
					<h3 className="cu-title" style={{ marginTop: "1rem" }}>Worth another try</h3>
					<p className="cu-copy">Questions from your lessons you've missed most often.</p>
					<ul className="cu-list">
						{outlook.revisit.map(item => (
							<li key={item.question} className="cu-item">
								<span>“{item.question}”</span>
								<span className="cu-copy">Missed {item.missedCount} of {item.attempts} attempts.</span>
								<Button onClick={() => onPractice(item.question)}>Practice this</Button>
							</li>
						))}
					</ul>
				</>
			) : null}
		</Card>
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
