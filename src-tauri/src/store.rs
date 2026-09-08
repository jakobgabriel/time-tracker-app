use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::models::{Entry, Settings, Snapshot};
use crate::time::local_day;

/// The on-disk document. It lives in the app's private data directory, which
/// on Android is inside the app sandbox.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Store {
    pub entries: Vec<Entry>,
    pub projects: Vec<String>,
    pub settings: Settings,
    /// Local days (`YYYY-MM-DD`) whose note is out of date on the server.
    pub dirty_days: BTreeSet<String>,
    #[serde(skip)]
    path: PathBuf,
}

impl Store {
    pub fn load(path: &Path) -> Result<Self> {
        let mut store = match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice::<Store>(&bytes).unwrap_or_else(|err| {
                // A corrupt document must never brick the app: keep the broken
                // file around for forensics and start over.
                let _ = std::fs::rename(path, path.with_extension("json.corrupt"));
                eprintln!("tempo: could not read store ({err}), starting fresh");
                Store::default()
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Store::default(),
            Err(err) => return Err(AppError::Io(err)),
        };
        store.path = path.to_path_buf();
        store.sort();
        Ok(store)
    }

    fn sort(&mut self) {
        // Newest first — every view in the UI wants that order.
        self.entries.sort_by(|a, b| b.start.cmp(&a.start));
    }

    pub fn save(&self) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write-then-rename so a crash mid-write cannot truncate the history.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut settings = self.settings.clone();
        // The password never leaves the backend; the UI only needs to know
        // whether one is set.
        settings.password = if settings.password.is_empty() {
            String::new()
        } else {
            crate::PASSWORD_PLACEHOLDER.to_string()
        };
        Snapshot {
            entries: self.entries.clone(),
            projects: self.projects.clone(),
            settings,
            pending_days: self.dirty_days.len(),
        }
    }

    pub fn mark_dirty(&mut self, entry: &Entry) -> Result<()> {
        self.dirty_days.insert(local_day(&entry.start)?);
        Ok(())
    }

    pub fn touch_project(&mut self, project: &str) {
        let project = project.trim();
        if project.is_empty() {
            return;
        }
        self.projects.retain(|p| !p.eq_ignore_ascii_case(project));
        self.projects.insert(0, project.to_string());
        self.projects.truncate(24);
    }

