import { useEffect, useRef, useState } from "react";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { Link } from "@tanstack/react-router";
import { Button } from "../../design-system/kit";
import type { CareNeed, HabitsCommand, HabitsSnapshot } from "../../keating/habits/contracts";
import { HABIT_KIT, HABIT_QUESTS } from "../../keating/habits/quest-catalog";
import { writeHabitAdvice } from "../../keating/habits/director";
import type { ChallengeGoal } from "./HabitChallengeForm";
import dusty from "./art/care-dusty.webp";
import keepsakes from "./art/care-keepsakes.webp";
import topForm from "./art/care-topform.webp";
import lowBattery from "./art/care-lowbatt.webp";
import crates from "./art/habit-crates.webp";
import toppers from "./art/kit-toppers.webp";
import packs from "./art/kit-packs.webp";
import blasters from "./art/kit-blasters.webp";

type PanelProps = {
  state: HabitsSnapshot;
  pending: boolean;
  act(command: HabitsCommand): void;
  solve(goal: ChallengeGoal): void;
};
const careNeeds = [
  { id: "charge", label: "Charge", pocket: "sparks", action: "Charge up" },
  { id: "tune", label: "Tuning", pocket: "cogs", action: "Tune up" },
  { id: "shine", label: "Shine", pocket: "polish", action: "Polish" },
] as const;
const catalogueArt = { toppers, packs, blasters };
const rarityNames = { common: "Study parcel", uncommon: "Field box", rare: "Phosphor crate", masterwork: "Gilded folio" };
const rarityCells = { common: 0, uncommon: 1, rare: 2, masterwork: 3 };
const formatDeadline = (at: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);

function Sprite({ url, cell, className = "" }: { url: string; cell: number; className?: string }) {
  return <span aria-hidden="true" className={`habit-sprite ${className}`} style={{
    backgroundImage: `url(${url})`, backgroundPosition: `${(cell % 4) * 100 / 3}% ${cell >= 4 ? 100 : 0}%`,
  }} />;
}

function careGoal(id: CareNeed): ChallengeGoal {
  return id === "charge" ? { kind: "micro", target: { kind: "care", id }, title: "Solve a problem to recharge", objective: "apply a result from the lesson and explain why it works" }
    : id === "tune" ? { kind: "repair", target: { kind: "care", id }, title: "Solve a problem to tune up", objective: "repair the first incorrect step of an example from the lesson" }
    : { kind: "teach", target: { kind: "care", id: "condition" }, title: "Teach Keating back", objective: "teach Keating one concept from the lesson and explain how it carries to a changed example" };
}

export function CarePanel({ state, pending, act, solve, onClose }: PanelProps & { onClose(): void }) {
  const { charge, shine } = state.condition;
  const pose = state.away?.stage === "sheet" ? dusty : charge < 0.38 ? lowBattery : topForm;
  const hasSupplies = careNeeds.some(need => state.inventory[need.pocket] > 0 && state.condition[need.id] < 1);
  return <div className="habit-grid">
    <section className="habit-studio">
      <div className="habit-perch"><Sprite url={pose} cell={0} /><span>Keating</span></div>
      <div className="habit-condition">
        <h3>Look after Keating</h3>
        {careNeeds.map(need => <div className="habit-need" key={need.id}>
          <label>{need.label}<meter min={0} max={1} value={state.condition[need.id]}>{Math.round(state.condition[need.id] * 100)}%</meter></label>
          <span className="habit-muted">{state.inventory[need.pocket]} {need.pocket}</span>
          <Button variant="outline" onClick={() => act({ type: "care", need: need.id })} disabled={pending || state.inventory[need.pocket] === 0 || state.condition[need.id] >= 1}>{need.action}</Button>
          {state.inventory[need.pocket] === 0 && <Button variant="ghost" onClick={() => solve(careGoal(need.id))}>Solve to skip</Button>}
        </div>)}
        <Button variant="outline" onClick={() => act({ type: "topUp" })} disabled={pending || !hasSupplies}>Use supplies to top up</Button>
        <p className="habit-muted">Charge powers his jetpack and blaster. Earn sparks by studying, finishing quests, or playing Recess, then spend them here to recharge. {shine >= 0.9 ? "He starts Recess with three Eurekas." : "At 90% shine he starts with a third Eureka."}</p>
        {state.overchargeUntil && <p>Overcharge ends {formatDeadline(state.overchargeUntil)} or after one Recess run.</p>}
      </div>
    </section>
    <section className="habit-shelf">
      <h3>His shelf</h3>
      {state.keepsakes.length ? <ul className="habit-list">{state.keepsakes.map((item, index) => <li key={item.id}>
        <Sprite url={keepsakes} cell={index % 8} />
        <div><strong>{item.title}</strong><p className="habit-muted">{item.dusty ? "Due for review" : `Review ${formatDeadline(item.dueAt)}`}</p></div>
        {item.sessionId && <Link to="/chat" search={{ session: item.sessionId }} onClick={onClose}>Review lesson</Link>}
        {item.dusty && <Button variant="ghost" onClick={() => solve({ kind: "teach", target: { kind: "shelf", id: item.id }, title: "Dust this keepsake", objective: item.title })}>Teach it back</Button>}
      </li>)}</ul> : <p>Finish a lesson check to put its first keepsake on the shelf.</p>}
      {state.shelfBonusUntil && <p className="habit-muted">Extra polish on your next different lesson until {formatDeadline(state.shelfBonusUntil)}.</p>}
    </section>
  </div>;
}

