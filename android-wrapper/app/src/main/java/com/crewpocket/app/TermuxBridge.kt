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

    /**
     * Persist the Wireless Debugging endpoint in Termux and ask adb to connect.
     *
     * The APK cannot run adb in its own sandbox. Keeping this small operation
     * behind the existing Termux RunCommand bridge gives the native setup sheet
     * the same source of truth as install-apk.sh and the web diagnostics page.
     */
    fun setAdbTarget(context: Context, target: String): Result<Unit> {
        val normalized = validateAdbEndpoint(target)

        val safeTarget = normalized.replace("'", "'\\\"'\\\"'")
        val command = """
            set -eu
            mkdir -p "${'$'}HOME/.crew-pocket"
            printf '%s\n' '$safeTarget' > "${'$'}HOME/.adb_port"
            echo "connect: ${'$'}(adb connect '$safeTarget' 2>&1 || true)" > "${'$'}HOME/.crew-pocket/adb-last-result"
        """.trimIndent()
        return runCrewScript(context, command)
    }

    /** Pair a fresh Wireless Debugging endpoint, then connect the ADB endpoint. */
    fun pairAdbTarget(
        context: Context,
        pairingTarget: String,
        pairingCode: String,
        target: String
    ): Result<Unit> {
        val safePairingTarget = validateAdbEndpoint(pairingTarget)
        val safeTarget = validateAdbEndpoint(target)
        val safeCode = pairingCode.trim()
        require(safeCode.matches(Regex("[0-9]{6}"))) {
            "Wireless Debugging 配對碼必須是 6 位數字"
        }

        val command = """
            set -eu
            mkdir -p "${'$'}HOME/.crew-pocket"
            printf '%s\n' '$safeTarget' > "${'$'}HOME/.adb_port"
            {
                echo "pair: ${'$'}(adb pair '$safePairingTarget' '$safeCode' 2>&1 || true)"
                echo "connect: ${'$'}(adb connect '$safeTarget' 2>&1 || true)"
            } > "${'$'}HOME/.crew-pocket/adb-last-result"
        """.trimIndent()
        return runCrewScript(context, command)
    }


    /**
     * Attempt to reconnect to the phone's OWN loopback ADB TLS port, using
     * Termux's pre-existing ADB key. Never pairs or prompts for a code.
     * Only save the new port after adb reports an authorized 'device'.
     */
    fun reconnectPairedAdb(context: Context, port: Int): Result<Unit> {
        require(port in 1..65535) { "Invalid local ADB port" }
        val command = """
            set -eu
            umask 077
            mkdir -p "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.crew-pocket"
            if [ ! -s "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.android/adbkey" ]; then
                printf '%s\n' 'reconnect: not paired in Termux' > "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.crew-pocket/adb-last-result"
                exit 0
            fi
            if ! command -v adb >/dev/null 2>&1; then
                printf '%s\n' 'reconnect: adb unavailable' > "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.crew-pocket/adb-last-result"
                exit 0
            fi
            if command -v timeout >/dev/null 2>&1; then
                timeout 8 adb connect '127.0.0.1:$port' >/dev/null 2>&1 || true
            else
                adb connect '127.0.0.1:$port' >/dev/null 2>&1 || true
            fi
            if adb devices | grep -E '^127[.]0[.]0[.]1:$port[[:space:]]+device([[:space:]]|$)' >/dev/null; then
                printf '%s\n' '127.0.0.1:$port' > "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.adb_port"
                printf '%s\n' 'reconnect: connected' > "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.crew-pocket/adb-last-result"
            else
                printf '%s\n' 'reconnect: no authorized device (enable Wireless Debugging or pair once)' > "\${'
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
}HOME/.crew-pocket/adb-last-result"
            fi
        """.trimIndent()
        return runCrewScript(context, command)
    }

    private fun validateAdbEndpoint(target: String): String {
        val normalized = target.trim().replace('：', ':').replace(" ", "")
        require(normalized.matches(Regex("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:]+\\]):[1-9][0-9]{0,4}"))) {
            "Invalid Wireless Debugging endpoint"
        }
        val port = normalized.substringAfterLast(':').removeSuffix("]").toIntOrNull()
        require(port != null && port in 1..65535) { "Invalid Wireless Debugging port" }
        return normalized
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
