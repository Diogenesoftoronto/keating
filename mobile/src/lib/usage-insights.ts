import type { SessionStartActivity, TopicActivity } from "./usage-summary";

export interface ActivityDay {
  key: string;
  year: number;
  month: number;
  day: number;
  weekday: number;
  count: number;
  sessions: SessionStartActivity[];
}

export interface ActivityCalendar {
  year: number;
  leadingEmptyDays: number;
  maxCount: number;
  days: ActivityDay[];
}

export interface TopicSlice {
  key: string;
  label: string;
  source: string;
  count: number;
  share: number;
  turns: number;
  lastStudiedAt: number;
}

function timestampParts(timestamp: number, timeZone?: string): { year: number; month: number; day: number } {
  if (!Number.isFinite(timestamp)) throw new Error("Activity timestamp must be finite.");
  if (!timeZone) {
    const date = new Date(timestamp);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function activityYears(sessionStarts: SessionStartActivity[], timeZone?: string): number[] {
  const years = new Set<number>();
  for (const session of sessionStarts) years.add(timestampParts(session.startedAt, timeZone).year);
  return [...years].sort((left, right) => right - left);
}

/** Build the full Jan 1 to Dec 31 grid used by the GitHub-style activity view. */
export function buildActivityCalendar(
  year: number,
  sessionStarts: SessionStartActivity[],
  timeZone?: string,
): ActivityCalendar {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) throw new Error("Activity year is invalid.");
  const sessionsByDay = new Map<string, SessionStartActivity[]>();
  for (const session of sessionStarts) {
    const parts = timestampParts(session.startedAt, timeZone);
    if (parts.year !== year) continue;
    const key = dayKey(parts.year, parts.month, parts.day);
    const sessions = sessionsByDay.get(key) ?? [];
    sessions.push(session);
    sessionsByDay.set(key, sessions);
  }

  const daysInYear = isLeapYear(year) ? 366 : 365;
  const days: ActivityDay[] = [];
  for (let offset = 0; offset < daysInYear; offset += 1) {
    const date = new Date(Date.UTC(year, 0, 1 + offset));
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const key = dayKey(year, month, day);
    const sessions = [...(sessionsByDay.get(key) ?? [])].sort((left, right) => right.startedAt - left.startedAt);
    days.push({ key, year, month, day, weekday: date.getUTCDay(), count: sessions.length, sessions });
  }

  return {
    year,
    leadingEmptyDays: new Date(Date.UTC(year, 0, 1)).getUTCDay(),
    maxCount: days.reduce((max, day) => Math.max(max, day.count), 0),
    days,
  };
}

export function buildTopicSlices(topics: TopicActivity[], limit = 8): TopicSlice[] {
  const meaningful = topics
    .filter((topic) => topic.occurrences > 0)
    .sort((left, right) =>
      right.occurrences - left.occurrences
      || right.turns - left.turns
      || left.label.localeCompare(right.label));
  const visible = meaningful.slice(0, Math.max(1, limit));
  const hidden = meaningful.slice(visible.length);
  const total = meaningful.reduce((sum, topic) => sum + topic.occurrences, 0);
  const slices: TopicSlice[] = visible.map((topic) => ({
    key: topic.key,
    label: topic.label,
    source: topic.source,
    count: topic.occurrences,
    share: total ? topic.occurrences / total : 0,
    turns: topic.turns,
    lastStudiedAt: topic.lastStudiedAt,
  }));
  if (hidden.length) {
    slices.push({
      key: "other",
      label: "Other topics",
      source: "recorded evidence",
      count: hidden.reduce((sum, topic) => sum + topic.occurrences, 0),
      share: total ? hidden.reduce((sum, topic) => sum + topic.occurrences, 0) / total : 0,
      turns: hidden.reduce((sum, topic) => sum + topic.turns, 0),
      lastStudiedAt: Math.max(...hidden.map((topic) => topic.lastStudiedAt)),
    });
  }
  return slices;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
