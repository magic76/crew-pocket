package com.crewpocket.helper;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.YuvImage;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Modern Luxury Floating PiP & Fullscreen Camera Live Preview.
 * Hardware-accelerated TextureView with 4-corner smooth rounded clipping,
 * distortion-free aspect-ratio matrix, Front/Back camera switcher with mirror correction,
 * and custom vector action buttons.
 */
public class CameraPreviewOverlay implements TextureView.SurfaceTextureListener, Camera.PreviewCallback {
    private static CameraPreviewOverlay instance;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private View overlayRoot = null;
    private TextureView textureView = null;
    private SurfaceTexture surfaceTexture = null;
    private Camera camera = null;
    private int currentFacing = Camera.CameraInfo.CAMERA_FACING_BACK;
    private int currentCameraId = 0;
    private int currentDisplayOrientation = 90;
    private boolean isPreviewing = false;
    private boolean isVisible = true;
    private boolean isFullScreen = false;

    private TopActionButton btnExpand = null;
    private WindowManager.LayoutParams windowParams = null;
    private byte[] latestJpegBytes = null;
    private final Object frameLock = new Object();
    private int previewWidth = 640;
    private int previewHeight = 480;

    // ── Custom Vector Action Button (Crisp Canvas Rendering) ──
    private static class TopActionButton extends View {
        public static final int TYPE_FLIP = 1;
        public static final int TYPE_EXPAND = 2;
        public static final int TYPE_COLLAPSE = 3;
        public static final int TYPE_CLOSE = 4;

