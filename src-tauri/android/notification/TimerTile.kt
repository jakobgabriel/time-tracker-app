package com.jakobgabriel.tempo

import android.content.Context
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

/**
 * A quick-settings tile that shows whether a timer is running and opens the
 * app when tapped.
 *
 * It deliberately does not start or stop anything by itself: the tile can be
 * tapped while the app is not running, and a tile that guesses which project
 * to start would be worse than one that simply takes you there.
 */
@RequiresApi(Build.VERSION_CODES.N)
class TimerTile : TileService() {

    companion object {
        @Volatile
        private var running = false

        fun refresh(context: Context, running: Boolean) {
            this.running = running
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                requestListeningState(
                    context,
                    android.content.ComponentName(context, TimerTile::class.java),
                )
            }
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = if (running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = if (running) "Tempo — running" else "Tempo"
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        val open = packageManager.getLaunchIntentForPackage(packageName) ?: return
        open.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(
                android.app.PendingIntent.getActivity(
                    this,
                    0,
                    open,
                    android.app.PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(open)
        }
    }
}
