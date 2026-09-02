package com.crewpocket.helper;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.util.Base64;
import android.util.Log;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** Gemini Live backed by OkHttp's production WebSocket implementation. */
final class NativeGeminiLiveClient extends WebSocketListener {
    private static final String TAG = "CrewNativeLive";
    interface Listener {
        void onStatus(String text);
        void onStopped(String reason);
        void onTranscript(String role, String text);
        void onSpeakingChanged(boolean speaking);
    }
    private final String apiKey;
    private final String serverUrl;
    private final Listener listener;
    private volatile boolean running;
    private volatile String stage = "尚未開始";
    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private AudioRecord recorder;
    private AudioTrack player;
    // WebSocket callbacks must stay fast: audio writes can block for a whole
    // buffer. Keep PCM on a bounded queue and feed AudioTrack from one thread.
    private final BlockingQueue<byte[]> audioQueue = new LinkedBlockingQueue<byte[]>(96);
    private final Object playerLock = new Object();
    private volatile boolean audioPlaybackRunning;
    private Thread audioPlaybackThread;
    private String resumptionHandle;
    private boolean reconnecting;
    private volatile long visualHoldUntil;
    private volatile boolean setupReady;
    private long screenFrameSequence;
    // Dimensions of the latest image actually shown to Gemini.  They can be
    // smaller than the physical 1440x3120 screen after compression.
    private volatile int lastVisionWidth = 1;
    private volatile int lastVisionHeight = 1;
    private volatile int lastScreenWidth = 1;
    private volatile int lastScreenHeight = 1;
    private final Set<String> handledToolCalls = new HashSet<String>();

    NativeGeminiLiveClient(String apiKey, Listener listener) { this(apiKey, "", listener); }
    NativeGeminiLiveClient(String apiKey, String serverUrl, Listener listener) {
        this.apiKey = apiKey;
        this.serverUrl = serverUrl == null ? "" : serverUrl.trim();
        this.listener = listener;
    }
    boolean isRunning() { return running; }
    String getStage() { return stage; }
    boolean canSendVisualFrame() { return running && System.currentTimeMillis() >= visualHoldUntil; }

    boolean sendText(String text) {
        if (!running || webSocket == null || text == null || text.trim().isEmpty()) return false;
        try {
            JSONObject part = new JSONObject().put("text", text.trim());
            JSONObject turn = new JSONObject().put("role", "user").put("parts", new JSONArray().put(part));
            boolean sent = webSocket.send(new JSONObject().put("clientContent", new JSONObject()
                    .put("turns", new JSONArray().put(turn)).put("turnComplete", true)).toString());
            if (sent) listener.onTranscript("你", text.trim());
            return sent;
        } catch (Exception error) {
            Log.e(TAG, "文字訊息傳送失敗", error);
            return false;
        }
    }

