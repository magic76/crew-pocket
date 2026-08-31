package com.crewpocket.helper;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Full-screen / Large Camera Live Preview Overlay with toggleable visibility.
 * Lets the user see what the camera captures while having a voice conversation with Gemini Live.
 */
public class CameraPreviewOverlay implements SurfaceHolder.Callback {
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
        return isVisible;
    }

    public synchronized void toggleVisibility() {
        isVisible = !isVisible;
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (overlayRoot != null) {
                    overlayRoot.setVisibility(isVisible ? View.VISIBLE : View.GONE);
                }
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

                    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.MATCH_PARENT,
                        overlayType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );
                    params.gravity = Gravity.TOP | Gravity.START;

                    FrameLayout root = new FrameLayout(context);
                    root.setBackgroundColor(Color.parseColor("#E6020617")); // Dark semi-transparent background

                    surfaceView = new SurfaceView(context);
                    surfaceHolder = surfaceView.getHolder();
                    surfaceHolder.addCallback(CameraPreviewOverlay.this);

                    FrameLayout.LayoutParams surfaceLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    );
                    root.addView(surfaceView, surfaceLp);

                    // Top Status Banner
                    TextView topBanner = new TextView(context);
                    topBanner.setText("📷 相機即時視訊中 · 與 AI 語音通話");
                    topBanner.setTextColor(Color.WHITE);
                    topBanner.setTextSize(13);
                    topBanner.setGravity(Gravity.CENTER);
                    topBanner.setPadding(dp(16), dp(10), dp(16), dp(10));
                    GradientDrawable bannerBg = new GradientDrawable();
                    bannerBg.setColor(Color.parseColor("#CC0F172A"));
                    bannerBg.setCornerRadius(dp(20));
                    bannerBg.setStroke(1, Color.parseColor("#38BDF8"));
                    topBanner.setBackground(bannerBg);

                    FrameLayout.LayoutParams bannerLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    );
                    bannerLp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                    bannerLp.topMargin = dp(40);
                    root.addView(topBanner, bannerLp);

                    overlayRoot = root;
                    isVisible = true;
                    windowManager.addView(root, params);
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
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            }
            camera.setParameters(params);
            camera.setPreviewDisplay(holder);
            camera.startPreview();
            isPreviewing = true;
        } catch (Exception ignored) {
            stopCamera();
        }
    }

    private synchronized void stopCamera() {
        if (camera != null) {
            try {
                if (isPreviewing) {
                    camera.stopPreview();
                    isPreviewing = false;
                }
                camera.release();
            } catch (Exception ignored) {}
            camera = null;
        }
    }

    public interface SnapshotCallback {
        void onSuccess(String path);
        void onError(String error);
    }

    /** Take a snapshot for Gemini Live while previewing */
    public synchronized void takeSnapshot(final SnapshotCallback callback) {
        if (camera == null || !isPreviewing) {
            callback.onError("Camera preview not active");
            return;
        }
        try {
            camera.takePicture(null, null, new Camera.PictureCallback() {
                @Override
                public void onPictureTaken(byte[] data, Camera cam) {
                    try {
                        File dir = new File("/sdcard/Pictures/CrewPocket");
                        dir.mkdirs();
                        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
                        File file = new File(dir, "IMG_" + timeStamp + ".jpg");
                        FileOutputStream fos = new FileOutputStream(file);
                        fos.write(data);
                        fos.flush();
                        fos.close();

                        // Also update latest_camera_photo.jpg
                        try {
                            File latestFile = new File(dir, "latest_camera_photo.jpg");
                            FileOutputStream lfos = new FileOutputStream(latestFile);
                            lfos.write(data);
                            lfos.flush();
                            lfos.close();
                        } catch (Exception ignored) {}

                        callback.onSuccess(file.getAbsolutePath());
                    } catch (Exception e) {
                        callback.onError(e.getMessage());
                    } finally {
                        // Restart preview after takePicture
                        try {
                            if (camera != null) camera.startPreview();
                        } catch (Exception ignored) {}
                    }
                }
            });
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
}
