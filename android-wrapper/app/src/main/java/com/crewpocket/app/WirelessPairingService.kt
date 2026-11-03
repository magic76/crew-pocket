package com.crewpocket.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL

/**
 * User-initiated, temporary foreground discovery for this device's Android 11+
 * Wireless Debugging ports. Unlike a normal Activity scanner, this continues
 * while Android Settings owns the foreground pairing-code dialog.
 *
 * Never enables debugging, never pairs another LAN host, and never persists the
 * six-digit code. Termux remains the sole owner of the adb client and keys.
 */
class WirelessPairingService : Service() {
    companion object {
        private const val CHANNEL = "crew_adb_pairing"
        private const val NOTIFICATION_ID = 7631
        private const val ACTION_START = "com.crewpocket.app.WIRELESS_PAIRING_START"
        private const val ACTION_CODE = "com.crewpocket.app.WIRELESS_PAIRING_CODE"
        private const val CODE_KEY = "wireless_pairing_code"
        private const val PAIR_TYPE = "_adb-tls-pairing._tcp."
        private const val CONNECT_TYPE = "_adb-tls-connect._tcp."
        private const val TIMEOUT_MS = 120_000L

        fun begin(context: Context) {
            val intent = Intent(context, WirelessPairingService::class.java)
                .setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val notifications: NotificationManager by lazy {
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }
    private val discoveries = mutableMapOf<String, NsdManager.DiscoveryListener>()
    private val resolvingQueue = ArrayDeque<Pair<String, NsdServiceInfo>>()
    private val discoveredNames = mutableMapOf<String, String>()
    private var resolving = false
    private var pairingPort = 0
    private var connectionPort = 0
    private var started = false
    private var processing = false
    private var finished = false
    private lateinit var nsd: NsdManager
    private val expire = Runnable { finish("搜尋逾時。請重新開始配對。", false) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL, "Crew Pocket 無線偵錯配對", NotificationManager.IMPORTANCE_DEFAULT)
        )
        nsd = getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CODE -> {
                val value = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(CODE_KEY)?.toString()?.trim().orEmpty()
                submitCode(value)
            }
            ACTION_START -> if (!started) {
                started = true
                startForeground(NOTIFICATION_ID, notification(
                    "請開啟「使用配對碼配對裝置」；正在尋找本機 ADB 服務…", true))
                main.postDelayed(expire, TIMEOUT_MS)
                discover(PAIR_TYPE)
                discover(CONNECT_TYPE)
            }
        }
        return START_NOT_STICKY
    }

    private fun discover(type: String) {
        if (finished) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                finish("無法搜尋無線偵錯服務；請確認 Wi-Fi 及無線偵錯已開啟。", false)
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onServiceFound(info: NsdServiceInfo) {
                main.post {
                    if (!finished) {
                        resolvingQueue.addLast(type to info)
                        resolveNext()
                    }
                }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                main.post {
                    if (discoveredNames[type] == info.serviceName) {
                        discoveredNames.remove(type)
                        if (type == PAIR_TYPE) pairingPort = 0
                        if (type == CONNECT_TYPE) connectionPort = 0
                        updateSearching()
                    }
                }
            }
        }
        discoveries[type] = listener
        try {
            nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            finish("無法啟動本機 mDNS 搜尋，請使用手動配對。", false)
        }
    }

    /** Android 11-13 only allow one outstanding NsdManager.resolveService at a time. */
    private fun resolveNext() {
        if (resolving || finished || resolvingQueue.isEmpty()) return
        val (type, info) = resolvingQueue.removeFirst()
        resolving = true
        try {
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    main.post { resolving = false; resolveNext() }
                }
                override fun onServiceResolved(resolved: NsdServiceInfo) {
                    main.post {
                        resolving = false
                        val port = resolved.port
                        if (!finished && port in 1..65535) {
                            // mDNS may include other nearby devices. Never use its
                            // advertised host; only accept an open LOCAL loopback port.
                            Thread {
                                if (isLocalPortOpen(port)) {
                                    main.post {
                                        if (!finished) {
                                            discoveredNames[type] = resolved.serviceName
                                            if (type == PAIR_TYPE) pairingPort = port
                                            if (type == CONNECT_TYPE) connectionPort = port
                                            updateSearching()
                                        }
                                    }
                                }
                            }.start()
                        }
                        resolveNext()
                    }
                }
            })
        } catch (_: Exception) {
            resolving = false
            resolveNext()
        }
    }

    private fun isLocalPortOpen(port: Int): Boolean = try {
        Socket().use {
            it.connect(InetSocketAddress("127.0.0.1", port), 400)
            true
        }
    } catch (_: Exception) {
        false
    }

    private fun updateSearching() {
        if (finished || processing || !started) return
        val message = when {
            pairingPort > 0 && connectionPort > 0 ->
                "已找到本機配對服務。請從 Android 設定複製 6 位配對碼，在這則通知輸入。"
            pairingPort > 0 ->
                "配對埠已找到，正在等待無線偵錯連線埠…"
            else -> "請在「無線偵錯」按「使用配對碼配對裝置」…"
        }
        notifications.notify(NOTIFICATION_ID, notification(message, true))
    }

    private fun notification(message: String, allowCode: Boolean): Notification {
        val settings = PendingIntent.getActivity(
            this, 0, Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Crew Pocket · ADB 快速配對")
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setContentIntent(settings)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setOngoing(allowCode)
        if (allowCode && !processing) {
            val replyIntent = Intent(this, WirelessPairingService::class.java)
                .setAction(ACTION_CODE)
            val reply = PendingIntent.getService(
                this, 1, replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            val input = RemoteInput.Builder(CODE_KEY)
                .setLabel("輸入 6 位配對碼")
                .build()
            builder.addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_send, "輸入配對碼", reply)
                    .addRemoteInput(input).build()
            )
        }
        return builder.build()
    }

    private fun submitCode(code: String) {
        if (finished || processing || !started) return
        if (!code.matches(Regex("[0-9]{6}"))) {
            notifications.notify(
                NOTIFICATION_ID, notification("配對碼需為 6 位數字，請重新輸入。", true))
            return
        }
        val pair = pairingPort
        val connect = connectionPort
        if (pair == 0 || connect == 0) {
            notifications.notify(
                NOTIFICATION_ID, notification(
                    "尚未找到兩個本機 ADB 端點。請維持系統配對視窗開啟，稍後重試。", true))
            return
        }
        processing = true
        notifications.notify(
            NOTIFICATION_ID, notification("正在透過 Termux 執行本機 ADB 配對…", false))
        Thread {
            if (!isLocalPortOpen(pair) || !isLocalPortOpen(connect)) {
                main.post { finish("配對端點已失效，請重新開啟系統配對視窗。", false) }
                return@Thread
            }
            // No code is written to Preferences, a notification, or diagnostic logs.
            val result = runCatching {
                TermuxBridge.pairAdbTarget(
                    this,
                    "127.0.0.1:" + pair,
                    code,
                    "127.0.0.1:" + connect
                )
            }.getOrElse { Result.failure(it) }
            if (result.isFailure) {
                main.post { finish("無法通知 Termux，請確認 Run Command 授權。", false) }
                return@Thread
            }
            val target = "127.0.0.1:" + connect
            var confirmed = false
            repeat(15) {
                if (!confirmed) {
                    try { Thread.sleep(800) } catch (_: InterruptedException) { }
                    confirmed = verifiedConnected(target)
                }
            }
            main.post {
                if (confirmed) finish("ADB 已確認連線，可返回 Crew Pocket 使用。", true)
                else finish("配對指令已送出但尚未確認連線；請回 Crew Pocket 查看狀態。", false)
            }
        }.start()
    }

    private fun verifiedConnected(target: String): Boolean = try {
        val connection = URL("http://127.0.0.1:8000/api/adb").openConnection() as HttpURLConnection
        connection.connectTimeout = 700
        connection.readTimeout = 700
        try {
            if (connection.responseCode !in 200..299) false
            else {
                val text = connection.inputStream.bufferedReader().use { it.readText() }
                val json = org.json.JSONObject(text)
                json.optBoolean("connected") && json.optString("target") == target
            }
        } finally {
            connection.disconnect()
        }
    } catch (_: Exception) {
        false
    }

    private fun finish(message: String, success: Boolean) {
        if (finished) return
        finished = true
        main.removeCallbacks(expire)
        notifications.notify(
            NOTIFICATION_ID, notification(message, false))
        stopForeground(STOP_FOREGROUND_DETACH)
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacks(expire)
        for ((_, listener) in discoveries) {
            try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) { }
        }
        discoveries.clear()
        super.onDestroy()
    }
}
