import { describe, expect, it } from "vitest";

import { projectColor } from "../colors";
import { amountOf, anyRates, formatMoney, rateFor, totalAmount } from "../money";
import {
  addDays, addMonths, buckets, consistency, dayTimeline, daysInMonth, daysTracked, inPreviousRange, inRange,
  monthKey, orderedProjects, overlapping, projectTotals, rangeDays, startOfWeek, tagsUsed,
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

describe("the day timeline", () => {
  const day = "2026-09-08";
  // Mid-afternoon, so "now" sits inside the working window.
  const afternoon = new Date(2026, 8, 8, 15, 0, 0).getTime();

  it("shows a working day even when nothing was tracked", () => {
    const empty = dayTimeline([], day, afternoon);
    expect([empty.start, empty.end]).toEqual([8 * 60, 18 * 60]);
    expect(empty.blocks).toHaveLength(0);
  });

  it("widens the window to fit early and late work", () => {
    const early = dayTimeline([entry(day, "06:20", "07:00")], day, afternoon);
    expect(early.start).toBe(6 * 60);
    const late = dayTimeline([entry(day, "20:00", "21:40")], day, afternoon);
    expect(late.end).toBe(22 * 60);
  });

  it("finds the gaps between sessions", () => {
    const timeline = dayTimeline(
      [entry(day, "09:00", "10:30"), entry(day, "11:00", "12:00")],
      day,
      afternoon,
    );
    expect(timeline.gaps.map((g) => [g.fromTime, g.toTime])).toEqual([
      ["08:00", "09:00"], // before the first session
      ["10:30", "11:00"], // between them
      ["12:00", "15:00"], // since the last one, up to now
    ]);
    expect(timeline.gapSeconds).toBe((60 + 30 + 180) * 60);
  });

  it("ignores a five-minute breather between two sessions", () => {
    const timeline = dayTimeline(
      [entry(day, "09:00", "10:00"), entry(day, "10:05", "15:00")],
      day,
      afternoon,
    );
    expect(timeline.gaps.map((g) => g.fromTime)).toEqual(["08:00"]);
  });

  it("does not call the rest of the day a gap before it happens", () => {
    const morning = new Date(2026, 8, 8, 10, 0, 0).getTime();
    const timeline = dayTimeline([entry(day, "09:00", "10:00")], day, morning);
    expect(timeline.gaps.map((g) => [g.fromTime, g.toTime])).toEqual([["08:00", "09:00"]]);
  });

  it("runs a live timer up to now and leaves no gap behind it", () => {
    const running: Entry = { ...entry(day, "14:00", "15:00"), end: null };
    const timeline = dayTimeline([running], day, afternoon);
    expect(timeline.blocks[0].to).toBe(15 * 60);
    expect(timeline.gaps.map((g) => g.toTime)).toEqual(["14:00"]);
  });

  it("does not produce a negative gap from overlapping entries", () => {
    const timeline = dayTimeline(
      [entry(day, "09:00", "12:00"), entry(day, "10:00", "11:00")],
      day,
      afternoon,
    );
    expect(timeline.gaps.every((gap) => gap.to > gap.from)).toBe(true);
    expect(timeline.gaps.map((g) => g.fromTime)).toEqual(["08:00", "12:00"]);
  });

  it("leaves other days alone", () => {
    const timeline = dayTimeline([entry("2026-09-07", "09:00", "10:00")], day, afternoon);
    expect(timeline.blocks).toHaveLength(0);
  });
});

describe("overlaps", () => {
  const nine = entry("2026-09-08", "09:00", "10:00", "Acme");
  const ten = entry("2026-09-08", "10:00", "11:00", "Admin");

  it("does not call a shared endpoint an overlap", () => {
    expect(overlapping(nine, [ten])).toHaveLength(0);
  });

  it("finds a real clash, in either direction", () => {
    const middle = entry("2026-09-08", "09:30", "10:30", "Deep Work");
    expect(overlapping(middle, [nine, ten]).map((e) => e.project)).toEqual(["Acme", "Admin"]);
    expect(overlapping(nine, [middle])).toHaveLength(1);
  });

  it("ignores itself, running timers and other days", () => {
    expect(overlapping(nine, [nine])).toHaveLength(0);
    expect(overlapping(nine, [{ ...ten, id: "r", start: nine.start, end: null }])).toHaveLength(0);
    expect(overlapping(nine, [entry("2026-09-07", "09:00", "10:00")])).toHaveLength(0);
    expect(overlapping({ ...nine, end: null }, [ten])).toHaveLength(0);
  });
});

describe("consistency", () => {
  const day = (back: number) => addDays("2026-09-08", -back);
  const on = (back: number) => entry(day(back), "09:00", "10:00");

  it("counts an unbroken run up to today", () => {
    const streak = consistency([on(0), on(1), on(2), on(4)], NOW);
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
  });

  it("does not break the streak just because today is still empty", () => {
    expect(consistency([on(1), on(2)], NOW).current).toBe(2);
  });

  it("does break after two empty days", () => {
    expect(consistency([on(2), on(3)], NOW).current).toBe(0);
  });

  it("remembers the longest run and the best day", () => {
    const streak = consistency(
      [on(10), on(9), on(8), on(7), on(0), entry(day(9), "13:00", "18:00")],
      NOW,
    );
    expect(streak.longest).toBe(4);
    expect(streak.best?.day).toBe(day(9));
    expect(streak.best?.seconds).toBe(3600 + 5 * 3600);
  });

  it("has nothing to say about an empty history", () => {
    expect(consistency([], NOW)).toEqual({ current: 0, longest: 0, best: null });
  });
});

describe("pinned projects", () => {
  const recent = ["Reading", "Acme", "Admin", "Deep Work"];

  it("keeps recency when nothing is pinned", () => {
    expect(orderedProjects(recent, [])).toEqual(recent);
  });

  it("lifts pinned projects to the front, in the order they were pinned", () => {
    expect(orderedProjects(recent, ["Deep Work", "admin"])).toEqual([
      "Deep Work",
      "Admin",
      "Reading",
      "Acme",
    ]);
  });

  it("ignores a pin for a project that is gone", () => {
    expect(orderedProjects(recent, ["Vanished"])).toEqual(recent);
  });
});

describe("tags", () => {
  it("ranks tags by how often they are used", () => {
    const tagged = (tags: string[]) => ({ ...entry("2026-09-08", "09:00", "10:00"), tags });
    expect(tagsUsed([tagged(["billable"]), tagged(["billable", "meeting"]), tagged([" "])]))
      .toEqual(["billable", "meeting"]);
  });
});

describe("money", () => {
  const rates = { "Acme Rollout": 120, Admin: 0 };

  it("matches project names the way the backend does", () => {
    expect(rateFor(rates, "acme rollout ")).toBe(120);
    expect(rateFor(rates, "Reading")).toBe(0);
  });

  it("prices time by the hour", () => {
    expect(amountOf(rates, "Acme Rollout", 5400)).toBeCloseTo(180);
    expect(amountOf(rates, "Admin", 5400)).toBe(0);
    expect(amountOf(rates, "Acme Rollout", -10)).toBe(0);
  });

  it("adds up a list of entries", () => {
    const entries = [entry("2026-09-08", "09:00", "10:00", "Acme Rollout")];
    expect(totalAmount(rates, entries, () => 3600)).toBeCloseTo(120);
  });

  it("stays quiet until a rate exists", () => {
    expect(anyRates({})).toBe(false);
    expect(anyRates({ Admin: 0 })).toBe(false);
    expect(anyRates(rates)).toBe(true);
  });

  it("prefixes the symbol the user chose", () => {
    // A non-breaking space, so "€ 180.00" never wraps between symbol and figure.
    expect(formatMoney(180, "€")).toBe("€\u00a0180.00");
    expect(formatMoney(180, "")).toBe("180.00");
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
