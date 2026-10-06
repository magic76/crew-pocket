package com.crewpocket.runtime

import android.content.Context
import android.system.Os
import org.json.JSONObject
import java.io.File

/** Immutable packaged tool data; user packages/config remain outside this tree. */
object EmbeddedToolchain {
    private fun root(context: Context) = File(context.filesDir, ".crew-pocket/toolchain")

    private fun link(alias: File, target: File) {
        alias.parentFile?.mkdirs()
        val current = runCatching { Os.readlink(alias.absolutePath) }.getOrNull()
        if (current == target.absolutePath) return
        if (current != null || alias.exists()) check(alias.delete()) { "Cannot replace tool link: $alias" }
        Os.symlink(target.absolutePath, alias.absolutePath)
    }

    @Synchronized
    fun prepare(context: Context, bin: File) {
        val target = root(context)
        val revision = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        val marker = File(target, ".revision")
        if (!marker.isFile || marker.readText() != revision) {
            val staging = File(context.filesDir, ".crew-pocket/toolchain.staging")
            staging.deleteRecursively()
            copy(context, "toolchain", staging)
            target.deleteRecursively()
            check(staging.renameTo(target)) { "Cannot publish toolchain data" }
            val fontConfig = File(target, "etc/fonts/fonts.conf")
            if (fontConfig.isFile) {
                fontConfig.writeText(fontConfig.readText()
                    .replace("/data/data/com.termux/files/usr/share/fonts", File(target, "share/fonts").absolutePath)
                    .replace("/data/data/com.termux/files/usr/var/cache/fontconfig", File(context.cacheDir, "fontconfig").absolutePath))
            }
            File(target, "lib").listFiles()?.filter { it.name.startsWith("python") }?.forEach { python ->
                python.listFiles()?.filter { it.name.startsWith("_sysconfigdata") && it.extension == "py" }?.forEach { config ->
                    config.writeText(config.readText().replace("/data/data/com.termux/files/usr", target.absolutePath))
                }
            }
            marker.writeText(revision)
        }
        val manifest = JSONObject(File(target, "manifest.json").readText())
        for (section in listOf("links", "commands")) {
            val values = manifest.getJSONObject(section)
            for (name in values.keys()) {
                val library = File(context.applicationInfo.nativeLibraryDir, values.getString(name))
                check(library.isFile && library.canRead()) { "Missing tool library: $library" }
                if (section == "commands") check(library.canExecute()) { "Nonexecutable tool: $library" }
                link(File(if (section == "commands") bin else target, name), library)
            }
        }
        val dataAliases = manifest.optJSONObject("dataAliases")
        dataAliases?.keys()?.forEach { name -> link(File(bin, name), File(target, dataAliases.getString(name))) }
        val javaHome = File(target, "lib/jvm/java-21-openjdk")
        if (javaHome.isDirectory) {
            for (name in listOf("java", "javac", "jar", "keytool", "jlink", "jmod")) {
                link(File(javaHome, "bin/$name"), File(bin, name))
            }
            val sdk = File(target, "android-sdk")
            val platformTools = File(sdk, "platform-tools").apply { mkdirs() }
            link(File(platformTools, "adb"), File(bin, "adb"))
            File(platformTools, "source.properties").writeText("Pkg.Desc=Crew Runtime Android Platform Tools\nPkg.Revision=37.0.0\n")
            val buildTools = File(sdk, "build-tools/34.0.0")
            if (buildTools.isDirectory) {
                for (name in listOf("aapt", "aapt2", "aidl", "zipalign", "apksigner")) link(File(buildTools, name), File(bin, name))
                // SDK validation checks legacy inspection entries even when the
                // Android plugin never uses them. Calls fail explicitly.
                for (name in listOf("dexdump", "split-select")) link(File(buildTools, name), File(context.applicationInfo.nativeLibraryDir, "libcrew_sdk_unsupported.so"))
            }
            val gradleHome = File(context.filesDir, ".gradle").apply { mkdirs() }
            val properties = File(gradleHome, "gradle.properties")
            if (!properties.exists()) properties.writeText("android.aapt2FromMavenOverride=${File(bin, "aapt2").absolutePath}\norg.gradle.native=false\norg.gradle.internal.instrumentation.agent=false\norg.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8 -Dorg.gradle.native=false -Dorg.gradle.internal.instrumentation.agent=false\n")
        }
    }

