package com.crewpocket.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.concurrent.atomic.AtomicInteger

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
    private const val EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"

    private const val TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash"
    private const val TERMUX_HOME = "/data/data/com.termux/files/home"
    private val requestIds = AtomicInteger(7800)

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

    fun migrateCodexAuth(context: Context): Result<Unit> {
        val callbackIntent = Intent(context, TermuxResultService::class.java)
            .putExtra(
                TermuxResultService.EXTRA_OPERATION,
                TermuxResultService.OP_MIGRATE_CODEX_AUTH
            )
        val pendingIntentFlags = PendingIntent.FLAG_ONE_SHOT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            }
        val pendingIntent = PendingIntent.getService(
            context,
            requestIds.incrementAndGet(),
            callbackIntent,
            pendingIntentFlags
        )

        val command =
            "test -s \"\$HOME/.codex/auth.json\" || exit 4\n" +
                "cat \"\$HOME/.codex/auth.json\""

        return runCrewScript(context, command, pendingIntent)
    }

    fun provisionEmbeddedBridgeToken(context: Context, token: String): Result<Unit> {
        require(token.matches(Regex("[0-9a-f]{64}"))) { "Invalid bridge token" }

        val command =
            "umask 077\n" +
                "mkdir -p \"\$HOME/.crew-pocket\"\n" +
                "printf '%s\\n' '$token' > \"\$HOME/.crew-pocket/embedded-bridge-token\""

        return runCrewScript(context, command)
    }

    private fun runCrewScript(
        context: Context,
        command: String,
        resultPendingIntent: PendingIntent? = null
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
            if (resultPendingIntent != null) {
                putExtra(EXTRA_PENDING_INTENT, resultPendingIntent)
            }
        }

        return runCatching {
            context.startService(intent)
            Unit
        }
    }
}
