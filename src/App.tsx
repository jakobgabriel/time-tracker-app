import { useCallback, useEffect, useMemo, useState } from "react";

import { api, errorMessage } from "./lib/api";
import { dayKey, formatShort, localIso, plusMinutes, totalSeconds } from "./lib/time";
import type { Entry, Settings, Snapshot } from "./lib/types";
import { EntrySheet } from "./components/EntrySheet";
import { ChartIcon, GearIcon, ListIcon, TimerIcon } from "./components/Icons";
import { HistoryScreen } from "./components/HistoryScreen";
import { InsightsScreen } from "./components/InsightsScreen";
import { SettingsScreen } from "./components/SettingsScreen";
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
  const [project, setProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, showToast, dismissToast] = useToast();

  const running = snapshot?.entries.find((entry) => !entry.end);

  /** Wraps a backend call so every failure surfaces as a toast, never a blank screen. */
  const run = useCallback(
    async (action: () => Promise<Snapshot>, success?: string) => {
      try {
        setSnapshot(await action());
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
    async (full: boolean, quiet = false) => {
      setBusy(true);
      try {
        const report = await api.sync(full);
        setSnapshot(await api.snapshot());
        if (!quiet) {
          showToast(
            report.files === 0 ? "Everything is already up to date" : `Synced ${report.files} note(s)`,
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        <span className="today">
          today <b>{formatShort(todayTotal)}</b>
        </span>
      </header>

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

      {tab === "insights" && <InsightsScreen snapshot={snapshot} nowMs={nowMs} />}

      {tab === "history" && (
        <HistoryScreen
          snapshot={snapshot}
          nowMs={nowMs}
          onEdit={setEditing}
          onAdd={() => setEditing(blankEntry())}
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
        />
      )}

      <nav className="tabbar">
        <button aria-current={tab === "track" ? "page" : undefined} onClick={() => setTab("track")}>
          <TimerIcon />
          Track
        </button>
        <button
          aria-current={tab === "insights" ? "page" : undefined}
          onClick={() => setTab("insights")}
        >
          <ChartIcon />
          Insights
        </button>
        <button
          aria-current={tab === "history" ? "page" : undefined}
          onClick={() => setTab("history")}
        >
          <ListIcon />
          History
        </button>
        <button
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => setTab("settings")}
        >
          <GearIcon />
          Settings
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
          onSave={async ({ name, rate }) => {
            // Rate first, then the rename: a rename carries the rate with it.
            if (rate !== (snapshot.projectRates[project] ?? 0)) {
              if (!(await run(() => api.setRate(project, rate)))) return;
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

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
