export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();
const boundaryCache = new Map<string, number>();

function formatter(zone: string): Intl.DateTimeFormat {
  let current = formatters.get(zone);
  if (!current) {
    current = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(zone, current);
  }
  return current;
}

export function habitTimeZone(zone?: string): string {
  try {
    return formatter(zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function localTime(ms: number, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(ms).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && dayName(ms / DAY_MS) === value ? ms / DAY_MS : null;
}

export function dayName(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Resolve a wall-clock boundary using both offsets around a clock change. */
export function habitBoundary(day: number, zone: string, hour = 4): number {
  const key = JSON.stringify([zone, day, hour]);
  const cached = boundaryCache.get(key);
  if (cached !== undefined) return cached;
  const wall = day * DAY_MS + hour * HOUR_MS;
  const probes = [wall - DAY_MS, wall, wall + DAY_MS];
  const instants = probes.map(probe => wall - (localTime(probe, zone) - probe)).sort((a, b) => a - b);
  const actual = instants.find(value => localTime(value, zone) === wall)
    ?? instants.find(value => localTime(value, zone) > wall)
    ?? instants[instants.length - 1];
  if (boundaryCache.size >= 512) boundaryCache.clear();
  boundaryCache.set(key, actual);
  return actual;
}

export function habitDay(now: number, zone: string) {
  const localDay = Math.floor(localTime(now, zone) / DAY_MS);
  const day = now < habitBoundary(localDay, zone) ? localDay - 1 : localDay;
  return { day, label: dayName(day), start: habitBoundary(day, zone), end: habitBoundary(day + 1, zone) };
}

export function weekendBounty(day: number, zone: string) {
  const weekday = new Date(day * DAY_MS).getUTCDay();
  if (weekday !== 6 && weekday !== 0) return null;
  const startDay = weekday === 6 ? day : day - 1;
  return { id: startDay, end: habitBoundary(startDay + 2, zone) };
}
