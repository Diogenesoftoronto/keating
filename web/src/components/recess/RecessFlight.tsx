import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import type { RecessLoadout } from "../../keating/habits/quest-catalog";
import { recessPlainText } from "../../keating/habits/recess-lesson";
import { RecessInlineMarkdown, RecessLessonMarkdown } from "./RecessLessonMarkdown";
import { sittingBot } from "./assets";
import { RecessAudio } from "./engine/audio.js";
import { WEAPON_LABELS } from "./engine/arsenal.js";
import { RECESS_BOMBS, type RecessBombKind } from "./engine/bombs.js";
import { Recess } from "./engine/core.js";
import { createBossSceneView } from "./boss-scene-view";
import "./boss-scene.css";
import type { RecessBotArt, RecessCondition, RecessControl, RecessExplainItem, RecessExplainLevel, RecessHud, RecessLessonTurn, RecessPack, RecessQuestionKind, RecessResult, RecessWind } from "./types";

export interface RecessFlightSettings {
  control: RecessControl;
  skin: "toy" | "ink";
  calm: boolean;
  sound: boolean;
  bombKind: RecessBombKind;
  bossScenes?: boolean;
  /** How strongly the lesson shows behind the play, 8 to 70. */
  opacity: number;
  /** Local weapon/helper picks used when Companion mode is Off. */
  weaponId?: string;
  helperId?: string;
}

interface Props {
  pack: RecessPack;
  /** The chat turns the run flies over; practice packs carry their own thread. */
  lesson?: readonly RecessLessonTurn[];
  assets: RecessBotArt;
  condition: RecessCondition;
  loadout?: RecessLoadout;
  settings: RecessFlightSettings;
  /** The chat thread the flight covers. */
  host: HTMLElement;
  /** Where the chat column sits inside the host, so the lesson lines up with the messages it replaces. */
  column: { left: number; width: number } | null;
  dark: boolean;
  onEnd(result: RecessResult): void;
  /** Called once when an active run is torn down without a result and spent charge. */
  onAbandon?: (chargeDelta: number) => void;
  /** fatal: the run never started, unmount. Otherwise it is a note and the run lands normally. */
  onFailure(message: string, fatal: boolean): void;
  /** Grades an "explain it" answer while play is paused. Without it the pause never happens. */
  gradeExplain?: (answer: string, signal: AbortSignal) => Promise<RecessExplainLevel>;
}

const percent = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const chargeTone = (value: number) => value <= 0 ? "empty" : value < 0.25 ? "low" : "ok";

function words(text: string) {
  return text.split(/(\s+)/).map((word, index) => /\S/.test(word) ? <span className="w" key={index}>{word}</span> : word);
}

function practiceWords(text: string) {
  return text.split(/(\{(?:spin|worm|myth):[^}]+\})/).map((part, index) => {
    const marked = /^\{(spin|worm|myth):([^}]+)\}$/.exec(part);
    return marked ? <span className="term" data-foe={marked[1]} key={index}>{words(marked[2])}</span>
      : <Fragment key={index}>{words(part)}</Fragment>;
  });
}

/** The lesson drawn in the chat's own classes, so the words that lift off are the ones the learner just read. */
export const RecessLessonPage = memo(function RecessLessonPage({ pack, lesson }: { pack: RecessPack | null; lesson?: readonly RecessLessonTurn[] }) {
  if (lesson?.length) return lesson.map((row, index) => row.role === "learner"
    ? <div className="recess-turn recess-turn--you" key={index}><div className="you-bubble"><RecessLessonMarkdown text={row.text} /></div></div>
    : <div className="recess-turn" key={index}><div className="k-prose ch-reading"><RecessLessonMarkdown text={row.text} /></div></div>);
  return pack?.thread?.map((row, index) => {
    if ("me" in row) return <div className="recess-turn recess-turn--you" key={index}><div className="you-bubble"><p>{practiceWords(row.me)}</p></div></div>;
    if ("code" in row) return <div className="recess-turn" key={index}><pre className="recess-code">{practiceWords(row.code)}</pre></div>;
    return <div className="recess-turn" key={index}><div className="k-prose ch-reading"><p>{practiceWords(row.k)}</p></div></div>;
  }) ?? null;
});

