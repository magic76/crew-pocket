package com.crewpocket.app

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class RuntimeHealthMonitor(
    private val onHealthy: () -> Unit,
    private val onUnavailable: () -> Unit
) {
    companion object {
        private const val HEALTH_URL = "http://127.0.0.1:8000/healthz"
        private const val QUICK_RECHECK_MS = 1_500L
        private const val HEALTHY_RECHECK_MS = 30_000L
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var running = false
    private var task: ScheduledFuture<*>? = null
    private var healthyStreak = 0
    private var failedStreak = 0

    @Synchronized
    fun start() {
        if (running) return
        running = true
        healthyStreak = 0
        failedStreak = 0
        scheduleNext(0L)
    }

    @Synchronized
    fun stop() {
        running = false
        task?.cancel(false)
        task = null
    }

    fun close() {
        stop()
        scheduler.shutdownNow()
    }

    private fun scheduleNext(delayMs: Long) {
        if (!running || scheduler.isShutdown) return
        task = scheduler.schedule({
            if (!running) return@schedule
            val healthy = probe()
            val nextDelay = if (healthy) {
                failedStreak = 0
                healthyStreak += 1
                onHealthy()
                if (healthyStreak == 1) QUICK_RECHECK_MS else HEALTHY_RECHECK_MS
            } else {
                healthyStreak = 0
                failedStreak += 1
                if (failedStreak == 2) onUnavailable()
                when (failedStreak) {
                    1 -> 1_000L
                    2 -> 2_000L
                    else -> 5_000L
                }
            }
            scheduleNext(nextDelay)
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun probe(): Boolean = try {
        val connection = URL(HEALTH_URL).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 750
        connection.readTimeout = 750
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        try {
            connection.responseCode in 200..299
        } finally {
            connection.disconnect()
        }
    } catch (_: Exception) {
        false
    }
}
