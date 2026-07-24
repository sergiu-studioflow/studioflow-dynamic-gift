/**
 * Timezone helpers for the posting scheduler.
 *
 * All `scheduled_at` values are stored in UTC. The brand's display/scheduling
 * timezone is an IANA name (e.g. "Australia/Sydney", "Australia/Brisbane") so
 * DST is handled correctly — Sydney flips AEST(+10)/AEDT(+11); Brisbane never
 * does. We NEVER hardcode a fixed offset.
 *
 * Zero dependencies — uses Intl.DateTimeFormat to resolve the offset at a given
 * instant, which is DST-correct.
 */

/**
 * Return the offset (in minutes, east-positive) of an IANA timezone at a given
 * UTC instant. e.g. Sydney in January (AEDT) → +660.
 */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  // Format the instant in the target zone, parse the wall-clock back to a UTC
  // timestamp, and diff. This resolves DST at that instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/**
 * Convert a wall-clock date/time in a given IANA zone to a UTC Date.
 * e.g. localWallTimeToUtc(2026, 10, 4, 9, 0, "Australia/Sydney").
 * Iterates once to settle DST boundaries (spring-forward / fall-back).
 */
export function localWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  // First guess: treat the wall time as if it were UTC, then subtract the
  // offset at that guessed instant. One correction pass settles DST edges.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(new Date(utc), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    utc = guess - offset * 60000;
  }
  return new Date(utc);
}

/** The Y/M/D wall-clock parts of a UTC instant, as seen in the given zone. */
export function wallPartsInZone(
  instant: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

/** Format a UTC instant for display in the brand zone (e.g. "Mon 4 Aug, 9:00 AM"). */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}
