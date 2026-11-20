export type HabitsMode = "lively" | "calm" | "off";
export type AwayTone = "off" | "gentle" | "spirited" | "dramatic";
export type CareNeed = "charge" | "tune" | "shine";
export type CareCondition = Record<CareNeed, number>;
export type CrateRarity = "common" | "uncommon" | "rare" | "masterwork";
export type LessonGradeKind = "micro" | "repair" | "teach" | "lesson" | "assignment" | "transfer" | "rescue";
export type Rubric = readonly [number, number, number];

export interface HabitCrate {
  id: string;
  rarity: CrateRarity;
  unlockAt: number;
  expiresAt: number;
}

export interface RankedHabitReceipt {
  id: string;
  subject: string;
  family: string;
  checkedAt: number;
  points: number;
}

export interface HabitKeepsake {
  id: string;
  title: string;
  sessionId?: string;
  dueAt: number;
  dusty: boolean;
}

export interface HabitQuestProgress {
  acceptedAt: number;
  completedAt: number | null;
}

export interface HabitInventory {
  sparks: number;
  cogs: number;
  polish: number;
  parts: number;
  shards: number;
  shields: number;
  vouchers: number;
}

export interface HabitsSnapshot {
  scope: string;
  day: string;
  dayEndsAt: number;
  streak: number;
  bestStreak: number;
  totalStudyDays: number;
  actualStudyDays: string[];
  rescuedDays: string[];
  studiedToday: boolean;
  rescueUntil: number | null;
  rescueObjective: string | null;
  pauseUntil: number | null;
  restDays: string[];
  tone: AwayTone;
  away: { message: string; stage: "wobble" | "snuffed" | "dusty" | "sheet" } | null;
  condition: CareCondition;
  inventory: HabitInventory;
  crates: HabitCrate[];
  keepsakes: HabitKeepsake[];
  quests: Record<string, HabitQuestProgress>;
  blueprints: Record<string, number>;
  ownedKit: string[];
  equippedKit: Record<string, string>;
  collectedFinishes: string[];
  collectedTints: string[];
  collectedRelics: string[];
  workshopLP: number;
  overchargeUntil: number | null;
  shelfBonusUntil: number | null;
  dailyBountyUntil: number | null;
  weekendBountyUntil: number | null;
  recessBest: number;
  lastResult: string;
}

export interface HabitsDispatchResult extends HabitsSnapshot {
  outcome: "accepted" | "rejected" | "replayed";
  accepted: boolean;
}

export interface HabitsGrade {
  type: "grade";
  scope: string;
  id: string;
  objective: string;
  kind: LessonGradeKind;
  rubric: Rubric;
  target?: { kind: "quest" | "crate" | "shelf" | "care" | "workshop"; id: string };
  attemptedAt?: number;
  lesson?: { sessionId: string; title: string };
}

export type HabitsCommand =
  | { type: "tone"; value: AwayTone }
  | { type: "planRest"; day: string }
  | { type: "pause"; days: number }
  | { type: "resume" }
  | { type: "dismissAway" }
  | { type: "care"; need: CareNeed }
  | { type: "topUp" }
  | { type: "claim"; crateId: string }
  | { type: "activateWorkshopBonus" }
  | { type: "acceptQuest"; questId: string }
  | { type: "craft"; kitId: string }
  | { type: "equip"; kitId: string }
  | { type: "runEnd"; runId: string; result: { quit: boolean; score?: number; care: { used: number; cogs: number; sparks: number } } }
  | { type: "rankedStudy"; scope: string; receipt: RankedHabitReceipt }
  | HabitsGrade;
