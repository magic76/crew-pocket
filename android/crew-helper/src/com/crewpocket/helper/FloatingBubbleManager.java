package com.crewpocket.helper;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.SweepGradient;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class FloatingBubbleManager {
    public interface SendCallback {
        void onResult(boolean success, String detail);
    }
    public interface CaptureCallback {
        void onResult(boolean success, String detail);
    }
    private static FloatingBubbleManager instance;
    static final String NOTIFICATION_CHANNEL_ID = "crew_pocket_helper";
    static final int NOTIFICATION_ID = 8766;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler;
    private final Vibrator vibrator;

    private FluidBubbleView bubbleView = null;
    private View dialogView = null;
    private WindowManager.LayoutParams bubbleParams = null;
    private WindowManager.LayoutParams dialogParams = null;
    private boolean isDialogShowing = false;
    private String currentState = "IDLE";
    private TextView dialogStatusText = null;
    private Button dialogStopButton = null;
    private String pendingImagePath = null;
    private Runnable safetyTimeoutRunnable = null;

    private FloatingBubbleManager(Context context) {
        this.context = context.getApplicationContext();
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.vibrator = (Vibrator) this.context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private int dp(float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    public static synchronized FloatingBubbleManager getInstance(Context context) {
        if (instance == null) {
            instance = new FloatingBubbleManager(context);
        }
        return instance;
    }

    public boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(context);
        }
        return true;
    }

    // 📳 Haptic Vibrations
    public void vibrateShort() {
        try {
            if (vibrator != null && vibrator.hasVibrator()) {
                
                    vibrator.vibrate(35);
                
            }
        } catch (Exception ignored) {}
    }

    public void vibrateSuccess() {
        try {
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) {
                    long[] timings = new long[]{0, 25, 50, 25};
                    int[] amplitudes = new int[]{0, 160, 0, 200};
                    vibrator.vibrate(timings, -1);
                } else {
                    vibrator.vibrate(new long[]{0, 25, 50, 25}, -1);
                }
            }
        } catch (Exception ignored) {}
    }

    // 🌟 Show Floating Ball
    public void hideBubble() { if (bubbleView != null) { try { windowManager.removeView(bubbleView); } catch(Exception e){} bubbleView = null; } }
    public void showBubble() {
        if (!canDrawOverlays()) return;
        if (bubbleView != null) return;

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    int overlayType = Build.VERSION.SDK_INT >= 26 
                        ? 2038 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    bubbleParams = new WindowManager.LayoutParams(
                        112, 112,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                    );
                    bubbleParams.gravity = Gravity.TOP | Gravity.START;
                    bubbleParams.x = 20;
                    bubbleParams.y = 400;

                    bubbleView = new FluidBubbleView(context);
                    bubbleView.setElevation(16f);

                    bubbleView.setOnTouchListener(new View.OnTouchListener() {
                        private int initialX, initialY;
                        private float initialTouchX, initialTouchY;
                        private long touchStartTime;

                        @Override
                        public boolean onTouch(View v, MotionEvent event) {
                            switch (event.getAction()) {
                                case MotionEvent.ACTION_DOWN:
                                    initialX = bubbleParams.x;
                                    initialY = bubbleParams.y;
                                    initialTouchX = event.getRawX();
                                    initialTouchY = event.getRawY();
                                    touchStartTime = System.currentTimeMillis();
                                    return true;

                                case MotionEvent.ACTION_MOVE:
                                    bubbleParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                                    bubbleParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                                    windowManager.updateViewLayout(bubbleView, bubbleParams);
                                    return true;

                                case MotionEvent.ACTION_UP:
                                    float dx = Math.abs(event.getRawX() - initialTouchX);
                                    float dy = Math.abs(event.getRawY() - initialTouchY);
                                    long duration = System.currentTimeMillis() - touchStartTime;
                                    if (dx < 15 && dy < 15 && duration < 350) {
                                        vibrateShort();
                                        toggleDialog();
                                    } else if (dx < 15 && dy < 15 && duration >= 350) {
                                        vibrateShort();
                                        toggleDialog();
                                    }
                                    snapBubbleToEdge();
                                    return true;
                            }
                            return false;
                        }
                    });

                    windowManager.addView(bubbleView, bubbleParams);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });
    }

    private void snapBubbleToEdge() {
        if (bubbleView == null || bubbleParams == null) return;
        try {
            int screenWidth = windowManager.getDefaultDisplay().getWidth();
            bubbleParams.x = bubbleParams.x < screenWidth / 2 ? 0 : Math.max(0, screenWidth - 112);
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception ignored) {}
    }

    public void openCrewPocket() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:8000"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(context, "無法開啟 Crew Pocket", Toast.LENGTH_SHORT).show();
        }
    }

    /** Opens the compact command UI from the notification; falls back to the web app if overlays are disabled. */
    public void openInputUi() {
        if (canDrawOverlays()) {
            mainHandler.post(new Runnable() {
                @Override public void run() { showDialog(); }
            });
        } else {
            openCrewPocket();
        }
    }

    public void showNotification() {
        updateNotification(friendlyState(currentState));
    }

    public void updateNotification(final String status) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                try {
                    NotificationManager notifications = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (Build.VERSION.SDK_INT >= 26) {
                        try {
                            Class<?> channelClass = Class.forName("android.app.NotificationChannel");
                            Object channel = channelClass.getConstructor(String.class, CharSequence.class, int.class)
                                .newInstance(NOTIFICATION_CHANNEL_ID, "Crew Pocket 控制", NotificationManager.IMPORTANCE_LOW);
                            channelClass.getMethod("setDescription", String.class)
                                .invoke(channel, "Crew Helper 的通知欄控制");
                            channelClass.getMethod("setShowBadge", boolean.class).invoke(channel, false);
                            NotificationManager.class.getMethod("createNotificationChannel", channelClass)
                                .invoke(notifications, channel);
                        } catch (Exception ignored) {}
                    }

                    Intent inputIntent = new Intent(context, CrewNotificationReceiver.class)
                        .setAction(CrewNotificationReceiver.ACTION_INPUT);
                    int mutableFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                    // FLAG_MUTABLE (API 31) kept as a literal for the Android 24 compile SDK.
                    if (Build.VERSION.SDK_INT >= 31) mutableFlags |= 0x02000000;
                    PendingIntent inputPending = PendingIntent.getBroadcast(context, 2, inputIntent, mutableFlags);
                    android.app.RemoteInput remoteInput = new android.app.RemoteInput.Builder(
                        CrewNotificationReceiver.EXTRA_INPUT).setLabel("輸入要交給 Crew Pocket 的指令").build();

                    Intent stopIntent = new Intent(context, CrewNotificationReceiver.class)
                        .setAction(CrewNotificationReceiver.ACTION_STOP);
                    PendingIntent stopPending = PendingIntent.getBroadcast(
                        context, 3, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                    Intent screenshotIntent = new Intent(context, CrewNotificationReceiver.class)
                        .setAction(CrewNotificationReceiver.ACTION_SCREENSHOT);
                    PendingIntent screenshotPending = PendingIntent.getBroadcast(
                        context, 4, screenshotIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                    Notification.Builder builder = new Notification.Builder(context);
                    if (Build.VERSION.SDK_INT >= 26) {
                        try {
                            Notification.Builder.class.getMethod("setChannelId", String.class)
                                .invoke(builder, NOTIFICATION_CHANNEL_ID);
                        } catch (Exception ignored) {}
                    }
                    builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                        .setContentTitle("Crew Pocket Helper")
                        .setContentText(status == null ? "待命" : status)
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setShowWhen(false)
                        .setCategory(Notification.CATEGORY_SERVICE)
                        .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_camera, "截圖", screenshotPending).build())
                        .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_send, "輸入指令", inputPending)
                            .addRemoteInput(remoteInput).build())
                        .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "停止", stopPending).build());
                    notifications.notify(NOTIFICATION_ID, builder.build());
                } catch (Exception ignored) {}
            }
        });
    }

    public void cancelNotification() {
        try {
            NotificationManager notifications = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            notifications.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {}
    }

    // 🌊 Set Water Flow / Thinking State
    public void setThinkingState(final boolean thinking) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (safetyTimeoutRunnable != null) {
                    mainHandler.removeCallbacks(safetyTimeoutRunnable);
                    safetyTimeoutRunnable = null;
                }

                if (thinking) {
                    if (bubbleView != null) bubbleView.startWaterFlow();

                    // 40s Safety Auto-Reset
                    safetyTimeoutRunnable = new Runnable() {
                        @Override
                        public void run() {
                            currentState = "IDLE";
                            setThinkingState(false);
                            updateDialogStatus("待命");
                        }
                    };
                    mainHandler.postDelayed(safetyTimeoutRunnable, 40000);
                } else {
                    if (bubbleView != null) bubbleView.stopWaterFlow();
                }
            }
        });
    }

    // 🔔 Real-time Notify Dispatcher from Backend
    public void handleNotify(String state, String text) {
        currentState = state == null ? "IDLE" : state.toUpperCase();
        if ("THINKING".equalsIgnoreCase(state)) {
            vibrateShort();
            setThinkingState(true);
            updateDialogStatus("AI 回覆中");
            updateNotification("AI 回覆中");
        } else if ("TOOL".equalsIgnoreCase(state)) {
            setThinkingState(true);
            String toolStatus = text == null || text.isEmpty() ? "正在執行工具" : text;
            updateDialogStatus(toolStatus);
            updateNotification(toolStatus);
        } else if ("ERROR".equalsIgnoreCase(state)) {
            setThinkingState(false);
            updateDialogStatus("執行失敗");
            updateNotification("執行失敗");
        } else if ("DONE".equalsIgnoreCase(state) || "COMPLETED".equalsIgnoreCase(state)) {
            setThinkingState(false);
            vibrateSuccess();
            updateDialogStatus("已完成");
            updateNotification("已完成");
        } else if ("IDLE".equalsIgnoreCase(state)) {
            setThinkingState(false);
            updateDialogStatus("待命");
            updateNotification("待命");
        }
    }

    private void updateDialogStatus(final String status) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (dialogStatusText != null) dialogStatusText.setText(status);
                if (dialogStopButton != null) dialogStopButton.setVisibility(
                    ("THINKING".equals(currentState) || "TOOL".equals(currentState)) ? View.VISIBLE : View.GONE);
            }
        });
    }

    private String friendlyState(String state) {
        if ("THINKING".equals(state)) return "AI 回覆中";
        if ("TOOL".equals(state)) return "正在執行工具";
        if ("DONE".equals(state) || "COMPLETED".equals(state)) return "已完成";
        if ("ERROR".equals(state)) return "執行失敗";
        return "待命";
    }

    public void toggleDialog() {
        if (isDialogShowing) {
            hideDialog();
        } else {
            showDialog();
        }
    }

    public void showDialog() {
        if (!canDrawOverlays()) return;
        if (dialogView != null) return;

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    int overlayType = Build.VERSION.SDK_INT >= 26 
                        ? 2038 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    int screenWidth = windowManager.getDefaultDisplay().getWidth();
                    dialogParams = new WindowManager.LayoutParams(
                        Math.max(dp(280), screenWidth - dp(30)),
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                        PixelFormat.TRANSLUCENT
                    );
                    dialogParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                    dialogParams.y = dp(72);

                    LinearLayout card = new LinearLayout(context);
                    card.setOrientation(LinearLayout.VERTICAL);
                    card.setPadding(dp(16), dp(7), dp(16), dp(16));

                    GradientDrawable cardBg = new GradientDrawable();
                    cardBg.setColor(Color.parseColor("#0f172a"));
                    cardBg.setCornerRadius(dp(12));
                    cardBg.setStroke(2, Color.parseColor("#38bdf8"));
                    card.setBackground(cardBg);

                    LinearLayout header = new LinearLayout(context);
                    header.setOrientation(LinearLayout.HORIZONTAL);
                    header.setGravity(Gravity.CENTER_VERTICAL);

                    TextView title = new TextView(context);
                    title.setText("📱 Crew Pocket");
                    title.setTextSize(15);
                    title.setTextColor(Color.parseColor("#38bdf8"));
                    LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                    header.addView(title, titleLp);

                    TextView closeBtn = new TextView(context);
                    closeBtn.setText("×");
                    closeBtn.setTextSize(26);
                    closeBtn.setTextColor(Color.parseColor("#94a3b8"));
                    closeBtn.setPadding(16, 8, 16, 8);
                    closeBtn.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            hideDialog();
                        }
                    });
                    header.addView(closeBtn);
                    header.setPadding(dp(4), dp(2), dp(2), dp(4));
                    header.setOnTouchListener(new View.OnTouchListener() {
                        private int startX, startY;
                        private float touchX, touchY;
                        @Override public boolean onTouch(View v, MotionEvent event) {
                            switch (event.getAction()) {
                                case MotionEvent.ACTION_DOWN:
                                    startX = dialogParams.x;
                                    startY = dialogParams.y;
                                    touchX = event.getRawX();
                                    touchY = event.getRawY();
                                    return true;
                                case MotionEvent.ACTION_MOVE:
                                    dialogParams.x = startX + (int) (event.getRawX() - touchX);
                                    dialogParams.y = startY + (int) (event.getRawY() - touchY);
                                    try { windowManager.updateViewLayout(dialogView, dialogParams); } catch (Exception ignored) {}
                                    return true;
                                default:
                                    return true;
                            }
                        }
                    });
                    card.addView(header);

                    dialogStatusText = new TextView(context);
                    dialogStatusText.setText(friendlyState(currentState));
                    dialogStatusText.setTextSize(11);
                    dialogStatusText.setTextColor(Color.parseColor("#94a3b8"));
                    dialogStatusText.setPadding(dp(2), dp(6), dp(2), 0);
                    card.addView(dialogStatusText);

                    final EditText input = new EditText(context);
                    input.setHint("輸入你想給 Crew Pocket AI 的指令...");
                    input.setHintTextColor(Color.parseColor("#64748b"));
                    input.setTextColor(Color.WHITE);
                    input.setTextSize(14);
                    input.setMinLines(2);
                    input.setMaxLines(2);
                    input.setLines(2);
                    input.setGravity(Gravity.TOP | Gravity.START);
                    input.setPadding(dp(14), dp(10), dp(14), dp(10));

                    GradientDrawable inputBg = new GradientDrawable();
                    inputBg.setColor(Color.parseColor("#020617"));
                    inputBg.setCornerRadius(16f);
                    inputBg.setStroke(1, Color.parseColor("#334155"));
                    input.setBackground(inputBg);

                    LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    );
                    inputLp.setMargins(0, dp(10), 0, dp(10));
                    card.addView(input, inputLp);

                    LinearLayout actions = new LinearLayout(context);
                    actions.setOrientation(LinearLayout.HORIZONTAL);
                    actions.setGravity(Gravity.END);

                    Button btnSnap = new Button(context);
                    btnSnap.setText("📸 截圖");
                    btnSnap.setTextColor(Color.parseColor("#38bdf8"));
                    btnSnap.setTextSize(12);
                    btnSnap.setAllCaps(false);
                    btnSnap.setMinHeight(dp(40));
                    btnSnap.setPadding(dp(4), 0, dp(4), 0);
                    GradientDrawable snapBg = new GradientDrawable();
                    snapBg.setColor(Color.parseColor("#1e293b"));
                    snapBg.setCornerRadius(dp(8));
                    btnSnap.setBackground(snapBg);
                    btnSnap.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            vibrateShort();
                            btnSnap.setEnabled(false);
                            updateDialogStatus("正在擷取螢幕…");
                            captureScreenshotForPrompt(new CaptureCallback() {
                                @Override public void onResult(boolean success, String detail) {
                                    btnSnap.setEnabled(true);
                                    if (success) {
                                        pendingImagePath = "/uploads/phone_screen_opt.webp";
                                        input.setHint("已截圖，輸入你想問的問題…");
                                        updateDialogStatus("截圖已準備，請輸入問題");
                                    } else {
                                        updateDialogStatus("截圖失敗，請重試");
                                    }
                                }
                            });
                        }
                    });
                    LinearLayout.LayoutParams snapLp = new LinearLayout.LayoutParams(
                        0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
                    );
                    snapLp.setMargins(0, 0, dp(8), 0);
                    Button btnSend = new Button(context);
                    btnSend.setText("傳送並執行");
                    btnSend.setTextColor(Color.parseColor("#020617"));
                    btnSend.setTextSize(13);
                    btnSend.setAllCaps(false);
                    btnSend.setMinHeight(dp(40));
                    btnSend.setPadding(dp(4), 0, dp(4), 0);
                    GradientDrawable sendBg = new GradientDrawable();
                    sendBg.setColor(Color.parseColor("#38bdf8"));
                    sendBg.setCornerRadius(dp(8));
                    btnSend.setBackground(sendBg);
                    btnSend.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            String msg = input.getText().toString().trim();
                            if (!msg.isEmpty()) {
                                vibrateShort();
                                btnSend.setEnabled(false);
                                updateDialogStatus("正在連線…");
                                final String imagePath = pendingImagePath;
                                sendMessageToCrewPocket(msg, imagePath, new SendCallback() {
                                    @Override public void onResult(boolean success, String detail) {
                                        btnSend.setEnabled(true);
                                        if (success) {
                                            pendingImagePath = null;
                                            hideDialog();
                                        }
                                        else updateDialogStatus("傳送失敗，請重試");
                                    }
                                });
                            } else {
                                Toast.makeText(context, "請輸入指令文字", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                    LinearLayout.LayoutParams sendLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                    Button btnOpen = new Button(context);
                    btnOpen.setText("🌐 開啟");
                    btnOpen.setTextColor(Color.parseColor("#a5b4fc"));
                    btnOpen.setTextSize(12);
                    btnOpen.setAllCaps(false);
                    btnOpen.setMinHeight(dp(40));
                    btnOpen.setPadding(dp(4), 0, dp(4), 0);
                    GradientDrawable openBg = new GradientDrawable();
                    openBg.setColor(Color.parseColor("#1e1b4b"));
                    openBg.setCornerRadius(dp(8));
                    btnOpen.setBackground(openBg);
                    btnOpen.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            vibrateShort();
                            hideDialog();
                            openCrewPocket();
                        }
                    });
                    LinearLayout.LayoutParams openLp = new LinearLayout.LayoutParams(
                        0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
                    );
                    openLp.setMargins(0, 0, dp(8), 0);
                    actions.addView(btnOpen, openLp);
                    actions.addView(btnSnap, snapLp);
                    actions.addView(btnSend, sendLp);
                    dialogStopButton = new Button(context);
                    dialogStopButton.setText("停止生成");
                    dialogStopButton.setTextColor(Color.parseColor("#fecaca"));
                    dialogStopButton.setTextSize(12);
                    dialogStopButton.setAllCaps(false);
                    dialogStopButton.setMinHeight(dp(40));
                    dialogStopButton.setPadding(dp(4), 0, dp(4), 0);
                    GradientDrawable stopBg = new GradientDrawable();
                    stopBg.setColor(Color.parseColor("#451a1a"));
                    stopBg.setCornerRadius(dp(8));
                    dialogStopButton.setBackground(stopBg);
                    dialogStopButton.setVisibility(("THINKING".equals(currentState) || "TOOL".equals(currentState)) ? View.VISIBLE : View.GONE);
                    dialogStopButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            stopCrewPocketGeneration();
                            hideDialog();
                        }
                    });
                    LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    );
                    stopLp.setMargins(0, dp(8), 0, 0);

                    card.addView(actions);
                    card.addView(dialogStopButton, stopLp);

                    dialogView = card;
                    windowManager.addView(dialogView, dialogParams);
                    isDialogShowing = true;
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });
    }

    public void hideDialog() {
        if (dialogView != null && isDialogShowing) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (dialogView != null) {
                            windowManager.removeView(dialogView);
                            dialogView = null;
                        }
                        isDialogShowing = false;
                        dialogStatusText = null;
                        dialogStopButton = null;
                    } catch (Exception e) {}
                }
            });
        }
    }

    public void sendMessageToCrewPocket(final String message) {
        sendMessageToCrewPocket(message, null, null);
    }

    public void sendMessageToCrewPocket(final String message, final SendCallback callback) {
        sendMessageToCrewPocket(message, null, callback);
    }

    public void sendMessageToCrewPocket(final String message, final String imagePath, final SendCallback callback) {
        setThinkingState(true);
        updateNotification("AI 回覆中");
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean success = false;
                String detail = "無法連線";
                try {
                    for (int attempt = 1; attempt <= 3 && !success; attempt++) {
                        HttpURLConnection conn = null;
                        try {
                            URL url = new URL("http://127.0.0.1:8000/api/inbound-message");
                            conn = (HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                            conn.setDoOutput(true);
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);

                            String payload = "{\"message\":\"" + escapeJson(message) + "\",\"source\":\"FloatingBubble\"";
                            if (imagePath != null && !imagePath.isEmpty()) {
                                payload += ",\"image_path\":\"" + escapeJson(imagePath) + "\"";
                            }
                            payload += "}";
                            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                            conn.setFixedLengthStreamingMode(bytes.length);
                            OutputStream os = conn.getOutputStream();
                            os.write(bytes);
                            os.flush();
                            os.close();

                            int code = conn.getResponseCode();
                            success = code >= 200 && code < 300;
                            detail = "HTTP " + code;
                        } catch (Exception attemptError) {
                            detail = attemptError.getMessage() == null ? "連線逾時" : attemptError.getMessage();
                            if (attempt < 3) {
                                try { Thread.sleep(250L * attempt); } catch (InterruptedException ignored) {}
                            }
                        } finally {
                            if (conn != null) conn.disconnect();
                        }
                    }
                } catch (Exception e) {
                    detail = e.getMessage() == null ? "連線失敗" : e.getMessage();
                }
                final boolean result = success;
                final String resultDetail = detail;
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        if (!result) {
                            setThinkingState(false);
                            updateDialogStatus("Crew Pocket 尚未連線");
                            updateNotification("Crew Pocket 尚未連線");
                        }
                        if (callback != null) callback.onResult(result, resultDetail);
                    }
                });
            }
        }).start();
    }

    public void sendNotificationMessage(String message) {
        final String imagePath = pendingImagePath;
        pendingImagePath = null;
        sendMessageToCrewPocket(message, imagePath, null);
    }

    public void captureScreenshotForNotification() {
        updateNotification("正在擷取螢幕…");
        captureScreenshotForPrompt(new CaptureCallback() {
            @Override public void onResult(boolean success, String detail) {
                if (success) {
                    pendingImagePath = "/uploads/phone_screen_opt.webp";
                    updateNotification("截圖完成，請輸入指令");
                } else {
                    updateNotification("截圖失敗，請重試");
                }
            }
        });
    }

    public void captureScreenshotForPrompt(final CaptureCallback callback) {
        new Thread(new Runnable() {
            @Override public void run() {
                boolean success = false;
                String detail = "截圖失敗";
                HttpURLConnection conn = null;
                try {
                    URL url = new URL("http://127.0.0.1:8000/api/phone/screenshot");
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(8000);
                    int code = conn.getResponseCode();
                    success = code >= 200 && code < 300;
                    detail = "HTTP " + code;
                    if (success && conn.getInputStream() != null) conn.getInputStream().close();
                } catch (Exception e) {
                    detail = e.getMessage() == null ? "截圖連線失敗" : e.getMessage();
                } finally {
                    if (conn != null) conn.disconnect();
                }
                final boolean result = success;
                final String resultDetail = detail;
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        if (callback != null) callback.onResult(result, resultDetail);
                    }
                });
            }
        }).start();
    }

    public void stopCrewPocketGeneration() {
        setThinkingState(false);
        currentState = "IDLE";
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    URL url = new URL("http://127.0.0.1:8000/api/stop");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setDoOutput(true);
                    byte[] bytes = "{}".getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(bytes); os.flush(); os.close();
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }

    // 🌊 Custom Fluid Bubble View (Continuous Rotating Water Flow Stream)
    public static class FluidBubbleView extends View {
        private Paint bgPaint;
        private Paint ringPaint;
        private Paint textPaint;
        private RectF ringBounds = new RectF();
        private SweepGradient waterFlowGradient;
        private Matrix matrix = new Matrix();
        private float rotationAngle = 0f;
        private boolean isFlowing = false;
        private boolean isSuccessFlash = false;
        private ValueAnimator flowAnimator;

        public FluidBubbleView(Context context) {
            super(context);
            init();
        }

        private void init() {
            bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            bgPaint.setColor(Color.parseColor("#0f172a"));
            bgPaint.setStyle(Paint.Style.FILL);

            ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ringPaint.setStyle(Paint.Style.STROKE);
            ringPaint.setStrokeWidth(8f);
            ringPaint.setStrokeCap(Paint.Cap.ROUND);
            ringPaint.setColor(Color.parseColor("#38bdf8"));

            textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setTextSize(30f);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setColor(Color.parseColor("#e0f2fe"));
            textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            float stroke = ringPaint.getStrokeWidth();
            ringBounds.set(stroke / 2f + 4f, stroke / 2f + 4f, w - stroke / 2f - 4f, h - stroke / 2f - 4f);

            // Water stream colors: Cyan -> Electric Violet -> Magenta -> Transparent
            int[] colors = new int[]{
                Color.parseColor("#38bdf8"),
                Color.parseColor("#818cf8"),
                Color.parseColor("#c084fc"),
                Color.parseColor("#f43f5e"),
                Color.parseColor("#0038bdf8"),
                Color.parseColor("#38bdf8")
            };
            float[] positions = new float[]{0.0f, 0.25f, 0.5f, 0.75f, 0.9f, 1.0f};
            waterFlowGradient = new SweepGradient(w / 2f, h / 2f, colors, positions);
        }

        public void startWaterFlow() {
            isFlowing = true;
            isSuccessFlash = false;
            if (flowAnimator == null) {
                flowAnimator = ValueAnimator.ofFloat(0f, 360f);
                flowAnimator.setDuration(1200);
                flowAnimator.setRepeatCount(ValueAnimator.INFINITE);
                flowAnimator.setInterpolator(new LinearInterpolator());
                flowAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                    @Override
                    public void onAnimationUpdate(ValueAnimator animation) {
                        rotationAngle = (float) animation.getAnimatedValue();
                        invalidate();
                    }
                });
            }
            if (!flowAnimator.isRunning()) {
                flowAnimator.start();
            }
            invalidate();
        }

        public void stopWaterFlow() {
            isFlowing = false;
            if (flowAnimator != null) {
                flowAnimator.cancel();
            }
            isSuccessFlash = true;
            invalidate();

            postDelayed(new Runnable() {
                @Override
                public void run() {
                    isSuccessFlash = false;
                    invalidate();
                }
            }, 850);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float radius = (Math.min(getWidth(), getHeight()) / 2f) - 6f;

            // 1. Draw Core Dark Sphere
            canvas.drawCircle(cx, cy, radius, bgPaint);

            // 2. Draw Stream Ring
            if (isFlowing && waterFlowGradient != null) {
                matrix.setRotate(rotationAngle, cx, cy);
                waterFlowGradient.setLocalMatrix(matrix);
                ringPaint.setShader(waterFlowGradient);
                ringPaint.setStrokeWidth(9f);
                canvas.drawOval(ringBounds, ringPaint);
            } else {
                ringPaint.setShader(null);
                ringPaint.setStrokeWidth(6f);
                if (isSuccessFlash) {
                    ringPaint.setColor(Color.parseColor("#34d399")); // Emerald Green on Finish
                } else {
                    ringPaint.setColor(Color.parseColor("#38bdf8")); // Quantum Cyan on Idle
                }
                canvas.drawOval(ringBounds, ringPaint);
            }

            // 3. Draw compact Crew Pocket mark
            Paint.FontMetrics fm = textPaint.getFontMetrics();
            float textY = cy - (fm.descent + fm.ascent) / 2f;
            canvas.drawText("CP", cx, textY, textPaint);
        }
    }
}
