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
import java.util.concurrent.atomic.AtomicBoolean

class CrewRuntimeHostService : Service() {
    companion object {
        const val ACTION_START = "com.crewpocket.runtime.action.START"
        const val ACTION_STOP = "com.crewpocket.runtime.action.STOP"
        const val PROTOCOL_VERSION = 1
        val STATUS_PORT: Int get() = BuildConfig.STATUS_PORT
        private const val TAG = "CrewRuntimeHost"
        private const val CHANNEL_ID = "crew_runtime_host"
        private val NOTIFICATION_ID: Int get() = BuildConfig.STATUS_PORT
    }

    // Status requests and startup must not create one 4 MB-stack thread per
    // incoming service command while the embedded Node process is booting.
    private val workers: ExecutorService = Executors.newFixedThreadPool(4)
    private val agentStartScheduled = AtomicBoolean(false)
    @Volatile private var statusServer: ServerSocket? = null
    @Volatile private var hostState = "stopped"
    @Volatile private var lastError: String? = null
    @Volatile private var nodeHost: EmbeddedNodeHost? = null
    @Volatile private var codexBridge: EmbeddedCodexBridge? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopAgentRuntime()
            stopStatusServer()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            promoteToForeground()
        } catch (error: Exception) {
            // Android may redeliver a sticky service after the app has moved
            // to the background. If foreground promotion is no longer allowed,
            // stop cleanly instead of crashing and entering a restart loop.
            if (intent != null) throw error
            Log.w(TAG, "Ignoring sticky restart that cannot enter foreground", error)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        startStatusServer()
        if (agentStartScheduled.compareAndSet(false, true)) {
            workers.execute {
                try {
                    startAgentRuntime()
                } finally {
                    agentStartScheduled.set(false)
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopAgentRuntime()
        stopStatusServer()
        workers.shutdownNow()
        super.onDestroy()
    }

    @Synchronized
    private fun startAgentRuntime() {
        if (nodeHost?.isRunning() == true) return
        hostState = "starting"
        lastError = null

        if (!runtimeComponentsReady()) {
            hostState = "missing-components"
            lastError = "Runtime APK was built without Node, Codex, or AGY payloads"
            updateNotification("Runtime components are not bundled")
            return
        }

        val workspace = EmbeddedWorkspaceManager.ensureWorkspace(this).getOrElse {
            failStart("Workspace bootstrap failed", it)
            return
        }

        val token = EmbeddedCodexBridge.generateToken()
        val bridge = EmbeddedCodexBridge(this, token)
        bridge.start().getOrElse {
            failStart("Codex bridge failed", it)
            return
        }

        val node = EmbeddedNodeHost(this) { exitCode ->
            hostState = "exited"
            lastError = "Node host exited with code $exitCode"
            updateNotification("Crew Runtime stopped unexpectedly")
        }
        node.start(workspace, token).getOrElse {
            bridge.stop()
            failStart("Node host failed", it)
            return
        }

        codexBridge = bridge
        nodeHost = node
        hostState = "running"
        updateNotification("Crew Runtime active")
        Log.i(TAG, "Companion runtime owns localhost:${BuildConfig.SERVER_PORT}")
    }

    @Synchronized
    private fun stopAgentRuntime() {
        hostState = "stopping"
        nodeHost?.shutdown()
        nodeHost = null
        codexBridge?.stop()
        codexBridge = null
        hostState = "stopped"
    }

    private fun failStart(prefix: String, error: Throwable) {
        hostState = "error"
        lastError = "$prefix: ${error.message}"
        Log.e(TAG, prefix, error)
        updateNotification("$prefix · ${error.message ?: "unknown error"}")
    }

    private fun runtimeComponentsReady(): Boolean {
        return EmbeddedNodeHost.isBinaryBundled(this) &&
            EmbeddedCodexBridge.isBinaryBundled(this) &&
            EmbeddedAgyRuntime.prepare(this).getOrNull() != null
    }

    @Synchronized
    private fun startStatusServer() {
        if (statusServer?.isClosed == false) return
        runCatching {
            val server = ServerSocket()
            server.reuseAddress = true
            server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), STATUS_PORT), 4)
            statusServer = server
            workers.execute { acceptLoop(server) }
            Log.i(TAG, "Runtime contract listening on 127.0.0.1:$STATUS_PORT")
        }.onFailure {
            Log.e(TAG, "Could not start runtime contract server", it)
        }
    }

    @Synchronized
    private fun stopStatusServer() {
        runCatching { statusServer?.close() }
        statusServer = null
    }

    private fun acceptLoop(server: ServerSocket) {
        while (!server.isClosed) {
            try {
                workers.execute { handleClient(server.accept()) }
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

            val ok = requestLine.startsWith("GET /status ")
            val body = if (ok) runtimeStatus().toString()
                else JSONObject().put("error", "not_found").toString()
            val status = if (ok) "200 OK" else "404 Not Found"
            val bytes = body.toByteArray(Charsets.UTF_8)
            val headers = buildString {
                append("HTTP/1.1 $status\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Content-Length: ${bytes.size}\r\n")
                append("Connection: close\r\n\r\n")
            }.toByteArray(Charsets.UTF_8)

            client.getOutputStream().use { output ->
                output.write(headers)
                output.write(bytes)
                output.flush()
            }
        }
    }

    private fun runtimeStatus(): JSONObject {
        val payloadReady = runtimeComponentsReady()
        val ready = payloadReady && BuildConfig.COMPANION_ENABLED
        return JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("runtimeVersion", BuildConfig.VERSION_NAME)
            .put("delivery", "companion-apk")
            .put("ready", ready)
            .put("payloadReady", payloadReady)
            .put("companionEnabled", BuildConfig.COMPANION_ENABLED)
            .put("hostState", hostState)
            .put("lastError", lastError ?: JSONObject.NULL)
            .put("providers", JSONObject()
                .put("codex", JSONObject()
                    .put("delivery", "runtime-apk")
                    .put("version", readManifestVersion("provider-manifests/codex.json"))
                    .put("state", if (EmbeddedCodexBridge.isBinaryBundled(this)) "bundled" else "not-bundled"))
                .put("antigravity", JSONObject()
                    .put("delivery", "runtime-apk")
                    .put("version", readManifestVersion("agy-runtime/manifest.json"))
                    .put("state", if (EmbeddedAgyRuntime.prepare(this).getOrNull() != null) "bundled" else "not-bundled")))
    }

    private fun readManifestVersion(asset: String): Any =
        runCatching {
            assets.open(asset).bufferedReader().use { reader ->
                JSONObject(reader.readText()).optString("version").ifBlank { null }
            }
        }.getOrNull() ?: JSONObject.NULL

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Crew Runtime", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Runs the local Crew agent runtime."
                setShowBadge(false)
            }
        )
    }

    private fun promoteToForeground() {
        val launchIntent = packageManager.getLaunchIntentForPackage(BuildConfig.POCKET_PACKAGE)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this, 1, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val notification = notificationBuilder()
            .setContentTitle(if (BuildConfig.DEBUG) "Crew Runtime Dev" else "Crew Runtime")
            .setContentText("Starting local agent runtime…")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID,
            notificationBuilder()
                .setContentTitle(if (BuildConfig.DEBUG) "Crew Runtime Dev" else "Crew Runtime")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .build()
        )
    }

    private fun notificationBuilder(): Notification.Builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
}
