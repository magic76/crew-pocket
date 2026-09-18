package com.crewpocket.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class CrewRuntimeService : Service() {
    companion object {
        const val ACTION_START = "com.crewpocket.app.action.START_RUNTIME"
        const val ACTION_STOP = "com.crewpocket.app.action.STOP_RUNTIME"
        const val ACTION_REFRESH_EMBEDDED = "com.crewpocket.app.action.REFRESH_EMBEDDED"
        const val ACTION_RESTART_EMBEDDED = "com.crewpocket.app.action.RESTART_EMBEDDED"

        private const val TAG = "CrewRuntimeService"
        private const val CHANNEL_ID = "crew_runtime"
        private const val NOTIFICATION_ID = 7601
        private const val SERVER_URL = "http://127.0.0.1:8000/"
        private const val RESTART_COOLDOWN_MS = 20_000L
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val monitorStarted = AtomicBoolean(false)
    @Volatile private var lastRestartAt = 0L

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        promoteToForeground("Crew runtime starting…")

        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putBoolean("embedded_runtime_enabled", false)
            .putBoolean("embedded_ready", false)
            .putString("host_mode", "termux-runtime")
            .apply()

        ensureTermuxRuntime("service start")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                updateNotification("Stopping Crew runtime…")
                RuntimeManager.fallbackHost.stopCrewHost(this)
                getSharedPreferences("crew_runtime", MODE_PRIVATE)
                    .edit()
                    .putString("host_mode", "stopped")
                    .apply()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_REFRESH_EMBEDDED,
            ACTION_RESTART_EMBEDDED -> restartTermuxRuntime()
            else -> ensureTermuxRuntime("start command")
        }

        startMonitorIfNeeded()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scheduler.shutdownNow()
        super.onDestroy()
    }

    private fun startMonitorIfNeeded() {
        if (!monitorStarted.compareAndSet(false, true)) return
        scheduler.scheduleWithFixedDelay({ checkAndRecover() }, 4, 10, TimeUnit.SECONDS)
    }

    private fun checkAndRecover() {
        if (serverAlive()) {
            updateNotification("Crew runtime active · Termux engine")
            return
        }
        ensureTermuxRuntime("health check")
    }

    private fun restartTermuxRuntime() {
        scheduler.execute {
            updateNotification("Restarting Crew Termux runtime…")
            RuntimeManager.fallbackHost.stopCrewHost(this)
            repeat(15) {
                if (!serverAlive()) return@repeat
                Thread.sleep(200)
            }
            lastRestartAt = 0L
            ensureTermuxRuntime("manual restart")
        }
    }

    private fun ensureTermuxRuntime(reason: String) {
        if (serverAlive()) {
            updateNotification("Crew runtime active · Termux engine")
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastRestartAt < RESTART_COOLDOWN_MS) return
        lastRestartAt = now

        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putString("host_mode", "termux-runtime")
            .apply()

        RuntimeManager.fallbackHost.startCrewHost(this)
            .onSuccess {
                Log.i(TAG, "Requested Termux runtime start: $reason")
                updateNotification("Starting Crew Termux runtime…")
            }
            .onFailure { error ->
                Log.w(TAG, "Termux runtime start failed: $reason", error)
                updateNotification("Crew runtime unavailable · ${error.message}")
            }
    }

    private fun serverAlive(): Boolean {
        return try {
            val connection = URL(SERVER_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1_000
            connection.readTimeout = 1_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            try {
                connection.responseCode in 200..399
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Crew Runtime",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps the Termux-backed Crew Pocket runtime available."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun promoteToForeground(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openPendingIntent = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val restartPendingIntent = PendingIntent.getService(
            this, 2,
            Intent(this, CrewRuntimeService::class.java).setAction(ACTION_RESTART_EMBEDDED),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopPendingIntent = PendingIntent.getService(
            this, 3,
            Intent(this, CrewRuntimeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("Crew Pocket")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Restart", restartPendingIntent).build())
            .addAction(Notification.Action.Builder(null, "Stop", stopPendingIntent).build())
            .build()
    }
}
