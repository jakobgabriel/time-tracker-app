import type { Entry } from "./types";

const pad = (value: number, width = 2) =>
  String(Math.abs(Math.trunc(value))).padStart(width, "0");

/**
 * RFC 3339 with the device's own UTC offset, e.g. `2026-09-08T09:00:00+02:00`.
 *
 * Storing the offset rather than UTC means "which day was this?" stays a string
 * operation on both sides — no timezone database, no drift when travelling.
 */
export function localIso(date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** `YYYY-MM-DD` as the user experienced it. */
export const dayKey = (iso: string) => iso.slice(0, 10);

/** `HH:MM` as the user experienced it. */
export const hhmm = (iso: string) => iso.slice(11, 16);

export const ms = (iso: string) => new Date(iso).getTime();

export function entrySeconds(entry: Entry, nowMs = Date.now()): number {
  const end = entry.end ? ms(entry.end) : nowMs;
  return Math.max(0, Math.round((end - ms(entry.start)) / 1000));
}

export function totalSeconds(entries: Entry[], nowMs = Date.now()): number {
  return entries.reduce((sum, entry) => sum + entrySeconds(entry, nowMs), 0);
}

/** `1:02:33` — the running timer, where seconds matter. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `${hours}:${pad(minutes)}:${pad(s % 60)}`;
}

/** `1h 30m` — every summary, where seconds are noise. */
export function formatShort(seconds: number): string {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m`;
}

export function formatDecimal(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(2);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Reads a `YYYY-MM-DD` key without letting the browser shift it by a timezone. */
export function dayParts(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { date: new Date(year, month - 1, day), year, month, day };
}

export function dayLabel(key: string, today = dayKey(localIso())): string {
  if (key === today) return "Today";
  const { date } = dayParts(key);
  const yesterday = new Date(dayParts(today).date);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(localIso(yesterday))) return "Yesterday";
  const { month, day } = dayParts(key);
  return `${WEEKDAYS[date.getDay()]}, ${day} ${MONTHS[month - 1]}`;
}

/** ISO week key (`2026-W37`) so weekly totals match what a calendar shows. */
export function weekKey(key: string): string {
  const { date } = dayParts(key);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Thursday decides the week's year, per ISO 8601.
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getFullYear()}-W${pad(week)}`;
}

export function groupByDay(entries: Entry[]): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.start);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** Splices `HH:MM` into an existing timestamp, keeping its date and offset. */
export function withTime(iso: string, time: string): string {
  return `${iso.slice(0, 11)}${time}:00${iso.slice(19)}`;
}

/** Splices `YYYY-MM-DD` into an existing timestamp, keeping its clock and offset. */
export function withDay(iso: string, day: string): string {
  return `${day}${iso.slice(10)}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - ms(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
