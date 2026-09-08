use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::models::Entry;

/// The file name kept next to the notes.
pub const FILE: &str = "tempo-backup.json";

/// A copy of everything the app would be sad to lose.
///
/// Credentials are deliberately absent: the backup lives in a vault that syncs
/// to other machines, and a password does not belong there.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    // Defaulted so a file from another version still reaches the version check
    // below and gets a useful message instead of a serde error.
    #[serde(default)]
    pub exported_at: String,
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub projects: Vec<String>,
}

pub fn render(entries: &[Entry], projects: &[String], now: &str) -> Result<String> {
    let backup = Backup {
        version: 1,
        exported_at: now.to_string(),
        entries: entries.to_vec(),
        projects: projects.to_vec(),
    };
    Ok(serde_json::to_string_pretty(&backup)?)
}

pub fn parse(text: &str) -> Result<Backup> {
    let backup: Backup = serde_json::from_str(text)
        .map_err(|err| AppError::Invalid(format!("that backup file cannot be read: {err}")))?;
    if backup.version > 1 {
        return Err(AppError::Invalid(
            "that backup was written by a newer version of Tempo".into(),
        ));
    }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> Entry {
        Entry {
            id: id.into(),
            project: "Acme".into(),
            note: "kickoff".into(),
            tags: vec!["billable".into()],
            start: "2026-09-08T09:00:00+02:00".into(),
            end: Some("2026-09-08T10:00:00+02:00".into()),
        }
    }

    #[test]
    fn round_trips() {
        let text = render(
            &[entry("a"), entry("b")],
            &["Acme".to_string()],
            "2026-09-08T12:00:00+02:00",
        )
        .unwrap();
        let back = parse(&text).unwrap();
        assert_eq!(back.version, 1);
        assert_eq!(back.entries.len(), 2);
        assert_eq!(back.projects, vec!["Acme".to_string()]);
        assert_eq!(back.entries[0].tags, vec!["billable".to_string()]);
    }

    #[test]
    fn never_carries_credentials() {
        let text = render(&[entry("a")], &[], "2026-09-08T12:00:00+02:00").unwrap();
        assert!(!text.contains("password"));
        assert!(!text.contains("webdav"));
    }

    #[test]
    fn refuses_a_future_format() {
        let text = r#"{"version":9,"exportedAt":"x","entries":[]}"#;
        assert!(parse(text)
            .unwrap_err()
            .to_string()
            .contains("newer version"));
    }

    #[test]
    fn explains_a_broken_file() {
        assert!(parse("not json")
            .unwrap_err()
            .to_string()
            .contains("cannot be read"));
    }
}
