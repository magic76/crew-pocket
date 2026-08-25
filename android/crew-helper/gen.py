fbm = r'''package com.crewpocket.helper;

import android.animation.ValueAnimator;
import android.content.Context;
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
import android.os.VibrationEffect;
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
    private static FloatingBubbleManager instance;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler;
    private final Vibrator vibrator;

    private FluidBubbleView bubbleView = null;
    private View dialogView = null;
    private View pillView = null;
    private WindowManager.LayoutParams bubbleParams = null;
    private WindowManager.LayoutParams dialogParams = null;
    private WindowManager.LayoutParams pillParams = null;
    private boolean isDialogShowing = false;
    private Runnable safetyTimeoutRunnable = null;

    private FloatingBubbleManager(Context context) {
        this.context = context.getApplicationContext();
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.vibrator = (Vibrator) this.context.getSystemService(Context.VIBRATOR_SERVICE);
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(35);
                }
            }
        } catch (Exception ignored) {}
    }

    public void vibrateSuccess() {
        try {
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    long[] timings = new long[]{0, 25, 50, 25};
                    int[] amplitudes = new int[]{0, 160, 0, 200};
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                } else {
                    vibrator.vibrate(new long[]{0, 25, 50, 25}, -1);
                }
            }
        } catch (Exception ignored) {}
    }

    // 🌟 Show Floating Ball
    public void showBubble() {
        if (!canDrawOverlays()) return;
        if (bubbleView != null) return;

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O 
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    bubbleParams = new WindowManager.LayoutParams(
                        140, 140,
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
                                    }
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

    // 🌊 Set Water Flow / Thinking State
    public void setThinkingState(final boolean thinking) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (bubbleView == null) return;

                if (safetyTimeoutRunnable != null) {
                    mainHandler.removeCallbacks(safetyTimeoutRunnable);
                    safetyTimeoutRunnable = null;
                }

                if (thinking) {
                    bubbleView.startWaterFlow();

                    // 40s Safety Auto-Reset
                    safetyTimeoutRunnable = new Runnable() {
                        @Override
                        public void run() {
                            setThinkingState(false);
                        }
                    };
                    mainHandler.postDelayed(safetyTimeoutRunnable, 40000);
                } else {
                    bubbleView.stopWaterFlow();
                }
            }
        });
    }

    // 💬 Mini Result Pill Callout (3.8s Auto-Dismiss)
    public void showResultPill(final String text) {
        if (!canDrawOverlays() || text == null || text.trim().isEmpty()) return;

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    hideResultPill();

                    int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O 
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    pillParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                    );
                    pillParams.gravity = Gravity.TOP | Gravity.START;
                    pillParams.x = bubbleParams != null ? Math.min(bubbleParams.x + 130, 800) : 160;
                    pillParams.y = bubbleParams != null ? bubbleParams.y : 400;

                    TextView tv = new TextView(context);
                    tv.setText(text);
                    tv.setTextSize(12);
                    tv.setTextColor(Color.WHITE);
                    tv.setMaxWidth(680);
                    tv.setPadding(28, 18, 28, 18);

                    GradientDrawable bg = new GradientDrawable();
                    bg.setColor(Color.parseColor("#0f172a"));
                    bg.setCornerRadius(24f);
                    bg.setStroke(3, Color.parseColor("#34d399"));
                    tv.setBackground(bg);
                    tv.setElevation(20f);

                    pillView = tv;
                    windowManager.addView(pillView, pillParams);

                    // Auto hide after 3.8s
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            hideResultPill();
                        }
                    }, 3800);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });
    }

    public void hideResultPill() {
        if (pillView != null) {
            try {
                windowManager.removeView(pillView);
            } catch (Exception ignored) {}
            pillView = null;
        }
    }

    // 🔔 Real-time Notify Dispatcher from Backend
    public void handleNotify(String state, String text) {
        if ("THINKING".equalsIgnoreCase(state)) {
            vibrateShort();
            setThinkingState(true);
        } else if ("DONE".equalsIgnoreCase(state) || "COMPLETED".equalsIgnoreCase(state)) {
            setThinkingState(false);
            vibrateSuccess();
            if (text != null && !text.isEmpty()) {
                showResultPill(text);
            }
        } else if ("IDLE".equalsIgnoreCase(state)) {
            setThinkingState(false);
        }
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
                    int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O 
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    dialogParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                        PixelFormat.TRANSLUCENT
                    );
                    dialogParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                    dialogParams.y = 120;

                    LinearLayout card = new LinearLayout(context);
                    card.setOrientation(LinearLayout.VERTICAL);
                    card.setPadding(36, 28, 36, 32);

                    GradientDrawable cardBg = new GradientDrawable();
                    cardBg.setColor(Color.parseColor("#0f172a"));
                    cardBg.setCornerRadius(32f);
                    cardBg.setStroke(3, Color.parseColor("#38bdf8"));
                    card.setBackground(cardBg);

                    LinearLayout header = new LinearLayout(context);
                    header.setOrientation(LinearLayout.HORIZONTAL);
                    header.setGravity(Gravity.CENTER_VERTICAL);

                    TextView title = new TextView(context);
                    title.setText("📱 Crew Pocket 全域傳訊指揮官");
                    title.setTextSize(16);
                    title.setTextColor(Color.parseColor("#38bdf8"));
                    LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                    header.addView(title, titleLp);

                    TextView closeBtn = new TextView(context);
                    closeBtn.setText(" ✕ ");
                    closeBtn.setTextSize(18);
                    closeBtn.setTextColor(Color.parseColor("#94a3b8"));
                    closeBtn.setPadding(16, 8, 16, 8);
                    closeBtn.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            hideDialog();
                        }
                    });
                    header.addView(closeBtn);
                    card.addView(header);

                    final EditText input = new EditText(context);
                    input.setHint("輸入你想給 Crew Pocket AI 的指令...");
                    input.setHintTextColor(Color.parseColor("#64748b"));
                    input.setTextColor(Color.WHITE);
                    input.setTextSize(14);
                    input.setMinLines(2);
                    input.setMaxLines(4);
                    input.setPadding(24, 20, 24, 20);

                    GradientDrawable inputBg = new GradientDrawable();
                    inputBg.setColor(Color.parseColor("#020617"));
                    inputBg.setCornerRadius(20f);
                    inputBg.setStroke(2, Color.parseColor("#334155"));
                    input.setBackground(inputBg);

                    LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    );
                    inputLp.setMargins(0, 20, 0, 20);
                    card.addView(input, inputLp);

                    LinearLayout actions = new LinearLayout(context);
                    actions.setOrientation(LinearLayout.HORIZONTAL);
                    actions.setGravity(Gravity.END);

                    Button btnSnap = new Button(context);
                    btnSnap.setText("📸 截圖分析");
                    btnSnap.setTextColor(Color.parseColor("#38bdf8"));
                    btnSnap.setTextSize(12);
                    GradientDrawable snapBg = new GradientDrawable();
                    snapBg.setColor(Color.parseColor("#1e293b"));
                    snapBg.setCornerRadius(16f);
                    btnSnap.setBackground(snapBg);
                    btnSnap.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            vibrateShort();
                            sendMessageToCrewPocket("請分析當前手機螢幕畫面，並告訴我畫面上有什麼？");
                            hideDialog();
                        }
                    });
                    LinearLayout.LayoutParams snapLp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    );
                    snapLp.setMargins(0, 0, 16, 0);
                    actions.addView(btnSnap, snapLp);

                    Button btnSend = new Button(context);
                    btnSend.setText("🚀 傳送並執行");
                    btnSend.setTextColor(Color.parseColor("#020617"));
                    btnSend.setTextSize(13);
                    GradientDrawable sendBg = new GradientDrawable();
                    sendBg.setColor(Color.parseColor("#38bdf8"));
                    sendBg.setCornerRadius(16f);
                    btnSend.setBackground(sendBg);
                    btnSend.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            String msg = input.getText().toString().trim();
                            if (!msg.isEmpty()) {
                                vibrateShort();
                                sendMessageToCrewPocket(msg);
                                hideDialog();
                            } else {
                                Toast.makeText(context, "請輸入指令文字", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                    actions.addView(btnSend);

                    card.addView(actions);

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
                    } catch (Exception e) {}
                }
            });
        }
    }

    public void sendMessageToCrewPocket(final String message) {
        setThinkingState(true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("http://127.0.0.1:8000/api/inbound-message");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(1500);

                    String payload = "{\"message\":\"" + escapeJson(message) + "\",\"source\":\"FloatingBubble\"}";
                    byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);

                    OutputStream os = conn.getOutputStream();
                    os.write(bytes);
                    os.flush();
                    os.close();

                    int code = conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception e) {
                    e.printStackTrace();
                }
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
            textPaint.setTextSize(52f);
            textPaint.setTextAlign(Paint.Align.CENTER);
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

            // 3. Draw Forever Bot Icon 🤖 Crisp in Center
            Paint.FontMetrics fm = textPaint.getFontMetrics();
            float textY = cy - (fm.descent + fm.ascent) / 2f;
            canvas.drawText("🤖", cx, textY, textPaint);
        }
    }
}
'''

with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/FloatingBubbleManager.java', 'w') as f:
    f.write(fbm)

print("SUCCESS: Embedded Continuous Water Flow Stream into FloatingBubbleManager!")
