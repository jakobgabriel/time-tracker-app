use std::collections::{BTreeMap, BTreeSet};

use chrono::Local;

use crate::error::Result;
use crate::markdown;
use crate::models::{Entry, FileLayout, Settings, SyncReport};
use crate::time::{iso_week, local_day, local_month};
use crate::webdav::Dav;

/// Which local days end up in which note, together with the entries to write.
type Plan = BTreeMap<String, Vec<(String, Vec<Entry>)>>;

fn note_name(day: &str, layout: &FileLayout) -> String {
    match layout {
        FileLayout::Daily => format!("{day}.md"),
        FileLayout::Monthly => format!("{}.md", local_month(day)),
    }
}

/// Groups the entries that belong in each note.
///
/// A monthly note is rewritten in full whenever any of its days changed —
/// otherwise the month's table would drift out of sync with reality.
pub fn plan(entries: &[Entry], days: &BTreeSet<String>, layout: &FileLayout) -> Result<Plan> {
    let mut by_day: BTreeMap<String, Vec<Entry>> = BTreeMap::new();
    for entry in entries {
        if entry.end.is_none() {
            continue; // a running timer is not a fact yet
        }
        by_day
            .entry(local_day(&entry.start)?)
            .or_default()
            .push(entry.clone());
    }

    let wanted: BTreeSet<String> = match layout {
        FileLayout::Daily => days.clone(),
        FileLayout::Monthly => {
            let months: BTreeSet<String> = days.iter().map(|d| local_month(d)).collect();
            by_day
                .keys()
                .filter(|day| months.contains(&local_month(day)))
                .cloned()
                .chain(days.iter().cloned())
                .collect()
        }
    };

    let mut plan: Plan = BTreeMap::new();
    for day in wanted {
        let entries = by_day.remove(&day).unwrap_or_default();
        plan.entry(note_name(&day, layout))
            .or_default()
            .push((day, entries));
    }
    Ok(plan)
}

/// Roll-up notes for every week a changed day belongs to.
///
/// A week is rewritten whole: a single edited day would otherwise leave the
/// rest of the week's table stale.
pub fn weekly_plan(entries: &[Entry], days: &BTreeSet<String>) -> Result<Plan> {
    let mut by_day: BTreeMap<String, Vec<Entry>> = BTreeMap::new();
    for entry in entries {
        if entry.end.is_none() {
            continue;
        }
        by_day
            .entry(local_day(&entry.start)?)
            .or_default()
            .push(entry.clone());
    }

    let mut weeks: BTreeSet<String> = BTreeSet::new();
    for day in days {
        weeks.insert(iso_week(day)?);
    }

    let mut plan: Plan = BTreeMap::new();
    for (day, entries) in by_day {
        let week = iso_week(&day)?;
        if weeks.contains(&week) {
            plan.entry(format!("{week}.md"))
                .or_default()
                .push((day, entries));
        }
    }
    // A week whose every entry was deleted still needs its note emptied.
    for week in weeks {
        plan.entry(format!("{week}.md")).or_default();
    }
    Ok(plan)
}

fn note_title(file: &str) -> &str {
    file.strip_suffix(".md").unwrap_or(file)
}

/// Pushes every planned note to the WebDAV share.
///
/// `subfolder` keeps the weekly roll-ups out of the daily notes' way.
pub async fn push_into(settings: &Settings, plan: Plan, subfolder: &str) -> Result<SyncReport> {
    let dav = Dav::from_settings(settings)?;
    let mut folder = settings.vault_folder.trim().trim_matches('/').to_string();
    if !subfolder.is_empty() {
        folder = if folder.is_empty() {
            subfolder.to_string()
        } else {
            format!("{folder}/{subfolder}")
        };
    }
    if !folder.is_empty() {
        dav.ensure_folder(&folder).await?;
    }

    let days = plan.values().map(|days| days.len()).sum();
    let files = plan.len();

    for (file, mut day_groups) in plan {
        day_groups.sort_by(|a, b| a.0.cmp(&b.0));
        let block = markdown::render_block(&day_groups, settings.round_minutes)?;
        let path = if folder.is_empty() {
            file.clone()
        } else {
            format!("{folder}/{file}")
        };

        let existing = dav.get(&path).await?;
        // Nothing to add and nothing to clean up: leave the note alone rather
        // than creating an empty one.
        if existing.is_none() && day_groups.iter().all(|(_, e)| e.is_empty()) {
            continue;
        }
        let merged = markdown::merge(
            existing.as_deref(),
            &block,
            note_title(&file),
            &settings.note_tag,
        );
        dav.put(&path, merged).await?;
    }

    Ok(SyncReport {
        files,
        days,
        at: Local::now().to_rfc3339(),
    })
}

pub async fn push(settings: &Settings, plan: Plan) -> Result<SyncReport> {
    push_into(settings, plan, "").await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(day: &str, hour: u32) -> Entry {
        Entry {
            id: format!("{day}-{hour}"),
            project: "Acme".into(),
            note: String::new(),
            tags: vec![],
            start: format!("{day}T{hour:02}:00:00+02:00"),
            end: Some(format!("{day}T{:02}:00:00+02:00", hour + 1)),
        }
    }

    #[test]
    fn daily_layout_touches_only_changed_days() {
        let entries = vec![entry("2026-09-07", 9), entry("2026-09-08", 9)];
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = plan(&entries, &days, &FileLayout::Daily).unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(plan["2026-09-08.md"][0].1.len(), 1);
    }

    #[test]
    fn monthly_layout_rewrites_the_whole_month() {
        let entries = vec![
            entry("2026-09-07", 9),
            entry("2026-09-08", 9),
            entry("2026-08-31", 9),
        ];
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = plan(&entries, &days, &FileLayout::Monthly).unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(
            plan["2026-09.md"].len(),
            2,
            "both September days are rewritten"
        );
    }

    #[test]
    fn a_day_emptied_by_deletion_still_gets_planned() {
        // The note has to be rewritten so the deleted rows disappear from it.
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = plan(&[], &days, &FileLayout::Daily).unwrap();
        assert_eq!(plan["2026-09-08.md"][0].1.len(), 0);
    }

    #[test]
    fn a_weekly_note_covers_the_whole_week() {
        let entries = vec![
            entry("2026-09-07", 9), // Monday
            entry("2026-09-08", 9), // Tuesday, the day that changed
            entry("2026-09-13", 9), // Sunday, same ISO week
            entry("2026-09-14", 9), // Monday, the next week
        ];
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = weekly_plan(&entries, &days).unwrap();
        assert_eq!(plan.keys().collect::<Vec<_>>(), vec!["2026-W37.md"]);
        assert_eq!(
            plan["2026-W37.md"].len(),
            3,
            "Monday through Sunday, not just Tuesday"
        );
    }

    #[test]
    fn a_week_emptied_by_deletion_is_still_rewritten() {
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = weekly_plan(&[], &days).unwrap();
        assert!(plan["2026-W37.md"].is_empty());
    }

    #[test]
    fn running_timers_are_never_written() {
        let mut running = entry("2026-09-08", 9);
        running.end = None;
        let days = BTreeSet::from(["2026-09-08".to_string()]);
        let plan = plan(&[running], &days, &FileLayout::Daily).unwrap();
        assert!(plan["2026-09-08.md"][0].1.is_empty());
    }
}
