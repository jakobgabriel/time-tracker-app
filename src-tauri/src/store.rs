use std::collections::{BTreeMap, BTreeSet};
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
    /// Hourly rate per project, keyed by the project's stored name.
    pub project_rates: BTreeMap<String, f64>,
    /// Projects kept at the front of the quick list, in the order pinned.
    pub pinned: Vec<String>,
    /// Tags applied automatically when a project's timer starts.
    pub auto_tags: BTreeMap<String, Vec<String>>,
    /// Minutes a project should get each week, for the bars in Insights.
    pub project_targets: BTreeMap<String, u32>,
    pub settings: Settings,
    /// Local days (`YYYY-MM-DD`) whose note is out of date on the server.
    pub dirty_days: BTreeSet<String>,
    /// Ids of entries that were deleted, and when. Without these a restore or
    /// a two-way sync would resurrect everything the other device removed.
    pub deleted: BTreeMap<String, String>,
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
            project_rates: self.project_rates.clone(),
            pinned: self.pinned.clone(),
            auto_tags: self.auto_tags.clone(),
            project_targets: self.project_targets.clone(),
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

    /// The tags a project always carries, plus whatever was passed in.
    fn with_auto_tags(&self, project: &str, mut tags: Vec<String>) -> Vec<String> {
        let rule = self
            .auto_tags
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(project.trim()));
        if let Some((_, automatic)) = rule {
            for tag in automatic {
                if !tags
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(tag))
                {
                    tags.push(tag.clone());
                }
            }
        }
        tags
    }

    /// Sets (or with zero, clears) how many minutes a week a project should get.
    pub fn set_target(&mut self, project: &str, minutes: u32) -> Result<()> {
        let project = project.trim().to_string();
        if project.is_empty() {
            return Err(AppError::Invalid("a target needs a project".into()));
        }
        if minutes == 0 {
            self.project_targets.remove(&project);
        } else {
            self.project_targets.insert(project, minutes);
        }
        self.save()
    }

    /// Applies one change to many entries at once — what a search result is
    /// for once a rename or a forgotten tag has left a mess behind.
    pub fn bulk_edit(
        &mut self,
        ids: &[String],
        project: Option<String>,
        add_tags: Vec<String>,
    ) -> Result<usize> {
        let wanted: std::collections::HashSet<&String> = ids.iter().collect();
        let project = project
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty());
        let add_tags: Vec<String> = add_tags
            .into_iter()
            .map(|tag| tag.trim().trim_start_matches('#').to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        if project.is_none() && add_tags.is_empty() {
            return Err(AppError::Invalid("nothing to change".into()));
        }

        let mut touched = Vec::new();
        for index in 0..self.entries.len() {
            if !wanted.contains(&self.entries[index].id) {
                continue;
            }
            // The day it is leaving needs its note rewritten as much as the
            // day it stays on.
            let before = self.entries[index].clone();
            if let Some(name) = &project {
                self.entries[index].project = name.clone();
            }
            for tag in &add_tags {
                if !self.entries[index]
                    .tags
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case(tag))
                {
                    self.entries[index].tags.push(tag.clone());
                }
            }
            touched.push(before);
        }

        for entry in &touched {
            self.mark_dirty(entry)?;
        }
        if let Some(name) = &project {
            self.touch_project(name);
        }
        self.save()?;
        Ok(touched.len())
    }

    /// Sets (or with an empty list, clears) a project's automatic tags.
    pub fn set_auto_tags(&mut self, project: &str, tags: Vec<String>) -> Result<()> {
        let project = project.trim().to_string();
        if project.is_empty() {
            return Err(AppError::Invalid("a rule needs a project".into()));
        }
        let tags: Vec<String> = tags
            .into_iter()
            .map(|tag| tag.trim().trim_start_matches('#').to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        if tags.is_empty() {
            self.auto_tags.remove(&project);
        } else {
            self.auto_tags.insert(project, tags);
        }
        self.save()
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
        let tags = self.with_auto_tags(project, tags);
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

        if self.settings.split_at_midnight {
            self.cut_at_midnight(index)?;
        }

        let entry = self.entries[index].clone();
        self.save()?;
        Ok(Some(entry))
    }

    /// Cuts an entry that ran past midnight into one piece per day, so a night
    /// shift lands on the days it was actually worked rather than all on the
    /// day it started.
    fn cut_at_midnight(&mut self, index: usize) -> Result<()> {
        let mut current = self.entries[index].clone();
        let mut pieces: Vec<Entry> = Vec::new();

        while let Some(end) = current.end.clone() {
            let start_day = local_day(&current.start)?;
            if start_day == local_day(&end)? {
                break;
            }
            // Midnight in the offset the session started in.
            let midnight = format!(
                "{}T00:00:00{}",
                crate::time::next_day(&start_day)?,
                &current.start[19..]
            );
            if crate::time::duration_seconds(&current.start, &midnight)? <= 0 {
                break; // a nonsensical offset; leave the entry whole
            }

            let mut before = current.clone();
            before.end = Some(midnight.clone());
            pieces.push(before);

            current.id = uuid::Uuid::new_v4().to_string();
            current.start = midnight;
        }

        if pieces.is_empty() {
            return Ok(());
        }

        self.entries[index] = pieces.remove(0);
        for piece in pieces.into_iter().chain(std::iter::once(current)) {
            self.mark_dirty(&piece)?;
            self.entries.push(piece);
        }
        self.sort();
        Ok(())
    }

    pub fn discard_running(&mut self) -> Result<()> {
        let running: Vec<String> = self
            .entries
            .iter()
            .filter(|entry| entry.end.is_none())
            .map(|entry| entry.id.clone())
            .collect();
        self.entries.retain(|e| e.end.is_some());
        for id in running {
            self.bury(&id);
        }
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
            self.bury(&removed.id);
        }
        self.save()
    }

    /// Remembers that an id is gone. A tombstone older than this is dropped:
    /// by then every device has long since seen the deletion.
    fn bury(&mut self, id: &str) {
        self.deleted
            .insert(id.to_string(), chrono::Local::now().to_rfc3339());
        if self.deleted.len() > 32 {
            let cutoff = (chrono::Local::now() - chrono::Duration::days(120)).to_rfc3339();
            self.deleted
                .retain(|_, when| when.as_str() > cutoff.as_str());
        }
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

        // Everything attached to the old name follows it. The target keeps its
        // own rate and tags when it already has them: merging into a priced
        // project must not silently reprice it.
        if let Some(rate) = self.project_rates.remove(from.trim()) {
            self.project_rates.entry(to.clone()).or_insert(rate);
        }
        if let Some(tags) = self.auto_tags.remove(from.trim()) {
            self.auto_tags.entry(to.clone()).or_insert(tags);
        }
        if let Some(target) = self.project_targets.remove(from.trim()) {
            self.project_targets.entry(to.clone()).or_insert(target);
        }
        for pin in self.pinned.iter_mut() {
            if pin.eq_ignore_ascii_case(from.trim()) {
                *pin = to.clone();
            }
        }
        self.pinned.dedup_by(|a, b| a.eq_ignore_ascii_case(b));

        self.projects
            .retain(|p| !p.eq_ignore_ascii_case(from.trim()));
        self.touch_project(&to);
        self.save()?;
        Ok(touched.len())
    }

    /// What makes two entries the same session even when their ids differ —
    /// an imported CSV has no ids of its own.
    fn fingerprint(entry: &Entry) -> (String, String, String) {
        (
            entry.start.clone(),
            entry.end.clone().unwrap_or_default(),
            entry.project.trim().to_lowercase(),
        )
    }

    /// Adds the entries an outside source has and this device does not, keeping
    /// everything already here. Merging is additive on purpose: it repairs a
    /// lost phone or a mistaken delete without overwriting newer work, and
    /// running it twice changes nothing the second time.
    pub fn merge(
        &mut self,
        incoming: Vec<Entry>,
        projects: Vec<String>,
        tombstones: BTreeMap<String, String>,
    ) -> Result<usize> {
        // Deletions travel too: adopt the other side's tombstones first, so an
        // entry it removed does not come back with the next merge.
        for (id, when) in tombstones {
            if let Some(index) = self.entries.iter().position(|entry| entry.id == id) {
                let removed = self.entries.remove(index);
                self.mark_dirty(&removed)?;
            }
            self.deleted.entry(id).or_insert(when);
        }

        let known: std::collections::HashSet<String> =
            self.entries.iter().map(|entry| entry.id.clone()).collect();
        let mut seen: std::collections::HashSet<(String, String, String)> =
            self.entries.iter().map(Self::fingerprint).collect();

        let mut added = 0;
        for entry in incoming {
            if entry.id.is_empty()
                || known.contains(&entry.id)
                || self.deleted.contains_key(&entry.id)
            {
                continue;
            }
            if !seen.insert(Self::fingerprint(&entry)) {
                continue; // same session, different id
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
        self.project_rates.remove(project);
        self.pinned.retain(|p| p != project);
        self.project_targets.remove(project);
        self.auto_tags.remove(project);
        self.save()
    }

    /// Pinning holds a project at the front of the quick list, so the one you
    /// track every morning does not drift down as you use others.
    pub fn toggle_pin(&mut self, project: &str) -> Result<bool> {
        let project = project.trim().to_string();
        if project.is_empty() {
            return Err(AppError::Invalid("a pin needs a project".into()));
        }
        let pinned = match self
            .pinned
            .iter()
            .position(|p| p.eq_ignore_ascii_case(&project))
        {
            Some(index) => {
                self.pinned.remove(index);
                false
            }
            None => {
                self.pinned.push(project);
                true
            }
        };
        self.save()?;
        Ok(pinned)
    }

    /// Cuts one interval in two at `at`, keeping both halves on the same
    /// project — for the block that turned out to be two different things.
    pub fn split(&mut self, id: &str, at: &str) -> Result<()> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| AppError::Invalid("that entry is gone".into()))?;

        let entry = self.entries[index].clone();
        let Some(end) = entry.end.clone() else {
            return Err(AppError::Invalid(
                "stop the timer before splitting it".into(),
            ));
        };
        if crate::time::duration_seconds(&entry.start, at)? <= 0
            || crate::time::duration_seconds(at, &end)? <= 0
        {
            return Err(AppError::Invalid(
                "the split has to fall inside the entry".into(),
            ));
        }

        self.entries[index].end = Some(at.to_string());
        let second = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            start: at.to_string(),
            end: Some(end),
            ..entry
        };
        self.mark_dirty(&second)?;
        self.entries.push(second);
        self.sort();
        self.save()
    }

    /// The next entry on the same project, if one follows this one.
    pub fn next_of_project(&self, id: &str) -> Option<&Entry> {
        let entry = self.entries.iter().find(|entry| entry.id == id)?;
        let end = entry.end.as_deref()?;
        self.entries
            .iter()
            .filter(|other| {
                other.id != entry.id
                    && other.end.is_some()
                    && other.project.eq_ignore_ascii_case(entry.project.trim())
                    && other.start.as_str() >= end
            })
            .min_by(|a, b| a.start.cmp(&b.start))
    }

    /// Absorbs that next entry: one interval from the earlier start to the
    /// later end, with both notes and both sets of tags kept.
    pub fn merge_with_next(&mut self, id: &str) -> Result<()> {
        let next = self
            .next_of_project(id)
            .cloned()
            .ok_or_else(|| AppError::Invalid("there is nothing after this to merge with".into()))?;

        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| AppError::Invalid("that entry is gone".into()))?;

        // Two notes become one, but splitting and merging back must not leave
        // "afternoon · afternoon" behind.
        let mut notes: Vec<String> = Vec::new();
        for note in [self.entries[index].note.clone(), next.note.clone()] {
            let note = note.trim().to_string();
            if !note.is_empty() && !notes.iter().any(|kept| kept.eq_ignore_ascii_case(&note)) {
                notes.push(note);
            }
        }
        self.entries[index].note = notes.join(" · ");

        for tag in next.tags.clone() {
            if !self.entries[index]
                .tags
                .iter()
                .any(|t| t.eq_ignore_ascii_case(&tag))
            {
                self.entries[index].tags.push(tag);
            }
        }
        self.entries[index].end = next.end.clone();

        let merged = self.entries[index].clone();
        self.mark_dirty(&merged)?;
        self.mark_dirty(&next)?;
        self.entries.retain(|entry| entry.id != next.id);
        self.bury(&next.id);
        self.save()
    }

    /// Sets what an hour of a project is worth. Zero clears it, which is how
    /// the app goes back to never mentioning money.
    pub fn set_rate(&mut self, project: &str, rate: f64) -> Result<()> {
        let project = project.trim();
        if project.is_empty() {
            return Err(AppError::Invalid("a rate needs a project".into()));
        }
        if !rate.is_finite() || rate < 0.0 {
            return Err(AppError::Invalid(
                "a rate has to be a positive number".into(),
            ));
        }
        if rate == 0.0 {
            self.project_rates.remove(project);
        } else {
            self.project_rates.insert(project.to_string(), rate);
        }
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
    fn a_rename_takes_the_rate_the_tags_and_the_pin_along() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.set_rate("Acme", 120.0).unwrap();
        store
            .set_auto_tags("Acme", vec!["billable".into()])
            .unwrap();
        store.toggle_pin("Acme").unwrap();

        store.rename_project("Acme", "Acme GmbH").unwrap();

        assert_eq!(store.project_rates.get("Acme GmbH"), Some(&120.0));
        assert_eq!(
            store.auto_tags.get("Acme GmbH"),
            Some(&vec!["billable".to_string()])
        );
        assert_eq!(store.pinned, vec!["Acme GmbH".to_string()]);
        assert!(!store.project_rates.contains_key("Acme"));
    }

    #[test]
    fn merging_into_a_priced_project_keeps_the_target_rate() {
        let (mut store, _dir) = store();
        store.start("Admin", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.start("Amdin", "", vec![], &at(10, 0)).unwrap();
        store.stop(&at(11, 0)).unwrap();
        store.set_rate("Admin", 80.0).unwrap();
        store.set_rate("Amdin", 999.0).unwrap();

        store.rename_project("Amdin", "Admin").unwrap();
        assert_eq!(
            store.project_rates.get("Admin"),
            Some(&80.0),
            "the typo does not reprice"
        );
        assert!(!store.project_rates.contains_key("Amdin"));
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
                BTreeMap::new(),
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
    fn a_deleted_entry_does_not_come_back_from_a_backup() {
        let (mut store, _dir) = store();
        let entry = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        let copy = store.entries[0].clone();

        store.delete(&entry.id).unwrap();
        assert!(store.entries.is_empty());
        assert!(store.deleted.contains_key(&entry.id));

        // The vault still holds a backup written before the deletion.
        let added = store.merge(vec![copy], vec![], BTreeMap::new()).unwrap();
        assert_eq!(added, 0, "a tombstone outranks a stale backup");
        assert!(store.entries.is_empty());
    }

    #[test]
    fn another_devices_deletion_removes_the_entry_here() {
        let (mut store, _dir) = store();
        let entry = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        store.dirty_days.clear();

        let elsewhere = BTreeMap::from([(entry.id.clone(), at(11, 0))]);
        store.merge(vec![], vec![], elsewhere).unwrap();

        assert!(store.entries.is_empty(), "the other device deleted it");
        assert_eq!(store.dirty_days.len(), 1, "its note has to be rewritten");
    }

    #[test]
    fn merging_the_same_session_twice_adds_it_once() {
        let (mut store, _dir) = store();
        let imported = |id: &str| Entry {
            id: id.into(),
            project: "Acme".into(),
            note: String::new(),
            tags: vec![],
            start: at(9, 0),
            end: Some(at(10, 0)),
        };

        assert_eq!(
            store
                .merge(vec![imported("first")], vec![], BTreeMap::new())
                .unwrap(),
            1
        );
        // A second import of the same CSV mints new ids for the same sessions.
        assert_eq!(
            store
                .merge(vec![imported("second")], vec![], BTreeMap::new())
                .unwrap(),
            0
        );
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn a_night_shift_lands_on_both_days() {
        let (mut store, _dir) = store();
        store.settings.split_at_midnight = true;
        store
            .start("Acme", "night", vec![], "2026-09-08T22:00:00+02:00")
            .unwrap();
        store.stop("2026-09-09T01:30:00+02:00").unwrap();

        let mut pieces: Vec<&Entry> = store.entries.iter().collect();
        pieces.sort_by(|a, b| a.start.cmp(&b.start));
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].end.as_deref(), Some("2026-09-09T00:00:00+02:00"));
        assert_eq!(pieces[1].start, "2026-09-09T00:00:00+02:00");
        assert_eq!(pieces[1].end.as_deref(), Some("2026-09-09T01:30:00+02:00"));
        assert_eq!(pieces[1].note, "night", "both halves are the same session");
        assert_eq!(
            store.dirty_days,
            BTreeSet::from(["2026-09-08".to_string(), "2026-09-09".to_string()]),
            "both notes have to be written"
        );
    }

    #[test]
    fn a_session_across_two_midnights_becomes_three_days() {
        let (mut store, _dir) = store();
        store.settings.split_at_midnight = true;
        store
            .start("Acme", "", vec![], "2026-09-08T22:00:00+02:00")
            .unwrap();
        store.stop("2026-09-10T02:00:00+02:00").unwrap();
        assert_eq!(store.entries.len(), 3);
    }

    #[test]
    fn midnight_splitting_can_be_turned_off() {
        let (mut store, _dir) = store();
        store.settings.split_at_midnight = false;
        store
            .start("Acme", "", vec![], "2026-09-08T22:00:00+02:00")
            .unwrap();
        store.stop("2026-09-09T01:30:00+02:00").unwrap();
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn a_days_own_session_is_left_alone() {
        let (mut store, _dir) = store();
        store.settings.split_at_midnight = true;
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(17, 0)).unwrap();
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn a_project_can_carry_its_own_tags() {
        let (mut store, _dir) = store();
        store
            .set_auto_tags("Acme", vec!["#billable".into(), " ".into()])
            .unwrap();

        let entry = store
            .start("acme", "", vec!["meeting".into()], &at(9, 0))
            .unwrap();
        assert_eq!(
            entry.tags,
            vec!["meeting".to_string(), "billable".to_string()]
        );

        // The rule never doubles a tag that is already there.
        let again = store
            .start("Acme", "", vec!["billable".into()], &at(10, 0))
            .unwrap();
        assert_eq!(again.tags, vec!["billable".to_string()]);

        // Another project is unaffected, and clearing the rule stops it.
        let other = store.start("Admin", "", vec![], &at(11, 0)).unwrap();
        assert!(other.tags.is_empty());
        store.set_auto_tags("Acme", vec![]).unwrap();
        assert!(store
            .start("Acme", "", vec![], &at(12, 0))
            .unwrap()
            .tags
            .is_empty());
    }

    #[test]
    fn splitting_leaves_two_touching_halves() {
        let (mut store, _dir) = store();
        let entry = store
            .start("Acme", "morning", vec!["billable".into()], &at(9, 0))
            .unwrap();
        store.stop(&at(12, 0)).unwrap();

        store.split(&entry.id, &at(10, 30)).unwrap();

        let mut halves: Vec<&Entry> = store.entries.iter().collect();
        halves.sort_by(|a, b| a.start.cmp(&b.start));
        assert_eq!(halves.len(), 2);
        assert_eq!(halves[0].end.as_deref(), Some(at(10, 30).as_str()));
        assert_eq!(halves[1].start, at(10, 30));
        assert_eq!(halves[1].end.as_deref(), Some(at(12, 0).as_str()));
        // Both halves are the same work, so both keep its details.
        assert_eq!(halves[1].project, "Acme");
        assert_eq!(halves[1].note, "morning");
        assert_eq!(halves[1].tags, vec!["billable".to_string()]);
        assert_ne!(halves[0].id, halves[1].id);
    }

    #[test]
    fn a_split_outside_the_entry_is_refused() {
        let (mut store, _dir) = store();
        let entry = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();

        for outside in [at(8, 30), at(10, 30), at(9, 0), at(10, 0)] {
            let error = store.split(&entry.id, &outside).unwrap_err();
            assert!(
                error.to_string().contains("inside the entry"),
                "at {outside}"
            );
        }
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn a_running_entry_cannot_be_split() {
        let (mut store, _dir) = store();
        let entry = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        let error = store.split(&entry.id, &at(9, 30)).unwrap_err();
        assert!(error.to_string().contains("stop the timer"));
    }

    #[test]
    fn merging_absorbs_the_next_session_of_the_same_project() {
        let (mut store, _dir) = store();
        let first = store
            .start("Acme", "part one", vec!["billable".into()], &at(9, 0))
            .unwrap();
        store.stop(&at(10, 0)).unwrap();
        store
            .start("Admin", "in between", vec![], &at(10, 0))
            .unwrap();
        store.stop(&at(10, 30)).unwrap();
        store
            .start("Acme", "part two", vec!["meeting".into()], &at(10, 30))
            .unwrap();
        store.stop(&at(11, 30)).unwrap();

        store.merge_with_next(&first.id).unwrap();

        let merged = store
            .entries
            .iter()
            .find(|entry| entry.id == first.id)
            .unwrap();
        assert_eq!(merged.end.as_deref(), Some(at(11, 30).as_str()));
        assert_eq!(merged.note, "part one · part two");
        assert_eq!(
            merged.tags,
            vec!["billable".to_string(), "meeting".to_string()]
        );
        // The Admin entry in between is untouched; only the Acme pair merged.
        assert_eq!(store.entries.len(), 2);
        assert!(store.entries.iter().any(|entry| entry.project == "Admin"));
    }

    #[test]
    fn splitting_and_merging_back_is_a_round_trip() {
        let (mut store, _dir) = store();
        let entry = store
            .start("Acme", "afternoon", vec!["billable".into()], &at(13, 0))
            .unwrap();
        store.stop(&at(14, 0)).unwrap();

        store.split(&entry.id, &at(13, 30)).unwrap();
        store.merge_with_next(&entry.id).unwrap();

        assert_eq!(store.entries.len(), 1);
        let back = &store.entries[0];
        assert_eq!(back.start, at(13, 0));
        assert_eq!(back.end.as_deref(), Some(at(14, 0).as_str()));
        assert_eq!(back.note, "afternoon", "the note is not doubled");
        assert_eq!(back.tags, vec!["billable".to_string()]);
    }

    #[test]
    fn merging_needs_something_to_merge_with() {
        let (mut store, _dir) = store();
        let only = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        assert!(store.next_of_project(&only.id).is_none());
        assert!(store
            .merge_with_next(&only.id)
            .unwrap_err()
            .to_string()
            .contains("nothing after"));
    }

    #[test]
    fn a_bulk_edit_moves_and_tags_only_what_was_asked_for() {
        let (mut store, _dir) = store();
        let a = store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.stop(&at(10, 0)).unwrap();
        let b = store
            .start("Acme", "", vec!["billable".into()], &at(10, 0))
            .unwrap();
        store.stop(&at(11, 0)).unwrap();
        let untouched = store.start("Admin", "", vec![], &at(11, 0)).unwrap();
        store.stop(&at(12, 0)).unwrap();
        store.dirty_days.clear();

        let changed = store
            .bulk_edit(
                &[a.id.clone(), b.id.clone()],
                Some("Acme GmbH".into()),
                vec!["#billable".into()],
            )
            .unwrap();

        assert_eq!(changed, 2);
        for id in [&a.id, &b.id] {
            let entry = store.entries.iter().find(|entry| &entry.id == id).unwrap();
            assert_eq!(entry.project, "Acme GmbH");
            assert_eq!(entry.tags, vec!["billable".to_string()], "no doubled tag");
        }
        let other = store
            .entries
            .iter()
            .find(|entry| entry.id == untouched.id)
            .unwrap();
        assert_eq!(other.project, "Admin");
        assert_eq!(
            store.dirty_days.len(),
            1,
            "the day they were on needs rewriting"
        );
        assert!(store.projects.iter().any(|p| p == "Acme GmbH"));
    }

    #[test]
    fn a_bulk_edit_that_changes_nothing_is_refused() {
        let (mut store, _dir) = store();
        assert!(store.bulk_edit(&["x".into()], None, vec![]).is_err());
        assert!(store
            .bulk_edit(&["x".into()], Some("  ".into()), vec![" ".into()])
            .is_err());
    }

    #[test]
    fn a_weekly_target_follows_a_rename_and_goes_with_a_removal() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        store.set_target("Acme", 600).unwrap();

        store.rename_project("Acme", "Acme GmbH").unwrap();
        assert_eq!(store.project_targets.get("Acme GmbH"), Some(&600));

        store.delete_project("Acme GmbH").unwrap();
        assert!(store.project_targets.is_empty());
    }

    #[test]
    fn pinning_toggles_and_survives_a_delete() {
        let (mut store, _dir) = store();
        store.start("Acme", "", vec![], &at(9, 0)).unwrap();
        assert!(store.toggle_pin("Acme").unwrap());
        assert_eq!(store.pinned, vec!["Acme".to_string()]);
        assert!(
            !store.toggle_pin("acme").unwrap(),
            "case does not create a second pin"
        );
        assert!(store.pinned.is_empty());

        store.toggle_pin("Acme").unwrap();
        store.delete_project("Acme").unwrap();
        assert!(
            store.pinned.is_empty(),
            "a removed project leaves no pin behind"
        );
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
