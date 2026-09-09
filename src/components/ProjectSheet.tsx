import { useState } from "react";

import { projectColor } from "../lib/colors";
import { PinIcon, TrashIcon } from "./Icons";

type Props = {
  name: string;
  rate: number;
  currency: string;
  pinned: boolean;
  autoTags: string[];
  target: number;
  /** Applies whatever changed — a new name, rate, or set of automatic tags. */
  onSave: (change: { name: string; rate: number; autoTags: string[]; target: number }) => void;
  onTogglePin: () => void;
  onForget: () => void;
  onClose: () => void;
};

export function ProjectSheet({
  name, rate, currency, pinned, autoTags, target, onSave, onTogglePin, onForget, onClose,
}: Props) {
  const [value, setValue] = useState(name);
  const [hourly, setHourly] = useState(rate ? String(rate) : "");
  const [tags, setTags] = useState(autoTags.join(", "));
  const [weekly, setWeekly] = useState(target ? String(target / 60) : "");

  const named = value.trim();
  const priced = Number(hourly) || 0;
  const parsedTags = tags
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  const weeklyMinutes = Math.round((Number(weekly) || 0) * 60);
  const changed =
    named !== "" &&
    (named !== name ||
      priced !== rate ||
      weeklyMinutes !== target ||
      parsedTags.join(",") !== autoTags.join(","));

  const save = () =>
    changed &&
    onSave({ name: named, rate: priced, autoTags: parsedTags, target: weeklyMinutes });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Project ${name}`}>
        <div className="grabber" />
        <h2>
          <span className="swatch" style={{ background: projectColor(name) }} />
          {name}
        </h2>

        <div className="stack">
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <input
              id="project-name"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && save()}
            />
            <span className="help">
              Renaming updates every entry and rewrites the affected notes on the next sync. Rename
              onto a project that already exists to merge the two.
            </span>
          </div>

          <div className="field">
            <label htmlFor="project-rate">Hourly rate</label>
            <div className="prefixed">
              <span>{currency.trim() || "per hour"}</span>
              <input
                id="project-rate"
                type="number"
                inputMode="decimal"
                min="0"
                step="5"
                placeholder="0"
                value={hourly}
                onChange={(event) => setHourly(event.target.value)}
              />
            </div>
            <span className="help">
              Leave it empty and Tempo never mentions money. With a rate, amounts appear in
              Insights, in the CSV export and in the note's per-project table.
            </span>
          </div>

          <div className="field">
            <label htmlFor="target">Weekly target</label>
            <div className="prefixed">
              <span>hours</span>
              <input
                id="target"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                placeholder="0"
                value={weekly}
                onChange={(event) => setWeekly(event.target.value)}
              />
            </div>
            <span className="help">Draws a progress bar in the week view of Insights.</span>
          </div>

          <div className="field">
            <label htmlFor="auto-tags">Always tag with</label>
            <input
              id="auto-tags"
              type="text"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="billable"
            />
            <span className="help">
              Added to every new session on this project, so a tag stops depending on memory.
            </span>
          </div>

          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className={changed ? "btn primary" : "btn"} onClick={save} disabled={!changed}>
              Save
            </button>
          </div>

          <button className="btn wide" onClick={onTogglePin}>
            <PinIcon /> {pinned ? "Unpin from the top" : "Pin to the top"}
          </button>
          <p className="small muted" style={{ margin: "-6px 0 0", textAlign: "center" }}>
            Pinning arranges the chips. The start button still repeats whatever you tracked last.
          </p>

          <button className="btn danger wide" onClick={onForget}>
            <TrashIcon /> Remove from the quick list
          </button>
          <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
            Tracked time is kept — only the chip disappears.
          </p>
        </div>
      </div>
    </>
  );
}
