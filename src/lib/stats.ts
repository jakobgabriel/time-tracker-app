import { dayKey, dayParts, entrySeconds, localIso } from "./time";
import type { Entry } from "./types";

export type Range = "week" | "month" | "all";

export type Bucket = {
  key: string;
  /** Single character or short label under the bar. */
  label: string;
  seconds: number;
  /** The bucket the user is living in right now. */
  current: boolean;
};

export type ProjectTotal = {
  project: string;
  seconds: number;
  /** 0–1 of the range's total, for the proportion bar. */
  share: number;
};

const pad = (value: number) => String(value).padStart(2, "0");
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export const monthKey = (day: string) => day.slice(0, 7);

export function addDays(day: string, count: number): string {
  const date = dayParts(day).date;
  date.setDate(date.getDate() + count);
  return dayKey(localIso(date));
}

/** Monday, because that is what a week looks like on a European calendar. */
export function startOfWeek(day: string): string {
  const date = dayParts(day).date;
  return addDays(day, -((date.getDay() + 6) % 7));
}

export function addMonths(month: string, count: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1 + count, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [year, index] = month.split("-").map(Number);
  return new Date(year, index, 0).getDate();
}

/** The day keys a range covers, oldest first. `all` is handled per month. */
export function rangeDays(range: Exclude<Range, "all">, today: string): string[] {
  if (range === "week") {
    const monday = startOfWeek(today);
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }
  const month = monthKey(today);
  return Array.from({ length: daysInMonth(month) }, (_, index) => `${month}-${pad(index + 1)}`);
}

function secondsByDay(entries: Entry[], nowMs: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = dayKey(entry.start);
    totals.set(key, (totals.get(key) ?? 0) + entrySeconds(entry, nowMs));
  }
  return totals;
}

/** Bars for the chart: one per day for week/month, one per month for all. */
export function buckets(entries: Entry[], range: Range, nowMs: number): Bucket[] {
  const today = dayKey(localIso(new Date(nowMs)));
  const byDay = secondsByDay(entries, nowMs);

  if (range === "all") {
    const totals = new Map<string, number>();
    for (const [day, seconds] of byDay) {
      const month = monthKey(day);
      totals.set(month, (totals.get(month) ?? 0) + seconds);
    }
    const current = monthKey(today);
    const oldest = [...totals.keys()].sort()[0] ?? current;
    // At most twelve months, and never fewer than the months with data.
    const months: string[] = [];
    let cursor = current;
    while (months.length < 12 && cursor >= oldest) {
      months.unshift(cursor);
      cursor = addMonths(cursor, -1);
    }
    return months.map((month) => ({
      key: month,
      label: MONTH_LETTERS[Number(month.slice(5)) - 1],
      seconds: totals.get(month) ?? 0,
      current: month === current,
    }));
  }

  return rangeDays(range, today).map((day) => {
    const parts = dayParts(day);
    // A month has too many bars to label them all: keep the 1st, every fifth
    // day and today, and let the rest breathe.
    const monthLabel =
      parts.day === 1 || parts.day % 5 === 0 || day === today ? String(parts.day) : "";
    return {
      key: day,
      label: range === "week" ? DAY_LETTERS[parts.date.getDay()] : monthLabel,
      seconds: byDay.get(day) ?? 0,
      current: day === today,
    };
  });
}

/** The entries a range covers — `all` covers everything. */
export function inRange(entries: Entry[], range: Range, nowMs: number): Entry[] {
  if (range === "all") return entries;
  const today = dayKey(localIso(new Date(nowMs)));
  const days = new Set(rangeDays(range, today));
  return entries.filter((entry) => days.has(dayKey(entry.start)));
}

/** The same range, one period earlier — what "vs last week" compares against. */
export function inPreviousRange(entries: Entry[], range: Range, nowMs: number): Entry[] {
  const today = dayKey(localIso(new Date(nowMs)));
  if (range === "all") return [];
  const days =
    range === "week"
      ? new Set(rangeDays("week", addDays(today, -7)))
      : new Set(rangeDays("month", `${addMonths(monthKey(today), -1)}-01`));
  return entries.filter((entry) => days.has(dayKey(entry.start)));
}

