import { useCallback, useState } from "react";
import { Check, Circle, Flag, Target } from "lucide-react";
import { css } from "../../styled-system/css";
import { Spinner } from "./Spinner";
import {
	advanceGoalStep,
	computeGoalProgress,
	type GoalStep,
	type GoalStepStatus,
	type LearnerGoal,
} from "../keating/goals";
import { keatingStorage } from "../hooks/keating-storage";

interface GoalRendererProps {
	goal: LearnerGoal;
}

const KIND_LABEL: Record<GoalStep["kind"], string> = {
	concept: "Concept",
	practice: "Practice",
	project: "Project",
	milestone: "Milestone",
	reflection: "Reflect",
};

const NEXT_STATUS: Record<GoalStepStatus, GoalStepStatus> = {
	not_started: "in_progress",
	in_progress: "done",
	done: "not_started",
};

export function GoalRenderer({ goal: initialGoal }: GoalRendererProps) {
	const [goal, setGoal] = useState<LearnerGoal>(initialGoal);
	const [savingStep, setSavingStep] = useState<string | null>(null);
	const progress = computeGoalProgress(goal);

	const cycleStep = useCallback(
		async (step: GoalStep) => {
			const next = advanceGoalStep(goal, step.id, NEXT_STATUS[step.status]);
			setGoal(next);
			setSavingStep(step.id);
			try {
				const saved = await keatingStorage.saveGoal(next);
				setGoal(saved);
				// Let the agent know progress changed so it can react / re-plan.
				window.dispatchEvent(
					new CustomEvent("keating:goal-updated", {
						detail: {
							goalId: saved.id,
							title: saved.title,
							stepTitle: step.title,
							status: NEXT_STATUS[step.status],
							done: computeGoalProgress(saved).done,
							total: saved.steps.length,
						},
					}),
				);
			} finally {
				setSavingStep((current) => (current === step.id ? null : current));
			}
		},
		[goal],
	);

	return (
		<div className={css({
			marginBlock: "0.75rem",
			borderRadius: "0.75rem",
			border: "2px solid color-mix(in srgb, var(--primary) 30%, transparent)",
			background: "color-mix(in srgb, var(--primary) 5%, transparent)",
			padding: "1rem",
			boxShadow: "var(--shadow-sm)",
		})}>
			<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" })}>
				<div className={css({ display: "flex", height: "2.25rem", width: "2.25rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--primary) 15%, transparent)" })}>
					<Target size={18} className={css({ color: "var(--primary)" })} />
				</div>
				<div className={css({ minWidth: 0, flex: 1 })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<h3 className={css({ fontSize: "1rem", fontWeight: 700, lineHeight: 1.25 })}>{goal.title}</h3>
						{goal.status === "completed" && (
							<span className={css({ flexShrink: 0, borderRadius: "0.25rem", background: "rgba(16, 185, 129, 0.15)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 600, textTransform: "uppercase", color: "#059669", ".dark &": { color: "#34d399" } })}>
								Done
							</span>
						)}
					</div>
					{goal.description && (
						<p className={css({ marginTop: "0.25rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>{goal.description}</p>
					)}
				</div>
			</div>

			{/* Progress */}
			<div className={css({ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" })}>
				<div className={css({ height: "0.375rem", flex: 1, overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
					<div
						className={css({ height: "100%", borderRadius: "9999px", background: "var(--primary)", transition: "all 150ms" })}
						style={{ width: `${progress.percent}%` }}
					/>
				</div>
				<span className={css({ fontSize: "0.6875rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" })}>
					{progress.done}/{progress.total}
				</span>
			</div>

			{/* Steps */}
			<ol className={css({ marginTop: "1rem", "& > * + *": { marginTop: "0.5rem" } })}>
				{goal.steps.map((step) => {
					const isNext = progress.nextStep?.id === step.id;
					const saving = savingStep === step.id;
					return (
						<li key={step.id}>
							<div
								className={css({
									display: "flex",
									alignItems: "flex-start",
									gap: "0.75rem",
									borderRadius: "0.5rem",
									border: "1px solid",
									borderColor: step.status === "done"
										? "rgba(16, 185, 129, 0.4)"
										: isNext
											? "color-mix(in srgb, var(--primary) 50%, transparent)"
											: "var(--border)",
									background: step.status === "done"
										? "rgba(16, 185, 129, 0.05)"
										: isNext
											? "var(--background)"
											: "color-mix(in srgb, var(--background) 60%, transparent)",
									padding: "0.75rem",
									transition: "color 150ms, background-color 150ms, border-color 150ms",
								})}
							>
								<button
									type="button"
									aria-label={`Mark step "${step.title}" — currently ${step.status.replace("_", " ")}`}
									title={`Status: ${step.status.replace("_", " ")} (tap to advance)`}
									disabled={saving}
									onClick={() => void cycleStep(step)}
									className={css({
										marginTop: "0.125rem",
										display: "inline-flex",
										height: "1.75rem",
										width: "1.75rem",
										flexShrink: 0,
										alignItems: "center",
										justifyContent: "center",
										borderRadius: "9999px",
										border: "2px solid",
										borderColor: step.status === "done"
											? "#10b981"
											: step.status === "in_progress"
												? "var(--primary)"
												: "var(--border)",
										background: step.status === "done" ? "#10b981" : undefined,
										color: step.status === "done"
											? "white"
											: step.status === "in_progress"
												? "var(--primary)"
												: "var(--muted-foreground)",
										transition: "color 150ms, background-color 150ms, border-color 150ms",
										_hover: step.status === "not_started" ? { borderColor: "color-mix(in srgb, var(--primary) 60%, transparent)" } : undefined,
									})}
								>
									{saving ? (
										<Spinner size={14} />
									) : step.status === "done" ? (
										<Check size={15} />
									) : step.status === "in_progress" ? (
										<Spinner size={14} />
									) : step.kind === "milestone" || step.kind === "project" ? (
										<Flag size={13} />
									) : (
										<Circle size={12} />
									)}
								</button>
								<div className={css({ minWidth: 0, flex: 1 })}>
									<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
										<span className={css({ fontSize: "0.875rem", fontWeight: 500 })}>
											{step.order + 1}. {step.title}
										</span>
										<span className={css({ borderRadius: "0.25rem", background: "var(--muted)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", textTransform: "uppercase", color: "var(--muted-foreground)" })}>
											{KIND_LABEL[step.kind]}
										</span>
										{isNext && step.status !== "done" && (
											<span className={css({ borderRadius: "0.25rem", background: "color-mix(in srgb, var(--primary) 15%, transparent)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", fontWeight: 600, textTransform: "uppercase", color: "var(--primary)" })}>
												Next
											</span>
										)}
									</div>
									{step.description && (
										<p className={css({ marginTop: "0.25rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>{step.description}</p>
									)}
									{step.successCriteria.length > 0 && (
										<ul className={css({ marginTop: "0.5rem", "& > * + *": { marginTop: "0.25rem" } })}>
											{step.successCriteria.map((c, i) => (
												<li key={i} className={css({ display: "flex", alignItems: "flex-start", gap: "0.375rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
													<span aria-hidden="true" className={css({ marginTop: "0.375rem", display: "inline-block", height: "0.25rem", width: "0.25rem", flexShrink: 0, borderRadius: "9999px", background: "color-mix(in srgb, var(--muted-foreground) 60%, transparent)" })} />
													{c}
												</li>
											))}
										</ul>
									)}
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
