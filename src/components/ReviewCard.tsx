import { useState } from "react";

import { useT, type Translate } from "../lib/i18n";
import { review, type Issue } from "../lib/review";
import { dayKey, dayLabel, hhmm } from "../lib/time";
import type { Entry, Snapshot } from "../lib/types";

type Props = { snapshot: Snapshot; nowMs: number; onEdit: (entry: Entry) => void };

const REASON: Record<Issue["kind"], string> = {
  overlap: "Overlaps another entry",
  long: "Longer than your session limit",
  unnamed: "No project",
  empty: "No time in it",
  future: "In the future",
};

function describe(issue: Issue, t: Translate): string {
  const { entry } = issue;
  const span = entry.end ? `${hhmm(entry.start)} – ${hhmm(entry.end)}` : hhmm(entry.start);
  const named = (e: Entry) => e.project.trim() || t("no project");
  const when = `${dayLabel(dayKey(entry.start))} · ${span}`;
  if (issue.kind === "overlap" && issue.other) {
    return `${when} · ${named(entry)} ${t("and")} ${named(issue.other)}`;
  }
  // "No project · … · no project" says it twice.
  return issue.kind === "unnamed" ? when : `${when} · ${named(entry)}`;
}

/**
 * Time that the app itself would report wrongly: two entries over the same
 * hour, a session left running overnight, a row imported without a project.
 *
 * It only appears when there is something to show, and every row opens the
 * entry so the fix is one tap away rather than a hunt through History.
 */
export function ReviewCard({ snapshot, nowMs, onEdit }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const issues = review(snapshot.entries, snapshot.settings, nowMs);
  if (!issues.length) return null;

  const shown = open ? issues : issues.slice(0, 3);

  return (
    <section className="review">
      <h2 className="section-title">
        {issues.length === 1 ? t("1 entry needs a look") : t("{n} entries need a look", { n: issues.length })}
      </h2>

      <ul className="review-list">
        {shown.map((issue, index) => (
          <li key={`${issue.kind}-${issue.entry.id}-${index}`}>
            <button onClick={() => onEdit(issue.entry)}>
              <span className="reason">{t(REASON[issue.kind])}</span>
              <span className="small muted">{describe(issue, t)}</span>
            </button>
          </li>
        ))}
      </ul>

      {issues.length > 3 && (
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? t("Show fewer") : t("Show all {n}", { n: issues.length })}
        </button>
      )}
    </section>
  );
}