const slotLabels: Record<string, string> = {
  blaster: "Weapon",
  helper: "Companion",
  pack: "Pack",
  topper: "Topper",
  boots: "Boots",
  visor: "Visor",
  trail: "Trail",
  perch: "Perch",
};

export function QuestsPanel({ state, pending, act, solve }: PanelProps) {
  const [tab, setTab] = useState<"today" | "expeditions" | "journal" | "workshop" | "kit">("today");
  const quests = HABIT_QUESTS.filter(quest => tab === "journal" ? state.quests[quest.id]?.completedAt
    : tab === "expeditions" ? quest.expedition : !quest.expedition);
  const owned = state.ownedKit.includes("drone") ? state.ownedKit : [...state.ownedKit, "drone"];
  const kit = HABIT_KIT.filter(piece => tab === "workshop" ? !owned.includes(piece.id) : owned.includes(piece.id));
  return <div>
    <nav className="habit-subnav" aria-label="Quests and kit">
      {(["today", "expeditions", "journal", "workshop", "kit"] as const).map(id => <Button key={id} variant="ghost" aria-pressed={tab === id} onClick={() => setTab(id)}>{id[0]!.toUpperCase() + id.slice(1)}</Button>)}
    </nav>
    <div className="habit-pocket"><span>{state.inventory.parts} parts</span><span>{state.inventory.shards} shards</span><span>{state.workshopLP} workshop LP</span></div>
    {(tab === "today" || tab === "expeditions") && (state.weekendBountyUntil || state.dailyBountyUntil) && <p className="habit-bounty">
      {state.weekendBountyUntil ? `Weekend bounty · 4 bonus parts until ${formatDeadline(state.weekendBountyUntil)}` : `Daily bounty · 2 bonus parts until ${formatDeadline(state.dailyBountyUntil!)}`}.
    </p>}
    {tab === "workshop" || tab === "kit" ? <ul className="habit-list habit-workshop">{kit.map(piece => {
      const built = owned.includes(piece.id);
      const equipped = state.equippedKit[piece.slot] === piece.id || (piece.id === "drone" && !state.equippedKit.helper);
      const pieces = state.blueprints[piece.id] ?? 0;
      const craftable = piece.blueprints > 0 || piece.parts > 0;
      const costLine = !craftable
        ? "Earned on your first completed quest"
        : piece.blueprints > 0
          ? `${pieces}/${piece.blueprints} blueprint pieces · ${piece.parts} parts`
          : `${piece.parts} parts`;
      return <li key={piece.id}>
        {piece.art && <Sprite url={catalogueArt[piece.art.sheet]} cell={piece.art.cell} />}
        <div>
          <strong>{piece.name}</strong>
          <p className="habit-muted">{built ? (slotLabels[piece.slot] ?? piece.slot) : `${slotLabels[piece.slot] ?? piece.slot} · ${costLine}`}</p>
          {piece.recessEffect && <p className="habit-muted">{piece.recessEffect}</p>}
        </div>
        {built ? <Button variant="outline" disabled={pending || equipped} onClick={() => act({ type: "equip", kitId: piece.id })}>{equipped ? "Equipped" : "Put it on"}</Button>
          : <Button variant="outline" disabled={pending || !craftable || (piece.blueprints > 0 && pieces < piece.blueprints) || state.inventory.parts < piece.parts} onClick={() => act({ type: "craft", kitId: piece.id })}>Build</Button>}
        {!built && pieces >= piece.blueprints && state.inventory.parts < piece.parts && piece.parts - state.inventory.parts <= 2
          && <Button variant="ghost" onClick={() => solve({ kind: "teach", target: { kind: "workshop", id: piece.id }, title: "Study for workshop parts", objective: `explain the idea behind the ${piece.name}` })}>Earn parts</Button>}
      </li>;
    })}</ul> : <div className="habit-quests">
      {!quests.length && <p>Completed quests appear here in your field journal.</p>}
      {quests.map(quest => {
        const progress = state.quests[quest.id];
        const available = !quest.requires || !!state.quests[quest.requires]?.completedAt;
        return <article key={quest.id} className="habit-quest">
          <span className="habit-muted">{quest.expedition ?? quest.subject} · about {quest.minutes} min</span>
          <h3>{quest.title}</h3><p>{quest.why}</p>
          {progress?.completedAt ? <p>Completed {formatDeadline(progress.completedAt)}</p> : !available ? <p className="habit-muted">Finish the previous expedition quest to begin.</p> : <>
            {progress && <p>{quest.prompt}</p>}
            <p className="habit-muted">Earn a spark, {quest.blueprints} blueprint pieces, and {quest.parts} parts.</p>
            {progress ? <Button onClick={() => solve({ kind: "assignment", target: { kind: "quest", id: quest.id }, title: quest.title, objective: quest.subject, prompt: quest.prompt })}>Submit written work</Button>
              : <Button variant="outline" disabled={pending} onClick={() => act({ type: "acceptQuest", questId: quest.id })}>Accept quest</Button>}
          </>}
        </article>;
      })}
    </div>}
  </div>;
}

