package com.crewpocket.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class CrewRuntimeService : Service() {
    companion object {
        const val ACTION_START = "com.crewpocket.app.action.START_RUNTIME"
        const val ACTION_STOP = "com.crewpocket.app.action.STOP_RUNTIME"
        const val ACTION_REFRESH_EMBEDDED = "com.crewpocket.app.action.REFRESH_EMBEDDED"
        const val ACTION_RESTART_EMBEDDED = "com.crewpocket.app.action.RESTART_EMBEDDED"
        const val ACTION_APP_FOREGROUND = "com.crewpocket.app.action.APP_FOREGROUND"
        const val ACTION_APP_BACKGROUND = "com.crewpocket.app.action.APP_BACKGROUND"
        const val EXTRA_OPEN_PROVIDER = "com.crewpocket.app.extra.OPEN_PROVIDER"
        const val EXTRA_OPEN_CONVERSATION_ID = "com.crewpocket.app.extra.OPEN_CONVERSATION_ID"
        const val EXTRA_OPEN_TASK_ID = "com.crewpocket.app.extra.OPEN_TASK_ID"

        private const val TAG = "CrewRuntimeService"
        private const val CHANNEL_ID = "crew_runtime"
        private const val TASK_CHANNEL_ID = "crew_tasks"
        private const val NOTIFICATION_ID = 7601
        private const val SERVER_HEALTH_URL = "http://127.0.0.1:8000/healthz"
        private const val SERVER_TASKS_URL = "http://127.0.0.1:8000/api/tasks?limit=80"
        private const val RESTART_COOLDOWN_MS = 20_000L
        private const val INITIAL_MONITOR_DELAY_SEC = 4L
        private const val HEALTHY_MIN_DELAY_SEC = 10L
        private const val HEALTHY_MAX_DELAY_SEC = 60L
        private const val FAILURE_MAX_DELAY_SEC = 10L
        private const val BACKGROUND_GRACE_SEC = 30L
        private const val BACKGROUND_TASK_POLL_SEC = 5L
        private const val BACKGROUND_TASK_MAX_WATCH_MS = 30L * 60L * 1000L
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val monitorStarted = AtomicBoolean(false)

    @Volatile private var lastRestartAt = 0L
    @Volatile private var healthyChecks = 0
    @Volatile private var failedChecks = 0
    @Volatile private var lastNotificationText: String? = null
    @Volatile private var appInForeground = true
    @Volatile private var backgroundStartedAt = 0L
    @Volatile private var sawRunningBackgroundTask = false
    private val notifiedTaskIds = mutableSetOf<String>()
    private var idleStopTask: ScheduledFuture<*>? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        promoteToForeground("Crew runtime starting…")

        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putBoolean("embedded_runtime_enabled", false)
            .putBoolean("embedded_ready", false)
            .putString("runtime_mode", "in-use")
            .putString("host_mode", "termux-runtime")
            .apply()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                cancelIdleStop()
                updateNotification("Stopping Crew runtime…")
                RuntimeManager.productionHost.stopCrewHost(this)
                getSharedPreferences("crew_runtime", MODE_PRIVATE)
                    .edit()
                    .putString("host_mode", "stopped")
                    .apply()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_APP_BACKGROUND -> {
                appInForeground = false
                backgroundStartedAt = System.currentTimeMillis()
                sawRunningBackgroundTask = false
                notifiedTaskIds.clear()
                scheduleIdleStop(0L)
                return START_NOT_STICKY
            }

            ACTION_APP_FOREGROUND,
            ACTION_START -> {
                appInForeground = true
                backgroundStartedAt = 0L
                sawRunningBackgroundTask = false
                cancelIdleStop()
                ensureTermuxRuntime("app foreground")
                startMonitorIfNeeded()
            }

            ACTION_REFRESH_EMBEDDED,
            ACTION_RESTART_EMBEDDED -> {
                appInForeground = true
                cancelIdleStop()
                restartTermuxRuntime()
                startMonitorIfNeeded()
            }

            else -> {
                appInForeground = true
                cancelIdleStop()
                ensureTermuxRuntime("start command")
                startMonitorIfNeeded()
            }
        }

        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        appInForeground = false
        if (backgroundStartedAt == 0L) backgroundStartedAt = System.currentTimeMillis()
        scheduleIdleStop(0L)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        cancelIdleStop()
        scheduler.shutdownNow()
        super.onDestroy()
    }

    private data class TaskSnapshot(
        val id: String,
        val status: String,
        val provider: String,
        val conversationId: String,
        val conversationTitle: String,
        val title: String,
        val updatedAt: Long
    )

    private fun scheduleIdleStop(delaySec: Long = BACKGROUND_GRACE_SEC) {
        cancelIdleStop()
        idleStopTask = scheduler.schedule(
            { backgroundTaskWatchTick() },
            delaySec,
            TimeUnit.SECONDS
        )
    }

    private fun backgroundTaskWatchTick() {
        if (appInForeground) return

        val now = System.currentTimeMillis()
        val elapsed = now - backgroundStartedAt
        val tasks = fetchTaskSnapshots()

        if (tasks != null) {
            val terminal = tasks.filter { task ->
                task.updatedAt >= backgroundStartedAt &&
                    task.status in setOf("completed", "failed") &&
                    !notifiedTaskIds.contains(task.id)
            }
            terminal.forEach { task ->
                notifiedTaskIds.add(task.id)
                showTaskCompletionNotification(task)
            }

            val hasRunning = tasks.any { it.status == "running" }
            if (hasRunning) sawRunningBackgroundTask = true

            if (hasRunning) {
                updateNotification("Crew AI background task running…")
                scheduleIdleStop(BACKGROUND_TASK_POLL_SEC)
                return
            }
        } else if (sawRunningBackgroundTask && elapsed < BACKGROUND_TASK_MAX_WATCH_MS) {
            // If the localhost runtime is briefly unavailable while a known task
            // was running, keep the watcher alive so a completion is not missed.
            scheduleIdleStop(BACKGROUND_TASK_POLL_SEC)
            return
        }

        if (elapsed < TimeUnit.SECONDS.toMillis(BACKGROUND_GRACE_SEC)) {
            scheduleIdleStop(BACKGROUND_TASK_POLL_SEC)
            return
        }

        stopBackgroundSupervisor()
    }

    private fun stopBackgroundSupervisor() {
        if (appInForeground) return
        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putString("host_mode", "termux-runtime-idle")
            .putLong("monitor_interval_ms", 0L)
            .apply()

        // The Termux Node runtime remains alive. The APK foreground supervisor
        // can stop once no background AI task still needs completion tracking.
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun fetchTaskSnapshots(): List<TaskSnapshot>? {
        return try {
            val connection = URL(SERVER_TASKS_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1_000
            connection.readTimeout = 1_000
            connection.useCaches = false
            try {
                if (connection.responseCode !in 200..299) return null
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val array = JSONObject(body).optJSONArray("tasks") ?: return emptyList()
                buildList {
                    for (index in 0 until array.length()) {
                        val task = array.optJSONObject(index) ?: continue
                        val id = task.optString("id").trim()
                        if (id.isBlank()) continue
                        add(
                            TaskSnapshot(
                                id = id,
                                status = task.optString("status").trim(),
                                provider = task.optString("provider", "antigravity").trim(),
                                conversationId = task.optString("conversationId").trim(),
                                conversationTitle = task.optString("conversationTitle").trim(),
                                title = task.optString("title", "AI 任務").trim(),
                                updatedAt = task.optLong("updatedAt", 0L)
                            )
                        )
                    }
                }
            } finally {
                connection.disconnect()
            }
        } catch (error: Exception) {
            Log.d(TAG, "Task watcher unavailable: ${error.message}")
            null
        }
    }

    private fun showTaskCompletionNotification(task: TaskSnapshot) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val conversationLabel = task.conversationTitle.ifBlank {
            if (task.conversationId.isNotBlank()) "對話 ${task.conversationId.take(8)}" else "未知對話"
        }
        val openIntent = Intent(this, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_PROVIDER, task.provider)
            .putExtra(EXTRA_OPEN_CONVERSATION_ID, task.conversationId)
            .putExtra(EXTRA_OPEN_TASK_ID, task.id)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPendingIntent = PendingIntent.getActivity(
            this,
            task.id.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (task.status == "completed") {
            "Crew 已完成 · $conversationLabel"
        } else {
            "Crew 任務失敗 · $conversationLabel"
        }
        val detail = task.title.ifBlank { if (task.status == "completed") "AI 任務已完成" else "AI 任務執行失敗" }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, TASK_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        try {
            getSystemService(NotificationManager::class.java).notify(
                10_000 + (task.id.hashCode() and 0x0fff),
                builder
                    .setContentTitle(title)
                    .setContentText(detail)
                    .setStyle(Notification.BigTextStyle().bigText("對話：$conversationLabel\n$detail"))
                    .setSmallIcon(
                        if (task.status == "completed") android.R.drawable.stat_sys_download_done
                        else android.R.drawable.stat_notify_error
                    )
                    .setContentIntent(openPendingIntent)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .build()
            )
        } catch (error: SecurityException) {
            Log.w(TAG, "Task completion notification blocked", error)
        }
    }

    private fun cancelIdleStop() {
        idleStopTask?.cancel(false)
        idleStopTask = null
    }

    private fun startMonitorIfNeeded() {
        if (!monitorStarted.compareAndSet(false, true)) return
        scheduleNextMonitor(INITIAL_MONITOR_DELAY_SEC)
    }

    private fun scheduleNextMonitor(delaySec: Long) {
        if (scheduler.isShutdown) return

        getSharedPreferences("crew_runtime", MODE_PRIVATE)
            .edit()
            .putLong("monitor_interval_ms", TimeUnit.SECONDS.toMillis(delaySec))
            .apply()

        scheduler.schedule(
            {
                val nextDelay = checkAndRecover()
                scheduleNextMonitor(nextDelay)
            },
            delaySec,
            TimeUnit.SECONDS
        )
    }

    private fun checkAndRecover(): Long {
        if (!appInForeground) {
            return HEALTHY_MAX_DELAY_SEC
        }

        if (serverAlive()) {
            failedChecks = 0
            healthyChecks += 1
            updateNotification("Crew runtime active · Termux engine")
            return healthyDelaySeconds(healthyChecks)
        }

        healthyChecks = 0
        failedChecks += 1
        ensureTermuxRuntime("health check")
        return failureDelaySeconds(failedChecks)
    }

    private fun healthyDelaySeconds(streak: Int): Long {
        return when {
            streak <= 1 -> HEALTHY_MIN_DELAY_SEC
            streak == 2 -> 20L
            streak == 3 -> 30L
            else -> HEALTHY_MAX_DELAY_SEC
        }
    }

    private fun failureDelaySeconds(streak: Int): Long {
        return when {
            streak <= 1 -> 1L
            streak == 2 -> 3L
            streak == 3 -> 5L
            else -> FAILURE_MAX_DELAY_SEC
        }
    }

    private fun restartTermuxRuntime() {
        scheduler.execute {
            updateNotification("Restarting Crew Termux runtime…")
            RuntimeManager.productionHost.stopCrewHost(this)

            val deadline = System.currentTimeMillis() + 3_000L
            while (serverAlive() && System.currentTimeMillis() < deadline) {
                Thread.sleep(200)
            }

            healthyChecks = 0
            failedChecks = 0
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

        RuntimeManager.productionHost.startCrewHost(this)
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
            val connection = URL(SERVER_HEALTH_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 750
            connection.readTimeout = 750
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

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val runtimeChannel = NotificationChannel(
            CHANNEL_ID,
            "Crew Runtime",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps the Termux-backed Crew Pocket runtime available."
            setShowBadge(false)
        }
        val taskChannel = NotificationChannel(
            TASK_CHANNEL_ID,
            "Crew AI 任務",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "AI 背景任務完成或失敗時提醒，點擊可回到原對話。"
            setShowBadge(true)
        }
        manager.createNotificationChannel(runtimeChannel)
        manager.createNotificationChannel(taskChannel)
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
        if (lastNotificationText == text) return
        lastNotificationText = text

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
