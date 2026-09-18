package com.crewpocket.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    companion object {
        private const val SERVER_URL = "http://127.0.0.1:8000/"
        private const val REQUEST_TERMUX = 7601
        private const val REQUEST_NOTIFICATION = 7602
        private const val REQUEST_WEB_MEDIA = 7603
        private const val REQUEST_GEOLOCATION = 7604
        private const val REQUEST_FILE = 7605
    }

    private lateinit var statusText: TextView
    private lateinit var setupText: TextView
    private lateinit var webView: WebView
    private val poller = Executors.newSingleThreadScheduledExecutor()
    private val pageLoaded = AtomicBoolean(false)

    private var pendingWebPermission: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        configureWebView()
        requestNotificationPermissionIfNeeded()
        requestTermuxPermissionIfPossible()
        startCrewRuntime()
        startServerPolling()
    }

    override fun onResume() {
        super.onResume()
        refreshSetupStatus()
    }

    override fun onDestroy() {
        poller.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(7, 11, 24))
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(8), dp(8))
        }

        statusText = TextView(this).apply {
            text = "Crew runtime starting…"
            setTextColor(Color.WHITE)
            textSize = 12f
        }
        toolbar.addView(
            statusText,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        val restartButton = Button(this).apply {
            text = "Restart"
            textSize = 11f
            setOnClickListener {
                RuntimeManager.crewHost.startCrewHost(this@MainActivity)
                startCrewRuntime()
                pageLoaded.set(false)
                statusText.text = "Restart requested…"
            }
        }
        toolbar.addView(restartButton)

        val browserButton = Button(this).apply {
            text = "Browser"
            textSize = 11f
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(SERVER_URL)))
            }
        }
        toolbar.addView(browserButton)

        val stopButton = Button(this).apply {
            text = "Stop"
            textSize = 11f
            setOnClickListener {
                val stop = Intent(this@MainActivity, CrewRuntimeService::class.java)
                    .setAction(CrewRuntimeService.ACTION_STOP)
                startService(stop)
                statusText.text = "Crew runtime stopped"
            }
        }
        toolbar.addView(stopButton)

        root.addView(
            toolbar,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        setupText = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.rgb(253, 186, 116))
            setBackgroundColor(Color.rgb(30, 41, 59))
            textSize = 11f
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setOnClickListener { openAppSettings() }
        }
        root.addView(
            setupText,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(7, 11, 24))
        }
        root.addView(
            webView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        setContentView(root)
    }

    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(true)
            allowContentAccess = true
            allowFileAccess = false
        }
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermissionRequest(request) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebPermission === request) {
                    pendingWebPermission = null
                    pendingWebResources = emptyArray()
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                handleGeolocationRequest(origin, callback)
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams.createIntent(), REQUEST_FILE)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
    }

    private fun startCrewRuntime() {
        val intent = Intent(this, CrewRuntimeService::class.java)
            .setAction(CrewRuntimeService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun startServerPolling() {
        poller.scheduleWithFixedDelay(
            {
                val alive = serverAlive()
                runOnUiThread {
                    if (alive) {
                        val embeddedReady = getSharedPreferences("crew_runtime", MODE_PRIVATE)
                            .getBoolean("embedded_ready", false)
                        statusText.text = if (embeddedReady) {
                            "Crew active · embedded Codex"
                        } else {
                            "Crew active · Termux Codex fallback"
                        }
                        if (pageLoaded.compareAndSet(false, true)) {
                            webView.loadUrl(SERVER_URL)
                        }
                    } else {
                        statusText.text = "Waiting for Crew runtime…"
                    }
                }
            },
            0,
            1500,
            TimeUnit.MILLISECONDS
        )
    }

    private fun serverAlive(): Boolean {
        return try {
            val connection = URL(SERVER_URL).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1000
            connection.readTimeout = 1000
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

    private fun requestTermuxPermissionIfPossible() {
        if (!TermuxBridge.isInstalled(this)) {
            refreshSetupStatus()
            return
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            !TermuxBridge.hasRunCommandPermission(this)
        ) {
            requestPermissions(arrayOf(TermuxBridge.RUN_COMMAND_PERMISSION), REQUEST_TERMUX)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_NOTIFICATION
            )
        }
    }

    private fun refreshSetupStatus() {
        val message = when {
            !TermuxBridge.isInstalled(this) ->
                "Termux not found. Install Termux first, then install Crew Pocket in Termux."
            !TermuxBridge.hasRunCommandPermission(this) ->
                "Grant “Run commands in Termux environment” to Crew Pocket. Tap here to open App settings."
            else -> null
        }
        setupText.text = message ?: ""
        setupText.visibility = if (message == null) View.GONE else View.VISIBLE
    }

    private fun openAppSettings() {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val androidPermissions = mutableListOf<String>()
        val grantResources = mutableListOf<String>()

        for (resource in request.resources) {
            when (resource) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                    grantResources += resource
                    if (
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                        checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                    ) {
                        androidPermissions += Manifest.permission.RECORD_AUDIO
                    }
                }
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                    grantResources += resource
                    if (
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                        checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                    ) {
                        androidPermissions += Manifest.permission.CAMERA
                    }
                }
            }
        }

        if (grantResources.isEmpty()) {
            request.deny()
            return
        }

        if (androidPermissions.isEmpty()) {
            request.grant(grantResources.toTypedArray())
            return
        }

        pendingWebPermission?.deny()
        pendingWebPermission = request
        pendingWebResources = grantResources.toTypedArray()
        requestPermissions(androidPermissions.distinct().toTypedArray(), REQUEST_WEB_MEDIA)
    }

    private fun handleGeolocationRequest(
        origin: String,
        callback: GeolocationPermissions.Callback
    ) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        ) {
            callback.invoke(origin, true, false)
            return
        }

        pendingGeoOrigin = origin
        pendingGeoCallback = callback
        requestPermissions(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ),
            REQUEST_GEOLOCATION
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQUEST_TERMUX -> {
                refreshSetupStatus()
                if (TermuxBridge.hasRunCommandPermission(this)) {
                    RuntimeManager.crewHost.startCrewHost(this)
                }
            }
            REQUEST_WEB_MEDIA -> {
                val request = pendingWebPermission
                if (request != null) {
                    val allGranted = permissions.indices.all { index ->
                        grantResults.getOrNull(index) == PackageManager.PERMISSION_GRANTED
                    }
                    if (allGranted) request.grant(pendingWebResources) else request.deny()
                }
                pendingWebPermission = null
                pendingWebResources = emptyArray()
            }
            REQUEST_GEOLOCATION -> {
                val granted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
                pendingGeoCallback?.invoke(pendingGeoOrigin, granted, false)
                pendingGeoOrigin = null
                pendingGeoCallback = null
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_FILE) {
            val callback = filePathCallback
            filePathCallback = null
            callback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}
