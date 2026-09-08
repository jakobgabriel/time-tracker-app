import { useMemo, useState } from "react";

import {
  dayLabel, entrySeconds, formatShort, groupByDay, totalSeconds, weekKey,
} from "../lib/time";
import type { Entry, Snapshot } from "../lib/types";
import { EntryRow } from "./EntryRow";
import { PlusIcon } from "./Icons";

type Props = {
  snapshot: Snapshot;
  nowMs: number;
  onEdit: (entry: Entry) => void;
  onAdd: () => void;
};

export function HistoryScreen({ snapshot, nowMs, onEdit, onAdd }: Props) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.entries;
    return snapshot.entries.filter((entry) =>
      [entry.project, entry.note, ...entry.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [snapshot.entries, query]);

  const days = groupByDay(matches);

  const weekTotals = new Map<string, number>();
  for (const [day, entries] of days) {
    const key = weekKey(day);
    weekTotals.set(key, (weekTotals.get(key) ?? 0) + totalSeconds(entries, nowMs));
  }

  let previousWeek = "";

  return (
    <div className="screen">
      <div className="search">
        <input
          type="text"
          inputMode="search"
          placeholder="Search project, note or tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button className="clear" aria-label="Clear search" onClick={() => setQuery("")}>
            ✕
          </button>
        ) : (
          <button className="clear" aria-label="Add entry" onClick={onAdd}>
            <PlusIcon />
          </button>
        )}
      </div>

      {days.length === 0 ? (
        <p className="empty" style={{ marginTop: 16 }}>
          {query
            ? `Nothing matches “${query.trim()}”.`
            : "No history yet. Start a timer and it will show up here."}
        </p>
      ) : (
        days.map(([day, entries]) => {
          const week = weekKey(day);
          const isNewWeek = week !== previousWeek;
          previousWeek = week;
          return (
            <section key={day}>
              {isNewWeek && (
                <h2 className="week-head">
                  Week {week.split("-W")[1]} · {formatShort(weekTotals.get(week) ?? 0)}
                </h2>
              )}
              <div className="day-head">
                <span className="label">{dayLabel(day)}</span>
                <span className="total">{formatShort(totalSeconds(entries, nowMs))}</span>
              </div>
              <div className="list">
                {entries
                  .slice()
                  .sort((a, b) => b.start.localeCompare(a.start))
                  .map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      nowMs={nowMs}
                      onClick={() => onEdit(entry)}
                    />
                  ))}
              </div>
            </section>
          );
        })
      )}

      {days.length > 0 && (
        <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
          {matches.length} {query ? "matching " : ""}entries ·{" "}
          {formatShort(matches.reduce((sum, e) => sum + entrySeconds(e, nowMs), 0))} total
        </p>
      )}
    </div>
  );
}
