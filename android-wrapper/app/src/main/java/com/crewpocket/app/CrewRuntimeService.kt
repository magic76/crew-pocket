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

        private const val TAG = "CrewRuntimeService"
        private const val CHANNEL_ID = "crew_runtime"
        private const val NOTIFICATION_ID = 7601
        private const val SERVER_URL = "http://127.0.0.1:8000/"
        private const val RESTART_COOLDOWN_MS = 30_000L
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val bootstrapExecutor = Executors.newSingleThreadExecutor()
    private val monitorStarted = AtomicBoolean(false)
    private lateinit var embeddedCodexBridge: EmbeddedCodexBridge
    @Volatile private var lastRestartAttemptAt = 0L
    @Volatile private var consecutiveFailures = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        promoteToForeground("Crew runtime starting…")
        setEmbeddedReady(false)

        val preferences = getSharedPreferences("crew_runtime", MODE_PRIVATE)
        val bridgeToken = preferences.getString("embedded_bridge_token", null)
            ?: EmbeddedCodexBridge.generateToken().also {
                preferences.edit().putString("embedded_bridge_token", it).apply()
            }

        TermuxBridge.provisionEmbeddedBridgeToken(this, bridgeToken)
            .onFailure { Log.i(TAG, "Could not provision bridge token: ${it.message}") }

        discardLegacyMigratedAuth(preferences)
        embeddedCodexBridge = EmbeddedCodexBridge(this, bridgeToken)
        prepareEmbeddedRuntime()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                updateNotification("Stopping Crew runtime…")
                if (::embeddedCodexBridge.isInitialized) embeddedCodexBridge.stop()
                setEmbeddedReady(false)
                RuntimeManager.crewHost.stopCrewHost(this)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_REFRESH_EMBEDDED -> prepareEmbeddedRuntime()
        }

        startMonitorIfNeeded()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scheduler.shutdownNow()
        bootstrapExecutor.shutdownNow()
        if (::embeddedCodexBridge.isInitialized) embeddedCodexBridge.stop()
        setEmbeddedReady(false)
        super.onDestroy()
    }

    private fun prepareEmbeddedRuntime() {
        bootstrapExecutor.execute {
            if (!EmbeddedCodexBridge.isBinaryBundled(this)) {
                setEmbeddedReady(false)
                Log.i(TAG, "Embedded Codex binary is not bundled; keeping Termux fallback")
                updateNotification("Crew runtime · Termux Codex fallback")
                return@execute
            }

            updateNotification("Preparing embedded Codex workspace…")
            val workspace = EmbeddedWorkspaceManager.ensureWorkspace(this)
            if (workspace.isFailure) {
                setEmbeddedReady(false)
                Log.w(TAG, "Embedded workspace unavailable", workspace.exceptionOrNull())
                updateNotification("Crew runtime · workspace bootstrap failed · Termux fallback")
                return@execute
            }

            embeddedCodexBridge.start()
                .onSuccess {
                    setEmbeddedReady(true)
                    Log.i(TAG, "Embedded Codex transport ready with APK workspace")
                    updateNotification("Crew runtime active · embedded Codex")
                }
                .onFailure {
                    setEmbeddedReady(false)
                    Log.w(TAG, "Embedded Codex unavailable", it)
                    updateNotification("Crew runtime · embedded Codex failed · Termux fallback")
                }
        }
    }

    private fun setEmbeddedReady(ready: Boolean) {
        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putBoolean("embedded_ready", ready)
            .apply()
    }

    private fun discardLegacyMigratedAuth(
        preferences: android.content.SharedPreferences
    ) {
        if (preferences.getBoolean("embedded_managed_auth_v2", false)) return

        val codexHome = java.io.File(filesDir, ".codex")
        val auth = java.io.File(codexHome, "auth.json")
        val temp = java.io.File(codexHome, "auth.json.tmp")
        if (auth.exists()) {
            if (auth.delete()) {
                Log.i(TAG, "Removed legacy copied Codex auth; embedded login will own credentials")
            } else {
                Log.w(TAG, "Could not remove legacy copied Codex auth")
            }
        }
        temp.delete()
        preferences.edit().putBoolean("embedded_managed_auth_v2", true).apply()
    }

    private fun startMonitorIfNeeded() {
        if (!monitorStarted.compareAndSet(false, true)) return
        scheduler.scheduleWithFixedDelay(
            { checkAndRecover() },
            0,
            12,
            TimeUnit.SECONDS
        )
    }

    private fun checkAndRecover() {
        if (serverAlive()) {
            consecutiveFailures = 0
            val codexMode = if (::embeddedCodexBridge.isInitialized && embeddedCodexBridge.isRunning()) {
                "embedded Codex"
            } else {
                "Termux Codex fallback"
            }
            updateNotification("Crew runtime active · $codexMode")
            return
        }

        consecutiveFailures += 1
        val now = System.currentTimeMillis()
        if (now - lastRestartAttemptAt >= RESTART_COOLDOWN_MS) {
            lastRestartAttemptAt = now
            val result = RuntimeManager.crewHost.startCrewHost(this)
            if (result.isSuccess) {
                updateNotification("Crew runtime reconnecting through Termux…")
            } else {
                updateNotification(
                    result.exceptionOrNull()?.message
                        ?: "Crew runtime unavailable · check Termux setup"
                )
            }
        } else if (consecutiveFailures >= 2) {
            updateNotification("Crew runtime unavailable · waiting to retry")
        }
    }

    private fun serverAlive(): Boolean {
        return try {
            val connection = URL(SERVER_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1500
            connection.readTimeout = 1500
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
            description = "Keeps the local Crew Pocket runtime observable while it is active."
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
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val openPendingIntent = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, CrewRuntimeService::class.java).setAction(ACTION_STOP)
        val stopPendingIntent = PendingIntent.getService(
            this,
            2,
            stopIntent,
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
            .addAction(
                Notification.Action.Builder(
                    null,
                    "Stop",
                    stopPendingIntent
                ).build()
            )
            .build()
    }
}
