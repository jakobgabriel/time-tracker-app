import { invoke } from "@tauri-apps/api/core";

import { localIso } from "./time";
import type { Entry, Settings, Snapshot, SyncReport } from "./types";

/// Every mutation returns the full snapshot, so the UI never has to guess what
/// the backend now believes.
export const api = {
  snapshot: () => invoke<Snapshot>("snapshot"),

  start: (project: string, note = "", tags: string[] = []) =>
    invoke<Snapshot>("start_timer", { project, note, tags, now: localIso() }),

  stop: () => invoke<Snapshot>("stop_timer", { now: localIso() }),

  discard: () => invoke<Snapshot>("discard_timer"),

  saveEntry: (entry: Entry) => invoke<Snapshot>("save_entry", { entry }),

  deleteEntry: (id: string) => invoke<Snapshot>("delete_entry", { id }),

  renameProject: (from: string, to: string) =>
    invoke<Snapshot>("rename_project", { from, to }),

  setRate: (project: string, rate: number) => invoke<Snapshot>("set_rate", { project, rate }),

  addProject: (name: string) => invoke<Snapshot>("add_project", { name }),

  setAutoTags: (project: string, tags: string[]) =>
    invoke<Snapshot>("set_auto_tags", { project, tags }),

  setTarget: (project: string, minutes: number) =>
    invoke<Snapshot>("set_target", { project, minutes }),

  bulkEdit: (ids: string[], project: string | null, addTags: string[]) =>
    invoke<Snapshot>("bulk_edit", { ids, project, addTags }),

  writeInvoice: (month: string) => invoke<string>("write_invoice", { month }),

  togglePin: (project: string) => invoke<Snapshot>("toggle_pin", { project }),

  splitEntry: (id: string, at: string) => invoke<Snapshot>("split_entry", { id, at }),

  mergeWithNext: (id: string) => invoke<Snapshot>("merge_with_next", { id }),

  deleteProject: (name: string) => invoke<Snapshot>("delete_project", { name }),

  saveSettings: (settings: Settings) => invoke<Snapshot>("save_settings", { settings }),

  testConnection: (settings: Settings) => invoke<string>("test_connection", { settings }),

  sync: (full = false) => invoke<SyncReport>("sync_now", { full }),

  /** Brings the Android notification in line with the timer; no-op elsewhere. */
  refreshNotification: () => invoke<void>("refresh_notification").catch(() => {}),

  exportCsv: () => invoke<string>("export_csv"),

  importCsv: () => invoke<string>("import_csv"),

  backup: () => invoke<string>("backup_now"),

  restore: () => invoke<string>("restore_backup"),
};

/** Tauri rejects with a plain string; anything else is a genuine surprise. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
