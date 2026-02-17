package com.thisux.droidclaw.connection

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Foreground service for maintaining the WebSocket connection to the DroidClaw server.
 * Full implementation will be added in Task 9.
 */
class ConnectionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_NOT_STICKY
    }
}
