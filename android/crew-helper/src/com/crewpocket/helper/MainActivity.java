package com.crewpocket.helper;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView statusDot;
    private TextView statusText;
    private TextView statusDetail;
    private LinearLayout statusCard;

    private int dp(float val) {
        return CrewTheme.dp(this, val);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 🌌 Immersive Dark Status & Navigation Bar
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(CrewTheme.BG_PRIMARY);
            getWindow().setNavigationBarColor(CrewTheme.BG_PRIMARY);
        }
        getWindow().getDecorView().setBackgroundColor(CrewTheme.BG_PRIMARY);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(CrewTheme.BG_PRIMARY);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(36), dp(20), dp(32));
        root.setBackgroundColor(CrewTheme.BG_PRIMARY);
        scroll.addView(root);

        // ── 1. Top Brand Header ──
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView brandIcon = new TextView(this);
        brandIcon.setText("🤖");
        brandIcon.setTextSize(26);
        brandIcon.setPadding(0, 0, dp(10), 0);
        headerRow.addView(brandIcon);

        LinearLayout brandTextCol = new LinearLayout(this);
        brandTextCol.setOrientation(LinearLayout.VERTICAL);

        LinearLayout titleBadgeRow = new LinearLayout(this);
        titleBadgeRow.setOrientation(LinearLayout.HORIZONTAL);
        titleBadgeRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("Crew Pocket");
        title.setTextSize(20);
        title.setTextColor(CrewTheme.TEXT_PRIMARY);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        titleBadgeRow.addView(title);

        TextView versionBadge = new TextView(this);
        versionBadge.setText("HELPER v2.0");
        versionBadge.setTextSize(9);
        versionBadge.setTextColor(CrewTheme.TEAL_300);
        versionBadge.setTypeface(Typeface.MONOSPACE);
        GradientDrawable badgeBg = CrewTheme.createCard(this, Color.argb(40, 20, 184, 166), CrewTheme.BORDER_TEAL, 6);
        versionBadge.setBackground(badgeBg);
        versionBadge.setPadding(dp(6), dp(2), dp(6), dp(2));
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        badgeLp.setMargins(dp(8), 0, 0, 0);
        titleBadgeRow.addView(versionBadge, badgeLp);

        brandTextCol.addView(titleBadgeRow);

        TextView subtitle = new TextView(this);
        subtitle.setText(I18n.appSubtitle(this));
        subtitle.setTextSize(11);
        subtitle.setTextColor(CrewTheme.TEXT_SECONDARY);
        subtitle.setPadding(0, dp(2), 0, 0);
        brandTextCol.addView(subtitle);

        headerRow.addView(brandTextCol);
        root.addView(headerRow);

        // ── 2. Live Service Status Card ──
        statusCard = new LinearLayout(this);
        statusCard.setOrientation(LinearLayout.VERTICAL);
        statusCard.setPadding(dp(16), dp(14), dp(16), dp(14));
        LinearLayout.LayoutParams statusCardLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusCardLp.setMargins(0, dp(22), 0, dp(18));
        statusCard.setLayoutParams(statusCardLp);

        LinearLayout statusTitleRow = new LinearLayout(this);
        statusTitleRow.setOrientation(LinearLayout.HORIZONTAL);
        statusTitleRow.setGravity(Gravity.CENTER_VERTICAL);

        statusDot = new TextView(this);
        statusDot.setText("●");
        statusDot.setTextSize(14);
        statusDot.setTextColor(CrewTheme.ROSE_500);
        statusDot.setPadding(0, 0, dp(8), 0);
        statusTitleRow.addView(statusDot);

        statusText = new TextView(this);
        statusText.setText(I18n.serviceStoppedTitle(this));
        statusText.setTextSize(13);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        statusText.setTextColor(CrewTheme.TEXT_PRIMARY);
        statusTitleRow.addView(statusText);

        statusCard.addView(statusTitleRow);

        statusDetail = new TextView(this);
        statusDetail.setText(I18n.serviceStoppedDetail(this));
        statusDetail.setTextSize(11);
        statusDetail.setTextColor(CrewTheme.TEXT_SECONDARY);
        statusDetail.setPadding(dp(22), dp(4), 0, 0);
        statusCard.addView(statusDetail);

        root.addView(statusCard);

        // ── Section Label ──
        TextView sectionTitle = new TextView(this);
        sectionTitle.setText(I18n.sectionCoreServices(this));
        sectionTitle.setTextSize(12);
        sectionTitle.setTypeface(Typeface.DEFAULT_BOLD);
        sectionTitle.setTextColor(CrewTheme.INDIGO_400);
        sectionTitle.setPadding(dp(4), dp(4), 0, dp(8));
        root.addView(sectionTitle);

        // ── 3. Action Cards ──
        // A. Accessibility Service
        root.addView(makeActionCard("⚙️", I18n.cardAccessibilityTitle(this), I18n.cardAccessibilityDesc(this), CrewTheme.INDIGO_500, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showAccessibilityDisclosureDialog();
            }
        }));

        // B. Floating Voice Bubble
        root.addView(makeActionCard("🫧", I18n.cardBubbleTitle(this), I18n.cardBubbleDesc(this), CrewTheme.TEAL_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                FloatingBubbleManager manager = FloatingBubbleManager.getInstance(MainActivity.this);
                if (!manager.canDrawOverlays()) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                    return;
                }
                manager.showBubble();
                Toast.makeText(MainActivity.this, I18n.get(MainActivity.this, "🎙️ 浮動泡泡已啟用！短按錄音，長按展開", "🎙️ Floating Bubble Enabled! Tap to talk"), Toast.LENGTH_SHORT).show();
            }
        }));

        // C. Notification Controls
        root.addView(makeActionCard("🔔", I18n.cardNotificationTitle(this), I18n.cardNotificationDesc(this), CrewTheme.CYAN_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                FloatingBubbleManager.getInstance(MainActivity.this).showNotification();
                Toast.makeText(MainActivity.this, I18n.get(MainActivity.this, "✅ 通知欄常駐面板已開啟！", "✅ Notification panel activated!"), Toast.LENGTH_SHORT).show();
            }
        }));

        // D. Native Gemini Live Test
        root.addView(makeActionCard("🎙️", I18n.cardNativeLiveTitle(this), I18n.cardNativeLiveDesc(this), CrewTheme.EMERALD_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, NativeLiveActivity.class));
            }
        }));

        // E. Camera Permission
        root.addView(makeActionCard("📸", I18n.cardCameraTitle(this), I18n.cardCameraDesc(this), CrewTheme.AMBER_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 101);
                    } else {
                        Toast.makeText(MainActivity.this, I18n.get(MainActivity.this, "✅ 相機權限已就緒！", "✅ Camera permission ready!"), Toast.LENGTH_SHORT).show();
                    }
                }
            }
        }));

        // F. Screen Keep Awake Toggle Card
        boolean awakeActive = FloatingBubbleManager.isKeepAwakeActive();
        root.addView(makeActionCard("☀️", I18n.cardKeepAwakeTitle(this),
            I18n.cardKeepAwakeDesc(this, awakeActive),
            CrewTheme.AMBER_400,
            new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    boolean active = FloatingBubbleManager.toggleKeepAwake(MainActivity.this);
                    Toast.makeText(MainActivity.this, active ? I18n.get(MainActivity.this, "☀️ 螢幕常亮已開啟！", "☀️ Screen Keep Awake ON!") : I18n.get(MainActivity.this, "🌙 螢幕常亮已關閉！", "🌙 Screen Keep Awake OFF!"), Toast.LENGTH_SHORT).show();
                    // Recreate view to refresh status text
                    recreate();
                }
            }
        ));

        // G. Dual-Mode Settings Card (Standalone vs Connected Server)
        boolean isStandalone = AppConfig.isStandaloneMode(this);
        String currentServer = AppConfig.getServerUrl(this);
        String modeSummary = isStandalone
            ? I18n.get(this, "模式：☁️ 純獨立雲端模式 (直連 Gemini Live)", "Mode: ☁️ Standalone Cloud (Gemini Live)")
            : I18n.get(this, "模式：🔗 Crew Pocket 連線 (" + currentServer + ")", "Mode: 🔗 Connected Server (" + currentServer + ")");

        root.addView(makeActionCard("⚙️", I18n.cardSettingsTitle(this), modeSummary + " · " + I18n.get(this, "點擊配置", "Tap to configure"), CrewTheme.CYAN_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSettingsDialog();
            }
        }));

        // H. Language Switcher Card
        root.addView(makeActionCard("🌐", I18n.cardLanguageTitle(this), I18n.cardLanguageDesc(this), CrewTheme.INDIGO_400, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showLanguageDialog();
            }
        }));

        // ── 4. Footer Brand Info ──
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(0, dp(28), 0, dp(8));

        TextView footerBrand = new TextView(this);
        footerBrand.setText("CREW POCKET · TACTICAL COMPANION");
        footerBrand.setTextSize(10);
        footerBrand.setTypeface(Typeface.MONOSPACE);
        footerBrand.setTextColor(CrewTheme.TEXT_MUTED);
        footer.addView(footerBrand);

        TextView footerHost = new TextView(this);
        footerHost.setText("Local Bridge Server: 127.0.0.1:8766");
        footerHost.setTextSize(9);
        footerHost.setTypeface(Typeface.MONOSPACE);
        footerHost.setTextColor(CrewTheme.TEXT_DISABLED);
        footerHost.setPadding(0, dp(2), 0, 0);
        footer.addView(footerHost);

        root.addView(footer);

        setContentView(scroll);

        // Auto request core permissions on launch
        checkAndRequestPermissions();
    }

    private View makeActionCard(String icon, String titleText, String descText, int accentColor, View.OnClickListener onClick) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));

        GradientDrawable bg = CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 16);
        card.setBackground(bg);
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(onClick);

        // Icon Badge Container
        TextView iconView = new TextView(this);
        iconView.setText(icon);
        iconView.setTextSize(18);
        iconView.setGravity(Gravity.CENTER);
        iconView.setBackground(CrewTheme.createIconBadge(this, accentColor, 12));
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(42), dp(42));
        iconLp.setMargins(0, 0, dp(14), 0);
        card.addView(iconView, iconLp);

        // Text Info Container
        LinearLayout textCol = new LinearLayout(this);
        textCol.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(this);
        title.setText(titleText);
        title.setTextSize(13);
        title.setTextColor(CrewTheme.TEXT_PRIMARY);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        textCol.addView(title);

        TextView desc = new TextView(this);
        desc.setText(descText);
        desc.setTextSize(11);
        desc.setTextColor(CrewTheme.TEXT_SECONDARY);
        desc.setPadding(0, dp(2), 0, 0);
        textCol.addView(desc);

        LinearLayout.LayoutParams textLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        card.addView(textCol, textLp);

        // Right Arrow Indicator
        TextView arrow = new TextView(this);
        arrow.setText("›");
        arrow.setTextSize(20);
        arrow.setTextColor(CrewTheme.TEXT_MUTED);
        arrow.setPadding(dp(6), 0, dp(2), 0);
        card.addView(arrow);

        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, 0, 0, dp(10));
        card.setLayoutParams(cardLp);
        return card;
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 301);
            }
            if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 101);
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 103);
            }
            if (checkSelfPermission("android.permission.READ_MEDIA_IMAGES") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.READ_MEDIA_IMAGES"}, 102);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE}, 102);
            }
        }
    }

    private void showAccessibilityDisclosureDialog() {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(18), dp(20), dp(12));
        layout.setBackgroundColor(CrewTheme.BG_PRIMARY);

        TextView titleView = new TextView(this);
        titleView.setText(I18n.get(this, "🛡️ 無障礙服務使用說明 (Prominent Disclosure)", "🛡️ Accessibility Service Prominent Disclosure"));
        titleView.setTextSize(15);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextColor(CrewTheme.TEXT_PRIMARY);
        titleView.setPadding(0, 0, 0, dp(10));
        layout.addView(titleView);

        TextView bodyView = new TextView(this);
        String bodyText = I18n.isEn(this)
            ? "This App uses the Android AccessibilityService API to provide AI assistant automation and screen perception:\n\n"
              + "• Screen Awareness: Reads on-screen button labels and text so the AI can understand what you see and answer questions.\n"
              + "• Assisted Tapping & Scrolling: Performs taps, typing, or scrolling on your behalf based ONLY on your explicit voice commands.\n"
              + "• Privacy Assurance: This App NEVER collects, logs, or transmits sensitive financial data, passwords, or OTP codes.\n"
              + "• Full Control: You can revoke or disable this permission at any time in Android Settings > Accessibility."
            : "本 App 使用 Android AccessibilityService API 提供語音助理操作與螢幕感知輔助：\n\n"
              + "• 螢幕感知：讀取畫面上的按鈕標籤與文字，讓 AI 能理解畫面內容並回答您的提問。\n"
              + "• 輔助點擊與滑動：依據您的明確語音指令（如『點擊送出』、『往下滑』），代替您執行點擊與滑動操作。\n"
              + "• 隱私保證：本 App 絕不會記錄、儲存或傳輸任何密碼、信用卡號等機密金融資料與個人機密。\n"
              + "• 隨時撤銷：您可以隨時在系統『設定 > 無障礙』中停用此服務。";
        bodyView.setText(bodyText);
        bodyView.setTextSize(12);
        bodyView.setTextColor(CrewTheme.TEXT_SECONDARY);
        bodyView.setLineSpacing(dp(2), 1.15f);
        layout.addView(bodyView);

        builder.setView(layout);
        builder.setPositiveButton(I18n.get(this, "同意並前往設定", "Agree & Open Settings"), new android.content.DialogInterface.OnClickListener() {
            @Override
            public void onClick(android.content.DialogInterface dialog, int which) {
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                startActivity(intent);
            }
        });
        builder.setNegativeButton(I18n.get(this, "取消", "Cancel"), null);
        builder.show();
    }

    private void showSettingsDialog() {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(16), dp(20), dp(10));
        layout.setBackgroundColor(CrewTheme.BG_PRIMARY);

        TextView titleView = new TextView(this);
        titleView.setText(I18n.get(this, "⚙️ 運作模式與連線設定", "⚙️ Operation Mode & Settings"));
        titleView.setTextSize(16);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextColor(CrewTheme.TEXT_PRIMARY);
        titleView.setPadding(0, 0, 0, dp(12));
        layout.addView(titleView);

        // 1. Gemini API Key (BYOK)
        TextView keyLabel = new TextView(this);
        keyLabel.setText(I18n.get(this, "1. Gemini API Key (BYOK 獨立雲端模式)", "1. Gemini API Key (BYOK Cloud Mode)"));
        keyLabel.setTextSize(12);
        keyLabel.setTypeface(Typeface.DEFAULT_BOLD);
        keyLabel.setTextColor(CrewTheme.TEAL_400);
        layout.addView(keyLabel);

        TextView keyHintLink = new TextView(this);
        keyHintLink.setText(I18n.get(this, "🔗 免費申請 Gemini API Key (aistudio.google.com) ↗", "🔗 Get Free Gemini API Key (aistudio.google.com) ↗"));
        keyHintLink.setTextSize(11);
        keyHintLink.setTextColor(CrewTheme.CYAN_400);
        keyHintLink.setPadding(0, dp(2), 0, dp(4));
        keyHintLink.setClickable(true);
        keyHintLink.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey")));
                } catch (Exception ignored) {}
            }
        });
        layout.addView(keyHintLink);

        final android.widget.EditText keyInput = new android.widget.EditText(this);
        keyInput.setHint(I18n.get(this, "請輸入 AIzaSy 開頭的 Gemini API Key", "Enter AIzaSy... Gemini API Key"));
        keyInput.setHintTextColor(CrewTheme.TEXT_MUTED);
        keyInput.setText(AppConfig.getGeminiApiKey(this));
        keyInput.setTextSize(12);
        keyInput.setTextColor(CrewTheme.TEXT_PRIMARY);
        keyInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyInput.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 8));
        keyInput.setPadding(dp(10), dp(10), dp(10), dp(10));
        LinearLayout.LayoutParams keyLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        keyLp.setMargins(0, dp(4), 0, dp(14));
        layout.addView(keyInput, keyLp);

        // 2. Custom Server URL (Connected Mode)
        TextView serverLabel = new TextView(this);
        serverLabel.setText(I18n.get(this, "2. Crew Pocket 伺服器網址 (連線擴充模式)", "2. Custom Server URL (Connected Mode)"));
        serverLabel.setTextSize(12);
        serverLabel.setTypeface(Typeface.DEFAULT_BOLD);
        serverLabel.setTextColor(CrewTheme.INDIGO_400);
        layout.addView(serverLabel);

        final android.widget.EditText serverInput = new android.widget.EditText(this);
        serverInput.setHint(I18n.get(this, "留空為純獨立模式，或填 http://127.0.0.1:8000", "Empty for standalone, or http://127.0.0.1:8000"));
        serverInput.setHintTextColor(CrewTheme.TEXT_MUTED);
        serverInput.setText(AppConfig.getServerUrl(this));
        serverInput.setTextSize(12);
        serverInput.setTextColor(CrewTheme.TEXT_PRIMARY);
        serverInput.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 8));
        serverInput.setPadding(dp(10), dp(10), dp(10), dp(10));
        LinearLayout.LayoutParams serverLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        serverLp.setMargins(0, dp(4), 0, dp(14));
        layout.addView(serverInput, serverLp);

        builder.setView(layout);
        builder.setPositiveButton(I18n.get(this, "儲存設定", "Save Settings"), new android.content.DialogInterface.OnClickListener() {
            @Override
            public void onClick(android.content.DialogInterface dialog, int which) {
                String newKey = keyInput.getText().toString().trim();
                String newServer = serverInput.getText().toString().trim();
                AppConfig.setGeminiApiKey(MainActivity.this, newKey);
                AppConfig.setServerUrl(MainActivity.this, newServer);
                Toast.makeText(MainActivity.this, I18n.get(MainActivity.this, "✅ 設定已儲存生效！", "✅ Settings saved successfully!"), Toast.LENGTH_SHORT).show();
                recreate();
            }
        });
        builder.setNegativeButton(I18n.get(this, "取消", "Cancel"), null);
        builder.show();
    }

    private void showLanguageDialog() {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        String[] languages = new String[]{
            "🌐 跟隨系統 (System Default)",
            "🇹🇼 繁體中文 (Traditional Chinese)",
            "🇺🇸 English"
        };
        String current = AppConfig.getLanguage(this);
        int checkedItem = "zh".equalsIgnoreCase(current) ? 1 : ("en".equalsIgnoreCase(current) ? 2 : 0);

        builder.setTitle(I18n.get(this, "選擇介面語言", "Select App Language"));
        builder.setSingleChoiceItems(languages, checkedItem, new android.content.DialogInterface.OnClickListener() {
            @Override
            public void onClick(android.content.DialogInterface dialog, int which) {
                if (which == 1) {
                    AppConfig.setLanguage(MainActivity.this, "zh");
                } else if (which == 2) {
                    AppConfig.setLanguage(MainActivity.this, "en");
                } else {
                    AppConfig.setLanguage(MainActivity.this, "auto");
                }
                dialog.dismiss();
                recreate();
            }
        });
        builder.setNegativeButton(I18n.get(this, "取消", "Cancel"), null);
        builder.show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (CrewAccessibilityService.isServiceRunning()) {
            statusDot.setTextColor(CrewTheme.EMERALD_400);
            statusText.setText(I18n.serviceRunningTitle(this));
            statusText.setTextColor(CrewTheme.EMERALD_400);
            statusDetail.setText(I18n.serviceRunningDetail(this));
            statusDetail.setTextColor(CrewTheme.TEXT_SECONDARY);
            statusCard.setBackground(CrewTheme.createCard(this, Color.parseColor("#14064E3B"), Color.parseColor("#33059669"), 16));
            FloatingBubbleManager manager = FloatingBubbleManager.getInstance(this);
            manager.showNotification();
        } else {
            statusDot.setTextColor(CrewTheme.ROSE_500);
            statusText.setText(I18n.serviceStoppedTitle(this));
            statusText.setTextColor(CrewTheme.ROSE_400);
            statusDetail.setText(I18n.serviceStoppedDetail(this));
            statusDetail.setTextColor(CrewTheme.TEXT_SECONDARY);
            statusCard.setBackground(CrewTheme.createCard(this, Color.parseColor("#144C0519"), Color.parseColor("#33BE123C"), 16));
        }
    }
}