export function projectTotals(entries: Entry[], nowMs: number): ProjectTotal[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const project = entry.project.trim() || "Untitled";
    totals.set(project, (totals.get(project) ?? 0) + entrySeconds(entry, nowMs));
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([project, seconds]) => ({ project, seconds, share: sum ? seconds / sum : 0 }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Days with any tracked time — the denominator for a meaningful average. */
/** Closed entries whose interval overlaps `entry`, ignoring the entry itself. */
export function overlapping(entry: Entry, entries: Entry[]): Entry[] {
  if (!entry.end) return [];
  const from = new Date(entry.start).getTime();
  const to = new Date(entry.end).getTime();
  return entries.filter((other) => {
    if (other.id === entry.id || !other.end) return false;
    const otherFrom = new Date(other.start).getTime();
    const otherTo = new Date(other.end).getTime();
    // Touching at an endpoint is not an overlap: 09:00–10:00 and 10:00–11:00
    // are exactly how a day is meant to look.
    return otherFrom < to && from < otherTo;
  });
}

/** Pinned projects first, in the order they were pinned; then by recency. */
export function orderedProjects(projects: string[], pinned: string[]): string[] {
  const isPinned = (name: string) =>
    pinned.findIndex((p) => p.toLowerCase() === name.toLowerCase());
  return [...projects].sort((a, b) => {
    const [ap, bp] = [isPinned(a), isPinned(b)];
    if (ap === -1 && bp === -1) return 0; // both unpinned: keep recency order
    if (ap === -1) return 1;
    if (bp === -1) return -1;
    return ap - bp;
  });
}

/** Every tag used by these entries, most used first. */
export function tagsUsed(entries: Entry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const clean = tag.trim();
      if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

export function daysTracked(entries: Entry[], nowMs: number): number {
  return [...secondsByDay(entries, nowMs).values()].filter((seconds) => seconds > 0).length;
}

export type DayBlock = { entry: Entry; from: number; to: number };
export type DayGap = { from: number; to: number; fromTime: string; toTime: string };

export type DayTimeline = {
  /** Window shown, in minutes since midnight. */
  start: number;
  end: number;
  blocks: DayBlock[];
  /** Untracked stretches worth offering to fill. */
  gaps: DayGap[];
  trackedSeconds: number;
  gapSeconds: number;
};

const MINUTES_IN = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const clockOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Gaps shorter than this are noise between two sessions, not lost work. */
const MIN_GAP_MINUTES = 10;

/**
 * Lays a day out on a single strip: where the tracked blocks sit and which
 * stretches are still empty. Gaps are what makes it useful — they are the
 * hours you meant to track and didn't.
 */
export function dayTimeline(entries: Entry[], day: string, nowMs: number): DayTimeline {
  const ofDay = entries
    .filter((entry) => dayKey(entry.start) === day)
    .sort((a, b) => a.start.localeCompare(b.start));

  const nowIso = localIso(new Date(nowMs));
  const nowMinutes = dayKey(nowIso) === day ? MINUTES_IN(nowIso) : 24 * 60;

  const spans = ofDay.map((entry) => ({
    entry,
    from: MINUTES_IN(entry.start),
    // A running timer reaches up to now; one that crossed midnight stops there.
    to: entry.end
      ? dayKey(entry.end) === day
        ? MINUTES_IN(entry.end)
        : 24 * 60
      : Math.max(nowMinutes, MINUTES_IN(entry.start)),
  }));

  // A working day by default, widened to fit whatever actually happened.
  let start = 8 * 60;
  let end = 18 * 60;
  for (const span of spans) {
    start = Math.min(start, Math.floor(span.from / 60) * 60);
    end = Math.max(end, Math.ceil(span.to / 60) * 60);
  }
  end = Math.min(end, 24 * 60);

  const gaps: DayGap[] = [];
  let cursor = start;
  for (const span of spans) {
    if (span.from - cursor >= MIN_GAP_MINUTES) {
      gaps.push({
        from: cursor,
        to: span.from,
        fromTime: clockOf(cursor),
        toTime: clockOf(span.from),
      });
    }
    cursor = Math.max(cursor, span.to);
  }
  // The stretch after the last entry only counts as a gap once it is past.
  const tail = Math.min(end, dayKey(nowIso) === day ? nowMinutes : end);
  if (tail - cursor >= MIN_GAP_MINUTES) {
    gaps.push({ from: cursor, to: tail, fromTime: clockOf(cursor), toTime: clockOf(tail) });
  }

  return {
    start,
    end,
    blocks: spans,
    gaps,
    trackedSeconds: ofDay.reduce((sum, entry) => sum + entrySeconds(entry, nowMs), 0),
    gapSeconds: gaps.reduce((sum, gap) => sum + (gap.to - gap.from) * 60, 0),
  };
}
