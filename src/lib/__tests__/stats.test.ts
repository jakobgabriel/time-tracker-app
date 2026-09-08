import { describe, expect, it } from "vitest";

import { projectColor } from "../colors";
import {
  addDays, addMonths, buckets, daysInMonth, daysTracked, inPreviousRange, inRange,
  monthKey, projectTotals, rangeDays, startOfWeek,
} from "../stats";
import { dayKey, formatShort, localIso, weekKey, withDay, withTime } from "../time";
import type { Entry } from "../types";

// 2026-09-08 is a Tuesday.
const NOW = new Date(2026, 8, 8, 14, 0, 0).getTime();

function entry(day: string, from: string, to: string, project = "Acme"): Entry {
  return {
    id: `${project}-${day}-${from}`,
    project,
    note: "",
    tags: [],
    start: `${day}T${from}:00+02:00`,
    end: `${day}T${to}:00+02:00`,
  };
}

describe("calendar arithmetic", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-09-08")).toBe("2026-09-07"); // Tuesday -> Monday
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07"); // Sunday  -> same Monday
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07");
  });

  it("knows how long a month is, leap years included", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(rangeDays("month", "2026-09-08")).toHaveLength(30);
    expect(rangeDays("week", "2026-09-08")[0]).toBe("2026-09-07");
  });
});

describe("buckets", () => {
  const entries = [
    entry("2026-09-07", "09:00", "11:00"),
    entry("2026-09-08", "09:00", "10:30"),
    entry("2026-08-31", "09:00", "10:00"),
  ];

  it("gives a week seven bars starting on Monday and marks today", () => {
    const week = buckets(entries, "week", NOW);
    expect(week).toHaveLength(7);
    expect(week.map((b) => b.label)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(week[0].seconds).toBe(7200);
    expect(week[1].seconds).toBe(5400);
    expect(week[1].current).toBe(true);
    expect(week[2].seconds).toBe(0);
  });

  it("leaves out days from other months in the month view", () => {
    const month = buckets(entries, "month", NOW);
    expect(month).toHaveLength(30);
    expect(month.reduce((sum, b) => sum + b.seconds, 0)).toBe(7200 + 5400);
  });

  it("labels a month sparsely so the axis stays readable", () => {
    const month = buckets(entries, "month", NOW);
    const labelled = month.filter((b) => b.label !== "").map((b) => b.label);
    expect(labelled).toEqual(["1", "5", "8", "10", "15", "20", "25", "30"]);
  });

  it("rolls up to months for all time and stops at the oldest entry", () => {
    const all = buckets(entries, "all", NOW);
    expect(all.map((b) => b.key)).toEqual(["2026-08", "2026-09"]);
    expect(all[0].seconds).toBe(3600);
    expect(all[1].current).toBe(true);
  });

  it("caps all time at twelve months", () => {
    const old = [entry("2020-01-05", "09:00", "10:00"), entry("2026-09-08", "09:00", "10:00")];
    expect(buckets(old, "all", NOW)).toHaveLength(12);
  });
});

describe("ranges", () => {
  const entries = [
    entry("2026-09-08", "09:00", "10:00"), // this week, this month
    entry("2026-09-02", "09:00", "10:00"), // last week, this month
    entry("2026-08-20", "09:00", "10:00"), // last month
  ];

  it("selects the current week and the one before it", () => {
    expect(inRange(entries, "week", NOW)).toHaveLength(1);
    expect(inPreviousRange(entries, "week", NOW)).toHaveLength(1);
    expect(inPreviousRange(entries, "week", NOW)[0].start).toContain("2026-09-02");
  });

  it("selects the current month and the one before it", () => {
    expect(inRange(entries, "month", NOW)).toHaveLength(2);
    expect(inPreviousRange(entries, "month", NOW)).toHaveLength(1);
    expect(inPreviousRange(entries, "month", NOW)[0].start).toContain("2026-08-20");
  });

  it("has nothing to compare all time against", () => {
    expect(inRange(entries, "all", NOW)).toHaveLength(3);
    expect(inPreviousRange(entries, "all", NOW)).toHaveLength(0);
  });
});

describe("totals", () => {
  const entries = [
    entry("2026-09-08", "09:00", "11:00", "Acme"),
    entry("2026-09-08", "11:00", "12:00", "Admin"),
    entry("2026-09-07", "09:00", "10:00", "Acme"),
  ];

  it("ranks projects and reports their share", () => {
    const totals = projectTotals(entries, NOW);
    expect(totals.map((t) => t.project)).toEqual(["Acme", "Admin"]);
    expect(totals[0].seconds).toBe(10800);
    expect(totals[0].share).toBeCloseTo(0.75);
    expect(totals[1].share).toBeCloseTo(0.25);
  });

  it("counts only days that have time on them", () => {
    expect(daysTracked(entries, NOW)).toBe(2);
    expect(daysTracked([], NOW)).toBe(0);
  });

  it("falls back to a name for an untitled project", () => {
    expect(projectTotals([entry("2026-09-08", "09:00", "10:00", "  ")], NOW)[0].project)
      .toBe("Untitled");
  });

  it("counts a running entry up to now", () => {
    const running: Entry = { ...entry("2026-09-08", "13:00", "14:00"), end: null };
    // Started 13:00 +02:00; NOW is 14:00 local in the test environment's zone,
    // so only the sign matters here, not the exact figure.
    expect(projectTotals([running], NOW)[0].seconds).toBeGreaterThan(0);
  });
});

describe("supporting helpers", () => {
  it("derives a stable, non-purple colour per project", () => {
    expect(projectColor("Acme")).toBe(projectColor("acme "));
    expect(projectColor("Acme")).not.toBe(projectColor("Admin"));
    expect(projectColor("")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps day and week keys aligned with the local calendar", () => {
    expect(monthKey("2026-09-08")).toBe("2026-09");
    expect(dayKey("2026-09-08T00:30:00+09:00")).toBe("2026-09-08");
    expect(weekKey("2026-09-08")).toBe(weekKey("2026-09-13"));
    expect(weekKey("2026-09-08")).not.toBe(weekKey("2026-09-14"));
  });

  it("edits a timestamp without disturbing its offset", () => {
    expect(withTime("2026-09-08T09:00:00+02:00", "13:45")).toBe("2026-09-08T13:45:00+02:00");
    expect(withDay("2026-09-08T09:00:00+02:00", "2026-10-01")).toBe("2026-10-01T09:00:00+02:00");
  });

  it("formats durations the way the UI shows them", () => {
    expect(formatShort(0)).toBe("0m");
    expect(formatShort(5400)).toBe("1h 30m");
    expect(dayKey(localIso(new Date(NOW)))).toBe("2026-09-08");
  });
});
