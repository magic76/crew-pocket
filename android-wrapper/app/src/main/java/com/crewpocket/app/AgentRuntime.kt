package com.crewpocket.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

interface AgentRuntime {
    val id: String
    val label: String
    fun isAvailable(context: Context): Boolean
    fun startCrewHost(context: Context): Result<Unit>
    fun stopCrewHost(context: Context): Result<Unit>
}

object CompanionAgentRuntime : AgentRuntime {
    const val PACKAGE_NAME = "com.crewpocket.runtime"
    private const val SERVICE_NAME = "com.crewpocket.runtime.CrewRuntimeHostService"
    private const val META_READY = "com.crewpocket.runtime.READY"
    private const val ACTION_START = "com.crewpocket.runtime.action.START"
    private const val ACTION_STOP = "com.crewpocket.runtime.action.STOP"

    override val id: String = "companion-runtime"
    override val label: String = "Crew Runtime"

    fun isInstalled(context: Context): Boolean {
        return try {
            context.packageManager.getPackageInfo(PACKAGE_NAME, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    @Suppress("DEPRECATION")
    fun isReady(context: Context): Boolean {
        if (!isInstalled(context)) return false
        return try {
            val info = context.packageManager.getApplicationInfo(
                PACKAGE_NAME,
                PackageManager.GET_META_DATA
            )
            info.metaData?.getBoolean(META_READY, false) == true
        } catch (_: Exception) {
            false
        }
    }

    override fun isAvailable(context: Context): Boolean = isReady(context)

    override fun startCrewHost(context: Context): Result<Unit> {
        if (!isReady(context)) {
            return Result.failure(IllegalStateException("Crew Runtime companion is not ready"))
        }
        return runCatching {
            val intent = Intent(ACTION_START)
                .setComponent(ComponentName(PACKAGE_NAME, SERVICE_NAME))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            Unit
        }
    }

    override fun stopCrewHost(context: Context): Result<Unit> {
        if (!isInstalled(context)) return Result.success(Unit)
        return runCatching {
            val intent = Intent(ACTION_STOP)
                .setComponent(ComponentName(PACKAGE_NAME, SERVICE_NAME))
            context.startService(intent)
            Unit
        }
    }
}

object TermuxAgentRuntime : AgentRuntime {
    override val id: String = "termux"
    override val label: String = "Termux engine"

    override fun isAvailable(context: Context): Boolean {
        return TermuxBridge.isInstalled(context) && TermuxBridge.hasRunCommandPermission(context)
    }

    override fun startCrewHost(context: Context): Result<Unit> {
        return TermuxBridge.startCrew(context)
    }

    override fun stopCrewHost(context: Context): Result<Unit> {
        return TermuxBridge.stopCrew(context)
    }
}

object RuntimeManager {
    private const val PREFS = "crew_runtime"
    private const val KEY_COMPANION_ENABLED = "companion_runtime_enabled"

    fun isCompanionEnabled(context: Context): Boolean {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_COMPANION_ENABLED, true)
    }

    fun setCompanionEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_COMPANION_ENABLED, enabled)
            .apply()
    }

    fun productionHost(context: Context): AgentRuntime {
        if (isCompanionEnabled(context) && CompanionAgentRuntime.isAvailable(context)) {
            return CompanionAgentRuntime
        }
        return TermuxAgentRuntime
    }

    // Compatibility helper while the companion runtime is being brought online.
    fun fallbackHost(context: Context): AgentRuntime = TermuxAgentRuntime
}
