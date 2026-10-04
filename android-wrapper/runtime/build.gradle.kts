plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repoRoot = rootProject.projectDir.parentFile
val generatedRuntimeAssets = layout.buildDirectory.dir("generated/runtime-assets")
val runtimeJniDir = file("src/main/jniLibs/arm64-v8a")
val runtimeReady = listOf(
    File(runtimeJniDir, "libnode_exec.so"),
    File(runtimeJniDir, "libcodex_exec.so"),
    file("src/main/assets/agy-runtime/manifest.json")
).all { it.isFile }

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

    sourceSets {
        getByName("main").assets.srcDir(generatedRuntimeAssets)
    }

    defaultConfig {
        applicationId = "com.crewpocket.runtime"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["runtimeReady"] = runtimeReady.toString()
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
