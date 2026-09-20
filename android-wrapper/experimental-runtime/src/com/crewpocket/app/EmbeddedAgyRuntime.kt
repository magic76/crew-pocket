package com.crewpocket.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

object EmbeddedAgyRuntime {
    private const val TAG = "EmbeddedAgyRuntime"
    private const val MANIFEST_ASSET = "agy-runtime/manifest.json"

    data class Spec(
        val type: String,
        val entry: File,
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
            val entry = manifest.optString("entry", "")
            val version = manifest.optString("version", "").ifBlank { null }

            when (type) {
                "node-script" -> {
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
                    Spec(type = type, entry = entryFile, version = version)
                }

                else -> throw IllegalStateException("Unsupported embedded AGY runtime type: $type")
            }
        }.onFailure {
            Log.w(TAG, "Could not prepare embedded AGY runtime", it)
        }
    }

    fun environment(context: Context): Map<String, String> {
        val spec = prepare(context).getOrNull() ?: return emptyMap()
        return mapOf(
            "CREW_AGY_RUNTIME_TYPE" to spec.type,
            "CREW_AGY_ENTRY" to spec.entry.absolutePath,
            "CREW_AGY_VERSION" to (spec.version ?: "")
        )
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
