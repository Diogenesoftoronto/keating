import { DAY_MS, HOUR_MS, calendarDay, dayName, habitBoundary, habitDay, habitTimeZone, weekendBounty } from "./calendar";
import type { AwayTone, CareCondition, CareNeed, CrateRarity, HabitCrate, HabitInventory, HabitKeepsake, HabitQuestProgress, HabitsCommand, HabitsGrade, HabitsMode, HabitsSnapshot } from "./contracts";
import { HABIT_KIT, HABIT_QUESTS } from "./quest-catalog";

const STANDARD: CareCondition = { charge: 0.75, tune: 0.75, shine: 0.75 };
const NEEDS = ["charge", "tune", "shine"] as const;
const CARE = {
  charge: { resource: "sparks", gain: 0.2, decay: 0.25 },
  tune: { resource: "cogs", gain: 0.25, decay: 1 / 14 },
  shine: { resource: "polish", gain: 0.3, decay: 1 / 7 },
} as const;
const CRATE_RARITIES = ["common", "uncommon", "rare", "masterwork"] as const;
const MISS_CAP = 3;

export interface PrivateStudyEvidence {
  id: string;
  objective: string;
  family: string;
  checkedAt: number;
  mastery: number;
  independentTransfer?: boolean;
  sessionId?: string;
  lessonTitle?: string;
}

type Bridge = { first: number; last: number };
type StoredKeepsake = Omit<HabitKeepsake, "dusty">;
type IssuedCrate = HabitCrate & { gift: number };
type DayCounter = { day: number; total: number };

export interface HabitsState {
  version: 1;
  startedAt: number;
  activityFloor: number;
  checkedAt: number;
  zone: string;
  seed: string;
  mode: HabitsMode;
  tone: AwayTone;
  condition: CareCondition;
  actual: Record<number, string>;
  rescued: number[];
  rest: number[];
  bridges: Bridge[];
  bestStreak: number;
  pauseUntil: number | null;
  lastRescueAt: number | null;
  rescueAttempts: DayCounter | null;
  awayDismissals: string[];
  inventory: HabitInventory;
  crates: IssuedCrate[];
  pity: { misses: number; belowRare: number; belowMasterwork: number };
  draws: { day: number; families: string[] } | null;
  keepsakes: StoredKeepsake[];
  quests: Record<string, HabitQuestProgress>;
  blueprints: Record<string, number>;
  ownedKit: string[];
  equippedKit: Record<string, string>;
  collectedFinishes: string[];
  collectedTints: string[];
  collectedRelics: string[];
  workshopLP: number;
  workshopBoost: { endsAt: number; uses: number } | null;
  overchargeUntil: number | null;
  shelfBonus: { endsAt: number; keepsakeId: string } | null;
  dailyBountyClaimed: number | null;
  weekendBountyClaimed: number | null;
  shortcuts: { day: number; ids: string[] } | null;
  recessRewards: DayCounter | null;
  recessBest: number;
  lastResult: string;
}

export function createHabitsState(now: number, mode: HabitsMode, seed: string, zone = habitTimeZone()): HabitsState {
  return {
    version: 1, startedAt: now, activityFloor: now, checkedAt: now, zone: habitTimeZone(zone), seed, mode, tone: "spirited",
    condition: { ...STANDARD }, actual: {}, rescued: [], rest: [], bridges: [], bestStreak: 0,
    pauseUntil: null, lastRescueAt: null, rescueAttempts: null, awayDismissals: [],
    inventory: { sparks: 0, cogs: 0, polish: 0, parts: 0, shards: 0, shields: 0, vouchers: 0 },
    crates: [], pity: { misses: 0, belowRare: 0, belowMasterwork: 0 }, draws: null,
    keepsakes: [], quests: {}, blueprints: {}, ownedKit: ["jetpack", "blaster", "drone"],
    equippedKit: { pack: "jetpack", blaster: "blaster", helper: "drone" }, collectedFinishes: [], collectedTints: [], collectedRelics: [],
    workshopLP: 0, workshopBoost: null, overchargeUntil: null, shelfBonus: null,
    dailyBountyClaimed: null, weekendBountyClaimed: null, shortcuts: null, recessRewards: null, recessBest: 0, lastResult: "",
  };
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function natural(value: number, cap: number): number {
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(cap, value)) : 0;
}