    fun libraryPath(context: Context): String = File(root(context), "lib").absolutePath

    fun environment(context: Context): Map<String, String> {
        val target = root(context)
        val bin = EmbeddedExecutablePaths.prepare(context)
        val manifest = JSONObject(File(target, "manifest.json").readText())
        val magick = File(target, "lib").listFiles()?.firstOrNull { it.name.startsWith("ImageMagick") }
        val coders = magick?.walkTopDown()?.firstOrNull { it.isDirectory && it.name == "coders" }
        val config = File(target, "etc").listFiles()?.firstOrNull { it.name.startsWith("ImageMagick") }
        val adbPort = if (BuildConfig.DEBUG) "5038" else "5039"
        return buildMap {
            put("CREW_TOOL_ROOT", target.absolutePath)
            put("CREW_NATIVE_DIR", context.applicationInfo.nativeLibraryDir)
            put("CREW_TOOLCHAIN_MANIFEST", File(target, "manifest.json").absolutePath)
            val javaHome = File(target, "lib/jvm/java-21-openjdk")
            if (javaHome.isDirectory) {
                put("JAVA_HOME", javaHome.absolutePath)
                put("GRADLE_USER_HOME", File(context.filesDir, ".gradle").absolutePath)
                put("ANDROID_HOME", File(target, "android-sdk").absolutePath)
                put("ANDROID_SDK_ROOT", File(target, "android-sdk").absolutePath)
                put("JAVA_TOOL_OPTIONS", "-Djava.home=${javaHome.absolutePath} -Duser.home=${context.filesDir.absolutePath} -Djava.io.tmpdir=${context.cacheDir.absolutePath} -Djdk.lang.Process.launchMechanism=FORK -Djavax.net.ssl.trustStore=${EmbeddedTrustStore.javaTrustStore(context).absolutePath} -Djavax.net.ssl.trustStoreType=JKS -Djavax.net.ssl.trustStorePassword=changeit")
            }
            put("PYTHONHOME", target.absolutePath)
            put("PYTHONPATH", File(target, "lib/${manifest.getString("pythonVersion")}").absolutePath)
            put("PYTHONUSERBASE", File(context.filesDir, ".local").absolutePath)
            put("GIT_EXEC_PATH", bin.absolutePath)
            put("GIT_TEMPLATE_DIR", File(target, "share/git-core/templates").absolutePath)
            put("GIT_PAGER", "cat")
            put("GH_PAGER", "/system/bin/cat")
            put("GH_CONFIG_DIR", File(context.filesDir, ".config/gh").absolutePath)
            put("GIT_CONFIG_NOSYSTEM", "1")
            put("GIT_TEXTDOMAINDIR", File(target, "share/locale").absolutePath)
            put("GIT_SSL_CAINFO", EmbeddedTrustStore.certificateBundle(context).absolutePath)
            put("NODE_EXTRA_CA_CERTS", EmbeddedTrustStore.certificateBundle(context).absolutePath)
            put("npm_config_prefix", File(context.filesDir, ".local").absolutePath)
            put("npm_config_cache", File(context.cacheDir, "npm").absolutePath)
            put("npm_config_script_shell", File(bin, "bash").absolutePath)
            put("ADB_SERVER_SOCKET", "tcp:localhost:$adbPort")
            put("ANDROID_ADB_SERVER_PORT", adbPort)
            put("FONTCONFIG_PATH", File(target, "etc/fonts").absolutePath)
            put("FONTCONFIG_FILE", File(target, "etc/fonts/fonts.conf").absolutePath)
            put("MAGICK_HOME", target.absolutePath)
            config?.let { put("MAGICK_CONFIGURE_PATH", it.absolutePath) }
            coders?.let { put("MAGICK_CODER_MODULE_PATH", it.absolutePath) }
            put("MAGICK_TEMPORARY_PATH", context.cacheDir.absolutePath)
        }
    }

    private fun copy(context: Context, asset: String, destination: File) {
        val children = context.assets.list(asset) ?: emptyArray()
        if (children.isEmpty()) {
            destination.parentFile?.mkdirs()
            context.assets.open(asset).use { input -> destination.outputStream().use { input.copyTo(it) } }
        } else {
            destination.mkdirs()
            children.forEach { copy(context, "$asset/$it", File(destination, it)) }
        }
    }
}
