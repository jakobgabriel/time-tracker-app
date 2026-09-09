pub mod backup;
pub mod csv;
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
fn rename_project(state: State<'_, AppState>, from: String, to: String) -> Result<Snapshot> {
    state.with(|store| {
        store.rename_project(&from, &to)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn set_rate(state: State<'_, AppState>, project: String, rate: f64) -> Result<Snapshot> {
    state.with(|store| {
        store.set_rate(&project, rate)?;
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
    let (settings, entries, projects, rates, days) = state.with(|store| {
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
        Ok((
            store.settings.clone(),
            store.entries.clone(),
            store.projects.clone(),
            store.project_rates.clone(),
            days,
        ))
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
    let mut report = sync::push(&settings, plan, &rates).await?;

    if settings.weekly_summary {
        let weekly = sync::weekly_plan(&entries, &days)?;
        report.files += sync::push_into(&settings, weekly, &rates, WEEKLY_FOLDER)
            .await?
            .files;
    }

    if settings.auto_backup {
        // Best effort: a failed backup must not lose the sync that succeeded.
        if let Err(error) = write_backup(&settings, &entries, &projects).await {
            eprintln!("tempo: backup skipped ({error})");
        }
    }

    state.with(|store| {
        for day in &days {
            store.dirty_days.remove(day);
        }
        store.settings.last_sync = Some(report.at.clone());
        store.save()
    })?;

    Ok(report)
}

/// The vault subfolder the weekly roll-ups live in.
const WEEKLY_FOLDER: &str = "Weekly";

fn vault_path(settings: &Settings, name: &str) -> String {
    let folder = settings.vault_folder.trim().trim_matches('/');
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

async fn write_backup(settings: &Settings, entries: &[Entry], projects: &[String]) -> Result<()> {
    let dav = webdav::Dav::from_settings(settings)?;
    let folder = settings.vault_folder.trim().trim_matches('/').to_string();
    if !folder.is_empty() {
        dav.ensure_folder(&folder).await?;
    }
    let body = backup::render(entries, projects, &chrono::Local::now().to_rfc3339())?;
    dav.put(&vault_path(settings, backup::FILE), body).await
}

/// Writes the backup on demand — the same file a sync refreshes on its own.
#[tauri::command]
async fn backup_now(state: State<'_, AppState>) -> Result<String> {
    let (settings, entries, projects) = state.with(|store| {
        Ok((
            store.settings.clone(),
            store.entries.clone(),
            store.projects.clone(),
        ))
    })?;
    write_backup(&settings, &entries, &projects).await?;
    Ok(format!(
        "Backed up {} entries to {}",
        entries.len(),
        backup::FILE
    ))
}

/// Merges the backup in the vault into this device. Additive: nothing already
/// here is overwritten, so restoring twice is harmless.
#[tauri::command]
async fn restore_backup(state: State<'_, AppState>) -> Result<String> {
    let settings = state.with(|store| Ok(store.settings.clone()))?;
    let dav = webdav::Dav::from_settings(&settings)?;

    let Some(text) = dav.get(&vault_path(&settings, backup::FILE)).await? else {
        return Err(AppError::Invalid(format!(
            "no {} in the vault yet — sync once to write one",
            backup::FILE
        )));
    };

    let parsed = backup::parse(&text)?;
    let found = parsed.entries.len();
    let added = state.with(|store| store.merge(parsed.entries, parsed.projects))?;

    Ok(match added {
        0 => format!("Backup holds {found} entries, all of them already here"),
        _ => format!("Restored {added} of {found} entries"),
    })
}

/// Reads `tempo-import.csv` from the vault and merges it in.
///
/// Times in a CSV carry no timezone, so they are read in the device's current
/// offset — the same one the export wrote them in.
#[tauri::command]
async fn import_csv(state: State<'_, AppState>) -> Result<String> {
    let settings = state.with(|store| Ok(store.settings.clone()))?;
    let dav = webdav::Dav::from_settings(&settings)?;
    let name = "tempo-import.csv";

    let Some(text) = dav.get(&vault_path(&settings, name)).await? else {
        return Err(AppError::Invalid(format!(
            "no {name} in the vault — put one next to your notes first"
        )));
    };

    let offset = chrono::Local::now().format("%:z").to_string();
    let (entries, skipped) = csv::parse(&text, &offset)?;
    let projects: Vec<String> = entries
        .iter()
        .map(|entry| entry.project.trim().to_string())
        .filter(|project| !project.is_empty())
        .collect();

    let found = entries.len();
    let added = state.with(|store| store.merge(entries, projects))?;

    let mut message = match added {
        0 if found == 0 => "Nothing in that file could be read".to_string(),
        0 => format!("All {found} entries were already here"),
        _ => format!("Imported {added} of {found} entries"),
    };
    if skipped > 0 {
        let rows = if skipped == 1 { "row" } else { "rows" };
        message.push_str(&format!(", skipped {skipped} unreadable {rows}"));
    }
    Ok(message)
}

/// Writes every closed entry to `tempo-export.csv` next to the notes — the
/// file an invoicing tool or a spreadsheet wants, regenerated on demand.
#[tauri::command]
async fn export_csv(state: State<'_, AppState>) -> Result<String> {
    let (settings, entries, rates) = state.with(|store| {
        Ok((
            store.settings.clone(),
            store.entries.clone(),
            store.project_rates.clone(),
        ))
    })?;

    let body = csv::render(&entries, settings.round_minutes, &rates)?;
    let rows = body.lines().count().saturating_sub(1);
    if rows == 0 {
        return Err(AppError::Invalid("there is nothing to export yet".into()));
    }

    let dav = webdav::Dav::from_settings(&settings)?;
    let folder = settings.vault_folder.trim().trim_matches('/').to_string();
    if !folder.is_empty() {
        dav.ensure_folder(&folder).await?;
    }
    let name = "tempo-export.csv";
    let path = if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    };
    dav.put(&path, body).await?;

    let plural = if rows == 1 { "entry" } else { "entries" };
    Ok(format!("Exported {rows} {plural} to {name}"))
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
            rename_project,
            set_rate,
            delete_project,
            save_settings,
            test_connection,
            sync_now,
            export_csv,
            import_csv,
            backup_now,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tempo");
}