function addBridge(state: HabitsState, first: number, last: number) {
  const previous = state.bridges.at(-1);
  if (previous && previous.last + 1 >= first) previous.last = Math.max(previous.last, last);
  else state.bridges.push({ first, last });
}

function shiftVolatileTimers(state: HabitsState, elapsed: number) {
  for (const crate of state.crates) {
    if (crate.unlockAt > state.checkedAt) crate.unlockAt += elapsed;
    crate.expiresAt += elapsed;
  }
  if (state.overchargeUntil !== null) state.overchargeUntil += elapsed;
  if (state.shelfBonus) state.shelfBonus.endsAt += elapsed;
  if (state.workshopBoost) state.workshopBoost.endsAt += elapsed;
}

export function reconcileHabits(state: HabitsState, now: number, mode: HabitsMode) {
  now = Math.max(state.checkedAt, now);
  const wasOff = state.mode === "off";
  const elapsed = now - state.checkedAt;
  const decayFrom = Math.min(now, Math.max(state.checkedAt, state.pauseUntil ?? 0));
  const decayDays = wasOff ? 0 : (now - decayFrom) / DAY_MS;
  for (const need of NEEDS) state.condition[need] = unit(state.condition[need] - CARE[need].decay * decayDays);

  const bridgeUntil = wasOff ? now : Math.min(now, state.pauseUntil ?? 0);
  if (bridgeUntil > state.checkedAt) {
    const first = habitDay(state.checkedAt, state.zone).day;
    const last = habitDay(bridgeUntil - 1, state.zone).day;
    addBridge(state, first, last);
  }

  if (wasOff) {
    shiftVolatileTimers(state, elapsed);
    state.activityFloor = now;
  }
  state.checkedAt = now;
  state.mode = mode;

  if (state.pauseUntil !== null && now >= state.pauseUntil) state.pauseUntil = null;
  if (state.overchargeUntil !== null && now >= state.overchargeUntil) state.overchargeUntil = null;
  if (state.shelfBonus && now >= state.shelfBonus.endsAt) state.shelfBonus = null;
  if (state.workshopBoost && now >= state.workshopBoost.endsAt) state.workshopBoost = null;
  const remaining = state.crates.filter(crate => crate.expiresAt > now);
  if (remaining.length < state.crates.length) state.lastResult = "An unopened Mystery Crate expired. Claimed rewards are yours to keep.";
  state.crates = remaining;
  const today = habitDay(now, state.zone).day;
  if (state.rescueAttempts && state.rescueAttempts.day < today - 1) state.rescueAttempts = null;
  // If a delayed grade fills yesterday's gap, the recorded best is still accurate.
  state.bestStreak = Math.max(state.bestStreak, streakStatus(state, today).streak);
}

function worked(state: HabitsState, day: number): boolean {
  return Object.hasOwn(state.actual, day);
}

function bridged(state: HabitsState, day: number): boolean {
  return state.rest.includes(day) || state.bridges.some(span => day >= span.first && day <= span.last);
}

function countStreak(state: HabitsState, through: number, start: number): number {
  let streak = 0;
  for (let day = through; day >= start; day--) {
    if (worked(state, day) || state.rescued.includes(day)) streak++;
    else if (!bridged(state, day)) break;
  }
  return streak;
}

