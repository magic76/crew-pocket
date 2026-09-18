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
import org.json.JSONObject
import java.io.File
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
        private const val RETRY_COOLDOWN_MS = 20_000L
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val bootstrapExecutor = Executors.newSingleThreadExecutor()
    private val selfDebugExecutor = Executors.newSingleThreadExecutor()
    private val monitorStarted = AtomicBoolean(false)

    private lateinit var embeddedCodexBridge: EmbeddedCodexBridge
    private lateinit var embeddedNodeHost: EmbeddedNodeHost
    private lateinit var bridgeToken: String
    private lateinit var historyMigrationToken: String

    @Volatile private var hostMode = "initializing"
    @Volatile private var lastFailedFingerprint: String? = null
    @Volatile private var lastNodeExitCode: Int? = null
    @Volatile private var lastAutoDebugFingerprint: String? = null
    @Volatile private var lastRetryAt = 0L
    @Volatile private var crashCount = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        promoteToForeground("Crew runtime starting…")
        setEmbeddedReady(false)
        setHostMode("initializing")

        val preferences = getSharedPreferences("crew_runtime", MODE_PRIVATE)
        bridgeToken = preferences.getString("embedded_bridge_token", null)
            ?: EmbeddedCodexBridge.generateToken().also {
                preferences.edit().putString("embedded_bridge_token", it).apply()
            }

        historyMigrationToken = preferences.getString("history_migration_token", null)
            ?: EmbeddedCodexBridge.generateToken().also {
                preferences.edit().putString("history_migration_token", it).apply()
            }

        writePrivateBridgeToken(bridgeToken)
        TermuxBridge.provisionEmbeddedBridgeToken(this, bridgeToken)
            .onFailure { Log.i(TAG, "Could not provision bridge token to Termux: ${it.message}") }

        discardLegacyMigratedAuth(preferences)
        embeddedCodexBridge = EmbeddedCodexBridge(this, bridgeToken)
        embeddedNodeHost = EmbeddedNodeHost(this) { exitCode ->
            lastNodeExitCode = exitCode
            Log.w(TAG, "Embedded Node exited with code $exitCode")
        }

        prepareEmbeddedRuntime()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                updateNotification("Stopping Crew runtime…")
                if (::embeddedNodeHost.isInitialized) embeddedNodeHost.shutdown()
                if (::embeddedCodexBridge.isInitialized) embeddedCodexBridge.stop()
                setEmbeddedReady(false)
                setHostMode("stopped")
                RuntimeManager.fallbackHost.stopCrewHost(this)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_REFRESH_EMBEDDED -> prepareEmbeddedRuntime()
            ACTION_RESTART_EMBEDDED -> bootstrapExecutor.execute {
                forceRestartEmbedded()
            }
        }

        startMonitorIfNeeded()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scheduler.shutdownNow()
        bootstrapExecutor.shutdownNow()
        selfDebugExecutor.shutdownNow()
        if (::embeddedNodeHost.isInitialized) embeddedNodeHost.shutdown()
        if (::embeddedCodexBridge.isInitialized) embeddedCodexBridge.stop()
        setEmbeddedReady(false)
        super.onDestroy()
    }

    private fun prepareEmbeddedRuntime() {
        bootstrapExecutor.execute {
            val workspaceResult = EmbeddedWorkspaceManager.ensureWorkspace(this)
            if (workspaceResult.isFailure) {
                setEmbeddedReady(false)
                setHostMode("degraded")
                Log.w(TAG, "Embedded workspace unavailable", workspaceResult.exceptionOrNull())
                activateTermuxFallback(
                    EmbeddedWorkspaceManager.workspaceDir(this),
                    "workspace bootstrap failed"
                )
                return@execute
            }

            val workspace = workspaceResult.getOrThrow()
            if (!EmbeddedCodexBridge.isBinaryBundled(this)) {
                setEmbeddedReady(false)
                activateTermuxFallback(workspace, "embedded Codex binary not bundled")
                return@execute
            }

            embeddedCodexBridge.start()
                .onFailure {
                    setEmbeddedReady(false)
                    Log.w(TAG, "Embedded Codex unavailable", it)
                    activateTermuxFallback(workspace, "embedded Codex failed: ${it.message}")
                    return@execute
                }

            setEmbeddedReady(true)
            if (!EmbeddedNodeHost.isBinaryBundled(this)) {
                activateTermuxFallback(workspace, "embedded Node binary not bundled")
                return@execute
            }

            val preferences = getSharedPreferences("crew_runtime", MODE_PRIVATE)
            if (!preferences.getBoolean("embedded_history_migrated", false)) {
                migrateExistingHistory(workspace)
                return@execute
            }

            // History is safely present in the APK now, but the embedded
            // provider runtime is not enabled until its independent provider
            // login/toolchain migration is complete. Keep normal chat on the
            // proven Termux host instead of accepting messages without reply.
            if (!preferences.getBoolean("embedded_runtime_enabled", false)) {
                activateTermuxFallback(workspace, "embedded provider migration is pending")
                return@execute
            }

            attemptEmbeddedTakeover(workspace, force = true)
        }
    }

    private fun migrateExistingHistory(workspace: File) {
        setHostMode("migrating-history")
        updateNotification("Migrating existing Crew history…")

        if (serverAlive()) {
            RuntimeManager.fallbackHost.stopCrewHost(this)
            waitForServerDown(10_000)
        }
        if (serverAlive()) {
            activateTermuxFallback(workspace, "could not release Termux host for history migration")
            return
        }

        embeddedNodeHost.start(workspace, bridgeToken, historyMigrationToken)
            .onFailure {
                activateTermuxFallback(workspace, "embedded host could not start history migration: ${it.message}")
                return
            }
        if (!waitForEmbeddedHealthy()) {
            embeddedNodeHost.stop()
            activateTermuxFallback(workspace, "embedded host did not become ready for history migration")
            return
        }

        TermuxBridge.migrateExistingHistory(this, historyMigrationToken)
            .onFailure {
                embeddedNodeHost.stop()
                activateTermuxFallback(workspace, "could not request history migration: ${it.message}")
                return
            }

        repeat(180) {
            Thread.sleep(1_000)
            when (historyMigrationStatus()) {
                "complete" -> {
                    getSharedPreferences("crew_runtime", MODE_PRIVATE).edit()
                        .putBoolean("embedded_history_migrated", true)
                        .apply()
                    setHostMode("embedded-node")
                    updateNotification("Crew runtime active · embedded Node + migrated history")
                    Log.i(TAG, "Existing history migration completed")
                    return
                }
                "failed" -> {
                    embeddedNodeHost.stop()
                    activateTermuxFallback(workspace, "history migration failed")
                    return
                }
            }
        }

        embeddedNodeHost.stop()
        activateTermuxFallback(workspace, "history migration timed out")
    }

    private fun historyMigrationStatus(): String? = runCatching {
        val connection = URL("http://127.0.0.1:8000/api/runtime/history-migration")
            .openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 1_000
        connection.readTimeout = 2_000
        connection.setRequestProperty("X-Crew-History-Import-Token", historyMigrationToken)
        try {
            if (connection.responseCode !in 200..299) return@runCatching null
            connection.inputStream.bufferedReader().use { reader ->
                JSONObject(reader.readText()).optString("status", "")
            }
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    private fun forceRestartEmbedded() {
        if (!getSharedPreferences("crew_runtime", MODE_PRIVATE)
                .getBoolean("embedded_history_migrated", false)) {
            prepareEmbeddedRuntime()
            return
        }

        val workspaceResult = EmbeddedWorkspaceManager.ensureWorkspace(this)
        if (workspaceResult.isFailure) {
            activateTermuxFallback(
                EmbeddedWorkspaceManager.workspaceDir(this),
                "workspace unavailable during manual restart"
            )
            return
        }

        val workspace = workspaceResult.getOrThrow()
        lastFailedFingerprint = null

        if (!embeddedCodexBridge.isRunning()) {
            embeddedCodexBridge.start()
                .onFailure {
                    activateTermuxFallback(workspace, "embedded Codex restart failed: ${it.message}")
                    return
                }
        }

        setEmbeddedReady(true)
        attemptEmbeddedTakeover(workspace, force = true)
    }

    private fun attemptEmbeddedTakeover(workspace: File, force: Boolean): Boolean {
        if (!EmbeddedNodeHost.isBinaryBundled(this)) return false
        if (!embeddedCodexBridge.isRunning()) return false

        val fingerprint = embeddedNodeHost.sourceFingerprint(workspace)
        if (!force && lastFailedFingerprint != null && fingerprint == lastFailedFingerprint) {
            return false
        }

        setHostMode("testing-embedded")
        updateNotification("Testing embedded Crew host…")

        if (!embeddedNodeHost.isRunning() && serverAlive()) {
            RuntimeManager.fallbackHost.stopCrewHost(this)
            waitForServerDown(10_000)
        }

        if (serverAlive() && !embeddedNodeHost.isRunning()) {
            lastFailedFingerprint = fingerprint
            activateTermuxFallback(workspace, "port 8000 is still owned by fallback host")
            return false
        }

        val start = embeddedNodeHost.start(workspace, bridgeToken)
        if (start.isFailure) {
            lastFailedFingerprint = fingerprint
            crashCount += 1
            activateTermuxFallback(
                workspace,
                "embedded Node start failed: ${start.exceptionOrNull()?.message}"
            )
            return false
        }

        if (waitForEmbeddedHealthy()) {
            lastFailedFingerprint = null
            lastAutoDebugFingerprint = null
            lastNodeExitCode = null
            setHostMode("embedded-node")
            embeddedNodeHost.writeState(
                workspace,
                status = "healthy",
                exitCode = null,
                detail = "Embedded Node owns localhost:8000",
                extra = mapOf(
                    "hostMode" to "embedded-node",
                    "crashCount" to crashCount,
                    "selfDebug" to "enabled"
                )
            )
            updateNotification("Crew runtime active · embedded Node + Codex")
            Log.i(TAG, "Embedded Node takeover succeeded")
            return true
        }

        embeddedNodeHost.stop()
        lastFailedFingerprint = fingerprint
        crashCount += 1
        activateTermuxFallback(
            workspace,
            "embedded Node failed health check; exit=${lastNodeExitCode ?: "unknown"}"
        )
        return false
    }

    private fun activateTermuxFallback(workspace: File, reason: String) {
        if (::embeddedNodeHost.isInitialized && embeddedNodeHost.isRunning()) {
            embeddedNodeHost.stop()
        }

        setHostMode("termux-fallback")
        embeddedNodeHost.writeState(
            workspace,
            status = "fallback",
            exitCode = lastNodeExitCode,
            detail = reason,
            extra = mapOf(
                "hostMode" to "termux-fallback",
                "crashCount" to crashCount,
                "waitingForSourceChange" to (lastFailedFingerprint != null)
            )
        )

        if (!serverAlive()) {
            RuntimeManager.fallbackHost.startCrewHost(this)
                .onFailure {
                    setHostMode("degraded")
                    Log.w(TAG, "Termux fallback unavailable", it)
                    updateNotification("Crew runtime unavailable · ${it.message}")
                    return
                }
        }

        updateNotification("Crew runtime · Termux rescue host · embedded Codex")
        Log.w(TAG, "Using Termux fallback: $reason")
        maybeRequestAutonomousSelfDebug(workspace, reason)
    }

    private fun maybeRequestAutonomousSelfDebug(workspace: File, reason: String) {
        val fingerprint = lastFailedFingerprint ?: return
        if (!EmbeddedNodeHost.isBinaryBundled(this)) return
        if (!embeddedCodexBridge.isRunning()) return
        if (lastAutoDebugFingerprint == fingerprint) return

        lastAutoDebugFingerprint = fingerprint
        selfDebugExecutor.execute {
            var ready = false
            repeat(24) {
                if (serverAlive()) {
                    ready = true
                    return@repeat
                }
                Thread.sleep(500)
            }

            if (!ready) {
                if (lastAutoDebugFingerprint == fingerprint) lastAutoDebugFingerprint = null
                Log.w(TAG, "Rescue host did not become ready for autonomous self-debug")
                return@execute
            }

            runCatching {
                val connection = URL("http://127.0.0.1:8000/api/runtime/self-debug")
                    .openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 2_000
                connection.readTimeout = 5_000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")

                val payload = JSONObject()
                    .put("reason", reason)
                    .put("sourceFingerprint", fingerprint)
                    .toString()

                connection.outputStream.use { output ->
                    output.write(payload.toByteArray(Charsets.UTF_8))
                }

                val code = connection.responseCode
                if (code !in 200..299) {
                    throw IllegalStateException("Self-debug endpoint returned HTTP $code")
                }
                connection.inputStream.close()
                connection.disconnect()

                embeddedNodeHost.writeState(
                    workspace,
                    status = "self-debug-requested",
                    exitCode = lastNodeExitCode,
                    detail = "Autonomous Codex repair requested through rescue host",
                    extra = mapOf(
                        "hostMode" to "termux-fallback",
                        "failureReason" to reason,
                        "sourceFingerprint" to fingerprint
                    )
                )
                Log.i(TAG, "Autonomous Codex self-debug requested")
            }.onFailure {
                if (lastAutoDebugFingerprint == fingerprint) lastAutoDebugFingerprint = null
                Log.w(TAG, "Could not request autonomous self-debug", it)
            }
        }
    }

    private fun startMonitorIfNeeded() {
        if (!monitorStarted.compareAndSet(false, true)) return
        scheduler.scheduleWithFixedDelay(
            { checkAndRecover() },
            4,
            8,
            TimeUnit.SECONDS
        )
    }

    private fun checkAndRecover() {
        val workspace = EmbeddedWorkspaceManager.workspaceDir(this)

        if (hostMode == "embedded-node") {
            if (embeddedNodeHost.isRunning() && serverAlive()) {
                updateNotification("Crew runtime active · embedded Node + Codex")
                return
            }

            lastFailedFingerprint = embeddedNodeHost.sourceFingerprint(workspace)
            crashCount += 1
            activateTermuxFallback(
                workspace,
                "embedded Node exited or stopped responding; exit=${lastNodeExitCode ?: "unknown"}"
            )
            return
        }

        if (
            hostMode == "termux-fallback" &&
            EmbeddedNodeHost.isBinaryBundled(this) &&
            embeddedCodexBridge.isRunning() &&
            EmbeddedWorkspaceManager.isReady(this)
        ) {
            val currentFingerprint = embeddedNodeHost.sourceFingerprint(workspace)
            val failedFingerprint = lastFailedFingerprint
            if (
                failedFingerprint != null &&
                currentFingerprint != failedFingerprint &&
                System.currentTimeMillis() - lastRetryAt >= RETRY_COOLDOWN_MS
            ) {
                lastRetryAt = System.currentTimeMillis()
                Log.i(TAG, "Workspace changed after failure; retrying embedded Node")
                attemptEmbeddedTakeover(workspace, force = true)
                return
            }
        }

        if (!serverAlive()) {
            if (System.currentTimeMillis() - lastRetryAt >= RETRY_COOLDOWN_MS) {
                lastRetryAt = System.currentTimeMillis()
                RuntimeManager.fallbackHost.startCrewHost(this)
                    .onFailure {
                        setHostMode("degraded")
                        updateNotification("Crew runtime unavailable · ${it.message}")
                    }
            }
        } else if (hostMode == "termux-fallback") {
            updateNotification("Crew runtime · Termux rescue host · embedded Codex")
        }
    }

    private fun waitForEmbeddedHealthy(): Boolean {
        repeat(20) {
            if (!embeddedNodeHost.isRunning()) return false
            if (serverAlive()) return true
            Thread.sleep(300)
        }
        return false
    }

    private fun waitForServerDown(timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (!serverAlive()) return
            Thread.sleep(100)
        }
    }

    private fun writePrivateBridgeToken(token: String) {
        runCatching {
            val dir = File(filesDir, ".crew-pocket")
            dir.mkdirs()
            File(dir, "embedded-bridge-token").writeText(token + "\n")
        }.onFailure {
            Log.w(TAG, "Could not write APK bridge token", it)
        }
    }

    private fun setEmbeddedReady(ready: Boolean) {
        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putBoolean("embedded_ready", ready)
            .apply()
    }

    private fun setHostMode(mode: String) {
        hostMode = mode
        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putString("host_mode", mode)
            .apply()
    }

    private fun discardLegacyMigratedAuth(
        preferences: android.content.SharedPreferences
    ) {
        if (preferences.getBoolean("embedded_managed_auth_v2", false)) return

        val codexHome = File(filesDir, ".codex")
        val auth = File(codexHome, "auth.json")
        val temp = File(codexHome, "auth.json.tmp")
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

        val restartIntent = Intent(this, CrewRuntimeService::class.java)
            .setAction(ACTION_RESTART_EMBEDDED)
        val restartPendingIntent = PendingIntent.getService(
            this,
            3,
            restartIntent,
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
            .addAction(Notification.Action.Builder(null, "Retry Embedded", restartPendingIntent).build())
            .addAction(Notification.Action.Builder(null, "Stop", stopPendingIntent).build())
            .build()
    }
}
