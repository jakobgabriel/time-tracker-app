pub mod error;
pub mod markdown;
pub mod models;
pub mod store;
pub mod sync;
pub mod time;
pub mod webdav;

use std::collections::BTreeSet;
use std::sync::Mutex;

use tauri::{Manager, State};

use error::{AppError, Result};
use models::{Entry, Settings, Snapshot, SyncReport};
use store::Store;

/// Sent to the UI in place of the real password so the secret never leaves the
/// backend; the UI sends it back unchanged when the user did not retype it.
pub const PASSWORD_PLACEHOLDER: &str =
    "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}";

struct AppState {
    store: Mutex<Store>,
}

impl AppState {
    fn with<T>(&self, f: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| AppError::Invalid("the local database is busy, try again".into()))?;
        f(&mut guard)
    }
}

#[tauri::command]
fn snapshot(state: State<'_, AppState>) -> Result<Snapshot> {
    state.with(|store| Ok(store.snapshot()))
}

#[tauri::command]
fn start_timer(
    state: State<'_, AppState>,
    project: String,
    note: String,
    tags: Vec<String>,
    now: String,
) -> Result<Snapshot> {
    state.with(|store| {
        store.start(&project, &note, tags, &now)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn stop_timer(state: State<'_, AppState>, now: String) -> Result<Snapshot> {
    state.with(|store| {
        store.stop(&now)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn discard_timer(state: State<'_, AppState>) -> Result<Snapshot> {
    state.with(|store| {
        store.discard_running()?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn save_entry(state: State<'_, AppState>, entry: Entry) -> Result<Snapshot> {
    state.with(|store| {
        store.upsert(entry)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn delete_entry(state: State<'_, AppState>, id: String) -> Result<Snapshot> {
    state.with(|store| {
        store.delete(&id)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, name: String) -> Result<Snapshot> {
    state.with(|store| {
        store.delete_project(&name)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Snapshot> {
    state.with(|store| {
        let mut settings = settings;
        if settings.password == PASSWORD_PLACEHOLDER {
            settings.password = store.settings.password.clone();
        }
        settings.last_sync = store.settings.last_sync.clone();
        store.settings = settings;
        store.save()?;
        Ok(store.snapshot())
    })
}

/// Checks the credentials the user is *currently looking at*, so "Test" works
/// before "Save" — an untouched password field still holds the placeholder and
/// is resolved against what is stored.
#[tauri::command]
async fn test_connection(state: State<'_, AppState>, settings: Settings) -> Result<String> {
    let mut settings = settings;
    if settings.password == PASSWORD_PLACEHOLDER {
        settings.password = state.with(|store| Ok(store.settings.password.clone()))?;
    }
    webdav::Dav::from_settings(&settings)?.check().await?;
    Ok("Connected".to_string())
}

/// Writes the notes for every day that changed since the last sync. With
/// `full`, every day that has entries is rewritten instead.
#[tauri::command]
async fn sync_now(state: State<'_, AppState>, full: bool) -> Result<SyncReport> {
    let (settings, entries, days) = state.with(|store| {
        let days: BTreeSet<String> = if full {
            store
                .entries
                .iter()
                .filter(|entry| entry.end.is_some())
                .map(|entry| time::local_day(&entry.start))
                .collect::<Result<_>>()?
        } else {
            store.dirty_days.clone()
        };
        Ok((store.settings.clone(), store.entries.clone(), days))
    })?;

    if settings.webdav_url.trim().is_empty() {
        return Err(AppError::NotConfigured);
    }
    if days.is_empty() {
        return Ok(SyncReport {
            files: 0,
            days: 0,
            at: settings
                .last_sync
                .clone()
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        });
    }

    let plan = sync::plan(&entries, &days, &settings.file_layout)?;
    // The lock is released for the duration of the network round trips, so the
    // UI stays responsive and a timer can be started mid-sync.
    let report = sync::push(&settings, plan).await?;

    state.with(|store| {
        for day in &days {
            store.dirty_days.remove(day);
        }
        store.settings.last_sync = Some(report.at.clone());
        store.save()
    })?;

    Ok(report)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::load(&dir.join("tempo.json"))?;
            app.manage(AppState {
                store: Mutex::new(store),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            start_timer,
            stop_timer,
            discard_timer,
            save_entry,
            delete_entry,
            delete_project,
            save_settings,
            test_connection,
            sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tempo");
}
