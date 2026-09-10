export type Entry = {
  id: string;
  project: string;
  note: string;
  tags: string[];
  start: string;
  end: string | null;
};

export type FileLayout = "daily" | "monthly";

export type Settings = {
  webdavUrl: string;
  username: string;
  password: string;
  vaultFolder: string;
  fileLayout: FileLayout;
  autoSync: boolean;
  roundMinutes: number;
  noteTag: string;
  dailyGoalMinutes: number;
  maxSessionMinutes: number;
  /** Minutes unseen before a still-running timer is queried. 0 turns it off. */
  idleMinutes: number;
  autoBackup: boolean;
  weeklySummary: boolean;
  linkProjects: boolean;
  notePattern: string;
  weeklyPattern: string;
  vaultName: string;
  language: string;
  onboarded: boolean;
  splitAtMidnight: boolean;
  projectNotes: boolean;
  projectPattern: string;
  twoWaySync: boolean;
  currency: string;
  lastSync: string | null;
};

export type Snapshot = {
  entries: Entry[];
  projects: string[];
  projectRates: Record<string, number>;
  pinned: string[];
  autoTags: Record<string, string[]>;
  projectTargets: Record<string, number>;
  settings: Settings;
  pendingDays: number;
  /** Notes whose block was edited in the vault; sync left them alone. */
  conflicts: string[];
};

/** A stretch during which a timer ran but the app was never looked at. */
export type IdleGap = {
  /** When the app was last seen — the honest end for the running entry. */
  since: string;
  seconds: number;
};

/** A Markdown checkbox found in today's vault note. */
export type VaultTask = {
  text: string;
  /** The [[wikilink]] in the task, if it had one. */
  project: string | null;
  done: boolean;
};

export type NotePreview = {
  /** Vault-relative path the note would land at. */
  path: string;
  /** The whole note, front matter and all. */
  note: string;
  entries: number;
};

export type SyncReport = {
  files: number;
  days: number;
  conflicts: string[];
  at: string;
};
