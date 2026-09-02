package com.crewpocket.helper;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Modern Native Gemini Live Verification Screen
 * Cyberpunk Dark Luxury Style
 */
public class NativeLiveActivity extends Activity {
    private static final int REQUEST_RECORD_AUDIO = 301;
    private EditText apiKeyInput;
    private EditText textInput;
    private TextView statusDot;
    private TextView statusText;
    private TextView transcript;
    private String lastTranscriptRole = "";
    private Button callButton;
    private Button textSendButton;
    private NativeGeminiLiveClient client;
    private final Handler handler = new Handler();
    private final Runnable connectionWatchdog = new Runnable() {
        @Override public void run() {
            if (client != null && client.isRunning()) {
                updateStatus(CrewTheme.AMBER_400, "連線診斷：目前停在「" + client.getStage() + "」");
            }
        }
    };

    private int dp(float val) {
        return CrewTheme.dp(this, val);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);

        // 🌌 Immersive Dark Bar
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
        root.setPadding(dp(20), dp(32), dp(20), dp(32));
        root.setBackgroundColor(CrewTheme.BG_PRIMARY);
        scroll.addView(root);

        // ── 1. Header with Back Navigation ──
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView backBtn = new TextView(this);
        backBtn.setText(I18n.get(this, "‹ 返回", "‹ Back"));
        backBtn.setTextSize(14);
        backBtn.setTextColor(CrewTheme.INDIGO_400);
        backBtn.setTypeface(Typeface.DEFAULT_BOLD);
        backBtn.setPadding(0, 0, dp(12), 0);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { finish(); }
        });
        headerRow.addView(backBtn);

        TextView title = new TextView(this);
        title.setText(I18n.get(this, "原生 Gemini Live", "Native Gemini Live"));
        title.setTextSize(18);
        title.setTextColor(CrewTheme.TEXT_PRIMARY);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        headerRow.addView(title);

        root.addView(headerRow);

        TextView note = new TextView(this);
        note.setText(I18n.get(this, "端到端低延遲 Web Audio PCM 直連通話（無須開啟瀏覽器）", "End-to-end low-latency direct voice chat (No browser needed)"));
        note.setTextSize(11);
        note.setTextColor(CrewTheme.TEXT_SECONDARY);
        note.setPadding(0, dp(4), 0, dp(18));
        root.addView(note);

        // ── 2. Status Badge Card ──
        LinearLayout statusBadge = new LinearLayout(this);
        statusBadge.setOrientation(LinearLayout.HORIZONTAL);
        statusBadge.setGravity(Gravity.CENTER_VERTICAL);
        statusBadge.setPadding(dp(14), dp(10), dp(14), dp(10));
        statusBadge.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 12));

        statusDot = new TextView(this);
        statusDot.setText("●");
        statusDot.setTextSize(12);
        statusDot.setTextColor(CrewTheme.EMERALD_400);
        statusDot.setPadding(0, 0, dp(8), 0);
        statusBadge.addView(statusDot);

        statusText = new TextView(this);
        statusText.setText(I18n.get(this, "待命就緒", "Ready"));
        statusText.setTextSize(12);
        statusText.setTextColor(CrewTheme.TEXT_PRIMARY);
        statusText.setTypeface(Typeface.MONOSPACE);
        statusBadge.addView(statusText);

        root.addView(statusBadge);

        // ── 3. API Key Card ──
        LinearLayout keyCard = new LinearLayout(this);
        keyCard.setOrientation(LinearLayout.VERTICAL);
        keyCard.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams keyCardLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        keyCardLp.setMargins(0, dp(14), 0, 0);
        keyCard.setLayoutParams(keyCardLp);
        keyCard.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 16));

        TextView keyLabel = new TextView(this);
        keyLabel.setText("Google AI Studio API Key");
        keyLabel.setTextSize(11);
        keyLabel.setTextColor(CrewTheme.TEAL_300);
        keyLabel.setTypeface(Typeface.DEFAULT_BOLD);
        keyCard.addView(keyLabel);

        apiKeyInput = new EditText(this);
        apiKeyInput.setHint("AIzaSy...");
        apiKeyInput.setHintTextColor(CrewTheme.TEXT_MUTED);
        apiKeyInput.setTextColor(CrewTheme.TEXT_PRIMARY);
        apiKeyInput.setTextSize(12);
        apiKeyInput.setTypeface(Typeface.MONOSPACE);
        apiKeyInput.setSingleLine(true);
        apiKeyInput.setBackground(CrewTheme.createCard(this, CrewTheme.BG_PRIMARY, CrewTheme.BORDER_SUBTLE, 10));
        apiKeyInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        inputLp.setMargins(0, dp(8), 0, 0);
        keyCard.addView(apiKeyInput, inputLp);

        String savedKey = AppConfig.getGeminiApiKey(this);
        apiKeyInput.setText(savedKey);

        TextView keyHint = new TextView(this);
        keyHint.setText(I18n.get(this, "🔗 免費申請 Gemini API Key (aistudio.google.com) ↗", "🔗 Get Free Gemini API Key (aistudio.google.com) ↗"));
        keyHint.setTextSize(11);
        keyHint.setTextColor(CrewTheme.CYAN_400);
        keyHint.setPadding(0, dp(6), 0, 0);
        keyHint.setClickable(true);
        keyHint.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey")));
                } catch (Exception ignored) {}
            }
        });
        keyCard.addView(keyHint);

        root.addView(keyCard);

        // ── 4. Main Call Action Button ──
        callButton = new Button(this);
        callButton.setText(I18n.get(this, "🎙️ 開始原生 Live 通話", "🎙️ Start Native Live Call"));
        callButton.setTextSize(14);
        callButton.setTextColor(Color.WHITE);
        callButton.setTypeface(Typeface.DEFAULT_BOLD);
        updateCallButtonUi(false);

        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        buttonLp.setMargins(0, dp(14), 0, 0);
        root.addView(callButton, buttonLp);

        // ── 5. Text Input Card ──
        LinearLayout textCard = new LinearLayout(this);
        textCard.setOrientation(LinearLayout.VERTICAL);
        textCard.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams textCardLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        textCardLp.setMargins(0, dp(14), 0, 0);
        textCard.setLayoutParams(textCardLp);
        textCard.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 16));

        textInput = new EditText(this);
        textInput.setHint(I18n.get(this, "文字輸入測試（例如：「看我現在螢幕上有什麼？」）", "Type text command (e.g., 'What is on my screen?')"));
        textInput.setHintTextColor(CrewTheme.TEXT_MUTED);
        textInput.setTextColor(CrewTheme.TEXT_PRIMARY);
        textInput.setTextSize(12);
        textInput.setMinLines(2);
        textInput.setGravity(Gravity.TOP | Gravity.START);
        textInput.setBackground(CrewTheme.createCard(this, CrewTheme.BG_PRIMARY, CrewTheme.BORDER_SUBTLE, 10));
        textInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        textCard.addView(textInput);

        textSendButton = new Button(this);
        textSendButton.setText(I18n.get(this, "💬 傳送文字至 Live 通話", "💬 Send Text to Live Session"));
        textSendButton.setTextSize(12);
        textSendButton.setTextColor(CrewTheme.TEXT_PRIMARY);
        textSendButton.setBackground(CrewTheme.createCard(this, CrewTheme.BG_ELEVATED, CrewTheme.BORDER_INDIGO, 10));
        LinearLayout.LayoutParams sendLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(38));
        sendLp.setMargins(0, dp(8), 0, 0);
        textCard.addView(textSendButton, sendLp);

        root.addView(textCard);

        // ── 6. Transcript Area ──
        TextView transcriptTitle = new TextView(this);
        transcriptTitle.setText(I18n.get(this, "即時逐字稿", "Live Transcript"));
        transcriptTitle.setTextSize(12);
        transcriptTitle.setTypeface(Typeface.DEFAULT_BOLD);
        transcriptTitle.setTextColor(CrewTheme.TEAL_300);
        transcriptTitle.setPadding(dp(4), dp(18), 0, dp(6));
        root.addView(transcriptTitle);

        transcript = new TextView(this);
        transcript.setText(I18n.get(this, "（通話中的語音辨識與 Gemini 即時回覆將動態顯示在這裡）", "(Voice recognition and Gemini realtime replies will appear here)"));
        transcript.setTextSize(12);
        transcript.setTextColor(CrewTheme.TEXT_SECONDARY);
        transcript.setTypeface(Typeface.MONOSPACE);
        transcript.setPadding(dp(14), dp(12), dp(14), dp(12));
        transcript.setBackground(CrewTheme.createCard(this, CrewTheme.BG_SURFACE, CrewTheme.BORDER_SUBTLE, 14));
        transcript.setMinLines(5);
        LinearLayout.LayoutParams transcriptLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        root.addView(transcript, transcriptLp);

        setContentView(scroll);

        // Event Listeners
        callButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleCall(); }
        });
        textSendButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String text = textInput.getText().toString().trim();
                if (text.isEmpty()) { updateStatus(CrewTheme.AMBER_400, I18n.get(NativeLiveActivity.this, "請先輸入測試文字", "Please enter text first")); return; }
                if (client == null || !client.isRunning()) { updateStatus(CrewTheme.AMBER_400, I18n.get(NativeLiveActivity.this, "請先開始 Gemini Live 通話", "Please start Live Call first")); return; }
                if (client.sendText(text)) {
                    textInput.setText("");
                    updateStatus(CrewTheme.TEAL_400, I18n.get(NativeLiveActivity.this, "文字已送出，等待回覆…", "Text sent, waiting for reply..."));
                } else updateStatus(CrewTheme.ROSE_500, I18n.get(NativeLiveActivity.this, "文字送出失敗，請確認連線", "Failed to send text"));
            }
        });
    }

    private void updateCallButtonUi(boolean isCallActive) {
        if (isCallActive) {
            callButton.setText(I18n.get(this, "🛑 結束 Live 通話", "🛑 End Live Call"));
            callButton.setBackground(CrewTheme.createGradientButton(this, CrewTheme.ROSE_500, Color.parseColor("#9F1239"), 14));
        } else {
            callButton.setText(I18n.get(this, "🎙️ 開始原生 Live 通話", "🎙️ Start Native Live Call"));
            callButton.setBackground(CrewTheme.createGradientButton(this, CrewTheme.TEAL_500, CrewTheme.INDIGO_600, 14));
        }
    }

    private void updateStatus(final int color, final String text) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (statusDot != null) statusDot.setTextColor(color);
                if (statusText != null) statusText.setText(text);
            }
        });
    }

    private void toggleCall() {
        if (client != null && client.isRunning()) {
            client.stop();
            client = null;
            handler.removeCallbacks(connectionWatchdog);
            updateCallButtonUi(false);
            updateStatus(CrewTheme.TEXT_MUTED, "通話已結束");
            return;
        }
        final String key = apiKeyInput.getText().toString().trim();
        if (key.length() < 20) { updateStatus(CrewTheme.ROSE_500, "請填入有效的 Gemini API Key"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            return;
        }
        AppConfig.setGeminiApiKey(this, key);
        startClient(key);
    }

    private void startClient(String key) {
        String serverUrl = AppConfig.getServerUrl(this);
        String voiceName = AppConfig.getVoiceName(this);
        client = new NativeGeminiLiveClient(key, serverUrl, voiceName, new NativeGeminiLiveClient.Listener() {
            @Override public void onStatus(final String text) {
                updateStatus(CrewTheme.TEAL_400, text);
            }
            @Override public void onStopped(final String reason) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        updateStatus(CrewTheme.ROSE_400, reason);
                        handler.removeCallbacks(connectionWatchdog);
                        updateCallButtonUi(false);
                    }
                });
            }
            @Override public void onTranscript(final String role, final String text) {
                runOnUiThread(new Runnable() { @Override public void run() { appendTranscript(role, text); } });
            }
            @Override public void onSpeakingChanged(final boolean speaking) {
                if (speaking) {
                    updateStatus(CrewTheme.AMBER_400, "🔊 Gemini 正在說話...");
                } else {
                    updateStatus(CrewTheme.EMERALD_400, "🎙️ 聆聽中 (雙向全雙工)");
                }
            }
        });
        client.start();
        handler.removeCallbacks(connectionWatchdog);
        handler.postDelayed(connectionWatchdog, 18000);
        updateCallButtonUi(true);
    }

    private void appendTranscript(String role, String text) {
        if (text == null || text.trim().isEmpty()) return;
        String existing = transcript.getText().toString();
        if (existing.startsWith("（通話中的")) existing = "";
        boolean sameSpeaker = role.equals(lastTranscriptRole) && !existing.isEmpty();
        String prefix = sameSpeaker ? "" : (existing.isEmpty() ? "" : "\n") + (role.equalsIgnoreCase("user") ? "🧑 我：" : "🤖 Gemini：");
        String next = existing + prefix + text.trim();
        if (next.length() > 12000) next = next.substring(next.length() - 12000);
        transcript.setText(next);
        lastTranscriptRole = role;
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_RECORD_AUDIO && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) toggleCall();
        else if (requestCode == REQUEST_RECORD_AUDIO) updateStatus(CrewTheme.ROSE_500, "未取得麥克風權限");
    }

    @Override protected void onDestroy() {
        if (client != null) client.stop();
        handler.removeCallbacks(connectionWatchdog);
        super.onDestroy();
    }
}
