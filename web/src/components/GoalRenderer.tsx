import { useCallback, useState } from "react";
import { Check, Circle, Flag, Loader2, Target } from "lucide-react";
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
		<div className="my-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-4 shadow-sm">
			<div className="flex items-start gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
					<Target size={18} className="text-primary" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="text-base font-bold leading-tight">{goal.title}</h3>
						{goal.status === "completed" && (
							<span className="shrink-0 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
								Done
							</span>
						)}
					</div>
					{goal.description && (
						<p className="mt-1 text-xs leading-5 text-muted-foreground">{goal.description}</p>
					)}
				</div>
			</div>

			{/* Progress */}
			<div className="mt-3 flex items-center gap-2">
				<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-all"
						style={{ width: `${progress.percent}%` }}
					/>
				</div>
				<span className="font-terminal text-[11px] text-muted-foreground tabular-nums">
					{progress.done}/{progress.total}
				</span>
			</div>

			{/* Steps */}
			<ol className="mt-4 space-y-2">
				{goal.steps.map((step) => {
					const isNext = progress.nextStep?.id === step.id;
					const saving = savingStep === step.id;
					return (
						<li key={step.id}>
							<div
								className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
									step.status === "done"
										? "border-emerald-500/40 bg-emerald-500/5"
										: isNext
											? "border-primary/50 bg-background"
											: "border-border bg-background/60"
								}`}
							>
								<button
									type="button"
									aria-label={`Mark step "${step.title}" — currently ${step.status.replace("_", " ")}`}
									title={`Status: ${step.status.replace("_", " ")} (tap to advance)`}
									disabled={saving}
									onClick={() => void cycleStep(step)}
									className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
										step.status === "done"
											? "border-emerald-500 bg-emerald-500 text-white"
											: step.status === "in_progress"
												? "border-primary text-primary"
												: "border-border text-muted-foreground hover:border-primary/60"
									}`}
								>
									{saving ? (
										<Loader2 size={14} className="animate-spin" />
									) : step.status === "done" ? (
										<Check size={15} />
									) : step.status === "in_progress" ? (
										<Loader2 size={14} />
									) : step.kind === "milestone" || step.kind === "project" ? (
										<Flag size={13} />
									) : (
										<Circle size={12} />
									)}
								</button>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-medium">
											{step.order + 1}. {step.title}
										</span>
										<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
											{KIND_LABEL[step.kind]}
										</span>
										{isNext && step.status !== "done" && (
											<span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
												Next
											</span>
										)}
									</div>
									{step.description && (
										<p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
									)}
									{step.successCriteria.length > 0 && (
										<ul className="mt-2 space-y-1">
											{step.successCriteria.map((c, i) => (
												<li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
													<span aria-hidden="true" className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
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
