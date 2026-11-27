import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { useMotionAllowed } from "../../design-system/motion";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { sessions } from "../../hooks/keating-storage";
import type { HabitsCommand, HabitsMode, HabitsSnapshot } from "../../keating/habits/contracts";
import { compileLessonPack } from "../../keating/habits/director";
import { habitLesson, lessonForPrompt, type HabitLesson } from "../../keating/habits/lesson";
import { packPictures, swapUnloadedPictures, unloadablePictures } from "../../keating/habits/recess-images";
import { HABIT_KIT, RECESS_HELPERS, RECESS_WEAPONS, resolveRecessLoadout, type RecessLoadout } from "../../keating/habits/quest-catalog";
import { buildChatRecessPack, recessPlainText, recessQuestionCandidates } from "../../keating/habits/recess-lesson";
import { curateRecessPack, type RecessCandidate } from "../../keating/habits/recess-curate";
import { gradeRecessExplain, recessExplainPrompt } from "../../keating/habits/recess-explain";
import { readRecessMastery, recordRecessKinds } from "../../keating/habits/recess-mastery";
import { judgeRecessReadiness, recessContinuePrompt, recessReadinessRules, type RecessNextMove, type RecessReadiness } from "../../keating/habits/recess-readiness";
import { recessReviewDraft } from "../../keating/habits/recess-review";
import { currentHabitsScope, dispatchHabits, readHabits, subscribeHabits } from "../../keating/habits/store";
import { RecessFlight, RecessIcon, type RecessFlightSettings } from "./RecessFlight";
import { RecessInlineMarkdown } from "./RecessLessonMarkdown";
import { KeatingGlyph } from "../../design-system/glyphs";
import { Select } from "../Select";
import { loadRecessArt } from "./assets";
import { RECESS_BOMBS, resolveBombKind } from "./engine/bombs.js";
import { RECESS_OPEN_SESSION_EVENT, RECESS_PENDING_KEY } from "./recess-events";
import { packs } from "./engine/packs.js";
import type { RecessBotArt, RecessCheckResult, RecessPack, RecessResult } from "./types";
import "./recess.css";


const standard = { charge: 0.75, tune: 0.75, shine: 0.75 };
const SETTINGS_KEY = "keating:recess-settings";
type SettingsTab = "loadout" | "controls" | "look";
/* On a narrow strip the settings show one section at a time, picked from a bottom bar. */
const SETTINGS_TABS: { id: SettingsTab; label: string; glyph: "target" | "hand" | "eye" }[] = [
  { id: "loadout", label: "Loadout", glyph: "target" },
  { id: "controls", label: "Controls", glyph: "hand" },
  { id: "look", label: "Look", glyph: "eye" },
];
const CONTROL_MODES: { id: RecessFlightSettings["control"]; label: string; help: string }[] = [
  { id: "follow", label: "Follow", help: "Move the pointer or drag to fly. Arrows or WASD work too." },
  { id: "twin", label: "Twin-stick", help: "Use arrows or WASD to fly and point to aim." },
  { id: "thrust", label: "Thrust", help: "Press, or hold an arrow, to burn toward the pointer. Gravity pulls you down and the floor bounces you back." },
];
const defaults: RecessFlightSettings = { control: "follow", skin: "toy", calm: false, sound: false, opacity: 36, bombKind: "eureka", bossScenes: true };
const demos = Object.values(packs);
const percent = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const chargeTone = (value: number) => value <= 0 ? "empty" : value < 0.25 ? "low" : "ok";

function loadSettings(): RecessFlightSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<RecessFlightSettings> | null;
    return saved && typeof saved === "object" ? { ...defaults, ...saved, bombKind: resolveBombKind(saved.bombKind) } : defaults;
  } catch { return defaults; }
}

export interface OtherChat { id: string; title: string; topic?: string }

/** Recent chats that already have enough taught in them to fly through. Local reads only. */
async function readyChats(current: string | undefined, signal: AbortSignal): Promise<OtherChat[]> {
  const list = (await sessions.getAllMetadata() as { id: string; title?: string; lastModified?: string; hiddenAlternative?: boolean }[])
    .filter(row => row.id !== current && !row.hiddenAlternative)
    .sort((a, b) => String(b.lastModified ?? "").localeCompare(String(a.lastModified ?? "")))
    .slice(0, 12);
  const found: OtherChat[] = [];
  for (const row of list) {
    if (signal.aborted || found.length === 3) break;
    const data = await sessions.loadSession(row.id) as { messages?: unknown[] } | null;
    const readiness = recessReadinessRules(habitLesson(data?.messages ?? []));
    if (readiness.level === "ready") found.push({ id: row.id, title: row.title?.trim() || readiness.topic || "Untitled chat", topic: readiness.topic });
  }
  return found;
}

