package com.crewpocket.helper;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
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
import android.view.animation.DecelerateInterpolator;
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
    private static class DockIconButton extends View {
        public static final int ICON_CAMERA = 1;
        public static final int ICON_SCREEN = 2;
        public static final int ICON_MIC_ACTIVE = 3;
        public static final int ICON_MIC_MUTED = 4;
        public static final int ICON_SPEAKER = 5;
        public static final int ICON_CALL_START = 6;
        public static final int ICON_CALL_HANGUP = 7;

        private int iconType = ICON_CAMERA;
        private int primaryColor = Color.parseColor("#94A3B8");
        private final Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF bounds = new RectF();

        public DockIconButton(Context context) {
            super(context);
            iconPaint.setStyle(Paint.Style.STROKE);
            iconPaint.setStrokeCap(Paint.Cap.ROUND);
            iconPaint.setStrokeJoin(Paint.Join.ROUND);
        }

        public void setIcon(int type, int color) {
            this.iconType = type;
            this.primaryColor = color;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            float cx = w / 2f;
            float cy = h / 2f;

            iconPaint.setColor(primaryColor);
            float density = getResources().getDisplayMetrics().density;
            iconPaint.setStrokeWidth(2f * density);

            float sz = 11f * density;
            bounds.set(cx - sz, cy - sz, cx + sz, cy + sz);

            switch (iconType) {
                case ICON_CAMERA:
                    // Camera body
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF camBody = new RectF(cx - 10 * density, cy - 6 * density, cx + 5 * density, cy + 8 * density);
                    canvas.drawRoundRect(camBody, 2.5f * density, 2.5f * density, iconPaint);
                    // Lens triangle
                    android.graphics.Path camLens = new android.graphics.Path();
                    camLens.moveTo(cx + 5 * density, cy - 2 * density);
                    camLens.lineTo(cx + 11 * density, cy - 6 * density);
                    camLens.lineTo(cx + 11 * density, cy + 8 * density);
                    camLens.lineTo(cx + 5 * density, cy + 4 * density);
                    camLens.close();
                    iconPaint.setStyle(Paint.Style.FILL);
                    canvas.drawPath(camLens, iconPaint);
                    break;

                case ICON_SCREEN:
                    // Monitor screen
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF screenBox = new RectF(cx - 10 * density, cy - 7 * density, cx + 10 * density, cy + 4 * density);
                    canvas.drawRoundRect(screenBox, 2f * density, 2f * density, iconPaint);
                    // Stand base
                    canvas.drawLine(cx, cy + 4 * density, cx, cy + 8 * density, iconPaint);
                    canvas.drawLine(cx - 5 * density, cy + 8 * density, cx + 5 * density, cy + 8 * density, iconPaint);
                    break;

                case ICON_MIC_ACTIVE:
                    // Microphone capsule
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF micCap = new RectF(cx - 3.5f * density, cy - 8 * density, cx + 3.5f * density, cy + 1 * density);
                    canvas.drawRoundRect(micCap, 3.5f * density, 3.5f * density, iconPaint);
                    // Mic cradle
                    RectF micCradle = new RectF(cx - 6.5f * density, cy - 4 * density, cx + 6.5f * density, cy + 3 * density);
                    canvas.drawArc(micCradle, 0, 180, false, iconPaint);
                    // Stem & base
                    canvas.drawLine(cx, cy + 3 * density, cx, cy + 7 * density, iconPaint);
                    canvas.drawLine(cx - 4 * density, cy + 7 * density, cx + 4 * density, cy + 7 * density, iconPaint);
                    break;

                case ICON_MIC_MUTED:
                    // Muted mic with diagonal slash
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF micMutedCap = new RectF(cx - 3.5f * density, cy - 8 * density, cx + 3.5f * density, cy + 1 * density);
                    canvas.drawRoundRect(micMutedCap, 3.5f * density, 3.5f * density, iconPaint);
                    RectF micMutedCradle = new RectF(cx - 6.5f * density, cy - 4 * density, cx + 6.5f * density, cy + 3 * density);
                    canvas.drawArc(micMutedCradle, 0, 180, false, iconPaint);
                    canvas.drawLine(cx, cy + 3 * density, cx, cy + 7 * density, iconPaint);
                    // Slash
                    iconPaint.setColor(Color.parseColor("#F43F5E"));
                    canvas.drawLine(cx - 9 * density, cy + 8 * density, cx + 9 * density, cy - 8 * density, iconPaint);
                    break;

                case ICON_SPEAKER:
                    // AI speaking wave / speaker
                    iconPaint.setStyle(Paint.Style.STROKE);
                    android.graphics.Path spk = new android.graphics.Path();
                    spk.moveTo(cx - 7 * density, cy - 3 * density);
                    spk.lineTo(cx - 4 * density, cy - 3 * density);
                    spk.lineTo(cx + 1 * density, cy - 7 * density);
                    spk.lineTo(cx + 1 * density, cy + 7 * density);
                    spk.lineTo(cx - 4 * density, cy + 3 * density);
                    spk.lineTo(cx - 7 * density, cy + 3 * density);
                    spk.close();
                    iconPaint.setStyle(Paint.Style.FILL);
                    canvas.drawPath(spk, iconPaint);
                    // Sound waves
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF wave1 = new RectF(cx - 2 * density, cy - 4 * density, cx + 6 * density, cy + 4 * density);
                    canvas.drawArc(wave1, -45, 90, false, iconPaint);
                    RectF wave2 = new RectF(cx - 2 * density, cy - 8 * density, cx + 10 * density, cy + 8 * density);
                    canvas.drawArc(wave2, -45, 90, false, iconPaint);
                    break;

                case ICON_CALL_START:
                    // Start call (Phone handset / mic trigger)
                    iconPaint.setStyle(Paint.Style.STROKE);
                    RectF startCap = new RectF(cx - 3.5f * density, cy - 7 * density, cx + 3.5f * density, cy + 1 * density);
                    canvas.drawRoundRect(startCap, 3.5f * density, 3.5f * density, iconPaint);
                    RectF startCradle = new RectF(cx - 6f * density, cy - 3 * density, cx + 6f * density, cy + 3 * density);
                    canvas.drawArc(startCradle, 0, 180, false, iconPaint);
                    canvas.drawLine(cx, cy + 3 * density, cx, cy + 7 * density, iconPaint);
                    canvas.drawLine(cx - 4 * density, cy + 7 * density, cx + 4 * density, cy + 7 * density, iconPaint);
                    break;

                case ICON_CALL_HANGUP:
                    // Hangup X / Stop octagon
                    iconPaint.setStyle(Paint.Style.STROKE);
                    iconPaint.setStrokeWidth(2.5f * density);
                    canvas.drawLine(cx - 5.5f * density, cy - 5.5f * density, cx + 5.5f * density, cy + 5.5f * density, iconPaint);
                    canvas.drawLine(cx + 5.5f * density, cy - 5.5f * density, cx - 5.5f * density, cy + 5.5f * density, iconPaint);
                    break;
            }
        }
    }

    private DockIconButton voiceCallButton = null;
    private DockIconButton voiceCameraButton = null;
    private DockIconButton voiceScreenButton = null;
    private DockIconButton voiceMuteButton = null;
    private TextView voiceInterruptionButton = null;
    private TextView voiceWakeButton = null;
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

    public static synchronized FloatingBubbleManager getInstance() {
        return instance;
    }

    private static android.os.PowerManager.WakeLock appWakeLock = null;
    private static boolean isKeepAwakeActive = false;

    public static synchronized boolean isKeepAwakeActive() {
        return isKeepAwakeActive;
    }

    public static synchronized boolean toggleKeepAwake(Context ctx) {
        isKeepAwakeActive = !isKeepAwakeActive;
        try {
            if (isKeepAwakeActive) {
                if (appWakeLock == null && ctx != null) {
                    android.os.PowerManager pm = (android.os.PowerManager) ctx.getApplicationContext().getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        appWakeLock = pm.newWakeLock(
                            android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK | android.os.PowerManager.ON_AFTER_RELEASE,
                            "CrewPocket:ScreenKeepAwake"
                        );
                        appWakeLock.setReferenceCounted(false);
                    }
                }
                if (appWakeLock != null && !appWakeLock.isHeld()) {
                    appWakeLock.acquire(4 * 60 * 60 * 1000L); // Max 4h safe limit
                }
            } else {
                if (appWakeLock != null && appWakeLock.isHeld()) {
                    appWakeLock.release();
                }
            }
        } catch (Exception ignored) {}
        return isKeepAwakeActive;
    }

    public void updateWakeButtonUi(TextView btn, boolean active) {
        if (btn == null) return;
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(12));
        if (active) {
            bg.setColor(Color.parseColor("#F59E0B")); // High-contrast Solid Amber 500
            bg.setStroke(dp(1.5f), Color.parseColor("#FEF08A")); // Yellow 200
            btn.setText(I18n.get(context, "☀️ 常亮 (ON)", "☀️ Awake (ON)"));
            btn.setTextColor(Color.parseColor("#0F172A")); // Bold Slate 950
            btn.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        } else {
            bg.setColor(Color.parseColor("#1E293B")); // Slate 800
            bg.setStroke(dp(1), Color.parseColor("#475569")); // Slate 600
            btn.setText(I18n.get(context, "☀️ 常亮 (OFF)", "☀️ Awake (OFF)"));
            btn.setTextColor(Color.parseColor("#94A3B8")); // Slate 400
            btn.setTypeface(android.graphics.Typeface.DEFAULT);
        }
        btn.setBackground(bg);
    }

    public Context getContext() {
        return context;
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

    private boolean isDocked = false;
    private ValueAnimator dockAnimator = null;
    private final Handler autoDockHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoDockRunnable = new Runnable() {
        @Override
        public void run() {
            autoDockBubble();
        }
    };

    // 🌟 Show Floating Ball with Smart Auto-Dock & Ghost Opacity
    public void hideBubble() {
        autoDockHandler.removeCallbacks(autoDockRunnable);
        if (dockAnimator != null) {
            dockAnimator.cancel();
            dockAnimator = null;
        }
        if (bubbleView != null) {
            try { windowManager.removeView(bubbleView); } catch(Exception e){}
            bubbleView = null;
        }
    }

    public void scheduleAutoDock() {
        autoDockHandler.removeCallbacks(autoDockRunnable);
        if (bubbleView != null && !isDocked) {
            autoDockHandler.postDelayed(autoDockRunnable, 3000);
        }
    }

    public void wakeBubbleFromDock() {
        autoDockHandler.removeCallbacks(autoDockRunnable);
        if (bubbleView == null || bubbleParams == null) return;
        if (dockAnimator != null && dockAnimator.isRunning()) {
            dockAnimator.cancel();
        }
        int screenWidth = windowManager.getDefaultDisplay().getWidth();
        int bSize = bubbleParams.width > 0 ? bubbleParams.width : dp(40);
        int targetX = (bubbleParams.x < screenWidth / 2) ? dp(4) : (screenWidth - bSize - dp(4));

        bubbleParams.x = targetX;
        bubbleView.setAlpha(1.0f);
        try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
        isDocked = false;
    }

    public void autoDockBubble() {
        if (bubbleView == null || bubbleParams == null || isDocked) return;
        if (NativeLiveService.isActive() || nativeLiveRequested) return;

        int screenWidth = windowManager.getDefaultDisplay().getWidth();
        int bSize = bubbleParams.width > 0 ? bubbleParams.width : dp(40);

        final int startX = bubbleParams.x;
        // Slide 58% off-screen, leaving 42% (approx 17dp) as a sleek glowing edge tab
        final int endX = (startX < screenWidth / 2) ? - (bSize * 58 / 100) : (screenWidth - (bSize * 42 / 100));

        if (dockAnimator != null && dockAnimator.isRunning()) {
            dockAnimator.cancel();
        }

        dockAnimator = ValueAnimator.ofFloat(0f, 1f);
        dockAnimator.setDuration(350);
        dockAnimator.setInterpolator(new DecelerateInterpolator());
        dockAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                float frac = (float) animation.getAnimatedValue();
                if (bubbleView == null || bubbleParams == null) return;
                bubbleParams.x = (int) (startX + (endX - startX) * frac);
                bubbleView.setAlpha(1.0f - 0.65f * frac); // Smoothly fades from 1.0 to 0.35 (Ghost Mode)
                try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
            }
        });
        dockAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                isDocked = true;
            }
        });
        dockAnimator.start();
    }

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

                    int size = dp(40);
                    bubbleParams = new WindowManager.LayoutParams(
                        size, size,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                        PixelFormat.TRANSLUCENT
                    );
                    bubbleParams.gravity = Gravity.TOP | Gravity.START;
                    int screenW = windowManager.getDefaultDisplay().getWidth();
                    int screenH = windowManager.getDefaultDisplay().getHeight();
                    int safeTop = getStatusBarHeight() + dp(12);
                    bubbleParams.x = dp(4);
                    bubbleParams.y = Math.max(safeTop, screenH / 3);

                    bubbleView = new FluidBubbleView(context);
                    bubbleView.setElevation(16f);

                    bubbleView.setOnTouchListener(new View.OnTouchListener() {
                        private int initialX, initialY;
                        private float initialTouchX, initialTouchY;
                        private long touchStartTime;
                        private boolean longPressTriggered = false;
                        private final Runnable longPressRunnable = new Runnable() {
                            @Override public void run() {
                                longPressTriggered = true;
                                vibrateSuccess();
                                toggleNativeLive();
                            }
                        };

                        @Override
                        public boolean onTouch(View v, MotionEvent event) {
                            int screenWidth = windowManager.getDefaultDisplay().getWidth();
                            int screenHeight = windowManager.getDefaultDisplay().getHeight();
                            int topLimit = getStatusBarHeight() + dp(4);
                            int bottomLimit = screenHeight - dp(64);
                            int leftLimit = dp(2);
                            int rightLimit = screenWidth - size - dp(2);

                            switch (event.getAction()) {
                                case MotionEvent.ACTION_DOWN:
                                    initialX = bubbleParams.x;
                                    initialY = bubbleParams.y;
                                    initialTouchX = event.getRawX();
                                    initialTouchY = event.getRawY();
                                    touchStartTime = System.currentTimeMillis();
                                    longPressTriggered = false;
                                    mainHandler.postDelayed(longPressRunnable, 450);
                                    if (isDocked) {
                                        wakeBubbleFromDock();
                                    } else {
                                        autoDockHandler.removeCallbacks(autoDockRunnable);
                                    }
                                    return true;

                                case MotionEvent.ACTION_MOVE:
                                    float moveDist = (float) Math.hypot(event.getRawX() - initialTouchX, event.getRawY() - initialTouchY);
                                    if (moveDist > 18) {
                                        mainHandler.removeCallbacks(longPressRunnable);
                                    }
                                    int targetX = initialX + (int) (event.getRawX() - initialTouchX);
                                    int targetY = initialY + (int) (event.getRawY() - initialTouchY);
                                    bubbleParams.x = Math.max(leftLimit, Math.min(rightLimit, targetX));
                                    bubbleParams.y = Math.max(topLimit, Math.min(bottomLimit, targetY));
                                    bubbleView.setAlpha(1.0f);
                                    isDocked = false;
                                    windowManager.updateViewLayout(bubbleView, bubbleParams);
                                    return true;

                                case MotionEvent.ACTION_UP:
                                case MotionEvent.ACTION_CANCEL:
                                    mainHandler.removeCallbacks(longPressRunnable);
                                    if (!longPressTriggered) {
                                        float dx = Math.abs(event.getRawX() - initialTouchX);
                                        float dy = Math.abs(event.getRawY() - initialTouchY);
                                        long duration = System.currentTimeMillis() - touchStartTime;
                                        if (dx < 18 && dy < 18 && duration < 450) {
                                            vibrateShort();
                                            toggleVoiceControls();
                                        }
                                    }
                                    snapBubbleToEdge();
                                    scheduleAutoDock();
                                    return true;
                            }
                            return false;
                        }
                    });

                    windowManager.addView(bubbleView, bubbleParams);
                    isDocked = false;
                    scheduleAutoDock();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });
    }

    private int getStatusBarHeight() {
        try {
            int resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (resId > 0) return context.getResources().getDimensionPixelSize(resId);
        } catch (Exception ignored) {}
        return dp(32);
    }

    private void snapBubbleToEdge() {
        if (bubbleView == null || bubbleParams == null) return;
        try {
            int screenWidth = windowManager.getDefaultDisplay().getWidth();
            int screenHeight = windowManager.getDefaultDisplay().getHeight();
            int bSize = bubbleParams.width > 0 ? bubbleParams.width : dp(40);
            int topLimit = getStatusBarHeight() + dp(4);
            int bottomLimit = screenHeight - dp(64);

            // Snap X to left or right margin
            bubbleParams.x = (bubbleParams.x < screenWidth / 2) ? dp(4) : (screenWidth - bSize - dp(4));
            // Clamp Y inside safe screen area
            bubbleParams.y = Math.max(topLimit, Math.min(bottomLimit, bubbleParams.y));
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception ignored) {}
    }

    public void openCrewPocket() {
        try {
            String server = AppConfig.getServerUrl(context);
            if (server != null && !server.isEmpty()) {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(server));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } else {
                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        } catch (Exception e) {
            Toast.makeText(context, "無法開啟主介面", Toast.LENGTH_SHORT).show();
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

    private DockIconButton makeDockIconButton() {
        DockIconButton button = new DockIconButton(context);
        button.setClickable(true);
        button.setFocusable(true);
        return button;
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
                    dock.setPadding(dp(16), dp(14), dp(16), dp(20));
                    dock.setClipToPadding(false);
                    dock.setClipChildren(false);

                    GradientDrawable dockBg = new GradientDrawable();
                    dockBg.setColor(Color.parseColor("#F50F172A")); // Luxury Slate 900
                    dockBg.setCornerRadius(dp(24));
                    dockBg.setStroke(dp(1.5f), Color.parseColor("#33818CF8")); // Indigo 400 @ 20%
                    dock.setBackground(dockBg);
                    dock.setElevation(dp(16));

                    // Title / Status header
                    LinearLayout headerRow = new LinearLayout(context);
                    headerRow.setOrientation(LinearLayout.HORIZONTAL);
                    headerRow.setGravity(Gravity.CENTER_VERTICAL);
                    headerRow.setPadding(dp(4), 0, dp(4), dp(8));

                    TextView title = new TextView(context);
                    title.setText("Live 控制台");
                    title.setTextSize(13);
                    title.setTextColor(Color.parseColor("#38BDF8"));
                    headerRow.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

                    voiceInterruptionButton = new TextView(context);
                    voiceInterruptionButton.setTextSize(11);
                    voiceInterruptionButton.setPadding(dp(8), dp(3), dp(8), dp(3));
                    voiceInterruptionButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            if (!NativeLiveService.isActive()) return;
                            boolean enabled = NativeLiveService.toggleVoiceInterruption();
                            Toast.makeText(context, enabled ? "已開啟自由說話打斷" : "已開啟防插話模式（避免喇叭打斷 AI）", Toast.LENGTH_SHORT).show();
                            refreshVoiceControls();
                        }
                    });
                    LinearLayout.LayoutParams interLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                    interLp.setMargins(0, 0, dp(6), 0);
                    headerRow.addView(voiceInterruptionButton, interLp);

                    voiceWakeButton = new TextView(context);
                    voiceWakeButton.setTextSize(11);
                    voiceWakeButton.setPadding(dp(8), dp(3), dp(8), dp(3));
                    updateWakeButtonUi(voiceWakeButton, isKeepAwakeActive());
                    voiceWakeButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            vibrateSuccess();
                            boolean next = toggleKeepAwake(context);
                            updateWakeButtonUi(voiceWakeButton, next);
                            Toast.makeText(context, next ? "☀️ 螢幕常亮已開啟（防止休眠）" : "🌙 螢幕常亮已關閉", Toast.LENGTH_SHORT).show();
                        }
                    });
                    headerRow.addView(voiceWakeButton);

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
                    // Layout: [Camera Icon] [Screen Icon] [Center Large Mute/Interrupt Icon] [Hangup/Call Icon]
                    LinearLayout row = new LinearLayout(context);
                    row.setOrientation(LinearLayout.HORIZONTAL);
                    row.setClipToPadding(false);
                    row.setClipChildren(false);
                    row.setPadding(0, dp(4), 0, dp(6));

                    voiceCameraButton = makeDockIconButton();
                    voiceScreenButton = makeDockIconButton();
                    voiceMuteButton = makeDockIconButton();
                    voiceCallButton = makeDockIconButton();

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

                    LinearLayout.LayoutParams sideLp = new LinearLayout.LayoutParams(dp(54), dp(44));
                    sideLp.setMargins(dp(3), 0, dp(3), 0);

                    LinearLayout.LayoutParams centerLp = new LinearLayout.LayoutParams(0, dp(44), 1f);
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
                voiceWakeButton = null;
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
                        wakeBubbleFromDock();
                        bubbleView.setNativeVoiceState(2); // Amber = AI speaking
                    } else if (isLiveActive) {
                        wakeBubbleFromDock();
                        bubbleView.setNativeVoiceState(1); // Red = Live call active
                    } else {
                        bubbleView.setNativeVoiceState(0); // Idle
                        scheduleAutoDock();
                    }
                }

                if (voiceCameraButton != null) {
                    boolean isCamActive = NativeLiveService.isCameraSharing();
                    GradientDrawable camBg = new GradientDrawable();
                    camBg.setCornerRadius(dp(16));
                    if (isCamActive) {
                        camBg.setColor(Color.parseColor("#4F46E5")); // Indigo 600
                        camBg.setStroke(dp(1), Color.parseColor("#818CF8")); // Indigo 400
                        voiceCameraButton.setIcon(DockIconButton.ICON_CAMERA, Color.WHITE);
                    } else {
                        camBg.setColor(Color.parseColor("#E61E293B")); // Slate 800/90
                        camBg.setStroke(dp(1), Color.parseColor("#334155")); // Slate 700
                        voiceCameraButton.setIcon(DockIconButton.ICON_CAMERA, Color.parseColor("#94A3B8"));
                    }
                    voiceCameraButton.setBackground(camBg);
                }
                if (voiceScreenButton != null) {
                    boolean isScreenActive = NativeLiveService.isScreenSharing();
                    GradientDrawable screenBg = new GradientDrawable();
                    screenBg.setCornerRadius(dp(16));
                    if (isScreenActive) {
                        screenBg.setColor(Color.parseColor("#0891B2")); // Cyan 600
                        screenBg.setStroke(dp(1), Color.parseColor("#67E8F9")); // Cyan 300
                        voiceScreenButton.setIcon(DockIconButton.ICON_SCREEN, Color.WHITE);
                    } else {
                        screenBg.setColor(Color.parseColor("#E61E293B")); // Slate 800/90
                        screenBg.setStroke(dp(1), Color.parseColor("#334155")); // Slate 700
                        voiceScreenButton.setIcon(DockIconButton.ICON_SCREEN, Color.parseColor("#94A3B8"));
                    }
                    voiceScreenButton.setBackground(screenBg);
                }
                if (voiceCallButton != null) {
                    GradientDrawable callBg = new GradientDrawable();
                    callBg.setCornerRadius(dp(16));
                    if (isLiveActive) {
                        // 🛑 In Call -> Rose Red Hangup Button
                        callBg.setColor(Color.parseColor("#E11D48")); // Rose 600
                        callBg.setStroke(dp(1), Color.parseColor("#FDA4AF"));
                        voiceCallButton.setIcon(DockIconButton.ICON_CALL_HANGUP, Color.WHITE);
                    } else {
                        // 🎙️ Idle -> Slate 800 Start Call Button
                        callBg.setColor(Color.parseColor("#E61E293B")); // Slate 800
                        callBg.setStroke(dp(1), Color.parseColor("#4F46E5")); // Indigo border
                        voiceCallButton.setIcon(DockIconButton.ICON_CALL_START, Color.parseColor("#A5B4FC"));
                    }
                    voiceCallButton.setBackground(callBg);
                }
                if (voiceMuteButton != null) {
                    boolean isMuted = NativeLiveService.isAgentMuted();
                    GradientDrawable muteBg = new GradientDrawable();
                    muteBg.setCornerRadius(dp(16));

                    if (!isLiveActive) {
                        // 📴 State 0: Call Inactive / Idle -> Slate 800 Standby (Mute button disabled/idle)
                        muteBg.setColor(Color.parseColor("#E61E293B")); // Slate 800
                        muteBg.setStroke(dp(1), Color.parseColor("#334155")); // Slate 700
                        voiceMuteButton.setIcon(DockIconButton.ICON_MIC_ACTIVE, Color.parseColor("#64748B")); // Dim Slate
                    } else if (isAiSpeaking) {
                        // 🔊 State 1: AI is speaking -> Amber 600 Hero (Tap to interrupt)
                        muteBg.setColor(Color.parseColor("#D97706")); // Amber 600
                        muteBg.setStroke(dp(2), Color.parseColor("#FDE68A")); // Amber 300
                        voiceMuteButton.setIcon(DockIconButton.ICON_SPEAKER, Color.WHITE);
                    } else if (isMuted) {
                        // 🔇 State 2: Muted -> Rose 900 (Tap to unmute)
                        muteBg.setColor(Color.parseColor("#881337")); // Rose 900
                        muteBg.setStroke(dp(2), Color.parseColor("#F43F5E")); // Rose 500
                        voiceMuteButton.setIcon(DockIconButton.ICON_MIC_MUTED, Color.parseColor("#FECDD3"));
                    } else {
                        // 🎙️ State 3: Listening / Active -> Teal 600 (Tap to mute)
                        muteBg.setColor(Color.parseColor("#0D9488")); // Teal 600
                        muteBg.setStroke(dp(2), Color.parseColor("#2DD4BF")); // Teal 400
                        voiceMuteButton.setIcon(DockIconButton.ICON_MIC_ACTIVE, Color.WHITE);
                    }
                    voiceMuteButton.setBackground(muteBg);
                }

                if (voiceInterruptionButton != null) {
                    boolean allowInterruption = NativeLiveService.isVoiceInterruptionAllowed();
                    GradientDrawable pillBg = new GradientDrawable();
                    pillBg.setCornerRadius(dp(12));
                    if (allowInterruption) {
                        pillBg.setColor(Color.parseColor("#064E3B")); // Emerald 900
                        pillBg.setStroke(dp(1), Color.parseColor("#10B981")); // Emerald 500
                        voiceInterruptionButton.setText("🎙️ 允許插話");
                        voiceInterruptionButton.setTextColor(Color.parseColor("#6EE7B7")); // Emerald 300
                    } else {
                        pillBg.setColor(Color.parseColor("#78350F")); // Amber 900
                        pillBg.setStroke(dp(1), Color.parseColor("#F59E0B")); // Amber 500
                        voiceInterruptionButton.setText("🛡️ 防插話");
                        voiceInterruptionButton.setTextColor(Color.parseColor("#FCD34D")); // Amber 300
                    }
                    voiceInterruptionButton.setBackground(pillBg);
                }

                if (voiceWakeButton != null) {
                    updateWakeButtonUi(voiceWakeButton, isKeepAwakeActive());
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
                    card.setPadding(dp(16), dp(12), dp(16), dp(16));

                    GradientDrawable cardBg = new GradientDrawable();
                    cardBg.setColor(Color.parseColor("#F50F172A")); // Luxury Slate 900
                    cardBg.setCornerRadius(dp(20));
                    cardBg.setStroke(dp(1.5f), Color.parseColor("#33818CF8")); // Indigo 400 @ 20%
                    card.setBackground(cardBg);
                    card.setElevation(dp(20));

                    // Header Row
                    LinearLayout header = new LinearLayout(context);
                    header.setOrientation(LinearLayout.HORIZONTAL);
                    header.setGravity(Gravity.CENTER_VERTICAL);
                    header.setPadding(dp(2), dp(2), dp(2), dp(6));

                    TextView title = new TextView(context);
                    title.setText("🤖 Crew Pocket");
                    title.setTextSize(14);
                    title.setTextColor(Color.WHITE);
                    title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    header.addView(title);

                    TextView badge = new TextView(context);
                    badge.setText("隨身指令");
                    badge.setTextSize(9);
                    badge.setTextColor(Color.parseColor("#5EEAD4")); // Teal 300
                    badge.setTypeface(android.graphics.Typeface.MONOSPACE);
                    GradientDrawable badgeBg = new GradientDrawable();
                    badgeBg.setColor(Color.parseColor("#2614B8A6"));
                    badgeBg.setCornerRadius(dp(6));
                    badgeBg.setStroke(dp(1), Color.parseColor("#4D14B8A6"));
                    badge.setBackground(badgeBg);
                    badge.setPadding(dp(6), dp(2), dp(6), dp(2));
                    LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                    badgeLp.setMargins(dp(8), 0, 0, 0);
                    header.addView(badge, badgeLp);

                    View spacer = new View(context);
                    header.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

                    final TextView wakePill = new TextView(context);
                    wakePill.setTextSize(10);
                    wakePill.setPadding(dp(8), dp(3), dp(8), dp(3));
                    updateWakeButtonUi(wakePill, isKeepAwakeActive());
                    wakePill.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            vibrateSuccess();
                            boolean next = toggleKeepAwake(context);
                            updateWakeButtonUi(wakePill, next);
                            Toast.makeText(context, next ? "☀️ 螢幕常亮已開啟（防止休眠）" : "🌙 螢幕常亮已關閉", Toast.LENGTH_SHORT).show();
                        }
                    });
                    LinearLayout.LayoutParams wakeLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                    wakeLp.setMargins(0, 0, dp(8), 0);
                    header.addView(wakePill, wakeLp);

                    TextView closeBtn = new TextView(context);
                    closeBtn.setText("✕");
                    closeBtn.setTextSize(14);
                    closeBtn.setTextColor(Color.parseColor("#94A3B8"));
                    closeBtn.setGravity(Gravity.CENTER);
                    GradientDrawable closeBg = new GradientDrawable();
                    closeBg.setColor(Color.parseColor("#1E293B"));
                    closeBg.setCornerRadius(dp(12));
                    closeBtn.setBackground(closeBg);
                    closeBtn.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            hideDialog();
                        }
                    });
                    LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(dp(26), dp(26));
                    header.addView(closeBtn, closeLp);

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
                    dialogStatusText.setTextSize(10);
                    dialogStatusText.setTextColor(Color.parseColor("#94A3B8"));
                    dialogStatusText.setTypeface(android.graphics.Typeface.MONOSPACE);
                    dialogStatusText.setPadding(dp(4), dp(2), dp(4), 0);
                    card.addView(dialogStatusText);

                    final EditText input = new EditText(context);
                    input.setHint("輸入你想給 Crew Pocket AI 的指令...");
                    input.setHintTextColor(Color.parseColor("#64748B"));
                    input.setTextColor(Color.WHITE);
                    input.setTextSize(13);
                    input.setMinLines(2);
                    input.setMaxLines(3);
                    input.setGravity(Gravity.TOP | Gravity.START);
                    input.setPadding(dp(12), dp(10), dp(12), dp(10));

                    GradientDrawable inputBg = new GradientDrawable();
                    inputBg.setColor(Color.parseColor("#020617")); // Slate 950
                    inputBg.setCornerRadius(dp(14));
                    inputBg.setStroke(dp(1), Color.parseColor("#334155")); // Slate 700
                    input.setBackground(inputBg);

                    LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    );
                    inputLp.setMargins(0, dp(8), 0, dp(10));
                    card.addView(input, inputLp);

                    LinearLayout actions = new LinearLayout(context);
                    actions.setOrientation(LinearLayout.HORIZONTAL);
                    actions.setGravity(Gravity.CENTER_VERTICAL);

                    Button btnSnap = new Button(context);
                    btnSnap.setText("📸 截圖");
                    btnSnap.setTextColor(Color.parseColor("#38BDF8"));
                    btnSnap.setTextSize(11);
                    btnSnap.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    btnSnap.setAllCaps(false);
                    btnSnap.setMinHeight(dp(38));
                    btnSnap.setPadding(dp(6), 0, dp(6), 0);
                    GradientDrawable snapBg = new GradientDrawable();
                    snapBg.setColor(Color.parseColor("#1E293B"));
                    snapBg.setCornerRadius(dp(10));
                    snapBg.setStroke(dp(1), Color.parseColor("#334155"));
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
                        0, dp(38), 1f
                    );
                    snapLp.setMargins(0, 0, dp(6), 0);
                    actions.addView(btnSnap, snapLp);

                    Button btnSend = new Button(context);
                    btnSend.setText("💬 傳送執行");
                    btnSend.setTextColor(Color.WHITE);
                    btnSend.setTextSize(12);
                    btnSend.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    btnSend.setAllCaps(false);
                    btnSend.setMinHeight(dp(38));
                    btnSend.setPadding(dp(6), 0, dp(6), 0);
                    GradientDrawable sendBg = new GradientDrawable(
                        GradientDrawable.Orientation.LEFT_RIGHT,
                        new int[]{ Color.parseColor("#14B8A6"), Color.parseColor("#4F46E5") }
                    );
                    sendBg.setCornerRadius(dp(10));
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
                    LinearLayout.LayoutParams sendLp = new LinearLayout.LayoutParams(0, dp(38), 1.4f);
                    sendLp.setMargins(0, 0, dp(6), 0);
                    actions.addView(btnSend, sendLp);

                    final Button btnAwake = new Button(context);
                    final boolean isAwake = CrewAccessibilityService.isKeepAwakeActive();
                    btnAwake.setText(isAwake ? "☀️ 常亮中" : "☀️ 常亮");
                    btnAwake.setTextColor(isAwake ? Color.parseColor("#FDE047") : Color.parseColor("#94A3B8"));
                    btnAwake.setTextSize(11);
                    btnAwake.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    btnAwake.setAllCaps(false);
                    btnAwake.setMinHeight(dp(38));
                    btnAwake.setPadding(dp(4), 0, dp(4), 0);
                    final GradientDrawable awakeBg = new GradientDrawable();
                    awakeBg.setColor(isAwake ? Color.parseColor("#422006") : Color.parseColor("#1E293B"));
                    awakeBg.setCornerRadius(dp(10));
                    awakeBg.setStroke(dp(1), isAwake ? Color.parseColor("#EAB308") : Color.parseColor("#334155"));
                    btnAwake.setBackground(awakeBg);
                    btnAwake.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            vibrateShort();
                            boolean next = CrewAccessibilityService.toggleKeepAwake();
                            btnAwake.setText(next ? "☀️ 常亮中" : "☀️ 常亮");
                            btnAwake.setTextColor(next ? Color.parseColor("#FDE047") : Color.parseColor("#94A3B8"));
                            awakeBg.setColor(next ? Color.parseColor("#422006") : Color.parseColor("#1E293B"));
                            awakeBg.setStroke(dp(1), next ? Color.parseColor("#EAB308") : Color.parseColor("#334155"));
                            Toast.makeText(context, next ? "☀️ 螢幕常亮已開啟（防止休眠）" : "🌙 螢幕常亮已關閉", Toast.LENGTH_SHORT).show();
                        }
                    });
                    LinearLayout.LayoutParams awakeLp = new LinearLayout.LayoutParams(0, dp(38), 1.0f);
                    awakeLp.setMargins(0, 0, dp(6), 0);
                    actions.addView(btnAwake, awakeLp);

                    Button btnOpen = new Button(context);
                    btnOpen.setText("🌐 開啟");
                    btnOpen.setTextColor(Color.parseColor("#A5B4FC"));
                    btnOpen.setTextSize(11);
                    btnOpen.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    btnOpen.setAllCaps(false);
                    btnOpen.setMinHeight(dp(38));
                    btnOpen.setPadding(dp(6), 0, dp(6), 0);
                    GradientDrawable openBg = new GradientDrawable();
                    openBg.setColor(Color.parseColor("#1E293B"));
                    openBg.setCornerRadius(dp(10));
                    openBg.setStroke(dp(1), Color.parseColor("#334155"));
                    btnOpen.setBackground(openBg);
                    btnOpen.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            vibrateShort();
                            hideDialog();
                            openCrewPocket();
                        }
                    });
                    LinearLayout.LayoutParams openLp = new LinearLayout.LayoutParams(
                        0, dp(38), 0.9f
                    );
                    actions.addView(btnOpen, openLp);

                    card.addView(actions);

                    dialogStopButton = new Button(context);
                    dialogStopButton.setText("🛑 停止生成");
                    dialogStopButton.setTextColor(Color.parseColor("#FECACA"));
                    dialogStopButton.setTextSize(11);
                    dialogStopButton.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                    dialogStopButton.setAllCaps(false);
                    dialogStopButton.setMinHeight(dp(36));
                    dialogStopButton.setPadding(dp(4), 0, dp(4), 0);
                    GradientDrawable stopBg = new GradientDrawable();
                    stopBg.setColor(Color.parseColor("#450A0A"));
                    stopBg.setCornerRadius(dp(10));
                    stopBg.setStroke(dp(1), Color.parseColor("#991B1B"));
                    dialogStopButton.setBackground(stopBg);
                    dialogStopButton.setVisibility(("THINKING".equals(currentState) || "TOOL".equals(currentState)) ? View.VISIBLE : View.GONE);
                    dialogStopButton.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            stopCrewPocketGeneration();
                            hideDialog();
                        }
                    });
                    LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, dp(36)
                    );
                    stopLp.setMargins(0, dp(8), 0, 0);

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
                String server = AppConfig.getServerUrl(context);
                if (server == null || server.isEmpty()) {
                    server = AppConfig.DEFAULT_SERVER;
                }
                String endpoint = server.replaceAll("/+$", "") + "/api/inbound/messages";

                try {
                    for (int attempt = 1; attempt <= 3 && !success; attempt++) {
                        HttpURLConnection conn = null;
                        try {
                            URL url = new URL(endpoint);
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

    // 🌊 Custom Fluid Bubble View (Exact Web UI Gradient Replica)
    public static class FluidBubbleView extends View {
        private Paint bgPaint;
        private Paint ringPaint;
        private Paint glowPaint;
        private RectF ringBounds = new RectF();
        private SweepGradient idleSweepGradient;
        private SweepGradient activeSweepGradient;
        private SweepGradient speakingSweepGradient;
        private SweepGradient rainbowSweepGradient;
        private Matrix matrix = new Matrix();
        private float rotationAngle = 0f;
        private boolean isFlowing = false;
        private boolean isSuccessFlash = false;
        // 0 idle, 1 live call active, 2 AI speaking
        private int nativeVoiceState = 0;
        private ValueAnimator continuousRotator;

        public FluidBubbleView(Context context) {
            super(context);
            init();
        }

        private void init() {
            bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            bgPaint.setStyle(Paint.Style.FILL);

            ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ringPaint.setStyle(Paint.Style.STROKE);
            ringPaint.setStrokeWidth(6.5f);
            ringPaint.setStrokeCap(Paint.Cap.ROUND);

            glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            glowPaint.setStyle(Paint.Style.STROKE);
            glowPaint.setStrokeWidth(12f);

            startContinuousRotation();
        }

        private void startContinuousRotation() {
            if (continuousRotator == null) {
                continuousRotator = ValueAnimator.ofFloat(0f, 360f);
                continuousRotator.setDuration(4000); // 4s full rotation (identical to Web CSS)
                continuousRotator.setRepeatCount(ValueAnimator.INFINITE);
                continuousRotator.setInterpolator(new LinearInterpolator());
                continuousRotator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                    @Override
                    public void onAnimationUpdate(ValueAnimator animation) {
                        rotationAngle = (float) animation.getAnimatedValue();
                        invalidate();
                    }
                });
            }
            if (!continuousRotator.isRunning()) {
                continuousRotator.start();
            }
        }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            startContinuousRotation();
        }

        @Override
        protected void onDetachedFromWindow() {
            super.onDetachedFromWindow();
            if (continuousRotator != null) {
                continuousRotator.cancel();
            }
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            float stroke = ringPaint.getStrokeWidth();
            ringBounds.set(stroke / 2f + 2f, stroke / 2f + 2f, w - stroke / 2f - 2f, h - stroke / 2f - 2f);

            float cx = w / 2f;
            float cy = h / 2f;

            // 1. Idle Gradient: Teal -> Cyan -> Indigo -> Purple -> Teal (Web #live-voice-btn match)
            int[] idleColors = new int[]{
                Color.parseColor("#14B8A6"), // Teal 500
                Color.parseColor("#06B6D4"), // Cyan 500
                Color.parseColor("#6366F1"), // Indigo 500
                Color.parseColor("#A855F7"), // Purple 500
                Color.parseColor("#14B8A6")  // Teal 500
            };
            float[] idlePositions = new float[]{0.0f, 0.25f, 0.60f, 0.85f, 1.0f};
            idleSweepGradient = new SweepGradient(cx, cy, idleColors, idlePositions);

            // 2. Active Call Gradient: Rose -> Red -> Orange -> Rose
            int[] activeColors = new int[]{
                Color.parseColor("#F43F5E"), // Rose 500
                Color.parseColor("#EF4444"), // Red 500
                Color.parseColor("#FB923C"), // Orange 400
                Color.parseColor("#F43F5E")  // Rose 500
            };
            activeSweepGradient = new SweepGradient(cx, cy, activeColors, null);

            // 3. Speaking Gradient: Amber -> Gold -> Yellow -> Amber
            int[] speakColors = new int[]{
                Color.parseColor("#F59E0B"), // Amber 500
                Color.parseColor("#FBBF24"), // Amber 400
                Color.parseColor("#FDE047"), // Yellow 300
                Color.parseColor("#F59E0B")  // Amber 500
            };
            speakingSweepGradient = new SweepGradient(cx, cy, speakColors, null);

            // 4. Fast Rainbow Thinking Stream
            int[] rainbowColors = new int[]{
                Color.parseColor("#38BDF8"),
                Color.parseColor("#818CF8"),
                Color.parseColor("#C084FC"),
                Color.parseColor("#F43F5E"),
                Color.parseColor("#38BDF8")
            };
            rainbowSweepGradient = new SweepGradient(cx, cy, rainbowColors, null);
        }

        public void startWaterFlow() {
            isFlowing = true;
            isSuccessFlash = false;
            if (continuousRotator != null) {
                continuousRotator.setDuration(1200); // Speed up rotation during tool execution
            }
            invalidate();
        }

        public void stopWaterFlow() {
            isFlowing = false;
            if (continuousRotator != null) {
                continuousRotator.setDuration(4000); // Return to gentle 4s rotation
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
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float radius = (Math.min(getWidth(), getHeight()) / 2f) - 2.5f;

            // ── 1. Deep Glassmorphism Radial Gradient Background (Slate 900 -> Slate 950) ──
            int[] coreColors = new int[]{
                Color.parseColor("#1E293B"), // Slate 800 (Highlight center)
                Color.parseColor("#0F172A"), // Slate 900
                Color.parseColor("#020617")  // Slate 950 (Deep edge)
            };
            float[] corePositions = new float[]{0.0f, 0.65f, 1.0f};
            android.graphics.RadialGradient coreGrad = new android.graphics.RadialGradient(
                cx, cy * 0.9f, radius, coreColors, corePositions, android.graphics.Shader.TileMode.CLAMP
            );
            bgPaint.setShader(coreGrad);
            canvas.drawCircle(cx, cy, radius, bgPaint);

            // ── 2. Rotating Conic/Sweep Gradient Border (Identical to Web) ──
            matrix.setRotate(rotationAngle, cx, cy);
            SweepGradient currentGradient;
            if (nativeVoiceState == 2) {
                currentGradient = speakingSweepGradient;
            } else if (nativeVoiceState == 1) {
                currentGradient = activeSweepGradient;
            } else if (isFlowing) {
                currentGradient = rainbowSweepGradient;
            } else {
                currentGradient = idleSweepGradient;
            }

            if (currentGradient != null) {
                currentGradient.setLocalMatrix(matrix);
                ringPaint.setShader(currentGradient);
                ringPaint.setStrokeWidth(4.2f);
                canvas.drawOval(ringBounds, ringPaint);
            }

            // ── 3. Perfectly Centered Crisp Microphone (Web Style) ──
            Paint mic = new Paint(Paint.ANTI_ALIAS_FLAG);
            if (nativeVoiceState == 2) {
                mic.setColor(Color.parseColor("#FEF3C7")); // Warm Gold/Amber White
            } else if (nativeVoiceState == 1) {
                mic.setColor(Color.parseColor("#FFFFFF")); // Pure White in Call
            } else {
                mic.setColor(Color.parseColor("#FFFFFF")); // Pure Crisp White in Idle
            }

            // Geometry mathematically centered around (cx, cy)
            float halfH = radius * 0.52f;
            float capW = radius * 0.36f;
            float capH = radius * 0.56f;
            float capTop = cy - halfH;
            float capBottom = capTop + capH;

            // 3a. Solid Capsule Body
            mic.setStyle(Paint.Style.FILL);
            canvas.drawRoundRect(cx - capW / 2f, capTop, cx + capW / 2f, capBottom, capW / 2f, capW / 2f, mic);

            // 3b. U-Shape Cradle Arc
            mic.setStyle(Paint.Style.STROKE);
            mic.setStrokeWidth(3.4f);
            mic.setStrokeCap(Paint.Cap.ROUND);
            float cradleRadius = radius * 0.34f;
            float cradleTop = capTop + capH * 0.38f;
            float cradleBottom = capBottom + radius * 0.16f;
            RectF cradleRect = new RectF(cx - cradleRadius, cradleTop, cx + cradleRadius, cradleBottom);
            canvas.drawArc(cradleRect, 0, 180, false, mic);

            // 3c. Vertical Stem
            float stemBottom = cy + halfH;
            canvas.drawLine(cx, cradleBottom, cx, stemBottom, mic);

            // 3d. Horizontal Base Foot
            float footSpan = radius * 0.22f;
            canvas.drawLine(cx - footSpan, stemBottom, cx + footSpan, stemBottom, mic);
        }
    }
}