        private int iconType = TYPE_FLIP;
        private int tintColor = Color.parseColor("#38BDF8");
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        public TopActionButton(Context context, int type, int tintColor, OnClickListener click) {
            super(context);
            this.iconType = type;
            this.tintColor = tintColor;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);

            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.parseColor("#E61E293B")); // Semi-transparent Slate 800
            bg.setCornerRadius(dp(14));
            bg.setStroke(dp(1), Color.parseColor("#334155"));
            setBackground(bg);
            if (click != null) setOnClickListener(click);
        }

        private int dp(float val) {
            return (int) (val * getResources().getDisplayMetrics().density + 0.5f);
        }

        public void setType(int type) {
            this.iconType = type;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float density = getResources().getDisplayMetrics().density;
            paint.setColor(tintColor);
            paint.setStrokeWidth(1.8f * density);

            switch (iconType) {
                case TYPE_FLIP: {
                    // Double curved circular arrows for Camera Flip
                    float r = 5.5f * density;
                    RectF oval = new RectF(cx - r, cy - r, cx + r, cy + r);
                    paint.setStyle(Paint.Style.STROKE);
                    // Top-right arc
                    canvas.drawArc(oval, -60, 110, false, paint);
                    // Bottom-left arc
                    canvas.drawArc(oval, 120, 110, false, paint);

                    // Top arrow head
                    paint.setStyle(Paint.Style.FILL);
                    Path arr1 = new Path();
                    arr1.moveTo(cx + r + 2.5f * density, cy - 2f * density);
                    arr1.lineTo(cx + r - 1.5f * density, cy - 6f * density);
                    arr1.lineTo(cx + r - 4f * density, cy - 1.5f * density);
                    arr1.close();
                    canvas.drawPath(arr1, paint);

                    // Bottom arrow head
                    Path arr2 = new Path();
                    arr2.moveTo(cx - r - 2.5f * density, cy + 2f * density);
                    arr2.lineTo(cx - r + 1.5f * density, cy + 6f * density);
                    arr2.lineTo(cx - r + 4f * density, cy + 1.5f * density);
                    arr2.close();
                    canvas.drawPath(arr2, paint);
                    break;
                }
                case TYPE_EXPAND: {
                    // Modern 4-Corner Diagonal Expand Arrows
                    paint.setStyle(Paint.Style.STROKE);
                    float d = 4.5f * density;
                    float arm = 3f * density;
                    // Top-Right corner
                    canvas.drawLine(cx + d, cy - d, cx + d - arm, cy - d, paint);
                    canvas.drawLine(cx + d, cy - d, cx + d, cy - d + arm, paint);
                    // Bottom-Left corner
                    canvas.drawLine(cx - d, cy + d, cx - d + arm, cy + d, paint);
                    canvas.drawLine(cx - d, cy + d, cx - d, cy + d - arm, paint);
                    // Diagonal arrows
                    canvas.drawLine(cx + d, cy - d, cx + 1.5f * density, cy - 1.5f * density, paint);
                    canvas.drawLine(cx - d, cy + d, cx - 1.5f * density, cy + 1.5f * density, paint);
                    break;
                }
                case TYPE_COLLAPSE: {
                    // Modern Inward Collapse Arrows
                    paint.setStyle(Paint.Style.STROKE);
                    float d = 4.5f * density;
                    float arm = 2.5f * density;
                    // Top-Right pointing inward
                    canvas.drawLine(cx + 1.5f * density, cy - 1.5f * density, cx + 1.5f * density + arm, cy - 1.5f * density, paint);
                    canvas.drawLine(cx + 1.5f * density, cy - 1.5f * density, cx + 1.5f * density, cy - 1.5f * density - arm, paint);
                    canvas.drawLine(cx + d, cy - d, cx + 1.5f * density, cy - 1.5f * density, paint);
                    // Bottom-Left pointing inward
                    canvas.drawLine(cx - 1.5f * density, cy + 1.5f * density, cx - 1.5f * density - arm, cy + 1.5f * density, paint);
                    canvas.drawLine(cx - 1.5f * density, cy + 1.5f * density, cx - 1.5f * density, cy + 1.5f * density + arm, paint);
                    canvas.drawLine(cx - d, cy + d, cx - 1.5f * density, cy + 1.5f * density, paint);
                    break;
                }
                case TYPE_CLOSE: {
                    // Crisp Modern Diagonal ✕
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(2f * density);
                    float s = 4f * density;
                    canvas.drawLine(cx - s, cy - s, cx + s, cy + s, paint);
                    canvas.drawLine(cx + s, cy - s, cx - s, cy + s, paint);
                    break;
                }
            }
        }
    }

    public static synchronized CameraPreviewOverlay getInstance(Context context) {
        if (instance == null) {
            instance = new CameraPreviewOverlay(context.getApplicationContext());
        }
        return instance;
    }

    private CameraPreviewOverlay(Context context) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    private int dp(float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    public synchronized boolean isShowing() {
        return overlayRoot != null;
    }

    public synchronized boolean isPreviewVisible() {
        return isVisible && overlayRoot != null && overlayRoot.getVisibility() == View.VISIBLE;
    }

    public synchronized void toggleVisibility() {
        if (overlayRoot == null) return;
        isVisible = !isVisible;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (overlayRoot != null) {
                    overlayRoot.setVisibility(isVisible ? View.VISIBLE : View.GONE);
                }
            }
        });
    }

    public synchronized void toggleFullscreen() {
        if (overlayRoot == null || windowParams == null) return;
        isFullScreen = !isFullScreen;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                try {
                    int screenWidth = windowManager.getDefaultDisplay().getWidth();
                    int screenHeight = windowManager.getDefaultDisplay().getHeight();
                    if (isFullScreen) {
                        windowParams.width = WindowManager.LayoutParams.MATCH_PARENT;
                        windowParams.height = WindowManager.LayoutParams.MATCH_PARENT;
                        windowParams.x = 0;
                        windowParams.y = 0;
                    } else {
                        // PiP floating card mode: 220dp width x 310dp height
                        windowParams.width = dp(220);
                        windowParams.height = dp(310);
                        windowParams.x = Math.max(dp(16), screenWidth - dp(236));
                        windowParams.y = dp(80);
                    }
                    windowManager.updateViewLayout(overlayRoot, windowParams);
                    if (btnExpand != null) {
                        btnExpand.setType(isFullScreen ? TopActionButton.TYPE_COLLAPSE : TopActionButton.TYPE_EXPAND);
                    }
                    // Recompute TextureView aspect ratio matrix
                    overlayRoot.post(new Runnable() {
                        @Override public void run() {
                            if (textureView != null) {
                                updateTextureTransform(textureView.getWidth(), textureView.getHeight());
                            }
                        }
                    });
                } catch (Exception ignored) {}
            }
        });
    }

    public synchronized void switchCamera() {
        if (Camera.getNumberOfCameras() < 2) {
            Toast.makeText(context, "此裝置只有一個相機鏡頭", Toast.LENGTH_SHORT).show();
            return;
        }
        currentFacing = (currentFacing == Camera.CameraInfo.CAMERA_FACING_BACK)
            ? Camera.CameraInfo.CAMERA_FACING_FRONT
            : Camera.CameraInfo.CAMERA_FACING_BACK;
        stopCamera();
        if (surfaceTexture != null) {
            startCamera(surfaceTexture);
        }
    }

    public synchronized void show() {
        if (overlayRoot != null) {
            isVisible = true;
            mainHandler.post(new Runnable() {
                @Override public void run() {
                    if (overlayRoot != null) overlayRoot.setVisibility(View.VISIBLE);
                }
            });
            return;
        }

        mainHandler.post(new Runnable() {
            @Override public void run() {
                try {
                    int overlayType = Build.VERSION.SDK_INT >= 26 
                        ? 2038 
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    int screenWidth = windowManager.getDefaultDisplay().getWidth();
                    isFullScreen = false;
                    int pipWidth = dp(220);
                    int pipHeight = dp(310);

                    windowParams = new WindowManager.LayoutParams(
                        pipWidth,
                        pipHeight,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                    );
                    windowParams.gravity = Gravity.TOP | Gravity.START;
                    windowParams.x = Math.max(dp(16), screenWidth - pipWidth - dp(16));
                    windowParams.y = dp(80);

                    // ── 1. Luxury Root Container with 4-Corner Rounded Clipping ──
                    final FrameLayout root = new FrameLayout(context);
                    final int cornerRadius = dp(20);

                    GradientDrawable rootBg = new GradientDrawable();
                    rootBg.setColor(Color.parseColor("#020617")); // Deep Slate 950
                    rootBg.setCornerRadius(cornerRadius);
                    rootBg.setStroke(dp(1.5f), Color.parseColor("#33818CF8")); // Luxury Indigo Glow
                    root.setBackground(rootBg);

                    // Hardware Outline Provider for 100% smooth 4-corner rounded clipping
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        root.setOutlineProvider(new ViewOutlineProvider() {
                            @Override
                            public void getOutline(View view, Outline outline) {
                                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), cornerRadius);
                            }
                        });
                        root.setClipToOutline(true);
                    }
                    root.setElevation(dp(16));

                    // ── 2. Camera View (TextureView allows flawless corner clipping & matrix transform) ──
                    textureView = new TextureView(context);
                    textureView.setSurfaceTextureListener(CameraPreviewOverlay.this);

                    FrameLayout.LayoutParams textureLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    );
                    root.addView(textureView, textureLp);

                    // ── 3. Luxury Top Bar (Drag Handle + Title + Custom Vector Action Buttons) ──
                    LinearLayout topBar = new LinearLayout(context);
                    topBar.setOrientation(LinearLayout.HORIZONTAL);
                    topBar.setGravity(Gravity.CENTER_VERTICAL);
                    topBar.setPadding(dp(10), dp(6), dp(8), dp(6));

                    GradientDrawable barBg = new GradientDrawable();
                    barBg.setColor(Color.parseColor("#D90F172A")); // Translucent Slate 900
                    barBg.setCornerRadius(dp(14));
                    topBar.setBackground(barBg);

                    TextView title = new TextView(context);
                    title.setText("📷 相機視訊");
                    title.setTextSize(11);
                    title.setTextColor(Color.WHITE);
                    title.setTypeface(Typeface.DEFAULT_BOLD);
                    topBar.addView(title);

                    // Live Pill Badge
                    TextView liveBadge = new TextView(context);
                    liveBadge.setText("LIVE");
                    liveBadge.setTextSize(9);
                    liveBadge.setTextColor(Color.parseColor("#5EEAD4")); // Teal 300
                    liveBadge.setTypeface(Typeface.MONOSPACE);
                    GradientDrawable badgeBg = new GradientDrawable();
                    badgeBg.setColor(Color.parseColor("#2614B8A6"));
                    badgeBg.setCornerRadius(dp(5));
                    badgeBg.setStroke(dp(1), Color.parseColor("#4D14B8A6"));
                    liveBadge.setBackground(badgeBg);
                    liveBadge.setPadding(dp(5), dp(1), dp(5), dp(1));
                    LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    badgeLp.setMargins(dp(5), 0, 0, 0);
                    topBar.addView(liveBadge, badgeLp);

                    View spacer = new View(context);
                    topBar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

                    // A. Camera Switch Button (Crisp Vector Canvas)
                    TopActionButton btnSwitch = new TopActionButton(context, TopActionButton.TYPE_FLIP, Color.parseColor("#38BDF8"), new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            switchCamera();
                        }
                    });
                    topBar.addView(btnSwitch, new LinearLayout.LayoutParams(dp(28), dp(28)));

                    // B. Fullscreen / Collapse Toggle Button (Crisp Vector Canvas)
                    btnExpand = new TopActionButton(context, TopActionButton.TYPE_EXPAND, Color.parseColor("#E2E8F0"), new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            toggleFullscreen();
                        }
                    });
                    LinearLayout.LayoutParams expandLp = new LinearLayout.LayoutParams(dp(28), dp(28));
                    expandLp.setMargins(dp(5), 0, 0, 0);
                    topBar.addView(btnExpand, expandLp);

                    // C. Close Button (Crisp Vector Canvas)
                    TopActionButton btnClose = new TopActionButton(context, TopActionButton.TYPE_CLOSE, Color.parseColor("#FB7185"), new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            NativeLiveService.toggleCameraSharing();
                        }
                    });
                    LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(dp(28), dp(28));
                    closeLp.setMargins(dp(5), 0, 0, 0);
                    topBar.addView(btnClose, closeLp);

                    // Draggable listener on Top Bar
                    topBar.setOnTouchListener(new View.OnTouchListener() {
                        private int initialX, initialY;
                        private float initialTouchX, initialTouchY;
                        @Override public boolean onTouch(View v, MotionEvent event) {
                            if (isFullScreen) return false;
                            switch (event.getAction()) {
                                case MotionEvent.ACTION_DOWN:
                                    initialX = windowParams.x;
                                    initialY = windowParams.y;
                                    initialTouchX = event.getRawX();
                                    initialTouchY = event.getRawY();
                                    return true;
                                case MotionEvent.ACTION_MOVE:
                                    windowParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                                    windowParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                                    try { windowManager.updateViewLayout(root, windowParams); } catch (Exception ignored) {}
                                    return true;
                            }
                            return false;
                        }
                    });

                    FrameLayout.LayoutParams topBarLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    );
                    topBarLp.gravity = Gravity.TOP;
                    topBarLp.setMargins(dp(6), dp(6), dp(6), 0);
                    root.addView(topBar, topBarLp);

                    // ── 4. Bottom Info Pill Overlay ──
                    LinearLayout bottomPill = new LinearLayout(context);
                    bottomPill.setOrientation(LinearLayout.HORIZONTAL);
                    bottomPill.setGravity(Gravity.CENTER_VERTICAL);
                    bottomPill.setPadding(dp(8), dp(3), dp(8), dp(3));
                    GradientDrawable botBg = new GradientDrawable();
                    botBg.setColor(Color.parseColor("#B3020617")); // Slate 950 @ 70%
                    botBg.setCornerRadius(dp(10));
                    botBg.setStroke(dp(1), Color.parseColor("#1A818CF8"));
                    bottomPill.setBackground(botBg);

                    TextView dot = new TextView(context);
                    dot.setText("●");
                    dot.setTextSize(9);
                    dot.setTextColor(Color.parseColor("#34D399")); // Emerald 400
                    dot.setPadding(0, 0, dp(4), 0);
                    bottomPill.addView(dot);

                    TextView botText = new TextView(context);
                    botText.setText("即時視覺串流");
                    botText.setTextSize(9);
                    botText.setTextColor(Color.parseColor("#94A3B8"));
                    botText.setTypeface(Typeface.MONOSPACE);
                    bottomPill.addView(botText);

                    FrameLayout.LayoutParams botLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    );
                    botLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
                    botLp.setMargins(0, 0, 0, dp(8));
                    root.addView(bottomPill, botLp);

                    overlayRoot = root;
                    isVisible = true;
                    windowManager.addView(root, windowParams);
                } catch (Exception error) {
                    overlayRoot = null;
                }
            }
        });
    }

    public synchronized void hide() {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                stopCamera();
                if (overlayRoot != null) {
                    try { windowManager.removeViewImmediate(overlayRoot); } catch (Exception ignored) {}
                    overlayRoot = null;
                    textureView = null;
                    surfaceTexture = null;
                    windowParams = null;
                    btnExpand = null;
                }
            }
        });
    }

    // ── TextureView Surface Texture Lifecycle ──
    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        this.surfaceTexture = surface;
        startCamera(surface);
        updateTextureTransform(width, height);
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        updateTextureTransform(width, height);
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        stopCamera();
        this.surfaceTexture = null;
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        // Frame rendered
    }

    /**
     * Compute aspect-ratio preserving Center-Crop Matrix for TextureView.
     * Prevents any stretching/distortion when rotated in portrait mode,
     * and mirrors front camera horizontally for natural selfie view.
     */
    private void updateTextureTransform(int viewWidth, int viewHeight) {
        if (textureView == null || viewWidth == 0 || viewHeight == 0) return;
        try {
            Matrix matrix = new Matrix();

            // In portrait (90° or 270°), the camera buffer's width and height are swapped
            float bufferWidth = (currentDisplayOrientation == 90 || currentDisplayOrientation == 270) ? previewHeight : previewWidth;
            float bufferHeight = (currentDisplayOrientation == 90 || currentDisplayOrientation == 270) ? previewWidth : previewHeight;

            float viewRatio = (float) viewWidth / (float) viewHeight;
            float bufferRatio = bufferWidth / bufferHeight;

            float scaleX = 1.0f;
            float scaleY = 1.0f;

            if (viewRatio > bufferRatio) {
                // View is wider than camera buffer: scale height to crop top/bottom
                scaleX = 1.0f;
                scaleY = (viewWidth / bufferWidth) * bufferHeight / viewHeight;
            } else {
                // View is taller than camera buffer: scale width to crop left/right
                scaleX = (viewHeight / bufferHeight) * bufferWidth / viewWidth;
                scaleY = 1.0f;
            }

            // Pivot at center of view
            matrix.setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f);

            // Natural selfie mirror effect for front camera
            if (currentFacing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
                matrix.postScale(-1f, 1f, viewWidth / 2f, viewHeight / 2f);
            }

            textureView.setTransform(matrix);
        } catch (Exception ignored) {}
    }

    private synchronized void startCamera(SurfaceTexture surface) {
        if (camera != null) return;
        try {
            currentCameraId = 0;
            int numCameras = Camera.getNumberOfCameras();
            for (int i = 0; i < numCameras; i++) {
                Camera.CameraInfo info = new Camera.CameraInfo();
                Camera.getCameraInfo(i, info);
                if (info.facing == currentFacing) {
                    currentCameraId = i;
                    break;
                }
            }
            camera = Camera.open(currentCameraId);

            // Compute correct display orientation
            Camera.CameraInfo info = new Camera.CameraInfo();
            Camera.getCameraInfo(currentCameraId, info);
            int rotation = windowManager.getDefaultDisplay().getRotation();
            int degrees = 0;
            switch (rotation) {
                case Surface.ROTATION_0: degrees = 0; break;
                case Surface.ROTATION_90: degrees = 90; break;
                case Surface.ROTATION_180: degrees = 180; break;
                case Surface.ROTATION_270: degrees = 270; break;
            }

            if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
                currentDisplayOrientation = (info.orientation + degrees) % 360;
                currentDisplayOrientation = (360 - currentDisplayOrientation) % 360; // compensate mirror
            } else {
                currentDisplayOrientation = (info.orientation - degrees + 360) % 360;
            }
            camera.setDisplayOrientation(currentDisplayOrientation);

            Camera.Parameters params = camera.getParameters();
            List<String> focusModes = params.getSupportedFocusModes();
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
            } else if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            }

            List<Camera.Size> pSizes = params.getSupportedPreviewSizes();
            if (pSizes != null) {
                for (Camera.Size s : pSizes) {
                    if (s.width <= 1280 && s.width >= 640) {
                        previewWidth = s.width;
                        previewHeight = s.height;
                        params.setPreviewSize(previewWidth, previewHeight);
                        break;
                    }
                }
            }

            camera.setParameters(params);
            camera.setPreviewTexture(surface);
            camera.setPreviewCallback(this);
            camera.startPreview();
            isPreviewing = true;

            // Apply matrix transform on main thread
            mainHandler.post(new Runnable() {
                @Override public void run() {
                    if (textureView != null) {
                        updateTextureTransform(textureView.getWidth(), textureView.getHeight());
                    }
                }
            });
        } catch (Exception e) {
            stopCamera();
        }
    }

    private synchronized void stopCamera() {
        if (camera != null) {
            try {
                if (isPreviewing) {
                    camera.setPreviewCallback(null);
                    camera.stopPreview();
                    isPreviewing = false;
                }
                camera.release();
            } catch (Exception ignored) {}
            camera = null;
        }
    }

    @Override
    public void onPreviewFrame(byte[] data, Camera camera) {
        if (data == null || data.length == 0) return;
        try {
            YuvImage yuvImage = new YuvImage(data, ImageFormat.NV21, previewWidth, previewHeight, null);
            ByteArrayOutputStream os = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, previewWidth, previewHeight), 70, os);
            byte[] jpeg = os.toByteArray();
            synchronized (frameLock) {
                latestJpegBytes = jpeg;
            }
        } catch (Exception ignored) {}
    }

    public byte[] getLatestJpegFrame() {
        synchronized (frameLock) {
            return latestJpegBytes;
        }
    }
}