    /// Stops whatever is running and starts a new interval. Returns the new entry.
    pub fn start(
        &mut self,
        project: &str,
        note: &str,
        tags: Vec<String>,
        now: &str,
    ) -> Result<Entry> {
        self.stop(now)?;
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            project: project.trim().to_string(),
            note: note.trim().to_string(),
            tags,
            start: now.to_string(),
            end: None,
        };
        self.touch_project(&entry.project);
        self.entries.insert(0, entry.clone());
        self.sort();
        self.save()?;
        Ok(entry)
    }

    /// Closes the running interval, if any. Intervals shorter than a second are
    /// dropped — those are mis-taps, not work.
    pub fn stop(&mut self, now: &str) -> Result<Option<Entry>> {
        let Some(index) = self.entries.iter().position(|e| e.end.is_none()) else {
            return Ok(None);
        };
        let start = self.entries[index].start.clone();
        if crate::time::duration_seconds(&start, now)? < 1 {
            let dropped = self.entries.remove(index);
            self.save()?;
            return Ok(Some(dropped));
        }
        self.entries[index].end = Some(now.to_string());
        let entry = self.entries[index].clone();
        self.mark_dirty(&entry)?;
        self.save()?;
        Ok(Some(entry))
    }

    pub fn discard_running(&mut self) -> Result<()> {
        self.entries.retain(|e| e.end.is_some());
        self.save()
    }

    pub fn upsert(&mut self, entry: Entry) -> Result<Entry> {
        let mut entry = entry;
        if entry.id.is_empty() {
            entry.id = uuid::Uuid::new_v4().to_string();
        }
        if let Some(end) = entry.end.as_deref() {
            if crate::time::duration_seconds(&entry.start, end)? < 0 {
                return Err(AppError::Invalid(
                    "the end time is before the start time".into(),
                ));
            }
        }
        self.touch_project(&entry.project);
        match self.entries.iter().position(|e| e.id == entry.id) {
            Some(index) => {
                // The old day loses time, the new one gains it: both notes change.
                let previous = self.entries[index].clone();
                self.mark_dirty(&previous)?;
                self.entries[index] = entry.clone();
            }
            None => self.entries.push(entry.clone()),
        }
        self.mark_dirty(&entry)?;
        self.sort();
        self.save()?;
        Ok(entry)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        if let Some(index) = self.entries.iter().position(|e| e.id == id) {
            let removed = self.entries.remove(index);
            self.mark_dirty(&removed)?;
        }
        self.save()
    }

    /// Renames a project across every entry. Renaming onto an existing name
    /// merges the two, which is the only sane reading of the request.
    pub fn rename_project(&mut self, from: &str, to: &str) -> Result<usize> {
        let to = to.trim().to_string();
        if to.is_empty() {
            return Err(AppError::Invalid("a project needs a name".into()));
        }

        let mut touched = Vec::new();
        for index in 0..self.entries.len() {
            if self.entries[index]
                .project
                .eq_ignore_ascii_case(from.trim())
            {
                self.entries[index].project = to.clone();
                touched.push(self.entries[index].clone());
            }
        }
        for entry in &touched {
            self.mark_dirty(entry)?;
        }

        self.projects
            .retain(|p| !p.eq_ignore_ascii_case(from.trim()));
        self.touch_project(&to);
        self.save()?;
        Ok(touched.len())
    }

    /// Adds the entries a backup has and this device does not, keeping
    /// everything already here. Restoring is additive on purpose: it repairs a
    /// lost phone or a mistaken delete without overwriting newer work.
    pub fn merge(&mut self, incoming: Vec<Entry>, projects: Vec<String>) -> Result<usize> {
        let known: std::collections::HashSet<String> =
            self.entries.iter().map(|entry| entry.id.clone()).collect();

        let mut added = 0;
        for entry in incoming {
            if entry.id.is_empty() || known.contains(&entry.id) {
                continue;
            }
            self.mark_dirty(&entry)?;
            self.entries.push(entry);
            added += 1;
        }

        for project in projects.into_iter().rev() {
            if !self
                .projects
                .iter()
                .any(|p| p.eq_ignore_ascii_case(&project))
            {
                self.touch_project(&project);
            }
        }

        self.sort();
        self.save()?;
        Ok(added)
    }

    pub fn delete_project(&mut self, project: &str) -> Result<()> {
        self.projects.retain(|p| p != project);
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::load(&dir.path().join("tempo.json")).unwrap();
        (store, dir)
    }

    fn at(hour: u32, minute: u32) -> String {
        format!("2026-09-08T{hour:02}:{minute:02}:00+02:00")
    }

    #[test]
    fn starting_a_second_project_stops_the_first() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.start("Admin", "", vec![], &at(10, 0)).unwrap();

        assert_eq!(store.entries.len(), 2);
        let running: Vec<&Entry> = store.entries.iter().filter(|e| e.end.is_none()).collect();
        assert_eq!(running.len(), 1, "only one timer runs at a time");
        assert_eq!(running[0].project, "Admin");
        let acme = store.entries.iter().find(|e| e.project == "Acme").unwrap();
        assert_eq!(acme.end.as_deref(), Some(at(10, 0).as_str()));
    }

    #[test]
    fn a_mistap_leaves_nothing_behind() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(9, 0)).unwrap();
        assert!(store.entries.is_empty());
        assert!(store.dirty_days.is_empty(), "nothing to sync either");
    }

    #[test]
    fn stopping_queues_the_day_for_sync() {
        let (mut store, _dir) = store();
        store
            .start("Acme", "standup", vec!["billable".into()], &at(9, 0))
            .unwrap();
        store.stop(&at(9, 30)).unwrap();
        assert_eq!(store.dirty_days, BTreeSet::from(["2026-09-08".to_string()]));
    }

    #[test]
    fn moving_an_entry_queues_both_days() {
        let (mut store, _dir) = store();
        let entry = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(9, 30)).unwrap();
        store.dirty_days.clear();

        let moved = Entry {
            start: "2026-09-05T09:00:00+02:00".into(),
            end: Some("2026-09-05T09:30:00+02:00".into()),
            ..entry
        };
        store.upsert(moved).unwrap();
        assert_eq!(
            store.dirty_days,
            BTreeSet::from(["2026-09-05".to_string(), "2026-09-08".to_string()]),
            "the note it left and the note it joined both have to be rewritten"
        );
    }

    #[test]
    fn a_new_entry_gets_an_id_from_the_backend() {
        let (mut store, _dir) = store();
        let saved = store
            .upsert(Entry {
                id: String::new(),
                project: "Acme".into(),
                note: String::new(),
                tags: vec![],
                start: at(9, 0),
                end: Some(at(10, 0)),
            })
            .unwrap();
        assert!(!saved.id.is_empty());
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn an_end_before_the_start_is_rejected() {
        let (mut store, _dir) = store();
        let error = store
            .upsert(Entry {
                id: "x".into(),
                project: "Acme".into(),
                note: String::new(),
                tags: vec![],
                start: at(10, 0),
                end: Some(at(9, 0)),
            })
            .unwrap_err();
        assert!(error.to_string().contains("before the start"));
    }

    #[test]
    fn renaming_moves_every_entry_and_queues_the_days() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.start("Other", "", vec![], &at(10, 0)).unwrap();
        store.stop(&at(11, 0)).unwrap();
        store.dirty_days.clear();

        assert_eq!(store.rename_project("acme", "Acme GmbH").unwrap(), 1);
        assert!(store.entries.iter().any(|e| e.project == "Acme GmbH"));
        assert!(!store.projects.iter().any(|p| p == "Acme"));
        assert!(store.projects.iter().any(|p| p == "Acme GmbH"));
        assert_eq!(store.dirty_days.len(), 1, "the day has to be rewritten");
    }

    #[test]
    fn renaming_onto_an_existing_name_merges_them() {
        let (mut store, _dir) = store();
        store.start("Admin", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.start("Amdin", "", vec![], &at(10, 0)).unwrap();
        store.stop(&at(11, 0)).unwrap();

        store.rename_project("Amdin", "Admin").unwrap();
        assert_eq!(store.projects.iter().filter(|p| *p == "Admin").count(), 1);
        assert_eq!(
            store
                .entries
                .iter()
                .filter(|e| e.project == "Admin")
                .count(),
            2
        );
    }

    #[test]
    fn a_project_needs_a_name() {
        let (mut store, _dir) = store();
        assert!(store.rename_project("Acme", "  ").is_err());
    }

    #[test]
    fn merging_a_backup_adds_what_is_missing_and_keeps_what_is_here() {
        let (mut store, _dir) = store();
        let mine = store.start("Acme", "mine", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.dirty_days.clear();

        let from_backup = Entry {
            id: "restored".into(),
            project: "Reading".into(),
            note: String::new(),
            tags: vec![],
            start: at(12, 0),
            end: Some(at(13, 0)),
        };
        // The backup also carries a stale copy of an entry we already have.
        let stale = Entry {
            note: "stale".into(),
            ..mine.clone()
        };

        let added = store
            .merge(
                vec![from_backup, stale],
                vec!["Reading".into(), "Acme".into()],
            )
            .unwrap();

        assert_eq!(added, 1, "only the unknown entry is taken");
        assert_eq!(store.entries.len(), 2);
        let kept = store.entries.iter().find(|e| e.id == mine.id).unwrap();
        assert_eq!(kept.note, "mine", "local wins over the backup");
        assert!(store.projects.iter().any(|p| p == "Reading"));
        assert_eq!(store.dirty_days.len(), 1, "the restored day needs a note");
    }

    #[test]
    fn survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tempo.json");
        {
            let mut store = Store::load(&path).unwrap();
            store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        }
        let reopened = Store::load(&path).unwrap();
        assert_eq!(
            reopened.entries.len(),
            1,
            "the running timer is still running"
        );
        assert_eq!(reopened.projects, vec!["Acme".to_string()]);
    }

    #[test]
    fn a_corrupt_file_is_set_aside_rather_than_losing_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tempo.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let store = Store::load(&path).unwrap();
        assert!(store.entries.is_empty());
        assert!(path.with_extension("json.corrupt").exists());
    }
}
