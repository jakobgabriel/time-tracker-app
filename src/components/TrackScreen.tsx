import { useEffect, useRef, useState } from "react";

import { entrySeconds, dayKey, formatClock, formatShort, hhmm, localIso, totalSeconds }
  from "../lib/time";
import { projectColor } from "../lib/colors";
import { orderedProjects } from "../lib/stats";
import { useT } from "../lib/i18n";
import type { Entry, IdleGap, Snapshot, VaultTask } from "../lib/types";
import { DayTimeline } from "./DayTimeline";
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
  onTrim: (entry: Entry, minutes: number) => void;
  onShiftStart: (entry: Entry, minutes: number) => void;
  onFillGap: (day: string, from: string, to: string) => void;
  tasks: VaultTask[];
  onStartTask: (task: VaultTask) => void;
  idle: IdleGap | null;
  onStopAt: (entry: Entry, iso: string) => void;
  onKeepIdle: () => void;
};

export function TrackScreen({
  snapshot, nowMs, onStart, onStop, onDiscard, onEdit, onNote, onTrim, onShiftStart, onFillGap,
  tasks, onStartTask, idle, onStopAt, onKeepIdle,
}: Props) {
  const { entries } = snapshot;
  const projects = orderedProjects(snapshot.projects, snapshot.pinned);
  const t = useT();
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
  // Deliberately the raw list, not the pinned order: a pin arranges the chips,
  // it does not quietly change what the button repeats.
  const nextProject = running?.project ?? snapshot.projects[0] ?? DEFAULT_PROJECT;

  const todaySeconds = totalSeconds(todayEntries, nowMs);
  const goal = snapshot.settings.dailyGoalMinutes * 60;
  // The ring means one thing at a time: progress towards today's goal when
  // there is one, otherwise a second hand for the running timer.
  const ring = goal > 0
    ? Math.min(todaySeconds / goal, 1) * 360
    : running
      ? (elapsed % 60) * 6
      : null;

  // A timer left running overnight is the one way this app can quietly lie.
  const maxMinutes = snapshot.settings.maxSessionMinutes;
  const overrun = Boolean(running) && maxMinutes > 0 && elapsed > maxMinutes * 60;

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
          className={`dial-button${running ? " running" : ""}${ring === null ? "" : " has-ring"}${
            overrun ? " overrun" : ""
          }`}
          onClick={() => (running ? onStop() : onStart(nextProject))}
          aria-label={running ? `Stop tracking ${running.project}` : `Start tracking ${nextProject}`}
        >
          {ring !== null && (
            <span className="dial-ring" style={{ ["--sweep" as string]: `${ring}deg` }} />
          )}
          {running ? (
            <>
              <span className="dial-time">{formatClock(elapsed)}</span>
              <span className="dial-project">{running.project}</span>
              <span className="dial-label">{t("Tap to stop")}</span>
            </>
          ) : (
            <>
              <span className="dial-label">{t("Start")}</span>
              <span className="dial-project">{nextProject}</span>
            </>
          )}
        </button>

        {idle && running ? (
          <div className="warn">
            <span>
              {t("This ran for {away} without the app being opened.", {
                away: formatShort(idle.seconds),
              })}
            </span>
            <div className="btn-row">
              <button className="btn" onClick={() => onStopAt(running, idle.since)}>
                {t("Stop at {time}", { time: hhmm(idle.since) })}
              </button>
              <button className="btn" onClick={onKeepIdle}>
                {t("Keep it")}
              </button>
            </div>
          </div>
        ) : (
          overrun && running && (
            <div className="warn">
              <span>
                {t("Running for {elapsed} — forgotten?", { elapsed: formatShort(elapsed) })}
              </span>
              <div className="btn-row">
                <button className="btn" onClick={() => onTrim(running, maxMinutes)}>
                  {t("Stop at {limit}", { limit: formatShort(maxMinutes * 60) })}
                </button>
                <button className="btn" onClick={onStop}>
                  {t("Stop now")}
                </button>
              </div>
            </div>
          )
        )}

        <div className="dial-hint">
          {running ? (
            <>
              {t("since")} {hhmm(running.start)}
              {/* Forgot to hit start? Move the beginning, don't retype it. */}
              <button
                className="nudge"
                aria-label="Started five minutes earlier"
                onClick={() => onShiftStart(running, -5)}
              >
                −5
              </button>
              <button
                className="nudge"
                aria-label="Started five minutes later"
                disabled={elapsed < 300}
                onClick={() => onShiftStart(running, 5)}
              >
                +5
              </button>
              ·<button onClick={onDiscard}>{t("discard")}</button>
              {goal > 0 && <> · {formatShort(todaySeconds)} of {formatShort(goal)}</>}
            </>
          ) : goal > 0 ? (
            t(todaySeconds >= goal ? "{done} of {goal} — goal reached" : "{done} of {goal}", {
              done: formatShort(todaySeconds),
              goal: formatShort(goal),
            })
          ) : (
            t("Tap to start — or pick a project below")
          )}
        </div>
      </div>

      {running && (
        <input
          type="text"
          placeholder={t("What are you working on?")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => note !== (running.note ?? "") && onNote(note)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}

      {tasks.length > 0 && (
        <>
          <div className="section-title">
            <span>{t("From today's note")}</span>
          </div>
          <ul className="tasks">
            {tasks.map((task) => (
              <li key={task.text}>
                <button onClick={() => onStartTask(task)}>
                  <span className="box" aria-hidden="true" />
                  <span className="what">{task.text}</span>
                  {task.project && <span className="where">{task.project}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-title">
        <span>{t("Projects")}</span>
      </div>
      <div className="chips">
        {projects.map((project) => (
          <button
            key={project}
            className={`chip${running?.project === project ? " active" : ""}`}
            onClick={() => (running?.project === project ? onStop() : onStart(project))}
          >
            <span className="swatch" style={{ background: projectColor(project) }} />
            {project}
          </button>
        ))}

        {adding ? (
          <input
            ref={newProject}
            type="text"
            placeholder={t("New project…")}
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
            <PlusIcon /> {t("New")}
          </button>
        )}
      </div>

      <div className="section-title">
        <span>{t("Today")}</span>
        <span>{formatShort(todaySeconds)}</span>
      </div>

      <DayTimeline
        entries={todayEntries}
        day={today}
        nowMs={nowMs}
        onFillGap={onFillGap}
        onSelect={onEdit}
      />

      {todayEntries.length === 0 ? (
        <p className="empty">{t("Nothing tracked yet today.")}</p>
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
