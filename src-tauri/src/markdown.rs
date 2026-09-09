use std::collections::BTreeMap;

use crate::csv::rate_for;
use crate::error::Result;
use crate::models::Entry;
use crate::time::{decimal_hours, format_duration, hhmm, round_seconds};

/// Obsidian renders `%% … %%` as an invisible comment, so the markers that
/// delimit the generated block never show up in reading view.
pub const BEGIN: &str = "%% tempo:begin %%";
pub const END: &str = "%% tempo:end %%";

/// A project as it appears in a table cell: plain text, or a wikilink when the
/// vault would rather have a note per project.
fn project_cell(project: &str, link: bool) -> String {
    if !link {
        return cell(project);
    }
    // `|`, `[` and `]` all mean something inside a wikilink, and none of them
    // survive a table cell either; a link target has to do without them.
    let target = project.replace(['|', '[', ']'], " ");
    format!(
        "[[{}]]",
        target.split_whitespace().collect::<Vec<_>>().join(" ")
    )
}

fn cell(text: &str) -> String {
    // A stray pipe or newline would break the table apart.
    text.replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace(['\n', '\r'], " ")
        .trim()
        .to_string()
}

fn totals_by_project(entries: &[Entry], round: u32) -> Vec<(String, i64)> {
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    for entry in entries {
        let seconds = entry_seconds(entry, round).unwrap_or(0);
        *totals.entry(project_of(entry)).or_insert(0) += seconds;
    }
    let mut totals: Vec<(String, i64)> = totals.into_iter().collect();
    totals.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    totals
}

fn project_of(entry: &Entry) -> String {
    if entry.project.trim().is_empty() {
        "Untitled".to_string()
    } else {
        entry.project.trim().to_string()
    }
}

fn entry_seconds(entry: &Entry, round: u32) -> Result<i64> {
    let Some(end) = entry.end.as_deref() else {
        return Ok(0);
    };
    Ok(round_seconds(
        crate::time::duration_seconds(&entry.start, end)?,
        round,
    ))
}

fn day_table(entries: &[Entry], round: u32, link: bool) -> Result<String> {
    let mut out = String::from(
        "| Start | End | Duration | Project | Note |\n| --- | --- | --- | --- | --- |\n",
    );
    // Chronological inside a note, even though the app lists newest first.
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.start.cmp(&b.start));
    for entry in sorted {
        let Some(end) = entry.end.as_deref() else {
            continue;
        };
        let tags = entry
            .tags
            .iter()
            .map(|t| format!("#{}", t.trim().replace(' ', "-")))
            .collect::<Vec<_>>()
            .join(" ");
        let note = match (entry.note.trim().is_empty(), tags.is_empty()) {
            (true, true) => String::new(),
            (true, false) => tags,
            (false, true) => entry.note.trim().to_string(),
            (false, false) => format!("{} {}", entry.note.trim(), tags),
        };
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            hhmm(&entry.start)?,
            hhmm(end)?,
            format_duration(entry_seconds(entry, round)?),
            project_cell(&project_of(entry), link),
            cell(&note),
        ));
    }
    Ok(out)
}

/// Money is only ever mentioned once a rate exists for one of the projects in
/// the note; an unpriced vault reads exactly as it did before.
fn amount_of(rates: &BTreeMap<String, f64>, project: &str, seconds: i64) -> f64 {
    decimal_hours(seconds) * rate_for(rates, project)
}

