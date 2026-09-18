package com.crewpocket.app

import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.io.File

class TermuxResultService : Service() {
    companion object {
        const val EXTRA_OPERATION = "crew_result_operation"
        const val OP_MIGRATE_CODEX_AUTH = "migrate_codex_auth"

        private const val RESULT_BUNDLE = "result"
        private const val RESULT_STDOUT = "stdout"
        private const val RESULT_STDOUT_ORIGINAL_LENGTH = "stdout_original_length"
        private const val RESULT_STDERR = "stderr"
        private const val RESULT_EXIT_CODE = "exitCode"
        private const val RESULT_ERR = "err"
        private const val RESULT_ERRMSG = "errmsg"
        private const val TAG = "TermuxResultService"
        private const val MAX_AUTH_BYTES = 96 * 1024
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.getStringExtra(EXTRA_OPERATION)) {
            OP_MIGRATE_CODEX_AUTH -> handleCodexAuthMigration(intent)
        }
        stopSelf(startId)
        return START_NOT_STICKY
    }

    private fun handleCodexAuthMigration(intent: Intent) {
        val result = intent.getBundleExtra(RESULT_BUNDLE)
        if (result == null) {
            Log.w(TAG, "Codex auth migration returned no result bundle")
            return
        }

        val internalError = result.getInt(RESULT_ERR, -1)
        val exitCode = result.getInt(RESULT_EXIT_CODE, -1)
        val stderr = result.getString(RESULT_STDERR).orEmpty()
        val stdout = result.getString(RESULT_STDOUT).orEmpty()
        val originalLength = result.getInt(RESULT_STDOUT_ORIGINAL_LENGTH, stdout.length)

        if (internalError != -1 || exitCode != 0) {
            val message = result.getString(RESULT_ERRMSG).orEmpty()
            Log.i(
                TAG,
                "Codex auth migration unavailable (internal=${internalError} exit=${exitCode} stderr=${stderr.take(120)} message=${message.take(120)})"
            )
            return
        }

        if (stdout.isBlank() || originalLength > MAX_AUTH_BYTES || stdout.toByteArray().size > MAX_AUTH_BYTES) {
            Log.w(TAG, "Codex auth migration rejected due to empty or oversized result")
            return
        }

        val json = runCatching { JSONObject(stdout) }.getOrNull()
        val tokens = json?.optJSONObject("tokens")
        val accessToken = tokens?.optString("access_token").orEmpty()
        val refreshToken = tokens?.optString("refresh_token").orEmpty()
        if (accessToken.isBlank() || refreshToken.isBlank()) {
            Log.w(TAG, "Codex auth migration rejected because expected token fields are missing")
            return
        }

        val codexHome = File(filesDir, ".codex")
        if (!codexHome.exists() && !codexHome.mkdirs()) {
            Log.w(TAG, "Could not create embedded Codex home")
            return
        }

        val target = File(codexHome, "auth.json")
        val temp = File(codexHome, "auth.json.tmp")
        runCatching {
            temp.writeText(stdout)
            if (target.exists() && !target.delete()) {
                throw IllegalStateException("Could not replace existing embedded auth")
            }
            if (!temp.renameTo(target)) {
                throw IllegalStateException("Could not finalize embedded auth")
            }
        }.onFailure {
            temp.delete()
            Log.e(TAG, "Could not persist embedded Codex auth", it)
            return
        }

        Log.i(TAG, "Embedded Codex auth migrated successfully")
        val refreshIntent = Intent(this, CrewRuntimeService::class.java)
            .setAction(CrewRuntimeService.ACTION_REFRESH_EMBEDDED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(refreshIntent)
        } else {
            startService(refreshIntent)
        }
    }
}
