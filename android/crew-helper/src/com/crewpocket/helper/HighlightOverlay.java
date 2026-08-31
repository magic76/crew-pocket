package com.crewpocket.helper;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * Visual Spotlight / Bounding Box Overlay.
 * Allows AI to highlight a specific area or UI element on screen to guide the user visually.
 * Automatically fades in with a pulse glow and fades out cleanly.
 */
public class HighlightOverlay {
    private static HighlightOverlay instance;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private HighlightView highlightView = null;
    private WindowManager.LayoutParams windowParams = null;
    private Runnable autoDismissRunnable = null;

    public static synchronized HighlightOverlay getInstance(Context context) {
        if (instance == null) {
            instance = new HighlightOverlay(context.getApplicationContext());
        }
        return instance;
    }

    private HighlightOverlay(Context context) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    public synchronized void highlight(final float left, final float top, final float right, final float bottom, final String label, final int durationMs) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (highlightView == null) {
                        int overlayType = Build.VERSION.SDK_INT >= 26 
                            ? 2038 
                            : WindowManager.LayoutParams.TYPE_PHONE;

                        windowParams = new WindowManager.LayoutParams(
                            WindowManager.LayoutParams.MATCH_PARENT,
                            WindowManager.LayoutParams.MATCH_PARENT,
                            overlayType,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE 
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE 
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN 
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                            PixelFormat.TRANSLUCENT
                        );
                        windowParams.gravity = Gravity.TOP | Gravity.START;

                        highlightView = new HighlightView(context);
                        windowManager.addView(highlightView, windowParams);
                    }

                    if (autoDismissRunnable != null) {
                        mainHandler.removeCallbacks(autoDismissRunnable);
                    }

                    highlightView.setTarget(left, top, right, bottom, label);
                    highlightView.startAnimation();

                    autoDismissRunnable = new Runnable() {
                        @Override
                        public void run() {
                            dismiss();
                        }
                    };
                    mainHandler.postDelayed(autoDismissRunnable, Math.max(1500, durationMs));
                } catch (Exception ignored) {}
            }
        });
    }

    public synchronized void dismiss() {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (highlightView != null) {
                    highlightView.fadeOut(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                if (highlightView != null) {
                                    windowManager.removeView(highlightView);
                                    highlightView = null;
                                }
                            } catch (Exception ignored) {}
                        }
                    });
                }
            }
        });
    }

    private static class HighlightView extends View {
        private final RectF targetRect = new RectF();
        private String label = "";
        private float pulseScale = 1.0f;
        private int alpha = 255;
        private ValueAnimator pulseAnimator;

        private final Paint boxPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint bgDimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint labelBgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint labelTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        public HighlightView(Context context) {
            super(context);
            boxPaint.setStyle(Paint.Style.STROKE);
            boxPaint.setStrokeWidth(dp(3.5f));
            boxPaint.setColor(Color.parseColor("#38BDF8")); // vibrant cyan / sky blue

            glowPaint.setStyle(Paint.Style.STROKE);
            glowPaint.setStrokeWidth(dp(9f));
            glowPaint.setColor(Color.parseColor("#38BDF8"));

            bgDimPaint.setStyle(Paint.Style.FILL);
            bgDimPaint.setColor(Color.argb(70, 0, 0, 0)); // subtle dark backdrop

            labelBgPaint.setStyle(Paint.Style.FILL);
            labelBgPaint.setColor(Color.parseColor("#0F172A")); // dark slate

            labelTextPaint.setColor(Color.WHITE);
            labelTextPaint.setTextSize(dp(13f));
            labelTextPaint.setAntiAlias(true);
            labelTextPaint.setFakeBoldText(true);
        }

        public void setTarget(float l, float t, float r, float b, String lbl) {
            // Tight bounds for precise icon framing
            float padX = dp(3);
            float padY = dp(3);
            targetRect.set(l - padX, t - padY, r + padX, b + padY);
            this.label = lbl == null ? "" : lbl.trim();
            this.alpha = 255;
            invalidate();
        }

        public void startAnimation() {
            if (pulseAnimator != null) pulseAnimator.cancel();
            pulseAnimator = ValueAnimator.ofFloat(0f, 1f);
            pulseAnimator.setDuration(900);
            pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
            pulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
            pulseAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator animation) {
                    float val = (Float) animation.getAnimatedValue();
                    pulseScale = 1.0f + val * 0.06f;
                    glowPaint.setAlpha((int) (alpha * (0.3f + val * 0.5f)));
                    invalidate();
                }
            });
            pulseAnimator.start();
        }

        public void fadeOut(final Runnable onComplete) {
            if (pulseAnimator != null) pulseAnimator.cancel();
            ValueAnimator fade = ValueAnimator.ofInt(alpha, 0);
            fade.setDuration(350);
            fade.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator animation) {
                    alpha = (Integer) animation.getAnimatedValue();
                    invalidate();
                }
            });
            fade.addListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator animation) {
                    if (onComplete != null) onComplete.run();
                }
            });
            fade.start();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (targetRect.isEmpty() || alpha <= 0) return;

            boxPaint.setAlpha(alpha);
            bgDimPaint.setAlpha((int) (alpha * 0.28f));

            // 1. Draw subtle highlight spotlight
            canvas.drawRect(0, 0, getWidth(), getHeight(), bgDimPaint);

            // 2. Pulse bounding box
            float cx = targetRect.centerX();
            float cy = targetRect.centerY();
            float halfW = (targetRect.width() / 2f) * pulseScale;
            float halfH = (targetRect.height() / 2f) * pulseScale;
            RectF scaledRect = new RectF(cx - halfW, cy - halfH, cx + halfW, cy + halfH);

            // Glow border
            canvas.drawRoundRect(scaledRect, dp(14), dp(14), glowPaint);
            // Sharp crisp border
            canvas.drawRoundRect(scaledRect, dp(14), dp(14), boxPaint);

            // 3. Label tag (if provided)
            if (!label.isEmpty()) {
                float textWidth = labelTextPaint.measureText(label);
                float tagW = textWidth + dp(20);
                float tagH = dp(26);
                float tagL = Math.max(dp(12), Math.min(scaledRect.left, getWidth() - tagW - dp(12)));
                float tagT = scaledRect.top - tagH - dp(8);
                if (tagT < dp(40)) { // If near top edge, put tag below target
                    tagT = scaledRect.bottom + dp(8);
                }
                RectF tagRect = new RectF(tagL, tagT, tagL + tagW, tagT + tagH);

                labelBgPaint.setAlpha((int) (alpha * 0.92f));
                labelTextPaint.setAlpha(alpha);

                canvas.drawRoundRect(tagRect, dp(8), dp(8), labelBgPaint);
                // Tag border
                boxPaint.setStrokeWidth(dp(1.5f));
                canvas.drawRoundRect(tagRect, dp(8), dp(8), boxPaint);
                boxPaint.setStrokeWidth(dp(3.5f));

                // Draw Text centered in tag
                Paint.FontMetrics fm = labelTextPaint.getFontMetrics();
                float textY = tagRect.centerY() - (fm.descent + fm.ascent) / 2f;
                canvas.drawText(label, tagL + dp(10), textY, labelTextPaint);
            }
        }

        private float dp(float v) {
            return v * getResources().getDisplayMetrics().density;
        }
    }
}
