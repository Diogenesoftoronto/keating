import { useEffect, useRef, useState } from "react";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { Button } from "../../design-system/kit";
import { gradeHabitChallenge, writeHabitChallenge, type HabitChallenge } from "../../keating/habits/director";
import { currentHabitsScope } from "../../keating/habits/store";
import type { HabitsCommand } from "../../keating/habits/contracts";
import type { HabitLesson } from "../../keating/habits/lesson";

type GradeCommand = Extract<HabitsCommand, { type: "grade" }>;
export type ChallengeGoal = Pick<GradeCommand, "kind" | "target" | "objective"> & { title: string; prompt?: string };

function offlineRepair(): HabitChallenge & { expected: string } {
  const [sample] = crypto.getRandomValues(new Uint8Array(1));
  const count = 3 + (sample! % 8);
  const price = 2 + Math.floor(sample! / 8) % 7;
  return {
    id: crypto.randomUUID(), objective: "unit prices", reference: "Multiply each quantity by the unit price.",
    prompt: `A worksheet says ${count} notebooks at $${price} each cost $${count + price} because it adds the two numbers. Choose ADD or MULTIPLY, then give the corrected total and the total for ${count + 2} notebooks. Enter the operation and the two totals separated by commas.`,
    worked: `A unit price repeats for every notebook. ${count} × ${price} is ${count * price}, and ${count + 2} × ${price} is ${(count + 2) * price}.`,
    expected: `multiply,${count * price},${(count + 2) * price}`,
  };
}

export function HabitChallengeForm({ goal, lesson, model, hasRescueShield, onSolve, onCancel, onDraft }: {
  goal: ChallengeGoal;
  lesson: HabitLesson;
  model?: Model<Api>;
  hasRescueShield: boolean;
  onSolve(command: GradeCommand): Promise<boolean>;
  onCancel(): void;
  onDraft(text: string): void;
}) {
  const [item, setItem] = useState<(HabitChallenge & { expected?: string }) | null>(() => goal.prompt ? {
    id: crypto.randomUUID(), objective: goal.objective, prompt: goal.prompt,
    reference: "Check that the response includes substantive work that meets each part of the task, a specific explanation of a choice or observation, and a reflection on another case or a revision. Accept multiple sound methods.",
    worked: "Work a small example first. State what you did, point to one observation that supports it, and predict what would change if one assumption were different.",
  } : null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [misses, setMisses] = useState(0);
  const [recap, setRecap] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const request = useRef<AbortController | null>(null);
  const canPracticeOffline = ["micro", "repair", "transfer"].includes(goal.kind);
  useEffect(() => () => request.current?.abort(), []);

  async function prepare() {
    if (!model || request.current) return;
    const abort = new AbortController();
    const scope = currentHabitsScope();
    request.current = abort;
    setPending(true);
    setFeedback("");
    try {
      const next = await writeHabitChallenge(model, lesson, goal.objective, crypto.randomUUID(), abort.signal);
      if (abort.signal.aborted || currentHabitsScope() !== scope) return;
      setItem(next);
      setAnswer("");
      setMisses(0);
      setRecap("");
    } catch {
      if (!abort.signal.aborted) setFeedback("Keating couldn’t prepare that problem. Try again or work on it in chat.");
    } finally {
      request.current = null;
      if (!abort.signal.aborted) setPending(false);
    }
  }

  function prepareOffline() {
    setItem(offlineRepair());
    setAnswer("");
    setMisses(0);
    setRecap("");
    setFeedback("");
  }

  async function check() {
    if (!item || (!model && !item.expected) || request.current || !answer.trim()) return;
    const abort = new AbortController();
    const scope = currentHabitsScope();
    const attemptedAt = Date.now();
    request.current = abort;
    setPending(true);
    setFeedback("");
    try {
      const localCorrect = item.expected && answer.toLowerCase().replace(/[$\s]/g, "") === item.expected;
      const grade = item.expected
        ? { rubric: localCorrect ? [2, 2, 2] as const : [0, 0, 0] as const,
          feedback: localCorrect ? "Both totals follow from multiplying quantity by unit price." : "Check how many times the unit price repeats for each order." }
        : await gradeHabitChallenge(model!, item, answer.trim(), abort.signal);
      if (abort.signal.aborted || currentHabitsScope() !== scope) return;
      const [accuracy, reasoning, application] = grade.rubric;
      const passed = accuracy === 2 && reasoning >= 1 && accuracy + reasoning + application >= (goal.kind === "rescue" ? 6 : 4);
      const saved = passed || goal.kind === "rescue"
        ? await onSolve({ type: "grade", id: goal.kind === "rescue" ? crypto.randomUUID() : item.id, scope, objective: item.objective, kind: goal.kind,
          rubric: grade.rubric, target: goal.target, attemptedAt }) : false;
      if (abort.signal.aborted) return;
      if (passed) {
        setDone(saved);
        setFeedback(saved ? grade.feedback : "That result could not be applied. Check the activity for its current state.");
      } else {
        setFeedback(grade.feedback);
        setMisses(misses + 1);
        if (misses >= 1) setRecap(item.worked);
      }
    } catch {
      if (!abort.signal.aborted) setFeedback("Keating couldn’t check that answer. Your attempt is still here.");
    } finally {
      request.current = null;
      if (!abort.signal.aborted) setPending(false);
    }
  }

  return <section className="habit-challenge" aria-label={goal.title}>
    <h3>{goal.title}</h3>
    {item && <p>{item.prompt}</p>}
    {!model && !item?.expected && <p>Choose a model in chat to get a problem drawn from your lesson and check written work.</p>}
    {model && !item && <><p>Keating will use recent lesson text to write and check this problem with your selected model.</p>
      <Button onClick={() => void prepare()} disabled={pending}>{pending ? "Preparing…" : "Prepare problem"}</Button></>}
    {canPracticeOffline && !item && <Button variant="ghost" onClick={prepareOffline} disabled={pending}>Try an offline problem</Button>}
    {(model || item?.expected) && item && !done && !recap && <form onSubmit={event => { event.preventDefault(); void check(); }}>
      <label>Your working and reasoning<textarea value={answer} onChange={event => setAnswer(event.target.value)} maxLength={2200} rows={5} disabled={pending} /></label>
      <p className="habit-muted">Keating checks accuracy, reasoning, and what changes in a new case.</p>
      <Button type="submit" disabled={pending || !answer.trim()}>{pending ? "Checking…" : "Check answer"}</Button>
    </form>}
    {feedback && <p role="status">{feedback}</p>}
    {recap && <div className="habit-recap"><h4>Worked example</h4><p>{recap}</p>
      {(goal.kind !== "rescue" || hasRescueShield)
        && <Button onClick={() => item?.expected ? prepareOffline() : void prepare()} disabled={pending}>{pending ? "Preparing…" : goal.kind === "rescue" ? "Try a new problem with your shield" : "Try a new example"}</Button>}</div>}
    <div className="habit-actions">
      {!done && <Button variant="ghost" onClick={() => onDraft(item?.prompt ?? `Give me a practice problem on ${goal.objective}.`)}>Work on it in chat</Button>}
      <Button variant="ghost" onClick={onCancel}>{done ? "Done" : "Back"}</Button>
    </div>
  </section>;
}
