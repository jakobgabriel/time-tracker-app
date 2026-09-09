// Installed into the generated Android project by
// scripts/configure-android-notification.mjs. See that script for why this
// lives here rather than in src-tauri/gen, which is not checked in.
package com.jakobgabriel.tempo

import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ShowArgs {
    lateinit var project: String

    /** Unix milliseconds; the notification counts up from here. */
    var startedAt: Long = 0
}

/**
 * The bridge Rust calls. It does nothing but start and stop the foreground
 * service — all the state lives in the Rust store, and the notification is
 * only ever a view of it.
 */
@TauriPlugin
class NotifyPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun show(invoke: Invoke) {
        val args = invoke.parseArgs(ShowArgs::class.java)
        val intent = Intent(activity, TimerService::class.java).apply {
            action = TimerService.ACTION_SHOW
            putExtra(TimerService.EXTRA_PROJECT, args.project)
            putExtra(TimerService.EXTRA_STARTED_AT, args.startedAt)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
        invoke.resolve()
    }

    @Command
    fun hide(invoke: Invoke) {
        activity.stopService(Intent(activity, TimerService::class.java))
        TimerTile.refresh(activity, running = false)
        invoke.resolve()
    }
}
