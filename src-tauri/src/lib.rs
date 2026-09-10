pub mod backup;
pub mod csv;
pub mod error;
pub mod invoice;
pub mod markdown;
pub mod models;
pub mod notify;
pub mod paths;
pub mod store;
pub mod sync;
pub mod time;
pub mod webdav;

use std::collections::{BTreeMap, BTreeSet};
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

/// Remembers a project before anything has been tracked on it — what the
/// first-run guide needs so the dial has something to start.
#[tauri::command]
fn add_project(state: State<'_, AppState>, name: String) -> Result<Snapshot> {
    state.with(|store| {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("a project needs a name".into()));
        }
        store.touch_project(name);
        store.save()?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn set_auto_tags(
    state: State<'_, AppState>,
    project: String,
    tags: Vec<String>,
) -> Result<Snapshot> {
    state.with(|store| {
        store.set_auto_tags(&project, tags)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn set_target(state: State<'_, AppState>, project: String, minutes: u32) -> Result<Snapshot> {
    state.with(|store| {
        store.set_target(&project, minutes)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn bulk_edit(
    state: State<'_, AppState>,
    ids: Vec<String>,
    project: Option<String>,
    add_tags: Vec<String>,
) -> Result<Snapshot> {
    state.with(|store| {
        store.bulk_edit(&ids, project.clone(), add_tags.clone())?;
        Ok(store.snapshot())
    })
}

/// Writes `<folder>/Invoices/<month>.md` — the billing summary for one month.
#[tauri::command]
async fn write_invoice(state: State<'_, AppState>, month: String) -> Result<String> {
    let (settings, entries, rates) = state.with(|store| {
        Ok((
            store.settings.clone(),
            store.entries.clone(),
            store.project_rates.clone(),
        ))
    })?;

    let block = invoice::render(
        &entries,
        &month,
        settings.round_minutes,
        &rates,
        &settings.currency,
    )?;

    let dav = webdav::Dav::from_settings(&settings)?;
    let path = vault_path(&settings, &format!("Invoices/{month}.md"));
    if let Some(folder) = paths::parent(&path) {
        dav.ensure_folder(&folder).await?;
    }
    let existing = dav.get(&path).await?;
    let merged = markdown::merge(existing.as_deref(), &block, &month, &settings.note_tag);
    dav.put(&path, merged).await?;

    Ok(format!("Wrote Invoices/{month}.md"))
}

#[tauri::command]
fn toggle_pin(state: State<'_, AppState>, project: String) -> Result<Snapshot> {
    state.with(|store| {
        store.toggle_pin(&project)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn split_entry(state: State<'_, AppState>, id: String, at: String) -> Result<Snapshot> {
    state.with(|store| {
        store.split(&id, &at)?;
        Ok(store.snapshot())
    })
}

#[tauri::command]
fn merge_with_next(state: State<'_, AppState>, id: String) -> Result<Snapshot> {
    state.with(|store| {
        store.merge_with_next(&id)?;
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
async fn sync_now(state: State<'_, AppState>, full: bool, force: bool) -> Result<SyncReport> {
    let (settings, entries, projects, rates, deleted, days, synced) = state.with(|store| {
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
            store.deleted.clone(),
            days,
            store.synced.clone(),
        ))
    })?;

    if settings.webdav_url.trim().is_empty() {
        return Err(AppError::NotConfigured);
    }
    // Two-way: adopt whatever the other device left in the vault before
    // writing, so the notes reflect both of them rather than only this one.
    let mut pulled = 0;
    if settings.two_way_sync {
        if let Some(text) = webdav::Dav::from_settings(&settings)?
            .get(&vault_path(&settings, backup::FILE))
            .await?
        {
            let parsed = backup::parse(&text)?;
            pulled =
                state.with(|store| store.merge(parsed.entries, parsed.projects, parsed.deleted))?;
        }
    }

    let (entries, days) = if pulled > 0 {
        state.with(|store| Ok((store.entries.clone(), store.dirty_days.clone())))?
    } else {
        (entries, days)
    };

    if days.is_empty() {
        return Ok(SyncReport {
            files: 0,
            days: 0,
            conflicts: Vec::new(),
            at: settings
                .last_sync
                .clone()
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        });
    }

    // The ledger remembers what Tempo left in each note, so a block someone
    // has since edited in Obsidian is skipped rather than silently rewritten.
    let mut ledger = sync::Ledger::new(synced, force);

    let plan = sync::plan(&entries, &days, &settings.file_layout)?;
    // The lock is released for the duration of the network round trips, so the
    // UI stays responsive and a timer can be started mid-sync.
    let mut report = sync::push(&settings, plan, &rates, &mut ledger).await?;

    if settings.weekly_summary {
        let weekly = sync::weekly_plan(&entries, &days)?;
        report.files += sync::push_into(&settings, weekly, &rates, WEEKLY_FOLDER, &mut ledger)
            .await?
            .files;
    }

    if settings.project_notes {
        let plan = sync::project_plan(&entries, &days)?;
        report.files += sync::push_projects(&settings, plan, &rates, &mut ledger).await?;
    }
    report.conflicts = ledger.conflicts.clone();

    if settings.auto_backup {
        // Best effort: a failed backup must not lose the sync that succeeded.
        if let Err(error) = write_backup(&settings, &entries, &projects, &deleted).await {
            eprintln!("tempo: backup skipped ({error})");
        }
    }

    state.with(|store| {
        // A skipped note leaves its days unwritten, and the ledger knows note
        // paths rather than days — so nothing is cleared until the conflict is
        // resolved. Re-pushing a note that was already correct costs a request.
        if ledger.conflicts.is_empty() {
            for day in &days {
                store.dirty_days.remove(day);
            }
        }
        store.synced = ledger.known;
        store.conflicts = ledger.conflicts;
        store.settings.last_sync = Some(report.at.clone());
        store.save()
    })?;

    Ok(report)
}

/// Accepts the vault's version of every note the last sync flagged.
///
/// It records what is in those notes now as the new baseline, which stops the
/// warning without touching the vault. Tempo's block there is rewritten the
/// next time that day's entries actually change — the block is Tempo's, and
/// this only settles who was right about the edit that already happened.
#[tauri::command]
async fn keep_vault_version(state: State<'_, AppState>) -> Result<Snapshot> {
    let (settings, conflicts) =
        state.with(|store| Ok((store.settings.clone(), store.conflicts.clone())))?;

    let mut adopted: BTreeMap<String, String> = BTreeMap::new();
    if !conflicts.is_empty() {
        let dav = webdav::Dav::from_settings(&settings)?;
        for path in &conflicts {
            // A note that has since been deleted or emptied simply drops out.
            if let Some(block) = dav.get(path).await?.as_deref().and_then(markdown::extract) {
                adopted.insert(path.clone(), markdown::fingerprint(block));
            }
        }
    }

    state.with(|store| {
        store.synced.extend(adopted);
        store.conflicts.clear();
        store.save()?;
        Ok(store.snapshot())
    })
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

async fn write_backup(
    settings: &Settings,
    entries: &[Entry],
    projects: &[String],
    deleted: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    let dav = webdav::Dav::from_settings(settings)?;
    let folder = settings.vault_folder.trim().trim_matches('/').to_string();
    if !folder.is_empty() {
        dav.ensure_folder(&folder).await?;
    }
    let body = backup::render(
        entries,
        projects,
        deleted,
        &chrono::Local::now().to_rfc3339(),
    )?;
    dav.put(&vault_path(settings, backup::FILE), body).await
}

/// Writes the backup on demand — the same file a sync refreshes on its own.
#[tauri::command]
async fn backup_now(state: State<'_, AppState>) -> Result<String> {
    let (settings, entries, projects, deleted) = state.with(|store| {
        Ok((
            store.settings.clone(),
            store.entries.clone(),
            store.projects.clone(),
            store.deleted.clone(),
        ))
    })?;
    write_backup(&settings, &entries, &projects, &deleted).await?;
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
    let added = state.with(|store| store.merge(parsed.entries, parsed.projects, parsed.deleted))?;

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
    let added =
        state.with(|store| store.merge(entries, projects, std::collections::BTreeMap::new()))?;

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

/// Registers the Android half of the ongoing notification. On every other
/// platform this is an empty plugin that exists so the command below has
/// something to talk to.
fn notification_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("tempo-notify")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("com.jakobgabriel.tempo", "NotifyPlugin")?;
                _app.manage(handle);
            }
            Ok(())
        })
        .build()
}

/// Brings the notification in line with what is running. Called after every
/// change to the timer; a no-op away from Android.
#[tauri::command]
fn refresh_notification(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<()> {
    let running = state.with(|store| {
        Ok(store
            .entries
            .iter()
            .find(|entry| entry.end.is_none())
            .cloned())
    })?;

    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Some(handle) = app.try_state::<tauri::plugin::PluginHandle<tauri::Wry>>() {
            notify::update(&handle, running.as_ref());
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, running);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(notification_plugin())
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
            add_project,
            set_auto_tags,
            set_target,
            bulk_edit,
            write_invoice,
            toggle_pin,
            split_entry,
            merge_with_next,
            delete_project,
            save_settings,
            test_connection,
            sync_now,
            keep_vault_version,
            refresh_notification,
            export_csv,
            import_csv,
            backup_now,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tempo");
}