/** The HUD changes up to fifteen times a second; only the parts that show it subscribe, never the lesson. */
type HudStore = { get(): RecessHud; set(value: RecessHud): void; subscribe(listener: () => void): () => void };
function createHudStore(initial: RecessHud): HudStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) { value = next; for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
function useHud<T>(store: HudStore, pick: (hud: RecessHud) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}

export type RecessIconName =
  | "launch"
  | "replay"
  | "stop"
  | "eureka"
  | "chat"
  | "gear"
  | "close"
  | "check"
  | "miss"
  | "partial"
  | "cite"
  | "quiz"
  | "lessons"
  | "chev";

const GLYPH_MAP: Record<RecessIconName, GlyphName> = {
  launch: "play",
  replay: "refresh",
  stop: "stop",
  eureka: "spark",
  chat: "message",
  gear: "gear",
  close: "x",
  check: "check",
  miss: "x",
  partial: "minus",
  cite: "quote",
  quiz: "quiz",
  lessons: "layers",
  chev: "chev",
};

export function RecessIcon({ name, size = 14 }: { name: RecessIconName; size?: number }) {
  return <KeatingGlyph name={GLYPH_MAP[name]} size={size}
    className={name === "launch" ? "recess-icon recess-icon--play" : "recess-icon"} />;
}

function Hud({ store }: { store: HudStore }) {
  const hud = useHud(store, value => value);
  return <div className="recess-hud" aria-hidden="true">
    <span className="recess-hearts">
      {Array.from({ length: 4 }, (_, index) => <svg key={index} data-empty={index >= hud.hearts} viewBox="0 0 14 12"><path d="M2 0h4v2h2V0h4v2h2v4h-2v2h-2v2H8v2H6v-2H4V8H2V6H0V2h2z"/></svg>)}
    </span>
    <span className="recess-energy">
      {Array.from({ length: 3 }, (_, index) => <svg key={index} data-empty={index >= hud.bombs} viewBox="0 0 24 24"><path d="M7 3h10v9h-3v4h-4v-4H7z"/><path d="M9 20h6" fill="none"/></svg>)}
    </span>
    <span className="recess-meter"><i style={{ width: `${Math.min(100, Math.round(hud.meter * 100))}%` }} /></span>
    <span className="recess-boss" data-visible={hud.boss >= 0}><i style={{ transform: `scaleX(${Math.max(0, hud.boss)})` }} /></span>
    <span className="recess-charge" data-tone={chargeTone(hud.charge)}>
      <b>Charge</b><span className="recess-charge-bar"><i style={{ width: percent(hud.charge) }} /></span><em>{percent(hud.charge)}</em>
    </span>
    <span className="recess-power">
      {Array.from({ length: 4 }, (_, index) => <i key={index} data-empty={index >= hud.power}/>)}
    </span>
    {hud.weapon && <span className="recess-hud-kit" data-temp={hud.weaponTemp ? "true" : undefined}>
      {WEAPON_LABELS[hud.weapon] ?? hud.weapon}
      {(hud.helpers ?? 0) > 0 && <> · {hud.helpers}×</>}
    </span>}
    {hud.mult > 1 && <strong className="recess-mult" style={{ "--combo": hud.combo } as CSSProperties}>×{hud.mult}</strong>}
    <output>{hud.score.toLocaleString()}</output>
  </div>;
}

function WindQuestion({ wind, answer, stop }: { wind: RecessWind; answer(index: number): void; stop(): void }) {
  const first = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = useRef(false);
  const submitted = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expires = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [remaining, setRemaining] = useState(wind.seconds);

  function resolve(index: number) {
    if (selected.current) return;
    selected.current = true;
    clearTimeout(expires.current);
    setPicked(index);
    submitted.current = setTimeout(() => answer(index), wind.answers[index]?.ok ? 450 : 1050);
  }

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    return () => clearTimeout(submitted.current);
  }, []);

  useEffect(() => {
    if (!wind.seconds) return;
    const deadline = performance.now() + wind.seconds * 1000;
    expires.current = setTimeout(() => resolve(-1), wind.seconds * 1000);
    const tick = setInterval(() => setRemaining(Math.max(0, (deadline - performance.now()) / 1000)), 120);
    return () => { clearTimeout(expires.current); clearInterval(tick); };
  }, [wind]);

  return <section className="recess-wind" aria-label="Second Wind" onKeyDown={event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stop();
    } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= wind.answers.length) {
      event.preventDefault();
      resolve(Number(event.key) - 1);
    }
  }}>
    <small>Second Wind</small>
    <strong><RecessInlineMarkdown text={wind.q} /></strong>
    <div className="recess-answers">
      {wind.answers.map((choice, index) => <button type="button" key={index} ref={index === 0 ? first : undefined}
        disabled={picked !== null} data-answer={picked !== null && choice.ok ? "correct" : picked === index ? "incorrect" : undefined}
        onClick={() => resolve(index)}>
        <span className="recess-answer-index" aria-hidden="true">{index + 1}</span>
        <span className="recess-answer-text"><RecessInlineMarkdown text={choice.t} /></span>
      </button>)}
    </div>
    {wind.seconds > 0 && <progress className="recess-clock" max={wind.seconds} value={remaining} aria-label="Time to answer" />}
  </section>;
}

