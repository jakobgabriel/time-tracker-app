import { useState } from "react";

import { useT } from "../lib/i18n";
import type { Settings, Snapshot } from "../lib/types";
import { TimerIcon } from "./Icons";

type Props = {
  snapshot: Snapshot;
  busy: boolean;
  onAddProject: (name: string) => Promise<boolean>;
  onSaveSettings: (settings: Settings) => Promise<boolean>;
  onTest: (settings: Settings) => void;
  onDone: (settings: Settings) => void;
};

/**
 * Three questions on first launch. Every step can be skipped — a time tracker
 * that will not let you start tracking has already failed.
 */
export function Onboarding({ snapshot, busy, onAddProject, onSaveSettings, onTest, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [project, setProject] = useState("");
  const [form, setForm] = useState<Settings>(snapshot.settings);
  const t = useT();

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const finish = () => onDone({ ...form, onboarded: true });

  return (
    <div className="onboarding">
      <div className="steps">
        {[0, 1, 2].map((index) => (
          <span key={index} className={index <= step ? "on" : undefined} />
        ))}
      </div>

      {step === 0 && (
        <>
          <TimerIcon className="mark" />
          <h1>Tempo</h1>
          <p className="lead">
            {t("One tap starts the clock, one tap stops it, and your hours end up in your Obsidian vault as plain Markdown.")}
          </p>
          <div className="field">
            <label htmlFor="first-project">{t("What will you track first?")}</label>
            <input
              id="first-project"
              type="text"
              placeholder="Acme Rollout"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && setStep(1)}
            />
            <span className="help">{t('A client, a side project, "Deep Work" — anything.')}</span>
          </div>
          <button
            className="btn primary wide"
            onClick={async () => {
              if (project.trim()) await onAddProject(project.trim());
              setStep(1);
            }}
          >
            {t("Continue")}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <h1>{t("Your vault")}</h1>
          <p className="lead">
            {t("Tempo writes into an Obsidian vault over WebDAV. You can do this later — everything works offline until you do.")}
          </p>
          <div className="field">
            <label htmlFor="ob-url">{t("Server URL")}</label>
            <input
              id="ob-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://cloud.example.com/remote.php/dav/files/me/"
              value={form.webdavUrl}
              onChange={(event) => set("webdavUrl", event.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="ob-user">{t("Username")}</label>
              <input
                id="ob-user"
                type="text"
                autoCapitalize="none"
                spellCheck={false}
                value={form.username}
                onChange={(event) => set("username", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ob-pass">{t("Password")}</label>
              <input
                id="ob-pass"
                type="password"
                value={form.password}
                onChange={(event) => set("password", event.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ob-folder">{t("Folder in the vault")}</label>
            <input
              id="ob-folder"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Time Tracking"
              value={form.vaultFolder}
              onChange={(event) => set("vaultFolder", event.target.value)}
            />
          </div>
          <div className="btn-row">
            <button
              className="btn"
              disabled={busy || !form.webdavUrl.trim()}
              onClick={() => onTest(form)}
            >
              {t("Test")}
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                if (form.webdavUrl.trim()) await onSaveSettings(form);
                setStep(2);
              }}
            >
              Continue
            </button>
          </div>
          <button className="skip" onClick={() => setStep(2)}>
            {t("Skip for now")}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h1>{t("How should it write?")}</h1>
          <p className="lead">
            {t("Tempo only ever owns the block between its own markers. Anything else in the note stays yours.")}
          </p>
          <div className="field">
            <label htmlFor="ob-layout">{t("One note per")}</label>
            <select
              id="ob-layout"
              value={form.fileLayout}
              onChange={(event) => set("fileLayout", event.target.value as Settings["fileLayout"])}
            >
              <option value="daily">Day — 2026-09-09.md</option>
              <option value="monthly">Month — 2026-09.md</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ob-goal">{t("Daily goal")}</label>
            <select
              id="ob-goal"
              value={form.dailyGoalMinutes}
              onChange={(event) => set("dailyGoalMinutes", Number(event.target.value))}
            >
              <option value={0}>{t("No goal")}</option>
              <option value={360}>6 hours</option>
              <option value={420}>7 hours</option>
              <option value={480}>8 hours</option>
            </select>
            <span className="help">Draws a ring around the start button as the day fills up.</span>
          </div>
          <button className="btn primary wide" onClick={finish}>
            {t("Start tracking")}
          </button>
        </>
      )}
    </div>
  );
}
