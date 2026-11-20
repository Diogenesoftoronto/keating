import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useMotionAllowed } from "../../design-system/motion";
import { HABIT_KIT } from "../../keating/habits/quest-catalog";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { recessReviewDraft } from "../../keating/habits/recess-review";
import { loadRecessArt, sittingBot } from "./assets";
import { RecessAudio } from "./engine/audio.js";
import { Recess } from "./engine/core.js";
import { packs } from "./engine/packs.js";
import type { RecessBotArt, RecessCondition, RecessControl, RecessHud, RecessLessonTurn, RecessPack, RecessResult, RecessWind } from "./types";
import "./recess.css";

export type { RecessPack } from "./types";

interface Props {
  lesson: readonly RecessLessonTurn[];
  condition: RecessCondition;
  kit?: readonly string[];
  onEnd(result: RecessResult): void;
  onQuiz(draft: string): void;
  compilePack?: (signal: AbortSignal, base: RecessPack) => Promise<RecessPack | null>;
}

const options = Object.values(packs);
const initialHud: RecessHud = { hearts: 4, bombs: 2, score: 0, mult: 1, combo: 0, power: 1, meter: 0, boss: -1 };

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

function LessonPage({ pack, lesson }: { pack: RecessPack; lesson?: readonly RecessLessonTurn[] }) {
  if (lesson?.length) return lesson.map((row, index) => (
    <p className={row.role === "learner" ? "recess-you" : "recess-prose"} key={index}>{words(row.text)}</p>
  ));
  return pack.thread?.map((row, index) => {
    if ("me" in row) return <p className="recess-you" key={index}>{practiceWords(row.me)}</p>;
    if ("code" in row) return <pre className="recess-code" key={index}>{practiceWords(row.code)}</pre>;
    return <p className="recess-prose" key={index}>{practiceWords(row.k)}</p>;
  });
}

function Icon({ name }: { name: "launch" | "stop" | "eureka" | "chat" | "gear" }) {
  const paths = {
    launch: "M7 1h2v2h2v6h2v4h-3v2H6v-2H3V9h2V3h2zM7 5v2h2V5z",
    stop: "M3 3h10v10H3z",
    eureka: "M5 1h6v2h2v5h-2v2h-1v2H6v-2H5V8H3V3h2zM6 13h4v2H6z",
    chat: "M1 2h14v9H8l-4 3v-3H1z",
    gear: "M7 0h2v2h2l1-1 2 2-1 1v2h2v2h-2v2l1 1-2 2-1-1h-2v2H7v-2H5l-1 1-2-2 1-1V9H1V7h2V5L2 4l2-2 1 1h2zM7 6v4h2V6z",
  };
  return <svg className="recess-icon" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges"><path d={paths[name]} fillRule="evenodd"/></svg>;
}

function Hud({ hud }: { hud: RecessHud }) {
  return <div className="recess-hud" aria-hidden="true">
    <span className="recess-hearts">
      {Array.from({ length: 4 }, (_, index) => <svg key={index} data-empty={index >= hud.hearts} viewBox="0 0 14 12"><path d="M2 0h4v2h2V0h4v2h2v4h-2v2h-2v2H8v2H6v-2H4V8H2V6H0V2h2z"/></svg>)}
    </span>
    <span className="recess-energy">
      {Array.from({ length: 3 }, (_, index) => <svg key={index} data-empty={index >= hud.bombs} viewBox="0 0 24 24"><path d="M7 3h10v9h-3v4h-4v-4H7z"/><path d="M9 20h6" fill="none"/></svg>)}
    </span>
    <span className="recess-meter"><i style={{ width: `${Math.min(100, Math.round(hud.meter * 100))}%` }} /></span>
    <span className="recess-boss" data-visible={hud.boss >= 0}><i style={{ transform: `scaleX(${Math.max(0, hud.boss)})` }} /></span>
    <span className="recess-power">
      {Array.from({ length: 4 }, (_, index) => <i key={index} data-empty={index >= hud.power}/>)}
    </span>
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
    } else if (["1", "2", "3"].includes(event.key)) {
      event.preventDefault();
      resolve(Number(event.key) - 1);
    }
  }}>
    <small>Second Wind</small>
    <strong>{wind.q}</strong>
    <div className="recess-answers">
      {wind.answers.map((choice, index) => <button type="button" key={index} ref={index === 0 ? first : undefined}
        disabled={picked !== null} data-answer={picked !== null && choice.ok ? "correct" : picked === index ? "incorrect" : undefined}
        onClick={() => resolve(index)}><span aria-hidden="true">{index + 1}</span>{choice.t}</button>)}
    </div>
    {wind.seconds > 0 && <progress className="recess-clock" max={wind.seconds} value={remaining} aria-label="Time to answer" />}
  </section>;
}

