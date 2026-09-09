package com.jakobgabriel.tempo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps a running timer visible in the notification shade, counting up.
 *
 * The action opens the app rather than claiming to stop the timer: the store
 * lives in Rust, and reaching it from a notification action needs the launch
 * intent plumbed through to the webview. That is the first thing to add once
 * there is a build to test against; until then the button says what it does.
 */
class TimerService : Service() {

    companion object {
        const val ACTION_SHOW = "com.jakobgabriel.tempo.SHOW"
        const val ACTION_STOP = "com.jakobgabriel.tempo.STOP"
        const val EXTRA_PROJECT = "project"
        const val EXTRA_STARTED_AT = "startedAt"

        private const val CHANNEL = "tempo.running"
        private const val NOTIFICATION_ID = 1
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_SHOW) {
            stopSelf()
            return START_NOT_STICKY
        }

        val project = intent.getStringExtra(EXTRA_PROJECT) ?: ""
        val startedAt = intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis())

        createChannel()
        startForeground(NOTIFICATION_ID, build(project, startedAt))
        TimerTile.refresh(this, running = true)
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL,
            "Running timer",
            NotificationManager.IMPORTANCE_LOW, // no sound; it is a status, not an alert
        ).apply {
            description = "Shows the timer that is currently running"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun build(project: String, startedAt: Long): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val stop = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            action = ACTION_STOP
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle(project.ifBlank { "Tracking" })
            .setUsesChronometer(true) // the system ticks it; we never update it
            .setWhen(startedAt)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, immutable))
            .addAction(
                android.R.drawable.ic_media_pause,
                "Open Tempo",
                PendingIntent.getActivity(this, 1, stop, immutable),
            )
            .build()
    }
}
