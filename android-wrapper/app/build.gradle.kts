plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.crewpocket.app"
    compileSdk = 35

    packaging {
        jniLibs {
            excludes += "**/*.so"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.crewpocket.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        manifestPlaceholders["appLabel"] = "Crew Pocket"
        manifestPlaceholders["runtimePackage"] = "com.crewpocket.runtime"
        manifestPlaceholders["runtimeControlPermission"] = "com.crewpocket.permission.CONTROL_RUNTIME"

        buildConfigField("String", "RUNTIME_PACKAGE", "\"com.crewpocket.runtime\"")
        buildConfigField("int", "SERVER_PORT", "8000")
        buildConfigField("boolean", "ALLOW_TERMUX_FALLBACK", "true")
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            manifestPlaceholders["appLabel"] = "Crew Pocket Dev"
            manifestPlaceholders["runtimePackage"] = "com.crewpocket.runtime.dev"
            manifestPlaceholders["runtimeControlPermission"] = "com.crewpocket.permission.CONTROL_RUNTIME_DEV"

            buildConfigField("String", "RUNTIME_PACKAGE", "\"com.crewpocket.runtime.dev\"")
            buildConfigField("int", "SERVER_PORT", "8100")
            buildConfigField("boolean", "ALLOW_TERMUX_FALLBACK", "false")
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
