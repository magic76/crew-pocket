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
        private const val LEGACY_WEB_CACHE_CLEARED = "legacy_web_cache_cleared_v1"
    }

    private lateinit var statusText: TextView
    private lateinit var setupText: TextView
    private lateinit var webView: WebView
    private val poller = Executors.newSingleThreadScheduledExecutor()
    private val pageLoaded = AtomicBoolean(false)
    private var serverPollingTask: ScheduledFuture<*>? = null
    private var adbStatusTask: ScheduledFuture<*>? = null
    private var adbDialog: AlertDialog? = null

    private var pendingWebPermission: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val webSessionId = System.currentTimeMillis()
    private var legacyPwaCleanupInjected = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        configureWebView()
        clearLegacyWebCacheOnce()
        requestNotificationPermissionIfNeeded()
        requestTermuxPermissionIfPossible()
    }

    override fun onStart() {
        super.onStart()
        startCrewRuntime()
        startServerPolling()
    }

    override fun onStop() {
        stopServerPolling()
        notifyRuntimeBackground()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        refreshSetupStatus()
    }

    override fun onDestroy() {
        stopServerPolling()
        adbStatusTask?.cancel(false)
        poller.shutdownNow()
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
                if (legacyPwaCleanupInjected || !url.orEmpty().startsWith(SERVER_URL)) return

                legacyPwaCleanupInjected = true
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

    private fun clearLegacyWebCacheOnce() {
        val prefs = getSharedPreferences(WEB_MIGRATION_PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(LEGACY_WEB_CACHE_CLEARED, false)) return

        // The app no longer uses a PWA shell. Clear only the legacy WebView
        // resource cache once so old installs cannot keep serving stale assets.
        webView.clearCache(true)
        prefs.edit().putBoolean(LEGACY_WEB_CACHE_CLEARED, true).apply()
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
                    showWirelessDebugDialog()
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

    private fun startServerPolling() {
        if (serverPollingTask?.isCancelled == false && serverPollingTask?.isDone == false) {
            return
        }

        serverPollingTask = poller.scheduleWithFixedDelay(
            {
                val alive = serverAlive()
                runOnUiThread {
                    if (alive) {
                        statusText.text = "Crew active · Termux engine"
                        if (pageLoaded.compareAndSet(false, true)) {
                            webView.loadUrl(appUrl())
                        }
                    } else {
                        statusText.text = "Waiting for Crew runtime…"
                        pageLoaded.set(false)
                    }
                }
            },
            0,
            1500,
            TimeUnit.MILLISECONDS
        )
    }

    private fun stopServerPolling() {
        serverPollingTask?.cancel(false)
        serverPollingTask = null
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

    private data class AdbStatus(
        val target: String,
        val connected: Boolean,
        val lastOutput: String
    )

    private fun showWirelessDebugDialog() {
        if (adbDialog?.isShowing == true) return

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(4))
        }
        val targetInput = EditText(this).apply {
            hint = "192.0.2.1:37753 或 37753"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            textSize = 16f
            setSelectAllOnFocus(true)
        }
        val pairingTargetInput = EditText(this).apply {
            hint = "配對 IP:Port（第一次設定才需要）"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            textSize = 15f
        }
        val pairingCodeInput = EditText(this).apply {
            hint = "6 位配對碼"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
            textSize = 15f
        }
        val helperText = TextView(this).apply {
            text = "輸入連線 IP:Port；第一次配對時再填配對 IP:Port 與 6 位配對碼。"
            setTextColor(Color.rgb(100, 116, 139))
            textSize = 12f
            setPadding(0, dp(4), 0, dp(4))
        }
        val statusText = TextView(this).apply {
            text = "正在讀取目前 ADB 狀態…"
            setTextColor(Color.rgb(148, 163, 184))
            textSize = 12f
            setPadding(0, dp(8), 0, dp(8))
        }
        val saveButton = Button(this).apply {
            text = "儲存並連線"
            minHeight = dp(48)
        }
        val pairButton = Button(this).apply {
            text = "配對並連線"
            minHeight = dp(48)
        }
        val secondaryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val openSettingsButton = Button(this).apply {
            text = "開啟無線偵錯"
            minHeight = dp(48)
        }
        val copyButton = Button(this).apply {
            text = "複製指令"
            minHeight = dp(48)
        }
        secondaryRow.addView(
            openSettingsButton,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(4)
            }
        )
        secondaryRow.addView(
            copyButton,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(4)
            }
        )

        container.addView(targetInput)
        container.addView(pairingTargetInput)
        container.addView(pairingCodeInput)
        container.addView(helperText)
        container.addView(statusText)
        container.addView(saveButton)
        container.addView(pairButton)
        container.addView(secondaryRow)
        val scrollContainer = ScrollView(this).apply {
            addView(container)
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle("無線偵錯設定")
            .setView(scrollContainer)
            .setNegativeButton("關閉", null)
            .create()
        adbDialog = dialog
        dialog.setOnDismissListener {
            adbStatusTask?.cancel(false)
            adbStatusTask = null
            adbDialog = null
        }

        openSettingsButton.setOnClickListener { openWirelessDebugSystemSettings() }
        copyButton.setOnClickListener {
            val raw = targetInput.text.toString().trim()
            val target = runCatching { normalizeAdbTarget(raw) }.getOrNull()
            if (target == null) {
                statusText.text = "請先輸入有效的 Port 或 IP:Port。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                return@setOnClickListener
            }
            val pairingTarget = pairingTargetInput.text.toString().trim()
            val pairingCode = pairingCodeInput.text.toString().trim()
            val command = if (pairingTarget.isNotBlank() && pairingCode.isNotBlank()) {
                val normalizedPairing = runCatching { normalizeAdbTarget(pairingTarget) }.getOrNull()
                if (normalizedPairing == null || !pairingCode.matches(Regex("[0-9]{6}"))) {
                    statusText.text = "配對 IP:Port 或配對碼格式不正確。"
                    statusText.setTextColor(Color.rgb(248, 113, 113))
                    return@setOnClickListener
                }
                "adb pair $normalizedPairing $pairingCode\n~/set-adb.sh $target"
            } else {
                "~/set-adb.sh $target"
            }
            val clipboard = getSystemService(ClipboardManager::class.java)
            clipboard?.setPrimaryClip(ClipData.newPlainText("Crew Pocket ADB", command))
            Toast.makeText(this, "已複製 ADB 設定指令", Toast.LENGTH_SHORT).show()
        }
        saveButton.setOnClickListener {
            val target = try {
                normalizeAdbTarget(targetInput.text.toString())
            } catch (error: IllegalArgumentException) {
                statusText.text = error.message ?: "請輸入有效的 Port 或 IP:Port。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                return@setOnClickListener
            }

            saveButton.isEnabled = false
            statusText.setTextColor(Color.rgb(148, 163, 184))
            statusText.text = "正在通知 Termux 儲存 $target 並連線…"
            val result = TermuxBridge.setAdbTarget(this, target)
            if (result.isFailure) {
                statusText.text = result.exceptionOrNull()?.message
                    ?: "無法通知 Termux；請確認已允許執行 Termux 指令。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                saveButton.isEnabled = true
                return@setOnClickListener
            }

            statusText.text = "設定已送出，正在確認 ADB 連線…"
            refreshAdbStatus(targetInput, statusText, retries = 6, delayMs = 500L)
            saveButton.isEnabled = true
        }

        pairButton.setOnClickListener {
            val target = try {
                normalizeAdbTarget(targetInput.text.toString())
            } catch (error: IllegalArgumentException) {
                statusText.text = error.message ?: "請先輸入有效的連線 IP:Port。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                return@setOnClickListener
            }
            val pairingTarget = try {
                normalizeAdbTarget(pairingTargetInput.text.toString())
            } catch (error: IllegalArgumentException) {
                statusText.text = error.message ?: "請輸入有效的配對 IP:Port。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                return@setOnClickListener
            }
            val pairingCode = pairingCodeInput.text.toString().trim()
            if (!pairingCode.matches(Regex("[0-9]{6}"))) {
                statusText.text = "Wireless Debugging 配對碼必須是 6 位數字。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                return@setOnClickListener
            }

            pairButton.isEnabled = false
            statusText.setTextColor(Color.rgb(148, 163, 184))
            statusText.text = "正在通知 Termux 配對 $pairingTarget，再連線 $target…"
            val result = TermuxBridge.pairAdbTarget(this, pairingTarget, pairingCode, target)
            if (result.isFailure) {
                statusText.text = result.exceptionOrNull()?.message
                    ?: "無法通知 Termux；請確認已允許執行 Termux 指令。"
                statusText.setTextColor(Color.rgb(248, 113, 113))
                pairButton.isEnabled = true
                return@setOnClickListener
            }
            statusText.text = "配對指令已送出，正在確認 ADB 連線…"
            refreshAdbStatus(targetInput, statusText, retries = 8, delayMs = 800L)
            pairButton.isEnabled = true
        }

        dialog.setOnShowListener {
            refreshAdbStatus(targetInput, statusText)
        }
        dialog.show()
    }

    private fun normalizeAdbTarget(rawValue: String): String {
        val value = rawValue.trim().replace('：', ':').replace(" ", "")
        if (value.matches(Regex("[0-9]{1,5}"))) {
            val port = value.toInt()
            require(port in 1..65535) { "Port 必須介於 1 到 65535。" }
            return "127.0.0.1:$port"
        }

        val match = Regex("(?:[A-Za-z0-9._-]+):(\\d{1,5})").matchEntire(value)
            ?: Regex("\\[[0-9A-Fa-f:]+\\]:(\\d{1,5})").matchEntire(value)
            ?: throw IllegalArgumentException("請輸入 IP:Port，例如 192.0.2.1:37753。")
        val port = match.groupValues[1].toInt()
        require(port in 1..65535) { "Port 必須介於 1 到 65535。" }
        return value
    }

    private fun refreshAdbStatus(
        targetInput: EditText,
        statusView: TextView,
        retries: Int = 0,
        delayMs: Long = 0L
    ) {
        adbStatusTask?.cancel(false)
        adbStatusTask = poller.schedule({
            val status = readAdbStatus()
            runOnUiThread {
                if (adbDialog?.isShowing != true) return@runOnUiThread
                if (status != null) {
                    if (targetInput.text.isNullOrBlank() && status.target.isNotBlank()) {
                        targetInput.setText(status.target)
                        targetInput.setSelection(targetInput.length())
                    }
                    if (status.connected) {
                        statusView.text = "🟢 ADB 已連線：${status.target.ifBlank { "目前裝置" }}"
                        statusView.setTextColor(Color.rgb(52, 211, 153))
                    } else {
                        val detail = status.lastOutput.split('\n')
                            .filter { it.isNotBlank() }
                            .takeLast(2)
                            .joinToString("\n")
                        statusView.text = "🔴 尚未連線：${status.target.ifBlank { "尚未設定" }}\n" +
                            (detail.ifBlank { "儲存後會由 Termux 執行 adb connect。" })
                        statusView.setTextColor(Color.rgb(248, 113, 113))
                    }
                    if (!status.connected && retries > 0) {
                        refreshAdbStatus(targetInput, statusView, retries - 1, 500L)
                    }
                } else {
                    statusView.text = "⚠️ Crew runtime 尚未回應；仍可先儲存設定。"
                    statusView.setTextColor(Color.rgb(251, 191, 36))
                    if (retries > 0) refreshAdbStatus(targetInput, statusView, retries - 1, 500L)
                }
            }
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun readAdbStatus(): AdbStatus? {
        return try {
            val connection = URL("${SERVER_URL}api/adb").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1000
            connection.readTimeout = 1000
            connection.useCaches = false
            try {
                if (connection.responseCode !in 200..299) return null
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                AdbStatus(
                    json.optString("target"),
                    json.optBoolean("connected"),
                    json.optString("last_output")
                )
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun openWirelessDebugSystemSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
        try {
            startActivity(intent)
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
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
