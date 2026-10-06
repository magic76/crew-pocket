import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repoRoot = rootProject.projectDir.parentFile
val generatedRuntimeAssets = layout.buildDirectory.dir("generated/runtime-assets")
val runtimeJniDir = file("src/main/jniLibs/arm64-v8a")

fun agyPayloadReady(): Boolean {
    val manifestFile = file("src/main/assets/agy-runtime/manifest.json")
    if (!manifestFile.isFile) return false

    return runCatching {
        val manifest = JsonSlurper().parseText(manifestFile.readText()) as Map<*, *>
        when (manifest["type"]?.toString()) {
            "node-script" -> {
                val entry = manifest["entry"]?.toString().orEmpty()
                entry.isNotBlank() && file("src/main/assets/agy-runtime/package/$entry").isFile
            }
            "native-command" -> {
                val command = manifest["command"] as? List<*> ?: return@runCatching false
                val first = command.firstOrNull()?.toString().orEmpty()
                val nativePrefix = "\${NATIVE_DIR}/"
                if (!first.startsWith(nativePrefix)) return@runCatching false
                val launcher = first.removePrefix(nativePrefix)
                launcher.matches(Regex("lib[A-Za-z0-9._+-]+\\.so")) &&
                    File(runtimeJniDir, launcher).isFile
            }
            else -> false
        }
    }.getOrDefault(false)
}

val runtimePayloadReady = listOf(
    File(runtimeJniDir, "libnode_exec.so"),
    File(runtimeJniDir, "libbash_exec.so"),
    File(runtimeJniDir, "libcrew_terminal_host.so"),
    File(runtimeJniDir, "libcodex_exec.so"),
    File(runtimeJniDir, "libcode_mode_host.so"),
    file("src/main/assets/provider-manifests/codex.json")
).all { it.isFile } && agyPayloadReady() && runCatching {
    val manifest = JsonSlurper().parse(file("src/main/assets/toolchain/manifest.json")) as Map<*, *>
    val commands = manifest["commands"] as Map<*, *>
    val links = manifest["links"] as Map<*, *>
    val nativeLaunchers = manifest["nativeLaunchers"] as? Map<*, *> ?: return@runCatching false
    listOf("python3", "git", "gh", "npm", "rg", "magick", "adb", "jev", "clang", "clang++", "cmake", "ninja").all { commands.containsKey(it) } &&
        File(runtimeJniDir, "libcrew_native_paths.so").isFile &&
        nativeLaunchers.values.all { File(runtimeJniDir, (it as Map<*, *>)["library"].toString()).isFile } &&
        (commands.values + links.values).all { File(runtimeJniDir, it.toString()).isFile }
}.getOrDefault(false)

val companionEnabled = System.getenv("CREW_RUNTIME_ENABLE_COMPANION")
    ?.equals("true", ignoreCase = true) == true
val runtimeReady = runtimePayloadReady && companionEnabled

val prepareCrewWorkspaceAssets = tasks.register<Sync>("prepareCrewWorkspaceAssets") {
    into(generatedRuntimeAssets)
    from(repoRoot) {
        include("server.js")
        include("AGENTS.md")
        include("GEMINI.md")
        include("android-wrapper/runtime/dependency-audit.md")
        include("android-wrapper/runtime/toolchain/README.md")
        include("android-wrapper/runtime/toolchain/tools.json")
        include("lib/**")
        include("public/**")
        include("extensions/**")
        include("scripts/**")
        into("crew-workspace")
    }
}

android {
    namespace = "com.crewpocket.runtime"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    androidResources {
        // AAPT's default <dir>_* filter drops Python _common/_pyrepl and npm
        // __generated__ modules. These are runtime data, not editor metadata.
        ignoreAssetsPattern = "!.svn:!.git:!.DS_Store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    packaging {
        jniLibs {
            // The runtime launches Node/Codex directly from nativeLibraryDir.
            // Keep real installer-owned files on disk instead of mmap-only APK entries.
            useLegacyPackaging = true
        }
    }

    sourceSets {
        getByName("main").assets.srcDir(generatedRuntimeAssets)
    }

    defaultConfig {
        applicationId = "com.crewpocket.runtime"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"

        manifestPlaceholders["runtimeReady"] = runtimeReady.toString()
        manifestPlaceholders["appLabel"] = "Crew Runtime"
        manifestPlaceholders["runtimeControlPermission"] = "com.crewpocket.permission.CONTROL_RUNTIME"
        manifestPlaceholders["pocketPackage"] = "com.crewpocket.app"

        buildConfigField("boolean", "PAYLOAD_READY", runtimePayloadReady.toString())
        buildConfigField("boolean", "COMPANION_ENABLED", companionEnabled.toString())
        buildConfigField("int", "SERVER_PORT", "8000")
        buildConfigField("int", "CODEX_BRIDGE_PORT", "8767")
        buildConfigField("int", "STATUS_PORT", "8768")
        buildConfigField("String", "POCKET_PACKAGE", "\"com.crewpocket.app\"")
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            manifestPlaceholders["appLabel"] = "Crew Runtime Dev"
            manifestPlaceholders["runtimeControlPermission"] = "com.crewpocket.permission.CONTROL_RUNTIME_DEV"
            manifestPlaceholders["pocketPackage"] = "com.crewpocket.app.dev"

            buildConfigField("int", "SERVER_PORT", "8100")
            buildConfigField("int", "CODEX_BRIDGE_PORT", "8867")
            buildConfigField("int", "STATUS_PORT", "8868")
            buildConfigField("String", "POCKET_PACKAGE", "\"com.crewpocket.app.dev\"")
        }

        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild").configure {
    dependsOn(prepareCrewWorkspaceAssets)
}
