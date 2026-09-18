package com.crewpocket.app

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class EmbeddedNodeHost(
    private val context: Context,
    private val onExit: (exitCode: Int) -> Unit
) {
    companion object {
        private const val TAG = "EmbeddedNodeHost"
        private const val NODE_LIBRARY = "libnode_exec.so"

        fun binaryFile(context: Context): File {
            return File(context.applicationInfo.nativeLibraryDir, NODE_LIBRARY)
        }

        fun isBinaryBundled(context: Context): Boolean {
            return Build.SUPPORTED_ABIS.contains("arm64-v8a") &&
                binaryFile(context).let { it.isFile && it.canRead() }
        }
    }

    private val observer = Executors.newSingleThreadExecutor()
    @Volatile private var process: Process? = null
    @Volatile private var intentionalStop = false

    fun isRunning(): Boolean = process?.isAlive == true

    fun runtimeDir(workspace: File): File = File(workspace, ".crew-runtime")
    fun logFile(workspace: File): File = File(runtimeDir(workspace), "node.log")
    fun stateFile(workspace: File): File = File(runtimeDir(workspace), "state.json")

    @Synchronized
    fun start(workspace: File, bridgeToken: String): Result<Unit> {
        if (isRunning()) return Result.success(Unit)
        if (!isBinaryBundled(context)) {
            return Result.failure(IllegalStateException("Embedded Node binary is not bundled"))
        }
        if (!File(workspace, "server.js").isFile) {
            return Result.failure(IllegalStateException("Embedded workspace is missing server.js"))
        }

        return runCatching {
            intentionalStop = false
            val runtimeDir = runtimeDir(workspace)
            runtimeDir.mkdirs()
            val log = logFile(workspace)
            val node = binaryFile(context)
            val codexHome = File(context.filesDir, ".codex")
            val uploads = File(context.filesDir, "media")
            val brain = File(context.filesDir, "brain")
            val tokenFile = File(File(context.filesDir, ".crew-pocket"), "embedded-bridge-token")
            codexHome.mkdirs()
            uploads.mkdirs()
            brain.mkdirs()
            tokenFile.parentFile?.mkdirs()
            tokenFile.writeText(bridgeToken + "\n")

            val builder = ProcessBuilder(node.absolutePath, "server.js")
            builder.directory(workspace)
            builder.redirectOutput(ProcessBuilder.Redirect.appendTo(log))
            builder.redirectError(ProcessBuilder.Redirect.appendTo(log))
            builder.environment().apply {
                put("HOME", context.filesDir.absolutePath)
                put("CODEX_HOME", codexHome.absolutePath)
                put("TMPDIR", context.cacheDir.absolutePath)
                put("PORT", "8000")
                put("CREW_BIND_HOST", "127.0.0.1")
                put("CREW_HOST_RUNTIME", "embedded-node")
                put("CREW_UPLOADS_DIR", uploads.absolutePath)
                put("CREW_PREVIOUS_UPLOADS_DIR", uploads.absolutePath)
                put("CREW_BRAIN_DIR", brain.absolutePath)
                put("CREW_EMBEDDED_WORKSPACE_ROOT", File(context.filesDir, "workspaces").absolutePath)
                put("CREW_CODEX_BRIDGE_TOKEN_FILE", tokenFile.absolutePath)
                put("SHELL", "/system/bin/sh")
                put("PATH", "/system/bin:/system/xbin:/product/bin")
                put("LD_LIBRARY_PATH", context.applicationInfo.nativeLibraryDir)
            }

            val started = builder.start()
            process = started
            writeState(
                workspace,
                status = "starting",
                exitCode = null,
                detail = "Embedded Node started"
            )

            observer.execute {
                val code = try {
                    started.waitFor()
                } catch (_: InterruptedException) {
                    -1
                }

                val shouldHandleExit = synchronized(this) {
                    val isCurrentProcess = process === started
                    if (isCurrentProcess) process = null
                    isCurrentProcess
                }

                // A previous process can finish after a new takeover has
                // already started. Never let that stale waiter overwrite the
                // new runtime state or report a fake crash.
                if (shouldHandleExit) {
                    val stoppedIntentionally = intentionalStop
                    writeState(
                        workspace,
                        status = if (stoppedIntentionally) "stopped" else "exited",
                        exitCode = code,
                        detail = if (stoppedIntentionally) "Intentional stop" else "Unexpected exit"
                    )
                    if (!stoppedIntentionally) onExit(code)
                }
            }
            Unit
        }
    }

    @Synchronized
    fun stop() {
        intentionalStop = true
        val current = process ?: return
        try {
            current.destroy()
            if (current.isAlive) {
                Thread.sleep(150)
                if (current.isAlive) current.destroyForcibly()
            }
        } catch (_: Exception) {
        } finally {
            process = null
        }
    }

    fun shutdown() {
        stop()
        observer.shutdownNow()
    }

    fun sourceFingerprint(workspace: File): String {
        if (!workspace.isDirectory) return "missing"
        var newest = 0L
        var count = 0L
        var bytes = 0L

        workspace.walkTopDown()
            .onEnter { dir ->
                val name = dir.name
                name !in setOf(".git", "node_modules", "build", ".gradle", ".crew-runtime")
            }
            .filter { file ->
                file.isFile && (
                    file.extension in setOf("js", "json", "html", "css", "md", "kt", "kts") ||
                    file.name in setOf("server.js", "AGENTS.md", "GEMINI.md")
                )
            }
            .forEach { file ->
                newest = maxOf(newest, file.lastModified())
                count += 1
                bytes += file.length()
            }

        return "$newest:$count:$bytes"
    }

    fun writeState(
        workspace: File,
        status: String,
        exitCode: Int?,
        detail: String,
        extra: Map<String, Any?> = emptyMap()
    ) {
        runCatching {
            val dir = runtimeDir(workspace)
            dir.mkdirs()
            val json = JSONObject()
                .put("status", status)
                .put("detail", detail)
                .put("updatedAt", System.currentTimeMillis())
                .put("processAlive", process?.isAlive == true)
                .put("exitCode", exitCode ?: JSONObject.NULL)
                .put("sourceFingerprint", sourceFingerprint(workspace))
                .put("logPath", logFile(workspace).absolutePath)

            extra.forEach { (key, value) -> json.put(key, value ?: JSONObject.NULL) }
            stateFile(workspace).writeText(json.toString(2))
        }.onFailure {
            Log.w(TAG, "Could not write runtime state", it)
        }
    }
}
