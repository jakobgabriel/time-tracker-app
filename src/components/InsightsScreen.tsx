import { useState } from "react";

import { projectColor } from "../lib/colors";
import { amountOf, anyRates, formatMoney } from "../lib/money";
import {
  buckets, consistency, daysTracked, inPreviousRange, inRange, projectTotals, tagsUsed,
  type Range,
} from "../lib/stats";
import { dayLabel, entrySeconds, formatShort, totalSeconds } from "../lib/time";
import { useT } from "../lib/i18n";
import type { Entry, Snapshot } from "../lib/types";
import { ReviewCard } from "./ReviewCard";
import { ReceiptIcon } from "./Icons";

type Props = {
  snapshot: Snapshot;
  nowMs: number;
  onInvoice: (month: string) => void;
  onEdit: (entry: Entry) => void;
};

const RANGES: { key: Range; label: string; compare: string }[] = [
  { key: "week", label: "Week", compare: "vs last week" },
  { key: "month", label: "Month", compare: "vs last month" },
  { key: "all", label: "All", compare: "" },
];

export function InsightsScreen({ snapshot, nowMs, onInvoice, onEdit }: Props) {
  const [range, setRange] = useState<Range>("week");
  const [selected, setSelected] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const t = useT();

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
  const streak = consistency(scope, nowMs);
  const targets = snapshot.projectTargets;
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
            {t(option.label)}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="chips tag-filter">
          <button className={`chip${tag === null ? " active" : ""}`} onClick={() => setTag(null)}>
            {t("All")}
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
              ? t("across {days} tracked days", { days: tracked })
              : previous.length || delta
                ? `${delta >= 0 ? "+" : "−"}${formatShort(Math.abs(delta))} ${t(
                    RANGES.find((option) => option.key === range)?.compare ?? "",
                  )}`
                : t("nothing tracked in the period before")}
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
          <span className="k">{t("Tracked days")}</span>
          <span className="v">{tracked}</span>
        </div>
        <div>
          <span className="k">{t("Average day")}</span>
          <span className="v">{formatShort(tracked ? Math.round(total / tracked) : 0)}</span>
        </div>
        <div>
          <span className="k">{t("Streak")}</span>
          <span className="v">
            {t(streak.current === 1 ? "{n} day" : "{n} days", { n: streak.current })}
          </span>
          {streak.longest > streak.current && (
            <span className="k">{t("best {n}", { n: streak.longest })}</span>
          )}
        </div>
        <div>
          <span className="k">{t("Best day")}</span>
          <span className="v">{formatShort(streak.best?.seconds ?? 0)}</span>
          {streak.best && <span className="k">{dayLabel(streak.best.day)}</span>}
        </div>
      </div>

      {range === "month" && priced && (
        <button
          className="btn wide"
          onClick={() => onInvoice(new Date(nowMs).toISOString().slice(0, 7))}
        >
          <ReceiptIcon /> {t("Write the invoice note for this month")}
        </button>
      )}

      <div className="section-title">
        <span>{t("Projects")}</span>
        <span>{projects.length}</span>
      </div>

      {projects.length === 0 ? (
        <p className="empty">{t("Nothing tracked in this range yet.")}</p>
      ) : (
        <div className="list">
          {projects.map((item) => {
            // A weekly target replaces the share bar rather than adding a
            // second one: two identical bars meaning different things is worse
            // than either on its own.
            const target = range === "week" ? (targets[item.project] ?? 0) * 60 : 0;
            const ratio = target > 0 ? Math.min(item.seconds / target, 1) : item.share;
            const amount = amountOf(rates, item.project, item.seconds);
            return (
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
                      width: `${Math.max(ratio * 100, 1.5)}%`,
                      background: projectColor(item.project),
                    }}
                  />
                </span>
                <span className="share">
                  {priced && amount > 0 && (
                    <b>{formatMoney(amount, snapshot.settings.currency)} · </b>
                  )}
                  {target > 0
                    ? t("{share}% of {target}", {
                        share: Math.round((item.seconds / target) * 100),
                        target: formatShort(target),
                      })
                    : `${Math.round(item.share * 100)}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Last, because it is about the whole history rather than the range
          above it — and it is not there at all on a tidy one. */}
      <ReviewCard snapshot={snapshot} nowMs={nowMs} onEdit={onEdit} />
    </div>
  );
}
