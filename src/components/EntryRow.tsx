import { entrySeconds, formatShort, hhmm } from "../lib/time";
import type { Entry } from "../lib/types";

type Props = { entry: Entry; nowMs: number; onClick: () => void };

export function EntryRow({ entry, nowMs, onClick }: Props) {
  const meta = [
    entry.end ? `${hhmm(entry.start)} – ${hhmm(entry.end)}` : `from ${hhmm(entry.start)}`,
    entry.note,
    entry.tags.map((tag) => `#${tag}`).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className="entry" onClick={onClick}>
      <span className="name">{entry.project || "Untitled"}</span>
      {entry.end ? (
        <span className="dur">{formatShort(entrySeconds(entry, nowMs))}</span>
      ) : (
        <span className="live">RUNNING</span>
      )}
      <span className="meta">{meta}</span>
    </button>
  );
}
