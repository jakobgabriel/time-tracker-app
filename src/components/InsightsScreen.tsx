import { useState } from "react";

import { projectColor } from "../lib/colors";
import { amountOf, anyRates, formatMoney } from "../lib/money";
import {
  buckets, daysTracked, inPreviousRange, inRange, projectTotals, tagsUsed, type Range,
} from "../lib/stats";
import { dayLabel, entrySeconds, formatShort, totalSeconds } from "../lib/time";
import type { Snapshot } from "../lib/types";

type Props = { snapshot: Snapshot; nowMs: number };

const RANGES: { key: Range; label: string; compare: string }[] = [
  { key: "week", label: "Week", compare: "last week" },
  { key: "month", label: "Month", compare: "last month" },
  { key: "all", label: "All", compare: "" },
];

export function InsightsScreen({ snapshot, nowMs }: Props) {
  const [range, setRange] = useState<Range>("week");
  const [selected, setSelected] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const tags = tagsUsed(snapshot.entries);
  // Filtering first means the chart, the totals and the money all agree.
  const scope = tag
    ? snapshot.entries.filter((entry) => entry.tags.includes(tag))
    : snapshot.entries;

  const entries = inRange(scope, range, nowMs);
  const previous = inPreviousRange(scope, range, nowMs);
  const bars = buckets(scope, range, nowMs);
  const total = totalSeconds(entries, nowMs);
  const delta = total - totalSeconds(previous, nowMs);
  const tracked = daysTracked(entries, nowMs);
  const projects = projectTotals(entries, nowMs);
  const goal = snapshot.settings.dailyGoalMinutes * 60;
  const rates = snapshot.projectRates;
  const priced = anyRates(rates);
  const earned = entries.reduce(
    (sum, entry) => sum + amountOf(rates, entry.project, entrySeconds(entry, nowMs)),
    0,
  );

  const peak = Math.max(goal, ...bars.map((bucket) => bucket.seconds), 1);
  const shown = selected ? bars.find((bucket) => bucket.key === selected) : undefined;

  return (
    <div className="screen">
      <div className="segmented" role="tablist">
        {RANGES.map((option) => (
          <button
            key={option.key}
            role="tab"
            aria-selected={range === option.key}
            onClick={() => {
              setRange(option.key);
              setSelected(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="chips tag-filter">
          <button className={`chip${tag === null ? " active" : ""}`} onClick={() => setTag(null)}>
            All
          </button>
          {tags.map((name) => (
            <button
              key={name}
              className={`chip${tag === name ? " active" : ""}`}
              onClick={() => setTag(tag === name ? null : name)}
            >
              #{name}
            </button>
          ))}
        </div>
      )}

      <div className="headline">
        <span className="value">{formatShort(shown ? shown.seconds : total)}</span>
        {priced && !shown && (
          <span className="earned">{formatMoney(earned, snapshot.settings.currency)}</span>
        )}
        <span className="caption">
          {shown
            ? shown.key.length === 7
              ? shown.key
              : dayLabel(shown.key)
            : range === "all"
              ? `across ${tracked} tracked day${tracked === 1 ? "" : "s"}`
              : previous.length || delta
                ? `${delta >= 0 ? "+" : "−"}${formatShort(Math.abs(delta))} vs ${
                    RANGES.find((option) => option.key === range)?.compare
                  }`
                : "nothing tracked in the period before"}
        </span>
      </div>

      <div className="chart">
        {goal > 0 && range !== "all" && (
          <div
            className="goal-line"
            // Inside the plot area, which is the box minus the tick strip.
            style={{ bottom: `calc(var(--ticks) + (100% - var(--ticks)) * ${goal / peak})` }}
          >
            <span>{formatShort(goal)}</span>
          </div>
        )}
        {bars.map((bucket) => (
          <button
            key={bucket.key}
            className={`bar${bucket.current ? " current" : ""}${
              selected === bucket.key ? " selected" : ""
            }`}
            onClick={() => setSelected(selected === bucket.key ? null : bucket.key)}
            aria-label={`${bucket.key}: ${formatShort(bucket.seconds)}`}
          >
            <span className="fill" style={{ height: `${(bucket.seconds / peak) * 100}%` }} />
            <span className="tick">{bucket.label}</span>
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div>
          <span className="k">Tracked days</span>
          <span className="v">{tracked}</span>
        </div>
        <div>
          <span className="k">Average day</span>
          <span className="v">{formatShort(tracked ? Math.round(total / tracked) : 0)}</span>
        </div>
        <div>
          <span className="k">Sessions</span>
          <span className="v">{entries.length}</span>
        </div>
      </div>

      <div className="section-title">
        <span>Projects</span>
        <span>{projects.length}</span>
      </div>

      {projects.length === 0 ? (
        <p className="empty">Nothing tracked in this range yet.</p>
      ) : (
        <div className="list">
          {projects.map((item) => (
            <div key={item.project} className="project-row">
              <span className="name">
                <span className="swatch" style={{ background: projectColor(item.project) }} />
                {item.project}
              </span>
              <span className="dur">{formatShort(item.seconds)}</span>
              <span className="track">
                <span
                  className="fill"
                  style={{
                    width: `${Math.max(item.share * 100, 1.5)}%`,
                    background: projectColor(item.project),
                  }}
                />
              </span>
              <span className="share">
                {/* The share is always there; money joins it for a priced project,
                    so a column never mixes two different units. */}
                {priced && amountOf(rates, item.project, item.seconds) > 0 && (
                  <b>
                    {formatMoney(
                      amountOf(rates, item.project, item.seconds),
                      snapshot.settings.currency,
                    )}{" "}
                    ·{" "}
                  </b>
                )}
                {Math.round(item.share * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
