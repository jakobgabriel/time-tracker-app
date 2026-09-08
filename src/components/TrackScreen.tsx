import { useEffect, useRef, useState, type CSSProperties } from "react";

import { entrySeconds, dayKey, formatClock, formatShort, hhmm, localIso, totalSeconds }
  from "../lib/time";
import type { Entry, Snapshot } from "../lib/types";
import { EntryRow } from "./EntryRow";
import { PlusIcon } from "./Icons";

const DEFAULT_PROJECT = "General";

type Props = {
  snapshot: Snapshot;
  nowMs: number;
  onStart: (project: string) => void;
  onStop: () => void;
  onDiscard: () => void;
  onEdit: (entry: Entry) => void;
  onNote: (note: string) => void;
};

export function TrackScreen({ snapshot, nowMs, onStart, onStop, onDiscard, onEdit, onNote }: Props) {
  const { entries, projects } = snapshot;
  const running = entries.find((entry) => !entry.end);
  const elapsed = running ? entrySeconds(running, nowMs) : 0;
  const today = dayKey(localIso(new Date(nowMs)));
  const todayEntries = entries.filter((entry) => dayKey(entry.start) === today);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(running?.note ?? "");
  const newProject = useRef<HTMLInputElement>(null);

  // The note belongs to whichever entry is running now, not to the input.
  useEffect(() => setNote(running?.note ?? ""), [running?.id]);
  useEffect(() => {
    if (adding) newProject.current?.focus();
  }, [adding]);

  // One tap on the dial: no project picker, no dialog — the last project wins.
  const nextProject = running?.project ?? projects[0] ?? DEFAULT_PROJECT;

  const submitDraft = () => {
    const name = draft.trim();
    setDraft("");
    setAdding(false);
    if (name) onStart(name);
  };

  return (
    <div className="screen">
      <div className="dial">
        <button
          className={`dial-button${running ? " running" : ""}`}
          // The ring around a running dial sweeps once per minute.
          style={running ? ({ "--sweep": `${(elapsed % 60) * 6}deg` } as CSSProperties) : undefined}
          onClick={() => (running ? onStop() : onStart(nextProject))}
          aria-label={running ? `Stop tracking ${running.project}` : `Start tracking ${nextProject}`}
        >
          {running ? (
            <>
              <span className="dial-time">{formatClock(elapsed)}</span>
              <span className="dial-project">{running.project}</span>
              <span className="dial-label">Tap to stop</span>
            </>
          ) : (
            <>
              <span className="dial-label">Start</span>
              <span className="dial-project">{nextProject}</span>
            </>
          )}
        </button>

        <div className="dial-hint">
          {running ? (
            <>
              since {hhmm(running.start)} ·
              <button onClick={onDiscard}>discard</button>
            </>
          ) : (
            "Tap to start — or pick a project below"
          )}
        </div>
      </div>

      {running && (
        <input
          type="text"
          placeholder="What are you working on?"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => note !== (running.note ?? "") && onNote(note)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}

      <div className="section-title">
        <span>Projects</span>
      </div>
      <div className="chips">
        {projects.map((project) => (
          <button
            key={project}
            className={`chip${running?.project === project ? " active" : ""}`}
            onClick={() => (running?.project === project ? onStop() : onStart(project))}
          >
            <span className="swatch" />
            {project}
          </button>
        ))}

        {adding ? (
          <input
            ref={newProject}
            type="text"
            placeholder="New project…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitDraft();
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
          />
        ) : (
          <button className="chip ghost" onClick={() => setAdding(true)}>
            <PlusIcon /> New
          </button>
        )}
      </div>

      <div className="section-title">
        <span>Today</span>
        <span>{formatShort(totalSeconds(todayEntries, nowMs))}</span>
      </div>
      {todayEntries.length === 0 ? (
        <p className="empty">Nothing tracked yet today.</p>
      ) : (
        <div className="list">
          {todayEntries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} nowMs={nowMs} onClick={() => onEdit(entry)} />
          ))}
        </div>
      )}
    </div>
  );
}