/// Builds the generated section for one note. `days` holds one group for a
/// daily note and up to 31 for a monthly one.
pub fn render_block(
    days: &[(String, Vec<Entry>)],
    round: u32,
    rates: &BTreeMap<String, f64>,
    currency: &str,
    link_projects: bool,
) -> Result<String> {
    let all: Vec<Entry> = days.iter().flat_map(|(_, e)| e.clone()).collect();
    let mut total = 0i64;
    for entry in &all {
        total += entry_seconds(entry, round)?;
    }

    let mut out = String::new();
    out.push_str(BEGIN);
    out.push_str("\n## ⏱ Time tracking\n\n");
    // Inline Dataview fields — queryable without touching the note's own front matter.
    out.push_str(&format!(
        "tracked:: {}\ntracked-hours:: {:.2}\n\n",
        format_duration(total),
        decimal_hours(total)
    ));

    if all.is_empty() {
        out.push_str("_No time tracked._\n");
        out.push_str(END);
        out.push('\n');
        return Ok(out);
    }

    if days.len() == 1 {
        out.push_str(&day_table(&days[0].1, round, link_projects)?);
    } else {
        for (day, entries) in days {
            if entries.is_empty() {
                continue;
            }
            let mut day_total = 0i64;
            for entry in entries {
                day_total += entry_seconds(entry, round)?;
            }
            out.push_str(&format!(
                "### {} — {}\n\n{}\n",
                day,
                format_duration(day_total),
                day_table(entries, round, link_projects)?
            ));
        }
    }

    let per_project = totals_by_project(&all, round);
    let priced = per_project
        .iter()
        .any(|(project, _)| rate_for(rates, project) > 0.0);

    if per_project.len() > 1 || priced {
        out.push_str("\n**Per project**\n\n| Project | Duration | Hours |");
        if priced {
            out.push_str(" Amount |");
        }
        out.push_str("\n| --- | --- | --- |");
        if priced {
            out.push_str(" --- |");
        }
        out.push('\n');

        let mut billed = 0.0;
        for (project, seconds) in per_project {
            out.push_str(&format!(
                "| {} | {} | {:.2} |",
                project_cell(&project, link_projects),
                format_duration(seconds),
                decimal_hours(seconds)
            ));
            if priced {
                let amount = amount_of(rates, &project, seconds);
                billed += amount;
                out.push_str(&format!(" {} {:.2} |", currency, amount));
            }
            out.push('\n');
        }

        if priced {
            out.push_str(&format!("\nbilled:: {} {:.2}\n", currency, billed));
        }
    }

    out.push('\n');
    out.push_str(END);
    out.push('\n');
    Ok(out)
}

/// A project's own note: one row per day it was worked, plus its totals.
///
/// A per-session table would run to thousands of rows on a long project; a
/// day is the unit someone actually looks back at.
pub fn render_project_block(
    days: &[(String, Vec<Entry>)],
    round: u32,
    rate: f64,
    currency: &str,
) -> Result<String> {
    let mut total = 0i64;
    let mut rows = String::new();

    for (day, entries) in days.iter().rev() {
        let mut seconds = 0i64;
        let mut notes: Vec<String> = Vec::new();
        for entry in entries {
            seconds += entry_seconds(entry, round)?;
            let note = entry.note.trim();
            if !note.is_empty() && !notes.iter().any(|kept| kept == note) {
                notes.push(note.to_string());
            }
        }
        total += seconds;
        rows.push_str(&format!(
            "| [[{}]] | {} | {} |\n",
            day,
            format_duration(seconds),
            cell(&notes.join(" · ")),
        ));
    }

    let mut out = String::new();
    out.push_str(BEGIN);
    out.push_str("\n## ⏱ Time tracking\n\n");
    out.push_str(&format!(
        "tracked:: {}\ntracked-hours:: {:.2}\n",
        format_duration(total),
        decimal_hours(total)
    ));
    if rate > 0.0 {
        out.push_str(&format!(
            "rate:: {} {:.2}\nbilled:: {} {:.2}\n",
            currency,
            rate,
            currency,
            decimal_hours(total) * rate
        ));
    }
    out.push('\n');

    if rows.is_empty() {
        out.push_str("_No time tracked._\n");
    } else {
        out.push_str("| Day | Duration | Notes |\n| --- | --- | --- |\n");
        out.push_str(&rows);
    }

    out.push('\n');
    out.push_str(END);
    out.push('\n');
    Ok(out)
}

