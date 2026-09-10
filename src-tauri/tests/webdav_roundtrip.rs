//! End-to-end check against a real WebDAV server.
//!
//! Start one (any server will do) and point the test at it:
//!
//! ```text
//! TEMPO_DAV_URL=http://127.0.0.1:8099/ TEMPO_DAV_USER=jakob TEMPO_DAV_PASS=s3cret \
//!   TEMPO_DAV_ROOT=/tmp/dav-root cargo test --test webdav_roundtrip -- --ignored
//! ```
//!
//! It is `#[ignore]`d so `cargo test` stays hermetic.

use std::collections::{BTreeMap, BTreeSet};

use tempo_lib::models::{Entry, FileLayout, Settings};
use tempo_lib::sync::{plan, push, Ledger};
use tempo_lib::webdav::Dav;

fn settings() -> Settings {
    Settings {
        webdav_url: std::env::var("TEMPO_DAV_URL").expect("TEMPO_DAV_URL"),
        username: std::env::var("TEMPO_DAV_USER").unwrap_or_default(),
        password: std::env::var("TEMPO_DAV_PASS").unwrap_or_default(),
        vault_folder: "Vault/Time Tracking".into(),
        file_layout: FileLayout::Daily,
        ..Settings::default()
    }
}

fn entry(id: &str, project: &str, from: u32, to: u32) -> Entry {
    Entry {
        id: id.into(),
        project: project.into(),
        note: "wrote the sync".into(),
        tags: vec!["billable".into()],
        start: format!("2026-09-08T{from:02}:00:00+02:00"),
        end: Some(format!("2026-09-08T{to:02}:00:00+02:00")),
    }
}

#[tokio::test]
#[ignore = "needs a WebDAV server; see the module docs"]
async fn writes_a_note_and_keeps_what_the_user_wrote() {
    let settings = settings();
    let days = BTreeSet::from(["2026-09-08".to_string()]);
    let rates = BTreeMap::new();

    Dav::from_settings(&settings)
        .unwrap()
        .check()
        .await
        .expect("the server should accept the credentials");

    // First sync: the folder does not exist yet and neither does the note.
    let entries = vec![entry("a", "Acme", 9, 11)];
    push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut Ledger::default(),
    )
    .await
    .expect("first push");

    let dav = Dav::from_settings(&settings).unwrap();
    let note = dav
        .get("Vault/Time Tracking/2026-09-08.md")
        .await
        .unwrap()
        .expect("the note exists");
    assert!(
        note.contains("tags:\n  - time-tracking"),
        "front matter written once"
    );
    assert!(note.contains("| 09:00 | 11:00 | 2h 00m | Acme | wrote the sync #billable |"));

    // The user edits the note in Obsidian, above and below the managed block.
    let edited = note.replace(
        tempo_lib::markdown::BEGIN,
        &format!(
            "Standup notes I typed myself.\n\n{}",
            tempo_lib::markdown::BEGIN
        ),
    ) + "\n\nA footer I typed myself.\n";
    dav.put("Vault/Time Tracking/2026-09-08.md", edited)
        .await
        .unwrap();

    // Second sync with a changed day.
    let entries = vec![entry("a", "Acme", 9, 11), entry("b", "Admin", 13, 14)];
    push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut Ledger::default(),
    )
    .await
    .expect("second push");

    let note = dav
        .get("Vault/Time Tracking/2026-09-08.md")
        .await
        .unwrap()
        .unwrap();
    assert!(
        note.contains("Standup notes I typed myself."),
        "text above survives"
    );
    assert!(
        note.contains("A footer I typed myself."),
        "text below survives"
    );
    assert!(
        note.contains("| 13:00 | 14:00 | 1h 00m | Admin"),
        "new entry is in"
    );
    assert!(note.contains("tracked:: 3h 00m"), "total is recomputed");
    assert_eq!(
        note.matches(tempo_lib::markdown::BEGIN).count(),
        1,
        "no duplicate block"
    );
    assert_eq!(
        note.matches("---\ntags:").count(),
        1,
        "front matter not duplicated"
    );

    // Deleting everything for the day empties the block but keeps the note.
    push(
        &settings,
        plan(&[], &days, &settings.file_layout).unwrap(),
        &rates,
        &mut Ledger::default(),
    )
    .await
    .expect("third push");
    let note = dav
        .get("Vault/Time Tracking/2026-09-08.md")
        .await
        .unwrap()
        .unwrap();
    assert!(note.contains("_No time tracked._"));
    assert!(note.contains("Standup notes I typed myself."));
}

