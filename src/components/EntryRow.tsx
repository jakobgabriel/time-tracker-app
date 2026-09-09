import { projectColor } from "../lib/colors";
import { entrySeconds, formatShort, hhmm } from "../lib/time";
import { useT } from "../lib/i18n";
import type { Entry } from "../lib/types";

type Props = { entry: Entry; nowMs: number; onClick: () => void };

export function EntryRow({ entry, nowMs, onClick }: Props) {
  const t = useT();
  const meta = [
    entry.end ? `${hhmm(entry.start)} – ${hhmm(entry.end)}` : `${t("from")} ${hhmm(entry.start)}`,
    entry.note,
    entry.tags.map((tag) => `#${tag}`).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className="entry" onClick={onClick}>
      <span className="name">
        <span className="swatch" style={{ background: projectColor(entry.project) }} />
        {entry.project || t("Untitled")}
      </span>
      {entry.end ? (
        <span className="dur">{formatShort(entrySeconds(entry, nowMs))}</span>
      ) : (
        <span className="live">{t("RUNNING")}</span>
      )}
      <span className="meta">{meta}</span>
    </button>
  );
}
