package com.crewpocket.helper;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Manages background timers, reminders, and periodic screen monitoring tasks.
 */
public class ScheduledTaskManager {
    private static ScheduledTaskManager instance;
    private final Context context;
    private final Handler mainHandler;
    private final Vibrator vibrator;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    public static class ScheduledTask {
        public String id;
        public String type; // "reminder", "screen_monitor", "condition_wait"
        public String label;
        public String message;
        public long createdAt;
        public long targetTime;
        public int intervalSeconds;
        public int durationMinutes;
        public String conditionText;
        public boolean reportSpeech;
        public int checkCount;
        public boolean cancelled;
        public Runnable runnable;

        public JSONObject toJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("id", id);
                obj.put("type", type);
                obj.put("label", label);
                obj.put("message", message);
                obj.put("createdAt", createdAt);
                obj.put("targetTime", targetTime);
                long remaining = Math.max(0, (targetTime - System.currentTimeMillis()) / 1000);
                obj.put("remainingSeconds", remaining);
                obj.put("intervalSeconds", intervalSeconds);
                obj.put("conditionText", conditionText);
                obj.put("checkCount", checkCount);
            } catch (Exception ignored) {}
            return obj;
        }
    }

    private final ConcurrentHashMap<String, ScheduledTask> activeTasks = new ConcurrentHashMap<String, ScheduledTask>();
    private final AtomicLong idCounter = new AtomicLong(1);

    public static synchronized ScheduledTaskManager getInstance(Context context) {
        if (instance == null) {
            instance = new ScheduledTaskManager(context.getApplicationContext());
        }
        return instance;
    }

    private ScheduledTaskManager(Context context) {
        this.context = context;
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        try {
            this.tts = new TextToSpeech(context, new TextToSpeech.OnInitListener() {
                @Override public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS) {
                        try {
                            tts.setLanguage(Locale.TRADITIONAL_CHINESE);
                            ttsReady = true;
                        } catch (Exception ignored) {}
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    public ScheduledTask scheduleReminder(String label, int delaySeconds, final String message) {
        final ScheduledTask task = new ScheduledTask();
        task.id = "timer_" + idCounter.getAndIncrement();
        task.type = "reminder";
        task.label = (label != null && !label.trim().isEmpty()) ? label.trim() : (delaySeconds + "秒後提醒");
        task.message = (message != null && !message.trim().isEmpty()) ? message.trim() : task.label;
        task.createdAt = System.currentTimeMillis();
        task.targetTime = task.createdAt + (delaySeconds * 1000L);
        task.intervalSeconds = 0;
        task.cancelled = false;

        task.runnable = new Runnable() {
            @Override public void run() {
                if (task.cancelled) return;
                activeTasks.remove(task.id);
                triggerAlarm(task.label, task.message);
            }
        };

        activeTasks.put(task.id, task);
        mainHandler.postDelayed(task.runnable, delaySeconds * 1000L);
        return task;
    }

    public ScheduledTask startScreenMonitor(String label, final int intervalSec, final int durationMin, final String condition, final boolean speech) {
        final ScheduledTask task = new ScheduledTask();
        task.id = "monitor_" + idCounter.getAndIncrement();
        task.type = (condition != null && !condition.trim().isEmpty()) ? "condition_wait" : "screen_monitor";
        task.label = (label != null && !label.trim().isEmpty()) ? label.trim() : ("每" + intervalSec + "秒檢查畫面");
        task.conditionText = condition;
        task.intervalSeconds = Math.max(5, intervalSec);
        task.durationMinutes = durationMin > 0 ? durationMin : 10;
        task.reportSpeech = speech;
        task.createdAt = System.currentTimeMillis();
        task.targetTime = task.createdAt + (task.durationMinutes * 60 * 1000L);
        task.checkCount = 0;
        task.cancelled = false;

        task.runnable = new Runnable() {
            @Override public void run() {
                if (task.cancelled) return;
                if (System.currentTimeMillis() >= task.targetTime) {
                    activeTasks.remove(task.id);
                    try {
                        FloatingBubbleManager.getInstance(context).updateNotification("⏰ 監控已結束：" + task.label);
                    } catch (Exception ignored) {}
                    return;
                }

                task.checkCount++;
                performScreenCheck(task);

                if (!task.cancelled) {
                    mainHandler.postDelayed(task.runnable, task.intervalSeconds * 1000L);
                }
            }
        };

        activeTasks.put(task.id, task);
        mainHandler.postDelayed(task.runnable, task.intervalSeconds * 1000L);
        return task;
    }

    private void performScreenCheck(ScheduledTask task) {
        try {
            CrewAccessibilityService service = CrewAccessibilityService.getInstance();
            if (service == null) return;
            AccessibilityNodeInfo root = service.getRootInActiveWindow();
            if (root == null) return;

            try {
                if (task.conditionText != null && !task.conditionText.trim().isEmpty()) {
                    boolean found = searchConditionInTree(root, task.conditionText.trim().toLowerCase(Locale.ROOT));
                    if (found) {
                        task.cancelled = true;
                        activeTasks.remove(task.id);
                        triggerAlarm("目標條件已達成", "畫面上已出現「" + task.conditionText + "」！");
                        return;
                    }
                }
            } finally {
                root.recycle();
            }
        } catch (Exception ignored) {}
    }

    private boolean searchConditionInTree(AccessibilityNodeInfo node, String query) {
        if (node == null) return false;
        String text = node.getText() == null ? "" : node.getText().toString().toLowerCase(Locale.ROOT);
        String desc = node.getContentDescription() == null ? "" : node.getContentDescription().toString().toLowerCase(Locale.ROOT);
        if (text.contains(query) || desc.contains(query)) return true;

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                if (searchConditionInTree(child, query)) return true;
            } finally {
                child.recycle();
            }
        }
        return false;
    }

    private void triggerAlarm(String title, String message) {
        try {
            if (vibrator != null) {
                vibrator.vibrate(new long[]{0, 200, 100, 200, 100, 300}, -1);
            }
        } catch (Exception ignored) {}

        speak(title + "。" + message);

        try {
            FloatingBubbleManager.getInstance(context).updateNotification("⏰ " + title + "：" + message);
        } catch (Exception ignored) {}
    }

    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        try {
            if (tts != null && ttsReady) {
                tts.speak(text, TextToSpeech.QUEUE_ADD, null, "scheduled_alert");
            }
        } catch (Exception ignored) {}
    }

    public boolean cancelTask(String idOrHint) {
        if (idOrHint == null || idOrHint.trim().isEmpty()) return false;
        String query = idOrHint.trim().toLowerCase(Locale.ROOT);
        boolean found = false;

        Iterator<ScheduledTask> it = activeTasks.values().iterator();
        while (it.hasNext()) {
            ScheduledTask task = it.next();
            if (task.id.equalsIgnoreCase(query) || task.label.toLowerCase(Locale.ROOT).contains(query)) {
                task.cancelled = true;
                mainHandler.removeCallbacks(task.runnable);
                it.remove();
                found = true;
            }
        }
        return found;
    }

    public int cancelAllTasks() {
        int count = activeTasks.size();
        for (ScheduledTask task : activeTasks.values()) {
            task.cancelled = true;
            mainHandler.removeCallbacks(task.runnable);
        }
        activeTasks.clear();
        return count;
    }

    public JSONArray getActiveTasksJson() {
        JSONArray arr = new JSONArray();
        for (ScheduledTask task : activeTasks.values()) {
            if (!task.cancelled) {
                arr.put(task.toJson());
            }
        }
        return arr;
    }

    public String getActiveTasksSummaryText() {
        if (activeTasks.isEmpty()) return "目前沒有任何進行中的計時器或巡檢任務。";
        StringBuilder sb = new StringBuilder();
        int idx = 1;
        for (ScheduledTask task : activeTasks.values()) {
            if (task.cancelled) continue;
            long rem = Math.max(0, (task.targetTime - System.currentTimeMillis()) / 1000);
            int m = (int) (rem / 60);
            int s = (int) (rem % 60);
            String remStr = m > 0 ? (m + "分" + s + "秒") : (s + "秒");
            sb.append(idx++).append(". [").append(task.id).append("] ").append(task.label)
              .append(" (剩餘 ").append(remStr).append(")");
            if (task.conditionText != null) {
                sb.append(" [目標: ").append(task.conditionText).append("]");
            }
            sb.append("\n");
        }
        return sb.toString().trim();
    }
}
