/**
 * Auto-slot algorithm for bulk scheduling.
 *
 * Given a brand's posting preferences (timezone, slot times, allowed weekdays,
 * max posts per day) and the set of already-scheduled times, assign the next N
 * posts to the earliest free slots — starting tomorrow in the brand's timezone.
 * All returned times are UTC Dates.
 */

import { localWallTimeToUtc, wallPartsInZone } from "./tz";

export type PostingPrefs = {
  timezone: string;
  slotTimes: string[]; // "HH:MM" in brand tz, ascending
  daysOfWeek: number[]; // 0=Sun … 6=Sat
  maxPerDay: number;
};

export const DEFAULT_PREFS: PostingPrefs = {
  timezone: "Australia/Sydney",
  slotTimes: ["09:00", "17:00"],
  daysOfWeek: [1, 2, 3, 4, 5], // Mon–Fri
  maxPerDay: 1,
};

/** True if the string is an IANA zone this runtime can actually resolve. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise a slot time to zero-padded "HH:MM".
 *
 * computeSlots builds its occupancy keys zero-padded, so an un-padded "9:00"
 * would never match an existing "09:00" — the same wall-clock minute could be
 * booked twice. Returns null for anything that isn't a real time of day.
 */
function normalizeSlotTime(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Merge stored (partial) prefs from brands.settings.posting over the defaults.
 *
 * Every branch re-falls-back to the default when validation empties a list.
 * The old code checked `.length` BEFORE filtering, so a value like
 * `daysOfWeek: [7]` or `slotTimes: ["9am"]` survived the guard, filtered to
 * `[]`, and silently dropped the brand out of scheduling and monthly plans.
 */
export function resolvePrefs(raw: unknown): PostingPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<PostingPrefs>;

  const slotTimes = Array.isArray(p.slotTimes)
    ? Array.from(new Set(p.slotTimes.map(normalizeSlotTime).filter((s): s is string => !!s)))
        // Sort chronologically. A lexicographic sort put "9:00" after "17:00".
        .sort((a, b) => a.localeCompare(b))
    : [];

  const daysOfWeek = Array.isArray(p.daysOfWeek)
    ? Array.from(new Set(p.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort(
        (a, b) => a - b
      )
    : [];

  const tz = typeof p.timezone === "string" ? p.timezone.trim() : "";

  return {
    // An unresolvable zone would throw a RangeError deep inside Intl at
    // schedule time; fall back rather than 500 the whole run.
    timezone: tz && isValidTimeZone(tz) ? tz : DEFAULT_PREFS.timezone,
    slotTimes: slotTimes.length ? slotTimes : DEFAULT_PREFS.slotTimes,
    daysOfWeek: daysOfWeek.length ? daysOfWeek : DEFAULT_PREFS.daysOfWeek,
    maxPerDay:
      Number.isInteger(p.maxPerDay) && (p.maxPerDay as number) > 0
        ? (p.maxPerDay as number)
        : DEFAULT_PREFS.maxPerDay,
  };
}

/**
 * Compute N free UTC slot times.
 *
 * @param count number of slots to allocate
 * @param prefs brand posting preferences
 * @param occupiedUtc already-scheduled UTC times for this brand (future)
 * @param now current instant (injected for testability)
 */
export function computeSlots(
  count: number,
  prefs: PostingPrefs,
  occupiedUtc: Date[],
  now: Date
): Date[] {
  const results: Date[] = [];
  if (count <= 0) return results;

  // Count how many are already taken per local calendar day, and remember the
  // exact wall-clock "HH:MM" taken on each day so we don't double-book a slot.
  const takenByDay = new Map<string, Set<string>>();
  for (const d of occupiedUtc) {
    const w = wallPartsInZone(d, prefs.timezone);
    const dayKey = `${w.year}-${w.month}-${w.day}`;
    const hm = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
    if (!takenByDay.has(dayKey)) takenByDay.set(dayKey, new Set());
    takenByDay.get(dayKey)!.add(hm);
  }

  // Start from tomorrow (brand-local) to avoid same-day surprises.
  const startParts = wallPartsInZone(now, prefs.timezone);
  const cursor = { year: startParts.year, month: startParts.month, day: startParts.day };
  advanceDay(cursor); // begin tomorrow

  let safety = 0;
  const MAX_DAYS = 400;
  while (results.length < count && safety < MAX_DAYS) {
    safety++;
    // What weekday is this local calendar day? Resolve via a midday instant.
    const middayUtc = localWallTimeToUtc(cursor.year, cursor.month, cursor.day, 12, 0, prefs.timezone);
    const weekday = wallPartsInZone(middayUtc, prefs.timezone).weekday;

    if (prefs.daysOfWeek.includes(weekday)) {
      const dayKey = `${cursor.year}-${cursor.month}-${cursor.day}`;
      const taken = takenByDay.get(dayKey) || new Set<string>();
      let placedToday = taken.size;
      for (const hm of prefs.slotTimes) {
        if (results.length >= count) break;
        if (placedToday >= prefs.maxPerDay) break;
        if (taken.has(hm)) continue;
        const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
        const utc = localWallTimeToUtc(cursor.year, cursor.month, cursor.day, h, m, prefs.timezone);
        if (utc.getTime() <= now.getTime()) continue; // never schedule in the past
        results.push(utc);
        taken.add(hm);
        placedToday++;
      }
    }
    advanceDay(cursor);
  }

  return results;
}

function advanceDay(c: { year: number; month: number; day: number }): void {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day));
  d.setUTCDate(d.getUTCDate() + 1);
  c.year = d.getUTCFullYear();
  c.month = d.getUTCMonth() + 1;
  c.day = d.getUTCDate();
}
