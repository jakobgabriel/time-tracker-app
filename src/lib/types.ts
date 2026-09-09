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
  currency: string;
  lastSync: string | null;
};

export type Snapshot = {
  entries: Entry[];
  projects: string[];
  projectRates: Record<string, number>;
  pinned: string[];
  settings: Settings;
  pendingDays: number;
};

export type SyncReport = {
  files: number;
  days: number;
  at: string;
};
