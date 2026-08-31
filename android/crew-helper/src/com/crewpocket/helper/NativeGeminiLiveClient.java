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
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** Gemini Live backed by OkHttp's production WebSocket implementation. */
final class NativeGeminiLiveClient extends WebSocketListener {
    private static final String TAG = "CrewNativeLive";
    interface Listener { void onStatus(String text); void onStopped(String reason); void onTranscript(String role, String text); }
    private final String apiKey;
    private final Listener listener;
    private volatile boolean running;
    private volatile String stage = "尚未開始";
    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private AudioRecord recorder;
    private AudioTrack player;
    private String resumptionHandle;
    private boolean reconnecting;
    private volatile long visualHoldUntil;
    private final Set<String> handledToolCalls = new HashSet<String>();

    NativeGeminiLiveClient(String apiKey, Listener listener) { this.apiKey = apiKey; this.listener = listener; }
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

    /** Sends a background visual frame while a native Live call is active. */
    void sendCameraFrame(final String path) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    boolean sent = sendImageFile(path);
                    Log.d(TAG, sent ? "相機影格已送達 Gemini" : "相機影格未送達 Gemini");
                } catch (Exception error) { Log.w(TAG, "相機影格傳送失敗：" + error.getMessage()); }
            }
        }, "crew-native-live-camera").start();
    }

    void sendScreenFrame() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject result = captureAndSendScreen();
                    Log.d(TAG, result.optBoolean("success") ? "螢幕影格已送達 Gemini" : "螢幕影格未送達 Gemini：" + result.optString("error"));
                } catch (Exception error) { Log.w(TAG, "螢幕影格傳送失敗：" + error.getMessage()); }
            }
        }, "crew-native-live-screen").start();
    }

    void start() {
        if (running) return;
        running = true;
        reportStage("建立 Gemini WebSocket…");
        httpClient = new OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build();
        connect();
    }

    private void connect() {
        if (!running) return;
        Request request = new Request.Builder()
                .url("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=" + apiKey)
                .header("Origin", "http://127.0.0.1:8000")
                .build();
        webSocket = httpClient.newWebSocket(request, this);
    }

    private volatile boolean agentMuted = false;

    boolean isAgentMuted() { return agentMuted; }

    boolean toggleAgentMute() {
        agentMuted = !agentMuted;
        if (agentMuted) {
            // Cut off any currently playing audio immediately
            try {
                if (player != null) {
                    player.pause();
                    player.flush();
                    player.play();
                }
            } catch (Exception ignored) {}
        }
        return agentMuted;
    }

    void stop() {
        boolean wasRunning = running;
        running = false;
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
        Log.d(TAG, "Gemini JSON: " + text.substring(0, Math.min(900, text.length())));
        try { handleJson(text); } catch (Exception error) { fail("Gemini 回覆錯誤：" + error.getMessage(), error); }
    }
    @Override public void onMessage(WebSocket socket, ByteString bytes) {
        // The Live endpoint commonly sends JSON in a binary WebSocket frame.
        // Browsers receive it as a Blob and call Blob.text(); do the Android
        // equivalent rather than treating a valid setupComplete as an error.
        String text = bytes.utf8();
        Log.d(TAG, "Gemini binary JSON: " + text.substring(0, Math.min(900, text.length())));
        try { handleJson(text); } catch (Exception error) { fail("Gemini binary 回覆錯誤：" + error.getMessage(), error); }
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
        if (response.has("setupComplete") || response.has("setup_complete")) { reportStage("🎙️ 已連線，直接說話"); startAudio(); return; }
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
            JSONArray parts = turn.optJSONArray("parts");
            if (parts != null) for (int i = 0; i < parts.length(); i++) {
                JSONObject part = parts.getJSONObject(i);
                JSONObject inline = part.optJSONObject("inlineData");
                if (inline == null) inline = part.optJSONObject("inline_data");
                if (inline != null && inline.optString("data").length() > 0) playAudio(Base64.decode(inline.getString("data"), Base64.DEFAULT));
                if (part.optString("text").length() > 0) listener.onTranscript("Gemini", part.optString("text"));
            }
        }
        if (server.optBoolean("turnComplete", server.optBoolean("turn_complete", false))) visualHoldUntil = System.currentTimeMillis() + 1000;
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
                "你是 Crew Pocket 的原生即時語音助理。自然、準確、簡潔地回應；最終回答一律以 AUDIO 語音說出。預設使用繁體中文，並依使用者主要語言自然切換。"
                + "姓名、數字、指令或意圖聽不清楚、前後矛盾或影響結果時，先用一句話確認，不要猜測或把雜訊轉錄當成事實。"
                + "【工具邊界】只有使用者本輪最新一句明確要求時，才可使用手機操作工具。截圖、點擊、滑動或按鍵不可由過去對話、推測或一般問題授權；一般問題不可為了確認而使用工具。"
                + "【主對話訊息】只有使用者明確說『傳給主對話』『告訴主對話』或等同意思時，才使用 send_to_main_chat，內容要是乾淨、精確的完整訊息；傳送後立刻口語告知結果。"
                + "【持續視覺】相機或螢幕分享按鈕啟用時，系統每兩秒直接傳入最新影格。這些影格就是你目前可看的畫面；使用者問『看得到嗎』『畫面是什麼』時，直接根據最新影格回答，不要說看不到，也不要再要求截圖。螢幕分享是手機顯示畫面，相機是實體環境，兩者不可互相替代。不要輸出 markdown。"))));
        root.put("setup", setup); return root.toString();
    }

    private JSONArray buildToolDeclarations() throws Exception {
        JSONArray tools = new JSONArray();
        tools.put(new JSONObject().put("name", "take_screenshot").put("description", "Only when the user explicitly asks to see, capture, or inspect the current phone screen, app UI, button, or on-screen content. Captures the latest phone display without a screenshot flash."));
        tools.put(new JSONObject().put("name", "swipe_screen").put("description", "Scroll or swipe the phone screen only when explicitly requested.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("direction", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("up").put("down").put("left").put("right"))).put("distance", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("short").put("normal").put("long")))).put("required", new JSONArray().put("direction"))));
        tools.put(new JSONObject().put("name", "tap_screen").put("description", "Tap an exact screen coordinate only when explicitly requested. Use after inspecting a current screen if location matters.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("x", new JSONObject().put("type", "NUMBER")).put("y", new JSONObject().put("type", "NUMBER"))).put("required", new JSONArray().put("x").put("y"))));
        tools.put(new JSONObject().put("name", "press_key").put("description", "Press HOME, BACK, or RECENTS only when explicitly requested.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("key", new JSONObject().put("type", "STRING").put("enum", new JSONArray().put("HOME").put("BACK").put("RECENTS")))).put("required", new JSONArray().put("key"))));
        tools.put(new JSONObject().put("name", "send_to_main_chat").put("description", "Send a clean message to the current or most recently active Crew Pocket main chat ONLY when the user explicitly asks to send, tell, or hand a message to the main chat.").put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject().put("message", new JSONObject().put("type", "STRING"))).put("required", new JSONArray().put("message"))));
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
                    else if ("swipe_screen".equals(name)) result = swipe(args);
                    else if ("tap_screen".equals(name)) result = tap(args);
                    else if ("press_key".equals(name)) result = pressKey(args);
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
        int x1 = 720, y1 = 1800, x2 = 720, y2 = 800;
        if ("down".equals(direction)) { y1 = 800; y2 = 1800; }
        else if ("left".equals(direction)) { x1 = 1100; y1 = 1500; x2 = 300; y2 = 1500; }
        else if ("right".equals(direction)) { x1 = 300; y1 = 1500; x2 = 1100; y2 = 1500; }
        if ("long".equals(distance)) {
            if ("up".equals(direction)) { y1 = 2200; y2 = 400; }
            else if ("down".equals(direction)) { y1 = 400; y2 = 2200; }
        } else if ("short".equals(distance)) {
            if ("up".equals(direction)) { y1 = 1600; y2 = 1200; }
            else if ("down".equals(direction)) { y1 = 1200; y2 = 1600; }
        }
        JSONObject reply = helperPost("/swipe", new JSONObject().put("x1", x1).put("y1", y1).put("x2", x2).put("y2", y2).put("duration", 250));
        reply.put("direction", direction);
        return reply;
    }

    private JSONObject tap(JSONObject args) throws Exception {
        if (!args.has("x") || !args.has("y")) return new JSONObject().put("success", false).put("error", "點擊需要明確 x、y 座標");
        return helperPost("/tap", new JSONObject().put("x", args.getDouble("x")).put("y", args.getDouble("y")));
    }

    private JSONObject pressKey(JSONObject args) throws Exception {
        String key = args.optString("key", "").toUpperCase();
        if (!("HOME".equals(key) || "BACK".equals(key) || "RECENTS".equals(key))) return new JSONObject().put("success", false).put("error", "不支援的系統按鍵");
        return helperPost("/key", new JSONObject().put("key", key));
    }

    private JSONObject sendToMainChat(JSONObject args) throws Exception {
        String message = args.optString("message", args.optString("text", "")).trim();
        if (message.isEmpty()) return new JSONObject().put("success", false).put("error", "主對話訊息不可為空");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8000/api/inbound/messages").openConnection();
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
        if (!sendImageFile(path)) return new JSONObject().put("success", false).put("error", "截圖已取得，但 Gemini 連線不可用");
        return new JSONObject().put("success", true).put("silent", capture.optBoolean("silent")).put("message", "最新手機螢幕已傳送，請只依這張畫面回答。");
    }

    private boolean sendImageFile(String path) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeFile(path);
        if (bitmap == null) return false;
        int maxEdge = 1280;
        if (Math.max(bitmap.getWidth(), bitmap.getHeight()) > maxEdge) {
            float scale = maxEdge / (float) Math.max(bitmap.getWidth(), bitmap.getHeight());
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
            bitmap.recycle(); bitmap = scaled;
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
        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 4096));
        int outMin = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        player = new AudioTrack(android.media.AudioManager.STREAM_MUSIC, 24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(outMin * 3, 8192), AudioTrack.MODE_STREAM);
        player.play(); recorder.startRecording();
        new Thread(new Runnable() { @Override public void run() { sendMic(); } }, "crew-native-live-mic").start();
    }
    private void sendMic() {
        byte[] pcm = new byte[1280];
        while (running && recorder != null && webSocket != null) {
            int count = recorder.read(pcm, 0, pcm.length); if (count <= 0) continue;
            try {
                JSONObject root = new JSONObject(); JSONObject audio = new JSONObject();
                audio.put("mimeType", "audio/pcm;rate=16000");
                audio.put("data", Base64.encodeToString(count == pcm.length ? pcm : Arrays.copyOf(pcm, count), Base64.NO_WRAP));
                root.put("realtimeInput", new JSONObject().put("audio", audio));
                if (!webSocket.send(root.toString())) throw new Exception("audio send failed");
            } catch (Exception error) { fail("麥克風串流失敗：" + error.getMessage(), error); }
        }
    }
    private void playAudio(byte[] pcm) {
        if (agentMuted) return;
        try { if (player != null && pcm.length > 0) player.write(pcm, 0, pcm.length); } catch (Exception ignored) {}
    }
    private void reportStage(String text) { stage = text; listener.onStatus(text); Log.d(TAG, text); }
    private synchronized void fail(String message, Throwable error) {
        if (!running) return;
        if (error != null) Log.e(TAG, message, error); else Log.e(TAG, message);
        running = false; stopAudio(); listener.onStopped(message);
    }
    private void stopAudio() { try { if (recorder != null) { recorder.stop(); recorder.release(); recorder = null; } } catch (Exception ignored) {} try { if (player != null) { player.stop(); player.release(); player = null; } } catch (Exception ignored) {} }
}
