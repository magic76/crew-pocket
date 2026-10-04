package com.crewpocket.runtime

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object EmbeddedAgyRuntime {
    private const val TAG = "EmbeddedAgyRuntime"
    private const val MANIFEST_ASSET = "agy-runtime/manifest.json"

    data class Spec(
        val type: String,
        val entry: File?,
        val command: List<String>,
        val version: String?
    )

    fun prepare(context: Context): Result<Spec?> {
        return runCatching {
            val manifestText = try {
                context.assets.open(MANIFEST_ASSET).bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                return@runCatching null
            }

            val manifest = JSONObject(manifestText)
            val type = manifest.optString("type", "")
            val version = manifest.optString("version", "").ifBlank { null }

            when (type) {
                "node-script" -> prepareNodeScript(context, manifestText, manifest, version)
                "native-command" -> prepareNativeCommand(context, manifest, version)
                else -> throw IllegalStateException("Unsupported embedded AGY runtime type: $type")
            }
        }.onFailure {
            Log.w(TAG, "Could not prepare embedded AGY runtime", it)
        }
    }

    fun environment(context: Context): Map<String, String> {
        val spec = prepare(context).getOrNull() ?: return emptyMap()
        val values = mutableMapOf(
            "CREW_AGY_RUNTIME_TYPE" to spec.type,
            "CREW_AGY_VERSION" to (spec.version ?: "")
        )

        spec.entry?.let { values["CREW_AGY_ENTRY"] = it.absolutePath }
        if (spec.command.isNotEmpty()) {
            values["CREW_AGY_COMMAND_JSON"] = JSONArray(spec.command).toString()
        }
        return values
    }

    private fun prepareNodeScript(
        context: Context,
        manifestText: String,
        manifest: JSONObject,
        version: String?
    ): Spec {
        val entry = manifest.optString("entry", "")
        if (entry.isBlank()) throw IllegalStateException("Embedded AGY manifest is missing entry")

        val root = File(context.filesDir, "agy-runtime")
        val packageDir = File(root, "package")
        val marker = File(root, "manifest.json")

        if (!marker.isFile || marker.readText() != manifestText || !File(packageDir, entry).isFile) {
            root.deleteRecursively()
            packageDir.mkdirs()
            copyAssetTree(context, "agy-runtime/package", packageDir)
            marker.parentFile?.mkdirs()
            marker.writeText(manifestText)
        }

        val entryFile = File(packageDir, entry)
        if (!entryFile.isFile) {
            throw IllegalStateException("Embedded AGY entry not found: ${entryFile.absolutePath}")
        }

        File(context.filesDir, ".gemini/antigravity-cli").mkdirs()
        return Spec(
            type = "node-script",
            entry = entryFile,
            command = emptyList(),
            version = version
        )
    }

    private fun prepareNativeCommand(
        context: Context,
        manifest: JSONObject,
        version: String?
    ): Spec {
        val commandJson = manifest.optJSONArray("command")
            ?: throw IllegalStateException("Native AGY manifest is missing command")
        if (commandJson.length() == 0) {
            throw IllegalStateException("Native AGY command is empty")
        }

        val command = buildList {
            for (index in 0 until commandJson.length()) {
                val value = commandJson.optString(index, "").trim()
                if (value.isBlank()) {
                    throw IllegalStateException("Native AGY command contains an empty argument")
                }
                add(expandPathTokens(context, value))
            }
        }

        val executable = File(command.first())
        if (!executable.isFile || !executable.canExecute()) {
            throw IllegalStateException(
                "Native AGY launcher is not executable: ${executable.absolutePath}"
            )
        }

        File(context.filesDir, ".gemini/antigravity-cli").mkdirs()
        return Spec(
            type = "native-command",
            entry = null,
            command = command,
            version = version
        )
    }

    private fun expandPathTokens(context: Context, value: String): String {
        return value
            .replace("\${NATIVE_DIR}", context.applicationInfo.nativeLibraryDir)
            .replace("\${FILES_DIR}", context.filesDir.absolutePath)
            .replace("\${CACHE_DIR}", context.cacheDir.absolutePath)
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
        for (child in children) {
            copyAssetTree(
                context,
                "$assetPath/$child",
                File(destination, child)
            )
        }
    }
}
