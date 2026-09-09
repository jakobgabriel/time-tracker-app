import { useState } from "react";

import { overlapping } from "../lib/stats";
import { dayKey, hhmm, localIso, minutesBetween, plusMinutes, withDay, withTime } from "../lib/time";
import type { Entry } from "../lib/types";
import { MergeIcon, PlayIcon, SplitIcon } from "./Icons";

type Props = {
  entry: Entry;
  projects: string[];
  entries: Entry[];
  onSave: (entry: Entry) => void;
  onDelete: (id: string) => void;
  onResume: (project: string) => void;
  onSplit: (id: string, at: string) => void;
  onMerge: (id: string) => void;
  onClose: () => void;
};

const combine = (base: string, day: string, time: string) => withDay(withTime(base, time), day);

export function EntrySheet({
  entry, projects, entries, onSave, onDelete, onResume, onSplit, onMerge, onClose,
}: Props) {
  const isNew = entry.id === "";
  const [project, setProject] = useState(entry.project);
  const [note, setNote] = useState(entry.note);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [day, setDay] = useState(dayKey(entry.start));
  const [startTime, setStartTime] = useState(hhmm(entry.start));
  const [endTime, setEndTime] = useState(entry.end ? hhmm(entry.end) : "");
  const [error, setError] = useState("");
  const [clash, setClash] = useState<Entry[]>([]);

  // Both tools act on the entry as stored, not on unsaved edits in this form.
  const stored = entry.end;
  const [splitAt, setSplitAt] = useState(() =>
    stored ? hhmm(plusMinutes(entry.start, minutesBetween(entry.start, stored) / 2)) : "",
  );

  const nextOfProject = stored
    ? entries
        .filter(
          (other) =>
            other.id !== entry.id &&
            other.end &&
            other.start >= stored &&
            other.project.trim().toLowerCase() === entry.project.trim().toLowerCase(),
        )
        .sort((a, b) => a.start.localeCompare(b.start))[0]
    : undefined;

  const save = () => {
    const start = combine(entry.start, day, startTime);
    let end: string | null = null;

    if (endTime) {
      end = combine(entry.end ?? entry.start, day, endTime);
      if (new Date(end).getTime() <= new Date(start).getTime()) {
        // A session that ends "before" it starts ran past midnight.
        const nextDay = new Date(`${day}T12:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        end = combine(entry.end ?? entry.start, dayKey(localIso(nextDay)), endTime);
      }
    } else if (!entry.end && !isNew) {
      end = null; // still running: leave it alone
    } else {
      setError("Add an end time, or stop the running timer first.");
      return;
    }

    const edited = {
      ...entry,
      // An empty id tells the backend to mint one.
      project: project.trim() || "General",
      note: note.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean),
      start,
      end,
    };

    // Overlaps are usually a mistake and occasionally deliberate, so this
    // warns once and then gets out of the way.
    const conflicts = overlapping(edited, entries);
    if (conflicts.length > 0 && clash.length === 0) {
      setClash(conflicts);
      return;
    }

    onSave(edited);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Edit entry">
        <div className="grabber" />
        <h2>{isNew ? "Add entry" : "Edit entry"}</h2>

        <div className="stack">
          <div className="field">
            <label htmlFor="project">Project</label>
            <input
              id="project"
              type="text"
              list="known-projects"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="General"
            />
            <datalist id="known-projects">
              {projects.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="day">Date</label>
            <input
              id="day"
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="from">From</label>
              <input
                id="from"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="to">To</label>
              <input
                id="to"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                placeholder="running"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">Note</label>
            <input
              id="note"
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — ends up in the note"
            />
          </div>

          <div className="field">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              type="text"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="billable, meeting"
            />
            <span className="help">Comma separated; written to Obsidian as #tags.</span>
          </div>

          {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}

          {clash.length > 0 && (
            <div className="warn">
              Overlaps {clash.length === 1 ? "" : `${clash.length} entries, including `}
              <b>{clash[0].project || "Untitled"}</b> {hhmm(clash[0].start)}–
              {clash[0].end ? hhmm(clash[0].end) : ""}. Save again to keep it anyway.
            </div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>

          {!isNew && stored && (
            <div className="tools">
              <div className="split">
                <SplitIcon />
                <span>Split at</span>
                <input
                  type="time"
                  value={splitAt}
                  onChange={(event) => setSplitAt(event.target.value)}
                  aria-label="Split the entry at this time"
                />
                <button
                  className="btn"
                  disabled={!splitAt}
                  onClick={() => onSplit(entry.id, withTime(entry.start, splitAt))}
                >
                  Split
                </button>
              </div>

              {nextOfProject && (
                <button className="btn wide" onClick={() => onMerge(entry.id)}>
                  <MergeIcon /> Merge with {hhmm(nextOfProject.start)}–
                  {hhmm(nextOfProject.end ?? nextOfProject.start)}
                </button>
              )}
            </div>
          )}

          {!isNew && (
            <>
              {/* Picking up yesterday's work is one tap, not a retyped name. */}
              <button className="btn wide" onClick={() => onResume(entry.project)}>
                <PlayIcon /> Start this project again
              </button>
              <button className="btn danger wide" onClick={() => onDelete(entry.id)}>
                Delete entry
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
