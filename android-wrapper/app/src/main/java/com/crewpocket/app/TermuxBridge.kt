package com.crewpocket.app

import android.Manifest
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

    fun startCrew(context: Context): Result<Unit> = runCrewScript(
        context,
        """
        ROOT="$HOME/agy-web"
        [ -d "$HOME/crew-pocket" ] && ROOT="$HOME/crew-pocket"
        exec "$ROOT/scripts/android-runtime-start.sh"
        """.trimIndent()
    )

    fun stopCrew(context: Context): Result<Unit> = runCrewScript(
        context,
        """
        ROOT="$HOME/agy-web"
        [ -d "$HOME/crew-pocket" ] && ROOT="$HOME/crew-pocket"
        exec "$ROOT/scripts/android-runtime-stop.sh"
        """.trimIndent()
    )

    private fun runCrewScript(context: Context, command: String): Result<Unit> {
        if (!isInstalled(context)) {
            return Result.failure(IllegalStateException("Termux is not installed"))
        }
        if (!hasRunCommandPermission(context)) {
            return Result.failure(SecurityException("Run commands in Termux permission is not granted"))
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
