use std::collections::BTreeMap;

use crate::error::{AppError, Result};
use crate::models::Entry;
use crate::time::{decimal_hours, duration_seconds, hhmm, local_day, round_seconds};

/// The rate for a project, matched the way the app matches project names.
pub fn rate_for(rates: &BTreeMap<String, f64>, project: &str) -> f64 {
    rates
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(project.trim()))
        .map(|(_, rate)| *rate)
        .unwrap_or(0.0)
}

/// Quotes a field only when it needs it, so the common case stays readable in
/// a text editor as well as a spreadsheet.
fn field(value: &str) -> String {
    let value = value.replace(['\n', '\r'], " ");
    if value.contains([',', '"']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

/// One row per closed entry, oldest first — the shape invoicing tools expect.
///
/// `rate` and `amount` are always present, and are `0.00` for a project with
/// no rate, so the columns do not move around between exports.
pub fn render(entries: &[Entry], round: u32, rates: &BTreeMap<String, f64>) -> Result<String> {
    let mut rows: Vec<&Entry> = entries.iter().filter(|entry| entry.end.is_some()).collect();
    rows.sort_by(|a, b| a.start.cmp(&b.start));

    let mut out = String::from("date,start,end,hours,project,note,tags,rate,amount\n");
    for entry in rows {
        let end = entry.end.as_deref().unwrap_or_default();
        let seconds = round_seconds(duration_seconds(&entry.start, end)?, round);
        let hours = decimal_hours(seconds);
        let rate = rate_for(rates, &entry.project);
        out.push_str(&format!(
            "{},{},{},{:.2},{},{},{},{:.2},{:.2}\n",
            local_day(&entry.start)?,
            hhmm(&entry.start)?,
            hhmm(end)?,
            hours,
            field(entry.project.trim()),
            field(entry.note.trim()),
            field(&entry.tags.join(" ")),
            rate,
            hours * rate,
        ));
    }
    Ok(out)
}

/// Splits one CSV line, honouring quotes and doubled quotes inside them.
fn split_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => fields.push(std::mem::take(&mut current)),
            _ => current.push(ch),
        }
    }
    fields.push(current);
    fields
}

