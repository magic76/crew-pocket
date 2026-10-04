package com.crewpocket.runtime

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
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CrewRuntimeHostService : Service() {
    companion object {
        const val ACTION_START = "com.crewpocket.runtime.action.START"
        const val ACTION_STOP = "com.crewpocket.runtime.action.STOP"
        const val PROTOCOL_VERSION = 1
        const val STATUS_PORT = 8768

        private const val TAG = "CrewRuntimeHost"
        private const val CHANNEL_ID = "crew_runtime_host"
        private const val NOTIFICATION_ID = 8768
    }

    private val workers: ExecutorService = Executors.newCachedThreadPool()
    @Volatile private var statusServer: ServerSocket? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRuntimeShell()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        promoteToForeground()
        startRuntimeShell()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopRuntimeShell()
        workers.shutdownNow()
        super.onDestroy()
    }

    @Synchronized
    private fun startRuntimeShell() {
        if (statusServer?.isClosed == false) return

        runCatching {
            val server = ServerSocket()
            server.reuseAddress = true
            server.bind(
                InetSocketAddress(InetAddress.getByName("127.0.0.1"), STATUS_PORT),
                4
            )
            statusServer = server
            workers.execute { acceptLoop(server) }
            Log.i(TAG, "Runtime contract listening on 127.0.0.1:$STATUS_PORT")
        }.onFailure {
            Log.e(TAG, "Could not start runtime contract server", it)
        }
    }

    @Synchronized
    private fun stopRuntimeShell() {
        runCatching { statusServer?.close() }
        statusServer = null
    }

    private fun acceptLoop(server: ServerSocket) {
        while (!server.isClosed) {
            try {
                val socket = server.accept()
                workers.execute { handleClient(socket) }
            } catch (error: Exception) {
                if (!server.isClosed) Log.w(TAG, "Status accept failed", error)
            }
        }
    }

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 2_000
            val reader = client.getInputStream().bufferedReader()
            val requestLine = reader.readLine().orEmpty()
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isBlank()) break
            }

            val body: String
            val status: String
            if (requestLine.startsWith("GET /status ")) {
                status = "200 OK"
                body = runtimeStatus().toString()
            } else {
                status = "404 Not Found"
                body = JSONObject().put("error", "not_found").toString()
            }

            val bytes = body.toByteArray(Charsets.UTF_8)
            val headers = buildString {
                append("HTTP/1.1 $status\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Content-Length: ${bytes.size}\r\n")
                append("Connection: close\r\n")
                append("\r\n")
            }.toByteArray(Charsets.UTF_8)
            client.getOutputStream().use { output ->
                output.write(headers)
                output.write(bytes)
                output.flush()
            }
        }
    }

    private fun runtimeStatus(): JSONObject {
        return JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("runtimeVersion", BuildConfig.VERSION_NAME)
            .put("delivery", "companion-apk")
            .put("ready", false)
            .put("hostState", "scaffold")
            .put(
                "providers",
                JSONObject()
                    .put(
                        "codex",
                        JSONObject()
                            .put("delivery", "runtime-apk")
                            .put("version", JSONObject.NULL)
                            .put("state", "not-bundled")
                    )
                    .put(
                        "antigravity",
                        JSONObject()
                            .put("delivery", "runtime-apk")
                            .put("version", JSONObject.NULL)
                            .put("state", "not-bundled")
                    )
            )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Crew Runtime",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Runs the local Crew agent runtime."
                setShowBadge(false)
            }
        )
    }

    private fun promoteToForeground() {
        val launchIntent = packageManager.getLaunchIntentForPackage("com.crewpocket.app")
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                1,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notification = builder
            .setContentTitle("Crew Runtime")
            .setContentText("Runtime migration shell active")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
            .build()

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
}
