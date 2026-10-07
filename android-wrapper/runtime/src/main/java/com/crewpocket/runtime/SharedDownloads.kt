package com.crewpocket.runtime

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.system.Os
import java.io.File

object SharedDownloads {
    @Suppress("DEPRECATION")
    fun directory(): File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)

    fun granted(context: Context): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Environment.isExternalStorageManager()
    } else {
        context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED &&
            context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    }

    /** Preserve existing user storage folders/links; create only our absent alias. */
    fun prepare(context: Context): File {
        val target = directory()
        val storage = File(context.filesDir, "storage")
        if (!storage.exists()) storage.mkdirs()
        if (storage.canonicalFile != File(context.filesDir.canonicalFile, "storage")) return target
        val alias = File(storage, "downloads")
        val link = runCatching { Os.readlink(alias.absolutePath) }.getOrNull()
        if (link == null && !alias.exists()) {
            runCatching { Os.symlink(target.absolutePath, alias.absolutePath) }
        }
        return target
    }
}