function RunResult({ result, onQuiz }: { result: RecessResult; onQuiz(draft: string): void }) {
  const headline = result.won ? "Wall cleared" : result.quit ? "Stopped early" : "Out of hearts";
  const draft = recessReviewDraft(result);
  return <section className="recess-result" aria-label="Recess result" data-outcome={result.won ? "won" : result.quit ? "quit" : "lost"}>
    <small className="recess-kicker">Flight log</small>
    <div className="recess-result-heading">
      <h3>{headline}</h3><strong>{result.score.toLocaleString()} <small>points</small></strong>
    </div>
    <p>{result.kills} cleared · {result.grazes} close calls · {result.rattled} words rattled</p>
    <ul>
      {result.myths.map((myth, index) => <li key={`m-${index}`}><s>{myth.wrong}</s> <strong>{myth.right}</strong></li>)}
      {[...result.gates, ...(result.wind ? [result.wind] : [])].map((check, index) => <li key={`q-${index}`}>
        <span aria-hidden="true" data-correct={check.ok}>{check.ok ? "✓" : "×"}</span> {check.q} <strong>{check.right}</strong>
      </li>)}
    </ul>
    {result.tldr && <p className="recess-takeaway">{result.tldr}</p>}
    {draft ? <button type="button" className="recess-key" onClick={() => onQuiz(draft)}>
      {result.gates.some(check => !check.ok) || (result.wind && !result.wind.ok) ? "Quiz me on what I missed" : "Quiz me on these"}
    </button> : null}
  </section>;
}

