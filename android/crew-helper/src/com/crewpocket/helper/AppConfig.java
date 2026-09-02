package com.crewpocket.helper;

import android.content.Context;
import android.content.SharedPreferences;

public class AppConfig {
    public static final String PREFS_NAME = "crew_helper_config";
    public static final String KEY_GEMINI_API_KEY = "gemini_api_key";
    public static final String KEY_SERVER_URL = "custom_server_url";
    public static final String KEY_VOICE_NAME = "live_voice_name";
    public static final String KEY_LOCAL_BRIDGE = "local_bridge_enabled";

    public static final String DEFAULT_VOICE = "Kore";
    public static final String DEFAULT_SERVER = "http://127.0.0.1:8000";

    public static SharedPreferences getPrefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    // ── 1. Gemini API Key (BYOK) ──
    public static String getGeminiApiKey(Context context) {
        if (context == null) return "";
        String key = getPrefs(context).getString(KEY_GEMINI_API_KEY, "");
        if (key.isEmpty()) {
            key = context.getSharedPreferences("crew_native_live", Context.MODE_PRIVATE).getString("gemini_live_key", "");
        }
        if (key.isEmpty()) {
            key = context.getSharedPreferences("com.crewpocket.helper.NativeLiveActivity", Context.MODE_PRIVATE).getString("gemini_live_key", "");
        }
        return key;
    }

    public static void setGeminiApiKey(Context context, String key) {
        if (context == null) return;
        String cleanKey = key == null ? "" : key.trim();
        getPrefs(context).edit().putString(KEY_GEMINI_API_KEY, cleanKey).apply();
        context.getSharedPreferences("crew_native_live", Context.MODE_PRIVATE).edit().putString("gemini_live_key", cleanKey).apply();
    }

    // ── 2. Custom Server URL (Connected vs Standalone Mode) ──
    public static String getServerUrl(Context context) {
        if (context == null) return "";
        return getPrefs(context).getString(KEY_SERVER_URL, "");
    }

    public static void setServerUrl(Context context, String url) {
        if (context == null) return;
        getPrefs(context).edit().putString(KEY_SERVER_URL, url == null ? "" : url.trim()).apply();
    }

    public static boolean isStandaloneMode(Context context) {
        String url = getServerUrl(context);
        return url == null || url.trim().isEmpty();
    }

    // ── 3. Gemini Live Voice Persona ──
    public static String getVoiceName(Context context) {
        if (context == null) return DEFAULT_VOICE;
        return getPrefs(context).getString(KEY_VOICE_NAME, DEFAULT_VOICE);
    }

    public static void setVoiceName(Context context, String voice) {
        if (context == null) return;
        getPrefs(context).edit().putString(KEY_VOICE_NAME, voice == null ? DEFAULT_VOICE : voice.trim()).apply();
    }

    // ── 4. Local Bridge Automation (:8766) ──
    public static boolean isLocalBridgeEnabled(Context context) {
        if (context == null) return true;
        return getPrefs(context).getBoolean(KEY_LOCAL_BRIDGE, true);
    }

    public static void setLocalBridgeEnabled(Context context, boolean enabled) {
        if (context == null) return;
        getPrefs(context).edit().putBoolean(KEY_LOCAL_BRIDGE, enabled).apply();
    }

    // ── 5. App Language (Bilingual: "auto", "zh", "en") ──
    public static final String KEY_LANGUAGE = "app_language";

    public static String getLanguage(Context context) {
        if (context == null) return "auto";
        return getPrefs(context).getString(KEY_LANGUAGE, "auto");
    }

    public static void setLanguage(Context context, String lang) {
        if (context == null) return;
        getPrefs(context).edit().putString(KEY_LANGUAGE, lang == null ? "auto" : lang.trim()).apply();
    }
}
