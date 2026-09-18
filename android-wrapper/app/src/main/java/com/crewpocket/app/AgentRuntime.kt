package com.crewpocket.app

import android.content.Context

interface AgentRuntime {
    val id: String
    fun isAvailable(context: Context): Boolean
    fun startCrewHost(context: Context): Result<Unit>
    fun stopCrewHost(context: Context): Result<Unit>
}

object TermuxAgentRuntime : AgentRuntime {
    override val id: String = "termux"

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
    val productionHost: AgentRuntime = TermuxAgentRuntime

    // Compatibility alias for older experimental embedded-runtime code.
    val fallbackHost: AgentRuntime = productionHost
}
