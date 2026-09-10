import { overlapping } from "./stats";
import type { Entry, Settings } from "./types";

export type IssueKind = "overlap" | "long" | "unnamed" | "empty" | "future";

export type Issue = {
  kind: IssueKind;
  /** The entry to open when the issue is tapped. */
  entry: Entry;
  /** Filled in for an overlap: what it collides with. */
  other?: Entry;
};

/**
 * Everything in the history that does not look like a day someone worked.
 *
 * These are not style opinions — each one is a shape that the app itself will
 * report wrongly. Two entries over the same hour make a day add up to more
 * than it was; a session with no end typed in reads as a mis-tap. Time entered
 * by hand and time imported from another tracker are where they come from, so
 * the check runs over everything rather than the visible range.
 *
 * A running timer is never an issue: it is not a fact yet.
 */
export function review(entries: Entry[], settings: Settings, nowMs: number): Issue[] {
  const issues: Issue[] = [];
  const closed = entries.filter((entry) => entry.end);
  const maxSeconds = settings.maxSessionMinutes * 60;
  const seen = new Set<string>();

  for (const entry of closed) {
    const from = new Date(entry.start).getTime();
    const to = new Date(entry.end as string).getTime();

    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

    if (to <= from) {
      issues.push({ kind: "empty", entry });
      continue; // nothing else can be said about an interval that is not one
    }

    if (from > nowMs) {
      issues.push({ kind: "future", entry });
    }

    if (!entry.project.trim()) {
      issues.push({ kind: "unnamed", entry });
    }

    // A limit of zero means the user turned the check off.
    if (maxSeconds > 0 && (to - from) / 1000 > maxSeconds) {
      issues.push({ kind: "long", entry });
    }

    for (const other of overlapping(entry, closed)) {
      // One collision, reported once, against the entry that starts later —
      // that is the one whose start is usually the thing to correct.
      const pair = [entry.id, other.id].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const later = new Date(other.start).getTime() > from ? other : entry;
      const earlier = later === entry ? other : entry;
      issues.push({ kind: "overlap", entry: later, other: earlier });
    }
  }

  // Newest first: a mistake made today is the one worth fixing now.
  return issues.sort((a, b) => b.entry.start.localeCompare(a.entry.start));
}