export function HabitsPanel({ state, pending, act, solve, hasLesson, model }: PanelProps & { hasLesson: boolean; model?: Model<Api> }) {
  const [restDay, setRestDay] = useState("");
  const [pauseDays, setPauseDays] = useState(7);
  const [advice, setAdvice] = useState<Awaited<ReturnType<typeof writeHabitAdvice>>>(null);
  const [writingAdvice, setWritingAdvice] = useState(false);
  const request = useRef<AbortController | null>(null);
  const restInput = useRef<HTMLInputElement>(null);
  const studyGoal: ChallengeGoal = { kind: "transfer", objective: "a concept from the current lesson", title: "Apply what you learned" };
  useEffect(() => {
    setAdvice(null);
    setWritingAdvice(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [state.scope, state.day, state.studiedToday, state.tone]);

  async function suggest() {
    if (!model || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setWritingAdvice(true);
    const fallback = state.studiedToday
      ? { message: "Your study is counted for today. Leave the next lesson for later.", move: "finished" as const }
      : { message: "Pick one idea to practise, or plan a rest day if the week is full.", move: "one-problem" as const };
    try {
      const now = Date.parse(`${state.day}T12:00:00Z`);
      const recentDays = state.actualStudyDays.filter(day => Date.parse(`${day}T12:00:00Z`) >= now - 27 * 86_400_000).length;
      const generated = await writeHabitAdvice(model, { studiedToday: state.studiedToday, studyDays: recentDays,
        restDays: state.restDays.length, awayStage: state.away?.stage, tone: state.tone }, controller.signal);
      if (!controller.signal.aborted) setAdvice(generated ?? fallback);
    } catch {
      if (!controller.signal.aborted) setAdvice(fallback);
    } finally {
      if (!controller.signal.aborted) { request.current = null; setWritingAdvice(false); }
    }
  }
  return <div className="habit-dashboard">
    <section className="habit-summary" aria-label="Study streak">
      <dl><div><dt>Current streak</dt><dd>{state.streak}</dd></div><div><dt>Best streak</dt><dd>{state.bestStreak}</dd></div><div><dt>Days studied</dt><dd>{state.totalStudyDays}</dd></div></dl>
      <p>{state.studiedToday ? "Today’s study is counted." : `Today’s study day ends ${formatDeadline(state.dayEndsAt)}.`}</p>
      {state.away && <div className="habit-away"><p>{state.away.message}</p><Button variant="ghost" disabled={pending} onClick={() => act({ type: "dismissAway" })}>Dismiss</Button></div>}
      {state.rescueUntil && state.rescueObjective && <div className="habit-bounty"><p>Bring back your streak by {formatDeadline(state.rescueUntil)} with a fresh synthesis problem.</p>
        <Button onClick={() => solve({ kind: "rescue", objective: state.rescueObjective!, title: "Solve to rescue your streak" })}>Solve to rescue</Button></div>}
      <div className="habit-actions">
        <Button variant="outline" onClick={() => solve(studyGoal)}>Try a study problem</Button>
        {hasLesson && <Button variant="ghost" onClick={() => solve({ kind: "lesson", objective: "the main objective from the current lesson", title: "Finish lesson check" })}>Finish lesson check</Button>}
      </div>
    </section>
    <section className="habit-rewards"><h3>Mystery crates</h3>
      <p>Checked study can earn a crate. Work that shows more understanding raises the chance.</p>
      {state.crates.length === 0 && <p className="habit-muted">No crates to open.</p>}
      <ul className="habit-list">{state.crates.map(crate => <li key={crate.id}>
        <Sprite url={crates} cell={rarityCells[crate.rarity]} />
        <div><strong>{rarityNames[crate.rarity]}</strong><p className="habit-muted">Claim by {formatDeadline(crate.expiresAt)}.</p></div>
        {crate.unlockAt <= Date.now() ? <Button variant="outline" disabled={pending} onClick={() => act({ type: "claim", crateId: crate.id })}>Open crate</Button>
          : <div><p className="habit-muted">Unlocks {formatDeadline(crate.unlockAt)}</p><Button variant="ghost" onClick={() => solve({ kind: "repair", target: { kind: "crate", id: crate.id }, objective: "repair a broken worked example from the current lesson", title: "Solve to open this crate" })}>Solve to skip</Button></div>}
      </li>)}</ul>
      <details><summary>Drop chances</summary><p className="habit-muted">A qualifying result has a 15–30% chance to earn a crate, with a guaranteed drop after five eligible misses. Base rarity weights are 60% common, 28% uncommon, 10% rare, and 2% masterwork. Strong transfer work can raise the rare chance to 14%.</p></details>
      {state.inventory.vouchers > 0 && <Button variant="outline" disabled={pending} onClick={() => act({ type: "activateWorkshopBonus" })}>Use workshop bonus voucher</Button>}
      {(state.collectedTints.length > 0 || state.collectedFinishes.length > 0 || state.collectedRelics.length > 0) && <p className="habit-muted">Collected {state.collectedTints.length} tints, {state.collectedFinishes.length} finishes, and {state.collectedRelics.length} relics.</p>}
    </section>
    <section className="habit-preferences"><h3>Plan your study days</h3>
      <label>Away messages <select value={state.tone} disabled={pending} onChange={event => act({ type: "tone", value: event.target.value as HabitsSnapshot["tone"] })}>
        <option value="off">Off</option><option value="gentle">Gentle</option><option value="spirited">Spirited</option><option value="dramatic">Dramatic</option>
      </select></label>
      <form onSubmit={event => { event.preventDefault(); if (restDay > state.day) act({ type: "planRest", day: restDay }); }}>
        <label>Rest day <input ref={restInput} type="date" value={restDay} onChange={event => setRestDay(event.target.value)} /></label>
        <Button variant="outline" type="submit" disabled={pending || restDay <= state.day}>Plan rest day</Button>
      </form>
      {state.restDays.length > 0 && <p className="habit-muted">Planned rest days {state.restDays.join(", ")}</p>}
      {state.pauseUntil ? <div className="habit-actions"><span>Paused until {formatDeadline(state.pauseUntil)}</span><Button variant="outline" disabled={pending} onClick={() => act({ type: "resume" })}>Resume study days</Button></div>
        : <form onSubmit={event => { event.preventDefault(); act({ type: "pause", days: pauseDays }); }}>
          <label>Pause for holiday or illness <input type="number" min={1} max={30} value={pauseDays} onChange={event => setPauseDays(Number(event.target.value))} /> days</label>
          <Button variant="outline" type="submit" disabled={pending || !Number.isInteger(pauseDays) || pauseDays < 1 || pauseDays > 30}>Pause study days</Button>
        </form>}
      {model && state.tone !== "off" && <div className="habit-actions">
        <Button variant="ghost" onClick={() => void suggest()} disabled={writingAdvice}>{writingAdvice ? "Thinking…" : "Ask Keating about my study routine"}</Button>
        {advice && <div className="habit-bounty"><p role="status">{advice.message}</p>
          {advice.move === "rest" && <Button variant="outline" onClick={() => restInput.current?.focus()}>Choose a rest day</Button>}
          {advice.move === "one-problem" && <Button variant="outline" onClick={() => solve(studyGoal)}>Try one problem</Button>}</div>}
      </div>}
    </section>
  </div>;
}
