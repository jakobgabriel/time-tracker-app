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

export type SyncReport = {
  files: number;
  days: number;
  conflicts: string[];
  at: string;
};