#[tokio::test]
#[ignore = "needs a WebDAV server; see the module docs"]
async fn reports_a_bad_password_clearly() {
    let mut settings = settings();
    settings.password = "wrong".into();
    let error = Dav::from_settings(&settings)
        .unwrap()
        .check()
        .await
        .unwrap_err();
    assert!(error.to_string().contains("credentials"), "got: {error}");
}

/// The case this whole ledger exists for: someone corrects a number inside
/// Tempo's block in Obsidian, and the next sync must not quietly undo it.
#[tokio::test]
#[ignore = "needs a WebDAV server; see the module docs"]
async fn refuses_to_overwrite_a_block_edited_in_the_vault() {
    let mut settings = settings();
    settings.vault_folder = "Vault/Conflicts".into();
    let path = "Vault/Conflicts/2026-09-08.md";
    let days = BTreeSet::from(["2026-09-08".to_string()]);
    let rates = BTreeMap::new();
    let dav = Dav::from_settings(&settings).unwrap();

    // A sync that leaves a block behind, and remembers what it left.
    let entries = vec![entry("a", "Acme", 9, 11)];
    let mut ledger = Ledger::default();
    push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut ledger,
    )
    .await
    .expect("first push");
    assert!(ledger.conflicts.is_empty(), "nothing to conflict with yet");

    // Someone fixes the note in Obsidian: the entry ran to 12:00, not 11:00.
    let edited = dav
        .get(path)
        .await
        .unwrap()
        .unwrap()
        .replace("| 11:00 |", "| 12:00 |");
    assert!(edited.contains("| 12:00 |"), "the edit went in");
    dav.put(path, edited.clone()).await.unwrap();

    // The next sync carries the ledger forward, sees the edit, and stops.
    let mut ledger = Ledger::new(ledger.known.clone(), false);
    let report = push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut ledger,
    )
    .await
    .expect("second push");
    assert_eq!(report.conflicts, vec![path.to_string()]);
    assert_eq!(report.files, 0, "the note was not written");
    assert_eq!(
        dav.get(path).await.unwrap().unwrap(),
        edited,
        "the vault's version is untouched, byte for byte",
    );

    // Asked outright, it writes anyway — and the edit is gone, as expected.
    let mut ledger = Ledger::new(ledger.known.clone(), true);
    let report = push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut ledger,
    )
    .await
    .expect("forced push");
    assert!(report.conflicts.is_empty());
    let note = dav.get(path).await.unwrap().unwrap();
    assert!(note.contains("| 11:00 |"), "Tempo's numbers are back");
    assert!(!note.contains("| 12:00 |"));

    // And the forced write re-baselines: syncing again is quiet.
    let mut ledger = Ledger::new(ledger.known.clone(), false);
    let report = push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &rates,
        &mut ledger,
    )
    .await
    .expect("fourth push");
    assert!(
        report.conflicts.is_empty(),
        "the block it just wrote is its own",
    );
}

/// The preview has to be the note, not an approximation of it — otherwise it
/// is worse than nothing: it would give confidence in a path that is wrong.
#[tokio::test]
#[ignore = "needs a WebDAV server; see the module docs"]
async fn the_preview_matches_what_the_sync_writes() {
    let mut settings = settings();
    settings.vault_folder = "Vault/Preview".into();
    settings.note_pattern = "Journal/{YYYY}/{YYYY-MM-DD}".into();
    let day = "2026-09-08".to_string();
    let days = BTreeSet::from([day.clone()]);
    let entries = vec![entry("a", "Acme", 9, 11), entry("b", "Admin", 13, 14)];

    // What the preview promises.
    let grouped = plan(&entries, &days, &settings.file_layout).unwrap();
    let (file, mut groups) = grouped.into_iter().next().unwrap();
    groups.sort_by(|a, b| a.0.cmp(&b.0));
    let block = tempo_lib::markdown::render_block(
        &groups,
        settings.round_minutes,
        &BTreeMap::new(),
        &settings.currency,
        settings.link_projects,
    )
    .unwrap();
    let promised = tempo_lib::markdown::merge(
        None,
        &block,
        file.strip_suffix(".md").unwrap(),
        &settings.note_tag,
    );
    let path = tempo_lib::sync::note_path(&settings, &file).unwrap();
    assert_eq!(path, "Journal/2026/2026-09-08.md", "the pattern won");

    // What the sync actually does.
    push(
        &settings,
        plan(&entries, &days, &settings.file_layout).unwrap(),
        &BTreeMap::new(),
        &mut Ledger::default(),
    )
    .await
    .expect("push");

    let written = Dav::from_settings(&settings)
        .unwrap()
        .get(&path)
        .await
        .unwrap()
        .expect("the note is where the preview said it would be");
    assert_eq!(written, promised, "the preview is the note, byte for byte");
}
