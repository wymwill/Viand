/**
 * A deliberately small subset of OSM's `opening_hours` language. The full
 * grammar includes public and school holidays, calendar ranges, sun-relative
 * times, comments, and double-pipe fallbacks; the maintained npm package pulls
 * in real complexity to support edge cases this product does not need. This
 * subset covers the vast majority of restaurant listings, while anything else
 * fails safe to "unverified" rather than inviting a guess about whether a
 * restaurant is open.
 */

export type OpenStatus = "open" | "closed" | "unverified";

const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

interface TimeRange {
  start: number;
  end: number;
}

type DaySpec = readonly TimeRange[] | "closed" | undefined;

function parseDays(raw: string): number[] | null {
  if (raw === "") return DAYS.map((_, index) => index);

  const selected = new Set<number>();
  for (const part of raw.split(",")) {
    const match = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!match) return null;
    const start = DAYS.indexOf(match[1] as (typeof DAYS)[number]);
    const end = match[2] ? DAYS.indexOf(match[2] as (typeof DAYS)[number]) : start;
    for (let offset = 0; offset < DAYS.length; offset += 1) {
      const day = (start + offset) % DAYS.length;
      selected.add(day);
      if (day === end) break;
    }
  }
  return [...selected];
}

function minutes(hour: string, minute: string): number | null {
  const hours = Number(hour);
  const minutesPart = Number(minute);
  if (hours > 24 || minutesPart > 59 || (hours === 24 && minutesPart !== 0)) return null;
  return hours * 60 + minutesPart;
}

function parseTimes(raw: string): TimeRange[] | "closed" | null {
  if (raw === "off" || raw === "closed") return "closed";

  const ranges: TimeRange[] = [];
  for (const part of raw.split(",")) {
    const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(part);
    const [, startHour, startMinute, endHour, endMinute] = match ?? [];
    if (
      startHour == null ||
      startMinute == null ||
      endHour == null ||
      endMinute == null
    ) {
      return null;
    }
    const start = minutes(startHour, startMinute);
    const end = minutes(endHour, endMinute);
    if (start == null || end == null || start === DAY_MINUTES) return null;
    ranges.push({ start, end });
  }
  return ranges.length > 0 ? ranges : null;
}

/** Evaluates supported hours against the explicitly supplied wall clock. */
export function evaluateOpeningHours(
  raw: string | null | undefined,
  now: Date,
): OpenStatus {
  const value = raw?.replace(/\s/g, "");
  if (!value) return "unverified";
  if (value === "24/7") return "open";

  const specs: DaySpec[] = Array.from({ length: DAYS.length });
  for (const rule of value.split(";")) {
    if (!rule) return "unverified";
    const match = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)?(.+)$/.exec(
      rule,
    );
    if (!match) return "unverified";
    const timesPart = match[2];
    if (timesPart == null) return "unverified";
    const days = parseDays(match[1] ?? "");
    const times = parseTimes(timesPart);
    if (!days || !times) return "unverified";
    for (const day of days) specs[day] = times;
  }

  // JavaScript numbers Sunday as zero; the weekly representation starts Monday.
  const weekday = (now.getDay() + 6) % 7;
  const point = weekday * DAY_MINUTES + now.getHours() * 60 + now.getMinutes();

  for (let day = 0; day < specs.length; day += 1) {
    const spec = specs[day];
    if (!spec || spec === "closed") continue;
    for (const range of spec) {
      const start = day * DAY_MINUTES + range.start;
      const duration = (range.end - range.start + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES;
      const elapsed = (point - start + WEEK_MINUTES) % WEEK_MINUTES;
      if (elapsed < duration) return "open";
    }
  }
  return "closed";
}
