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

use std::collections::BTreeSet;

use tempo_lib::models::{Entry, FileLayout, Settings};
use tempo_lib::sync::{plan, push};
use tempo_lib::webdav::Dav;

fn settings() -> Settings {
    Settings {
        webdav_url: std::env::var("TEMPO_DAV_URL").expect("TEMPO_DAV_URL"),
        username: std::env::var("TEMPO_DAV_USER").unwrap_or_default(),
        password: std::env::var("TEMPO_DAV_PASS").unwrap_or_default(),
        vault_folder: "Vault/Time Tracking".into(),
        file_layout: FileLayout::Daily,
        auto_sync: true,
        round_minutes: 0,
        note_tag: "time-tracking".into(),
        daily_goal_minutes: 0,
        last_sync: None,
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
    push(&settings, plan(&[], &days, &settings.file_layout).unwrap())
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
