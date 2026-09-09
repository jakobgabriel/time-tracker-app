import { useEffect, useState } from "react";

import { projectColor } from "../lib/colors";
import { relativeTime } from "../lib/time";
import type { Settings, Snapshot } from "../lib/types";
import { CloudIcon, ShieldIcon, TableIcon } from "./Icons";

type Props = {
  snapshot: Snapshot;
  busy: boolean;
  onSave: (settings: Settings) => void;
  onTest: (settings: Settings) => void;
  onSync: (full: boolean) => void;
  onExport: () => void;
  onImport: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onOpenProject: (name: string) => void;
};

const ROUNDING = [0, 5, 6, 10, 15, 30];
const GOALS = [0, 240, 360, 420, 450, 480, 600];
const LIMITS = [0, 240, 360, 480, 600, 720];

const goalLabel = (minutes: number) =>
  minutes === 0
    ? "No goal"
    : minutes % 60 === 0
      ? `${minutes / 60} hours`
      : `${Math.floor(minutes / 60)}\u00a0h ${minutes % 60} min`;

export function SettingsScreen({
  snapshot, busy, onSave, onTest, onSync, onExport, onImport, onBackup, onRestore, onOpenProject,
}: Props) {
  const [form, setForm] = useState<Settings>(snapshot.settings);

  // Adopt what the backend confirmed, but only when it actually changed — a
  // periodic snapshot refresh must not overwrite half-typed credentials.
  const stored = JSON.stringify(snapshot.settings);
  useEffect(() => setForm(JSON.parse(stored) as Settings), [stored]);

  const dirty = JSON.stringify(form) !== stored;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="screen">
      <div className="section-title">
        <span>Obsidian via WebDAV</span>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="url">Server URL</label>
          <input
            id="url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://cloud.example.com/remote.php/dav/files/me/"
            value={form.webdavUrl}
            onChange={(event) => set("webdavUrl", event.target.value)}
          />
          <span className="help">
            The WebDAV root of the account — the vault folder is added below.
          </span>
        </div>

        <div className="field">
          <label htmlFor="user">Username</label>
          <input
            id="user"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={form.username}
            onChange={(event) => set("username", event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="pass">Password</label>
          <input
            id="pass"
            type="password"
            value={form.password}
            onChange={(event) => set("password", event.target.value)}
          />
          <span className="help">Use an app password if your provider offers one.</span>
        </div>

        <div className="field">
          <label htmlFor="folder">Folder in the vault</label>
          <input
            id="folder"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Time Tracking"
            value={form.vaultFolder}
            onChange={(event) => set("vaultFolder", event.target.value)}
          />
          <span className="help">Created automatically if it does not exist.</span>
        </div>

        <div className="btn-row">
          <button
            className="btn"
            onClick={() => onTest(form)}
            disabled={busy || !form.webdavUrl.trim()}
          >
            Test
          </button>
          <button
            className={dirty ? "btn primary" : "btn"}
            onClick={() => onSave(form)}
            disabled={!dirty}
          >
            {dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      <div className="section-title">
        <span>Notes</span>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="layout">One note per</label>
          <select
            id="layout"
            value={form.fileLayout}
            onChange={(event) => set("fileLayout", event.target.value as Settings["fileLayout"])}
          >
            <option value="daily">Day — 2026-09-08.md</option>
            <option value="monthly">Month — 2026-09.md</option>
          </select>
          <span className="help">
            Only the block between the <code>tempo</code> markers is rewritten; the rest of the
            note stays yours.
          </span>
        </div>

        <div className="field">
          <label htmlFor="round">Round durations</label>
          <select
            id="round"
            value={form.roundMinutes}
            onChange={(event) => set("roundMinutes", Number(event.target.value))}
          >
            {ROUNDING.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "Exact" : `${minutes} minutes`}
              </option>
            ))}
          </select>
          <span className="help">Applies to the synced note only — your raw times are kept.</span>
        </div>

        <div className="field">
          <label htmlFor="goal">Daily goal</label>
          <select
            id="goal"
            value={form.dailyGoalMinutes}
            onChange={(event) => set("dailyGoalMinutes", Number(event.target.value))}
          >
            {GOALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {goalLabel(minutes)}
              </option>
            ))}
          </select>
          <span className="help">
            Draws today's progress as a ring around the start button, and a line on the chart.
          </span>
        </div>

        <div className="field">
          <label htmlFor="limit">Warn about a long session</label>
          <select
            id="limit"
            value={form.maxSessionMinutes}
            onChange={(event) => set("maxSessionMinutes", Number(event.target.value))}
          >
            {LIMITS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "Never" : `After ${minutes / 60} hours`}
              </option>
            ))}
          </select>
          <span className="help">
            A timer left running overnight is offered a sensible end time instead of quietly
            inflating the day.
          </span>
        </div>

        <div className="switch">
          <span>
            Link projects
            <br />
            <span className="small muted">
              Writes <code>[[Acme]]</code> instead of plain text, so the vault builds a note per
              project.
            </span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.linkProjects}
            aria-label="Link projects as wikilinks"
            onClick={() => set("linkProjects", !form.linkProjects)}
          />
        </div>

        <div className="switch">
          <span>
            Weekly summary note
            <br />
            <span className="small muted">A roll-up per ISO week in a Weekly folder.</span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.weeklySummary}
            aria-label="Weekly summary note"
            onClick={() => set("weeklySummary", !form.weeklySummary)}
          />
        </div>

        <div className="field">
          <label htmlFor="currency">Currency symbol</label>
          <input
            id="currency"
            type="text"
            maxLength={4}
            value={form.currency}
            onChange={(event) => set("currency", event.target.value)}
          />
          <span className="help">
            Used wherever an amount appears. Rates are set per project, further down.
          </span>
        </div>

        <div className="field">
          <label htmlFor="tag">Tag for new notes</label>
          <input
            id="tag"
            type="text"
            autoCapitalize="none"
            value={form.noteTag}
            onChange={(event) => set("noteTag", event.target.value)}
          />
        </div>

        <div className="switch">
          <span>
            Sync when a timer stops
            <br />
            <span className="small muted">Otherwise sync by hand below.</span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.autoSync}
            aria-label="Sync when a timer stops"
            onClick={() => set("autoSync", !form.autoSync)}
          />
        </div>

        <button
          className={dirty ? "btn primary wide" : "btn wide"}
          onClick={() => onSave(form)}
          disabled={!dirty}
        >
          {dirty ? "Save changes" : "All changes saved"}
        </button>
      </div>

      <div className="section-title">
        <span>Sync</span>
      </div>

      <div className="card">
        <p className="small muted" style={{ margin: 0 }}>
          Last sync {relativeTime(snapshot.settings.lastSync)}
          {snapshot.pendingDays > 0 && ` · ${snapshot.pendingDays} day(s) waiting`}
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => onSync(false)} disabled={busy}>
            <CloudIcon className={busy ? "spin" : undefined} /> Sync now
          </button>
          <button className="btn" onClick={() => onSync(true)} disabled={busy}>
            Rewrite all
          </button>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={onExport} disabled={busy}>
            <TableIcon /> Export CSV
          </button>
          <button className="btn" onClick={onImport} disabled={busy}>
            Import CSV
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Export writes <code>tempo-export.csv</code> next to your notes — every entry, ready for a
          spreadsheet or an invoice. Import reads <code>tempo-import.csv</code> from the same folder
          and adds whatever this device is missing.
        </p>
      </div>

      <div className="section-title">
        <span>Backup</span>
      </div>

      <div className="card">
        <div className="switch">
          <span>
            Back up on every sync
            <br />
            <span className="small muted">
              Keeps <code>tempo-backup.json</code> in the vault. No credentials are written.
            </span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.autoBackup}
            aria-label="Back up on every sync"
            onClick={() => set("autoBackup", !form.autoBackup)}
          />
        </div>
        <div className="btn-row">
          <button className="btn" onClick={onBackup} disabled={busy}>
            <ShieldIcon /> Back up
          </button>
          <button className="btn" onClick={onRestore} disabled={busy}>
            Restore
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Restoring merges the backup into this device: entries it does not have are added, nothing
          here is overwritten.
        </p>
        <button
          className={dirty ? "btn primary wide" : "btn wide"}
          onClick={() => onSave(form)}
          disabled={!dirty}
        >
          {dirty ? "Save changes" : "All changes saved"}
        </button>
      </div>

      {snapshot.projects.length > 0 && (
        <>
          <div className="section-title">
            <span>Projects</span>
          </div>
          <div className="card">
            <p className="small muted" style={{ margin: 0 }}>
              Tap a project to rename, merge or remove it.
            </p>
            <div className="chips">
              {snapshot.projects.map((name) => (
                <button key={name} className="chip" onClick={() => onOpenProject(name)}>
                  <span className="swatch" style={{ background: projectColor(name) }} />
                  {name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="small muted" style={{ marginTop: 22, textAlign: "center" }}>
        Tempo 0.1 · data stays on this device until you sync
      </p>
    </div>
  );
}