type Choice = { kind: "chat" } | { kind: "demo"; id: string };
type RunEnd = Extract<HabitsCommand, { type: "runEnd" }>["result"];
/** Everything a run depends on, fixed at takeoff: later readiness, art, scope or condition changes reach only the next run. */
interface Run {
  id: string; pack: RecessPack; lesson?: HabitLesson; assets: RecessBotArt; condition: typeof standard;
  loadout: RecessLoadout; scope: string; host: HTMLElement; column: { left: number; width: number } | null;
}
/** What the flight log says about charge: only what Care actually accepted. */
type Settlement =
  | { status: "saving"; before: number }
  | { status: "saved"; before: number; after: number }
  | { status: "unbanked"; before: number; gained: boolean }
  | { status: "failed"; before: number; retry: () => void };
type Stage = "plan" | "flight" | "log";

interface Props {
  lesson: HabitLesson;
  sessionId?: string;
  model?: Model<Api>;
  mode: HabitsMode;
  /** The chat thread element the flight covers. */
  host: HTMLElement | null;
  onDraft(draft: string): void;
  onClose(): void;
}

/**
 * Recess as part of the chat: the strip takes the composer's place, the flight
 * covers the thread with the same lesson, and the flight log lands back here.
 */
export default function ChatRecess({ lesson, sessionId, model, mode, host, onDraft, onClose }: Props) {
  const [ui] = useKeatingUiSettings();
  const motionAllowed = useMotionAllowed();
  const [settings, setSettings] = useState(loadSettings);
  const effective = { ...settings, calm: settings.calm || !ui.visualEffects || !motionAllowed };
  const calmForced = !ui.visualEffects || !motionAllowed;
  const settingsId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("loadout");
  const settingsPanel = useRef<HTMLElement>(null);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    requestAnimationFrame(() => strip.current?.querySelector<HTMLButtonElement>(".recess-settings-toggle")?.focus());
  }, []);
  useEffect(() => { if (settingsOpen) settingsPanel.current?.focus({ preventScroll: true }); }, [settingsOpen]);
  const [stage, setStage] = useState<Stage>("plan");
  const [choice, setChoice] = useState<Choice>({ kind: "chat" });
  const [picker, setPicker] = useState<RecessNextMove | null>(null);
  const [result, setResult] = useState<RecessResult | null>(null);
  const [failure, setFailure] = useState("");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const startKey = useRef<HTMLButtonElement>(null);
  const strip = useRef<HTMLElement>(null);

  // ── the lesson: rules now, Jev's read in the background ──
  // Pictures are keyed by id: their data never needs to be compared or copied here.
  const lessonKey = useMemo(() => JSON.stringify(lessonForPrompt(lesson)), [lesson]);
  const stableLesson = useMemo(() => lesson, [lessonKey]);
  const rules = useMemo(() => recessReadinessRules(stableLesson), [stableLesson]);
  const localPack = useMemo(() => buildChatRecessPack(stableLesson), [stableLesson]);
  const [others, setOthers] = useState<OtherChat[] | null>(null);
  const [judged, setJudged] = useState<{ key: string; readiness: RecessReadiness } | null>(null);
  const flying = stage === "flight";
  const readiness = judged?.key === lessonKey ? judged.readiness : rules;
  const judging = !judged || judged.key !== lessonKey;
  const [playAnyway, setPlayAnyway] = useState(false);
  const chatPlayable = Boolean(localPack?.gates.length) && rules.level === "ready";
  const chatReady = chatPlayable && (readiness.level === "ready" || playAnyway);

  useEffect(() => {
    const abort = new AbortController();
    readyChats(sessionId, abort.signal).then(found => { if (!abort.signal.aborted) setOthers(found); }, () => setOthers([]));
    return () => abort.abort();
  }, [sessionId]);

  // No judgement starts or finishes during play: launching aborts it, landing lets it resume once.
  useEffect(() => {
    if (others === null || flying || judged?.key === lessonKey) return;
    const abort = new AbortController();
    judgeRecessReadiness(stableLesson, { signal: abort.signal, others: others.map(chat => ({ id: chat.id, title: chat.title, level: "ready" as const })) })
      .then(next => { if (!abort.signal.aborted) setJudged({ key: lessonKey, readiness: next }); },
        () => { if (!abort.signal.aborted) setJudged({ key: lessonKey, readiness: rules }); });
    return () => abort.abort();
  }, [stableLesson, lessonKey, others, rules, flying, judged]);

  // ── optional model enrichment of this chat's questions ──
  const scope = useSyncExternalStore(subscribeHabits, currentHabitsScope, () => "device");
  const [enriched, setEnriched] = useState<{ key: string; pack: RecessPack | null } | null>(null);
  const enrichment = enriched?.key === lessonKey ? enriched : null;
  useEffect(() => {
    if (!model || !chatPlayable || enrichment || flying) return;
    const abort = new AbortController();
    const begun = currentHabitsScope();
    compileLessonPack(model, stableLesson, abort.signal).then(
      pack => { if (!abort.signal.aborted && begun === currentHabitsScope()) setEnriched({ key: lessonKey, pack }); },
      () => { if (!abort.signal.aborted) setEnriched({ key: lessonKey, pack: null }); },
    );
    return () => abort.abort();
  }, [model, chatPlayable, enrichment, stableLesson, lessonKey, flying]);

  // ── Jev picks this run's questions from everything the builder and the model offered ──
  // The model's lesson framing (title, takeaway, boss) is kept; its questions join the local pool instead of replacing it.
  const basePack = useMemo(() => localPack && enrichment?.pack
    ? { ...localPack, title: enrichment.pack.title, tldr: enrichment.pack.tldr, boss: enrichment.pack.boss ?? localPack.boss, myths: enrichment.pack.myths.length ? enrichment.pack.myths : localPack.myths }
    : localPack, [localPack, enrichment]);
  const pool = useMemo<RecessCandidate[]>(() => [
    ...recessQuestionCandidates(stableLesson).map(item => ({ ...item, from: "local" as const })),
    ...(enrichment?.pack ? [...enrichment.pack.gates, ...(enrichment.pack.revive ?? [])].map(item => ({ ...item, from: "model" as const })) : []),
  ], [stableLesson, enrichment]);
  const curateKey = `${lessonKey}|${enrichment?.pack ? "model" : "local"}`;
  const [curated, setCurated] = useState<{ key: string; pack: RecessPack; source: "jev" | "rules" } | null>(null);
  const curation = curated?.key === curateKey ? curated : null;
  useEffect(() => {
    if (!basePack || !chatPlayable || flying || curation) return;
    const abort = new AbortController();
    curateRecessPack(basePack, stableLesson, pool, { signal: abort.signal, mastery: readRecessMastery(scope) }).then(
      next => { if (!abort.signal.aborted) setCurated({ key: curateKey, ...next }); },
      () => { if (!abort.signal.aborted) setCurated({ key: curateKey, pack: basePack, source: "rules" }); },
    );
    return () => abort.abort();
  }, [basePack, chatPlayable, flying, curation, stableLesson, pool, scope, curateKey]);

  // ── the chat's pictures, loaded before launch: a question whose picture will not show is swapped out, never asked blind ──
  const curatedPack = curation?.pack ?? basePack;
  const pictures = useMemo(() => curatedPack ? packPictures(curatedPack) : [], [curatedPack]);
  const picturesKey = pictures.map(image => image.id).join(",");
  const [pictureCheck, setPictureCheck] = useState<{ key: string; failed: Set<string> } | null>(null);
  const picturesChecked = !pictures.length || pictureCheck?.key === picturesKey;
  useEffect(() => {
    if (!pictures.length || pictureCheck?.key === picturesKey) return;
    let active = true;
    unloadablePictures(pictures).then(failed => { if (active) setPictureCheck({ key: picturesKey, failed }); });
    return () => { active = false; };
  }, [pictures, picturesKey, pictureCheck]);
  const chatPack = useMemo(() => curatedPack && pictureCheck?.key === picturesKey
    ? swapUnloadedPictures(curatedPack, pictureCheck.failed, pool)
    : curatedPack, [curatedPack, pictureCheck, picturesKey, pool]);
  const picturesPending = choice.kind === "chat" && !picturesChecked;
  const pack: RecessPack | null = choice.kind === "demo" ? packs[choice.id] ?? null : chatReady ? chatPack : null;
  const [run, setRun] = useState<Run | null>(null);
  /** The run the flight log describes: its pack holds each question's source in the chat. */
  const [landed, setLanded] = useState<Run | null>(null);
  const [citeNote, setCiteNote] = useState("");
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  // ── Keating's condition and the run's settlement ──
  const [snapshot, setSnapshot] = useState<HabitsSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (mode === "off") return;
    let active = true;
    const update = () => void readHabits(mode).then(next => { if (active && currentHabitsScope() === next.scope) setSnapshot(next); }, () => {});
    const unsubscribe = subscribeHabits(update);
    update();
    return () => { active = false; unsubscribe(); };
  }, [mode, scope]);
  // In Care modes a run starts only from this account's own reading, never the 75% placeholder.
  const current = snapshot && snapshot.scope === scope ? snapshot : null;
  const conditionReady = mode === "off" || current !== null;
  const condition = mode === "off" ? standard : current?.condition ?? standard;
  const ownedKit = useMemo(() => {
    if (mode === "off") return HABIT_KIT.map(item => item.id);
    const list = current?.ownedKit ?? ["jetpack", "blaster", "drone"];
    return list.includes("drone") ? list : [...list, "drone"];
  }, [mode, current?.ownedKit]);
  const equippedIds = useMemo(() => {
    if (mode === "off") return [settings.weaponId || "blaster", settings.helperId || "drone"];
    return Object.values(current?.equippedKit ?? { pack: "jetpack", blaster: "blaster", helper: "drone" });
  }, [mode, current?.equippedKit, settings.weaponId, settings.helperId]);
  const kit = mode === "off" ? equippedIds : equippedIds;
  const loadout = useMemo(() => resolveRecessLoadout(equippedIds), [equippedIds]);
  const ownedWeapons = useMemo(() => RECESS_WEAPONS.filter(piece => ownedKit.includes(piece.id)), [ownedKit]);
  const ownedHelpers = useMemo(() => RECESS_HELPERS.filter(piece => ownedKit.includes(piece.id)), [ownedKit]);
  const activeWeaponId = (mode === "off" ? settings.weaponId : current?.equippedKit.blaster) || "blaster";
  const activeHelperId = (mode === "off" ? settings.helperId : current?.equippedKit.helper) || "drone";
  const lockedArsenalCount = (RECESS_WEAPONS.length - ownedWeapons.length) + (RECESS_HELPERS.length - ownedHelpers.length);

  function equipKit(slot: "blaster" | "helper", kitId: string) {
    if (mode === "off") {
      setSettings(s => slot === "blaster" ? { ...s, weaponId: kitId } : { ...s, helperId: kitId });
      return;
    }
    if ((slot === "blaster" ? activeWeaponId : activeHelperId) === kitId) return;
    void dispatchHabits(mode, { type: "equip", kitId }).then(next => {
      if (currentHabitsScope() === next.scope) setSnapshot(next);
    }, () => {});
  }

  /** Settle under the account and run id the flight launched with; a switched account never receives it. */
  const settle = useCallback((flight: Run, end: RunEnd, show: boolean) => {
    const before = flight.condition.charge;
    if (mode === "off") return;
    if (currentHabitsScope() !== flight.scope) { if (show) setSettlement({ status: "unbanked", before, gained: false }); return; }
    if (end.quit && (end.care.chargeDelta ?? 0) >= 0) { if (show) setSettlement({ status: "unbanked", before, gained: (end.care.chargeDelta ?? 0) > 0 }); return; }
    const attempt = () => {
      setPending(true);
      if (show) setSettlement({ status: "saving", before });
      void dispatchHabits(mode, { type: "runEnd", runId: flight.id, scope: flight.scope, result: end })
        .then(next => {
          if (currentHabitsScope() === next.scope) setSnapshot(next);
          if (show) setSettlement(next.accepted ? { status: "saved", before, after: next.condition.charge } : { status: "failed", before, retry: attempt });
        }, () => { if (show) setSettlement({ status: "failed", before, retry: attempt }); })
        .finally(() => setPending(false));
    };
    attempt();
  }, [mode]);

  // ── artwork for the chosen lesson, loaded before launch ──
  const casting = pack ? pack.cast ?? pack.id : "maths";
  const [artAttempt, setArtAttempt] = useState(0);
  const artKey = `${settings.skin}/${casting}/${kit.join(",")}/${artAttempt}`;
  const [art, setArt] = useState<{ key: string; assets: RecessBotArt | null } | null>(null);
  useEffect(() => {
    let active = true;
    loadRecessArt(casting, settings.skin === "toy", artKey.split("/")[2].split(",").filter(Boolean)).then(
      assets => { if (active) setArt({ key: artKey, assets }); },
      () => { if (active) setArt({ key: artKey, assets: null }); },
    );
    return () => { active = false; };
  }, [artKey, casting, settings.skin]);
  const assets = art?.key === artKey ? art.assets : undefined;
  const artFailed = art?.key === artKey && art.assets === null;

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* per-device convenience only */ }
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => { strip.current?.focus({ preventScroll: true }); }, []);

  function measureColumn() {
    if (!host) return null;
    const message = host.querySelector<HTMLElement>("[data-learning-session-id], .keating-bubble");
    const box = host.getBoundingClientRect();
    const target = message?.getBoundingClientRect();
    return target && target.width > 200 ? { left: target.left - box.left, width: target.width } : null;
  }

  function launch() {
    if (!pack || !assets || !host || pending || !conditionReady || picturesPending) return;
    setFailure("");
    setResult(null);
    setSettlement(null);
    const fromChat = choice.kind === "chat";
    const explain = fromChat ? recessExplainPrompt(pack, pool) ?? undefined : undefined;
    setRun({
      id: crypto.randomUUID(), pack: explain ? { ...pack, explain } : pack, lesson: fromChat ? stableLesson : undefined, assets,
      condition: { ...condition }, loadout, scope, host, column: measureColumn(),
    });
    setSettingsOpen(false);
    setStage("flight");
  }

  function land(flight: Run, end: RecessResult) {
    settle(flight, end, true);
    // The next run leans toward the kinds missed here. Chat runs only: demos say nothing about this learner's lessons.
    if (flight.lesson && currentHabitsScope() === flight.scope) recordRecessKinds(flight.scope, [...end.gates, ...(end.wind ? [end.wind] : [])]);
    setLanded(flight);
    // The engine drew a plain copy of the takeaway; the log shows the lesson's own Markdown.
    setResult(end.tldr ? { ...end, tldr: flight.pack.tldr } : end);
    setRun(null);
    setStage("log");
    requestAnimationFrame(() => startKey.current?.focus({ preventScroll: true }));
  }

  // Switching account mid-flight ends the run without settling it under the new one.
  useEffect(() => {
    if (run && run.scope !== scope) { setFailure("You switched accounts, so Keating landed without saving that run."); setRun(null); setStage(result ? "log" : "plan"); }
  }, [run, scope, result]);

  function move(next: RecessNextMove) {
    if (next === "continue") onDraft(recessContinuePrompt(readiness));
    else setPicker(current => current === next ? null : next);
  }

  function openChat(chat: OtherChat) {
    try { sessionStorage.setItem(RECESS_PENDING_KEY, chat.id); } catch { /* the switch still happens */ }
    window.dispatchEvent(new CustomEvent(RECESS_OPEN_SESSION_EVENT, { detail: { sessionId: chat.id } }));
  }

  /** Scroll the real chat to the tutor's words behind a question and mark them for a moment. */
  function showSource(check: RecessCheckResult) {
    setCiteNote("");
    const item = landed && [...landed.pack.gates, ...(landed.pack.revive ?? [])].find(question => question.id && question.id === check.id);
    const quote = item?.source?.quote;
    if (!quote || !host) { setCiteNote("Keating can’t point to one place in the chat for that one."); return; }
    // Probe with the longest run of plain words: maths renders differently on the page than in the quote.
    const runs = quote.split(/[^\p{L}\p{N}'’ -]+/u).map(part => part.trim().replace(/\s+/g, " ")).filter(part => part.split(" ").length >= 2);
    const probe = (runs.sort((a, b) => b.length - a.length)[0] ?? quote).toLowerCase().slice(0, 60);
    const bubble = [...host.querySelectorAll<HTMLElement>(".keating-bubble")].reverse()
      .find(node => (node.textContent ?? "").replace(/\s+/g, " ").toLowerCase().includes(probe));
    if (!bubble) { setCiteNote("That part of the chat isn’t loaded any more."); return; }
    // Top of the view: the Recess strip covers the bottom of the thread.
    bubble.scrollIntoView({ block: "start", behavior: effective.calm ? "auto" : "smooth" });
    bubble.classList.remove("recess-cited");
    void bubble.offsetWidth;
    bubble.classList.add("recess-cited");
    window.setTimeout(() => bubble.classList.remove("recess-cited"), 2600);
  }
  const askDraft = (check: RecessCheckResult) => check.picked
    ? `In Recess I picked “${check.picked}” for “${check.q}”, but the answer was “${check.right}”. Can you help me see why?`
    : `In Recess I didn’t get to answer “${check.q}” (the answer was “${check.right}”). Can you walk me through it?`;

  const moveLabels: Record<RecessNextMove, string> = {
    continue: "Keep learning here",
    "other-chat": others?.length ? `Practise another chat (${others.length})` : "Practise another chat",
    demo: "Try a demo lesson",
  };
  const moveIcons: Record<RecessNextMove, "chat" | "lessons" | "launch"> = {
    continue: "chat",
    "other-chat": "lessons",
    demo: "launch",
  };
  const wornNames = kit.flatMap(id => HABIT_KIT.find(item => item.id === id)?.name ?? []);
  const showGuidance = stage !== "flight" && choice.kind === "chat" && !chatReady;
  const review = result && recessReviewDraft(result);
  const missed = result ? result.gates.some(check => !check.ok) || Boolean(result.wind && !result.wind.ok) : false;
  const winLabel = result?.bossName ? `Defeated ${result.bossName}` : "Flight complete";
  const reviewIsPrimary = stage === "log" && Boolean(review) && missed;
  const title = choice.kind === "demo" ? pack?.title : chatPlayable ? chatPack?.title : readiness.topic ?? "Nothing to fly through yet";

  return <section ref={strip} className="recess-root recess-strip" tabIndex={-1} aria-label="Recess" data-stage={stage} data-theme={dark ? "term" : "paper"} data-settings={settingsOpen ? "open" : undefined}
    onKeyDown={event => {
      if (event.key !== "Escape" || stage === "flight") return;
      // An open dropdown menu is portalled but still bubbles here through React; let it close itself first.
      if ((event.target as Element).closest?.(".keating-select-menu, .keating-select[data-state='open']")) return;
      event.stopPropagation();
      if (settingsOpen) closeSettings(); else onClose();
    }}>
    <header className="recess-strip-head">
      <span className="recess-strip-mark"><RecessIcon name="launch" size={13}/>Recess</span>
      <span className="recess-strip-title">
        {choice.kind === "demo" ? <>Demo · {pack?.label}</> : title ? <RecessInlineMarkdown text={title} /> : "This chat"}
      </span>
      <span className="recess-strip-tools">
        <span className="recess-charge" data-tone={chargeTone(condition.charge)} title="Firing spends charge. Sparks and charge cells refill it.">
          <b>Charge</b><span className="recess-charge-bar"><i style={{ width: percent(condition.charge) }} /></span><em>{percent(condition.charge)}</em>
        </span>
        <button type="button" className="recess-settings-toggle" data-glyph-host aria-label="Flight settings"
          aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => setSettingsOpen(open => !open)}>
          <RecessIcon name="gear" size={15}/>
        </button>
        <button type="button" className="recess-strip-close" data-glyph-host aria-label="Close Recess and return to the chat" onClick={onClose}><RecessIcon name="close" size={15}/></button>
      </span>
    </header>

    {settingsOpen && <section id={settingsId} ref={settingsPanel} className="recess-panel" aria-label="Flight settings" tabIndex={-1} data-tab={settingsTab}>
      <header className="recess-panel-head">
        <h3>Flight settings</h3>
        <button type="button" className="recess-panel-done" onClick={closeSettings}>Done</button>
      </header>
      <div className="recess-panel-body">

      <div className="recess-panel-group" data-section="loadout" role="group" aria-labelledby={`${settingsId}-loadout`}>
        <h4 id={`${settingsId}-loadout`}>Loadout</h4>
        <div className="recess-row">
          <span className="recess-row-label" id={`${settingsId}-weapon`}>Weapon</span>
          <Select aria-labelledby={`${settingsId}-weapon`} value={activeWeaponId} onValueChange={value => equipKit("blaster", value)}>
            {ownedWeapons.map(piece => <option key={piece.id} value={piece.id}>{piece.name}</option>)}
          </Select>
        </div>
        <div className="recess-row">
          <span className="recess-row-label" id={`${settingsId}-helper`}>Companion<small>Joins at power 2</small></span>
          <Select aria-labelledby={`${settingsId}-helper`} value={activeHelperId} onValueChange={value => equipKit("helper", value)}>
            {ownedHelpers.map(piece => <option key={piece.id} value={piece.id}>{piece.name}</option>)}
          </Select>
        </div>
        <div className="recess-row">
          <span className="recess-row-label" id={`${settingsId}-bomb`}>Bomb</span>
          <Select aria-labelledby={`${settingsId}-bomb`} value={settings.bombKind} onValueChange={value => setSettings(s => ({ ...s, bombKind: resolveBombKind(value) }))}>
            {Object.entries(RECESS_BOMBS).map(([kind, bomb]) => <option key={kind} value={kind}>{bomb.name}</option>)}
          </Select>
        </div>
        <p className="recess-fine" aria-live="polite">{RECESS_BOMBS[settings.bombKind].effect}</p>
        {mode !== "off" && lockedArsenalCount > 0 && <p className="recess-fine">
          {lockedArsenalCount} more to craft in Study progress, under Quests &amp; kit. Pods in a run let you try them early.
        </p>}
      </div>

      <div className="recess-panel-group" data-section="controls" role="group" aria-labelledby={`${settingsId}-controls`}>
        <h4 id={`${settingsId}-controls`}>Controls</h4>
        <div className="recess-segments" role="radiogroup" aria-labelledby={`${settingsId}-controls`}>
          {CONTROL_MODES.map(option => <label key={option.id} data-checked={settings.control === option.id || undefined}>
            <input type="radio" name={`${settingsId}-control`} value={option.id} checked={settings.control === option.id}
              onChange={() => setSettings(s => ({ ...s, control: option.id }))}/>
            {option.label}
          </label>)}
        </div>
        <p className="recess-fine" aria-live="polite">{CONTROL_MODES.find(option => option.id === settings.control)?.help} Auto-aim is tighter up close. Hold Shift to steady a distant shot.</p>
        <p className="recess-fine">On touch, hold still to focus, then drag to weave. Drag a second finger to aim or tap with two fingers to use your bomb. Space also uses your bomb. Escape lands.</p>
      </div>

      <div className="recess-panel-group" data-section="look" role="group" aria-labelledby={`${settingsId}-look`}>
        <h4 id={`${settingsId}-look`}>Look and sound</h4>
        <div className="recess-row">
          <span className="recess-row-label" id={`${settingsId}-art`}>Artwork</span>
          <div className="recess-segments recess-segments--two" role="radiogroup" aria-labelledby={`${settingsId}-art`}>
            {([["toy", "Toys"], ["ink", "Ink"]] as const).map(([id, label]) => <label key={id} data-checked={settings.skin === id || undefined}>
              <input type="radio" name={`${settingsId}-skin`} value={id} checked={settings.skin === id} onChange={() => setSettings(s => ({ ...s, skin: id }))}/>
              {label}
            </label>)}
          </div>
        </div>
        <label className="recess-row">
          <span className="recess-row-label">Chat behind the game</span>
          <span className="recess-range-field">
            <input type="range" min={8} max={70} step={2} value={settings.opacity} onChange={event => setSettings(s => ({ ...s, opacity: Number(event.target.value) }))}/>
            <output>{settings.opacity}%</output>
          </span>
        </label>
        <label className="recess-row">
          <span className="recess-row-label">Calm effects{calmForced && <small>On, because reduced motion or visual effects are off</small>}</span>
          <input type="checkbox" role="switch" className="recess-switch" checked={effective.calm} disabled={calmForced}
            onChange={event => setSettings(s => ({ ...s, calm: event.target.checked }))} />
        </label>
        <label className="recess-row">
          <span className="recess-row-label">Boss introductions</span>
          <input type="checkbox" role="switch" className="recess-switch" checked={settings.bossScenes !== false}
            onChange={event => setSettings(s => ({ ...s, bossScenes: event.target.checked }))} />
        </label>
        <label className="recess-row">
          <span className="recess-row-label">Sound</span>
          <input type="checkbox" role="switch" className="recess-switch" checked={settings.sound}
            onChange={event => setSettings(s => ({ ...s, sound: event.target.checked }))} />
        </label>
      </div>

      {mode !== "off" && <dl className="recess-panel-stats">
        <div><dt>Tuning</dt><dd>{percent(condition.tune)}</dd></div>
        <div><dt>Shine</dt><dd>{percent(condition.shine)}</dd></div>
        {wornNames.length > 0 && <div className="recess-panel-worn"><dt>Wearing</dt><dd>{wornNames.join(", ")}</dd></div>}
      </dl>}
      </div>
      <nav className="recess-panel-nav" aria-label="Settings sections">
        {SETTINGS_TABS.map(tab => <button key={tab.id} type="button" aria-pressed={settingsTab === tab.id}
          onClick={() => setSettingsTab(tab.id)}>
          <KeatingGlyph name={tab.glyph} size={18} />
          <span>{tab.label}</span>
        </button>)}
      </nav>
    </section>}

    {stage === "log" && result && <div className="recess-log" aria-label="Flight log" data-outcome={result.won ? "won" : result.quit ? "quit" : "lost"}>
      <div className="recess-log-head">
        <strong>{result.won ? winLabel : result.quit ? "Landed early" : "Out of hearts"}</strong>
        <span className="recess-log-stats">
          <span>{result.score.toLocaleString()} points</span>
          <span aria-hidden="true">·</span>
          <span>{result.kills} cleared</span>
          <span aria-hidden="true">·</span>
          <span>{result.grazes} close calls</span>
          {!!result.minibosses?.length && <>
            <span aria-hidden="true">·</span>
            <span>Miniboss cleared · {result.minibosses.join(", ")}</span>
          </>}
          {mode !== "off" && settlement && <>
            <span aria-hidden="true">·</span>
            <span data-settlement={settlement.status}>
              {settlement.status === "saved" ? `Charge ${percent(settlement.before)} → ${percent(settlement.after)}`
                : settlement.status === "saving" ? "Saving charge…"
                : settlement.status === "unbanked" ? `Charge stays ${percent(settlement.before)}${settlement.gained ? " (early landing isn’t banked)" : ""}`
                : <>Charge not saved · <button type="button" className="recess-link" onClick={settlement.retry}>Try again</button></>}
            </span>
          </>}
        </span>
      </div>
      {(result.myths.length > 0 || result.gates.length > 0 || result.wind || result.explain) && <ul className="recess-log-list">
        {result.myths.map((myth, index) => <li key={`m-${index}`} data-correct="true" data-kind="myth">
          <span className="recess-log-mark" data-state="ok" role="img" aria-label="Misconception corrected"><RecessIcon name="replay" size={12}/></span>
          <div className="recess-log-q">
            <span className="recess-log-prompt">Not <s>{myth.wrong}</s>, but <strong>{myth.right}</strong></span>
          </div>
        </li>)}
        {[...result.gates, ...(result.wind ? [result.wind] : [])].map((check, index) => <li key={`q-${index}`} data-correct={check.ok}>
          <span className="recess-log-mark" data-state={check.ok ? "ok" : "miss"} role="img" aria-label={check.ok ? "Right" : "Missed"}>
            <RecessIcon name={check.ok ? "check" : "miss"} size={12}/>
          </span>
          <div className="recess-log-q">
            <span className="recess-log-prompt"><RecessInlineMarkdown text={check.q} /></span>
            {!check.ok && <span className="recess-log-picked">{check.picked ? <>You picked <RecessInlineMarkdown text={check.picked} /></> : "Time ran out"}</span>}
            <strong className="recess-log-a"><RecessInlineMarkdown text={check.right} /></strong>
            {!check.ok && landed?.lesson && <div className="recess-log-actions">
              <button type="button" className="recess-chip" data-glyph-host onClick={() => showSource(check)}><RecessIcon name="cite" size={13}/>Show me in chat</button>
              <button type="button" className="recess-chip" data-glyph-host onClick={() => onDraft(askDraft(check))}><RecessIcon name="chat" size={13}/>Ask Keating</button>
            </div>}
          </div>
        </li>)}
        {result.explain && <li data-correct={result.explain.level === "sound"}>
          <span className="recess-log-mark" data-state={result.explain.level === "sound" ? "ok" : result.explain.level === "partial" ? "partial" : "miss"} role="img"
            aria-label={result.explain.level === "sound" ? "Explained" : result.explain.level === "partial" ? "Partly explained" : "Not explained"}>
            <RecessIcon name={result.explain.level === "sound" ? "check" : result.explain.level === "partial" ? "partial" : "miss"} size={12}/>
          </span>
          <div className="recess-log-q">
            <span className="recess-log-prompt"><RecessInlineMarkdown text={result.explain.prompt} /></span>
            {result.explain.answer && <span className="recess-log-picked">You wrote “{result.explain.answer}”</span>}
            <strong className="recess-log-a">{result.explain.level === "sound" ? "In your own words" : <RecessInlineMarkdown text={result.explain.reference} />}</strong>
          </div>
        </li>}
      </ul>}
      {citeNote && <p className="recess-fine" role="status">{citeNote}</p>}
      {result.tldr && <p className="recess-takeaway"><RecessInlineMarkdown text={result.tldr} /></p>}
    </div>}

    {showGuidance ? <div className="recess-guide" role="status">
      <p className="recess-guide-reason">
        {judging && rules.level === "ready" ? "Keating is reading this chat…" : readiness.reason}
      </p>
      <div className="recess-moves">
        {readiness.moves.map((next, index) => <button type="button" key={next} className="recess-key" data-primary={index === 0 ? "true" : "false"} data-glyph-host
          aria-expanded={next === "continue" ? undefined : picker === next} onClick={() => move(next)}>
          <RecessIcon name={moveIcons[next]} size={14}/>{moveLabels[next]}
        </button>)}
        {chatPlayable && readiness.level !== "ready" && <button type="button" className="recess-link" onClick={() => setPlayAnyway(true)}>Play this chat anyway</button>}
      </div>
    </div> : stage !== "flight" && <div className="recess-plan-row">
      <div className="recess-plan-actions">
        {artFailed ? <button type="button" ref={startKey} className="recess-key recess-start" data-primary="true" data-glyph-host
          onClick={() => setArtAttempt(n => n + 1)}>
          <RecessIcon name="replay" size={14}/>Retry artwork
        </button> : <button type="button" ref={startKey} className="recess-key recess-start" data-primary={reviewIsPrimary ? "false" : "true"} data-glyph-host
          disabled={!pack || !assets || pending || !conditionReady || picturesPending} onClick={launch}>
          <RecessIcon name={result ? "replay" : "launch"} size={14}/>{!pack ? "Choose a lesson" : !assets ? "Loading artwork…" : picturesPending ? "Loading pictures…" : pending ? "Saving charge…" : !conditionReady ? "Reading charge…" : result ? "Fly again" : "Start Recess"}
        </button>}
        {stage === "log" && review && <button type="button" className="recess-key" data-primary={reviewIsPrimary ? "true" : "false"} data-glyph-host
          onClick={() => onDraft(review)}>
          <RecessIcon name="quiz" size={14}/>{missed ? "Quiz me on what I missed" : "Quiz me on these"}
        </button>}
      </div>
      <span className="recess-source-note">
        {artFailed ? "Artwork didn’t load. Check your connection and retry."
          : choice.kind === "demo"
            ? <button type="button" className="recess-link" onClick={() => setChoice({ kind: "chat" })}>Back to this chat</button>
            : <><span>{`${chatPack?.gates.length ?? 0} questions from this chat`}{curation?.source === "jev" ? ", picked by Jev" : !curation && chatPlayable ? ", Jev is choosing; you can start now" : ""}{model && chatPlayable && !enrichment ? " · Keating is writing more" : ""}</span>
              <span className="recess-dot" aria-hidden="true"> · </span>
              <button type="button" className="recess-link recess-disclosure" data-glyph-host aria-expanded={picker === "demo"} onClick={() => setPicker(p => p === "demo" ? null : "demo")}>
                Other lessons<RecessIcon name="chev" size={12}/>
              </button></>}
      </span>
    </div>}

    {stage !== "flight" && picker === "other-chat" && <div className="recess-picker" aria-label="Chats ready for Recess">
      {others === null ? <p className="recess-fine">Looking through your recent chats…</p>
        : others.length ? others.map(chat => <button type="button" key={chat.id} className="recess-pick" onClick={() => openChat(chat)}>
          <strong>{chat.title}</strong>{chat.topic && chat.topic !== chat.title && <small>{chat.topic}</small>}
        </button>)
        : <p className="recess-fine">None of your recent chats has enough in it yet. A demo lesson works any time.</p>}
    </div>}
    {stage !== "flight" && picker === "demo" && <div className="recess-picker recess-picker--demos" aria-label="Demo lessons">
      {demos.map(demo => <button type="button" key={demo.id} className="recess-pick" aria-pressed={choice.kind === "demo" && choice.id === demo.id}
        onClick={() => { setChoice({ kind: "demo", id: demo.id }); setPicker(null); setResult(null); }}>
        <strong>{demo.label}</strong><small>{demo.title}</small>
      </button>)}
    </div>}

    {failure && <p className="recess-fine" role="status">{failure}</p>}
    {stage === "flight" && <p className="recess-fine" role="status">Keating is flying over {run?.lesson ? "this chat" : "the demo lesson"}. Escape lands him.</p>}
    {/* Keyed by run id: nothing that changes after takeoff can remount or restart this flight. */}
    {stage === "flight" && run && <RecessFlight key={run.id}
      pack={run.pack} lesson={run.lesson} assets={run.assets} condition={run.condition} loadout={run.loadout} settings={effective}
      host={run.host} column={run.column} dark={dark}
      onEnd={end => land(run, end)}
      onAbandon={chargeDelta => settle(run, { quit: true, care: { chargeDelta, used: 0, cogs: 0, sparks: 0 } }, false)}
      onFailure={(message, fatal) => { setFailure(message); if (fatal) { setRun(null); setStage(result ? "log" : "plan"); } }}
      gradeExplain={run.lesson && run.pack.explain ? (answer, signal) => gradeRecessExplain(run.lesson!, run.pack.explain!, answer, { signal }).then(grade => grade.level) : undefined}
    />}
  </section>;
}
