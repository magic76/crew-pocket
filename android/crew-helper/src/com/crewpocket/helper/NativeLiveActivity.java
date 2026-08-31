package com.crewpocket.helper;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** First-stage native Gemini Live verification screen. */
public class NativeLiveActivity extends Activity {
    private static final int REQUEST_RECORD_AUDIO = 301;
    private EditText apiKeyInput;
    private EditText textInput;
    private TextView status;
    private TextView transcript;
    private String lastTranscriptRole = "";
    private Button callButton;
    private NativeGeminiLiveClient client;
    private final Handler handler = new Handler();
    private final Runnable connectionWatchdog = new Runnable() {
        @Override public void run() {
            if (client != null && client.isRunning()) {
                status.setText("連線逾時診斷：卡在「" + client.getStage() + "」");
            }
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(42, 42, 42, 42);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("🎙️ 原生 Gemini Live 測試");
        title.setTextSize(21);
        title.setTextColor(Color.rgb(20, 184, 166));
        root.addView(title);

        TextView note = new TextView(this);
        note.setText("此頁不使用 Chrome 或 PWA。請輸入 Gemini API Key，按開始後直接以 Android 麥克風與喇叭通話。");
        note.setTextSize(13);
        note.setPadding(0, 22, 0, 12);
        root.addView(note);

        apiKeyInput = new EditText(this);
        apiKeyInput.setHint("Gemini API Key（AIza...）");
        apiKeyInput.setSingleLine(true);
        android.content.SharedPreferences nativePrefs = getSharedPreferences("crew_native_live", MODE_PRIVATE);
        String savedKey = nativePrefs.getString("gemini_live_key", "");
        if (savedKey.isEmpty()) savedKey = getPreferences(MODE_PRIVATE).getString("gemini_live_key", "");
        apiKeyInput.setText(savedKey);
        root.addView(apiKeyInput, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        callButton = new Button(this);
        callButton.setText("開始原生 Live 通話");
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonLp.setMargins(0, 22, 0, 0);
        root.addView(callButton, buttonLp);

        textInput = new EditText(this);
        textInput.setHint("文字測試：例如「看我現在螢幕上有什麼？」");
        textInput.setMinLines(2);
        textInput.setGravity(Gravity.TOP | Gravity.START);
        LinearLayout.LayoutParams textLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        textLp.setMargins(0, 18, 0, 0);
        root.addView(textInput, textLp);

        Button textSendButton = new Button(this);
        textSendButton.setText("傳送文字到 Gemini Live");
        root.addView(textSendButton, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        status = new TextView(this);
        status.setText("待命");
        status.setTextSize(14);
        status.setPadding(0, 24, 0, 0);
        root.addView(status);

        TextView transcriptTitle = new TextView(this);
        transcriptTitle.setText("即時逐字稿");
        transcriptTitle.setTextSize(15);
        transcriptTitle.setTextColor(Color.rgb(20, 184, 166));
        transcriptTitle.setPadding(0, 26, 0, 8);
        root.addView(transcriptTitle);

        transcript = new TextView(this);
        transcript.setText("（通話中的輸入與 Gemini 語音轉錄會顯示在這裡）");
        transcript.setTextSize(14);
        transcript.setTextColor(Color.rgb(220, 230, 235));
        transcript.setPadding(18, 14, 18, 14);
        transcript.setBackgroundColor(Color.rgb(24, 32, 40));
        root.addView(transcript, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        callButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleCall(); }
        });
        textSendButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String text = textInput.getText().toString().trim();
                if (text.isEmpty()) { status.setText("請先輸入測試文字"); return; }
                if (client == null || !client.isRunning()) { status.setText("請先開始 Gemini Live 通話"); return; }
                if (client.sendText(text)) {
                    textInput.setText("");
                    status.setText("文字已送出，等待 Gemini 回覆…");
                } else status.setText("文字送出失敗，請確認 Live 仍連線");
            }
        });
    }

    private void toggleCall() {
        if (client != null && client.isRunning()) {
            client.stop();
            client = null;
            handler.removeCallbacks(connectionWatchdog);
            callButton.setText("開始原生 Live 通話");
            status.setText("已結束");
            return;
        }
        final String key = apiKeyInput.getText().toString().trim();
        if (key.length() < 20) { status.setText("請填入有效 Gemini API Key"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            return;
        }
        getSharedPreferences("crew_native_live", MODE_PRIVATE).edit().putString("gemini_live_key", key).apply();
        startClient(key);
    }

    private void startClient(String key) {
        status.setText("正在連線 Gemini Live…");
        lastTranscriptRole = "";
        client = new NativeGeminiLiveClient(key, new NativeGeminiLiveClient.Listener() {
            @Override public void onStatus(final String text) {
                runOnUiThread(new Runnable() { @Override public void run() { status.setText(text); } });
            }
            @Override public void onStopped(final String reason) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        status.setText(reason);
                        handler.removeCallbacks(connectionWatchdog);
                        callButton.setText("開始原生 Live 通話");
                    }
                });
            }
            @Override public void onTranscript(final String role, final String text) {
                runOnUiThread(new Runnable() { @Override public void run() { appendTranscript(role, text); } });
            }
            @Override public void onSpeakingChanged(final boolean speaking) {}
        });
        client.start();
        handler.removeCallbacks(connectionWatchdog);
        handler.postDelayed(connectionWatchdog, 18000);
        callButton.setText("結束通話");
    }

    private void appendTranscript(String role, String text) {
        if (text == null || text.trim().isEmpty()) return;
        String existing = transcript.getText().toString();
        if (existing.startsWith("（通話中的")) existing = "";
        // Gemini streams short transcript deltas. Keep one visual line per
        // speaker turn instead of making a new line for every two-word delta.
        boolean sameSpeaker = role.equals(lastTranscriptRole) && !existing.isEmpty();
        String next = existing + (sameSpeaker ? "" : (existing.isEmpty() ? "" : "\n") + role + "：") + text.trim();
        // Keep the test UI responsive during a long call while retaining the newest context.
        if (next.length() > 12000) next = next.substring(next.length() - 12000);
        transcript.setText(next);
        lastTranscriptRole = role;
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_RECORD_AUDIO && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) toggleCall();
        else if (requestCode == REQUEST_RECORD_AUDIO) status.setText("未取得麥克風權限");
    }

    @Override protected void onDestroy() {
        if (client != null) client.stop();
        handler.removeCallbacks(connectionWatchdog);
        super.onDestroy();
    }
}
