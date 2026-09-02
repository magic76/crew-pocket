package com.crewpocket.helper;

import android.content.Context;
import java.util.Locale;

/**
 * Lightweight Centralized Bilingual (ZH / EN) Localization Engine
 */
public final class I18n {
    private I18n() {}

    public static boolean isEn(Context ctx) {
        String lang = AppConfig.getLanguage(ctx);
        if ("en".equalsIgnoreCase(lang)) return true;
        if ("zh".equalsIgnoreCase(lang)) return false;
        // Default / Auto: check system locale
        String sysLang = Locale.getDefault().getLanguage().toLowerCase(Locale.ROOT);
        return !sysLang.startsWith("zh");
    }

    public static String get(Context ctx, String zh, String en) {
        return isEn(ctx) ? en : zh;
    }

    // ── Main UI Strings ──
    public static String appSubtitle(Context ctx) {
        return get(ctx, "隨身特工 AI 輔助核心 · 語音 & 自動化支援", "AI Floating Copilot · Voice & Automation Assistant");
    }

    public static String serviceRunningTitle(Context ctx) {
        return get(ctx, "無障礙服務已在背景連線運行", "Accessibility Service Active");
    }

    public static String serviceRunningDetail(Context ctx) {
        return get(ctx, "本地通訊 Port: 8766 · 跨 App 操控與語音助理已就緒", "Local Port: 8766 · Screen perception & voice assistant ready");
    }

    public static String serviceStoppedTitle(Context ctx) {
        return get(ctx, "無障礙服務未連線", "Accessibility Service Inactive");
    }

    public static String serviceStoppedDetail(Context ctx) {
        return get(ctx, "請點擊下方「開啟無障礙服務」授權，以啟用完整隨身特工能力。", "Tap 'Accessibility Service' below to enable screen awareness & automation.");
    }

    public static String sectionCoreServices(Context ctx) {
        return get(ctx, "核心服務與控制", "Core Services & Controls");
    }

    public static String cardAccessibilityTitle(Context ctx) {
        return get(ctx, "開啟「無障礙服務」", "Accessibility Service");
    }

    public static String cardAccessibilityDesc(Context ctx) {
        return get(ctx, "啟用跨 App 螢幕截圖、觸控點擊與跨應用操控", "Enable screen perception, tapping, and app automation");
    }

    public static String cardBubbleTitle(Context ctx) {
        return get(ctx, "啟用浮動語音泡泡", "Floating Voice Bubble");
    }

    public static String cardBubbleDesc(Context ctx) {
        return get(ctx, "短按開始/結束通話；長按開啟文字面板", "Tap to talk; Long-press to open command panel");
    }

    public static String cardNotificationTitle(Context ctx) {
        return get(ctx, "開啟通知欄常駐控制", "Notification Controls");
    }

    public static String cardNotificationDesc(Context ctx) {
        return get(ctx, "由通知中心隨時呼叫 AI 語音與截圖", "Quickly invoke AI voice and screenshot from notification bar");
    }

    public static String cardNativeLiveTitle(Context ctx) {
        return get(ctx, "原生 Gemini Live 測試", "Native Gemini Live Test");
    }

    public static String cardNativeLiveDesc(Context ctx) {
        return get(ctx, "無需瀏覽器 · Android 端到端即時語音對話", "Direct Android end-to-end realtime voice chat");
    }

    public static String cardCameraTitle(Context ctx) {
        return get(ctx, "相機拍照權限", "Camera Permission");
    }

    public static String cardCameraDesc(Context ctx) {
        return get(ctx, "允許 AI 即時辨識實體環境與物件", "Allow AI to see physical environment and objects");
    }

    public static String cardKeepAwakeTitle(Context ctx) {
        return get(ctx, "螢幕常亮開關 (Keep Awake)", "Screen Keep Awake");
    }

    public static String cardKeepAwakeDesc(Context ctx, boolean active) {
        if (active) {
            return get(ctx, "狀態：已開啟 (防止休眠中) · 點擊關閉", "Status: ON (Preventing Sleep) · Tap to toggle");
        } else {
            return get(ctx, "狀態：已關閉 · 點擊開啟防止螢幕休眠", "Status: OFF · Tap to keep screen on");
        }
    }

    public static String cardSettingsTitle(Context ctx) {
        return get(ctx, "運作模式與 API 設定", "Operation Mode & Settings");
    }

    public static String cardLanguageTitle(Context ctx) {
        return get(ctx, "介面語言 (Language)", "App Language");
    }

    public static String cardLanguageDesc(Context ctx) {
        String lang = AppConfig.getLanguage(ctx);
        if ("en".equalsIgnoreCase(lang)) return "Current: English (Tap to switch)";
        if ("zh".equalsIgnoreCase(lang)) return "目前：繁體中文（點擊切換）";
        return get(ctx, "目前：跟隨系統語言（點擊切換）", "Current: System Default (Tap to switch)");
    }
}
