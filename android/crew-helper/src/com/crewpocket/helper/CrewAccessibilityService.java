package com.crewpocket.helper;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.media.AudioManager;
import android.provider.MediaStore;
import android.database.Cursor;
import android.content.ContentUris;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.List;
import java.util.concurrent.Executor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

public class CrewAccessibilityService extends AccessibilityService {
    private static final String TAG = "CrewAccessibilityService";
    private static final int PORT = 8766;

    private static CrewAccessibilityService instance;
    private ServerSocket serverSocket;
    private boolean isRunning = false;
    private Handler mainHandler;
    private android.speech.SpeechRecognizer wakeRecognizer;
    private Intent wakeRecognizerIntent;
    private boolean wakeWordActive = false;

    public static boolean isServiceRunning() { return instance != null; }
    public static CrewAccessibilityService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        mainHandler = new Handler(Looper.getMainLooper());
        isRunning = true;
        startLocalServer();

        // Start the notification entry point; the floating bubble is opt-in only.
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    FloatingBubbleManager.getInstance(CrewAccessibilityService.this).showNotification();
                    startNativeWakeWordListener();
                } catch (Exception ignored) {}
            }
        }, 800);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        try {
            AccessibilityServiceInfo info = getServiceInfo();
            if (info == null) {
                info = new AccessibilityServiceInfo();
            }
            info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            setServiceInfo(info);
        } catch (Exception ignored) {}
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    private android.os.PowerManager.WakeLock screenWakeLock = null;

    private synchronized void setScreenKeepAwake(boolean enable) {
        try {
            if (enable) {
                if (screenWakeLock == null) {
                    android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        screenWakeLock = pm.newWakeLock(
                            android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK | android.os.PowerManager.ON_AFTER_RELEASE,
                            "CrewPocket:ScreenKeepAwake"
                        );
                        screenWakeLock.setReferenceCounted(false);
                    }
                }
                if (screenWakeLock != null && !screenWakeLock.isHeld()) {
                    screenWakeLock.acquire(4 * 60 * 60 * 1000L); // Max 4h safety timeout
                }
            } else {
                if (screenWakeLock != null && screenWakeLock.isHeld()) {
                    screenWakeLock.release();
                }
            }
        } catch (Exception ignored) {}
    }

    public static boolean isKeepAwakeActive() {
        CrewAccessibilityService service = instance;
        return service != null && service.screenWakeLock != null && service.screenWakeLock.isHeld();
    }

    public static boolean toggleKeepAwake() {
        CrewAccessibilityService service = instance;
        if (service != null) {
            boolean next = !isKeepAwakeActive();
            service.setScreenKeepAwake(next);
            return next;
        }
        return false;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        setScreenKeepAwake(false);
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (Exception e) {}
        try {
            FloatingBubbleManager manager = FloatingBubbleManager.getInstance(this);
            manager.hideBubble();
            manager.cancelNotification();
        } catch (Exception ignored) {}
        instance = null;
        super.onDestroy();
    }

    private void startLocalServer() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!AppConfig.isLocalBridgeEnabled(CrewAccessibilityService.this)) {
                        Log.i(TAG, "Local bridge is disabled in AppConfig, server not started");
                        return;
                    }
                    if (serverSocket != null) {
                        try { serverSocket.close(); } catch (Exception e) {}
                    }
                    // 🛡️ Bind strictly to loopback (127.0.0.1) so LAN/Wi-Fi devices cannot access
                    serverSocket = new ServerSocket(PORT, 50, java.net.InetAddress.getLoopbackAddress());
                    while (isRunning && !serverSocket.isClosed()) {
                        final Socket socket = serverSocket.accept();
                        new Thread(new Runnable() {
                            @Override
                            public void run() {
                                handleSocketRequest(socket);
                            }
                        }).start();
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }).start();
    }

    private static void copyFile(File src, File dst) throws Exception {
        FileInputStream in = new FileInputStream(src);
        FileOutputStream out = new FileOutputStream(dst);
        byte[] buf = new byte[8192];
        int len;
        while ((len = in.read(buf)) > 0) {
            out.write(buf, 0, len);
        }
        in.close();
        out.close();
    }

    private void copyContentUri(String uriString, File dst) throws Exception {
        InputStream in = getContentResolver().openInputStream(android.net.Uri.parse(uriString));
        if (in == null) throw new Exception("無法開啟截圖內容 URI");
        FileOutputStream out = new FileOutputStream(dst);
        byte[] buf = new byte[8192];
        int len;
        while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
        in.close();
        out.close();
    }

    // Keep AI-working captures inside this app's sandbox. Shared Pictures files
    // can survive an uninstall while their MediaStore ownership does not, which
    // leaves a reinstalled helper unable to read a stale "latest" screenshot.
    private File getCaptureDirectory() throws Exception {
        File dir = new File(getFilesDir(), "captures");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("無法建立私有截圖目錄");
        return dir;
    }

    /**
     * Android 11+ accessibility screenshot API. Unlike GLOBAL_ACTION_TAKE_SCREENSHOT,
     * it captures in the background and does not show the system screenshot flash.
     * Reflection keeps this helper buildable with the local API-24 android.jar.
     */
    private boolean requestSilentScreenshot(final Object lock, final String[] result) {
        if (Build.VERSION.SDK_INT < 30) return false;
        try {
            final Class<?> callbackClass = Class.forName("android.accessibilityservice.AccessibilityService$TakeScreenshotCallback");
            final Method takeScreenshot = AccessibilityService.class.getMethod(
                    "takeScreenshot", Integer.TYPE, Executor.class, callbackClass);
            final Executor executor = new Executor() {
                @Override public void execute(Runnable command) { mainHandler.post(command); }
            };
            final Object callback = Proxy.newProxyInstance(callbackClass.getClassLoader(),
                    new Class<?>[]{callbackClass}, new InvocationHandler() {
                        @Override public Object invoke(Object proxy, Method method, Object[] args) {
                            try {
                                if ("onSuccess".equals(method.getName()) && args != null && args.length > 0) {
                                    File dir = getCaptureDirectory();
                                    File latest = new File(dir, "latest_screen_photo.png");
                                    saveSilentScreenshotResult(args[0], latest);
                                    result[0] = "{\"success\":true,\"path\":\"" + latest.getAbsolutePath()
                                            + "\",\"latestPath\":\"" + latest.getAbsolutePath() + "\",\"silent\":true}";
                                } else if ("onFailure".equals(method.getName())) {
                                    result[0] = "{\"success\":false,\"error\":\"背景截圖失敗\"}";
                                }
                            } catch (Exception e) {
                                result[0] = "{\"success\":false,\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
                            } finally {
                                synchronized (lock) { lock.notify(); }
                            }
                            return null;
                        }
                    });
            mainHandler.post(new Runnable() {
                @Override public void run() {
                    try {
                        // 0 is the default display ID.
                        takeScreenshot.invoke(CrewAccessibilityService.this, 0, executor, callback);
                    } catch (Exception e) {
                        result[0] = "{\"success\":false,\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
                        synchronized (lock) { lock.notify(); }
                    }
                }
            });
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void saveSilentScreenshotResult(Object screenshotResult, File destination) throws Exception {
        Method getHardwareBuffer = screenshotResult.getClass().getMethod("getHardwareBuffer");
        Method getColorSpace = screenshotResult.getClass().getMethod("getColorSpace");
        Object hardwareBuffer = getHardwareBuffer.invoke(screenshotResult);
        Object colorSpace = getColorSpace.invoke(screenshotResult);
        Class<?> hardwareBufferClass = Class.forName("android.hardware.HardwareBuffer");
        Class<?> colorSpaceClass = Class.forName("android.graphics.ColorSpace");
        Method wrapHardwareBuffer = Bitmap.class.getMethod("wrapHardwareBuffer", hardwareBufferClass, colorSpaceClass);
        Bitmap bitmap = (Bitmap) wrapHardwareBuffer.invoke(null, hardwareBuffer, colorSpace);
        if (bitmap == null) throw new Exception("背景截圖影像不可用");
        FileOutputStream out = new FileOutputStream(destination);
        try {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw new Exception("背景截圖儲存失敗");
        } finally {
            out.close();
            bitmap.recycle();
            try { hardwareBuffer.getClass().getMethod("close").invoke(hardwareBuffer); } catch (Exception ignored) {}
        }
    }

    private void handleSocketRequest(final Socket socket) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String line = reader.readLine();
            if (line == null) {
                socket.close();
                return;
            }

            String[] parts = line.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET";
            String path = parts.length > 1 ? parts[1] : "/";

            int contentLength = 0;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    try {
                        contentLength = Integer.parseInt(line.substring(15).trim());
                    } catch (Exception e) {}
                }
            }

            StringBuilder bodyBuilder = new StringBuilder();
            if (contentLength > 0) {
                // HTTP Content-Length is measured in bytes, not Java UTF-16 chars.
                // Reading a Chinese JSON payload by char count made the request wait forever.
                char[] buf = new char[Math.min(contentLength, 1024)];
                int bytesRead = 0;
                while (bytesRead < contentLength) {
                    int r = reader.read(buf, 0, Math.min(buf.length, contentLength - bytesRead));
                    if (r == -1) break;
                    String chunk = new String(buf, 0, r);
                    bodyBuilder.append(chunk);
                    bytesRead += chunk.getBytes(StandardCharsets.UTF_8).length;
                }
            }
            String body = bodyBuilder.toString();

            String responseJson = "{\"status\":\"OK\"}";
            if (path.startsWith("/status")) {
                android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
                responseJson = "{\"active\":true,\"service\":\"CrewAccessibilityService\",\"port\":8766,\"screenWidth\":" + metrics.widthPixels + ",\"screenHeight\":" + metrics.heightPixels + "}";
            } else if (path.startsWith("/volume")) {
                try {
                    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    if ("POST".equalsIgnoreCase(method) && body.contains("\"percent\":")) {
                        int start = body.indexOf("\"percent\":") + 10;
                        int requestedPercent = Integer.parseInt(body.substring(start).split("[,}]")[0].trim());
                        requestedPercent = Math.max(0, Math.min(100, requestedPercent));
                        int targetVolume = Math.round(maxVolume * requestedPercent / 100.0f);
                        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, targetVolume, 0);
                    }
                    int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                    int percent = maxVolume > 0 ? Math.round(currentVolume * 100.0f / maxVolume) : 0;
                    responseJson = "{\"success\":true,\"stream\":\"music\",\"current\":" + currentVolume
                            + ",\"max\":" + maxVolume + ",\"percent\":" + percent + "}";
                } catch (Exception e) {
                    responseJson = "{\"success\":false,\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
                }
            } else if (path.startsWith("/screenshot")) {
                final Object lock = new Object();
                final String[] result = new String[]{"{\"success\":false,\"error\":\"Screenshot failed\"}"};
                final long captureStartedAt = System.currentTimeMillis();

                if (requestSilentScreenshot(lock, result)) {
                    synchronized (lock) {
                        try { lock.wait(3500); } catch (Exception ignored) {}
                    }
                    responseJson = result[0];
                } else {
                performGlobalAction(9);
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Thread.sleep(700); // wait for Android system screenshot write
                            File dir = getCaptureDirectory();
                            String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
                            String fileName = "SCREEN_" + timeStamp + ".png";
                            File destFile = new File(dir, fileName);
                            File latestFile = new File(dir, "latest_screen_photo.png");

                            File[] searchDirs = new File[]{
                                new File("/sdcard/DCIM/Screenshots"),
                                new File("/sdcard/Pictures/Screenshots")
                            };
                            File newest = null;
                            String newestUri = null;
                            // Android scoped-storage can report an unreliable
                            // lastModified value. The screenshot action above
                            // is synchronous from the caller's perspective;
                            // choose the newest media file after its delay.
                            long lastMod = 0;

                            // Resolve the new screenshot through MediaStore;
                            // direct File.listFiles() may be empty on newer
                            // Android releases even when the file exists.
                            Cursor media = null;
                            try {
                                String[] projection = {
                                        MediaStore.Images.Media._ID,
                                        MediaStore.Images.Media.DISPLAY_NAME,
                                        MediaStore.Images.Media.DATE_MODIFIED
                                };
                                media = getContentResolver().query(
                                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                                        projection, null, null,
                                        MediaStore.Images.Media.DATE_MODIFIED + " DESC");
                                if (media != null) {
                                    int idCol = media.getColumnIndex(MediaStore.Images.Media._ID);
                                    int nameCol = media.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME);
                                    int dateCol = media.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED);
                                    while (media.moveToNext()) {
                                        String name = nameCol >= 0 ? media.getString(nameCol) : "";
                                        long modified = dateCol >= 0 ? media.getLong(dateCol) * 1000L : 0L;
                                        if (name != null && name.startsWith("Screenshot_") && modified >= captureStartedAt - 5000) {
                                            if (idCol >= 0) {
                                                long id = media.getLong(idCol);
                                                newestUri = ContentUris.withAppendedId(
                                                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString();
                                                newest = null;
                                                lastMod = modified;
                                                break;
                                            }
                                        }
                                    }
                                }
                            } finally {
                                if (media != null) media.close();
                            }

                            for (File d : searchDirs) {
                                if (d.exists() && d.isDirectory()) {
                                    File[] files = d.listFiles();
                                    if (files != null) {
                                        for (File f : files) {
                                            if (f.isFile() && f.lastModified() > lastMod &&
                                                    (f.getName().toLowerCase(Locale.US).endsWith(".png") ||
                                                     f.getName().toLowerCase(Locale.US).endsWith(".jpg") ||
                                                     f.getName().toLowerCase(Locale.US).endsWith(".webp"))) {
                                                lastMod = f.lastModified();
                                                newest = f;
                                            }
                                        }
                                    }
                                }
                            }

                            if (newestUri != null) {
                                copyContentUri(newestUri, destFile);
                                copyFile(destFile, latestFile);
                                result[0] = "{\"success\":true,\"path\":\"" + destFile.getAbsolutePath() + "\",\"latestPath\":\"" + latestFile.getAbsolutePath() + "\"}";
                            } else if (newest != null && newest.exists()) {
                                copyFile(newest, destFile);
                                copyFile(newest, latestFile);
                                result[0] = "{\"success\":true,\"path\":\"" + destFile.getAbsolutePath() + "\",\"latestPath\":\"" + latestFile.getAbsolutePath() + "\"}";
                            } else {
                                result[0] = "{\"success\":false,\"error\":\"未找到本次新產生的截圖檔案\"}";
                            }
                        } catch (Exception e) {
                            result[0] = "{\"success\":false,\"error\":\"" + e.getMessage().replace("\"", "\\\"") + "\"}";
                        } finally {
                            synchronized (lock) {
                                lock.notify();
                            }
                        }
                    }
                }).start();

                synchronized (lock) {
                    try {
                        lock.wait(3500);
                    } catch (Exception ignored) {}
                }
                responseJson = result[0];
                }
            } else if (path.startsWith("/photo")) {
                final boolean isFront = body.toLowerCase().contains("\"front\"") || body.toLowerCase().contains("\"camera\":\"front\"");
                final Object lock = new Object();
                final String[] result = new String[]{"{\"success\":false,\"error\":\"Timeout\"}"};

                CameraCaptureManager.capturePhoto(CrewAccessibilityService.this, isFront, new CameraCaptureManager.CaptureCallback() {
                    @Override
                    public void onSuccess(String filePath) {
                        result[0] = "{\"success\":true,\"path\":\"" + filePath + "\",\"facing\":\"" + (isFront ? "front" : "back") + "\"}";
                        synchronized (lock) {
                            lock.notify();
                        }
                    }

                    @Override
                    public void onError(String error) {
                        result[0] = "{\"success\":false,\"error\":\"" + error.replace("\"", "\\\"") + "\"}";
                        synchronized (lock) {
                            lock.notify();
                        }
                    }
                });

                synchronized (lock) {
                    try {
                        lock.wait(4500);
                    } catch (Exception ignored) {}
                }
                responseJson = result[0];
            } else if (path.startsWith("/notify")) {
                String state = "DONE";
                String text = "";
                try {
                    String parsedState = getJsonString(body, "state");
                    String parsedText = getJsonString(body, "text");
                    if (parsedState != null && !parsedState.isEmpty()) state = parsedState;
                    if (parsedText != null) text = parsedText;
                } catch (Exception ignored) {}

                final String fState = state;
                final String fText = text;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        FloatingBubbleManager.getInstance(CrewAccessibilityService.this).handleNotify(fState, fText);
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"NOTIFIED\",\"state\":\"" + state + "\"}";
            } else if (path.startsWith("/bubble")) {
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        FloatingBubbleManager.getInstance(CrewAccessibilityService.this).showNotification();
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"NOTIFICATION_SHOWN\"}";
            } else if (path.startsWith("/tap")) {
                float x = 0, y = 0;
                try {
                    int xIdx = body.indexOf("\"x\":");
                    int yIdx = body.indexOf("\"y\":");
                    if (xIdx != -1 && yIdx != -1) {
                        x = Float.parseFloat(body.substring(xIdx + 4).split("[,}]")[0].trim());
                        y = Float.parseFloat(body.substring(yIdx + 4).split("[,}]")[0].trim());
                    }
                } catch (Exception e) {}

                final float fx = x, fy = y;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        performTap(fx, fy);
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"TAP\",\"x\":" + x + ",\"y\":" + y + "}";
            } else if (path.startsWith("/click")) {
                final String label = getJsonString(body, "label");
                final String id = getJsonString(body, "id");
                final boolean[] clickSuccess = new boolean[]{false};
                final Object clickLock = new Object();
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        try { clickSuccess[0] = performClickByTarget(label, id); }
                        finally { synchronized (clickLock) { clickLock.notify(); } }
                    }
                });
                synchronized (clickLock) { try { clickLock.wait(1500); } catch (Exception ignored) {} }
                responseJson = "{\"success\":" + clickSuccess[0] + ",\"action\":\"NODE_CLICK\",\"label\":\"" + jsonEscape(label) + "\",\"id\":\"" + jsonEscape(id) + "\"}";
            } else if (path.startsWith("/scroll")) {
                String direction = getJsonString(body, "direction");
                final String targetId = getJsonString(body, "id");
                if (direction == null || direction.isEmpty()) direction = "up";
                final String fDir = direction.toLowerCase(Locale.ROOT);
                final boolean[] scrollSuccess = new boolean[]{false};
                final Object scrollLock = new Object();
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        try {
                            if ("up".equals(fDir) || "forward".equals(fDir)) {
                                scrollSuccess[0] = performScrollAction(true, targetId);
                            } else if ("down".equals(fDir) || "backward".equals(fDir)) {
                                scrollSuccess[0] = performScrollAction(false, targetId);
                            }
                            if (!scrollSuccess[0]) {
                                // Fallback to proportional gesture swipe
                                android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
                                int w = metrics.widthPixels, h = metrics.heightPixels;
                                float x1 = w * 0.5f, y1 = h * 0.72f, x2 = w * 0.5f, y2 = h * 0.28f;
                                if ("down".equals(fDir) || "backward".equals(fDir)) {
                                    y1 = h * 0.28f; y2 = h * 0.72f;
                                } else if ("left".equals(fDir)) {
                                    x1 = w * 0.85f; y1 = h * 0.5f; x2 = w * 0.15f; y2 = h * 0.5f;
                                } else if ("right".equals(fDir)) {
                                    x1 = w * 0.15f; y1 = h * 0.5f; x2 = w * 0.85f; y2 = h * 0.5f;
                                }
                                performSwipe(x1, y1, x2, y2, 320);
                                scrollSuccess[0] = true;
                            }
                        } finally { synchronized (scrollLock) { scrollLock.notify(); } }
                    }
                });
                synchronized (scrollLock) { try { scrollLock.wait(1500); } catch (Exception ignored) {} }
                responseJson = "{\"success\":" + scrollSuccess[0] + ",\"action\":\"SCROLL\",\"direction\":\"" + fDir + (targetId != null ? "\",\"id\":\"" + jsonEscape(targetId) : "") + "\"}";
            } else if (path.startsWith("/swipe")) {
                float x1 = 0, y1 = 0, x2 = 0, y2 = 0;
                long duration = 300;
                try {
                    if (body.contains("\"x1\":")) x1 = Float.parseFloat(body.substring(body.indexOf("\"x1\":") + 5).split("[,}]")[0].trim());
                    if (body.contains("\"y1\":")) y1 = Float.parseFloat(body.substring(body.indexOf("\"y1\":") + 5).split("[,}]")[0].trim());
                    if (body.contains("\"x2\":")) x2 = Float.parseFloat(body.substring(body.indexOf("\"x2\":") + 5).split("[,}]")[0].trim());
                    if (body.contains("\"y2\":")) y2 = Float.parseFloat(body.substring(body.indexOf("\"y2\":") + 5).split("[,}]")[0].trim());
                    if (body.contains("\"duration\":")) duration = Long.parseLong(body.substring(body.indexOf("\"duration\":") + 11).split("[,}]")[0].trim());
                } catch (Exception e) {}

                final float fx1 = x1, fy1 = y1, fx2 = x2, fy2 = y2;
                final long fDur = duration;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        performSwipe(fx1, fy1, fx2, fy2, fDur);
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"SWIPE\"}";
            } else if (path.startsWith("/type")) {
                String textToType = getJsonString(body, "text");
                if (textToType == null && body.contains("\"text\":")) {
                    try {
                        int sIdx = body.indexOf("\"text\":") + 7;
                        textToType = body.substring(sIdx).split("[,}]")[0].replace("\"", "").trim();
                    } catch (Exception ignored) {}
                }
                final String fText = textToType == null ? "" : textToType;
                final boolean[] typeSuccess = new boolean[]{false};
                final Object typeLock = new Object();
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            typeSuccess[0] = performSetText(fText);
                        } finally {
                            synchronized (typeLock) { typeLock.notify(); }
                        }
                    }
                });
                synchronized (typeLock) {
                    try { typeLock.wait(1500); } catch (Exception ignored) {}
                }
                responseJson = "{\"success\":" + typeSuccess[0] + ",\"action\":\"TYPE\",\"text\":\"" + fText.replace("\"", "\\\"") + "\"}";
            } else if (path.startsWith("/schedule/create")) {
                String type = getJsonString(body, "type");
                String label = getJsonString(body, "label");
                String message = getJsonString(body, "message");
                String condition = getJsonString(body, "condition");
                int delaySec = 0;
                int intervalSec = 60;
                int durationMin = 10;
                boolean speech = body.contains("\"speech\":true") || body.contains("\"report_speech\":true");
                try {
                    if (body.contains("\"delay_seconds\":")) delaySec = Integer.parseInt(body.substring(body.indexOf("\"delay_seconds\":") + 16).split("[,}]")[0].trim());
                    if (body.contains("\"interval_seconds\":")) intervalSec = Integer.parseInt(body.substring(body.indexOf("\"interval_seconds\":") + 19).split("[,}]")[0].trim());
                    if (body.contains("\"duration_minutes\":")) durationMin = Integer.parseInt(body.substring(body.indexOf("\"duration_minutes\":") + 19).split("[,}]")[0].trim());
                } catch (Exception ignored) {}

                ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(this);
                ScheduledTaskManager.ScheduledTask task;
                if ("screen_monitor".equalsIgnoreCase(type) || "condition_wait".equalsIgnoreCase(type) || (condition != null && !condition.trim().isEmpty())) {
                    task = mgr.startScreenMonitor(label, intervalSec, durationMin, condition, speech);
                } else {
                    task = mgr.scheduleReminder(label, delaySec > 0 ? delaySec : 60, message);
                }
                responseJson = "{\"success\":true,\"task\":" + task.toJson().toString() + "}";
            } else if (path.startsWith("/schedule/list")) {
                ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(this);
                responseJson = "{\"success\":true,\"tasks\":" + mgr.getActiveTasksJson().toString() + ",\"summary\":\"" + jsonEscape(mgr.getActiveTasksSummaryText()) + "\"}";
            } else if (path.startsWith("/schedule/cancel")) {
                String id = getJsonString(body, "id");
                boolean all = body.contains("\"all\":true") || body.contains("\"cancel_all\":true");
                ScheduledTaskManager mgr = ScheduledTaskManager.getInstance(this);
                if (all) {
                    int count = mgr.cancelAllTasks();
                    responseJson = "{\"success\":true,\"cancelledCount\":" + count + ",\"message\":\"已取消所有排程與計時器\"}";
                } else {
                    boolean cancelled = mgr.cancelTask(id);
                    responseJson = "{\"success\":" + cancelled + ",\"id\":\"" + (id != null ? jsonEscape(id) : "") + "\",\"message\":\"" + (cancelled ? "已取消該排程" : "找不到指定計時器") + "\"}";
                }
            } else if (path.startsWith("/keep_awake")) {
                boolean enable = body.contains("\"enabled\":true") || body.contains("\"enable\":true");
                setScreenKeepAwake(enable);
                responseJson = "{\"success\":true,\"keepAwake\":" + enable + "}";
            } else if (path.startsWith("/key")) {
                String key = "HOME";
                if (body.contains("\"BACK\"")) key = "BACK";
                else if (body.contains("\"RECENTS\"")) key = "RECENTS";
                else if (body.contains("\"NOTIFICATIONS\"")) key = "NOTIFICATIONS";
                else if (body.contains("\"QUICK_SETTINGS\"")) key = "QUICK_SETTINGS";
                else if (body.contains("\"POWER_DIALOG\"")) key = "POWER_DIALOG";
                else if (body.contains("\"SCREENSHOT\"")) key = "SCREENSHOT";
                else if (body.contains("\"HOME\"")) key = "HOME";

                final String fKey = key;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if ("HOME".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_HOME);
                        else if ("BACK".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_BACK);
                        else if ("RECENTS".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_RECENTS);
                        else if ("NOTIFICATIONS".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
                        else if ("QUICK_SETTINGS".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
                        else if ("POWER_DIALOG".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
                        else if ("SCREENSHOT".equalsIgnoreCase(fKey)) performGlobalAction(9);
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"KEY\",\"key\":\"" + key + "\"}";
            } else if (path.startsWith("/launch")) {
                final String appName = getJsonString(body, "app");
                final String packageName = getJsonString(body, "package");
                final String url = getJsonString(body, "url");
                final String target = getJsonString(body, "target");
                final boolean[] launchSuccess = new boolean[]{false};
                final String[] resolvedPkg = new String[]{""};
                final Object launchLock = new Object();
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        try {
                            Intent intent = null;
                            if (url != null && !url.trim().isEmpty()) {
                                intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url.trim()));
                            } else if ("settings".equalsIgnoreCase(target)) {
                                intent = new Intent(Settings.ACTION_SETTINGS);
                            } else if (packageName != null && !packageName.trim().isEmpty()) {
                                intent = getPackageManager().getLaunchIntentForPackage(packageName.trim());
                                resolvedPkg[0] = packageName.trim();
                            } else if (appName != null && !appName.trim().isEmpty()) {
                                Intent launcherIntent = new Intent(Intent.ACTION_MAIN, null);
                                launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                                List<ResolveInfo> results = getPackageManager().queryIntentActivities(launcherIntent, 0);
                                String lowerApp = appName.trim().toLowerCase(Locale.ROOT);
                                for (ResolveInfo info : results) {
                                    String label = String.valueOf(info.loadLabel(getPackageManager()));
                                    String pkg = info.activityInfo.packageName;
                                    if (matchesAppQuery(label, pkg, lowerApp)) {
                                        intent = getPackageManager().getLaunchIntentForPackage(pkg);
                                        resolvedPkg[0] = pkg;
                                        break;
                                    }
                                }
                            }
                            if (intent != null) {
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                launchSuccess[0] = true;
                            }
                        } catch (Exception ignored) {}
                        finally { synchronized (launchLock) { launchLock.notify(); } }
                    }
                });
                synchronized (launchLock) { try { launchLock.wait(1500); } catch (Exception ignored) {} }
                responseJson = "{\"success\":" + launchSuccess[0] + ",\"action\":\"LAUNCH\",\"package\":\"" + jsonEscape(resolvedPkg[0]) + "\"}";
            } else if (path.startsWith("/apps")) {
                String query = getJsonString(body, "query");
                String lowerQuery = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
                StringBuilder apps = new StringBuilder("{\"success\":true,\"matches\":[");
                try {
                    Intent launcherIntent = new Intent(Intent.ACTION_MAIN, null);
                    launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                    List<ResolveInfo> results = getPackageManager().queryIntentActivities(launcherIntent, 0);
                    int count = 0;
                    for (ResolveInfo info : results) {
                        String label = String.valueOf(info.loadLabel(getPackageManager()));
                        String packageName = info.activityInfo.packageName;
                        if (!matchesAppQuery(label, packageName, lowerQuery)) continue;
                        if (count++ >= 12) break;
                        if (count > 1) apps.append(',');
                        apps.append("{\"label\":\"").append(jsonEscape(label)).append("\",\"package\":\"").append(jsonEscape(packageName)).append("\"}");
                    }
                } catch (Exception ignored) {}
                apps.append("]}");
                responseJson = apps.toString();
            } else if (path.startsWith("/nodes") || path.startsWith("/screen_info")) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    CharSequence pkg = root.getPackageName();
                    android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
                    StringBuilder sb = new StringBuilder();
                    sb.append("{\"success\":true,\"package\":\"").append(pkg != null ? jsonEscape(pkg.toString()) : "").append("\",");
                    sb.append("\"screenWidth\":").append(metrics.widthPixels).append(",\"screenHeight\":").append(metrics.heightPixels).append(",");
                    sb.append("\"nodes\":[");
                    dumpNodesJson(root, sb);
                    if (sb.charAt(sb.length() - 1) == ',') sb.deleteCharAt(sb.length() - 1);
                    sb.append("]}");
                    responseJson = sb.toString();
                    root.recycle();
                } else {
                    responseJson = "{\"success\":false,\"error\":\"No active window found\"}";
                }
            }

            byte[] responseBytes = responseJson.getBytes(StandardCharsets.UTF_8);
            OutputStream out = socket.getOutputStream();
            out.write("HTTP/1.1 200 OK\r\n".getBytes(StandardCharsets.UTF_8));
            out.write("Content-Type: application/json; charset=utf-8\r\n".getBytes(StandardCharsets.UTF_8));
            out.write("Access-Control-Allow-Origin: *\r\n".getBytes(StandardCharsets.UTF_8));
            out.write(("Content-Length: " + responseBytes.length + "\r\n").getBytes(StandardCharsets.UTF_8));
            out.write("\r\n".getBytes(StandardCharsets.UTF_8));
            out.write(responseBytes);
            out.flush();
            socket.close();
        } catch (Exception e) {
            try { socket.close(); } catch (Exception ignored) {}
        }
    }

    /** Minimal JSON string reader for the helper's tiny local-only API. */
    private String getJsonString(String json, String key) {
        String marker = "\"" + key + "\"";
        int keyIndex = json.indexOf(marker);
        if (keyIndex < 0) return null;
        int colon = json.indexOf(':', keyIndex + marker.length());
        if (colon < 0) return null;
        int start = json.indexOf('"', colon + 1);
        if (start < 0) return null;
        StringBuilder value = new StringBuilder();
        boolean escaped = false;
        for (int i = start + 1; i < json.length(); i++) {
            char ch = json.charAt(i);
            if (escaped) {
                switch (ch) {
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'u':
                        if (i + 4 < json.length()) {
                            try { value.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16)); i += 4; }
                            catch (Exception ignored) { value.append('u'); }
                        } else value.append('u');
                        break;
                    default: value.append(ch); break;
                }
                escaped = false;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                return value.toString();
            } else {
                value.append(ch);
            }
        }
        return null;
    }

    private String jsonEscape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    /** Matches localized labels and technical package names token by token.
     * For example, spoken "Google Map" matches com.google.android.apps.maps
     * even when the launcher label is the localized "地圖". */
    private boolean matchesAppQuery(String label, String packageName, String query) {
        if (query == null || query.trim().isEmpty()) return true;
        String haystack = ((label == null ? "" : label) + " " + (packageName == null ? "" : packageName)).toLowerCase(Locale.ROOT);
        String[] tokens = query.trim().split("[^\\p{L}\\p{N}]+");
        for (String token : tokens) {
            if (token.length() == 0) continue;
            if (!haystack.contains(token)) return false;
        }
        return true;
    }

    private void performTap(float x, float y) {
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 50));
        dispatchGesture(builder.build(), null, null);
    }

    private boolean performClickByTarget(String label, String id) {
        if ((label == null || label.trim().isEmpty()) && (id == null || id.trim().isEmpty())) return false;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        try {
            AccessibilityNodeInfo target = null;
            if (id != null && !id.trim().isEmpty()) {
                target = findMatchingNodeById(root, id.trim());
            }
            if (target == null && label != null && !label.trim().isEmpty()) {
                target = findMatchingClickableNode(root, label.trim(), true);
                if (target == null) target = findMatchingClickableNode(root, label.trim(), false);
            }
            if (target == null) return false;
            try {
                Rect bounds = new Rect();
                target.getBoundsInScreen(bounds);
                boolean clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                // Physical tap fallback ensures custom views and touch listeners receive click
                if (bounds.width() > 0 && bounds.height() > 0) {
                    performTap(bounds.centerX(), bounds.centerY());
                    return true;
                }
                return clicked;
            } finally { target.recycle(); }
        } catch (Exception ignored) {
            return false;
        } finally {
            root.recycle();
        }
    }

    private void collectClickableNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> list) {
        if (node == null) return;
        if (node.isClickable()) {
            Rect b = new Rect();
            node.getBoundsInScreen(b);
            // Ignore giant full-screen containers
            if (b.width() > 0 && b.height() > 0 && (b.width() < 600 || b.height() < 400)) {
                list.add(AccessibilityNodeInfo.obtain(node));
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectClickableNodes(child, list);
                child.recycle();
            }
        }
    }

    private AccessibilityNodeInfo findActiveEditText(AccessibilityNodeInfo root) {
        if (root == null) return null;
        List<AccessibilityNodeInfo> editList = new ArrayList<AccessibilityNodeInfo>();
        collectEditableNodes(root, editList);
        AccessibilityNodeInfo lowest = null;
        int maxBottom = -1;
        for (AccessibilityNodeInfo e : editList) {
            Rect b = new Rect();
            e.getBoundsInScreen(b);
            if (b.bottom > maxBottom && b.height() > 10) {
                maxBottom = b.bottom;
                if (lowest != null) lowest.recycle();
                lowest = AccessibilityNodeInfo.obtain(e);
            }
            e.recycle();
        }
        return lowest;
    }

    private void collectEditableNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> list) {
        if (node == null) return;
        if (node.isEditable() || (node.getClassName() != null && node.getClassName().toString().toLowerCase(Locale.ROOT).contains("edittext"))) {
            list.add(AccessibilityNodeInfo.obtain(node));
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectEditableNodes(child, list);
                child.recycle();
            }
        }
    }

    private AccessibilityNodeInfo findMatchingNodeById(AccessibilityNodeInfo node, String id) {
        if (node == null) return null;
        CharSequence viewId = node.getViewIdResourceName();
        if (viewId != null && viewId.toString().toLowerCase(Locale.ROOT).contains(id.toLowerCase(Locale.ROOT))) {
            AccessibilityNodeInfo clickable = findClickableAncestor(node);
            if (clickable != null) return clickable;
            return AccessibilityNodeInfo.obtain(node);
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                AccessibilityNodeInfo res = findMatchingNodeById(child, id);
                if (res != null) return res;
            } finally {
                child.recycle();
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findMatchingClickableNode(AccessibilityNodeInfo node, String label, boolean exact) {
        if (node == null) return null;
        String query = label.toLowerCase(Locale.ROOT).trim();
        String text = node.getText() == null ? "" : node.getText().toString().trim();
        String desc = node.getContentDescription() == null ? "" : node.getContentDescription().toString().trim();
        String viewId = node.getViewIdResourceName() == null ? "" : node.getViewIdResourceName().toString().trim();

        boolean matched = exact
                ? (text.equalsIgnoreCase(label) || desc.equalsIgnoreCase(label) || viewId.equalsIgnoreCase(label))
                : (text.toLowerCase(Locale.ROOT).contains(query) || desc.toLowerCase(Locale.ROOT).contains(query) || viewId.toLowerCase(Locale.ROOT).contains(query));

        if (!matched && !exact) {
            boolean isSendQuery = query.contains("發送") || query.contains("送出") || query.contains("傳送") || query.contains("send");
            if (isSendQuery) {
                String combined = (text + " " + desc + " " + viewId).toLowerCase(Locale.ROOT);
                if (combined.contains("發送") || combined.contains("送出") || combined.contains("傳送") || combined.contains("send") || combined.contains("send-btn")) {
                    matched = true;
                }
            }
        }

        if (matched) {
            AccessibilityNodeInfo clickable = findClickableAncestor(node);
            if (clickable != null) return clickable;
            return AccessibilityNodeInfo.obtain(node);
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                AccessibilityNodeInfo result = findMatchingClickableNode(child, label, exact);
                if (result != null) return result;
            } finally {
                child.recycle();
            }
        }
        return null;
    }

    // ── Native Background Wake Word Engine ──
    public void startNativeWakeWordListener() {
        if (wakeWordActive || NativeLiveService.isActive()) return;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                try {
                    if (!android.speech.SpeechRecognizer.isRecognitionAvailable(CrewAccessibilityService.this)) return;
                    if (wakeRecognizer != null) {
                        try { wakeRecognizer.destroy(); } catch (Exception ignored) {}
                        wakeRecognizer = null;
                    }
                    wakeRecognizer = android.speech.SpeechRecognizer.createSpeechRecognizer(CrewAccessibilityService.this);
                    wakeRecognizerIntent = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    wakeRecognizerIntent.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    wakeRecognizerIntent.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "zh-TW");
                    wakeRecognizerIntent.putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    wakeRecognizerIntent.putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 3);

                    wakeRecognizer.setRecognitionListener(new android.speech.RecognitionListener() {
                        @Override public void onReadyForSpeech(Bundle params) {}
                        @Override public void onBeginningOfSpeech() {}
                        @Override public void onRmsChanged(float rmsdB) {}
                        @Override public void onBufferReceived(byte[] buffer) {}
                        @Override public void onEndOfSpeech() {}
                        @Override public void onError(int error) {
                            if (!NativeLiveService.isActive() && isRunning) {
                                mainHandler.postDelayed(new Runnable() {
                                    @Override public void run() {
                                        startNativeWakeWordListener();
                                    }
                                }, 1500);
                            }
                        }
                        @Override public void onResults(Bundle results) {
                            handleWakeResults(results);
                            if (!NativeLiveService.isActive() && isRunning) {
                                mainHandler.postDelayed(new Runnable() {
                                    @Override public void run() {
                                        startNativeWakeWordListener();
                                    }
                                }, 800);
                            }
                        }
                        @Override public void onPartialResults(Bundle partialResults) {
                            handleWakeResults(partialResults);
                        }
                        @Override public void onEvent(int eventType, Bundle params) {}
                    });

                    wakeRecognizer.startListening(wakeRecognizerIntent);
                    wakeWordActive = true;
                } catch (Exception ignored) {}
            }
        });
    }

    private void handleWakeResults(Bundle bundle) {
        if (bundle == null || NativeLiveService.isActive()) return;
        ArrayList<String> matches = bundle.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null) return;
        for (String text : matches) {
            if (text == null) continue;
            String lower = text.trim().toLowerCase(Locale.ROOT).replace(" ", "");
            if (lower.contains("小酷小酷") || lower.contains("小酷") || lower.contains("小酷同學") || lower.contains("阿酷阿酷") || lower.contains("嗨小酷") || lower.contains("小庫小庫") || lower.contains("小褲小褲") || lower.contains("heypocket") || lower.contains("heycrew") || lower.contains("hicrew") || lower.contains("嗨酷")) {
                stopNativeWakeWordListener();
                try {
                    android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                    if (v != null) v.vibrate(new long[]{0, 40, 60, 40}, -1);
                } catch (Exception ignored) {}
                NativeLiveService.start(CrewAccessibilityService.this);
                break;
            }
        }
    }

    public void stopNativeWakeWordListener() {
        wakeWordActive = false;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (wakeRecognizer != null) {
                    try {
                        wakeRecognizer.stopListening();
                        wakeRecognizer.destroy();
                    } catch (Exception ignored) {}
                    wakeRecognizer = null;
                }
            }
        });
    }

    private AccessibilityNodeInfo findClickableAncestor(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = AccessibilityNodeInfo.obtain(node);
        while (current != null) {
            if (current.isClickable()) return current;
            AccessibilityNodeInfo parent = current.getParent();
            current.recycle();
            current = parent;
        }
        return null;
    }

    private boolean performSetText(String text) {
        if (text == null) return false;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        try {
            // First check input-focused node
            AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (target == null) {
                target = findEditableNode(root);
            }
            if (target != null) {
                target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                android.os.Bundle args = new android.os.Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                boolean success = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                try {
                    android.os.Bundle selArgs = new android.os.Bundle();
                    selArgs.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, text.length());
                    selArgs.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, text.length());
                    target.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, selArgs);
                } catch (Exception ignored) {}
                target.recycle();
                return success;
            }
        } catch (Exception ignored) {}
        finally {
            root.recycle();
        }
        return false;
    }

    private AccessibilityNodeInfo findEditableNode(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable() || (node.getClassName() != null && node.getClassName().toString().contains("EditText"))) {
            return AccessibilityNodeInfo.obtain(node);
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = findEditableNode(child);
                child.recycle();
                if (res != null) return res;
            }
        }
        return null;
    }

    private boolean performScrollAction(boolean forward, String id) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        try {
            AccessibilityNodeInfo scrollable = null;
            if (id != null && !id.trim().isEmpty()) {
                AccessibilityNodeInfo targetNode = findMatchingNodeById(root, id.trim());
                if (targetNode != null) {
                    if (targetNode.isScrollable()) {
                        scrollable = targetNode;
                    } else {
                        scrollable = findScrollableNode(targetNode);
                        if (scrollable == null) scrollable = targetNode;
                    }
                }
            }
            if (scrollable == null) {
                scrollable = findScrollableNode(root);
            }
            if (scrollable != null) {
                int action = forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
                boolean success = scrollable.performAction(action);
                scrollable.recycle();
                return success;
            }
        } catch (Exception ignored) {}
        finally {
            root.recycle();
        }
        return false;
    }

    private AccessibilityNodeInfo findScrollableNode(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isScrollable()) {
            return AccessibilityNodeInfo.obtain(node);
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo res = findScrollableNode(child);
                child.recycle();
                if (res != null) return res;
            }
        }
        return null;
    }

    private void performSwipe(float x1, float y1, float x2, float y2, long duration) {
        Path path = new Path();
        path.moveTo(x1, y1);
        
        // Construct smooth, continuous multi-point natural finger curve (easing out)
        int steps = 12;
        float dx = x2 - x1;
        float dy = y2 - y1;
        
        for (int i = 1; i <= steps; i++) {
            float t = (float) i / steps;
            // Quintic / Sine Ease-Out curve for silky smooth inertia
            float progress = (float) Math.sin(t * (Math.PI / 2.0));
            float currX = x1 + dx * progress;
            float currY = y1 + dy * progress;
            path.lineTo(currX, currY);
        }

        GestureDescription.Builder builder = new GestureDescription.Builder();
        long dur = Math.max(300, Math.min(650, duration));
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
        dispatchGesture(builder.build(), null, null);
    }

    private void dumpNodesJson(AccessibilityNodeInfo node, StringBuilder sb) {
        if (node == null) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);

        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        CharSequence cls = node.getClassName();
        CharSequence viewId = node.getViewIdResourceName();
        boolean clickable = node.isClickable();
        boolean scrollable = node.isScrollable();
        boolean editable = node.isEditable();

        boolean hasContent = (text != null && text.length() > 0) || (desc != null && desc.length() > 0) || (viewId != null && viewId.length() > 0);
        if (hasContent || clickable || scrollable || editable) {
            sb.append("{");
            sb.append("\"class\":\"").append(cls != null ? cls.toString() : "").append("\",");
            sb.append("\"text\":\"").append(text != null ? jsonEscape(text.toString()) : "").append("\",");
            sb.append("\"desc\":\"").append(desc != null ? jsonEscape(desc.toString()) : "").append("\",");
            sb.append("\"id\":\"").append(viewId != null ? jsonEscape(viewId.toString()) : "").append("\",");
            sb.append("\"clickable\":").append(clickable).append(",");
            sb.append("\"scrollable\":").append(scrollable).append(",");
            sb.append("\"editable\":").append(editable).append(",");
            sb.append("\"bounds\":{\"left\":").append(bounds.left).append(",\"top\":").append(bounds.top)
              .append(",\"right\":").append(bounds.right).append(",\"bottom\":").append(bounds.bottom).append("}");
            sb.append("},");
        }

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                dumpNodesJson(child, sb);
                child.recycle();
            }
        }
    }
}