/** A word over the gate so the kind of problem reads before the choices do. */
const KIND_LABELS: Partial<Record<RecessQuestionKind, string>> = {
  truefalse: "True or false?", why: "Why?", example: "Pick the example", order: "What comes next?", meaning: "What does it mean?",
  oddone: "Odd one out", compare: "Tell them apart", formula: "Complete it", correction: "Fix the mistake", apply: "Try it",
  swap: "Which did Keating say?", name: "Name the idea", cloze: "Fill the gap",
};
/** Read out the choices by the number that answers them: numbers are true for lanes and targets alike, positions are not. */
function gateHint(options: readonly string[], targets: boolean) {
  const choices = options.map((option, index) => `${index + 1}, ${recessPlainText(option)}`).join("; ");
  return `${targets ? "Shoot the one that doesn’t belong, or press its number." : "Fly through a lane, or press its number."} ${choices}.`;
}

const EXPLAIN_FEEDBACK: Record<RecessExplainLevel, string> = {
  sound: "Spot on.",
  partial: "Part of it. Here is how Keating put it:",
  missed: "Not quite. Here is how Keating put it:",
};

/** The "explain it" pause: one open question, typed, graded while the world is frozen. Never timed. */
function ExplainPause({ item, grade, done, stop }: {
  item: RecessExplainItem; grade: (answer: string, signal: AbortSignal) => Promise<RecessExplainLevel>;
  done(level: RecessExplainLevel, answer: string): void; stop(): void;
}) {
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<{ phase: "write" } | { phase: "reading" } | { phase: "graded"; level: RecessExplainLevel }>({ phase: "write" });
  const field = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); return () => abort.current?.abort(); }, []);
  useEffect(() => { if (state.phase === "graded") back.current?.focus({ preventScroll: true }); }, [state.phase]);

  async function submit() {
    if (state.phase !== "write") return;
    if (!answer.trim()) { done("missed", ""); return; }
    setState({ phase: "reading" });
    abort.current = new AbortController();
    const level = await grade(answer, abort.current.signal).catch(() => "partial" as const);
    if (!abort.current.signal.aborted) setState({ phase: "graded", level });
  }

  return <section className="recess-wind recess-explain" aria-label="Explain it" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && state.phase === "write") { event.preventDefault(); void submit(); }
  }}>
    <small>Explain it</small>
    <strong><RecessInlineMarkdown text={item.prompt} /></strong>
    {state.phase !== "graded" ? <>
      <p className="recess-explain-hint" id="recess-explain-hint">Write a short sentence in your own words.</p>
      <textarea ref={field} value={answer} maxLength={400} rows={3} disabled={state.phase === "reading"}
        aria-label="Your explanation" aria-describedby="recess-explain-hint" placeholder="Explain why…"
        onChange={event => setAnswer(event.target.value)} />
      <div className="recess-explain-actions">
        <button type="button" className="recess-key" data-primary="true" data-glyph-host disabled={state.phase === "reading"} onClick={() => void submit()}>
          <RecessIcon name="check" size={14} />{state.phase === "reading" ? "Keating is reading…" : "Check answer"}
        </button>
        <button type="button" className="recess-link" disabled={state.phase === "reading"} onClick={() => done("missed", "")}>Skip</button>
      </div>
    </> : <div className="recess-explain-result" data-level={state.level} role="status">
      <p className="recess-explain-verdict">
        <span className="recess-log-mark" data-state={state.level === "sound" ? "ok" : state.level === "partial" ? "partial" : "miss"} aria-hidden="true">
          <RecessIcon name={state.level === "sound" ? "check" : state.level === "partial" ? "partial" : "miss"} size={12} />
        </span>
        {EXPLAIN_FEEDBACK[state.level]}
      </p>
      {state.level !== "sound" && <blockquote><RecessInlineMarkdown text={item.reference} /></blockquote>}
      <button type="button" ref={back} className="recess-key" data-primary="true" data-glyph-host onClick={() => done(state.level, answer)}>
        <RecessIcon name="launch" size={14} />Resume flight
      </button>
    </div>}
  </section>;
}

