import { useCallback, useEffect, useMemo, useState } from "react";

import { api, errorMessage } from "./lib/api";
import { detectLang, LangProvider, translator, type Lang } from "./lib/i18n";
import {
  dayKey, formatShort, localIso, plusMinutes, totalSeconds, withDay, withTime,
} from "./lib/time";
import type { Entry, IdleGap, Settings, Snapshot, VaultTask } from "./lib/types";
import { EntrySheet } from "./components/EntrySheet";
import { ChartIcon, GearIcon, ListIcon, TimerIcon } from "./components/Icons";
import { HistoryScreen } from "./components/HistoryScreen";
import { InsightsScreen } from "./components/InsightsScreen";
import { Onboarding } from "./components/Onboarding";
import { SettingsScreen } from "./components/SettingsScreen";
import { BulkSheet } from "./components/BulkSheet";
import { ConflictBanner } from "./components/ConflictBanner";
import { ProjectSheet } from "./components/ProjectSheet";
import { Toast, useToast } from "./components/Toast";
import { TrackScreen } from "./components/TrackScreen";

type Tab = "track" | "insights" | "history" | "settings";

const TITLES: Record<Tab, string> = {
  track: "Tempo",
  insights: "Insights",
  history: "History",
  settings: "Settings",
};

const blankEntry = (): Entry => {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60 * 1000);
  return {
    id: "",
    project: "",
    note: "",
    tags: [],
    start: localIso(start),
    end: localIso(now),
  };
};

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("track");
  const [editing, setEditing] = useState<Entry | null>(null);

  /** Turns an untracked stretch into a half-filled entry, ready to name. */
  const fillGap = useCallback((day: string, from: string, to: string) => {
    const base = localIso();
    setEditing({
      id: "",
      project: "",
      note: "",
      tags: [],
      start: withTime(withDay(base, day), from),
      end: withTime(withDay(base, day), to),
    });
  }, []);
  const [project, setProject] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, showToast, dismissToast] = useToast();

  const running = snapshot?.entries.find((entry) => !entry.end);
  // Empty means "follow the device", which is what a first launch should do.
  const lang: Lang =
    snapshot?.settings.language === "de" || snapshot?.settings.language === "en"
      ? snapshot.settings.language
      : detectLang();
  const t = translator(lang);

  /** Wraps a backend call so every failure surfaces as a toast, never a blank screen. */
  const run = useCallback(
    async (action: () => Promise<Snapshot>, success?: string) => {
      try {
        const next = await action();
        setSnapshot(next);
        // The notification is a view of the store, so it is refreshed from the
        // one place every change goes through.
        api.refreshNotification();
        if (success) showToast(success, "ok");
        return true;
      } catch (error) {
        showToast(errorMessage(error), "error");
        return false;
      }
    },
    [showToast],
  );

  useEffect(() => {
    run(() => api.snapshot());
  }, [run]);

  // Tick only while something is running — a still screen costs no wakeups.
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running?.id]);

  // "Seen" is what makes an honest answer possible when a timer has been
  // running for hours: not the session limit, but the moment the app was last
  // actually open. Heartbeat while visible, and again on every return to the
  // front — a phone that slept through the night reports on the first look.
  const [idle, setIdle] = useState<IdleGap | null>(null);
  useEffect(() => {
    if (!running) {
      setIdle(null);
      return;
    }
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      api.seen().then((gap) => gap && setIdle(gap)).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [running?.id]);

  // Today's plan lives in the vault, so it is fetched rather than derived —
  // on launch, and again whenever the app is brought back to the front. A
  // vault that is unreachable simply means no tasks; it is not an error worth
  // interrupting someone's day with.
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const loadTasks = useCallback(() => {
    api.vaultTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  useEffect(() => {
    if (!snapshot?.settings.webdavUrl.trim()) return;
    loadTasks();
    const refresh = () => document.visibilityState === "visible" && loadTasks();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [snapshot?.settings.webdavUrl, loadTasks]);

  // Coming back from the background: the elapsed time is derived from the
  // start timestamp, so a single refresh is all it takes to be correct again.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
        run(() => api.snapshot());
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [run]);

  const sync = useCallback(
    async (full: boolean, quiet = false, force = false) => {
      setBusy(true);
      try {
        const report = await api.sync(full, force);
        setSnapshot(await api.snapshot());
        // A conflict is worth saying out loud even on a background sync: the
        // banner explains it, but the sync did not do what was asked.
        if (report.conflicts.length) {
          showToast(
            `${report.conflicts.length} note(s) were edited in your vault — left alone`,
            "error",
          );
        } else if (!quiet) {
          showToast(
            report.files === 0
              ? "Everything is already up to date"
              : force
                ? "Synced, and overwrote what was edited"
                : `Synced ${report.files} note(s)`,
            "ok",
          );
        }
      } catch (error) {
        showToast(errorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  // A sync that failed while offline should not wait for the next stop.
  useEffect(() => {
    if (!snapshot?.pendingDays) return;
    const { autoSync, webdavUrl } = snapshot.settings;
    if (!autoSync || !webdavUrl.trim()) return;
    const retry = () => document.visibilityState === "visible" && sync(false, true);
    document.addEventListener("visibilitychange", retry);
    return () => document.removeEventListener("visibilitychange", retry);
  }, [snapshot?.pendingDays, snapshot?.settings, sync]);

  const stop = useCallback(async () => {
    const settings = snapshot?.settings;
    const ok = await run(() => api.stop());
    if (ok && settings?.autoSync && settings.webdavUrl.trim()) {
      sync(false, true);
    }
  }, [run, snapshot?.settings, sync]);

  const todayTotal = useMemo(() => {
    if (!snapshot) return 0;
    const today = dayKey(localIso(new Date(nowMs)));
    return totalSeconds(
      snapshot.entries.filter((entry) => dayKey(entry.start) === today),
      nowMs,
    );
  }, [snapshot, nowMs]);

  if (!snapshot) {
    return (
      <div className="app">
        <div className="screen" />
      </div>
    );
  }

  // First launch: nothing tracked, no vault, and the guide not yet seen.
  if (!snapshot.settings.onboarded && !snapshot.entries.length && !snapshot.settings.webdavUrl) {
    return (
      <LangProvider lang={lang}>
      <div className="app">
        <Onboarding
          snapshot={snapshot}
          busy={busy}
          onAddProject={(name) => run(() => api.addProject(name))}
          onSaveSettings={(settings) => run(() => api.saveSettings(settings))}
          onTest={async (settings) => {
            setBusy(true);
            try {
              showToast(await api.testConnection(settings), "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onDone={(settings) => run(() => api.saveSettings(settings))}
        />
        <Toast toast={toast} onDismiss={dismissToast} />
      </div>
      </LangProvider>
    );
  }

  return (
    <LangProvider lang={lang}>
    <div className="app">
      <header className="topbar">
        <h1>{t(TITLES[tab])}</h1>
        <span className="today">
          {t("today")} <b>{formatShort(todayTotal)}</b>
        </span>
      </header>

      <ConflictBanner
        conflicts={snapshot.conflicts}
        vault={snapshot.settings.vaultName}
        busy={busy}
        onKeep={async () => {
          setBusy(true);
          try {
            setSnapshot(await api.keepVaultVersion());
            showToast("Kept the vault's version", "ok");
          } catch (error) {
            showToast(errorMessage(error), "error");
          } finally {
            setBusy(false);
          }
        }}
        onOverwrite={() => sync(false, false, true)}
      />

      {tab === "track" && (
        <TrackScreen
          snapshot={snapshot}
          nowMs={nowMs}
          onStart={(project) => run(() => api.start(project))}
          onStop={stop}
          onDiscard={async () => {
            // Discarding throws work away; keep it recoverable for a moment.
            const discarded = running;
            if (await run(() => api.discard()) && discarded) {
              showToast("Timer discarded", "info", {
                label: "Undo",
                run: () => run(() => api.saveEntry(discarded), "Timer restored"),
              });
            }
          }}
          onEdit={setEditing}
          onNote={(note) => running && run(() => api.saveEntry({ ...running, note }))}
          onFillGap={fillGap}
          idle={idle}
          onStopAt={async (entry, iso) => {
            if (await run(() => api.saveEntry({ ...entry, end: iso }), "Stopped where you left off")) {
              setIdle(null);
            }
          }}
          onKeepIdle={() => setIdle(null)}
          tasks={tasks}
          onStartTask={(task) =>
            // The task names the work, so it becomes the note. Its wikilink
            // names the project when it has one; otherwise the project is
            // whichever was used last, which is nearly always the right guess.
            run(async () => {
              const project =
                task.project?.trim() || snapshot.projects[0] || task.text;
              const started = (await api.start(project)).entries.find((entry) => !entry.end);
              return started
                ? await api.saveEntry({ ...started, note: task.text })
                : await api.snapshot();
            }, `Tracking “${task.text}”`)
          }
          onShiftStart={(entry, minutes) =>
            run(() => api.saveEntry({ ...entry, start: plusMinutes(entry.start, minutes) }))
          }
          onTrim={(entry, minutes) =>
            run(
              () => api.saveEntry({ ...entry, end: plusMinutes(entry.start, minutes) }),
              "Stopped at the session limit",
            )
          }
        />
      )}

      {tab === "insights" && (
        <InsightsScreen
          snapshot={snapshot}
          nowMs={nowMs}
          onEdit={setEditing}
          onInvoice={async (month) => {
            setBusy(true);
            try {
              showToast(await api.writeInvoice(month), "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === "history" && (
        <HistoryScreen
          snapshot={snapshot}
          nowMs={nowMs}
          onEdit={setEditing}
          onAdd={() => setEditing(blankEntry())}
          onFillGap={fillGap}
          onBulkEdit={setBulk}
        />
      )}

      {tab === "settings" && (
        <SettingsScreen
          snapshot={snapshot}
          busy={busy}
          onSave={(settings: Settings) => run(() => api.saveSettings(settings), "Settings saved")}
          onTest={async (settings) => {
            setBusy(true);
            try {
              showToast(await api.testConnection(settings), "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onSync={(full) => sync(full)}
          onExport={async () => {
            setBusy(true);
            try {
              showToast(await api.exportCsv(), "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onImport={async () => {
            setBusy(true);
            try {
              const message = await api.importCsv();
              setSnapshot(await api.snapshot());
              showToast(message, "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onBackup={async () => {
            setBusy(true);
            try {
              showToast(await api.backup(), "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onRestore={async () => {
            setBusy(true);
            try {
              const message = await api.restore();
              setSnapshot(await api.snapshot());
              showToast(message, "ok");
            } catch (error) {
              showToast(errorMessage(error), "error");
            } finally {
              setBusy(false);
            }
          }}
          onOpenProject={setProject}
          onPreview={async (settings) => {
            try {
              return await api.previewNote(settings);
            } catch (error) {
              showToast(errorMessage(error), "error");
              return null;
            }
          }}
        />
      )}

      <nav className="tabbar">
        <button aria-current={tab === "track" ? "page" : undefined} onClick={() => setTab("track")}>
          <TimerIcon />
          {t("Track")}
        </button>
        <button
          aria-current={tab === "insights" ? "page" : undefined}
          onClick={() => setTab("insights")}
        >
          <ChartIcon />
          {t("Insights")}
        </button>
        <button
          aria-current={tab === "history" ? "page" : undefined}
          onClick={() => setTab("history")}
        >
          <ListIcon />
          {t("History")}
        </button>
        <button
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => setTab("settings")}
        >
          <GearIcon />
          {t("Settings")}
          {snapshot.pendingDays > 0 && <span className="dot" />}
        </button>
      </nav>

      {editing && (
        <EntrySheet
          entry={editing}
          projects={snapshot.projects}
          entries={snapshot.entries}
          onSave={async (entry) => {
            if (await run(() => api.saveEntry(entry), "Saved")) setEditing(null);
          }}
          onDelete={async (id) => {
            const removed = editing;
            if (await run(() => api.deleteEntry(id))) {
              setEditing(null);
              showToast("Entry deleted", "info", {
                label: "Undo",
                run: () => run(() => api.saveEntry(removed), "Entry restored"),
              });
            }
          }}
          onSplit={async (id, at) => {
            if (await run(() => api.splitEntry(id, at), "Split in two")) setEditing(null);
          }}
          onMerge={async (id) => {
            if (await run(() => api.mergeWithNext(id), "Merged")) setEditing(null);
          }}
          onResume={async (project) => {
            if (await run(() => api.start(project), `Tracking ${project}`)) {
              setEditing(null);
              setTab("track");
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {project && (
        <ProjectSheet
          name={project}
          rate={snapshot.projectRates[project] ?? 0}
          currency={snapshot.settings.currency}
          pinned={snapshot.pinned.some((name) => name.toLowerCase() === project.toLowerCase())}
          autoTags={
            Object.entries(snapshot.autoTags).find(
              ([name]) => name.toLowerCase() === project.toLowerCase(),
            )?.[1] ?? []
          }
          target={
            Object.entries(snapshot.projectTargets).find(
              ([name]) => name.toLowerCase() === project.toLowerCase(),
            )?.[1] ?? 0
          }
          onTogglePin={async () => {
            if (await run(() => api.togglePin(project))) setProject(null);
          }}
          onSave={async ({ name, rate, autoTags, target }) => {
            // Rate and tags first, then the rename: a rename carries them along.
            if (rate !== (snapshot.projectRates[project] ?? 0)) {
              if (!(await run(() => api.setRate(project, rate)))) return;
            }
            const currentTags =
              Object.entries(snapshot.autoTags).find(
                ([existing]) => existing.toLowerCase() === project.toLowerCase(),
              )?.[1] ?? [];
            if (autoTags.join(",") !== currentTags.join(",")) {
              if (!(await run(() => api.setAutoTags(project, autoTags)))) return;
            }
            const currentTarget =
              Object.entries(snapshot.projectTargets).find(
                ([existing]) => existing.toLowerCase() === project.toLowerCase(),
              )?.[1] ?? 0;
            if (target !== currentTarget) {
              if (!(await run(() => api.setTarget(project, target)))) return;
            }
            if (name !== project && !(await run(() => api.renameProject(project, name)))) {
              return;
            }
            showToast("Project saved", "ok");
            setProject(null);
          }}
          onForget={async () => {
            if (await run(() => api.deleteProject(project), "Removed from the list")) {
              setProject(null);
            }
          }}
          onClose={() => setProject(null)}
        />
      )}

      {bulk && (
        <BulkSheet
          entries={bulk}
          projects={snapshot.projects}
          onApply={async (target, addTags) => {
            const ids = bulk.map((entry) => entry.id);
            if (await run(() => api.bulkEdit(ids, target, addTags), `Updated ${ids.length}`)) {
              setBulk(null);
            }
          }}
          onClose={() => setBulk(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
    </LangProvider>
  );
}
