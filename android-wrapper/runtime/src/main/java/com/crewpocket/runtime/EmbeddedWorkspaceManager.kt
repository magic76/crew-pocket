package com.crewpocket.runtime

import android.content.Context
import java.io.File

object EmbeddedWorkspaceManager {
    private const val WORKSPACE_NAME = "crew-host"
    private const val WORKSPACE_ASSET = "crew-workspace"
    private const val MARKER_NAME = ".crew-runtime-source"

    fun workspaceDir(context: Context): File =
        File(File(context.filesDir, "workspaces"), WORKSPACE_NAME)

    fun isReady(context: Context): Boolean {
        val workspace = workspaceDir(context)
        val marker = File(workspace, MARKER_NAME)
        return File(workspace, "server.js").isFile &&
            File(workspace, "lib/providers/codex.js").isFile &&
            marker.isFile &&
            marker.readText().trim() == BuildConfig.VERSION_NAME
    }

    fun ensureWorkspace(context: Context): Result<File> {
        if (isReady(context)) {
            val workspace = workspaceDir(context)
            ensureRuntimeFiles(context, workspace)
            return Result.success(workspace)
        }

        return runCatching {
            val root = File(context.filesDir, "workspaces")
            root.mkdirs()
            val staging = File(root, "$WORKSPACE_NAME.staging")
            staging.deleteRecursively()
            staging.mkdirs()

            copyAssetTree(context, WORKSPACE_ASSET, staging)
            check(File(staging, "server.js").isFile) {
                "Packaged Crew workspace is missing server.js"
            }

            val target = workspaceDir(context)
            val previous = File(root, "$WORKSPACE_NAME.previous")
            previous.deleteRecursively()

            if (target.exists() && !target.renameTo(previous)) {
                target.deleteRecursively()
            }
            if (!staging.renameTo(target)) {
                staging.copyRecursively(target, overwrite = true)
                staging.deleteRecursively()
            }
            previous.deleteRecursively()

            File(target, MARKER_NAME).writeText(BuildConfig.VERSION_NAME)
            ensureRuntimeFiles(context, target)
            target
        }
    }

    private fun ensureRuntimeFiles(context: Context, workspace: File) {
        val runtimeDir = File(workspace, ".crew-runtime")
        runtimeDir.mkdirs()
        val guide = File(runtimeDir, "SELF_DEBUG.md")
        runCatching {
            context.assets.open("runtime/SELF_DEBUG.md").use { input ->
                guide.outputStream().use { output -> input.copyTo(output) }
            }
        }
    }

    private fun copyAssetTree(context: Context, assetPath: String, destination: File) {
        val children = context.assets.list(assetPath) ?: emptyArray()
        if (children.isEmpty()) {
            destination.parentFile?.mkdirs()
            context.assets.open(assetPath).use { input ->
                destination.outputStream().use { output -> input.copyTo(output) }
            }
            return
        }

        destination.mkdirs()
        children.forEach { child ->
            copyAssetTree(context, "$assetPath/$child", File(destination, child))
        }
    }
}