/// Reads a CSV back into entries.
///
/// Columns are found by their header name, so a file exported by Tempo, or a
/// hand-made one with the same names in another order, both work. Rows that
/// cannot be read are skipped and counted rather than failing the import.
pub fn parse(text: &str, offset: &str) -> Result<(Vec<Entry>, usize)> {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return Err(AppError::Invalid("that file is empty".into()));
    };

    let names: Vec<String> = split_row(header)
        .iter()
        .map(|name| name.trim().trim_start_matches('\u{feff}').to_lowercase())
        .collect();
    let column = |wanted: &str| names.iter().position(|name| name == wanted);

    let (Some(date), Some(start), Some(end)) = (column("date"), column("start"), column("end"))
    else {
        return Err(AppError::Invalid(
            "the file needs date, start and end columns".into(),
        ));
    };
    let project = column("project");
    let note = column("note");
    let tags = column("tags");

    let mut entries = Vec::new();
    let mut skipped = 0;
    for line in lines {
        let row = split_row(line);
        let get = |index: Option<usize>| {
            index
                .and_then(|i| row.get(i))
                .map(|value| value.trim().to_string())
                .unwrap_or_default()
        };
        let (Some(day), Some(from), Some(to)) = (row.get(date), row.get(start), row.get(end))
        else {
            skipped += 1;
            continue;
        };

        let begins = format!("{}T{}:00{}", day.trim(), from.trim(), offset);
        let ends = format!("{}T{}:00{}", day.trim(), to.trim(), offset);
        if crate::time::duration_seconds(&begins, &ends).unwrap_or(-1) <= 0 {
            skipped += 1;
            continue;
        }

        entries.push(Entry {
            id: uuid::Uuid::new_v4().to_string(),
            project: get(project),
            note: get(note),
            tags: get(tags)
                .split_whitespace()
                .map(|tag| tag.trim_start_matches('#').to_string())
                .filter(|tag| !tag.is_empty())
                .collect(),
            start: begins,
            end: Some(ends),
        });
    }

    Ok((entries, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(project: &str, note: &str, day: &str, from: &str, to: &str) -> Entry {
        Entry {
            id: "x".into(),
            project: project.into(),
            note: note.into(),
            tags: vec!["billable".into()],
            start: format!("{day}T{from}:00+02:00"),
            end: Some(format!("{day}T{to}:00+02:00")),
        }
    }

    fn no_rates() -> BTreeMap<String, f64> {
        BTreeMap::new()
    }

    #[test]
    fn writes_a_row_per_entry_oldest_first() {
        let csv = render(
            &[
                entry("Admin", "inbox", "2026-09-08", "11:00", "11:30"),
                entry("Acme", "kickoff", "2026-09-07", "09:00", "10:30"),
            ],
            0,
            &no_rates(),
        )
        .unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(
            lines[0],
            "date,start,end,hours,project,note,tags,rate,amount"
        );
        assert_eq!(
            lines[1],
            "2026-09-07,09:00,10:30,1.50,Acme,kickoff,billable,0.00,0.00"
        );
        assert_eq!(
            lines[2],
            "2026-09-08,11:00,11:30,0.50,Admin,inbox,billable,0.00,0.00"
        );
    }

    #[test]
    fn prices_the_rows_of_a_project_that_has_a_rate() {
        let rates = BTreeMap::from([("acme".to_string(), 120.0)]);
        let csv = render(
            &[entry("Acme", "", "2026-09-07", "09:00", "10:30")],
            0,
            &rates,
        )
        .unwrap();
        assert!(
            csv.contains(",1.50,Acme,,billable,120.00,180.00"),
            "got: {csv}"
        );
    }

    #[test]
    fn quotes_only_what_needs_quoting() {
        let csv = render(
            &[entry("A,B", "said \"hi\"", "2026-09-08", "09:00", "10:00")],
            0,
            &no_rates(),
        )
        .unwrap();
        assert!(csv.contains(r#""A,B","said ""hi""",billable"#));
    }

    #[test]
    fn a_running_entry_is_not_exported() {
        let mut running = entry("Acme", "", "2026-09-08", "09:00", "10:00");
        running.end = None;
        assert_eq!(
            render(&[running], 0, &no_rates()).unwrap().lines().count(),
            1
        );
    }

    #[test]
    fn reads_back_what_it_wrote() {
        let written = render(
            &[entry(
                "Acme, Inc",
                "said \"hi\"",
                "2026-09-07",
                "09:00",
                "10:30",
            )],
            0,
            &no_rates(),
        )
        .unwrap();
        let (entries, skipped) = parse(&written, "+02:00").unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].project, "Acme, Inc");
        assert_eq!(entries[0].note, "said \"hi\"");
        assert_eq!(entries[0].tags, vec!["billable".to_string()]);
        assert_eq!(entries[0].start, "2026-09-07T09:00:00+02:00");
        assert_eq!(entries[0].end.as_deref(), Some("2026-09-07T10:30:00+02:00"));
        assert!(!entries[0].id.is_empty());
    }

    #[test]
    fn takes_columns_in_any_order_and_ignores_extras() {
        let text =
            "project,End,note,DATE,start,invoice\nAcme,10:00,kickoff,2026-09-08,09:00,INV-1\n";
        let (entries, skipped) = parse(text, "+00:00").unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(entries[0].project, "Acme");
        assert_eq!(entries[0].note, "kickoff");
        assert_eq!(entries[0].start, "2026-09-08T09:00:00+00:00");
    }

    #[test]
    fn skips_rows_it_cannot_read_rather_than_failing() {
        let text = concat!(
            "date,start,end,project\n",
            "2026-09-08,09:00,10:00,Good\n",
            "not-a-date,09:00,10:00,Bad\n",
            "2026-09-08,10:00,09:00,Backwards\n",
            "2026-09-08\n",
        );
        let (entries, skipped) = parse(text, "+00:00").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].project, "Good");
        assert_eq!(skipped, 3);
    }

    #[test]
    fn explains_a_file_it_cannot_use() {
        assert!(parse("", "+00:00")
            .unwrap_err()
            .to_string()
            .contains("empty"));
        assert!(parse("a,b\n1,2\n", "+00:00")
            .unwrap_err()
            .to_string()
            .contains("date, start and end"));
    }

    #[test]
    fn strips_hashes_from_imported_tags() {
        let text = "date,start,end,tags\n2026-09-08,09:00,10:00,#billable #meeting\n";
        let (entries, _) = parse(text, "+00:00").unwrap();
        assert_eq!(
            entries[0].tags,
            vec!["billable".to_string(), "meeting".to_string()]
        );
    }

    #[test]
    fn rounding_carries_into_the_export() {
        let csv = render(
            &[entry("Acme", "", "2026-09-08", "09:00", "09:20")],
            15,
            &no_rates(),
        )
        .unwrap();
        assert!(csv.contains(",0.25,Acme"));
    }
}
