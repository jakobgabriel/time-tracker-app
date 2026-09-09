//! The ongoing notification, on Android.
//!
//! Everything here is a view of the store: the notification shows the entry
//! that is running and nothing else, and it is refreshed whenever that entry
//! changes. On every other platform these calls do nothing.
//!
//! **Unverified.** The Kotlin half (`src-tauri/android/notification`) has never
//! been compiled — this environment has no Android SDK and CI has not produced
//! an APK yet. Treat the first real build as the start of debugging this, not
//! as a regression.

use crate::models::Entry;

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::Runtime;

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowArgs {
    project: String,
    /// Unix milliseconds; Android counts up from it on its own.
    started_at: i64,
}

/// Mirrors whatever is running (or nothing) into the shade.
#[cfg(target_os = "android")]
pub fn update<R: Runtime>(handle: &PluginHandle<R>, running: Option<&Entry>) {
    let result = match running {
        Some(entry) => {
            let started_at = crate::time::parse(&entry.start)
                .map(|time| time.timestamp_millis())
                .unwrap_or_else(|_| chrono::Local::now().timestamp_millis());
            handle.run_mobile_plugin::<()>(
                "show",
                ShowArgs {
                    project: entry.project.clone(),
                    started_at,
                },
            )
        }
        None => handle.run_mobile_plugin::<()>("hide", ()),
    };

    // A notification that fails to appear must never take the timer with it.
    if let Err(error) = result {
        eprintln!("tempo: could not update the notification ({error})");
    }
}

#[cfg(not(target_os = "android"))]
pub fn update<R>(_handle: &R, _running: Option<&Entry>) {}
