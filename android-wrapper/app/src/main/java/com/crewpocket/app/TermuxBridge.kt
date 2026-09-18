package com.crewpocket.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

object TermuxBridge {
    const val TERMUX_PACKAGE = "com.termux"
    const val RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"

    private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
    private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"
    private const val EXTRA_PATH = "com.termux.RUN_COMMAND_PATH"
    private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
    private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
    private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
    private const val EXTRA_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION"

    private const val TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash"
    private const val TERMUX_HOME = "/data/data/com.termux/files/home"

    fun isInstalled(context: Context): Boolean {
        return try {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    fun hasRunCommandPermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            context.checkSelfPermission(RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    fun startCrew(context: Context): Result<Unit> {
        return runCrewScript(
            context,
            "exec \"\$HOME/agy-web/scripts/android-runtime-start.sh\""
        )
    }

    fun stopCrew(context: Context): Result<Unit> {
        return runCrewScript(
            context,
            "exec \"\$HOME/agy-web/scripts/android-runtime-stop.sh\""
        )
    }

    fun provisionEmbeddedBridgeToken(context: Context, token: String): Result<Unit> {
        require(token.matches(Regex("[0-9a-f]{64}"))) { "Invalid bridge token" }

        val command =
            "umask 077\n" +
                "mkdir -p \"\$HOME/.crew-pocket\"\n" +
                "printf '%s\\n' '$token' > \"\$HOME/.crew-pocket/embedded-bridge-token\""

        return runCrewScript(context, command)
    }

    fun migrateExistingHistory(context: Context, token: String): Result<Unit> {
        require(token.matches(Regex("[0-9a-f]{64}"))) { "Invalid history migration token" }

        val command = """
            set -eu
            cd "${'$'}HOME"
            items=".gemini/antigravity-cli/brain .codex/sessions"
            if [ -f .crew-pocket/conversation-settings.json ]; then
                items="${'$'}items .crew-pocket/conversation-settings.json"
            fi
            if [ -d .crew-pocket/live-memos ]; then
                items="${'$'}items .crew-pocket/live-memos"
            fi
            tar -czf - ${'$'}items | curl --fail --silent --show-error --max-time 900 \
                -X POST -H 'X-Crew-History-Import-Token: $token' \
                --data-binary @- http://127.0.0.1:8000/api/runtime/history-migration
        """.trimIndent()
        return runCrewScript(context, command)
    }

    private fun runCrewScript(
        context: Context,
        command: String
    ): Result<Unit> {
        if (!isInstalled(context)) {
            return Result.failure(IllegalStateException("Termux is not installed"))
        }
        if (!hasRunCommandPermission(context)) {
            return Result.failure(
                SecurityException("Run commands in Termux permission is not granted")
            )
        }

        val intent = Intent().apply {
            setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE)
            action = ACTION_RUN_COMMAND
            putExtra(EXTRA_PATH, TERMUX_BASH)
            putExtra(EXTRA_ARGUMENTS, arrayOf("-lc", command))
            putExtra(EXTRA_WORKDIR, TERMUX_HOME)
            putExtra(EXTRA_BACKGROUND, true)
            putExtra(EXTRA_SESSION_ACTION, "0")
        }

        return runCatching {
            context.startService(intent)
            Unit
        }
    }
}
