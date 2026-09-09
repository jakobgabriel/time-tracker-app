use std::collections::BTreeMap;

use crate::csv::rate_for;
use crate::error::Result;
use crate::models::Entry;
use crate::time::{decimal_hours, duration_seconds, format_duration, local_day, round_seconds};

/// A month's billing summary: what was worked, on what, and what it comes to.
///
/// This is the note an invoice gets written from, so it leads with the money
/// and keeps the per-project and per-tag splits that a client asks about.
pub fn render(
    entries: &[Entry],
    month: &str,
    round: u32,
    rates: &BTreeMap<String, f64>,
    currency: &str,
) -> Result<String> {
    let mut by_project: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_tag: BTreeMap<String, i64> = BTreeMap::new();
    let mut days: BTreeMap<String, i64> = BTreeMap::new();

    for entry in entries {
        let Some(end) = entry.end.as_deref() else {
            continue;
        };
        let day = local_day(&entry.start)?;
        if !day.starts_with(month) {
            continue;
        }
        let seconds = round_seconds(duration_seconds(&entry.start, end)?, round);
        let project = if entry.project.trim().is_empty() {
            "Untitled".to_string()
        } else {
            entry.project.trim().to_string()
        };
        *by_project.entry(project).or_insert(0) += seconds;
        *days.entry(day).or_insert(0) += seconds;
        for tag in &entry.tags {
            let tag = tag.trim();
            if !tag.is_empty() {
                *by_tag.entry(tag.to_string()).or_insert(0) += seconds;
            }
        }
    }

    let total: i64 = by_project.values().sum();
    let billable: f64 = by_project
        .iter()
        .map(|(project, seconds)| decimal_hours(*seconds) * rate_for(rates, project))
        .sum();

    let mut out = String::new();
    out.push_str(crate::markdown::BEGIN);
    out.push_str(&format!("\n## Invoice — {month}\n\n"));
    out.push_str(&format!(
        "period:: {month}\ntracked:: {}\ntracked-hours:: {:.2}\nbillable:: {} {:.2}\ndays-worked:: {}\n\n",
        format_duration(total),
        decimal_hours(total),
        currency,
        billable,
        days.len(),
    ));

    if by_project.is_empty() {
        out.push_str("_Nothing tracked this month._\n");
        out.push('\n');
        out.push_str(crate::markdown::END);
        out.push('\n');
        return Ok(out);
    }

    let mut ranked: Vec<(&String, &i64)> = by_project.iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));

    out.push_str("| Project | Hours | Rate | Amount |\n| --- | --- | --- | --- |\n");
    for (project, seconds) in ranked {
        let rate = rate_for(rates, project);
        out.push_str(&format!(
            "| {} | {:.2} | {} | {} |\n",
            project,
            decimal_hours(*seconds),
            if rate > 0.0 {
                format!("{currency} {rate:.2}")
            } else {
                "—".to_string()
            },
            if rate > 0.0 {
                format!("{currency} {:.2}", decimal_hours(*seconds) * rate)
            } else {
                "—".to_string()
            },
        ));
    }
    out.push_str(&format!(
        "| **Total** | **{:.2}** |  | **{} {:.2}** |\n",
        decimal_hours(total),
        currency,
        billable
    ));

    if !by_tag.is_empty() {
        let mut tags: Vec<(&String, &i64)> = by_tag.iter().collect();
        tags.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        out.push_str("\n**By tag**\n\n| Tag | Hours |\n| --- | --- |\n");
        for (tag, seconds) in tags {
            out.push_str(&format!("| #{} | {:.2} |\n", tag, decimal_hours(*seconds)));
        }
    }

    out.push('\n');
    out.push_str(crate::markdown::END);
    out.push('\n');
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(project: &str, day: &str, from: &str, to: &str, tags: &[&str]) -> Entry {
        Entry {
            id: format!("{project}{day}{from}"),
            project: project.into(),
            note: String::new(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            start: format!("{day}T{from}:00+02:00"),
            end: Some(format!("{day}T{to}:00+02:00")),
        }
    }

    fn sample() -> Vec<Entry> {
        vec![
            entry("Acme", "2026-09-01", "09:00", "12:00", &["billable"]),
            entry("Acme", "2026-09-02", "09:00", "11:00", &["billable"]),
            entry("Admin", "2026-09-02", "13:00", "14:00", &[]),
            entry("Acme", "2026-08-31", "09:00", "17:00", &["billable"]), // another month
        ]
    }

    #[test]
    fn totals_the_month_and_prices_it() {
        let rates = BTreeMap::from([("acme".to_string(), 100.0)]);
        let note = render(&sample(), "2026-09", 0, &rates, "€").unwrap();

        assert!(note.contains("period:: 2026-09"));
        assert!(note.contains("tracked:: 6h 00m"), "August is left out");
        assert!(note.contains("billable:: € 500.00"));
        assert!(note.contains("days-worked:: 2"));
        assert!(note.contains("| Acme | 5.00 | € 100.00 | € 500.00 |"));
        assert!(
            note.contains("| Admin | 1.00 | — | — |"),
            "an unpriced project shows as a dash"
        );
        assert!(note.contains("| **Total** | **6.00** |  | **€ 500.00** |"));
        assert!(note.contains("| #billable | 5.00 |"));
    }

    #[test]
    fn says_so_when_a_month_is_empty() {
        let note = render(&sample(), "2026-07", 0, &BTreeMap::new(), "€").unwrap();
        assert!(note.contains("_Nothing tracked this month._"));
        assert!(note.contains("tracked:: 0m"));
    }

    #[test]
    fn rounding_carries_into_the_invoice() {
        let one = vec![entry("Acme", "2026-09-01", "09:00", "09:20", &[])];
        let note = render(&one, "2026-09", 15, &BTreeMap::new(), "€").unwrap();
        assert!(note.contains("tracked-hours:: 0.25"), "got: {note}");
    }
}
