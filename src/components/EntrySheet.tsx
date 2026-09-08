import { useState } from "react";

import { dayKey, hhmm, localIso, withDay, withTime } from "../lib/time";
import type { Entry } from "../lib/types";

type Props = {
  entry: Entry;
  projects: string[];
  onSave: (entry: Entry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

const combine = (base: string, day: string, time: string) => withDay(withTime(base, time), day);

export function EntrySheet({ entry, projects, onSave, onDelete, onClose }: Props) {
  const isNew = entry.id === "";
  const [project, setProject] = useState(entry.project);
  const [note, setNote] = useState(entry.note);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [day, setDay] = useState(dayKey(entry.start));
  const [startTime, setStartTime] = useState(hhmm(entry.start));
  const [endTime, setEndTime] = useState(entry.end ? hhmm(entry.end) : "");
  const [error, setError] = useState("");

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

    onSave({
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
    });
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

          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>

          {!isNew && (
            <button className="btn danger wide" onClick={() => onDelete(entry.id)}>
              Delete entry
            </button>
          )}
        </div>
      </div>
    </>
  );
}
