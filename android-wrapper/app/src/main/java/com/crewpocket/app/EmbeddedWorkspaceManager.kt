package com.crewpocket.app

import android.content.Context
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

object EmbeddedWorkspaceManager {
    private const val WORKSPACE_NAME = "agy-web"
    private const val BOOTSTRAP_URL =
        "https://api.github.com/repos/magic76/crew-pocket/zipball/feature/agent-runtime"

    fun workspaceDir(context: Context): File {
        return File(File(context.filesDir, "workspaces"), WORKSPACE_NAME)
    }

    fun isReady(context: Context): Boolean {
        val workspace = workspaceDir(context)
        return File(workspace, "server.js").isFile &&
            File(workspace, "lib/providers/codex.js").isFile
    }

    fun ensureWorkspace(context: Context): Result<File> {
        if (isReady(context)) {
            val workspace = workspaceDir(context)
            ensureRuntimeFiles(context, workspace)
            return Result.success(workspace)
        }

        return runCatching {
            val root = File(context.filesDir, "workspaces")
            if (!root.exists() && !root.mkdirs()) {
                throw IllegalStateException("Could not create embedded workspace root")
            }

            val staging = File(root, "$WORKSPACE_NAME.bootstrap")
            if (staging.exists()) staging.deleteRecursively()
            if (!staging.mkdirs()) {
                throw IllegalStateException("Could not create embedded workspace staging directory")
            }

            val archive = File(context.cacheDir, "crew-pocket-bootstrap.zip")
            downloadArchive(archive)
            extractArchive(archive, staging)
            archive.delete()

            if (!File(staging, "server.js").isFile) {
                throw IllegalStateException("Embedded workspace bootstrap is missing server.js")
            }

            val target = workspaceDir(context)
            if (target.exists()) {
                val backup = File(root, "$WORKSPACE_NAME.incomplete-${System.currentTimeMillis()}")
                if (!target.renameTo(backup)) {
                    target.deleteRecursively()
                }
            }

            if (!staging.renameTo(target)) {
                staging.copyRecursively(target, overwrite = true)
                staging.deleteRecursively()
            }

            File(target, ".crew-embedded-workspace").writeText(
                "source=magic76/crew-pocket\nref=feature/agent-runtime\n"
            )
            ensureRuntimeFiles(context, target)
            target
        }
    }


    fun ensureRuntimeFiles(context: Context, workspace: File) {
        val runtimeDir = File(workspace, ".crew-runtime")
        runtimeDir.mkdirs()

        val guide = File(runtimeDir, "SELF_DEBUG.md")
        if (!guide.exists()) {
            runCatching {
                context.assets.open("runtime/SELF_DEBUG.md").use { input ->
                    guide.outputStream().use { output -> input.copyTo(output) }
                }
            }
        }
    }

    private fun downloadArchive(destination: File) {
        val connection = URL(BOOTSTRAP_URL).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = 15_000
        connection.readTimeout = 45_000
        connection.setRequestProperty("User-Agent", "Crew-Pocket-Android")
        connection.setRequestProperty("Accept", "application/vnd.github+json")

        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("Workspace download failed with HTTP $code")
            }
            BufferedInputStream(connection.inputStream).use { input ->
                FileOutputStream(destination).use { output ->
                    input.copyTo(output)
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun extractArchive(archive: File, destination: File) {
        val root = destination.canonicalFile
        ZipInputStream(BufferedInputStream(archive.inputStream())).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val normalized = entry.name.replace('\\', '/')
                val relative = normalized.substringAfter('/', "")
                if (relative.isBlank()) {
                    zip.closeEntry()
                    continue
                }

                val output = File(root, relative).canonicalFile
                val rootPrefix = root.path + File.separator
                if (!output.path.startsWith(rootPrefix)) {
                    throw SecurityException("Blocked invalid workspace archive entry")
                }

                if (entry.isDirectory) {
                    output.mkdirs()
                } else {
                    output.parentFile?.mkdirs()
                    FileOutputStream(output).use { fileOutput ->
                        zip.copyTo(fileOutput)
                    }
                }
                zip.closeEntry()
            }
        }
    }
}
