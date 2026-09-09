import { projectColor } from "../lib/colors";
import { dayTimeline } from "../lib/stats";
import { formatShort } from "../lib/time";
import { useT } from "../lib/i18n";
import type { Entry } from "../lib/types";

type Props = {
  entries: Entry[];
  day: string;
  nowMs: number;
  onFillGap: (day: string, from: string, to: string) => void;
  onSelect: (entry: Entry) => void;
  /** The strip alone, without the caption — for a dense list of days. */
  compact?: boolean;
};

export function DayTimeline({ entries, day, nowMs, onFillGap, onSelect, compact }: Props) {
  const t = useT();
  const timeline = dayTimeline(entries, day, nowMs);
  const span = Math.max(1, timeline.end - timeline.start);
  const at = (minutes: number) => ((minutes - timeline.start) / span) * 100;

  // Two-hour ticks on a normal day, four-hourly once it stretches.
  const step = span > 14 * 60 ? 240 : 120;
  const ticks: number[] = [];
  for (let m = Math.ceil(timeline.start / step) * step; m < timeline.end; m += step) {
    ticks.push(m);
  }

  return (
    <div className={`timeline${compact ? " compact" : ""}`}>
      <div className="strip">
        {timeline.gaps.map((gap) => (
          <button
            key={`gap-${gap.from}`}
            className="gap"
            style={{ left: `${at(gap.from)}%`, width: `${at(gap.to) - at(gap.from)}%` }}
            onClick={() => onFillGap(day, gap.fromTime, gap.toTime)}
            aria-label={`Add an entry from ${gap.fromTime} to ${gap.toTime}`}
            title={`${gap.fromTime}–${gap.toTime} untracked`}
          >
            <span>+</span>
          </button>
        ))}
        {timeline.blocks.map((block) => (
          <button
            key={block.entry.id}
            className={`block${block.entry.end ? "" : " live"}`}
            style={{
              left: `${at(block.from)}%`,
              width: `${Math.max(at(block.to) - at(block.from), 0.8)}%`,
              background: projectColor(block.entry.project),
            }}
            onClick={() => onSelect(block.entry)}
            aria-label={`${block.entry.project || "Untitled"}, ${formatShort(
              (block.to - block.from) * 60,
            )}`}
            title={`${block.entry.project || "Untitled"}`}
          />
        ))}
      </div>

      <div className="ticks">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${at(tick)}%` }}>
            {String(Math.floor(tick / 60)).padStart(2, "0")}
          </span>
        ))}
      </div>

      {!compact && (
        <p className="caption">
          {t("{tracked} tracked", { tracked: formatShort(timeline.trackedSeconds) })}
          {timeline.gapSeconds > 0 && (
            <>
              {" · "}
              {t("{gaps} in gaps — tap one to fill it", {
                gaps: formatShort(timeline.gapSeconds),
              })}
            </>
          )}
        </p>
      )}
    </div>
  );
}
