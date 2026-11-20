import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { Button, Sheet } from "../../design-system/kit";
import { currentHabitsScope, dispatchHabits, readHabits, subscribeHabits } from "../../keating/habits/store";
import type { HabitsCommand, HabitsMode, HabitsSnapshot } from "../../keating/habits/contracts";
import type { HabitLesson } from "../../keating/habits/lesson";
import { compileLessonPack } from "../../keating/habits/director";
import { HabitChallengeForm, type ChallengeGoal } from "./HabitChallengeForm";
import { CarePanel, HabitsPanel, QuestsPanel } from "./HabitPanels";
import type { RecessResult } from "../recess/types";
import "./study-game.css";

const RecessGame = lazy(() => import("../recess/RecessGame").then(module => ({ default: module.RecessGame })));
const HabitRankings = lazy(() => import("./HabitRankings").then(module => ({ default: module.HabitRankings })));
const areas = [
  { id: "recess", label: "Recess" }, { id: "care", label: "Care" }, { id: "quests", label: "Quests and kit" },
  { id: "habits", label: "Habits" }, { id: "rankings", label: "Rankings" },
] as const;
const standard = { charge: 0.75, tune: 0.75, shine: 0.75 };
export type StudyGameArea = (typeof areas)[number]["id"];
export interface StudyGameContext {
  sessionId?: string;
  lesson: HabitLesson;
  model?: Model<Api>;
}

export default function StudyGameDialog({ initialArea, context, mode, onClose, onDraft, onRecessEnd }: {
  initialArea: StudyGameArea;
  context: StudyGameContext;
  mode: HabitsMode;
  onClose(): void;
  onDraft(prompt: string): void;
  onRecessEnd?: (result: RecessResult) => void;
}) {
  const [selected, setSelected] = useState(initialArea);
  const [state, setState] = useState<HabitsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [goal, setGoal] = useState<ChallengeGoal | null>(null);
  const writing = useRef(false);
  const activity = useRef<HTMLDivElement>(null);
  const scope = useSyncExternalStore(subscribeHabits, currentHabitsScope, () => "device");
  const area = mode === "off" ? "recess" : selected;

  useEffect(() => {
    let active = true;
    let revision = 0;
    const update = () => {
      const version = ++revision;
      void readHabits(mode).then(next => {
        if (active && version === revision && currentHabitsScope() === next.scope) setState(next);
      }).catch(() => { if (active && version === revision) setError("Study progress couldn’t be loaded on this device."); });
    };
    const unsubscribe = subscribeHabits(update);
    update();
    return () => { active = false; unsubscribe(); };
  }, [mode, scope]);

  useEffect(() => {
    if (goal) activity.current?.focus();
  }, [goal]);

  async function act(command: HabitsCommand): Promise<boolean> {
    if (writing.current || mode === "off") return false;
    writing.current = true;
    setPending(true);
    setError("");
    try {
      const next = await dispatchHabits(mode, command);
      if (currentHabitsScope() !== next.scope) return false;
      setState(next);
      return next.accepted;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change couldn’t be saved.");
      return false;
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  const snapshot = state?.scope === scope ? state : null;
  const panelProps = snapshot && { state: snapshot, pending, act: (command: HabitsCommand) => void act(command), solve: setGoal };
  return <Sheet open onClose={onClose} title="Study with Keating" className="study-game-dialog">
    <nav className="habit-nav" aria-label="Keating activities">
      {areas.filter(item => mode !== "off" || item.id === "recess").map(item => <Button
        key={item.id} variant="ghost" aria-pressed={area === item.id} onClick={() => { setSelected(item.id); setGoal(null); setError(""); }}>
        {item.label}
      </Button>)}
    </nav>
    {error && <p className="habit-error" role="alert">{error}</p>}
    {mode !== "off" && snapshot?.lastResult && <p className="habit-result" role="status">{snapshot.lastResult}</p>}
    <div ref={activity} className="habit-content" tabIndex={-1}>
      {goal && mode !== "off" ? <HabitChallengeForm
        key={`${scope}:${goal.title}`}
        goal={goal} lesson={context.lesson} model={context.model} hasRescueShield={!!snapshot?.inventory.shields}
        onSolve={command => act(command.kind === "lesson" && context.sessionId
          ? { ...command, lesson: { sessionId: context.sessionId, title: context.lesson.find(turn => turn.role === "learner")?.text.slice(0, 72) || "Lesson review" } }
          : command)} onDraft={onDraft} onCancel={() => setGoal(null)} />
        : area === "recess" ? <Suspense fallback={<p role="status">Opening Recess…</p>}><RecessGame
          lesson={context.lesson} condition={mode === "off" ? standard : snapshot?.condition ?? standard}
          kit={mode === "off" ? [] : Object.values(snapshot?.equippedKit ?? {})}
          onEnd={result => {
            if (!result.quit) void act({ type: "runEnd", runId: crypto.randomUUID(), result });
            onRecessEnd?.(result);
          }}
          onQuiz={onDraft}
          compilePack={context.model && context.lesson.length ? async (signal, base) => {
            const pack = await compileLessonPack(context.model, context.lesson, base, signal);
            return scope === currentHabitsScope() ? pack : null;
          } : undefined}
        /></Suspense>
        : area === "rankings" ? <Suspense fallback={<p role="status">Opening rankings…</p>}><HabitRankings enabled
          onVerifiedStudy={receipt => { void act({ type: "rankedStudy", scope, receipt }); }} /></Suspense>
        : !panelProps ? (!error && <p role="status">Opening study progress…</p>)
        : area === "care" ? <CarePanel {...panelProps} onClose={onClose} />
        : area === "quests" ? <QuestsPanel {...panelProps} />
        : <HabitsPanel {...panelProps} model={context.model} hasLesson={context.lesson.length > 0 && !!context.sessionId} />}
    </div>
  </Sheet>;
}
