use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A single tracked interval.
///
/// Timestamps are RFC 3339 strings that carry the *local* UTC offset of the
/// device at the moment they were recorded (e.g. `2026-09-08T09:00:00+02:00`).
/// Keeping the offset means the backend can derive the calendar day a user
/// actually experienced without shipping a timezone database to Android.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub project: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub start: String,
    /// `None` while the entry is still running.
    #[serde(default)]
    pub end: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileLayout {
    /// One note per day: `2026-09-08.md`
    #[default]
    Daily,
    /// One note per month: `2026-09.md`
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// WebDAV root, e.g. `https://cloud.example.com/remote.php/dav/files/jakob/`
    pub webdav_url: String,
    pub username: String,
    pub password: String,
    /// Folder inside the WebDAV root that holds the notes, e.g. `Vault/Time Tracking`.
    pub vault_folder: String,
    pub file_layout: FileLayout,
    /// Push the affected notes automatically whenever a timer is stopped.
    pub auto_sync: bool,
    /// Round reported durations to a multiple of N minutes (0 disables it).
    pub round_minutes: u32,
    /// Written into the note's front matter so Dataview/queries can pick it up.
    pub note_tag: String,
    /// Target for a working day, in minutes (0 turns the goal ring off).
    pub daily_goal_minutes: u32,
    /// A timer running longer than this was probably forgotten (0 = never warn).
    pub max_session_minutes: u32,
    /// Keep a JSON backup next to the notes, refreshed on every sync.
    pub auto_backup: bool,
    /// Also write a per-week roll-up note.
    pub weekly_summary: bool,
    /// Write project names as `[[wikilinks]]` so the vault builds a graph.
    pub link_projects: bool,
    /// Prefixed to every amount. Money is only ever shown once a rate is set.
    pub currency: String,
    pub last_sync: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            webdav_url: String::new(),
            username: String::new(),
            password: String::new(),
            vault_folder: "Time Tracking".to_string(),
            file_layout: FileLayout::Daily,
            auto_sync: true,
            round_minutes: 0,
            note_tag: "time-tracking".to_string(),
            daily_goal_minutes: 0,
            max_session_minutes: 480,
            auto_backup: true,
            weekly_summary: false,
            link_projects: false,
            currency: "€".to_string(),
            last_sync: None,
        }
    }
}

/// Everything the UI needs in one round trip. The dataset is small (one JSON
/// document of intervals), so a single snapshot beats a chatty API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub entries: Vec<Entry>,
    pub projects: Vec<String>,
    /// Hourly rate per project. Absent or zero means "do not talk about money".
    pub project_rates: BTreeMap<String, f64>,
    /// Projects held at the front of the quick list.
    pub pinned: Vec<String>,
    pub settings: Settings,
    pub pending_days: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub files: usize,
    pub days: usize,
    pub at: String,
}
