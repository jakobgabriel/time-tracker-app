use crate::error::{AppError, Result};
use crate::time::iso_week;

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Expands a note-path pattern for one local day.
///
/// Vaults already have a daily-note convention, and it is rarely a flat folder
/// of `YYYY-MM-DD.md`. A pattern lets Tempo write into the notes that are
/// already there instead of insisting on its own.
///
/// `{YYYY} {MM} {DD} {YYYY-MM-DD} {YYYY-MM} {MMM} {MMMM} {YYYY-Www} {ww}`
pub fn expand(pattern: &str, day: &str) -> Result<String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err(AppError::Invalid("the note path is empty".into()));
    }
    if day.len() < 10 {
        return Err(AppError::Invalid(format!("not a valid day: {day}")));
    }

    let (year, month, date) = (&day[0..4], &day[5..7], &day[8..10]);
    let month_index: usize = month.parse::<usize>().unwrap_or(1).clamp(1, 12) - 1;
    let week = iso_week(day)?;

    let expanded = pattern
        .replace("{YYYY-MM-DD}", day)
        .replace("{YYYY-MM}", &format!("{year}-{month}"))
        .replace("{YYYY-Www}", &week)
        .replace("{MMMM}", MONTHS[month_index])
        .replace("{MMM}", &MONTHS[month_index][..3])
        .replace("{YYYY}", year)
        .replace("{MM}", month)
        .replace("{DD}", date)
        .replace("{ww}", week.split("-W").nth(1).unwrap_or("01"));

    clean(&expanded)
}

/// Normalises a path and refuses anything that would escape the share.
fn clean(path: &str) -> Result<String> {
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        let segment = segment.trim();
        match segment {
            "" | "." => continue,
            ".." => return Err(AppError::Invalid("a note path cannot contain `..`".into())),
            _ => segments.push(segment),
        }
    }
    if segments.is_empty() {
        return Err(AppError::Invalid("the note path is empty".into()));
    }

    let mut joined = segments.join("/");
    if !joined.to_lowercase().ends_with(".md") {
        joined.push_str(".md");
    }
    Ok(joined)
}

/// The folders a file path needs, outermost first — what MKCOL walks.
pub fn parent(path: &str) -> Option<String> {
    let (folder, _) = path.rsplit_once('/')?;
    Some(folder.to_string())
}

/// Makes a project name safe to use as a file name.
pub fn file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']' => '-',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim().to_string();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_into_a_vaults_own_daily_note_layout() {
        assert_eq!(
            expand("Daily/{YYYY}/{YYYY-MM-DD}.md", "2026-09-09").unwrap(),
            "Daily/2026/2026-09-09.md"
        );
        assert_eq!(
            expand("Journal/{YYYY}/{MM} {MMMM}/{DD}.md", "2026-09-09").unwrap(),
            "Journal/2026/09 September/09.md"
        );
        assert_eq!(expand("{YYYY-MM}.md", "2026-09-09").unwrap(), "2026-09.md");
        assert_eq!(
            expand("Weeks/{YYYY-Www}.md", "2026-09-09").unwrap(),
            "Weeks/2026-W37.md"
        );
        assert_eq!(expand("{MMM} {ww}", "2026-09-09").unwrap(), "Sep 37.md");
    }

    #[test]
    fn tidies_the_result() {
        // A missing extension, stray slashes and spaces are all forgivable.
        assert_eq!(
            expand("Daily / {YYYY-MM-DD}", "2026-09-09").unwrap(),
            "Daily/2026-09-09.md"
        );
        assert_eq!(
            expand("/Daily//{DD}.MD/", "2026-09-09").unwrap(),
            "Daily/09.MD"
        );
    }

    #[test]
    fn refuses_to_climb_out_of_the_share() {
        assert!(expand("../secrets/{DD}.md", "2026-09-09").is_err());
        assert!(expand("  ", "2026-09-09").is_err());
    }

    #[test]
    fn finds_the_folder_to_create() {
        assert_eq!(
            parent("Daily/2026/2026-09-09.md").as_deref(),
            Some("Daily/2026")
        );
        assert_eq!(parent("2026-09-09.md"), None);
    }

    #[test]
    fn makes_a_project_name_safe_for_a_file() {
        assert_eq!(file_stem("Acme / Rollout"), "Acme - Rollout");
        assert_eq!(file_stem("R&D: phase #2"), "R&D- phase -2");
        assert_eq!(file_stem("  ...  "), "Untitled");
    }
}
