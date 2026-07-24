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

/** Merge stored (partial) prefs from brands.settings.posting over the defaults. */
export function resolvePrefs(raw: unknown): PostingPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<PostingPrefs>;
  const slotTimes = Array.isArray(p.slotTimes) && p.slotTimes.length
    ? p.slotTimes.filter((s) => /^\d{1,2}:\d{2}$/.test(s)).sort()
    : DEFAULT_PREFS.slotTimes;
  const daysOfWeek = Array.isArray(p.daysOfWeek) && p.daysOfWeek.length
    ? p.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : DEFAULT_PREFS.daysOfWeek;
  return {
    timezone: typeof p.timezone === "string" && p.timezone ? p.timezone : DEFAULT_PREFS.timezone,
    slotTimes,
    daysOfWeek,
    maxPerDay: Number.isInteger(p.maxPerDay) && (p.maxPerDay as number) > 0 ? (p.maxPerDay as number) : DEFAULT_PREFS.maxPerDay,
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
