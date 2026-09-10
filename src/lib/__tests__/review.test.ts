import { describe, expect, it } from "vitest";

import { review } from "../review";
import type { Entry, Settings } from "../types";

const settings = { maxSessionMinutes: 480 } as Settings;
const now = new Date("2026-09-08T18:00:00+02:00").getTime();

let n = 0;
const entry = (start: string, end: string | null, project = "Acme"): Entry => ({
  id: `e${++n}`,
  project,
  note: "",
  tags: [],
  start: `2026-09-08T${start}:00+02:00`,
  end: end && `2026-09-08T${end}:00+02:00`,
});

describe("review", () => {
  it("finds nothing wrong with an ordinary day", () => {
    const day = [entry("09:00", "10:30"), entry("10:30", "12:00"), entry("13:00", "17:00")];
    expect(review(day, settings, now)).toEqual([]);
  });

  it("ignores a running timer", () => {
    expect(review([entry("09:00", null)], settings, now)).toEqual([]);
  });

  it("reports two entries over the same hour once, against the later one", () => {
    const first = entry("09:00", "11:00");
    const second = entry("10:00", "12:00");
    const issues = review([first, second], settings, now);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("overlap");
    expect(issues[0].entry.id).toBe(second.id);
    expect(issues[0].other?.id).toBe(first.id);
  });

  it("does not call a back-to-back pair an overlap", () => {
    expect(review([entry("09:00", "10:00"), entry("10:00", "11:00")], settings, now)).toEqual([]);
  });

  it("reports a session past the limit, and only past it", () => {
    expect(review([entry("01:00", "09:00")], settings, now)).toEqual([]);
    const long = review([entry("01:00", "09:01")], settings, now);
    expect(long.map((i) => i.kind)).toEqual(["long"]);
  });

  it("treats a limit of zero as the check being off", () => {
    const off = { maxSessionMinutes: 0 } as Settings;
    expect(review([entry("01:00", "17:00")], off, now)).toEqual([]);
  });

  it("reports an entry with no time in it, and says nothing else about it", () => {
    // A zero-length entry with no project would otherwise be reported twice.
    const issues = review([entry("09:00", "09:00", "  ")], settings, now);
    expect(issues.map((i) => i.kind)).toEqual(["empty"]);
  });

  it("reports an entry that ends before it starts", () => {
    expect(review([entry("11:00", "09:00")], settings, now).map((i) => i.kind)).toEqual(["empty"]);
  });

  it("reports an entry with no project", () => {
    expect(review([entry("09:00", "10:00", "   ")], settings, now).map((i) => i.kind)).toEqual([
      "unnamed",
    ]);
  });

  it("reports time in the future", () => {
    expect(review([entry("19:00", "20:00")], settings, now).map((i) => i.kind)).toEqual(["future"]);
  });

  it("can report more than one thing about one entry", () => {
    const issues = review([entry("01:00", "17:00", " ")], settings, now);
    expect(new Set(issues.map((i) => i.kind))).toEqual(new Set(["unnamed", "long"]));
  });

  it("puts the newest first", () => {
    const issues = review(
      [entry("09:00", "09:00"), entry("15:00", "15:00"), entry("12:00", "12:00")],
      settings,
      now,
    );
    expect(issues.map((i) => i.entry.start.slice(11, 16))).toEqual(["15:00", "12:00", "09:00"]);
  });

  it("survives a timestamp it cannot read", () => {
    const broken = { ...entry("09:00", "10:00"), start: "not a date" };
    expect(() => review([broken], settings, now)).not.toThrow();
    expect(review([broken], settings, now)).toEqual([]);
  });
});
