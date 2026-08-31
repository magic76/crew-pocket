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
    private View voiceControlView = null;
    private boolean voiceControlsOpening = false;
    private WindowManager.LayoutParams voiceControlParams = null;
    private Button voiceCallButton = null;
    private Button voiceCameraButton = null;
    private Button voiceScreenButton = null;
    private Button voiceMuteButton = null;
    private View dialogView = null;
    private WindowManager.LayoutParams bubbleParams = null;
    private WindowManager.LayoutParams dialogParams = null;
    private boolean isDialogShowing = false;
    private String currentState = "IDLE";
    private boolean nativeLiveRequested = false;
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
                                    if (dx < 15 && dy < 15 && duration < 700) {
                                        vibrateShort();
                                        toggleVoiceControls();
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

    /** The old overlay command panel is retired; notification entry opens Crew Pocket. */
    public void openInputUi() {
        openCrewPocket();
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
                    String fullStatus = status == null ? "待命" : status;
                    String compactStatus = compactNotificationStatus(fullStatus);

                    Intent inputIntent = new Intent(context, CrewNotificationReceiver.class)
                        .setAction(CrewNotificationReceiver.ACTION_INPUT);
                    int mutableFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                    // FLAG_MUTABLE (API 31) kept as a literal for the Android 24 compile SDK.
                    if (Build.VERSION.SDK_INT >= 31) mutableFlags |= 0x02000000;
                    PendingIntent inputPending = PendingIntent.getBroadcast(context, 2, inputIntent, mutableFlags);
                    android.app.RemoteInput remoteInput = new android.app.RemoteInput.Builder(
                        CrewNotificationReceiver.EXTRA_INPUT).setLabel("輸入給最近對話的訊息").build();

                    Notification.Builder builder = new Notification.Builder(context);
                    if (Build.VERSION.SDK_INT >= 26) {
                        try {
                            Notification.Builder.class.getMethod("setChannelId", String.class)
                                .invoke(builder, NOTIFICATION_CHANNEL_ID);
                        } catch (Exception ignored) {}
                    }
                    builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                        .setContentTitle("Crew Pocket Helper")
                        .setContentText(compactStatus)
                        .setStyle(new Notification.BigTextStyle().bigText(fullStatus))
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setShowWhen(false)
                        .setCategory(Notification.CATEGORY_SERVICE)
                        .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_send, "輸入訊息", inputPending)
                            .addRemoteInput(remoteInput).build());
                    notifications.notify(NOTIFICATION_ID, builder.build());
                } catch (Exception ignored) {}
            }
        });
    }

    private String compactNotificationStatus(String status) {
        String oneLine = status.replaceAll("\\s+", " ").trim();
        return oneLine.length() > 48 ? oneLine.substring(0, 45) + "..." : oneLine;
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
                            updateNotification("待命");
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
        boolean wasBusy = "THINKING".equals(currentState) || "TOOL".equals(currentState);
        currentState = state == null ? "IDLE" : state.toUpperCase();
        if ("THINKING".equalsIgnoreCase(state)) {
            // Server heartbeats refresh the 40s safety timer. They are not new
            // tasks, so do not vibrate repeatedly while already busy.
            if (!wasBusy) vibrateShort();
            setThinkingState(true);
            String thinkingStatus = text == null || text.isEmpty() ? "AI 回覆中" : "AI 回覆中 · " + text;
            updateDialogStatus(thinkingStatus);
            updateNotification(thinkingStatus);
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
            String doneStatus = text == null || text.isEmpty() ? "已完成" : "已完成 · " + text;
            updateDialogStatus(doneStatus);
            updateNotification(doneStatus);
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

    private void toggleNativeLive() {
        try {
            if (nativeLiveRequested || NativeLiveService.isActive()) {
                nativeLiveRequested = false;
                NativeLiveService.stop(context);
                updateNativeLiveStatus("正在結束語音通話", false);
            } else {
                nativeLiveRequested = true;
                NativeLiveService.start(context);
                // Give immediate visual feedback; the service will replace it
                // with its real connection status moments later.
                updateNativeLiveStatus("正在連線 Gemini Live", true);
            }
        } catch (Exception error) {
            updateNotification("🎙️ 無法啟動原生語音");
        }
    }

    /** Called by the foreground voice service; intentionally does not open a panel. */
    public void updateNativeLiveStatus(final String text, final boolean active) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                nativeLiveRequested = active;
                if (bubbleView != null) {
                    bubbleView.setNativeVoiceState(active ? 1 : 0);
                }
                refreshVoiceControls();
                updateNotification("🎙️ " + (text == null || text.isEmpty() ? (active ? "語音通話中" : "待命") : text));
            }
        });
    }

    private void toggleVoiceControls() {
        if (voiceControlView != null || voiceControlsOpening) hideVoiceControls(); else showVoiceControls();
    }

    private Button makeVoiceButton(String text) {
        Button button = new Button(context);
        button.setText(text);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setIncludeFontPadding(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setMinimumHeight(0);
        button.setMinimumWidth(0);
        if (Build.VERSION.SDK_INT >= 21) {
            button.setStateListAnimator(null);
        }
        setVoiceButtonActive(button, false);
        button.setTextColor(Color.parseColor("#e2e8f0"));
        return button;
    }

    private void setVoiceButtonActive(Button button, boolean active) {
        if (button == null) return;
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#172033"));
        bg.setCornerRadius(dp(12));
        if (active) {
            // 🟢 Green glowing border (2dp #22C55E) when sharing/active
            bg.setStroke(dp(2), Color.parseColor("#22C55E"));
        } else {
            bg.setStroke(1, Color.parseColor("#334155"));
        }
        button.setBackground(bg);
    }

    private void showVoiceControls() {
        if (!canDrawOverlays() || voiceControlView != null || voiceControlsOpening) return;
        voiceControlsOpening = true;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (!voiceControlsOpening) return;
                try {
                    if (dialogView != null) hideDialog();
                    int overlayType = Build.VERSION.SDK_INT >= 26 ? 2038 : WindowManager.LayoutParams.TYPE_PHONE;
                    int screenWidth = windowManager.getDefaultDisplay().getWidth();

                    // 📱 Ergonomic Bottom Dock (matching Web UI style)
                    int dockWidth = Math.min(dp(360), screenWidth - dp(24));
                    voiceControlParams = new WindowManager.LayoutParams(
                            dockWidth,
                            WindowManager.LayoutParams.WRAP_CONTENT,
                            overlayType,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                            PixelFormat.TRANSLUCENT
                    );
                    voiceControlParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
                    voiceControlParams.y = dp(42); // Elevated above navigation bar / gesture bar

                    LinearLayout dock = new LinearLayout(context);
                    dock.setOrientation(LinearLayout.VERTICAL);
                    dock.setPadding(dp(14), dp(12), dp(14), dp(18)); // Generous bottom padding

                    GradientDrawable dockBg = new GradientDrawable();
                    dockBg.setColor(Color.parseColor("#E60F172A")); // Semi-transparent Slate 900
                    dockBg.setCornerRadius(dp(22));
                    dockBg.setStroke(2, Color.parseColor("#334155"));
                    dock.setBackground(dockBg);

                    // Title / Status header
                    LinearLayout headerRow = new LinearLayout(context);
                    headerRow.setOrientation(LinearLayout.HORIZONTAL);
                    headerRow.setGravity(Gravity.CENTER_VERTICAL);
                    headerRow.setPadding(dp(4), 0, dp(4), dp(8));

                    TextView title = new TextView(context);
                    title.setText("🎙️ Crew Pocket Live 控制台");
                    title.setTextSize(13);
                    title.setTextColor(Color.parseColor("#38BDF8"));
                    headerRow.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

                    TextView close = new TextView(context);
                    close.setText("✕");
                    close.setTextSize(18);
                    close.setTextColor(Color.parseColor("#94A3B8"));
                    close.setPadding(dp(12), 0, dp(4), 0);
                    close.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) { hideVoiceControls(); }
                    });
                    headerRow.addView(close);
                    dock.addView(headerRow);

                    // 📱 Ergonomic Bottom Dock matching Web UI:
                    // Layout: [📷 相機] [🖥️ 螢幕] [🎙️ 核心靜音/打斷大按鈕] [🛑 掛斷]
                    LinearLayout row = new LinearLayout(context);
                    row.setOrientation(LinearLayout.HORIZONTAL);

                    voiceCameraButton = makeVoiceButton("📷");
                    voiceScreenButton = makeVoiceButton("🖥️");
                    voiceMuteButton = makeVoiceButton("🎙️ 語音");
                    voiceCallButton = makeVoiceButton("🛑");

                    voiceCameraButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            if (!NativeLiveService.isActive()) {
                                Toast.makeText(context, "請先開始通話並等待連線", Toast.LENGTH_SHORT).show();
                                return;
                            }
                            NativeLiveService.toggleCameraSharing();
                            refreshVoiceControls();
                        }
                    });

                    voiceScreenButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            if (!NativeLiveService.isActive()) {
                                Toast.makeText(context, "請先開始通話並等待連線", Toast.LENGTH_SHORT).show();
                                return;
                            }
                            NativeLiveService.toggleScreenSharing();
                            refreshVoiceControls();
                        }
                    });

                    voiceMuteButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            if (!NativeLiveService.isActive()) return;
                            NativeLiveService.toggleAgentMute();
                            refreshVoiceControls();
                        }
                    });

                    voiceCallButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            toggleNativeLive();
                            refreshVoiceControls();
                        }
                    });

                    LinearLayout.LayoutParams sideLp = new LinearLayout.LayoutParams(dp(54), dp(48));
                    sideLp.setMargins(dp(3), 0, dp(3), 0);

                    LinearLayout.LayoutParams centerLp = new LinearLayout.LayoutParams(0, dp(48), 1f);
                    centerLp.setMargins(dp(4), 0, dp(4), 0);

                    // 1. Camera (Left)
                    row.addView(voiceCameraButton, sideLp);
                    // 2. Screen (Left-Center)
                    row.addView(voiceScreenButton, sideLp);
                    // 3. Main Center Mute/Interrupt (Large Hero Pill)
                    row.addView(voiceMuteButton, centerLp);
                    // 4. Hangup (Right)
                    row.addView(voiceCallButton, sideLp);

                    dock.addView(row);
                    voiceControlView = dock;
                    windowManager.addView(dock, voiceControlParams);
                    refreshVoiceControls();
                } catch (Exception error) {
                    voiceControlView = null;
                } finally {
                    voiceControlsOpening = false;
                }
            }
        });
    }

    private void hideVoiceControls() {
        voiceControlsOpening = false;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                try {
                    if (voiceControlView != null) windowManager.removeViewImmediate(voiceControlView);
                } catch (Exception ignored) {}
                voiceControlView = null;
                voiceCallButton = null;
                voiceCameraButton = null;
                voiceScreenButton = null;
                voiceMuteButton = null;
            }
        });
    }

    public void refreshVoiceControls() {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                boolean isLiveActive = nativeLiveRequested || NativeLiveService.isActive();
                boolean isAiSpeaking = NativeLiveService.isAiSpeaking();
                
                if (bubbleView != null) {
                    if (isAiSpeaking) {
                        bubbleView.setNativeVoiceState(2); // Amber = AI speaking
                    } else if (isLiveActive) {
                        bubbleView.setNativeVoiceState(1); // Red = Live call active
                    } else {
                        bubbleView.setNativeVoiceState(0); // Green = Idle
                    }
                }

                if (voiceCameraButton != null) {
                    boolean isCamActive = NativeLiveService.isCameraSharing();
                    setVoiceButtonActive(voiceCameraButton, isCamActive);
                }
                if (voiceScreenButton != null) {
                    boolean isScreenActive = NativeLiveService.isScreenSharing();
                    setVoiceButtonActive(voiceScreenButton, isScreenActive);
                }
                if (voiceCallButton != null) {
                    GradientDrawable callBg = new GradientDrawable();
                    callBg.setCornerRadius(dp(14));
                    if (isLiveActive) {
                        // 🛑 In Call -> Rose Red Hangup Button
                        callBg.setColor(Color.parseColor("#E11D48")); // Rose 600
                        callBg.setStroke(dp(1), Color.parseColor("#FDA4AF"));
                        voiceCallButton.setText("🛑");
                    } else {
                        // 🎙️ Idle -> Indigo Start Call Button
                        callBg.setColor(Color.parseColor("#4F46E5")); // Indigo 600
                        callBg.setStroke(dp(1), Color.parseColor("#818CF8"));
                        voiceCallButton.setText("🎙️");
                    }
                    voiceCallButton.setBackground(callBg);
                }
                if (voiceMuteButton != null) {
                    boolean isMuted = NativeLiveService.isAgentMuted();
                    GradientDrawable muteBg = new GradientDrawable();
                    muteBg.setCornerRadius(dp(16));

                    if (isAiSpeaking) {
                        // 🔊 State 1: AI is speaking -> Amber 600 (Tap to interrupt)
                        muteBg.setColor(Color.parseColor("#D97706")); // Amber 600
                        muteBg.setStroke(dp(2), Color.parseColor("#FDE68A")); // Amber border
                        voiceMuteButton.setText("🔊 AI 說話中 · 點擊打斷");
                        voiceMuteButton.setTextColor(Color.WHITE);
                    } else if (isMuted) {
                        // 🔇 State 2: Muted -> Deep Rose 900 (Tap to unmute)
                        muteBg.setColor(Color.parseColor("#881337")); // Rose 900
                        muteBg.setStroke(dp(2), Color.parseColor("#F43F5E")); // Rose 500
                        voiceMuteButton.setText("🔇 靜音中 · 點擊開啟");
                        voiceMuteButton.setTextColor(Color.parseColor("#FECDD3"));
                    } else {
                        // 🎙️ State 3: Listening / Active -> Teal 600 (Tap to mute)
                        muteBg.setColor(Color.parseColor("#0D9488")); // Teal 600
                        muteBg.setStroke(dp(2), Color.parseColor("#2DD4BF")); // Teal 400
                        voiceMuteButton.setText("🎙️ 收音中 · 點擊靜音");
                        voiceMuteButton.setTextColor(Color.WHITE);
                    }
                    voiceMuteButton.setBackground(muteBg);
                }
            }
        });
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
                            URL url = new URL("http://127.0.0.1:8000/api/inbound/messages");
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

    public void sendNotificationMessage(final String message) {
        setThinkingState(true);
        updateNotification("正在傳送訊息");
        new Thread(new Runnable() {
            @Override public void run() {
                boolean success = false;
                HttpURLConnection conn = null;
                try {
                    URL url = new URL("http://127.0.0.1:8000/api/inbound/messages");
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(4000);
                    String payload = "{\"message\":\"" + escapeJson(message) + "\",\"source\":\"CrewHelper\"}";
                    byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(bytes);
                    os.close();
                    int code = conn.getResponseCode();
                    success = code >= 200 && code < 300;
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }
                if (!success) {
                    mainHandler.post(new Runnable() {
                        @Override public void run() {
                            setThinkingState(false);
                            updateNotification("Crew Pocket 尚未連線");
                        }
                    });
                }
            }
        }).start();
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
        // 0 idle (green microphone), 1 native voice service active (red microphone).
        private int nativeVoiceState = 0;
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

        public void setNativeVoiceState(int state) {
            nativeVoiceState = state;
            if (state != 0 && flowAnimator != null) flowAnimator.cancel();
            invalidate();
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
            if (nativeVoiceState == 2) {
                // Amber = AI is speaking
                ringPaint.setShader(null);
                ringPaint.setStrokeWidth(7f);
                ringPaint.setColor(Color.parseColor("#f59e0b")); // amber
                canvas.drawOval(ringBounds, ringPaint);
            } else if (nativeVoiceState == 1) {
                // Red = Live call active / listening
                ringPaint.setShader(null);
                ringPaint.setStrokeWidth(7f);
                ringPaint.setColor(Color.parseColor("#ef4444")); // red
                canvas.drawOval(ringBounds, ringPaint);
            } else if (isFlowing && waterFlowGradient != null) {
                matrix.setRotate(rotationAngle, cx, cy);
                waterFlowGradient.setLocalMatrix(matrix);
                ringPaint.setShader(waterFlowGradient);
                ringPaint.setStrokeWidth(9f);
                canvas.drawOval(ringBounds, ringPaint);
            } else {
                ringPaint.setShader(null);
                ringPaint.setStrokeWidth(6f);
                ringPaint.setColor(Color.parseColor("#34d399")); // green = idle
                canvas.drawOval(ringBounds, ringPaint);
            }

            // 3. The Bubble is always a microphone: same circular Crew Pocket
            // language, with green idle, amber speaking, and red active states.
            Paint mic = new Paint(Paint.ANTI_ALIAS_FLAG);
            if (nativeVoiceState == 2) {
                mic.setColor(Color.parseColor("#fef3c7")); // amber light
            } else if (nativeVoiceState == 1) {
                mic.setColor(Color.parseColor("#fecaca")); // red light
            } else {
                mic.setColor(Color.parseColor("#d1fae5")); // green light
            }
            mic.setStyle(Paint.Style.FILL);
            float bodyW = radius * .34f, bodyH = radius * .58f;
            canvas.drawRoundRect(cx - bodyW / 2f, cy - bodyH * .58f, cx + bodyW / 2f, cy + bodyH * .42f, bodyW / 2f, bodyW / 2f, mic);
            mic.setStyle(Paint.Style.STROKE); mic.setStrokeWidth(5f); mic.setStrokeCap(Paint.Cap.ROUND);
            canvas.drawArc(cx - radius * .38f, cy - bodyH * .15f, cx + radius * .38f, cy + radius * .48f, 0, 180, false, mic);
            canvas.drawLine(cx, cy + radius * .43f, cx, cy + radius * .64f, mic);
            canvas.drawLine(cx - radius * .22f, cy + radius * .64f, cx + radius * .22f, cy + radius * .64f, mic);
        }
    }
}
