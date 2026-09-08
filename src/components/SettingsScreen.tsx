import { useEffect, useState } from "react";

import { relativeTime } from "../lib/time";
import type { Settings, Snapshot } from "../lib/types";
import { CloudIcon } from "./Icons";

type Props = {
  snapshot: Snapshot;
  busy: boolean;
  onSave: (settings: Settings) => void;
  onTest: (settings: Settings) => void;
  onSync: (full: boolean) => void;
  onForgetProject: (name: string) => void;
};

const ROUNDING = [0, 5, 6, 10, 15, 30];

export function SettingsScreen({ snapshot, busy, onSave, onTest, onSync, onForgetProject }: Props) {
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
      </div>

      {snapshot.projects.length > 0 && (
        <>
          <div className="section-title">
            <span>Projects</span>
          </div>
          <div className="card">
            <p className="small muted" style={{ margin: 0 }}>
              Tap to remove from the quick list. Tracked time is not affected.
            </p>
            <div className="chips">
              {snapshot.projects.map((name) => (
                <button key={name} className="chip" onClick={() => onForgetProject(name)}>
                  {name} ✕
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