/// Splices the generated block into a note.
///
/// Anything the user wrote outside the markers is preserved verbatim — that is
/// the whole point of syncing into a daily note instead of owning the file.
pub fn merge(existing: Option<&str>, block: &str, title: &str, note_tag: &str) -> String {
    let Some(existing) = existing else {
        let mut out = String::new();
        if !note_tag.trim().is_empty() {
            out.push_str(&format!("---\ntags:\n  - {}\n---\n\n", note_tag.trim()));
        }
        out.push_str(&format!("# {title}\n\n"));
        out.push_str(block);
        return out;
    };

    match (existing.find(BEGIN), existing.find(END)) {
        (Some(start), Some(end)) if end > start => {
            let mut out = String::with_capacity(existing.len() + block.len());
            out.push_str(&existing[..start]);
            out.push_str(block.trim_end());
            out.push_str(&existing[end + END.len()..]);
            out
        }
        _ => {
            // No markers yet: append, never guess where the user wants it.
            let mut out = existing.trim_end().to_string();
            out.push_str("\n\n");
            out.push_str(block);
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(project: &str, start: &str, end: &str, note: &str) -> Entry {
        Entry {
            id: format!("{project}-{start}"),
            project: project.into(),
            note: note.into(),
            tags: vec![],
            start: start.into(),
            end: Some(end.into()),
        }
    }

    fn sample() -> Vec<(String, Vec<Entry>)> {
        vec![(
            "2026-09-08".to_string(),
            vec![
                entry(
                    "Acme",
                    "2026-09-08T09:00:00+02:00",
                    "2026-09-08T10:30:00+02:00",
                    "kickoff",
                ),
                entry(
                    "Admin",
                    "2026-09-08T11:00:00+02:00",
                    "2026-09-08T11:30:00+02:00",
                    "",
                ),
            ],
        )]
    }

    fn no_rates() -> BTreeMap<String, f64> {
        BTreeMap::new()
    }

    fn plain(days: &[(String, Vec<Entry>)], round: u32) -> String {
        render_block(days, round, &no_rates(), "€", false).unwrap()
    }

    #[test]
    fn renders_a_day() {
        let block = plain(&sample(), 0);
        assert!(block.starts_with(BEGIN));
        assert!(block.trim_end().ends_with(END));
        assert!(block.contains("tracked:: 2h 00m"));
        assert!(block.contains("tracked-hours:: 2.00"));
        assert!(block.contains("| 09:00 | 10:30 | 1h 30m | Acme | kickoff |"));
        assert!(block.contains("**Per project**"));
    }

    #[test]
    fn links_projects_when_the_vault_wants_a_note_per_project() {
        let block = render_block(&sample(), 0, &no_rates(), "€", true).unwrap();
        assert!(block.contains("| [[Acme]] | kickoff |"), "got: {block}");
        assert!(
            block.contains("| [[Admin]] | 30m |"),
            "the summary links too"
        );
    }

    #[test]
    fn a_link_target_drops_characters_a_wikilink_cannot_hold() {
        let days = vec![(
            "2026-09-08".to_string(),
            vec![entry(
                "A|B [x]",
                "2026-09-08T09:00:00+02:00",
                "2026-09-08T10:00:00+02:00",
                "",
            )],
        )];
        let block = render_block(&days, 0, &no_rates(), "€", true).unwrap();
        assert!(block.contains("[[A B x]]"), "got: {block}");
    }

    #[test]
    fn escapes_pipes_so_tables_survive() {
        let days = vec![(
            "2026-09-08".to_string(),
            vec![entry(
                "A|B",
                "2026-09-08T09:00:00+02:00",
                "2026-09-08T10:00:00+02:00",
                "x\ny",
            )],
        )];
        let block = plain(&days, 0);
        assert!(block.contains(r"A\|B"));
        assert!(!block.contains("x\ny"));
        assert!(block.contains("x y"));
    }

    #[test]
    fn a_project_note_summarises_by_day_newest_first() {
        let days = vec![
            (
                "2026-09-07".to_string(),
                vec![entry(
                    "Acme",
                    "2026-09-07T09:00:00+02:00",
                    "2026-09-07T10:00:00+02:00",
                    "spec",
                )],
            ),
            (
                "2026-09-08".to_string(),
                vec![
                    entry(
                        "Acme",
                        "2026-09-08T09:00:00+02:00",
                        "2026-09-08T10:30:00+02:00",
                        "api",
                    ),
                    entry(
                        "Acme",
                        "2026-09-08T13:00:00+02:00",
                        "2026-09-08T14:00:00+02:00",
                        "api",
                    ),
                ],
            ),
        ];
        let block = render_project_block(&days, 0, 120.0, "€").unwrap();

        assert!(block.contains("tracked:: 3h 30m"));
        assert!(block.contains("rate:: € 120.00"));
        assert!(block.contains("billed:: € 420.00"));
        // Newest day first, and a note repeated across sessions is said once.
        let table = block.split("| Day |").nth(1).unwrap();
        assert!(
            table.contains("| [[2026-09-08]] | 2h 30m | api |"),
            "got: {table}"
        );
        assert!(table.find("2026-09-08").unwrap() < table.find("2026-09-07").unwrap());
    }

    #[test]
    fn an_unpriced_project_note_stays_quiet_about_money() {
        let block = render_project_block(&sample()[..1], 0, 0.0, "€").unwrap();
        assert!(!block.contains("billed::"));
        assert!(!block.contains("rate::"));
    }

    #[test]
    fn creates_a_note_with_front_matter() {
        let note = merge(None, "BLOCK", "2026-09-08", "time-tracking");
        assert!(note.starts_with("---\ntags:\n  - time-tracking\n---"));
        assert!(note.contains("# 2026-09-08"));
        assert!(note.ends_with("BLOCK"));
    }

    #[test]
    fn replaces_only_the_managed_block() {
        let existing = format!(
            "---\ntags: [daily]\n---\n\n# Monday\n\nMy own notes.\n\n{BEGIN}\nold\n{END}\n\nFooter I wrote.\n"
        );
        let merged = merge(Some(&existing), &format!("{BEGIN}\nnew\n{END}\n"), "x", "t");
        assert!(merged.contains("My own notes."));
        assert!(merged.contains("Footer I wrote."));
        assert!(merged.contains("new"));
        assert!(!merged.contains("old"));
        assert_eq!(merged.matches(BEGIN).count(), 1);
    }

    #[test]
    fn appends_when_the_note_has_no_markers() {
        let merged = merge(Some("# Monday\n\nNotes.\n"), "BLOCK", "x", "t");
        assert_eq!(merged, "# Monday\n\nNotes.\n\nBLOCK");
    }

    #[test]
    fn rounding_applies_to_the_report_only() {
        let days = vec![(
            "2026-09-08".to_string(),
            vec![entry(
                "Acme",
                "2026-09-08T09:00:00+02:00",
                "2026-09-08T09:20:00+02:00",
                "",
            )],
        )];
        let block = plain(&days, 15);
        assert!(block.contains("| 09:00 | 09:20 | 15m | Acme |  |"));
    }

    #[test]
    fn a_vault_without_rates_never_mentions_money() {
        let block = plain(&sample(), 0);
        assert!(!block.contains("Amount"));
        assert!(!block.contains("billed::"));
    }

    #[test]
    fn priced_projects_get_an_amount_column_and_a_billed_field() {
        let rates = BTreeMap::from([("acme".to_string(), 120.0)]);
        let block = render_block(&sample(), 0, &rates, "€", false).unwrap();
        // 1h30m of Acme at 120 is 180; Admin has no rate and stays at zero.
        assert!(
            block.contains("| Acme | 1h 30m | 1.50 | € 180.00 |"),
            "got: {block}"
        );
        assert!(block.contains("| Admin | 30m | 0.50 | € 0.00 |"));
        assert!(block.contains("billed:: € 180.00"));
    }
}
