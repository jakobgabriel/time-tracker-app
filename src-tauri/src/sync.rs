use std::collections::{BTreeMap, BTreeSet};

use chrono::Local;

use crate::error::Result;
use crate::markdown;
use crate::models::{Entry, FileLayout, Settings, SyncReport};
use crate::time::{iso_week, local_day, local_month};
use crate::webdav::Dav;

/// Which local days end up in which note, together with the entries to write.
type Plan = BTreeMap<String, Vec<(String, Vec<Entry>)>>;

/// What Tempo last wrote into each note, so a sync can tell its own block from
/// one someone has edited in Obsidian since.
///
/// Everything outside the markers is already safe — `markdown::merge` never
/// touches it. This is about the inside: without it a sync silently discards
/// a correction made in the vault, which for a notes-first app is the worst
/// thing it could do.
#[derive(Debug, Default)]
pub struct Ledger {
    /// Note path -> fingerprint of the block Tempo left there.
    pub known: BTreeMap<String, String>,
    /// Write over an edited block instead of leaving it alone.
    pub force: bool,
    /// Notes skipped this sync because their block had been edited.
    pub conflicts: Vec<String>,
}

impl Ledger {
    pub fn new(known: BTreeMap<String, String>, force: bool) -> Self {
        Self {
            known,
            force,
            conflicts: Vec::new(),
        }
    }

    /// Whether this note may be written, recording a conflict when it may not.
    fn may_write(&mut self, path: &str, existing: Option<&str>) -> bool {
        if self.force {
            return true;
        }
        let Some(block) = existing.and_then(markdown::extract) else {
            return true; // no block of ours to overwrite
        };
        let Some(known) = self.known.get(path) else {
            // Nothing recorded for this note: it predates the check, or another
            // device wrote it. Adopt it rather than crying wolf.
            return true;
        };
        if markdown::fingerprint(block) == *known {
            return true;
        }
        self.conflicts.push(path.to_string());
        false
    }

    fn wrote(&mut self, path: &str, note: &str) {
        if let Some(block) = markdown::extract(note) {
            self.known
                .insert(path.to_string(), markdown::fingerprint(block));
        }
    }
}

fn note_name(day: &str, layout: &FileLayout) -> String {
    match layout {
        FileLayout::Daily => format!("{day}.md"),
        FileLayout::Monthly => format!("{}.md", local_month(day)),
    }
}

/// Where a note actually lands: the vault's own pattern when one is set,
/// otherwise Tempo's folder.
fn resolve(settings: &Settings, pattern: &str, file: &str, subfolder: &str) -> Result<String> {
    if !pattern.trim().is_empty() {
        // The day the file is named after is enough to expand the pattern.
        let day = match file.strip_suffix(".md").unwrap_or(file) {
            stem if stem.len() == 7 => format!("{stem}-01"), // a month note
            stem if stem.contains("-W") => week_start(stem)?,
            stem => stem.to_string(),
        };
        return crate::paths::expand(pattern, &day);
    }

    let mut folder = settings.vault_folder.trim().trim_matches('/').to_string();
    if !subfolder.is_empty() {
        folder = if folder.is_empty() {
            subfolder.to_string()
        } else {
            format!("{folder}/{subfolder}")
        };
    }
    Ok(if folder.is_empty() {
        file.to_string()
    } else {
        format!("{folder}/{file}")
    })
}

/// Where a daily or monthly note lands, for showing someone before a sync puts
/// it there.
pub fn note_path(settings: &Settings, file: &str) -> Result<String> {
    resolve(settings, &settings.note_pattern, file, "")
}

