package com.crewpocket.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors

/**
 * A bounded, foreground-only reconnect for an already paired *local* Android
 * Wireless Debugging device. Never opens a pairing dialog, requests a code,
 * enables debugging, or connects to an mDNS-advertised remote host.
 *
 * The host ADB identity / pairing records remain owned by Termux.
 */
internal class WirelessAdbAutoReconnect(context: Context) {
    companion object {
        private const val PREFERENCES = "crew_adb_settings"
        private const val KEY_ENABLED = "auto_reconnect_enabled"
        private const val SERVICE_TYPE = "_adb-tls-connect._tcp."
        private const val DISCOVERY_WINDOW_MS = 12_000L
    }

    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val network = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val nsd = app.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var started = false
    private var networkRegistered = false
    private var scanning = false
    private var resolving = false
    private var connecting = false
    private var generation = 0
    private var listener: NsdManager.DiscoveryListener? = null
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var deadline: Runnable? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            main.post { scanIfEligible() }
        }
        override fun onLost(network: Network) {
            main.post {
                if (!wifiAvailable()) stopScan()
            }
        }
    }

    fun enabled(): Boolean =
        app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    fun setEnabled(value: Boolean) {
        app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, value).apply()
        if (value) scanIfEligible() else stopScan()
    }

    fun start() {
        if (started || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        started = true
        try {
            network.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .build(),
                callback
            )
            networkRegistered = true
        } catch (_: Exception) {
            // App launch/resume discovery still works if an OEM refuses callbacks.
        }
        scanIfEligible()
    }

    /** Also runs after coming back from Android's Wireless Debugging settings. */
    fun refresh() = scanIfEligible()

    fun stop() {
        started = false
        if (networkRegistered) {
            try { network.unregisterNetworkCallback(callback) } catch (_: Exception) { }
            networkRegistered = false
        }
        stopScan()
    }

    fun close() {
        stop()
        worker.shutdownNow()
    }

    private fun wifiAvailable(): Boolean = try {
        network.allNetworks.any { candidate ->
            network.getNetworkCapabilities(candidate)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }
    } catch (_: Exception) {
        false
    }

    private fun scanIfEligible() {
        if (!started || !enabled() || !wifiAvailable() ||
            !TermuxBridge.isInstalled(app) || !TermuxBridge.hasRunCommandPermission(app) ||
            scanning || connecting) return

        val current = ++generation
        worker.execute {
            val connected = alreadyConnected()
            main.post {
                if (current == generation && started && enabled() && !connected) {
                    startScan(current)
                }
            }
        }
    }

    private fun alreadyConnected(): Boolean = try {
        val connection = URL("http://127.0.0.1:8000/api/adb")
            .openConnection() as HttpURLConnection
        connection.connectTimeout = 750
        connection.readTimeout = 750
        try {
            if (connection.responseCode !in 200..299) false else {
                val json = org.json.JSONObject(
                    connection.inputStream.bufferedReader().use { it.readText() }
                )
                json.optBoolean("connected", false)
            }
        } finally { connection.disconnect() }
    } catch (_: Exception) { false }

    private fun startScan(current: Int) {
        if (scanning || connecting || current != generation ||
            !started || !enabled() || !wifiAvailable()) return
        scanning = true
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) = Unit
            override fun onDiscoveryStopped(type: String) = Unit
            override fun onStartDiscoveryFailed(type: String, code: Int) {
                main.post { if (current == generation) stopScan() }
            }
            override fun onStopDiscoveryFailed(type: String, code: Int) = Unit
            override fun onServiceLost(info: NsdServiceInfo) = Unit
            override fun onServiceFound(info: NsdServiceInfo) {
                main.post {
                    if (current == generation && scanning && !connecting) {
                        pending.addLast(info)
                        resolveNext(current)
                    }
                }
            }
        }
        listener = discovery
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
            val timeout = Runnable { if (current == generation) stopScan() }
            deadline = timeout
            main.postDelayed(timeout, DISCOVERY_WINDOW_MS)
        } catch (_: Exception) { stopScan() }
    }

    /** Serialise NSD resolutions to support Android 11-13. */
    private fun resolveNext(current: Int) {
        if (!scanning || connecting || resolving || pending.isEmpty() ||
            current != generation) return
        resolving = true
        val service = pending.removeFirst()
        try {
            nsd.resolveService(service, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
                    main.post {
                        resolving = false
                        resolveNext(current)
                    }
                }
                override fun onServiceResolved(info: NsdServiceInfo) {
                    main.post {
                        resolving = false
                        if (current != generation || !scanning || connecting) return@post
                        val port = info.port
                        if (port in 1..65535) {
                            worker.execute {
                                // Ignore the advertised host; it can belong to another
                                // phone on the LAN. Only our own loopback is eligible.
                                val local = Socket().use { socket ->
                                    try {
                                        socket.connect(
                                            InetSocketAddress("127.0.0.1", port), 400)
                                        true
                                    } catch (_: Exception) { false }
                                }
                                main.post {
                                    if (current == generation && scanning && !connecting) {
                                        if (local) connect(port) else resolveNext(current)
                                    }
                                }
                            }
                        } else {
                            resolveNext(current)
                        }
                    }
                }
            })
        } catch (_: Exception) {
            resolving = false
            resolveNext(current)
        }
    }

    private fun connect(port: Int) {
        if (!started || !enabled() || !scanning || connecting) return
        connecting = true
        stopScan(invalidate = false)
        val current = ++generation
        // No pair command: the saved Termux ADB key must already be trusted.
        worker.execute {
            val dispatched = TermuxBridge.reconnectPairedAdb(app, port).isSuccess
            if (dispatched) {
                // RunCommand is asynchronous; verify before reporting success.
                repeat(10) {
                    if (alreadyConnected()) return@execute
                    try { Thread.sleep(900) } catch (_: InterruptedException) {
                        return@execute
                    }
                }
            }
            main.post {
                if (current == generation) connecting = false
                // No unbounded retries. A later app resume / Wi-Fi reconnect
                // may make a fresh, bounded attempt.
            }
        }
    }

    private fun stopScan(invalidate: Boolean = true) {
        if (invalidate) generation++
        deadline?.let { main.removeCallbacks(it) }
        deadline = null
        listener?.let { active ->
            try { nsd.stopServiceDiscovery(active) } catch (_: Exception) { }
        }
        listener = null
        pending.clear()
        scanning = false
        resolving = false
    }
}
