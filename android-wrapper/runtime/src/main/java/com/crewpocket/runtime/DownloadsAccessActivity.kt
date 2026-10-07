package com.crewpocket.runtime

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.net.Uri
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** The grant belongs to Runtime's UID, including its Node and provider children. */
class DownloadsAccessActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Downloads 存取"
        val padding = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }
        layout.addView(TextView(this).apply {
            text = "允許 Crew Runtime 讀寫手機 Downloads，讓 Agent 處理下載的文件、ZIP 與 APK。\n\nAndroid 11 以上需要在下一頁手動開啟「管理所有檔案」。這項權限也能存取其他共用儲存資料夾，不只 Downloads；不會開放其他 App 的私有資料。你可以隨時在系統設定關閉。"
            textSize = 16f
        })
        status = TextView(this).apply { setPadding(0, padding, 0, padding); textSize = 14f }
        layout.addView(status)
        layout.addView(Button(this).apply {
            text = "開啟 Android 授權設定"
            setOnClickListener {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    runCatching {
                        startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                            Uri.parse("package:$packageName")))
                    }.onFailure {
                        runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
                            .onFailure { status.text = "無法開啟設定；請到 Android 特殊存取權 → 管理所有檔案，選擇 ${packageManager.getApplicationLabel(applicationInfo)}。" }
                    }
                } else {
                    requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
                }
            }
        })
        layout.addView(Button(this).apply { text = "返回 Pocket"; setOnClickListener { finish() } })
        setContentView(layout)
        SharedDownloads.prepare(this)
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshStatus()
    }

    private fun refreshStatus() {
        val target = SharedDownloads.directory()
        status.text = if (SharedDownloads.granted(this))
            "已授權\nAgent 路徑：~/storage/downloads\n實際路徑：${target.absolutePath}"
        else "尚未授權。開啟權限後返回此頁，Agent 才能讀寫 Downloads。"
    }
}
