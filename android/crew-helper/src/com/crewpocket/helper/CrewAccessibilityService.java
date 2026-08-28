package com.crewpocket.helper;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.media.AudioManager;
import android.provider.MediaStore;
import android.database.Cursor;
import android.content.ContentUris;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

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
import java.util.Date;
import java.util.Locale;

public class CrewAccessibilityService extends AccessibilityService {
    private static final String TAG = "CrewAccessibilityService";
    private static final int PORT = 8766;

    private static CrewAccessibilityService instance;
    private ServerSocket serverSocket;
    private boolean isRunning = false;
    private Handler mainHandler;

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

    @Override
    public void onDestroy() {
        isRunning = false;
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
                    if (serverSocket != null) {
                        try { serverSocket.close(); } catch (Exception e) {}
                    }
                    serverSocket = new ServerSocket(PORT);
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
                responseJson = "{\"active\":true,\"service\":\"CrewAccessibilityService\",\"port\":8766}";
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

                performGlobalAction(9);
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Thread.sleep(700); // wait for Android system screenshot write
                            File dir = new File("/sdcard/Pictures/CrewPocket");
                            dir.mkdirs();
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
                    if (body.contains("\"state\":")) {
                        state = body.substring(body.indexOf("\"state\":") + 8).split("[\",}]")[1].trim();
                    }
                    if (body.contains("\"text\":")) {
                        int tStart = body.indexOf("\"text\":") + 7;
                        int firstQuote = body.indexOf("\"", tStart);
                        if (firstQuote != -1) {
                            int secondQuote = body.indexOf("\"", firstQuote + 1);
                            if (secondQuote != -1) {
                                text = body.substring(firstQuote + 1, secondQuote);
                            }
                        }
                    }
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
            } else if (path.startsWith("/key")) {
                String key = "HOME";
                if (body.contains("\"HOME\"")) key = "HOME";
                else if (body.contains("\"BACK\"")) key = "BACK";
                else if (body.contains("\"RECENTS\"")) key = "RECENTS";
                else if (body.contains("\"SCREENSHOT\"")) key = "SCREENSHOT";

                final String fKey = key;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if ("HOME".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_HOME);
                        else if ("BACK".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_BACK);
                        else if ("RECENTS".equalsIgnoreCase(fKey)) performGlobalAction(GLOBAL_ACTION_RECENTS);
                        else if ("SCREENSHOT".equalsIgnoreCase(fKey)) performGlobalAction(9);
                    }
                });
                responseJson = "{\"success\":true,\"action\":\"KEY\",\"key\":\"" + key + "\"}";
            } else if (path.startsWith("/nodes")) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    StringBuilder sb = new StringBuilder();
                    sb.append("{\"success\":true,\"nodes\":[");
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

    private void performTap(float x, float y) {
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 50));
        dispatchGesture(builder.build(), null, null);
    }

    private void performSwipe(float x1, float y1, float x2, float y2, long duration) {
        Path path = new Path();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, duration));
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

        sb.append("{");
        sb.append("\"class\":\"").append(cls != null ? cls.toString() : "").append("\",");
        sb.append("\"text\":\"").append(text != null ? text.toString().replace("\"", "\\\"").replace("\n", " ") : "").append("\",");
        sb.append("\"desc\":\"").append(desc != null ? desc.toString().replace("\"", "\\\"").replace("\n", " ") : "").append("\",");
        sb.append("\"id\":\"").append(viewId != null ? viewId.toString() : "").append("\",");
        sb.append("\"clickable\":").append(node.isClickable()).append(",");
        sb.append("\"bounds\":{\"left\":").append(bounds.left).append(",\"top\":").append(bounds.top)
          .append(",\"right\":").append(bounds.right).append(",\"bottom\":").append(bounds.bottom).append("}");
        sb.append("},");

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
