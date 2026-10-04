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
    File(runtimeJniDir, "libcodex_exec.so"),
    File(runtimeJniDir, "libcodex_code_mode_host.so"),
    file("src/main/assets/provider-manifests/codex.json")
).all { it.isFile } && agyPayloadReady()

val companionEnabled = System.getenv("CREW_RUNTIME_ENABLE_COMPANION")
    ?.equals("true", ignoreCase = true) == true
val runtimeReady = runtimePayloadReady && companionEnabled

val prepareCrewWorkspaceAssets = tasks.register<Sync>("prepareCrewWorkspaceAssets") {
    into(generatedRuntimeAssets)
    from(repoRoot) {
        include("server.js")
        include("AGENTS.md")
        include("GEMINI.md")
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
        buildConfigField("boolean", "PAYLOAD_READY", runtimePayloadReady.toString())
        buildConfigField("boolean", "COMPANION_ENABLED", companionEnabled.toString())
    }

    buildTypes {
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
