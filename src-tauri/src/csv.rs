use std::collections::BTreeMap;

use crate::error::Result;
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
