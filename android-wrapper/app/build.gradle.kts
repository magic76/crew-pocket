plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.crewpocket.app"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    packaging {
        jniLibs {
            // Android 10+ forbids exec from writable app-home paths. Keep the
            // optional Codex ELF in installer-owned nativeLibraryDir instead.
            useLegacyPackaging = true
            keepDebugSymbols += setOf("**/libcodex_exec.so")
        }
    }

    defaultConfig {
        applicationId = "com.crewpocket.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
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