function streakStatus(state: HabitsState, today: number) {
  const days = Object.keys(state.actual).map(Number).sort((a, b) => b - a);
  const through = worked(state, today) ? today : today - 1;
  const streak = days.length ? countStreak(state, through, days[days.length - 1]) : 0;
  const lastActualBeforeToday = days.find(day => day < today);
  if (lastActualBeforeToday === undefined) return { streak, missed: 0, rescue: null };
  let missed = 0;
  let missedDay = today;
  for (let day = today - 1; day > lastActualBeforeToday; day--) {
    if (!bridged(state, day) && !state.rescued.includes(day)) {
      missed++;
      missedDay = day;
    }
  }
  const lastRescueAvailable = state.lastRescueAt === null || state.checkedAt >= state.lastRescueAt + 28 * DAY_MS;
  const deadline = habitBoundary(missedDay + 1, state.zone, 22);
  const rescue = missed === 1 && lastRescueAvailable ? { day: missedDay, deadline, objective: state.actual[lastActualBeforeToday] } : null;
  return { streak, missed, rescue };
}

function awayPrompt(state: HabitsState, today: number, missed: number, gentleOnly = false): HabitsSnapshot["away"] {
  if (state.mode === "off" || state.pauseUntil !== null || state.tone === "off" || worked(state, today)
      || bridged(state, today) || !Object.keys(state.actual).length || state.awayDismissals.length >= MISS_CAP) return null;
  const now = state.checkedAt;
  const isEvening = now >= habitBoundary(today, state.zone, 20) && now < habitBoundary(today, state.zone, 22);
  const stage = missed >= 14 ? "sheet" : missed >= 7 ? "dusty" : missed > 0 ? "snuffed" : isEvening ? "wobble" : null;
  if (!stage || state.awayDismissals.includes(stage)) return null;
  if (stage !== "sheet" && (now < habitBoundary(today, state.zone, 8) || now >= habitBoundary(today, state.zone, 22))) return null;
  const messages = {
    wobble: ["There’s still time for one small study step.", "The lantern’s wobbling. One good answer will steady it.", "The lantern would like to file a motion for one small study step."],
    snuffed: ["The study lantern went out. Let’s try one quick repair.", "Curses. The lantern is out. A little time with a good problem ought to set it right.", "The lantern has made a great dramatic exit. It would like an encore, please."],
    dusty: ["Welcome back. One keepsake is ready for a review.", "I have become a collector of dust. Shall we review one thing and clear the shelf?", "There is enough dust on this shelf to write a dissertation. One review ought to do."],
    sheet: ["Welcome back. We can start with something small.", "Ah! A visitor. The dust sheet and I were just getting acquainted.", "The dust sheet was about to be elected head of the household. You’re just in time."],
  } as const;
  const tone = gentleOnly || state.tone === "gentle" ? 0 : state.tone === "spirited" ? 1 : 2;
  return { stage, message: messages[stage][tone] };
}

export function habitsSnapshot(state: HabitsState, scope: string, gentleOnly = false): HabitsSnapshot {
  const today = habitDay(state.checkedAt, state.zone);
  const active = state.mode !== "off";
  const status = streakStatus(state, today.day);
  const rescue = active && state.pauseUntil === null && status.rescue && status.rescue.deadline > state.checkedAt
    ? status.rescue : null;
  const condition = active ? { ...state.condition } : { ...STANDARD };
  if (active && state.overchargeUntil !== null) {
    condition.charge = Math.max(0.9, condition.charge);
    condition.tune = Math.max(0.9, condition.tune);
  }
  const weekend = weekendBounty(today.day, state.zone);
  const days = Object.keys(state.actual).map(Number).sort((a, b) => a - b);
  return structuredClone({
    scope, day: today.label, dayEndsAt: today.end,
    streak: status.streak, bestStreak: state.bestStreak, totalStudyDays: days.length,
    actualStudyDays: days.map(dayName), rescuedDays: state.rescued.map(dayName), studiedToday: worked(state, today.day),
    rescueUntil: rescue?.deadline ?? null, rescueObjective: rescue?.objective ?? null,
    pauseUntil: state.pauseUntil, restDays: state.rest.map(dayName),
    tone: gentleOnly && state.tone !== "off" ? "gentle" : state.tone, away: awayPrompt(state, today.day, status.missed, gentleOnly),
    condition, inventory: state.inventory,
    crates: state.crates.map(({ gift: _gift, ...crate }) => crate),
    keepsakes: state.keepsakes.map(keepsake => ({ ...keepsake, dusty: keepsake.dueAt <= state.checkedAt })),
    quests: state.quests, blueprints: state.blueprints, ownedKit: state.ownedKit, equippedKit: state.equippedKit,
    collectedFinishes: state.collectedFinishes, collectedTints: state.collectedTints, collectedRelics: state.collectedRelics,
    workshopLP: state.workshopLP, overchargeUntil: active ? state.overchargeUntil : null,
    shelfBonusUntil: active ? state.shelfBonus?.endsAt ?? null : null,
    dailyBountyUntil: active && state.dailyBountyClaimed !== today.day ? today.end : null,
    weekendBountyUntil: active && weekend && state.weekendBountyClaimed !== weekend.id ? weekend.end : null,
    recessBest: state.recessBest, lastResult: state.lastResult,
  });
}