    void sendCameraBytes(final byte[] jpegBytes) {
        if (jpegBytes == null || jpegBytes.length == 0) return;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject video = new JSONObject().put("mimeType", "image/jpeg").put("data", Base64.encodeToString(jpegBytes, Base64.NO_WRAP));
                    boolean sent = webSocket != null && webSocket.send(new JSONObject().put("realtimeInput", new JSONObject().put("video", video)).toString());
                    Log.d(TAG, sent ? "即時相機視訊影格已送達 Gemini" : "即時相機視訊影格未送達");
                } catch (Exception error) { Log.w(TAG, "相機影格傳送失敗：" + error.getMessage()); }
            }
        }, "crew-native-live-camera").start();
    }

    /** Sends a background visual frame while a native Live call is active. */
    void sendCameraFrame(final String path) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    boolean sent = sendImageFile(path, false);
                    Log.d(TAG, sent ? "相機影格已送達 Gemini" : "相機影格未送達 Gemini");
                } catch (Exception error) { Log.w(TAG, "相機影格傳送失敗：" + error.getMessage()); }
            }
        }, "crew-native-live-camera").start();
    }

    void sendScreenFrame() {
        if (!running || !setupReady || webSocket == null) {
            Log.d(TAG, "略過螢幕影格：Gemini 尚未完成 setupComplete");
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject result = captureAndSendScreen();
                    long sequence = ++screenFrameSequence;
                    Log.d(TAG, result.optBoolean("success") ? "螢幕影格 #" + sequence + " 已送達 Gemini（" + System.currentTimeMillis() + "）" : "螢幕影格 #" + sequence + " 未送達 Gemini：" + result.optString("error"));
                } catch (Exception error) { Log.w(TAG, "螢幕影格傳送失敗：" + error.getMessage()); }
            }
        }, "crew-native-live-screen").start();
    }

    void start() {
        if (running) return;
        running = true;
        loadVoiceprintProfile();
        reportStage("建立 Gemini WebSocket…");
        httpClient = new OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build();
        connect();
    }

    private void connect() {
        if (!running) return;
        Request request = new Request.Builder()
                .url("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=" + apiKey)
                .header("Origin", "https://generativelanguage.googleapis.com")
                .build();
        webSocket = httpClient.newWebSocket(request, this);
    }

    private android.media.audiofx.AcousticEchoCanceler aecEffect = null;
    private android.media.audiofx.NoiseSuppressor nsEffect = null;
    private volatile boolean agentMuted = false;
    private volatile boolean aiSpeaking = false;
    private volatile boolean interruptedCurrentTurn = false;
    private volatile boolean allowVoiceInterruption = true; // 🎙️ 語音插話：預設開啟（隨時自由說話打斷 AI；若關閉則為防插話保護模式）

    boolean isAgentMuted() { return agentMuted; }
    boolean isAiSpeaking() { return aiSpeaking; }
    boolean isVoiceInterruptionAllowed() { return allowVoiceInterruption; }
    void setAllowVoiceInterruption(boolean allow) { this.allowVoiceInterruption = allow; }

    void loadVoiceprintProfile() {
        // Voiceprint bypassed for direct, robust latency-free communication
        Log.d(TAG, "🎙️ 原生收音初始化完成（無聲紋延遲門控，直連模式）");
    }

    boolean toggleAgentMute() {
        // 🛑 Tap-to-Interrupt: If AI is speaking, clicking center button instantly interrupts the AI
        if (aiSpeaking) {
            interruptedCurrentTurn = true;
            aiSpeaking = false;
            stopPlayback();
            listener.onSpeakingChanged(false);
            // Send zeroed silence frame to trigger Gemini server VAD turn completion instantly
            try {
                if (webSocket != null) {
                    byte[] silence = new byte[3200];
                    JSONObject root = new JSONObject();
                    JSONObject audio = new JSONObject();
                    audio.put("mimeType", "audio/pcm;rate=16000");
                    audio.put("data", Base64.encodeToString(silence, Base64.NO_WRAP));
                    root.put("realtimeInput", new JSONObject().put("audio", audio));
                    webSocket.send(root.toString());
                }
            } catch (Exception ignored) {}
            return false; // remains unmuted, but interrupted
        }
        agentMuted = !agentMuted;
        return agentMuted;
    }

    void stopPlayback() {
        audioQueue.clear();
        synchronized (playerLock) {
            try {
                if (player != null) {
                    player.pause();
                    player.flush();
                }
            } catch (Exception ignored) {}
        }
    }

    private void triggerLocalInterruption() {
        interruptedCurrentTurn = true;
        aiSpeaking = false;
        stopPlayback();
        listener.onSpeakingChanged(false);
        Log.d(TAG, "⚡ 本地零延遲語音插話觸發：立即停止播放並無縫收音");
    }

    void stop() {
        boolean wasRunning = running;
        running = false;
        setupReady = false;
        stopAudio();
        try { if (webSocket != null) webSocket.close(1000, "Client ended call"); } catch (Exception ignored) {}
        try { if (httpClient != null) httpClient.dispatcher().executorService().shutdown(); } catch (Exception ignored) {}
        if (wasRunning) listener.onStopped("已結束");
    }

    @Override public void onOpen(WebSocket socket, Response response) {
        try {
            reconnecting = false;
            reportStage("Gemini WebSocket 已連線，送出設定…");
            if (!socket.send(buildSetup())) throw new Exception("setup 傳送失敗");
            reportStage("等待 Gemini setupComplete…");
        } catch (Exception error) { fail("設定失敗：" + error.getMessage(), error); }
    }
    @Override public void onMessage(WebSocket socket, String text) {
        logInboundFrame(text, false);
        try { handleJson(text); } catch (Exception error) { fail("Gemini 回覆錯誤：" + error.getMessage(), error); }
    }
    @Override public void onMessage(WebSocket socket, ByteString bytes) {
        // The Live endpoint commonly sends JSON in a binary WebSocket frame.
        // Browsers receive it as a Blob and call Blob.text(); do the Android
        // equivalent rather than treating a valid setupComplete as an error.
        String text = bytes.utf8();
        logInboundFrame(text, true);
        try { handleJson(text); } catch (Exception error) { fail("Gemini binary 回覆錯誤：" + error.getMessage(), error); }
    }

    /** Avoid logging base64 PCM: formatting those large messages can starve audio. */
    private void logInboundFrame(String text, boolean binary) {
        String kind = text.contains("setupComplete") || text.contains("setup_complete") ? "setupComplete"
                : text.contains("toolCall") || text.contains("tool_call") ? "toolCall"
                : text.contains("inlineData") || text.contains("inline_data") ? "audio/modelTurn"
                : text.contains("turnComplete") || text.contains("turn_complete") ? "turnComplete" : "server event";
        Log.d(TAG, "Gemini " + (binary ? "binary " : "") + kind + " (" + text.length() + " chars)");
    }
    @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, null); }
    @Override public void onClosed(WebSocket socket, int code, String reason) {
        if (running && !reconnecting) fail("Gemini 已關閉連線（" + code + "）：" + reason, null);
    }
    @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
        String detail = response == null ? error.getMessage() : "HTTP " + response.code() + " " + response.message();
        fail("Gemini WebSocket 失敗：" + detail, error);
    }

    private void handleJson(String raw) throws Exception {
        JSONObject response = new JSONObject(raw);
        JSONObject error = response.optJSONObject("error");
        if (error != null) throw new Exception(error.optString("message", error.toString()));
        JSONObject resume = response.optJSONObject("sessionResumptionUpdate");
        if (resume == null) resume = response.optJSONObject("session_resumption_update");
        if (resume != null && resume.optBoolean("resumable")) {
            String handle = resume.optString("newHandle", resume.optString("new_handle", ""));
            if (!handle.isEmpty()) resumptionHandle = handle;
        }
        if (response.has("goAway") || response.has("go_away")) {
            if (resumptionHandle == null || resumptionHandle.isEmpty()) {
                throw new Exception("Gemini 要求結束通話，但未提供可續接 session");
            }
            reportStage("🔄 正在延續長通話…");
            reconnecting = true;
            try { if (webSocket != null) webSocket.close(1000, "Resuming Gemini Live session"); } catch (Exception ignored) {}
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { connect(); }
            }, 120);
            return;
        }
        if (response.has("setupComplete") || response.has("setup_complete")) { setupReady = true; reportStage("🎙️ 已連線，直接說話"); startAudio(); return; }
        JSONObject toolCall = response.optJSONObject("toolCall");
        if (toolCall == null) toolCall = response.optJSONObject("tool_call");
        if (toolCall != null) {
            JSONArray calls = toolCall.optJSONArray("functionCalls");
            if (calls == null) calls = toolCall.optJSONArray("function_calls");
            if (calls != null) for (int i = 0; i < calls.length(); i++) executeToolAsync(calls.getJSONObject(i));
        }
        JSONObject server = response.optJSONObject("serverContent");
        if (server == null) server = response.optJSONObject("server_content");
        if (server == null) return;
        if (server.optBoolean("interrupted", false)) {
            stopPlayback();
            interruptedCurrentTurn = true;
            if (aiSpeaking) {
                aiSpeaking = false;
                listener.onSpeakingChanged(false);
            }
            return;
        }
        JSONObject inputTranscript = server.optJSONObject("inputTranscription");
        if (inputTranscript == null) inputTranscript = server.optJSONObject("input_transcription");
        if (inputTranscript != null && !inputTranscript.optString("text").isEmpty()) listener.onTranscript("你", inputTranscript.optString("text"));
        JSONObject outputTranscript = server.optJSONObject("outputTranscription");
        if (outputTranscript == null) outputTranscript = server.optJSONObject("output_transcription");
        if (outputTranscript != null && !outputTranscript.optString("text").isEmpty()) listener.onTranscript("Gemini", outputTranscript.optString("text"));
        JSONObject turn = server.optJSONObject("modelTurn");
        if (turn == null) turn = server.optJSONObject("model_turn");
        if (turn != null) {
            // Continuous camera/screen frames must not arrive while Gemini is
            // producing this answer, otherwise they can trigger a duplicate turn.
            visualHoldUntil = System.currentTimeMillis() + 1800;
            if (!interruptedCurrentTurn) {
                if (!aiSpeaking) {
                    aiSpeaking = true;
                    listener.onSpeakingChanged(true);
                }
                JSONArray parts = turn.optJSONArray("parts");
                if (parts != null) for (int i = 0; i < parts.length(); i++) {
                    JSONObject part = parts.getJSONObject(i);
                    JSONObject inline = part.optJSONObject("inlineData");
                    if (inline == null) inline = part.optJSONObject("inline_data");
                    if (inline != null && inline.optString("data").length() > 0) enqueueAudio(Base64.decode(inline.getString("data"), Base64.DEFAULT));
                    if (part.optString("text").length() > 0) listener.onTranscript("Gemini", part.optString("text"));
                }
            }
        }
        if (server.optBoolean("turnComplete", server.optBoolean("turn_complete", false))) {
            visualHoldUntil = System.currentTimeMillis() + 1000;
            interruptedCurrentTurn = false;
            if (aiSpeaking) {
                aiSpeaking = false;
                listener.onSpeakingChanged(false);
            }
        }
    }

    private String buildSetup() throws Exception {
        JSONObject root = new JSONObject(); JSONObject setup = new JSONObject();
        setup.put("model", "models/gemini-3.1-flash-live-preview");
        JSONObject generation = new JSONObject(); generation.put("responseModalities", new JSONArray().put("AUDIO"));
        generation.put("speechConfig", new JSONObject().put("voiceConfig", new JSONObject().put("prebuiltVoiceConfig", new JSONObject().put("voiceName", "Kore"))));
        setup.put("generationConfig", generation);
        // Match the web Live session: its context is continuously compressed,
        // and Gemini can renew the socket before the upstream lifetime expires.
        setup.put("contextWindowCompression", new JSONObject().put("slidingWindow", new JSONObject()));
        if (resumptionHandle != null && !resumptionHandle.isEmpty()) {
            setup.put("sessionResumption", new JSONObject().put("handle", resumptionHandle));
        } else {
            setup.put("sessionResumption", new JSONObject());
        }
        setup.put("inputAudioTranscription", new JSONObject());
        setup.put("outputAudioTranscription", new JSONObject());
        setup.put("tools", new JSONArray().put(new JSONObject().put("functionDeclarations", buildToolDeclarations())));
        setup.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text",
                "你是 Crew Pocket 的原生即時語音助理。你的定位是高階『規劃者 (Planner) 與意圖解讀者』。自然、準確、極簡地回應；最終回答一律以 AUDIO 語音說出。"
                + "【工具邊界與授權】只有使用者本輪最新一句明確口令要求操作手機時，才可呼叫手機工具；過去對話、推測或一般問題絕不可授權操作。一般問題直接回答。"
                + "【安全防護】絕對禁止刪除、付款、購買、修改帳戶、輸入密碼、OTP、簡訊驗證碼；遇到此類敏感操作一律停止並語音提示使用者自行操作。"
                + "【手機操作三層架構】"
                + "1. 第一層（系統原生優先）：開啟 App（如『打開幣安』『開 Chrome』）一律呼叫 launch_app(app='...') 直接啟動，絕不在桌面滑動翻頁找圖示。系統按鍵（首頁、返回、多工、通知列、快捷設定）一律呼叫 press_key。"
                + "2. 第二層（Accessibility 語意執行）：一律以語意操作為主。點擊按鈕呼叫 tap_screen(label='...' 或 id='...')；滑動呼叫 swipe_screen(direction='up'|'down'|'left'|'right', distance='short'|'normal'|'long')；輸入呼叫 type_text(text='...', target='...')；判斷畫面呼叫 inspect_ui。"
                + "【傳送訊息操作指引】發送訊息時：先 type_text 輸入文字；若需送出，可呼叫 inspect_ui 觀察輸入框旁的發送按鈕（通常為最右側可點擊圖示或帶有 send 描述/ID），並呼叫 tap_screen(id='...' 或 label='...' 或座標) 精準送出。"
                + "3. 第三層（Vision 視覺兜底）：只有在 inspect_ui 完全取不到有效節點（例如 Canvas 畫布、遊戲自訂 UI）時，才呼叫 take_screenshot 截圖並以座標點擊。"
                + "【結束通話】當使用者說『關閉』、『掛斷』、『結束通話』、『退下』、『先這樣』或『再見』時，先簡短道別一句（如『好的，先為您關閉，隨時喊我！』），並一律呼叫 end_voice_session 工具以自動掛斷連線。"
                + "【定時提醒與畫面巡檢】當使用者要求計時（如『5分鐘後叫我』）呼叫 schedule_reminder；週期性檢查畫面（如『每分鐘看一次畫面跟我說』）或等待條件（如『等出現已送達時叫我』）呼叫 start_screen_monitor；查詢目前排程呼叫 list_active_schedules；取消排程呼叫 cancel_schedule。"
                + "【動作執行迴圈】遵守『inspect_ui 觀察 → 決策語意動作 → 執行動作 → 再次 inspect_ui 驗證結果 → 推進下一步（最多5步）』。"))));
        String skillPlaybook = loadVoiceSkillPlaybook();
        if (!skillPlaybook.isEmpty()) {
            setup.getJSONObject("systemInstruction").getJSONArray("parts").getJSONObject(0).put("text", setup.getJSONObject("systemInstruction").getJSONArray("parts").getJSONObject(0).optString("text") + "【已載入手機技能手冊】" + skillPlaybook);
        }
        root.put("setup", setup); return root.toString();
    }

    private JSONArray buildToolDeclarations() throws Exception {
        JSONArray tools = new JSONArray();
        tools.put(new JSONObject().put("name", "launch_app").put("description", "Open an installed Android app directly by name (e.g. 'Binance', 'LINE', 'Chrome', 'Settings'). Always use this instead of looking for icons on launcher.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("app", new JSONObject().put("type", "STRING").put("description", "Visible app name, for example Binance, Chrome, Settings"))).put("required", new JSONArray().put("app"))));
        tools.put(new JSONObject().put("name", "press_key").put("description", "Trigger an Android system key or action.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("key", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("HOME").put("BACK").put("RECENTS").put("NOTIFICATIONS").put("QUICK_SETTINGS").put("POWER_DIALOG")))).put("required", new JSONArray().put("key"))));
        tools.put(new JSONObject().put("name", "inspect_ui").put("description", "Read the current Android accessibility UI tree before and after every phone action. Returns visible labels, descriptions, clickable states, and bounds."));
        tools.put(new JSONObject().put("name", "tap_screen").put("description", "Tap a button or UI element using its semantic label, description, resource viewId, or coordinates. Prefer label or id over coordinates.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("label", new JSONObject().put("type", "STRING").put("description", "The button, app icon, or text label to tap")).put("id", new JSONObject().put("type", "STRING").put("description", "Optional resource viewId (e.g. 'send_btn')")).put("x", new JSONObject().put("type", "NUMBER").put("description", "Optional X coordinate for vision fallback")).put("y", new JSONObject().put("type", "NUMBER").put("description", "Optional Y coordinate for vision fallback")).put("coordinate_space", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("image").put("normalized_1000").put("screen"))))));
        tools.put(new JSONObject().put("name", "swipe_screen").put("description", "Scroll or swipe the phone screen. Direction: up (scroll down), down (scroll up), left, right. Distance: short, normal, long.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("direction", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("up").put("down").put("left").put("right"))).put("distance", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("short").put("normal").put("long").put("page")))).put("required", new JSONArray().put("direction"))));
        tools.put(new JSONObject().put("name", "type_text").put("description", "Type text into an input field or search bar.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("target", new JSONObject().put("type", "STRING").put("description", "Input field hint or label")).put("text", new JSONObject().put("type", "STRING").put("description", "The text to type"))).put("required", new JSONArray().put("text"))));
        tools.put(new JSONObject().put("name", "schedule_reminder").put("description", "Set a countdown timer / reminder in seconds. When time is up, the assistant vibrates and announces the message.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("delay_seconds", new JSONObject().put("type", "NUMBER").put("description", "Delay in seconds, e.g. 300 for 5 minutes")).put("message", new JSONObject().put("type", "STRING").put("description", "Reminder text to speak when timer expires")).put("label", new JSONObject().put("type", "STRING").put("description", "Short label for the timer"))).put("required", new JSONArray().put("delay_seconds"))));
        tools.put(new JSONObject().put("name", "start_screen_monitor").put("description", "Start periodic background screen checks or wait until a specific condition/text appears on screen.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("interval_seconds", new JSONObject().put("type", "NUMBER").put("description", "Interval between checks in seconds (e.g. 60)")).put("duration_minutes", new JSONObject().put("type", "NUMBER").put("description", "Total monitoring duration in minutes (default 10)")).put("target_condition", new JSONObject().put("type", "STRING").put("description", "Optional text/word to look for on screen (e.g. '已送達', '完成')")).put("label", new JSONObject().put("type", "STRING").put("description", "Short task name"))).put("required", new JSONArray().put("interval_seconds"))));
        tools.put(new JSONObject().put("name", "list_active_schedules").put("description", "List all currently active timers, background screen monitors, and countdowns with their remaining time.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject())));
        tools.put(new JSONObject().put("name", "cancel_schedule").put("description", "Cancel one or all active timers/screen monitors.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("task_id", new JSONObject().put("type", "STRING").put("description", "Optional task ID to cancel, e.g. 'timer_1'")).put("label_hint", new JSONObject().put("type", "STRING").put("description", "Optional keyword/label of the timer to cancel")).put("cancel_all", new JSONObject().put("type", "BOOLEAN").put("description", "Set true to cancel all active timers and monitors")))));
        tools.put(new JSONObject().put("name", "take_screenshot").put("description", "Capture the phone screen ONLY when inspect_ui has no nodes (e.g. Canvas, Unity, WebGL, custom game UI) or user explicitly requests it."));
        tools.put(new JSONObject().put("name", "end_voice_session").put("description", "End or hang up the voice call immediately when the user asks to close, exit, hang up, or says goodbye (e.g. 關閉, 掛斷, 結束通話, 退下, 再見, 先這樣)."));
        tools.put(new JSONObject().put("name", "send_to_main_chat").put("description", "Send a clean message to Crew Pocket main chat ONLY when user explicitly asks.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("message", new JSONObject().put("type", "STRING"))).put("required", new JSONArray().put("message"))));
        return tools;
    }

    private void executeToolAsync(final JSONObject call) {
        final String id = call.optString("id", "tool_" + System.nanoTime());
        synchronized (handledToolCalls) { if (!handledToolCalls.add(id)) return; }
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject result = new JSONObject();
                try {
                    String name = call.getString("name");
                    JSONObject args = call.optJSONObject("args");
                    if (args == null) args = new JSONObject();
                    if ("take_screenshot".equals(name)) result = captureAndSendScreen();
                    else if ("inspect_ui".equals(name)) result = inspectUi();
                    else if ("launch_app".equals(name)) result = launchApp(args);
                    else if ("swipe_screen".equals(name)) result = swipe(args);
                    else if ("tap_screen".equals(name)) result = tap(args);
                    else if ("type_text".equals(name)) result = typeText(args);
                    else if ("press_key".equals(name)) result = pressKey(args);
                    else if ("schedule_reminder".equals(name)) {
                        int delay = (int) args.optDouble("delay_seconds", 60);
                        String msg = args.optString("message", args.optString("label", "時間到了"));
                        String lbl = args.optString("label", delay + "秒後提醒");
                        ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(CrewAccessibilityService.getInstance() != null ? CrewAccessibilityService.getInstance() : MainActivity.class.cast(null));
                        ScheduledTaskManager.ScheduledTask task = mgr.scheduleReminder(lbl, delay, msg);
                        result.put("success", true).put("task", task.toJson()).put("message", "已設定計時器：" + lbl);
                    }
                    else if ("start_screen_monitor".equals(name)) {
                        int interval = (int) args.optDouble("interval_seconds", 60);
                        int duration = (int) args.optDouble("duration_minutes", 10);
                        String cond = args.optString("target_condition", "");
                        String lbl = args.optString("label", "畫面巡檢");
                        ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(CrewAccessibilityService.getInstance() != null ? CrewAccessibilityService.getInstance() : MainActivity.class.cast(null));
                        ScheduledTaskManager.ScheduledTask task = mgr.startScreenMonitor(lbl, interval, duration, cond, true);
                        result.put("success", true).put("task", task.toJson()).put("message", "已啟動畫面監控：" + lbl);
                    }
                    else if ("list_active_schedules".equals(name)) {
                        ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(CrewAccessibilityService.getInstance() != null ? CrewAccessibilityService.getInstance() : MainActivity.class.cast(null));
                        result.put("success", true).put("tasks", mgr.getActiveTasksJson()).put("summary", mgr.getActiveTasksSummaryText());
                    }
                    else if ("cancel_schedule".equals(name)) {
                        boolean all = args.optBoolean("cancel_all", false);
                        String taskId = args.optString("task_id", args.optString("label_hint", ""));
                        ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(CrewAccessibilityService.getInstance() != null ? CrewAccessibilityService.getInstance() : MainActivity.class.cast(null));
                        if (all) {
                            int cnt = mgr.cancelAllTasks();
                            result.put("success", true).put("cancelledCount", cnt).put("message", "已取消所有計時器與畫面巡檢");
                        } else {
                            boolean ok = mgr.cancelTask(taskId);
                            result.put("success", ok).put("message", ok ? "已成功取消該計時器" : "找不到指定計時器或巡檢任務");
                        }
                    }
                    else if ("end_voice_session".equals(name)) {
                        result.put("success", true).put("message", "語音通話即將結束");
                        sendToolResponse(id, name, result);
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                            @Override public void run() {
                                stop();
                            }
                        }, 1200);
                        return;
                    }
                    else if ("send_to_main_chat".equals(name)) result = sendToMainChat(args);
                    else result.put("success", false).put("error", "不支援的原生工具：" + name);
                    sendToolResponse(id, name, result);
                } catch (Exception error) {
                    try {
                        result.put("success", false).put("error", error.getMessage() == null ? "工具執行失敗" : error.getMessage());
                        sendToolResponse(id, call.optString("name", "unknown"), result);
                    } catch (Exception ignored) {}
                }
            }
        }, "crew-native-live-tool").start();
    }

    private JSONObject swipe(JSONObject args) throws Exception {
        String direction = args.optString("direction", "up").toLowerCase();
        String distance = args.optString("distance", "normal").toLowerCase();
        
        JSONObject metrics = helperGet("/status");
        int width = metrics.optInt("screenWidth", lastScreenWidth);
        int height = metrics.optInt("screenHeight", lastScreenHeight);
        if (width <= 1 || height <= 1) return new JSONObject().put("success", false).put("error", "無法取得目前裝置螢幕尺寸");
        // Default normal uses proportions so it works on every resolution.
        int x1 = Math.round(width * 0.50f), y1 = Math.round(height * 0.74f), x2 = Math.round(width * 0.50f), y2 = Math.round(height * 0.22f);
        int duration = 320; // optimal drag duration for Android ViewPager / ScrollView recognition

        if ("down".equals(direction)) {
            y1 = Math.round(height * 0.22f); y2 = Math.round(height * 0.74f);
        } else if ("left".equals(direction)) {
            x1 = Math.round(width * 0.87f); y1 = Math.round(height * 0.50f); x2 = Math.round(width * 0.13f); y2 = Math.round(height * 0.50f);
        } else if ("right".equals(direction)) {
            x1 = Math.round(width * 0.13f); y1 = Math.round(height * 0.50f); x2 = Math.round(width * 0.87f); y2 = Math.round(height * 0.50f);
        }

        if ("long".equals(distance) || "page".equals(distance) || "fast".equals(distance)) {
            duration = 280;
            if ("up".equals(direction)) { y1 = Math.round(height * 0.87f); y2 = Math.round(height * 0.13f); }
            else if ("down".equals(direction)) { y1 = Math.round(height * 0.13f); y2 = Math.round(height * 0.87f); }
            else if ("left".equals(direction)) { x1 = Math.round(width * 0.94f); x2 = Math.round(width * 0.06f); }
            else if ("right".equals(direction)) { x1 = Math.round(width * 0.06f); x2 = Math.round(width * 0.94f); }
        } else if ("short".equals(distance) || "little".equals(distance)) {
            duration = 260;
            if ("up".equals(direction)) { y1 = Math.round(height * 0.58f); y2 = Math.round(height * 0.38f); }
            else if ("down".equals(direction)) { y1 = Math.round(height * 0.38f); y2 = Math.round(height * 0.58f); }
            else if ("left".equals(direction)) { x1 = Math.round(width * 0.66f); x2 = Math.round(width * 0.34f); }
            else if ("right".equals(direction)) { x1 = Math.round(width * 0.34f); x2 = Math.round(width * 0.66f); }
        }

        JSONObject before = new JSONObject();
        try { before = helperGet("/nodes"); } catch (Exception ignored) {}
        JSONObject reply = new JSONObject();
        String execution = "gesture";
        // Vertical scrolling can use the foreground app's own scroll action.
        // It is more reliable than a fixed drag for lists and Settings pages.
        if ("up".equals(direction) || "down".equals(direction)) {
            reply = helperPost("/scroll", new JSONObject().put("direction", "up".equals(direction) ? "forward" : "backward"));
            execution = "ui_node";
            Thread.sleep(500);
        }
        JSONObject after = new JSONObject();
        try { after = helperGet("/nodes"); } catch (Exception ignored) {}
        boolean changed = !nodeSignature(before).equals(nodeSignature(after));
        // Canvas, maps and some custom views expose no scrollable node.  If a
        // semantic action was unavailable or made no visible change, fall back
        // once to the existing proportional gesture.
        if (!reply.optBoolean("success") || !changed) {
            reply = helperPost("/swipe", new JSONObject().put("x1", x1).put("y1", y1).put("x2", x2).put("y2", y2).put("duration", duration));
            execution = "gesture_fallback";
            Thread.sleep(800);
            try { after = helperGet("/nodes"); } catch (Exception ignored) {}
            changed = !nodeSignature(before).equals(nodeSignature(after));
        }
        reply.put("direction", direction);
        reply.put("distance", distance);
        reply.put("screenSize", width + "x" + height);
        reply.put("execution", execution);
        // A list can keep exactly the same labels after scrolling; send the
        // post-gesture frame so Gemini sees the actual viewport, not just text.
        JSONObject visual = new JSONObject();
        try { visual = captureAndSendScreen(); } catch (Exception error) { visual.put("success", false).put("error", error.getMessage()); }
        reply.put("screenChanged", changed);
        reply.put("screenFrameSent", visual.optBoolean("success"));
        reply.put("verification", changed
                ? "UI 節點位置或內容已變更；最新螢幕影格已送達，請分析新畫面"
                : (visual.optBoolean("success")
                    ? "文字節點未變，但最新螢幕影格已送達；請依畫面判斷是否已滑動"
                    : "UI 節點與最新螢幕影格皆無法確認變化，請改用另一方向或尋找按鈕"));
        return reply;
    }

    private String nodeSignature(JSONObject response) {
        if (response == null || !response.optBoolean("success")) return "unavailable";
        JSONArray nodes = response.optJSONArray("nodes");
        if (nodes == null) return "empty";
        StringBuilder signature = new StringBuilder();
        for (int i = 0; i < nodes.length(); i++) {
            JSONObject node = nodes.optJSONObject(i);
            if (node != null) {
                signature.append(node.optString("text")).append('|')
                        .append(node.optString("desc")).append('|').append(node.optString("className")).append('|');
                JSONObject bounds = node.optJSONObject("bounds");
                if (bounds != null) signature.append(bounds.optInt("left")).append(',').append(bounds.optInt("top"))
                        .append(',').append(bounds.optInt("right")).append(',').append(bounds.optInt("bottom"));
                signature.append(';');
            }
        }
        return Integer.toHexString(signature.toString().hashCode());
    }

    private JSONObject tap(JSONObject args) throws Exception {
        double targetX = args.optDouble("x", -1);
        double targetY = args.optDouble("y", -1);
        String label = args.optString("label", args.optString("text", args.optString("name", ""))).trim();
        String id = args.optString("id", "").trim();
        String coordinateSpace = args.optString("coordinate_space", "").trim().toLowerCase();
        boolean resolvedFromNode = false;

        // 🎯 1. Let Android activate the matching Accessibility node directly.
        if (!label.isEmpty() || !id.isEmpty()) {
            try {
                JSONObject nodeClick = helperPost("/click", new JSONObject().put("label", label).put("id", id));
                if (nodeClick.optBoolean("success")) {
                    nodeClick.put("resolvedFrom", "ui_node_action");
                    return nodeClick;
                }
                JSONObject nodesResp = helperGet("/nodes");
                if (nodesResp.optBoolean("success")) {
                    JSONArray nodes = nodesResp.optJSONArray("nodes");
                    if (nodes != null) {
                        for (int i = 0; i < nodes.length(); i++) {
                            JSONObject node = nodes.getJSONObject(i);
                            String text = node.optString("text", "");
                            String desc = node.optString("desc", "");
                            String nodeId = node.optString("id", "");
                            boolean matchId = !id.isEmpty() && nodeId.toLowerCase().contains(id.toLowerCase());
                            boolean matchLabel = !label.isEmpty() && (text.toLowerCase().contains(label.toLowerCase()) || desc.toLowerCase().contains(label.toLowerCase()));
                            if (matchId || matchLabel) {
                                JSONObject bounds = node.optJSONObject("bounds");
                                if (bounds != null) {
                                    targetX = (bounds.optDouble("left", 0) + bounds.optDouble("right", 0)) / 2.0;
                                    targetY = (bounds.optDouble("top", 0) + bounds.optDouble("bottom", 0)) / 2.0;
                                    resolvedFromNode = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        if (targetX < 0 || targetY < 0) {
            return new JSONObject().put("success", false).put("error", "找不到指定點擊目標或座標");
        }

        // 📐 2. Explicit coordinate conversion.  The visual frame sent to the
        // model is normally max 1280px on its long edge, not the device size.
        if (!resolvedFromNode && "image".equals(coordinateSpace)) {
            if (lastScreenWidth <= 1 || lastScreenHeight <= 1) return new JSONObject().put("success", false).put("error", "尚未取得目前螢幕尺寸，請先要求查看螢幕後再依影像座標點擊");
            targetX = (targetX / Math.max(1, lastVisionWidth)) * lastScreenWidth;
            targetY = (targetY / Math.max(1, lastVisionHeight)) * lastScreenHeight;
        } else if (!resolvedFromNode && "normalized_1000".equals(coordinateSpace)) {
            if (lastScreenWidth <= 1 || lastScreenHeight <= 1) return new JSONObject().put("success", false).put("error", "尚未取得目前螢幕尺寸，請先 inspect_ui 或查看螢幕");
            targetX = (targetX / 1000.0) * lastScreenWidth;
            targetY = (targetY / 1000.0) * lastScreenHeight;
        } else if (!resolvedFromNode && coordinateSpace.isEmpty() && targetX <= 1.0 && targetY <= 1.0 && (targetX > 0 || targetY > 0)) {
            targetX = targetX * Math.max(1, lastScreenWidth);
            targetY = targetY * Math.max(1, lastScreenHeight);
        } else if (!resolvedFromNode && coordinateSpace.isEmpty() && targetX <= 1000.0 && targetY <= 1000.0 && targetX > 0 && targetY > 0 && targetY < 1200) {
            targetX = (targetX / 1000.0) * Math.max(1, lastScreenWidth);
            targetY = (targetY / 1000.0) * Math.max(1, lastScreenHeight);
        }

        JSONObject reply = helperPost("/tap", new JSONObject().put("x", Math.round(targetX)).put("y", Math.round(targetY)));
        reply.put("resolvedFrom", resolvedFromNode ? "ui_node" : (coordinateSpace.isEmpty() ? "legacy" : coordinateSpace));
        reply.put("visionSize", lastVisionWidth + "x" + lastVisionHeight).put("screenSize", lastScreenWidth + "x" + lastScreenHeight);
        return reply;
    }

    private JSONObject inspectUi() throws Exception {
        JSONObject raw = helperGet("/nodes");
        if (!raw.optBoolean("success")) return raw;
        JSONArray nodes = raw.optJSONArray("nodes");
        JSONArray visible = new JSONArray();
        if (nodes != null) {
            for (int i = 0; i < nodes.length() && visible.length() < 80; i++) {
                JSONObject node = nodes.optJSONObject(i);
                if (node == null) continue;
                String text = node.optString("text", "").trim();
                String desc = node.optString("desc", "").trim();
                if (text.isEmpty() && desc.isEmpty()) continue;
                JSONObject item = new JSONObject().put("text", text).put("desc", desc).put("clickable", node.optBoolean("clickable"));
                if (node.has("bounds")) item.put("bounds", node.optJSONObject("bounds"));
                visible.put(item);
            }
        }
        return new JSONObject().put("success", true).put("nodeCount", nodes == null ? 0 : nodes.length()).put("visible", visible)
                .put("message", "已讀取目前 UI；請只根據 visible 節點決定下一步。");
    }

    private JSONObject launchApp(JSONObject args) throws Exception {
        String app = args.optString("app", "").trim();
        if (app.isEmpty()) return new JSONObject().put("success", false).put("error", "App 名稱不可為空");
        JSONObject found = helperPost("/apps", new JSONObject().put("query", app));
        JSONArray matches = found.optJSONArray("matches");
        if (matches == null || matches.length() == 0) return new JSONObject().put("success", false).put("error", "找不到已安裝的 App：" + app);
        JSONObject selected = null;
        String query = app.toLowerCase();
        for (int i = 0; i < matches.length(); i++) {
            JSONObject candidate = matches.optJSONObject(i);
            if (candidate != null && candidate.optString("label", "").toLowerCase().startsWith(query)) {
                if (selected != null) return new JSONObject().put("success", false).put("error", "找到多個相近 App，請說得更完整");
                selected = candidate;
            }
        }
        if (selected == null && matches.length() == 1) selected = matches.optJSONObject(0);
        if (selected == null) return new JSONObject().put("success", false).put("error", "找到多個 App，請說得更完整");
        JSONObject reply = helperPost("/launch", new JSONObject().put("package", selected.optString("package", "")));
        if (reply.optBoolean("success")) reply.put("app", selected.optString("label", app)).put("message", "已啟動 App，請立刻 inspect_ui 驗證。");
        return reply;
    }

    private String loadVoiceSkillPlaybook() {
        if (serverUrl.isEmpty()) return ""; // Standalone mode: no custom skills server needed
        HttpURLConnection connection = null;
        try {
            String endpoint = serverUrl.replaceAll("/+$", "") + "/api/phone/skills";
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("GET"); connection.setConnectTimeout(1500); connection.setReadTimeout(2500);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return "";
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            StringBuilder raw = new StringBuilder(); String line; while ((line = reader.readLine()) != null) raw.append(line); reader.close();
            JSONArray skills = new JSONObject(raw.toString()).optJSONArray("skills");
            if (skills == null) return "";
            StringBuilder playbook = new StringBuilder();
            for (int i = 0; i < skills.length() && i < 12 && playbook.length() < 12000; i++) {
                JSONObject skill = skills.optJSONObject(i);
                if (skill == null) continue;
                String name = skill.optString("name", "").trim();
                String instruction = skill.optString("instruction", "").trim();
                if (!name.isEmpty() && !instruction.isEmpty()) playbook.append("\n[技能：").append(name).append("] ").append(instruction);
            }
            return playbook.toString();
        } catch (Exception ignored) { return ""; }
        finally { if (connection != null) connection.disconnect(); }
    }

    private JSONObject helperGet(String endpoint) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8766" + endpoint).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(3000); connection.setReadTimeout(5000);
            int code = connection.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream(), "UTF-8"));
            StringBuilder text = new StringBuilder(); String line;
            while ((line = reader.readLine()) != null) text.append(line);
            reader.close();
            return text.length() == 0 ? new JSONObject() : new JSONObject(text.toString());
        } finally { if (connection != null) connection.disconnect(); }
    }

    private JSONObject typeText(JSONObject args) throws Exception {
        String text = args.optString("text", "").trim();
        if (text.isEmpty()) return new JSONObject().put("success", false).put("error", "輸入文字不可為空");

        // 1. If target or coordinates provided, tap to focus first
        String target = args.optString("target", args.optString("label", "")).trim();
        double x = args.optDouble("x", -1);
        double y = args.optDouble("y", -1);

        if (!target.isEmpty() || (x >= 0 && y >= 0)) {
            try {
                JSONObject tapArgs = new JSONObject();
                if (!target.isEmpty()) tapArgs.put("label", target);
                if (x >= 0) tapArgs.put("x", x);
                if (y >= 0) tapArgs.put("y", y);
                tap(tapArgs);
                Thread.sleep(300);
            } catch (Exception ignored) {}
        }

        // 2. Send text to Accessibility Service
        JSONObject reply = helperPost("/type", new JSONObject().put("text", text));
        reply.put("success", true);
        reply.put("message", "已在輸入框輸入：「" + text + "」");
        return reply;
    }

    private JSONObject pressKey(JSONObject args) throws Exception {
        String key = args.optString("key", "").toUpperCase();
        if (!("HOME".equals(key) || "BACK".equals(key) || "RECENTS".equals(key))) return new JSONObject().put("success", false).put("error", "不支援的系統按鍵");
        return helperPost("/key", new JSONObject().put("key", key));
    }

    private JSONObject sendToMainChat(JSONObject args) throws Exception {
        String message = args.optString("message", args.optString("text", "")).trim();
        if (message.isEmpty()) return new JSONObject().put("success", false).put("error", "主對話訊息不可為空");
        if (serverUrl.isEmpty()) {
            return new JSONObject().put("success", true).put("message", "目前為獨立雲端模式，訊息已由語音助理即時紀錄與回答。");
        }
        HttpURLConnection connection = null;
        try {
            String endpoint = serverUrl.replaceAll("/+$", "") + "/api/inbound/messages";
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST"); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setDoOutput(true); connection.setConnectTimeout(3500); connection.setReadTimeout(7000);
            byte[] body = new JSONObject().put("message", message).put("source", "NativeGeminiLive").toString().getBytes("UTF-8");
            connection.setFixedLengthStreamingMode(body.length);
            OutputStream out = connection.getOutputStream(); out.write(body); out.close();
            int code = connection.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream(), "UTF-8"));
            StringBuilder raw = new StringBuilder(); String line; while ((line = reader.readLine()) != null) raw.append(line); reader.close();
            JSONObject reply = raw.length() == 0 ? new JSONObject() : new JSONObject(raw.toString());
            reply.put("success", code >= 200 && code < 300 && reply.optBoolean("success", true));
            if (reply.optBoolean("success")) reply.put("message", "已傳送到目前或最近使用的 Crew Pocket 主對話。");
            return reply;
        } finally { if (connection != null) connection.disconnect(); }
    }

    private JSONObject captureAndSendScreen() throws Exception {
        JSONObject capture = helperPost("/screenshot", new JSONObject());
        if (!capture.optBoolean("success")) return capture;
        String path = capture.optString("latestPath", capture.optString("path", ""));
        if (path.isEmpty()) return new JSONObject().put("success", false).put("error", "截圖未提供檔案路徑");
        if (!sendImageFile(path, true)) return new JSONObject().put("success", false).put("error", "截圖已取得，但 Gemini 連線不可用");
        return new JSONObject().put("success", true).put("silent", capture.optBoolean("silent")).put("message", "最新手機螢幕已傳送，請只依這張畫面回答。");
    }

    private boolean sendImageFile(String path, boolean isScreenFrame) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeFile(path);
        if (bitmap == null) return false;
        int sourceWidth = bitmap.getWidth();
        int sourceHeight = bitmap.getHeight();
        int maxEdge = 1280;
        if (Math.max(bitmap.getWidth(), bitmap.getHeight()) > maxEdge) {
            float scale = maxEdge / (float) Math.max(bitmap.getWidth(), bitmap.getHeight());
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
            bitmap.recycle(); bitmap = scaled;
        }
        lastVisionWidth = bitmap.getWidth();
        lastVisionHeight = bitmap.getHeight();
        if (isScreenFrame) {
            lastScreenWidth = sourceWidth;
            lastScreenHeight = sourceHeight;
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 76, output); bitmap.recycle();
        JSONObject video = new JSONObject().put("mimeType", "image/jpeg").put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
        return webSocket != null && webSocket.send(new JSONObject().put("realtimeInput", new JSONObject().put("video", video)).toString());
    }

    private JSONObject helperPost(String endpoint, JSONObject payload) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8766" + endpoint).openConnection();
            connection.setRequestMethod("POST"); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setDoOutput(true); connection.setConnectTimeout(3500); connection.setReadTimeout(7000);
            byte[] body = payload.toString().getBytes("UTF-8");
            connection.setFixedLengthStreamingMode(body.length);
            OutputStream out = connection.getOutputStream(); out.write(body); out.close();
            int code = connection.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream(), "UTF-8"));
            StringBuilder text = new StringBuilder(); String line;
            while ((line = reader.readLine()) != null) text.append(line);
            reader.close();
            JSONObject response = text.length() == 0 ? new JSONObject() : new JSONObject(text.toString());
            if (!response.has("success")) response.put("success", code >= 200 && code < 300);
            return response;
        } finally { if (connection != null) connection.disconnect(); }
    }

    private void sendToolResponse(String id, String name, JSONObject result) throws Exception {
        JSONObject item = new JSONObject().put("response", new JSONObject().put("result", result)).put("id", id).put("name", name);
        if (webSocket == null || !webSocket.send(new JSONObject().put("toolResponse", new JSONObject().put("functionResponses", new JSONArray().put(item))).toString())) {
            throw new Exception("工具結果無法傳回 Gemini");
        }
    }

    private void startAudio() {
        if (!running || recorder != null) return;
        int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferBytes = Math.max(min * 4, 8192);
        try {
            // 🎙️ VOICE_COMMUNICATION engages Android's hardware DSP full-duplex AEC (Acoustic Echo Cancellation) & AGC
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferBytes);
        } catch (Exception e) {
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferBytes);
        }

        // Attach hardware audio effects if supported by Samsung/Android
        try {
            // 🛡️ AcousticEchoCanceler (AEC): Essential to prevent AI hearing its own voice from loudspeaker!
            if (android.media.audiofx.AcousticEchoCanceler.isAvailable()) {
                aecEffect = android.media.audiofx.AcousticEchoCanceler.create(recorder.getAudioSessionId());
                if (aecEffect != null) aecEffect.setEnabled(true);
            }
            // Keep NoiseSuppressor to clean air conditioner / ambient hiss
            if (android.media.audiofx.NoiseSuppressor.isAvailable()) {
                nsEffect = android.media.audiofx.NoiseSuppressor.create(recorder.getAudioSessionId());
                if (nsEffect != null) nsEffect.setEnabled(true);
            }
        } catch (Exception ignored) {}

        createAudioPlayer();
        startPlaybackWorker();
        recorder.startRecording();
        new Thread(new Runnable() { @Override public void run() { sendMic(); } }, "crew-native-live-mic").start();
    }

    private void createAudioPlayer() {
        synchronized (playerLock) {
            try { if (player != null) { player.stop(); player.release(); } } catch (Exception ignored) {}
            int outMin = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            // One second leaves room for GC, image upload, and transient Wi-Fi jitter.
            int bufferBytes = Math.max(outMin * 8, 48000);
            player = new AudioTrack(android.media.AudioManager.STREAM_MUSIC, 24000,
                    AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    bufferBytes, AudioTrack.MODE_STREAM);
        }
    }

    private void startPlaybackWorker() {
        audioQueue.clear();
        audioPlaybackRunning = true;
        audioPlaybackThread = new Thread(new Runnable() {
            @Override public void run() { runPlaybackLoop(); }
        }, "crew-native-live-playback");
        audioPlaybackThread.start();
    }

    private void runPlaybackLoop() {
        boolean started = false;
        while (audioPlaybackRunning) {
            try {
                byte[] first = audioQueue.poll(300, TimeUnit.MILLISECONDS);
                if (first == null) continue;
                if (!started) {
                    // Start with about 200 ms buffered. It avoids the initial
                    // AudioTrack underrun that previously disabled the track.
                    ArrayList<byte[]> initial = new ArrayList<byte[]>();
                    initial.add(first);
                    int bytes = first.length;
                    long deadline = System.currentTimeMillis() + 180;
                    while (bytes < 9600 && System.currentTimeMillis() < deadline) {
                        byte[] next = audioQueue.poll(Math.max(1, deadline - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                        if (next == null) break;
                        initial.add(next); bytes += next.length;
                    }
                    synchronized (playerLock) { if (player != null) player.play(); }
                    started = true;
                    for (byte[] chunk : initial) writeAudioChunk(chunk);
                } else {
                    writeAudioChunk(first);
                }
            } catch (InterruptedException ignored) {
                // stopAudio interrupts this worker; the loop condition decides exit.
            } catch (Exception error) {
                Log.w(TAG, "音訊播放工作執行失敗：" + error.getMessage());
                recoverAudioPlayer();
                started = false;
            }
        }
    }

    private void writeAudioChunk(byte[] pcm) {
        if (pcm == null || pcm.length == 0 || interruptedCurrentTurn || agentMuted) return;
        lastPlaybackActiveAt = System.currentTimeMillis() + (pcm.length * 1000L / (24000 * 2));
        int written;
        synchronized (playerLock) {
            // 🛡️ Ensure AudioTrack is in PLAYING state (e.g. after interruption flush/pause)
            if (player != null && player.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) {
                try {
                    player.play();
                } catch (Exception ignored) {}
            }
            written = player == null ? AudioTrack.ERROR_INVALID_OPERATION : player.write(pcm, 0, pcm.length);
        }
        if (written < 0) {
            Log.w(TAG, "AudioTrack 寫入失敗（" + written + "），重建播放軌");
            recoverAudioPlayer();
        }
    }

    private void recoverAudioPlayer() {
        if (!audioPlaybackRunning || !running) return;
        createAudioPlayer();
    }
    private double calculateRms(byte[] pcm, int count) {
        if (count < 2) return 0;
        long sum = 0;
        int samples = count / 2;
        for (int i = 0; i < count - 1; i += 2) {
            short val = (short) ((pcm[i] & 0xFF) | (pcm[i + 1] << 8));
            sum += (long) val * val;
        }
        return Math.sqrt((double) sum / samples) / 32768.0;
    }

    private volatile long lastPlaybackActiveAt = 0;
    private static final double INTERRUPT_RMS_THRESHOLD = 0.035; // Sensitive voice energy threshold for interruption

    private void sendMic() {
        byte[] pcm = new byte[1280]; // 40ms @ 16kHz 16-bit mono
        int consecutiveVoiceFrames = 0;

        while (running && recorder != null && webSocket != null) {
            int count = recorder.read(pcm, 0, pcm.length); if (count <= 0) continue;
            if (agentMuted) continue;

            long now = System.currentTimeMillis();
            double rms = calculateRms(pcm, count);

            if (aiSpeaking) {
                if (!allowVoiceInterruption) {
                    // 🛡️ 防插話保護模式：AI 說話時靜音麥克風，防止環境音干擾
                    consecutiveVoiceFrames = 0;
                    continue;
                }

                // 🎙️ 允許插話模式：
                // 當使用者開口講話（RMS 能量突增），連續 2 訊框（約 80ms）即刻觸發本地 0ms 停止播放！
                if (rms >= INTERRUPT_RMS_THRESHOLD) {
                    consecutiveVoiceFrames++;
                    if (consecutiveVoiceFrames >= 2) {
                        triggerLocalInterruption();
                        consecutiveVoiceFrames = 0;
                    }
                } else {
                    if (consecutiveVoiceFrames > 0) consecutiveVoiceFrames--;
                }

                // 若尚未觸發打斷且僅有微弱喇叭殘響，暫緩傳送以防無效迴音
                if (aiSpeaking) {
                    continue;
                }
            } else {
                consecutiveVoiceFrames = 0;
            }

            byte[] chunk = (count == pcm.length) ? pcm.clone() : Arrays.copyOf(pcm, count);

            // 🎙️ 連續即時串流給 Gemini Live
            try {
                JSONObject root = new JSONObject(); JSONObject audio = new JSONObject();
                audio.put("mimeType", "audio/pcm;rate=16000");
                audio.put("data", Base64.encodeToString(chunk, Base64.NO_WRAP));
                root.put("realtimeInput", new JSONObject().put("audio", audio));
                if (!webSocket.send(root.toString())) throw new Exception("audio send failed");
            } catch (Exception error) { fail("麥克風串流失敗：" + error.getMessage(), error); }
        }
    }
    private void enqueueAudio(byte[] pcm) {
        if (agentMuted || interruptedCurrentTurn || pcm == null || pcm.length == 0) return;
        // Preserve current speech instead of blocking the WebSocket callback.
        if (!audioQueue.offer(pcm)) {
            audioQueue.poll();
            if (!audioQueue.offer(pcm)) Log.w(TAG, "音訊佇列已滿，略過過期語音片段");
        }
    }
    private void reportStage(String text) { stage = text; listener.onStatus(text); Log.d(TAG, text); }
    private synchronized void fail(String message, Throwable error) {
        if (!running) return;
        if (error != null) Log.e(TAG, message, error); else Log.e(TAG, message);
        running = false; stopAudio(); listener.onStopped(message);
    }
    private void stopAudio() {
        audioPlaybackRunning = false;
        audioQueue.clear();
        try { if (audioPlaybackThread != null) audioPlaybackThread.interrupt(); } catch (Exception ignored) {}
        audioPlaybackThread = null;
        if (aecEffect != null) { try { aecEffect.release(); } catch (Exception ignored) {} aecEffect = null; }
        if (nsEffect != null) { try { nsEffect.release(); } catch (Exception ignored) {} nsEffect = null; }
        try { if (recorder != null) { recorder.stop(); recorder.release(); recorder = null; } } catch (Exception ignored) {}
        synchronized (playerLock) {
            try { if (player != null) { player.stop(); player.release(); player = null; } } catch (Exception ignored) {}
        }
    }
}
