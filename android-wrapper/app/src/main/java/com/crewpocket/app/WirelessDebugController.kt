package com.crewpocket.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
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

class WirelessDebugController(private val activity: Activity) {
    companion object {
        private const val SERVER_URL = "http://127.0.0.1:8000/"
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var adbStatusTask: ScheduledFuture<*>? = null
    private var adbDialog: AlertDialog? = null

    private data class AdbStatus(
        val target: String,
        val connected: Boolean,
        val lastOutput: String
    )
    
    fun show() {
        if (adbDialog?.isShowing == true) return
    
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(4))
        }
        val targetInput = EditText(activity).apply {
            hint = "192.0.2.1:37753 或 37753"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            textSize = 16f
            setSelectAllOnFocus(true)
        }
        val pairingTargetInput = EditText(activity).apply {
            hint = "配對 IP:Port（第一次設定才需要）"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            textSize = 15f
        }
        val pairingCodeInput = EditText(activity).apply {
            hint = "6 位配對碼"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
            textSize = 15f
        }
        val helperText = TextView(activity).apply {
            text = "輸入連線 IP:Port；第一次配對時再填配對 IP:Port 與 6 位配對碼。"
            setTextColor(Color.rgb(100, 116, 139))
            textSize = 12f
            setPadding(0, dp(4), 0, dp(4))
        }
        val statusText = TextView(activity).apply {
            text = "正在讀取目前 ADB 狀態…"
            setTextColor(Color.rgb(148, 163, 184))
            textSize = 12f
            setPadding(0, dp(8), 0, dp(8))
        }
        val saveButton = Button(activity).apply {
            text = "儲存並連線"
            minHeight = dp(48)
        }
        val pairButton = Button(activity).apply {
            text = "配對並連線"
            minHeight = dp(48)
        }
        val secondaryRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val openSettingsButton = Button(activity).apply {
            text = "開啟無線偵錯"
            minHeight = dp(48)
        }
        val copyButton = Button(activity).apply {
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
        val scrollContainer = ScrollView(activity).apply {
            addView(container)
        }
    
        val dialog = AlertDialog.Builder(activity)
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
            val clipboard = activity.getSystemService(ClipboardManager::class.java)
            clipboard?.setPrimaryClip(ClipData.newPlainText("Crew Pocket ADB", command))
            Toast.makeText(activity, "已複製 ADB 設定指令", Toast.LENGTH_SHORT).show()
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
            val result = TermuxBridge.setAdbTarget(activity, target)
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
            val result = TermuxBridge.pairAdbTarget(activity, pairingTarget, pairingCode, target)
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
        adbStatusTask = scheduler.schedule({
            val status = readAdbStatus()
            activity.runOnUiThread {
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
            activity.startActivity(intent)
        } catch (_: Exception) {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }
    
    

    fun close() {
        adbStatusTask?.cancel(false)
        adbStatusTask = null
        adbDialog?.dismiss()
        adbDialog = null
        scheduler.shutdownNow()
    }

    private fun dp(value: Int): Int =
        (value * activity.resources.displayMetrics.density).toInt()
}
