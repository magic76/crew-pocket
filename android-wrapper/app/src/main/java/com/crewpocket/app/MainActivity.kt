package com.crewpocket.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
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
        private const val WEB_MIGRATION_PREFS = "crew_web_migrations"
        private const val LEGACY_PWA_RETIRED = "legacy_pwa_retired_v2"
    }

    private lateinit var statusText: TextView
    private lateinit var setupText: TextView
    private lateinit var webView: WebView
    private val pageLoaded = AtomicBoolean(false)
    private lateinit var runtimeHealthMonitor: RuntimeHealthMonitor
    private lateinit var wirelessDebugController: WirelessDebugController

    private var pendingWebPermission: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val webSessionId = System.currentTimeMillis()
    private var legacyPwaCleanupPending = false
    private var pendingConversationProvider: String? = null
    private var pendingConversationId: String? = null
    private var pendingConversationAttempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        captureConversationIntent(intent)
        buildUi()
        wirelessDebugController = WirelessDebugController(this)
        runtimeHealthMonitor = RuntimeHealthMonitor(
            onHealthy = {
                runOnUiThread {
                    statusText.text = "Crew active · Termux engine"
                    if (pageLoaded.compareAndSet(false, true)) {
                        webView.loadUrl(appUrl())
                    }
                }
            },
            onUnavailable = {
                runOnUiThread {
                    statusText.text = "Waiting for Crew runtime…"
                    pageLoaded.set(false)
                }
            }
        )
        configureWebView()
        prepareLegacyPwaRetirement()
        requestNotificationPermissionIfNeeded()
        requestTermuxPermissionIfPossible()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureConversationIntent(intent)
        dispatchPendingConversation()
    }

    override fun onStart() {
        super.onStart()
        startCrewRuntime()
        runtimeHealthMonitor.start()
    }

    override fun onStop() {
        runtimeHealthMonitor.stop()
        notifyRuntimeBackground()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        refreshSetupStatus()
    }

    override fun onDestroy() {
        runtimeHealthMonitor.close()
        wirelessDebugController.close()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun buildUi() {
        val root = android.widget.FrameLayout(this).apply {
            // Android 15 enforces edge-to-edge for target SDK 35. Keep the
            // mandatory status-bar inset outside the web content and black.
            setBackgroundColor(Color.BLACK)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(7, 11, 24))
        }

        // Runtime controls belong in diagnostics, not the everyday chat UI.
        // Keep this field for asynchronous status updates without reserving a
        // permanent toolbar above the WebView.
        statusText = TextView(this).apply {
            text = "Crew runtime starting…"
        }

        setupText = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.rgb(253, 186, 116))
            setBackgroundColor(Color.rgb(30, 41, 59))
            textSize = 11f
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setOnClickListener { openAppSettings() }
        }
        content.addView(
            setupText,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(7, 11, 24))
        }
        content.addView(
            webView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )
        root.addView(
            content,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        root.setOnApplyWindowInsetsListener { _, insets ->
            val params = content.layoutParams as android.widget.FrameLayout.LayoutParams
            val topInset = insets.systemWindowInsetTop
            if (params.topMargin != topInset) {
                params.topMargin = topInset
                content.layoutParams = params
            }
            insets
        }

        setContentView(root)
    }

    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(true)
            allowContentAccess = true
            allowFileAccess = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val target = uri.toString()
                if (
                    target.startsWith(SERVER_URL) ||
                    target.startsWith("http://localhost:8000/")
                ) {
                    return false
                }

                if (uri.scheme == "http" || uri.scheme == "https") {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (_: Exception) {
                        false
                    }
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val isCrewPage = url.orEmpty().startsWith(SERVER_URL)

                if (legacyPwaCleanupPending && isCrewPage) {
                    legacyPwaCleanupPending = false
                    view?.evaluateJavascript(
                        """
                        (() => {
                          try {
                            if ('serviceWorker' in navigator) {
                              navigator.serviceWorker.getRegistrations()
                                .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
                                .catch(() => {});
                            }
                            if ('caches' in window) {
                              caches.keys()
                                .then(keys => Promise.all(keys.map(key => caches.delete(key))))
                                .catch(() => {});
                            }
                          } catch (_) {}
                        })();
                        """.trimIndent(),
                        null
                    )
                    getSharedPreferences(WEB_MIGRATION_PREFS, MODE_PRIVATE)
                        .edit()
                        .putBoolean(LEGACY_PWA_RETIRED, true)
                        .apply()
                }

                if (isCrewPage) dispatchPendingConversation()
            }
        }
        webView.addJavascriptInterface(NativeWebBridge(), "CrewPocket")
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

    private fun prepareLegacyPwaRetirement() {
        val prefs = getSharedPreferences(WEB_MIGRATION_PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(LEGACY_PWA_RETIRED, false)) return

        // One migration only: clear old HTTP resources now, then unregister any
        // legacy localhost service worker after the first page has loaded.
        webView.clearCache(true)
        legacyPwaCleanupPending = true
    }

    private fun captureConversationIntent(source: Intent?) {
        val provider = source?.getStringExtra(CrewRuntimeService.EXTRA_OPEN_PROVIDER)
            ?.trim()
            ?.takeIf { it == "antigravity" || it == "codex" }
        val conversationId = source?.getStringExtra(CrewRuntimeService.EXTRA_OPEN_CONVERSATION_ID)
            ?.trim()
            ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]+")) }

        if (provider != null && conversationId != null) {
            pendingConversationProvider = provider
            pendingConversationId = conversationId
            pendingConversationAttempts = 0
        }
    }

    private fun dispatchPendingConversation() {
        val provider = pendingConversationProvider ?: return
        val conversationId = pendingConversationId ?: return
        if (!::webView.isInitialized || !pageLoaded.get()) return
        if (!webView.url.orEmpty().startsWith(SERVER_URL)) return

        val script = """
            (() => {
              if (typeof window.openCrewConversation !== 'function') return 'not-ready';
              try {
                Promise.resolve(window.openCrewConversation(
                  ${JSONObject.quote(provider)},
                  ${JSONObject.quote(conversationId)}
                )).catch(() => {});
                return 'started';
              } catch (_) {
                return 'failed';
              }
            })();
        """.trimIndent()

        webView.evaluateJavascript(script) { result ->
            runOnUiThread {
                if (result == "\"started\"") {
                    pendingConversationProvider = null
                    pendingConversationId = null
                    pendingConversationAttempts = 0
                    return@runOnUiThread
                }

                pendingConversationAttempts += 1
                if (pendingConversationAttempts < 12) {
                    Handler(Looper.getMainLooper()).postDelayed(
                        { dispatchPendingConversation() },
                        250L
                    )
                } else {
                    Toast.makeText(
                        this,
                        "無法自動開啟指定對話，請從對話列表重新選擇。",
                        Toast.LENGTH_SHORT
                    ).show()
                    pendingConversationProvider = null
                    pendingConversationId = null
                    pendingConversationAttempts = 0
                }
            }
        }
    }

    private fun appUrl(): String {
        return "${SERVER_URL}?apk=${BuildConfig.VERSION_CODE}&session=$webSessionId"
    }

    /** Small native escape hatch for setup tasks that should not depend on a
     *  WebView page being loaded. The web menu falls back to /extra/adb.html in
     *  a normal browser, while the APK opens the native sheet below. */
    private inner class NativeWebBridge {
        @JavascriptInterface
        fun openWirelessDebugSettings() {
            runOnUiThread {
                if (webView.url.orEmpty().startsWith(SERVER_URL)) {
                    wirelessDebugController.show()
                }
            }
        }
    }

    private fun startCrewRuntime() {
        val intent = Intent(this, CrewRuntimeService::class.java)
            .setAction(CrewRuntimeService.ACTION_APP_FOREGROUND)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun notifyRuntimeBackground() {
        val intent = Intent(this, CrewRuntimeService::class.java)
            .setAction(CrewRuntimeService.ACTION_APP_BACKGROUND)
        try {
            startService(intent)
        } catch (_: Exception) {
            // The service may already have been stopped by the system.
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
                "Termux is required as the Crew Pocket runtime engine."
            !TermuxBridge.hasRunCommandPermission(this) ->
                "Grant “Run commands in Termux environment” so Crew Pocket can start and recover the runtime."
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
                    startCrewRuntime()
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