/** The seed stays on this device. Replaying a receipt cannot redraw its crate. */
function stableRoll(seed: string, id: string, purpose: string): number {
  let hash = 0x811c9dc5;
  for (const letter of JSON.stringify([seed, id, purpose])) {
    hash = Math.imul(hash ^ letter.codePointAt(0)!, 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

function issueCrate(state: HabitsState, evidence: PrivateStudyEvidence, day: number) {
  if (!state.draws || state.draws.day !== day) state.draws = { day, families: [] };
  if (state.draws.families.length >= 3 || state.draws.families.includes(evidence.family)) return;
  state.draws.families.push(evidence.family);
  const chance = 0.15 + 0.15 * unit(evidence.mastery);
  if (state.pity.misses < 5 && stableRoll(state.seed, evidence.id, "drop") >= chance) {
    state.pity.misses++;
    return;
  }
  state.pity.misses = 0;
  const roll = stableRoll(state.seed, evidence.id, "rarity");
  const uncommonBoundary = evidence.independentTransfer ? 0.56 : 0.6;
  const pulled = roll < uncommonBoundary ? 0 : roll < uncommonBoundary + 0.28 ? 1 : roll < 0.98 ? 2 : 3;
  const floor = state.pity.belowMasterwork >= 29 ? 3 : state.pity.belowRare >= 7 ? 2 : 0;
  const rank = Math.max(pulled, floor);
  state.pity.belowRare = rank >= 2 ? 0 : state.pity.belowRare + 1;
  state.pity.belowMasterwork = rank === 3 ? 0 : state.pity.belowMasterwork + 1;
  state.crates.push({
    id: evidence.id, rarity: CRATE_RARITIES[rank], gift: stableRoll(state.seed, evidence.id, "contents"),
    unlockAt: evidence.checkedAt + Math.min(3, rank + 1) * HOUR_MS, expiresAt: evidence.checkedAt + 72 * HOUR_MS,
  });
  state.lastResult = "A Mystery Crate arrived for your study.";
}

function settleStudy(state: HabitsState, evidence: PrivateStudyEvidence): boolean {
  if (evidence.checkedAt < state.activityFloor || evidence.checkedAt > state.checkedAt) return false;
  const day = habitDay(evidence.checkedAt, state.zone).day;
  const currentDay = habitDay(state.checkedAt, state.zone).day;
  const first = !worked(state, day);
  if (first) {
    state.actual[day] = evidence.objective;
    state.awayDismissals = [];
  }
  if (state.rescued.includes(day)) state.rescued = state.rescued.filter(value => value !== day);
  state.bestStreak = Math.max(state.bestStreak, streakStatus(state, currentDay).streak);
  // A delayed grade can recover the historical study day. Volatile rewards
  // are calculated only for the current learning day, preventing late rerolls.
  if (day !== currentDay) return true;
  state.inventory.cogs++;
  if (first) state.inventory.sparks++;
  state.workshopLP += state.workshopBoost ? 12 : 6;
  if (state.workshopBoost && --state.workshopBoost.uses === 0) state.workshopBoost = null;
  if (evidence.sessionId && evidence.lessonTitle && !state.keepsakes.some(item => item.id === evidence.sessionId)) {
    state.keepsakes.push({ id: evidence.sessionId, title: evidence.lessonTitle, sessionId: evidence.sessionId, dueAt: evidence.checkedAt + 6 * DAY_MS });
    state.inventory.polish++;
    if (state.shelfBonus && state.shelfBonus.keepsakeId !== evidence.sessionId) {
      state.inventory.polish++;
      state.shelfBonus = null;
    }
  }
  issueCrate(state, evidence, day);
  return true;
}

export function admitPrivateStudy(state: HabitsState, evidence: PrivateStudyEvidence): boolean {
  if (state.mode === "off") return false;
  state.lastResult = "Study recorded.";
  return settleStudy(state, evidence);
}

function say(state: HabitsState, message: string): true {
  state.lastResult = message;
  return true;
}

function reject(state: HabitsState, message: string): false {
  state.lastResult = message;
  return false;
}

function applyCare(state: HabitsState, need: CareNeed, finish: boolean) {
  const { resource, gain } = CARE[need];
  const consumed = Math.min(state.inventory[resource], finish ? Math.ceil((1 - state.condition[need]) / gain) : 1);
  if (state.condition[need] >= 1 || consumed <= 0) return false;
  state.inventory[resource] -= consumed;
  state.condition[need] = unit(state.condition[need] + gain * consumed);
  return true;
}

function claimCrate(state: HabitsState, crate: IssuedCrate): true {
  state.crates = state.crates.filter(current => current.id !== crate.id);
  if (crate.rarity === "common") {
    const tint = ["Chalk matte", "Anodized copper", "Green enamel"].find(item => !state.collectedTints.includes(item));
    if (tint) state.collectedTints.push(tint);
    else state.inventory.shards++;
    return say(state, tint ? `The Study parcel held ${tint}.` : "The Study parcel held a blueprint shard.");
  }
  if (crate.rarity === "uncommon") {
    const finish = ["Library buckram", "Hammered brass"].find(item => !state.collectedFinishes.includes(item));
    if (finish && crate.gift < 0.55) state.collectedFinishes.push(finish);
    else state.inventory.shards++;
    return say(state, finish && crate.gift < 0.55 ? `The Field box held ${finish}.` : "The Field box held a blueprint shard.");
  }
  if (crate.rarity === "rare" && crate.gift < 1 / 3 && state.inventory.shields === 0) {
    state.inventory.shields = 1;
    return say(state, "The Phosphor crate held a Streak Rescue Shield.");
  }
  if (crate.rarity === "rare" && crate.gift < 2 / 3) {
    state.inventory.vouchers++;
    return say(state, "The Phosphor crate held a 2× Workshop Points voucher.");
  }
  const relic = crate.rarity === "masterwork" ? "Gold-leaf bookmark" : "Phosphor bookplate";
  const finish = "Gilded cloth";
  if (!state.collectedRelics.includes(relic)) state.collectedRelics.push(relic);
  else state.inventory.shards++;
  if (crate.rarity === "masterwork" && !state.collectedFinishes.includes(finish)) state.collectedFinishes.push(finish);
  return say(state, `The crate held a ${relic}.`);
}

function passGrade(command: HabitsGrade) {
  const [accuracy, reasoning, application] = command.rubric;
  return command.kind === "rescue"
    ? accuracy === 2 && reasoning === 2 && application === 2
    : accuracy === 2 && reasoning >= 1 && accuracy + reasoning + application >= 4;
}

function rescueStreak(state: HabitsState, grade: HabitsGrade, today: number): boolean {
  const rescue = streakStatus(state, today).rescue;
  const now = state.checkedAt;
  const attemptedAt = grade.attemptedAt ?? now;
  if (!rescue || state.pauseUntil !== null || attemptedAt < habitBoundary(rescue.day + 1, state.zone)
      || attemptedAt >= rescue.deadline || attemptedAt > now || now - attemptedAt > 2 * 60_000) {
    return reject(state, "The Solve-to-Rescue window has closed.");
  }
  if (!state.rescueAttempts || state.rescueAttempts.day !== today) state.rescueAttempts = { day: today, total: 0 };
  if (state.rescueAttempts.total >= 3 || (state.rescueAttempts.total === 2 && state.inventory.shields < 1)) {
    return reject(state, "You’ve used the rescue attempts for this missed day.");
  }
  if (state.rescueAttempts.total === 2) state.inventory.shields--;
  state.rescueAttempts.total++;
  if (!passGrade(grade)) return reject(state, "A rescue needs a correct explanation and a worked changed case.");
  state.rescued.push(rescue.day);
  state.lastRescueAt = now;
  state.bestStreak = Math.max(state.bestStreak, streakStatus(state, today).streak);
  return say(state, "Streak rescued. The bridged day is marked separately from study days.");
}

function makeQuestProgress(state: HabitsState, id: string, today: number): boolean {
  const quest = HABIT_QUESTS.find(item => item.id === id);
  const progress = state.quests[id];
  if (!quest || !progress || progress.completedAt !== null) return false;
  progress.completedAt = state.checkedAt;
  state.blueprints[quest.kitId] = (state.blueprints[quest.kitId] ?? 0) + quest.blueprints;
  state.inventory.parts += quest.parts;
  state.inventory.sparks++;
  if (!state.ownedKit.includes("star")) state.ownedKit.push("star");
  const weekend = weekendBounty(today, state.zone);
  if (state.dailyBountyClaimed !== today) {
    state.dailyBountyClaimed = today;
    state.inventory.parts += 2;
  }
  if (weekend && state.weekendBountyClaimed !== weekend.id) {
    state.weekendBountyClaimed = weekend.id;
    state.inventory.parts += 4;
  }
  return say(state, "Quest complete. You earned a spark, blueprint pieces, and parts.");
}

function useShortcut(state: HabitsState, grade: HabitsGrade, today: number): boolean {
  const target = grade.target;
  if (!target) return true;
  if (target.kind === "quest" && grade.kind === "assignment") return makeQuestProgress(state, target.id, today);
  if (!state.shortcuts || state.shortcuts.day !== today) state.shortcuts = { day: today, ids: [] };
  const used = state.shortcuts.ids;
  const baseKey = `${target.kind}:${target.id}`;
  const key = `${baseKey}:${grade.objective}`;
  const matched = used.filter(item => item.startsWith(baseKey + ":"));
  if (used.includes(key) || matched.length >= (target.kind === "care" && target.id !== "condition" ? 2 : 1)) return false;
  if (target.kind === "crate" && grade.kind === "repair") {
    const crate = state.crates.find(item => item.id === target.id);
    if (!crate) return false;
    claimCrate(state, crate);
  } else if (target.kind === "shelf" && (grade.kind === "teach" || grade.kind === "transfer")) {
    const keepsake = state.keepsakes.find(item => item.id === target.id && item.dueAt <= state.checkedAt);
    if (!keepsake) return false;
    keepsake.dueAt = state.checkedAt + 6 * DAY_MS;
    state.inventory.polish++;
    state.shelfBonus = { endsAt: state.checkedAt + 48 * HOUR_MS, keepsakeId: keepsake.id };
    state.condition.tune = unit(state.condition.tune + 0.25);
    state.overchargeUntil = state.checkedAt + 120 * 60_000;
    say(state, "Keepsake dusted. Keating is overcharged for two hours or one run.");
  } else if (target.kind === "care" && (target.id === "condition" && (grade.kind === "teach" || grade.kind === "lesson"))) {
    for (const need of NEEDS) state.condition[need] = Math.max(0.75, state.condition[need]);
    if (grade.kind === "teach") state.overchargeUntil = state.checkedAt + 120 * 60_000;
    say(state, "The lesson brought Keating’s condition back up.");
  } else if (target.kind === "care" && ((target.id === "charge" && grade.kind === "micro") || (target.id === "tune" && grade.kind === "repair"))) {
    const need = target.id;
    state.condition[need] = unit(state.condition[need] + CARE[need].gain);
    say(state, need === "charge" ? "Keating’s charge is up." : "Keating is tuned up.");
  } else if (target.kind === "workshop" && (grade.kind === "assignment" || grade.kind === "teach")) {
    const piece = HABIT_KIT.find(kit => kit.id === target.id && kit.parts > 0 && !state.ownedKit.includes(kit.id));
    if (!piece || (state.blueprints[piece.id] ?? 0) < piece.blueprints || piece.parts - state.inventory.parts > 2) return false;
    state.inventory.parts -= Math.max(0, piece.parts - 2);
    state.blueprints[piece.id] -= piece.blueprints;
    state.ownedKit.push(piece.id);
    say(state, `Your learning covered the last parts for ${piece.name}.`);
  } else return false;
  used.push(key);
  return true;
}

function applyGrade(state: HabitsState, command: HabitsGrade, today: number): boolean {
  if (!command.objective.trim() || command.objective.length > 230 || command.rubric.length !== 3
      || !command.rubric.every(value => Number.isInteger(value) && value >= 0 && value <= 2)) return false;
  if (command.kind === "rescue") return rescueStreak(state, command, today);
  if (!passGrade(command)) return reject(state, "Keep working on the reasoning and try the challenge again.");
  const checkedAt = command.attemptedAt ?? state.checkedAt;
  if (!Number.isSafeInteger(checkedAt) || checkedAt < state.activityFloor || checkedAt > state.checkedAt
      || state.checkedAt - checkedAt > 2 * 60_000) return false;
  state.lastResult = "Study recorded.";
  const settled = settleStudy(state, {
    id: command.id, objective: command.objective, family: command.target ? `${command.target.kind}:${command.target.id}` : command.kind,
    checkedAt, mastery: command.rubric.reduce((sum, value) => sum + value, 0) / 6, independentTransfer: command.kind === "transfer",
    ...(command.kind === "lesson" && command.lesson ? {
      sessionId: command.lesson.sessionId.slice(0, 230), lessonTitle: command.lesson.title.trim().slice(0, 128),
    } : {}),
  });
  if (settled && !useShortcut(state, command, today)) return reject(state, "Study recorded. This shortcut is unavailable for the selected item.");
  return settled;
}

export function applyHabitsCommand(state: HabitsState, command: HabitsCommand): boolean {
  const day = habitDay(state.checkedAt, state.zone).day;
  if (command.type === "tone") {
    if (!["off", "gentle", "spirited", "dramatic"].includes(command.value)) return false;
    state.tone = command.value;
    return true;
  }
  if (state.mode === "off") {
    if (command.type === "runEnd" && !command.result.quit) {
      state.recessBest = Math.max(state.recessBest, natural(command.result.score ?? 0, 1_000_000));
      return true;
    }
    return reject(state, "Companion Off pauses habit stakes and care.");
  }
  switch (command.type) {
    case "planRest": {
      const after = calendarDay(command.day);
      if (after === null || after <= day || after > day + 366) return reject(state, "Choose a future study day within the next year.");
      if (!state.rest.includes(after)) state.rest.push(after);
      return say(state, `Rest planned for ${command.day}.`);
    }
    case "pause": {
      const days = natural(command.days, 30);
      if (days === 0) return false;
      state.pauseUntil = habitBoundary(day + days, state.zone);
      return say(state, "The streak and care decay are paused.");
    }
    case "resume":
      state.pauseUntil = null;
      return say(state, "Study habits resumed.");
    case "dismissAway": {
      const away = awayPrompt(state, day, streakStatus(state, day).missed);
      if (!away) return false;
      state.awayDismissals.push(away.stage);
      return true;
    }
    case "care":
      return NEEDS.includes(command.need) && applyCare(state, command.need, false)
        ? say(state, "Keating feels better.")
        : reject(state, "There’s no care resource to use here.");
    case "topUp": {
      const toppedUp = NEEDS.map(need => applyCare(state, need, true)).some(Boolean);
      return toppedUp ? say(state, "Keating is ready for Recess.") : reject(state, "No care resources were needed or available.");
    }
    case "claim": {
      const crate = state.crates.find(item => item.id === command.crateId);
      if (!crate) return reject(state, "That crate has already been claimed or expired.");
      if (crate.unlockAt > state.checkedAt) return reject(state, "This crate is still sealed.");
      return claimCrate(state, crate);
    }
    case "activateWorkshopBonus":
      if (state.inventory.vouchers < 1 || state.workshopBoost) return false;
      state.inventory.vouchers--;
      state.workshopBoost = { endsAt: state.checkedAt + 30 * 60_000, uses: 2 };
      return say(state, "Double Workshop Points for 30 minutes or two qualifying activities.");
    case "acceptQuest": {
      const quest = HABIT_QUESTS.find(item => item.id === command.questId);
      if (!quest || state.quests[quest.id] || (quest.requires && state.quests[quest.requires]?.completedAt == null)) return false;
      state.quests[quest.id] = { acceptedAt: state.checkedAt, completedAt: null };
      return say(state, "Quest accepted. Take the time you need.");
    }
    case "craft": {
      const piece = HABIT_KIT.find(item => item.id === command.kitId && (item.blueprints > 0 || item.parts > 0));
      if (!piece || state.ownedKit.includes(piece.id)) return false;
      if (state.inventory.parts < piece.parts || (piece.blueprints > 0 && (state.blueprints[piece.id] ?? 0) < piece.blueprints)) {
        return reject(state, "This kit piece still needs blueprint pieces or parts.");
      }
      state.inventory.parts -= piece.parts;
      if (piece.blueprints > 0) state.blueprints[piece.id] -= piece.blueprints;
      state.ownedKit.push(piece.id);
      return say(state, `${piece.name} crafted.`);
    }
    case "equip": {
      const piece = HABIT_KIT.find(item => item.id === command.kitId);
      if (!piece || (!state.ownedKit.includes(piece.id) && !(piece.parts === 0 && piece.blueprints === 0 && piece.id === "drone"))) return false;
      if (!state.ownedKit.includes(piece.id)) state.ownedKit.push(piece.id);
      if (state.equippedKit[piece.slot] === piece.id) delete state.equippedKit[piece.slot];
      else state.equippedKit[piece.slot] = piece.id;
      return true;
    }
    case "runEnd": {
      const result = command.result;
      const delta = result.care.chargeDelta;
      const chargeChange = typeof delta === "number" && Number.isFinite(delta)
        ? Math.max(-1, Math.min(1, delta))
        : -Math.min(0.15, unit(result.care.used));
      const change = result.quit ? Math.min(0, chargeChange) : chargeChange;
      if (!result.quit || change < 0) state.overchargeUntil = null;
      state.condition.charge = unit(state.condition.charge + change);
      if (result.quit) return true;
      state.recessBest = Math.max(state.recessBest, natural(result.score ?? 0, 1_000_000));
      if (!state.recessRewards || state.recessRewards.day !== day) state.recessRewards = { day, total: 0 };
      if (state.recessRewards.total < 2) {
        state.inventory.cogs += natural(result.care.cogs, 3);
        state.inventory.sparks += natural(result.care.sparks, 4);
        state.recessRewards.total++;
      }
      return true;
    }
    case "rankedStudy": {
      const { receipt } = command;
      if (!Number.isSafeInteger(receipt.checkedAt) || natural(receipt.points, 80) === 0
          || !receipt.subject.trim() || !receipt.family.trim()) return false;
      return admitPrivateStudy(state, {
        id: `ranking:${receipt.id}`, objective: receipt.subject, family: `ranking:${receipt.family}`,
        checkedAt: receipt.checkedAt, mastery: 1,
      });
    }
    case "grade":
      return applyGrade(state, command, day);
  }
}

export function habitsCommandId(command: HabitsCommand): string | null {
  switch (command.type) {
    case "grade": return `grade:${command.id}`;
    case "rankedStudy": return `ranked:${command.receipt.id}`;
    case "runEnd": return `recess:${command.runId}`;
    default: return null;
  }
}
