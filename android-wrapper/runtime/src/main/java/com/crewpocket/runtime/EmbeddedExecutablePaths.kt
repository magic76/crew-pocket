package com.crewpocket.runtime

import android.content.Context
import android.system.Os
import java.io.File

/** PATH aliases point at installer-owned ELF files; no executable is copied to app data. */
object EmbeddedExecutablePaths {
    @Synchronized
    fun prepare(context: Context): File {
        val directory = File(context.filesDir, ".crew-pocket/bin").apply { mkdirs() }
        for ((name, library) in mapOf("bash" to "libbash_exec.so", "node" to "libnode_exec.so")) {
            val target = File(context.applicationInfo.nativeLibraryDir, library)
            check(target.isFile && target.canExecute()) { "Missing runtime executable: $library" }
            val alias = File(directory, name)
            val current = runCatching { Os.readlink(alias.absolutePath) }.getOrNull()
            if (current != target.absolutePath) {
                if (current != null || alias.exists()) check(alias.delete()) { "Cannot replace $name alias" }
                Os.symlink(target.absolutePath, alias.absolutePath)
            }
        }
        EmbeddedToolchain.prepare(context, directory)
        return directory
    }

    fun path(context: Context): String =
        "${prepare(context).absolutePath}:/system/bin:/system/xbin:/product/bin"
}
