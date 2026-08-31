package com.crewpocket.helper;

import android.content.Context;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Floating PiP / Fullscreen Camera Live Preview.
 * Draggable, resizable (pip vs full), non-blocking, smooth video stream to Gemini Live.
 */
public class CameraPreviewOverlay implements SurfaceHolder.Callback, Camera.PreviewCallback {
    private static CameraPreviewOverlay instance;
    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private View overlayRoot = null;
    private SurfaceView surfaceView = null;
    private SurfaceHolder surfaceHolder = null;
    private Camera camera = null;
    private boolean isPreviewing = false;
    private boolean isVisible = true;
    private boolean isFullScreen = false;

    private WindowManager.LayoutParams windowParams = null;
    private byte[] latestJpegBytes = null;
    private final Object frameLock = new Object();
    private int previewWidth = 640;
    private int previewHeight = 480;

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
                        // PiP floating card mode: 220dp width x 300dp height
                        windowParams.width = dp(220);
                        windowParams.height = dp(300);
                        windowParams.x = Math.max(dp(16), screenWidth - dp(240));
                        windowParams.y = dp(80);
                    }
                    windowManager.updateViewLayout(overlayRoot, windowParams);
                } catch (Exception ignored) {}
            }
        });
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
                    // Initial mode: Draggable PiP Floating Card (width 220dp, height 300dp)
                    isFullScreen = false;
                    int pipWidth = dp(220);
                    int pipHeight = dp(300);

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

                    // Root container with rounded corners and border
                    final FrameLayout root = new FrameLayout(context);
                    GradientDrawable rootBg = new GradientDrawable();
                    rootBg.setColor(Color.BLACK);
                    rootBg.setCornerRadius(dp(18));
                    rootBg.setStroke(dp(2), Color.parseColor("#38BDF8"));
                    root.setBackground(rootBg);
                    root.setClipToOutline(true);

                    // Camera Surface
                    surfaceView = new SurfaceView(context);
                    surfaceHolder = surfaceView.getHolder();
                    surfaceHolder.addCallback(CameraPreviewOverlay.this);

                    FrameLayout.LayoutParams surfaceLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    );
                    root.addView(surfaceView, surfaceLp);

                    // Top Bar for drag and quick action (Fullscreen / Close)
                    LinearLayout topBar = new LinearLayout(context);
                    topBar.setOrientation(LinearLayout.HORIZONTAL);
                    topBar.setGravity(Gravity.CENTER_VERTICAL);
                    topBar.setPadding(dp(10), dp(6), dp(10), dp(6));
                    GradientDrawable barBg = new GradientDrawable();
                    barBg.setColor(Color.parseColor("#990F172A"));
                    topBar.setBackground(barBg);

                    TextView title = new TextView(context);
                    title.setText("📷 相機視訊");
                    title.setTextSize(11);
                    title.setTextColor(Color.parseColor("#38BDF8"));
                    topBar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

                    // Fullscreen Toggle Button
                    final TextView btnExpand = new TextView(context);
                    btnExpand.setText("⤢");
                    btnExpand.setTextSize(16);
                    btnExpand.setTextColor(Color.WHITE);
                    btnExpand.setPadding(dp(8), dp(2), dp(8), dp(2));
                    btnExpand.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            toggleFullscreen();
                            btnExpand.setText(isFullScreen ? "⤡" : "⤢");
                        }
                    });
                    topBar.addView(btnExpand);

                    // Close Button
                    TextView btnClose = new TextView(context);
                    btnClose.setText("✕");
                    btnClose.setTextSize(16);
                    btnClose.setTextColor(Color.parseColor("#F43F5E"));
                    btnClose.setPadding(dp(8), dp(2), dp(8), dp(2));
                    btnClose.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            NativeLiveService.toggleCameraSharing();
                        }
                    });
                    topBar.addView(btnClose);

                    // Drag listener on Top Bar
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
                    root.addView(topBar, topBarLp);

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
                    surfaceView = null;
                    surfaceHolder = null;
                    windowParams = null;
                }
            }
        });
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        startCamera(holder);
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (camera != null && isPreviewing) {
            try {
                camera.stopPreview();
                camera.setDisplayOrientation(90);
                camera.setPreviewDisplay(holder);
                camera.setPreviewCallback(this);
                camera.startPreview();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        stopCamera();
    }

    private synchronized void startCamera(SurfaceHolder holder) {
        if (camera != null) return;
        try {
            int cameraId = 0;
            int numCameras = Camera.getNumberOfCameras();
            for (int i = 0; i < numCameras; i++) {
                Camera.CameraInfo info = new Camera.CameraInfo();
                Camera.getCameraInfo(i, info);
                if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) {
                    cameraId = i;
                    break;
                }
            }
            camera = Camera.open(cameraId);
            camera.setDisplayOrientation(90);

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
            camera.setPreviewDisplay(holder);
            camera.setPreviewCallback(this);
            camera.startPreview();
            isPreviewing = true;
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