/// The Monday of an ISO week key, so a weekly pattern can use date placeholders.
fn week_start(week: &str) -> Result<String> {
    let (year, number) = week
        .split_once("-W")
        .ok_or_else(|| crate::error::AppError::Invalid(format!("not a week: {week}")))?;
    let (year, number): (i32, u32) = (year.parse().unwrap_or(1970), number.parse().unwrap_or(1));
    let monday = chrono::NaiveDate::from_isoywd_opt(year, number, chrono::Weekday::Mon)
        .ok_or_else(|| crate::error::AppError::Invalid(format!("not a week: {week}")))?;
    Ok(monday.format("%Y-%m-%d").to_string())
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

/// A project's whole history, grouped by day.
pub type ProjectPlan = BTreeMap<String, Vec<(String, Vec<Entry>)>>;

/// Which projects need their own note rewritten: those with time on a day
/// that changed, together with every entry they have ever had.
pub fn project_plan(entries: &[Entry], days: &BTreeSet<String>) -> Result<ProjectPlan> {
    let mut touched: BTreeSet<String> = BTreeSet::new();
    for entry in entries {
        if entry.end.is_some() && days.contains(&local_day(&entry.start)?) {
            touched.insert(entry.project.trim().to_string());
        }
    }

    let mut plan: ProjectPlan = BTreeMap::new();
    for project in touched {
        let mut by_day: BTreeMap<String, Vec<Entry>> = BTreeMap::new();
        for entry in entries {
            if entry.end.is_some() && entry.project.trim() == project {
                by_day
                    .entry(local_day(&entry.start)?)
                    .or_default()
                    .push(entry.clone());
            }
        }
        plan.insert(project, by_day.into_iter().collect());
    }
    Ok(plan)
}

/// Writes one note per project. Returns how many files were written.
pub async fn push_projects(
    settings: &Settings,
    plan: ProjectPlan,
    rates: &BTreeMap<String, f64>,
    ledger: &mut Ledger,
) -> Result<usize> {
    if plan.is_empty() {
        return Ok(0);
    }
    let dav = Dav::from_settings(settings)?;
    let mut written = 0;

    for (project, days) in plan {
        let stem = crate::paths::file_stem(&project);
        let path = if settings.project_pattern.trim().is_empty() {
            let folder = settings.vault_folder.trim().trim_matches('/');
            if folder.is_empty() {
                format!("Projects/{stem}.md")
            } else {
                format!("{folder}/Projects/{stem}.md")
            }
        } else {
            // The pattern's date placeholders are meaningless here; {project}
            // is the one that matters.
            crate::paths::expand(
                &settings.project_pattern.replace("{project}", &stem),
                "1970-01-01",
            )?
        };

        if let Some(folder) = crate::paths::parent(&path) {
            dav.ensure_folder(&folder).await?;
        }

        let block = markdown::render_project_block(
            &days,
            settings.round_minutes,
            rates.get(&project).copied().unwrap_or(0.0),
            &settings.currency,
        )?;
        let existing = dav.get(&path).await?;
        if !ledger.may_write(&path, existing.as_deref()) {
            continue;
        }
        let merged = markdown::merge(existing.as_deref(), &block, &project, &settings.note_tag);
        dav.put(&path, merged.clone()).await?;
        ledger.wrote(&path, &merged);
        written += 1;
    }

    Ok(written)
}

fn note_title(file: &str) -> &str {
    file.strip_suffix(".md").unwrap_or(file)
}

/// Pushes every planned note to the WebDAV share.
///
/// `subfolder` keeps the weekly roll-ups out of the daily notes' way.
pub async fn push_into(
    settings: &Settings,
    plan: Plan,
    rates: &BTreeMap<String, f64>,
    subfolder: &str,
    ledger: &mut Ledger,
) -> Result<SyncReport> {
    let dav = Dav::from_settings(settings)?;
    let pattern = if subfolder.is_empty() {
        settings.note_pattern.clone()
    } else {
        settings.weekly_pattern.clone()
    };

    let mut days = 0;
    let mut files = 0;

    for (file, mut day_groups) in plan {
        day_groups.sort_by(|a, b| a.0.cmp(&b.0));
        let block = markdown::render_block(
            &day_groups,
            settings.round_minutes,
            rates,
            &settings.currency,
            settings.link_projects,
        )?;
        let path = resolve(settings, &pattern, &file, subfolder)?;
        if let Some(folder) = crate::paths::parent(&path) {
            dav.ensure_folder(&folder).await?;
        }

        let existing = dav.get(&path).await?;
        // Nothing to add and nothing to clean up: leave the note alone rather
        // than creating an empty one.
        if existing.is_none() && day_groups.iter().all(|(_, e)| e.is_empty()) {
            continue;
        }
        if !ledger.may_write(&path, existing.as_deref()) {
            continue;
        }
        let merged = markdown::merge(
            existing.as_deref(),
            &block,
            note_title(&file),
            &settings.note_tag,
        );
        dav.put(&path, merged.clone()).await?;
        ledger.wrote(&path, &merged);
        files += 1;
        days += day_groups.len();
    }

    Ok(SyncReport {
        files,
        days,
        conflicts: ledger.conflicts.clone(),
        at: Local::now().to_rfc3339(),
    })
}

pub async fn push(
    settings: &Settings,
    plan: Plan,
    rates: &BTreeMap<String, f64>,
    ledger: &mut Ledger,
) -> Result<SyncReport> {
    push_into(settings, plan, rates, "", ledger).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A note as it looks after Tempo has written to it.
    fn note(block_body: &str) -> String {
        format!(
            "# Monday\n\nmy own prose\n\n{} {block_body} {}\n\nmore prose",
            markdown::BEGIN,
            markdown::END
        )
    }

    fn vault(folder: &str, pattern: &str) -> Settings {
        Settings {
            vault_folder: folder.into(),
            note_pattern: pattern.into(),
            ..Settings::default()
        }
    }

    #[test]
    fn a_daily_note_lands_in_the_folder() {
        assert_eq!(
            note_path(&vault("Vault/Time", ""), "2026-09-08.md").unwrap(),
            "Vault/Time/2026-09-08.md",
        );
    }

    #[test]
    fn a_pattern_wins_over_the_folder() {
        assert_eq!(
            note_path(
                &vault("Vault/Time", "Journal/{YYYY}/{YYYY-MM-DD}"),
                "2026-09-08.md"
            )
            .unwrap(),
            "Journal/2026/2026-09-08.md",
        );
    }

    #[test]
    fn a_month_note_expands_from_its_first_day() {
        assert_eq!(
            note_path(&vault("", "Months/{YYYY}/{MMMM}"), "2026-09.md").unwrap(),
            "Months/2026/September.md",
        );
    }

    #[test]
    fn a_note_tempo_has_never_written_is_adopted() {
        let mut ledger = Ledger::default();
        assert!(
            ledger.may_write("Day.md", Some(&note("tracked:: 1h"))),
            "nothing recorded means the note predates the check, not that it was edited",
        );
        assert!(ledger.conflicts.is_empty());
    }

    #[test]
    fn an_untouched_block_is_rewritten() {
        let mut ledger = Ledger::default();
        let existing = note("tracked:: 1h");
        ledger.wrote("Day.md", &existing);
        assert!(ledger.may_write("Day.md", Some(&existing)));
        assert!(ledger.conflicts.is_empty());
    }

    #[test]
    fn an_edited_block_is_left_alone() {
        let mut ledger = Ledger::default();
        ledger.wrote("Day.md", &note("tracked:: 1h"));
        assert!(!ledger.may_write("Day.md", Some(&note("tracked:: 4h"))));
        assert_eq!(ledger.conflicts, vec!["Day.md".to_string()]);
    }

    #[test]
    fn prose_outside_the_block_is_not_a_conflict() {
        let mut ledger = Ledger::default();
        ledger.wrote("Day.md", &note("tracked:: 1h"));
        let rewritten = format!("{}\n\nand a paragraph the user added", note("tracked:: 1h"));
        assert!(
            ledger.may_write("Day.md", Some(&rewritten)),
            "merge never touches what is outside the markers, so it cannot be lost",
        );
    }

    #[test]
    fn force_writes_over_an_edit() {
        let mut ledger = Ledger::new(BTreeMap::new(), true);
        ledger.wrote("Day.md", &note("tracked:: 1h"));
        assert!(ledger.may_write("Day.md", Some(&note("tracked:: 4h"))));
        assert!(ledger.conflicts.is_empty());
    }

    #[test]
    fn a_missing_note_is_not_a_conflict() {
        let mut ledger = Ledger::default();
        ledger.wrote("Day.md", &note("tracked:: 1h"));
        assert!(ledger.may_write("Day.md", None), "deleted in the vault");
        assert!(
            ledger.may_write("Day.md", Some("# Monday\n\nsomeone removed the block")),
            "no block of ours means nothing of ours to lose",
        );
    }

    #[test]
    fn each_note_is_judged_on_its_own() {
        let mut ledger = Ledger::default();
        ledger.wrote("Mon.md", &note("tracked:: 1h"));
        ledger.wrote("Tue.md", &note("tracked:: 2h"));
        assert!(!ledger.may_write("Mon.md", Some(&note("tracked:: 9h"))));
        assert!(ledger.may_write("Tue.md", Some(&note("tracked:: 2h"))));
        assert_eq!(ledger.conflicts, vec!["Mon.md".to_string()]);
    }

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