const initialHud: RecessHud = { hearts: 4, bombs: 2, score: 0, mult: 1, combo: 0, power: 1, charge: 0.75, meter: 0, boss: -1 };

/** One run, laid over the chat thread. Mounting starts the run; ending it calls onEnd and the parent unmounts it. */
export function RecessFlight({ pack, lesson, assets, condition, loadout, settings, host, column, dark, onEnd, onAbandon, onFailure, gradeExplain }: Props) {
  const [status, setStatus] = useState<"play" | "outro">("play");
  const [inBossScene, setInBossScene] = useState(false);
  const [minibossNotice, setMinibossNotice] = useState("");
  const hudStore = useMemo(() => createHudStore({ ...initialHud, bombs: condition.shine >= 0.9 ? 3 : 2, charge: condition.charge }), []);
  const bombs = useHud(hudStore, value => value.bombs);
  // The canvas draws text as it is: hand it plain words, keep Markdown and maths for the DOM.
  const enginePack = useMemo<RecessPack>(() => ({
    ...pack,
    tldr: recessPlainText(pack.tldr),
    // The pause only exists when something can grade it.
    explain: gradeExplain ? pack.explain : undefined,
    wall: pack.wall.map(recessPlainText),
    myths: pack.myths.map(myth => ({ wrong: recessPlainText(myth.wrong), right: recessPlainText(myth.right) })),
  }), [pack]);
  const [gate, setGate] = useState<{ question: string; options: string[]; kind?: string } | null>(null);
  const [wind, setWind] = useState<{ question: RecessWind; answer(index: number): void } | null>(null);
  const [explain, setExplain] = useState<{ item: RecessExplainItem; done(level: RecessExplainLevel, answer: string): void } | null>(null);
  const arena = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const bot = useRef<HTMLImageElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const shader = useRef<HTMLCanvasElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const targets = useRef<HTMLDivElement>(null);
  const cinema = useRef<HTMLElement>(null);
  const engine = useRef<ReturnType<typeof Recess.create> | null>(null);
  const audio = useRef<ReturnType<typeof RecessAudio.create> | null>(null);
  const nextHud = useRef(0);
  // A flight keeps running as callbacks and the live motion preference change.
  const latest = useRef({ onEnd, onAbandon, onFailure, gradeExplain, calm: settings.calm });
  latest.current = { onEnd, onAbandon, onFailure, gradeExplain, calm: settings.calm };

  useLayoutEffect(() => {
    if (!arena.current || !thread.current || !dock.current || !bot.current || !view.current || !cinema.current) return;
    const playfield = arena.current;
    const sound = RecessAudio.create();
    let resize: ResizeObserver | null = null;
    let game: ReturnType<typeof Recess.create> | null = null;
    let ended = false;
    let mounted = true;
    const showScene = createBossSceneView(cinema.current, assets, {
      advance: () => game?.advanceBossScene(), skip: () => game?.skipBossScene(),
      returnFocus: () => playfield.focus({ preventScroll: true }),
    });
    try {
      sound.set(settings.sound);
      sound.unlock();
      game = Recess.create({
        ...assets,
        arena: playfield, thread: thread.current, dock: dock.current, bot: bot.current,
        view: view.current, shader: shader.current, gateLayer: lanes.current, targetLayer: targets.current, theme: dark ? "term" : "paper",
        sound, pack: enginePack, calm: settings.calm, control: settings.control, loadout, bombKind: settings.bombKind,
        bossScene: settings.bossScenes === false ? undefined : beat => {
          if (!mounted) return;
          showScene(beat, latest.current.calm);
          setInBossScene(Boolean(beat));
        },
        hud: update => {
          const now = performance.now();
          if (now < nextHud.current) return;
          nextHud.current = now + 65;
          hudStore.set(update);
        },
        ask: setGate,
        minibossNotice: setMinibossNotice,
        phase: value => setStatus(value === "outro" ? "outro" : "play"),
        revive: (question, answer) => setWind(question && answer ? {
          question, answer: index => {
            answer(index);
            setWind(null);
            playfield.focus({ preventScroll: true });
          },
        } : null),
        explain: (item, done) => setExplain(item && done ? {
          item, done: (level, answer) => { done(level, answer); setExplain(null); playfield.focus({ preventScroll: true }); },
        } : null),
        end: result => {
          ended = true;
          latest.current.onEnd(result);
        },
      });
      engine.current = game;
      audio.current = sound;
      game.setCondition(condition);
      game.start("start");
      playfield.focus({ preventScroll: true });
      if (typeof ResizeObserver !== "undefined") {
        const original = playfield.getBoundingClientRect();
        resize = new ResizeObserver(() => {
          if (!game || game.state === "outro" || game.state === "idle") return;
          const next = playfield.getBoundingClientRect();
          // A phone's address bar growing or shrinking changes the height a little: keep flying. A rotation or a pane resize lands him.
          if (Math.abs(next.width - original.width) < 3 && Math.abs(next.height - original.height) < Math.max(3, original.height * 0.15)) return;
          latest.current.onFailure("The chat changed size mid-flight, so Keating landed. Start again when you’re ready.", false);
          game.stop();
        });
        resize.observe(playfield);
      }
    } catch {
      game?.dispose();
      sound.dispose();
      engine.current = null;
      ended = true;
      queueMicrotask(() => latest.current.onFailure("Recess could not open on this device. You can try again.", true));
    }
    return () => {
      mounted = false;
      resize?.disconnect();
      engine.current = null;
      // Closing or switching chats mid-run never reaches onEnd: settle spent charge once, then dispose.
      if (game && !ended && game.state !== "idle" && game.chargeDelta < 0) latest.current.onAbandon?.(game.chargeDelta);
      game?.dispose();
      audio.current = null;
    };
    // A run is fixed at launch; settings changes apply to the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The chat behind the flight is covered: make it inert so Tab and screen readers stay with the game.
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const own = stage.current;
    const covered = [...host.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== own && !child.inert);
    for (const child of covered) child.inert = true;
    return () => { for (const child of covered) child.inert = false; };
  }, [host]);

  useEffect(() => { engine.current?.setCalm(settings.calm); }, [settings.calm]);
  useEffect(() => { audio.current?.set(settings.sound); }, [settings.sound]);

  const columnStyle: Record<string, string> = column ? { "--recess-col-left": `${column.left}px`, "--recess-col-width": `${column.width}px` } : {};
  return createPortal(<div ref={stage} className="recess-root recess-chat-stage" data-theme={dark ? "term" : "paper"} data-phase={status} data-calm={settings.calm}
    style={{ "--lesson-opacity": settings.opacity / 100, ...columnStyle } as CSSProperties}>
    {/* data-cursor: the pointer pixel stands down over the game; the crosshair is enough. */}
    <div ref={arena} className="recess-field" tabIndex={0} data-cursor="hide" aria-label={`Recess flight over ${recessPlainText(pack.title)}`}>
      <div ref={thread} className="recess-page" aria-hidden="true"><RecessLessonPage pack={pack} lesson={lesson} /></div>
      <canvas ref={view} className="recess-canvas" aria-hidden="true"/>
      <canvas ref={shader} className="recess-canvas" aria-hidden="true" hidden />
      {status === "play" && <Hud store={hudStore}/>}
      <span className="recess-sr" role="status" aria-atomic="true">{minibossNotice}</span>
      <section ref={cinema} className="recess-cinema" data-calm={settings.calm} hidden/>
      {gate && <div className="recess-gate" role="status" data-kind={gate.kind}>
        {gate.kind && KIND_LABELS[gate.kind as RecessQuestionKind] && <small className="recess-gate-kind">{KIND_LABELS[gate.kind as RecessQuestionKind]}</small>}
        <strong><RecessInlineMarkdown text={gate.question} /></strong>
        <span className="recess-sr">{gateHint(gate.options, gate.kind === "oddone")}</span>
        {/* The same choices as buttons: answering never depends on aim, charge or flying. */}
        <span className="recess-gate-keys" onPointerDown={event => event.stopPropagation()}>
          {gate.options.map((option, index) => <button type="button" key={index} aria-label={`Answer ${index + 1}: ${recessPlainText(option)}`}
            onClick={() => { engine.current?.answerGate(index); arena.current?.focus({ preventScroll: true }); }}>{index + 1}</button>)}
        </span>
      </div>}
      {/* Always mounted: the engine binds these layers when the run starts. */}
      <div ref={lanes} className="recess-gate-lanes" aria-hidden="true" hidden={!gate || gate.kind === "oddone"} style={{ "--lanes": gate?.options.length ?? 3 } as CSSProperties}>
        {gate && gate.kind !== "oddone" && gate.options.map((option, index) => <span key={index} data-lane={index}><b className="recess-choice-n">{index + 1}</b><RecessInlineMarkdown text={option} /></span>)}
      </div>
      <div ref={targets} className="recess-gate-targets" aria-hidden="true" hidden={gate?.kind !== "oddone"}>
        {gate?.kind === "oddone" && gate.options.map((option, index) => <span key={index} data-target={index}><b className="recess-choice-n">{index + 1}</b><RecessInlineMarkdown text={option} /></span>)}
      </div>
      {wind && <WindQuestion wind={wind.question} answer={wind.answer} stop={() => engine.current?.stop()}/>}
      {explain && <ExplainPause item={explain.item} done={explain.done} stop={() => engine.current?.stop()}
        grade={(answer, signal) => latest.current.gradeExplain?.(answer, signal) ?? Promise.resolve("partial")} />}
      <div ref={dock} className="recess-dock">
        <img src={sittingBot} alt="" ref={bot} draggable={false} />
        <div className="recess-flight-bar">
          <button type="button" className="recess-key recess-eureka" data-glyph-host title={RECESS_BOMBS[settings.bombKind].effect} disabled={status !== "play" || inBossScene || Boolean(wind || explain) || bombs === 0}
            aria-keyshortcuts="Space" onClick={() => { engine.current?.bomb(); arena.current?.focus({ preventScroll: true }); }}>
            <RecessIcon name="eureka" size={15}/>{RECESS_BOMBS[settings.bombKind].name}<span className="recess-pips" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <i key={index} data-empty={index >= bombs}/>)}</span>
            <kbd className="recess-keycap" aria-hidden="true">Space</kbd>
          </button>
          <button type="button" className="recess-key recess-stop" data-glyph-host disabled={status === "outro"} aria-keyshortcuts="Escape"
            onClick={() => engine.current?.stop()}>
            <RecessIcon name="stop" size={14}/>{status === "outro" ? "Landing…" : "Land"}<kbd className="recess-keycap" aria-hidden="true">Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>, host);
}
