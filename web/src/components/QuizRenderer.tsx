import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Circle, Send, XCircle, RotateCcw, Lightbulb } from "lucide-react";
import type { Quiz, QuizQuestion } from "../keating/core";

interface QuizRendererProps {
	quiz: Quiz;
	onSubmit?: (answers: Record<string, string>, score: number) => void;
}

type AnswerState = Record<string, string>;

function QuizOption({
	label,
	selected,
	onClick,
	disabled,
	status,
}: {
	label: string;
	selected: boolean;
	onClick: () => void;
	disabled?: boolean;
	status?: "correct" | "wrong" | "neutral";
}) {
	const base =
		"flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-sm transition-all cursor-pointer";
	const state =
		status === "correct"
			? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
			: status === "wrong"
				? "border-destructive/60 bg-destructive/10 text-destructive"
				: selected
					? "border-primary bg-primary/10 text-primary"
					: "border-border bg-background hover:border-primary/50";
	return (
		<label
			className={`${base} ${state} ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
			onClick={() => !disabled && onClick()}
		>
			{status === "correct" ? (
				<CheckCircle2 size={16} />
			) : status === "wrong" ? (
				<XCircle size={16} />
			) : selected ? (
				<CheckCircle2 size={16} />
			) : (
				<Circle size={16} />
			)}
			<span className="flex-1">{label}</span>
		</label>
	);
}

function QuestionCard({
	q,
	index,
	answer,
	onChange,
	revealed,
}: {
	q: QuizQuestion;
	index: number;
	answer: string;
	onChange: (val: string) => void;
	revealed: boolean;
}) {
	const isCorrect = revealed && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
	const isWrong = revealed && answer.trim() && !isCorrect;

	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
			<div className="flex items-start gap-2">
				<span className="font-terminal text-xs text-accent shrink-0 mt-1">
					[{index + 1}/{q.level.toUpperCase()}]
				</span>
				<p className="text-sm font-medium leading-6">{q.question}</p>
			</div>

			{q.type === "multiple_choice" && q.options && (
				<div className="space-y-2">
					{q.options.map((opt) => {
						const chosen = answer === opt;
						let status: "correct" | "wrong" | "neutral" | undefined;
						if (revealed) {
							if (opt === q.correctAnswer) status = "correct";
							else if (chosen) status = "wrong";
						}
						return (
							<QuizOption
								key={opt}
								label={opt}
								selected={chosen}
								onClick={() => onChange(opt)}
								disabled={revealed}
								status={status}
							/>
						);
					})}
				</div>
			)}

			{(q.type === "short_answer" || q.type === "fill_in" || q.type === "transfer") && (
				<div className="space-y-2">
					<textarea
						className={`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none resize-none min-h-[80px] placeholder:text-muted-foreground ${
							isWrong
								? "border-destructive/60 bg-destructive/5"
								: isCorrect
									? "border-emerald-500/60 bg-emerald-500/5"
									: "border-border"
						}`}
						placeholder={q.type === "fill_in" ? "Fill in the blank..." : "Type your answer..."}
						value={answer}
						onChange={(e) => onChange(e.target.value)}
						disabled={revealed}
					/>
					{revealed && (
						<div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
							<Lightbulb size={14} className="shrink-0 mt-0.5 text-accent" />
							<div className="space-y-1">
								<p>
									<span className="font-medium">Correct:</span> {q.correctAnswer}
								</p>
								{q.explanation && <p>{q.explanation}</p>}
								{q.rubric && <p className="text-[10px] opacity-70">{q.rubric}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{q.type === "true_false" && (
				<div className="flex gap-3">
					{["True", "False"].map((opt) => {
						const chosen = answer === opt;
						let status: "correct" | "wrong" | "neutral" | undefined;
						if (revealed) {
							if (opt === q.correctAnswer) status = "correct";
							else if (chosen) status = "wrong";
						}
						return (
							<QuizOption
								key={opt}
								label={opt}
								selected={chosen}
								onClick={() => onChange(opt)}
								disabled={revealed}
								status={status}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

QuizRenderer.displayName = "QuizRenderer";

export function QuizRenderer({ quiz, onSubmit }: QuizRendererProps) {
	const [answers, setAnswers] = useState<AnswerState>({});
	const [revealed, setRevealed] = useState(false);

	const setAnswer = useCallback((qid: string, val: string) => {
		setAnswers((prev) => ({ ...prev, [qid]: val }));
	}, []);

	const score = useMemo(() => {
		let correct = 0;
		for (const q of quiz.questions) {
			const ans = (answers[q.id] || "").trim().toLowerCase();
			if (ans === q.correctAnswer.trim().toLowerCase()) correct++;
		}
		return correct;
	}, [answers, quiz.questions]);

	const percent = Math.round((score / quiz.questions.length) * 100);

	const handleSubmit = useCallback(() => {
		setRevealed(true);
		onSubmit?.(answers, score);
	}, [answers, score, onSubmit]);

	const handleReset = useCallback(() => {
		setAnswers({});
		setRevealed(false);
	}, []);

	return (
		<div className="rounded-xl border-2 border-border bg-background p-4 sm:p-5 space-y-4 my-3 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-base font-bold">{quiz.topic}</h3>
					<p className="text-xs text-muted-foreground font-terminal">
						{quiz.questions.length} QUESTIONS // {quiz.totalPoints} POINTS
					</p>
				</div>
				{revealed && (
					<div className="text-right">
						<div className={`text-2xl font-bold font-terminal ${percent >= 70 ? "text-emerald-600 dark:text-emerald-400" : percent >= 40 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}>
							{score}/{quiz.questions.length}
						</div>
						<div className="text-[10px] text-muted-foreground uppercase">{percent}%</div>
					</div>
				)}
			</div>

			<div className="space-y-3">
				{quiz.questions.map((q, i) => (
					<QuestionCard
						key={q.id}
						q={q}
						index={i}
						answer={answers[q.id] || ""}
						onChange={(val) => setAnswer(q.id, val)}
						revealed={revealed}
					/>
				))}
			</div>

			{!revealed ? (
				<button
					onClick={handleSubmit}
					disabled={Object.keys(answers).length < quiz.questions.length}
					className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
				>
					<Send size={14} />
					Submit Quiz
				</button>
			) : (
				<button
					onClick={handleReset}
					className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
				>
					<RotateCcw size={14} />
					Retake
				</button>
			)}
		</div>
	);
}
