package com.crewpocket.app

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Pocket owns staging/install state so replacing Runtime cannot kill the updater. */
class RuntimeUpdateController(private val activity: Activity, private val idleCheck: ((Boolean) -> Unit) -> Unit) {
    companion object {
        const val REQUEST_APK = 7610
        const val REQUEST_INSTALL_PERMISSION = 7611
        const val PREFS = "crew_runtime_update"
        @Volatile private var working = false
        fun state(context: Context, state: String, message: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("state", state).putString("message", message).commit()
        }
    }
    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val worker = Executors.newSingleThreadExecutor()
    private val apk get() = File(activity.filesDir, "runtime-update.apk")
    private fun ui(block: () -> Unit) { activity.runOnUiThread { if (!activity.isDestroyed) block() } }
    private fun message(text: String) = ui { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }
    private fun work(block: () -> Unit) {
        if (working) { message("目前正在處理更新"); return }
        working = true
        worker.execute {
            try { block() } catch (e: Exception) {
                state(activity, "failed", e.message ?: "更新失敗")
                message(e.message ?: "更新失敗")
            } finally { working = false }
        }
    }
    fun close() { worker.shutdown() }
    fun show() {
        if (working) { message("更新處理中，請稍候"); return }
        val state = prefs.getString("state", "idle")
        if (state == "installing") {
            AlertDialog.Builder(activity).setTitle("等待安裝確認").setMessage("請完成 Android 安裝畫面。")
                .setPositiveButton("繼續安裝") { _, _ ->
                    val saved = prefs.getString("confirmation", null)
                    if (saved != null) activity.startActivity(Intent.parseUri(saved, 0))
                    else message("安裝程序仍在處理，請稍候")
                }.setNegativeButton("關閉", null).show()
            return
        }
        val options = mutableListOf("貼上下載連結與 SHA256", "選擇已下載的 Runtime APK")
        if (state == "prepared") options.add("安裝已檢查的 APK")
        if (state == "verifying" || state == "installed" || (state == "failed" && prefs.contains("beforeUpdate"))) options.add("重新檢查更新結果")
        AlertDialog.Builder(activity).setTitle("更新 Crew Runtime${if (BuildConfig.DEBUG) " Dev" else ""}")
            .setMessage(prefs.getString("message", "先準備 APK，確認後才安裝。登入與工作區會保留。"))
            .setPositiveButton("繼續") { _, _ ->
                AlertDialog.Builder(activity).setTitle("更新方式").setItems(options.toTypedArray()) { _, i ->
                    when (options[i]) {
                        "貼上下載連結與 SHA256" -> downloadDialog()
                        "選擇已下載的 Runtime APK" -> activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE).setType("application/vnd.android.package-archive"), REQUEST_APK)
                        "安裝已檢查的 APK" -> confirmInstall()
                        else -> verify()
                    }
                }.setNegativeButton("取消", null).show()
            }.setNegativeButton("關閉", null).show()
    }
    private fun downloadDialog() {
        val url = EditText(activity).apply { hint = "https://… 或目前 Dev 的 APK 產物連結"; inputType = 17 }
        val hash = EditText(activity).apply { hint = "APK SHA256（64 個十六進位字元）"; inputType = 1 }
        val layout = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 8, 24, 8); addView(url); addView(hash) }
        AlertDialog.Builder(activity).setTitle("下載 Runtime APK").setView(layout)
            .setPositiveButton("下載並檢查") { _, _ ->
                val expected = hash.text.toString().trim().lowercase()
                if (!expected.matches(Regex("[a-f0-9]{64}"))) { message("請提供完整 SHA256"); return@setPositiveButton }
                val raw = url.text.toString().trim()
                work {
                    val source = if (raw.startsWith("/api/build-artifacts/")) "http://127.0.0.1:${BuildConfig.SERVER_PORT}$raw" else raw
                    val uri = Uri.parse(source)
                    val local = uri.host in listOf("127.0.0.1", "localhost") && uri.port == BuildConfig.SERVER_PORT &&
                        uri.path.orEmpty().matches(Regex("/api/build-artifacts/[a-f0-9-]{36}/[A-Za-z0-9._-]+\\.apk"))
                    require((uri.scheme == "https" || (uri.scheme == "http" && local)) && uri.userInfo == null) { "僅接受 HTTPS 或目前 Runtime 的 APK 產物連結" }
                    state(activity, "downloading", "正在下載 Runtime APK")
                    var current = source
                    var connection: HttpURLConnection? = null
                    try {
                        for (redirect in 0..5) {
                            connection = URL(current).openConnection() as HttpURLConnection
                            connection.connectTimeout = 15000; connection.readTimeout = 30000
                            connection.instanceFollowRedirects = false
                            val code = connection.responseCode
                            if (code in 300..399) {
                                require(!local && redirect < 5) { "不接受此下載重新導向" }
                                val next = URL(URL(current), connection.getHeaderField("Location") ?: error("缺少 Location")).toString()
                                require(Uri.parse(next).scheme == "https" && Uri.parse(next).userInfo == null) { "重新導向必須使用 HTTPS" }
                                connection.disconnect(); current = next; continue
                            }
                            require(code == 200) { "下載失敗：HTTP $code" }
                            copy(connection.inputStream)
                            break
                        }
                    } finally { connection?.disconnect() }
                    require(digest(apk) == expected) { apk.delete(); "SHA256 不符，已刪除下載檔案" }
                    prepare()
                }
            }.setNegativeButton("取消", null).show()
    }
    private fun copy(input: java.io.InputStream) {
        val partial = File(activity.filesDir, "runtime-update.partial")
        try {
            input.use { src -> partial.outputStream().use { out ->
                val buffer = ByteArray(1024 * 1024); var total = 0L
                while (true) { val n = src.read(buffer); if (n < 0) break; total += n
                    require(total <= 2L * 1024 * 1024 * 1024) { "APK 超過 2GB" }; out.write(buffer, 0, n) }
            } }
            require(partial.length() > 0) { "APK 是空檔案" }
            require(partial.renameTo(apk)) { "無法保存 APK" }
        } finally { partial.delete() }
    }
    fun selected(uri: Uri) = work {
        state(activity, "downloading", "正在讀取 APK")
        copy(activity.contentResolver.openInputStream(uri) ?: error("無法開啟 APK"))
        prepare()
    }
    private fun digest(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val b = ByteArray(1024 * 1024); while (true) { val n = input.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    @Suppress("DEPRECATION")
    private fun checkApk(): android.content.pm.PackageInfo {
        val pm = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.path, flags or PackageManager.GET_META_DATA) ?: error("無法解析 Runtime APK")
        require(archive.applicationInfo?.metaData?.getBoolean("com.crewpocket.runtime.READY", false) == true) { "APK 未啟用 companion 或缺少完整 payload" }
        require(archive.applicationInfo?.metaData?.getInt("com.crewpocket.runtime.PROTOCOL_VERSION", 0) == 1) { "Runtime protocol 不相容" }
        require(archive.packageName == BuildConfig.RUNTIME_PACKAGE) { "APK package 必須是 ${BuildConfig.RUNTIME_PACKAGE}" }
        java.util.zip.ZipFile(apk).use { zip ->
            require(listOf("assets/provider-manifests/codex.json", "lib/arm64-v8a/libcodex_exec.so", "lib/arm64-v8a/libnode_exec.so").all { zip.getEntry(it) != null }) { "APK 缺少 Runtime 必要 payload" }
        }
        val installed = pm.getPackageInfo(BuildConfig.RUNTIME_PACKAGE, flags)
        fun certs(info: android.content.pm.PackageInfo) =
            (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)
                ?.map { it.toCharsString() }?.toSet().orEmpty()
        require(certs(archive).isNotEmpty() && certs(archive) == certs(installed)) { "APK 簽章與已安裝 Runtime 不相容；請使用原本的簽章重新建置" }
        val newVersion = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        val oldVersion = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
        require(newVersion >= oldVersion) { "不允許降級 Runtime versionCode" }
        return archive
    }
    private fun prepare() {
        val info = checkApk()
        prefs.edit().remove("beforeUpdate").remove("sessionId").remove("confirmation").putString("sha256", digest(apk)).putString("version", info.versionName).commit()
        state(activity, "prepared", "APK 已檢查：${info.versionName}。package 與簽章相容，尚未安裝。")
        ui { confirmInstall() }
    }
    private fun confirmInstall() {
        AlertDialog.Builder(activity).setTitle("安裝 Runtime 更新？")
            .setMessage("版本：${prefs.getString("version", "") }\n更新會停止 Runtime。請先結束 Live 通話、Terminal 與所有任務；登入、歷史和工作區會保留。")
            .setPositiveButton("檢查並安裝") { _, _ -> idleCheck { idle ->
                if (!idle) message("請先結束 Live 通話與文字任務") else install()
            } }.setNegativeButton("稍後", null).show()
    }
    private fun json(path: String): JSONObject {
        val c = URL("http://127.0.0.1:${BuildConfig.SERVER_PORT}$path").openConnection() as HttpURLConnection
        c.connectTimeout = 3000; c.readTimeout = 5000; c.instanceFollowRedirects = false
        try { require(c.responseCode in 200..299) { "Runtime 無法回應安全檢查" }; return JSONObject(c.inputStream.bufferedReader().use { it.readText() }) }
        finally { c.disconnect() }
    }
    private fun install() {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")), REQUEST_INSTALL_PERMISSION)
            return
        }
        work {
            checkApk()
            require(digest(apk) == prefs.getString("sha256", "")) { "已準備的 APK 被修改" }
            require(json("/api/runtime/update-readiness").optBoolean("idle", false)) { "仍有任務或 Terminal 執行中，請稍後更新" }
            val installer = activity.packageManager.packageInstaller
            val parameters = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(BuildConfig.RUNTIME_PACKAGE); setSize(apk.length())
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
            }
            val id = installer.createSession(parameters)
            try {
                installer.openSession(id).use { session ->
                    session.openWrite("runtime.apk", 0, apk.length()).use { output -> apk.inputStream().use { it.copyTo(output) }; session.fsync(output) }
                    val before = activity.packageManager.getPackageInfo(BuildConfig.RUNTIME_PACKAGE, 0).lastUpdateTime
                    prefs.edit().putLong("beforeUpdate", before).putInt("sessionId", id).commit()
                    state(activity, "installing", "等待 Android 確認安裝")
                    val callback = Intent(activity, RuntimeInstallReceiver::class.java).setAction("${activity.packageName}.RUNTIME_INSTALL")
                    val pending = PendingIntent.getBroadcast(activity, id, callback, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                    session.commit(pending.intentSender)
                }
            } catch (e: Exception) { installer.abandonSession(id); throw e }
        }
    }
    fun resume() {
        when (prefs.getString("state", "idle")) {
            "installed", "verifying" -> verify()
            "installing" -> {
                val info = activity.packageManager.getPackageInfo(BuildConfig.RUNTIME_PACKAGE, 0)
                if (info.lastUpdateTime > prefs.getLong("beforeUpdate", Long.MAX_VALUE)) verify()
                else if (activity.packageManager.packageInstaller.getSessionInfo(prefs.getInt("sessionId", -1)) == null)
                    state(activity, "prepared", "安裝未完成，可重新安裝已檢查的 APK")
            }
            "downloading" -> if (!working) state(activity, "failed", "下載被中斷，請重新下載")
        }
    }
    private fun verify() = work {
        state(activity, "verifying", "已安裝，正在恢復並檢查 Runtime")
        val installed = activity.packageManager.getPackageInfo(BuildConfig.RUNTIME_PACKAGE, 0)
        require(digest(File(installed.applicationInfo!!.sourceDir)) == prefs.getString("sha256", "")) { "已安裝 APK 與更新檔案不一致" }
        // MainActivity.onStart owns normal Runtime startup; verification never interrupts sessions.
        var healthy = false
        for (i in 0..59) {
            try {
                val statusPort = if (BuildConfig.DEBUG) 8868 else 8768
                val c = URL("http://127.0.0.1:$statusPort/status").openConnection() as HttpURLConnection
                c.connectTimeout = 1000; c.readTimeout = 1000
                val status = try { JSONObject(c.inputStream.bufferedReader().use { it.readText() }) } finally { c.disconnect() }
                if (status.optString("hostState") == "running" && status.optBoolean("ready")) {
                    val health = URL("http://127.0.0.1:${BuildConfig.SERVER_PORT}/healthz").openConnection() as HttpURLConnection
                    health.connectTimeout = 1000; health.readTimeout = 1000
                    healthy = try { health.responseCode in 200..299 } finally { health.disconnect() }
                    if (healthy) break
                }
            } catch (_: Exception) { }
            Thread.sleep(2000)
        }
        require(healthy) { "新版已安裝，但 Runtime 未能恢復；可從更新面板重新檢查" }
        val result = json("/api/runtime/providers")
        val codex = result.getJSONObject("providers").getJSONObject("codex").optString("version")
        require(json("/api/runtime/update-readiness").optBoolean("idle", false)) { "新版 Runtime 與 Node 正常，但目前仍有任務；請稍後重新檢查 Codex" }
        val c = URL("http://127.0.0.1:${BuildConfig.SERVER_PORT}/api/chat").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = 90000
        c.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("provider", "codex").put("effort", "low")
            .put("prompt", "這是 Runtime 更新驗證。請實際執行 node -e \"console.log('RUNTIME_UPDATE_OK')\"，確認成功後回覆 RUNTIME_UPDATE_OK。不要修改檔案。")
        var completed = false
        var verifiedTool = false
        try {
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            require(c.responseCode == 200) { "Codex 驗證失敗：HTTP ${c.responseCode}" }
            var event = ""; var bytes = 0; val deadline = System.currentTimeMillis() + 90000
            c.inputStream.bufferedReader().use { reader ->
                while (true) {
                    val line = reader.readLine() ?: break
                    bytes += line.length
                    require(bytes < 4 * 1024 * 1024 && System.currentTimeMillis() < deadline) { "Codex 驗證逾時" }
                    if (line.startsWith("event: ")) event = line.removePrefix("event: ")
                    if (line.startsWith("data: ")) {
                        val data = JSONObject(line.removePrefix("data: "))
                        require(event != "error") { "Codex 驗證失敗：${data.optString("message")}" }
                        if (event == "tool") {
                            val info = data.optJSONObject("tool_info")
                            if (data.optString("state") == "completed" && info?.optInt("exitCode", -1) == 0 && info.optString("output").contains("RUNTIME_UPDATE_OK")) verifiedTool = true
                        }
                        if (event == "done") {
                            completed = verifiedTool && data.optString("status") == "completed" && data.optString("response").contains("RUNTIME_UPDATE_OK")
                            break
                        }
                    }
                }
            }
        } finally { c.disconnect() }
        require(completed) { "Runtime 已恢復，但 Codex 最小任務未成功；請重新檢查登入與執行環境" }
        state(activity, "completed", "更新完成。Runtime、Node 與 Codex 最小任務正常。Codex：$codex。")
        apk.delete()
        message(prefs.getString("message", "更新完成")!!)
    }
}

class RuntimeInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirmation = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirmation != null) {
                    context.getSharedPreferences(RuntimeUpdateController.PREFS, Context.MODE_PRIVATE).edit().putString("confirmation", confirmation.toUri(0)).commit()
                    try { context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    catch (_: Exception) { RuntimeUpdateController.state(context, "prepared", "無法開啟安裝確認，請返回 Pocket 重試") }
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                RuntimeUpdateController.state(context, "installed", "Runtime 已安裝；返回 Pocket 後檢查服務")
                context.sendBroadcast(Intent("${context.packageName}.RUNTIME_UPDATE_RESULT").setPackage(context.packageName))
            }
            else -> RuntimeUpdateController.state(context, "prepared", "安裝未完成（$status）：${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()}")
        }
    }
}
