import { useEffect, useState, type ReactNode } from "react";

import { projectColor } from "../lib/colors";
import { useT, type Translate } from "../lib/i18n";
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

const goalLabel = (minutes: number, t: Translate) =>
  minutes === 0
    ? t("No goal")
    : minutes % 60 === 0
      ? t("{n} hours", { n: minutes / 60 })
      : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;

/** A collapsible section; the summary carries the state so it can stay shut. */
function Section({
  title,
  status,
  open,
  children,
}: {
  title: string;
  status: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <span className="name">{title}</span>
        <span className="status">{status}</span>
      </summary>
      <div className="body">{children}</div>
    </details>
  );
}

export function SettingsScreen({
  snapshot, busy, onSave, onTest, onSync, onExport, onImport, onBackup, onRestore, onOpenProject,
}: Props) {
  const t = useT();
  const [form, setForm] = useState<Settings>(snapshot.settings);

  // Adopt what the backend confirmed, but only when it actually changed — a
  // periodic snapshot refresh must not overwrite half-typed credentials.
  const stored = JSON.stringify(snapshot.settings);
  useEffect(() => setForm(JSON.parse(stored) as Settings), [stored]);

  const dirty = JSON.stringify(form) !== stored;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const connected = snapshot.settings.webdavUrl.trim();
  const rates = Object.values(snapshot.projectRates).filter((rate) => rate > 0).length;

  return (
    <div className="screen settings">
      <Section
        title={t("Obsidian")}
        status={connected ? new URL(connected).host : t("not connected")}
        open={!connected}
      >
        <div className="field">
          <label htmlFor="url">{t("Server URL")}</label>
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
            {t("The WebDAV root of the account — the vault folder is added below.")}
          </span>
        </div>

        <div className="field">
          <label htmlFor="user">{t("Username")}</label>
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
          <label htmlFor="pass">{t("Password")}</label>
          <input
            id="pass"
            type="password"
            value={form.password}
            onChange={(event) => set("password", event.target.value)}
          />
          <span className="help">{t("Use an app password if your provider offers one.")}</span>
        </div>

        <div className="field">
          <label htmlFor="folder">{t("Folder in the vault")}</label>
          <input
            id="folder"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Time Tracking"
            value={form.vaultFolder}
            onChange={(event) => set("vaultFolder", event.target.value)}
          />
          <span className="help">
            {t("Holds the notes, the backup and the exports. Created if it does not exist.")}
          </span>
        </div>

        <button className="btn wide" onClick={() => onTest(form)} disabled={busy || !form.webdavUrl.trim()}>
          {t("Test the connection")}
        </button>
      </Section>

      <Section
        title={t("Notes")}
        status={`${t(form.fileLayout === "daily" ? "one per day" : "one per month")}${
          form.notePattern.trim() ? ` · ${t("custom path")}` : ""
        }`}
      >
        <div className="field">
          <label htmlFor="layout">{t("One note per")}</label>
          <select
            id="layout"
            value={form.fileLayout}
            onChange={(event) => set("fileLayout", event.target.value as Settings["fileLayout"])}
          >
            <option value="daily">Day — 2026-09-09.md</option>
            <option value="monthly">Month — 2026-09.md</option>
          </select>
          <span className="help">
            {t("Only the block between the tempo markers is rewritten; the rest of the note stays yours.")}
          </span>
        </div>

        <div className="field">
          <label htmlFor="pattern">{t("Note path")}</label>
          <input
            id="pattern"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Daily/{YYYY}/{YYYY-MM-DD}.md"
            value={form.notePattern}
            onChange={(event) => set("notePattern", event.target.value)}
          />
          <span className="help">
            Leave empty to keep the notes in the folder above. Set it to write into the daily notes
            your vault already has — relative to the WebDAV root. Placeholders:{" "}
            <code>{"{YYYY} {MM} {DD} {YYYY-MM-DD} {YYYY-MM} {MMM} {MMMM} {YYYY-Www} {ww}"}</code>
          </span>
        </div>

        <div className="switch">
          <span>
            {t("Weekly summary note")}
            <br />
            <span className="small muted">{t("A roll-up per ISO week.")}</span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.weeklySummary}
            aria-label="Weekly summary note"
            onClick={() => set("weeklySummary", !form.weeklySummary)}
          />
        </div>

        {form.weeklySummary && (
          <div className="field">
            <label htmlFor="weekly-pattern">Weekly note path</label>
            <input
              id="weekly-pattern"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Weekly/{YYYY-Www}.md"
              value={form.weeklyPattern}
              onChange={(event) => set("weeklyPattern", event.target.value)}
            />
            <span className="help">Empty keeps a Weekly folder inside the vault folder.</span>
          </div>
        )}

        <div className="switch">
          <span>
            {t("Link projects")}
            <br />
            <span className="small muted">
              {t("Writes [[Acme]], so the vault builds a note per project.")}
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
            {t("A note per project")}
            <br />
            <span className="small muted">
              {t("Projects/Acme.md gets its own log: a row per day, with totals.")}
            </span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.projectNotes}
            aria-label="A note per project"
            onClick={() => set("projectNotes", !form.projectNotes)}
          />
        </div>

        {form.projectNotes && (
          <div className="field">
            <label htmlFor="project-pattern">Project note path</label>
            <input
              id="project-pattern"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Projects/{project}.md"
              value={form.projectPattern}
              onChange={(event) => set("projectPattern", event.target.value)}
            />
            <span className="help">
              <code>{"{project}"}</code> is the project's name. Empty keeps a Projects folder inside
              the vault folder.
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="vault-name">{t("Vault name")}</label>
          <input
            id="vault-name"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="My Vault"
            value={form.vaultName}
            onChange={(event) => set("vaultName", event.target.value)}
          />
          <span className="help">
            {t("Obsidian's name for the vault. With it, History gets a link straight into each day's note.")}
          </span>
        </div>

        <div className="field">
          <label htmlFor="tag">{t("Tag for new notes")}</label>
          <input
            id="tag"
            type="text"
            autoCapitalize="none"
            value={form.noteTag}
            onChange={(event) => set("noteTag", event.target.value)}
          />
        </div>
      </Section>

      <Section
        title={t("Tracking")}
        status={[
          goalLabel(form.dailyGoalMinutes, t),
          form.roundMinutes ? t("{n} minutes", { n: form.roundMinutes }) : t("Exact"),
        ].join(" · ")}
      >
        <div className="field">
          <label htmlFor="goal">{t("Daily goal")}</label>
          <select
            id="goal"
            value={form.dailyGoalMinutes}
            onChange={(event) => set("dailyGoalMinutes", Number(event.target.value))}
          >
            {GOALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? t("No goal") : t("{n} hours", { n: minutes / 60 })}
              </option>
            ))}
          </select>
          <span className="help">
            {t("Draws today's progress as a ring around the start button, and a line on the chart.")}
          </span>
        </div>

        <div className="field">
          <label htmlFor="limit">{t("Warn about a long session")}</label>
          <select
            id="limit"
            value={form.maxSessionMinutes}
            onChange={(event) => set("maxSessionMinutes", Number(event.target.value))}
          >
            {LIMITS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? t("Never") : t("After {n} hours", { n: minutes / 60 })}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="round">{t("Round durations")}</label>
          <select
            id="round"
            value={form.roundMinutes}
            onChange={(event) => set("roundMinutes", Number(event.target.value))}
          >
            {ROUNDING.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? t("Exact") : t("{n} minutes", { n: minutes })}
              </option>
            ))}
          </select>
          <span className="help">
            {t("Applies to the note and the CSV only — your raw times stay exact.")}
          </span>
        </div>

        <div className="switch">
          <span>
            {t("Split at midnight")}
            <br />
            <span className="small muted">
              {t("A session running past midnight counts on both days.")}
            </span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.splitAtMidnight}
            aria-label="Split sessions at midnight"
            onClick={() => set("splitAtMidnight", !form.splitAtMidnight)}
          />
        </div>

        <div className="field">
          <label htmlFor="language">{t("Language")}</label>
          <select
            id="language"
            value={form.language || ""}
            onChange={(event) => set("language", event.target.value)}
          >
            <option value="">{t("Language")} — auto</option>
            <option value="en">{t("English")}</option>
            <option value="de">{t("German")}</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="currency">{t("Currency symbol")}</label>
          <input
            id="currency"
            type="text"
            maxLength={4}
            value={form.currency}
            onChange={(event) => set("currency", event.target.value)}
          />
          <span className="help">
            {rates > 0
              ? `Used wherever an amount appears. ${rates} project(s) have a rate.`
              : "Amounts only appear once a project has an hourly rate — set one below."}
          </span>
        </div>
      </Section>

      <Section
        title={t("Sync")}
        status={[
          snapshot.pendingDays > 0
            ? t("{n} day(s) waiting", { n: snapshot.pendingDays })
            : t("synced {when}", { when: relativeTime(snapshot.settings.lastSync) }),
          form.twoWaySync ? t("two-way") : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        open
      >
        <div className="switch">
          <span>
            {t("Sync when a timer stops")}
            <br />
            <span className="small muted">{t("A failed sync is retried when you come back.")}</span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.autoSync}
            aria-label="Sync when a timer stops"
            onClick={() => set("autoSync", !form.autoSync)}
          />
        </div>

        <div className="switch">
          <span>
            {t("Two-way sync")}
            <br />
            <span className="small muted">
              {t("Reads the vault's backup before writing, so a second device's work — and its deletions — arrive here.")}
            </span>
          </span>
          <button
            className="track"
            role="switch"
            aria-checked={form.twoWaySync}
            aria-label="Two-way sync"
            onClick={() => set("twoWaySync", !form.twoWaySync)}
          />
        </div>

        <div className="btn-row">
          <button className="btn primary" onClick={() => onSync(false)} disabled={busy}>
            <CloudIcon className={busy ? "spin" : undefined} /> {t("Sync now")}
          </button>
          <button className="btn" onClick={() => onSync(true)} disabled={busy}>
            {t("Rewrite all")}
          </button>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={onExport} disabled={busy}>
            <TableIcon /> {t("Export CSV")}
          </button>
          <button className="btn" onClick={onImport} disabled={busy}>
            {t("Import CSV")}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t("Export writes tempo-export.csv; import reads tempo-import.csv from the same folder and adds whatever this device is missing.")}
        </p>
      </Section>

      <Section title={t("Backup")} status={t(form.autoBackup ? "on every sync" : "manual")}>
        <div className="switch">
          <span>
            {t("Back up on every sync")}
            <br />
            <span className="small muted">
              {t("Keeps tempo-backup.json in the vault. No credentials are written.")}
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
            <ShieldIcon /> {t("Back up")}
          </button>
          <button className="btn" onClick={onRestore} disabled={busy}>
            {t("Restore")}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t("Restoring merges the backup into this device: entries it does not have are added, nothing here is overwritten.")}
        </p>
      </Section>

      <Section
        title={t("Projects")}
        status={`${snapshot.projects.length}${
          snapshot.pinned.length ? ` · ${t("{n} pinned", { n: snapshot.pinned.length })}` : ""
        }`}
      >
        {snapshot.projects.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Projects appear here once you have tracked something.
          </p>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t("Tap a project to rename, price, tag, pin or remove it.")}
            </p>
            <div className="chips">
              {snapshot.projects.map((name) => (
                <button key={name} className="chip" onClick={() => onOpenProject(name)}>
                  <span className="swatch" style={{ background: projectColor(name) }} />
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
      </Section>

      <button
        className={dirty ? "btn primary wide save" : "btn wide save"}
        onClick={() => onSave(form)}
        disabled={!dirty}
      >
        {t(dirty ? "Save changes" : "All changes saved")}
      </button>

      <p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>
        Tempo 0.1 · data stays on this device until you sync
      </p>
    </div>
  );
}