export function RecessGame({ lesson, condition, kit = [], onEnd, onQuiz, compilePack }: Props) {
  const [settings] = useKeatingUiSettings();
  const motionAllowed = useMotionAllowed();
  const [sound, setSound] = useState(false);
  const [skin, setSkin] = useState<"toy" | "ink">("toy");
  const [control, setControl] = useState<RecessControl>("follow");
  const [calmChoice, setCalmChoice] = useState(false);
  const calm = calmChoice || !settings.visualEffects || !motionAllowed;
  const [opacity, setOpacity] = useState(36);
  const [subject, setSubject] = useState("maths");
  const base = packs[subject];
  const [personal, setPersonal] = useState<{ pack: RecessPack; lesson: RecessLessonTurn[] } | null>(null);
  const pack = personal?.pack ?? base;
  const [compileStatus, setCompileStatus] = useState<"idle" | "compiling" | "unavailable">("idle");
  const [status, setStatus] = useState<"idle" | "play" | "outro">("idle");
  const [result, setResult] = useState<RecessResult | null>(null);
  const [failure, setFailure] = useState("");
  const [hud, setHud] = useState(initialHud);
  const [gate, setGate] = useState<{ question: string; options: string[] } | null>(null);
  const [wind, setWind] = useState<{ question: RecessWind; answer(index: number): void } | null>(null);
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const arena = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const bot = useRef<HTMLImageElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const shader = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof Recess.create> | null>(null);
  const soundEngine = useRef<ReturnType<typeof RecessAudio.create> | null>(null);
  const compile = useRef<AbortController | null>(null);
  const resize = useRef<ResizeObserver | null>(null);
  const nextHud = useRef(0);
  const returnFocus = useRef(0);
  const startControl = useRef<HTMLButtonElement>(null);
  const [art, setArt] = useState<{ key: string; assets: RecessBotArt | null } | null>(null);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const casting = pack.cast ?? pack.id;
  const wornKey = kit.join(",");
  const assetsKey = `${skin}/${casting}/${wornKey}`;
  const wornNames = kit.flatMap(id => HABIT_KIT.find(item => item.id === id)?.name ?? []);
  const prepared = art?.key === assetsKey ? art : null;
  const inFlight = status !== "idle";
  const compiling = compileStatus === "compiling";

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    loadRecessArt(casting, skin === "toy", wornKey.split(",")).then(
      assets => { if (active) setArt({ key: assetsKey, assets }); },
      () => { if (active) setArt({ key: assetsKey, assets: null }); },
    );
    return () => { active = false; };
  }, [assetsKey, casting, skin, wornKey]);

  useEffect(() => () => {
    compile.current?.abort();
    resize.current?.disconnect();
    engine.current?.dispose();
    cancelAnimationFrame(returnFocus.current);
  }, []);

  useEffect(() => { engine.current?.setCalm(calm); }, [calm]);

  async function prepareLesson() {
    if (!compilePack || compile.current || !lesson.some(item => item.role === "tutor")) return;
    const abort = new AbortController();
    compile.current = abort;
    setCompileStatus("compiling");
    const excerpt = lesson.slice(-8).map(item => ({ role: item.role, text: item.text.slice(-760) }));
    try {
      const custom = await compilePack(abort.signal, base);
      if (abort.signal.aborted) return;
      if (!custom) { setCompileStatus("unavailable"); return; }
      setPersonal({ pack: custom, lesson: excerpt });
      setCompileStatus("idle");
    } catch {
      if (!abort.signal.aborted) setCompileStatus("unavailable");
    } finally {
      if (compile.current === abort) compile.current = null;
    }
  }

  function finish(last: RecessResult) {
    resize.current?.disconnect();
    engine.current?.dispose();
    engine.current = null;
    soundEngine.current = null;
    // A WebGL canvas cannot obtain a second context immediately after disposal.
    setCanvasGeneration(current => current + 1);
    setGate(null);
    setWind(null);
    setStatus("idle");
    setResult(last);
    returnFocus.current = requestAnimationFrame(() => startControl.current?.focus({ preventScroll: true }));
    onEnd(last);
  }

  function start() {
    if (engine.current || !prepared?.assets || !arena.current || !thread.current || !dock.current || !bot.current || !view.current) return;
    const playfield = arena.current;
    const audio = RecessAudio.create();
    try {
      audio.set(sound);
      audio.unlock();
      // Apply the in-flight layout before the engine measures the arena.
      flushSync(() => {
        setFailure("");
        setResult(null);
        setHud({ ...initialHud, bombs: condition.shine >= 0.9 ? 3 : 2 });
        setStatus("play");
      });
      const game = Recess.create({
        ...prepared.assets,
        arena: playfield, thread: thread.current, dock: dock.current, bot: bot.current,
        view: view.current, shader: shader.current, theme: dark ? "term" : "paper",
        sound: audio, pack, calm, control,
        hud: update => {
          const now = performance.now();
          if (now < nextHud.current) return;
          nextHud.current = now + 65;
          setHud(update);
        },
        ask: setGate,
        phase: setStatus,
        revive: (question, answer) => setWind(question && answer ? {
          question, answer: index => {
            answer(index);
            setWind(null);
            playfield.focus({ preventScroll: true });
          },
        } : null),
        end: finish,
      });
      engine.current = game;
      soundEngine.current = audio;
      game.setCondition(condition);
      game.start("start");
      playfield.focus({ preventScroll: true });
      if (typeof ResizeObserver !== "undefined") {
        const original = playfield.getBoundingClientRect();
        resize.current = new ResizeObserver(() => {
          if (game.state === "outro" || game.state === "idle") return;
          const next = playfield.getBoundingClientRect();
          if (Math.abs(next.width - original.width) < 3 && Math.abs(next.height - original.height) < 3) return;
          setFailure("The play area changed size. Start a new run when you’re ready.");
          game.stop();
        });
        resize.current.observe(playfield);
      }
    } catch {
      engine.current?.dispose();
      engine.current = null;
      audio.dispose();
      soundEngine.current = null;
      setStatus("idle");
      setCanvasGeneration(current => current + 1);
      setFailure("Recess could not open on this device. You can try again.");
    }
  }

  return <div className="recess-game" data-theme={dark ? "term" : "paper"} data-phase={status} data-calm={calm}>
    <div className="recess-toolbar">
      <div className="recess-plan">
        <small className="recess-kicker">Flight plan</small>
        <label className="recess-lesson"><span>Practice lesson</span>
          <select value={subject} disabled={inFlight || compiling} onChange={event => {
            setSubject(event.target.value); setPersonal(null); setCompileStatus("idle"); setResult(null); setFailure("");
          }}>
            {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        {compilePack && lesson.some(row => row.role === "tutor") && <button type="button" className="recess-chat"
          aria-pressed={!!personal} disabled={inFlight || compiling || !!personal} onClick={() => void prepareLesson()}>
          <Icon name="chat"/>{compiling ? "Preparing lesson…" : personal ? "Playing from your lesson" : "Use this chat lesson"}
        </button>}
      </div>
      <div className="recess-controls">
        <button type="button" className="recess-start recess-key" ref={startControl} data-flight={inFlight}
          disabled={status === "outro" || (!inFlight && (!prepared?.assets || compiling))}
          onClick={() => inFlight ? engine.current?.stop() : start()}>
          <Icon name={inFlight ? "stop" : "launch"}/>
          {inFlight ? (status === "outro" ? "Landing…" : "Stop run") : !prepared ? "Loading artwork…" : result ? "Play again" : "Start Recess"}
        </button>
        {inFlight && <button type="button" className="recess-eureka recess-key" disabled={status !== "play" || Boolean(wind) || hud.bombs === 0}
          data-live-action="" aria-keyshortcuts="Space" onClick={() => { engine.current?.bomb(); arena.current?.focus({ preventScroll: true }); }}>
          <Icon name="eureka"/>Eureka<span className="recess-count"> · {hud.bombs}</span>
          <span className="recess-pips" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <i key={index} data-empty={index >= hud.bombs}/>)}</span>
        </button>}
      </div>
    </div>
    <details className="recess-settings">
      <summary><Icon name="gear"/>Flight settings</summary>
      <div className="recess-options">
        <label>Controls
          <select value={control} disabled={inFlight} onChange={event => setControl(event.target.value as RecessControl)}>
            <option value="follow">Pointer or movement keys</option>
            <option value="twin">Keys fly, pointer aims</option>
            <option value="thrust">Thrust and gravity</option>
          </select>
        </label>
        <label>Artwork
          <select value={skin} disabled={inFlight} onChange={event => setSkin(event.target.value as "toy" | "ink")}>
            <option value="toy">Toys</option><option value="ink">Ink</option>
          </select>
        </label>
        <label className="recess-range">Lesson behind <input type="range" min={8} max={70} step={2} value={opacity} onChange={event => setOpacity(Number(event.target.value))}/></label>
        <label className="recess-check"><input type="checkbox" checked={calm} disabled={inFlight || !settings.visualEffects || !motionAllowed} onChange={event => setCalmChoice(event.target.checked)} /> Calm effects</label>
        <label className="recess-check"><input type="checkbox" checked={sound} onChange={event => {
          setSound(event.target.checked);
          soundEngine.current?.set(event.target.checked);
        }} /> Sound</label>
      </div>
    </details>
    {compileStatus === "unavailable" && <p className="recess-note" role="status">A lesson pack wasn’t available. You can still play the practice lesson.</p>}
    {failure && <p className="recess-note" role="status">{failure}</p>}
    {prepared && !prepared.assets && <p className="recess-note" role="status">Recess artwork didn’t load. Choose another lesson to retry.</p>}
    <div className="recess-stage" style={{ "--lesson-opacity": opacity / 100 } as CSSProperties}>
      <header className="recess-stage-heading">
        <strong>{pack.title}</strong><span>{personal ? "From your chat" : pack.label}</span>
      </header>
      <div ref={arena} className="recess-field" tabIndex={inFlight ? 0 : -1} aria-label="Recess flight area">
        <div ref={thread} className="recess-page" aria-hidden="true"><LessonPage pack={pack} lesson={personal?.lesson} /></div>
        <div ref={dock} className="recess-dock" aria-hidden="true">
          <img src={sittingBot} alt="" ref={bot} draggable={false} />
          <span>{inFlight ? "In flight" : "Launch pad"}</span>
        </div>
        <canvas ref={view} className="recess-canvas" aria-hidden="true"/>
        <canvas key={canvasGeneration} ref={shader} className="recess-canvas" aria-hidden="true" hidden />
        {inFlight && status !== "outro" && <Hud hud={hud}/>}
        {gate && <div className="recess-gate" role="status">
          <strong>{gate.question}</strong>
          <span>Fly left for {gate.options[0]}, middle for {gate.options[1]}, or right for {gate.options[2]}.</span>
        </div>}
        {wind && <WindQuestion wind={wind.question} answer={wind.answer} stop={() => engine.current?.stop()}/>}
      </div>
    </div>
    <p className="recess-note recess-help">
      <span className="recess-help-fine">Move or drag to fly. Arrow keys or WASD also move Keating. Hold Shift to focus, Space for Eureka, and Escape to stop.</span>
      <span className="recess-help-touch">Drag anywhere on the page to fly. Keating fires on his own. Tap Eureka to clear the air.</span>
    </p>
    <p className="recess-note recess-condition">Charge {Math.round(condition.charge * 100)}% · Tuning {Math.round(condition.tune * 100)}% · Shine {Math.round(condition.shine * 100)}%
      {wornNames.length > 0 && ` · Wearing ${wornNames.join(", ")}`}
    </p>
    {result && <RunResult result={result} onQuiz={onQuiz}/>}
  </div>;
}
