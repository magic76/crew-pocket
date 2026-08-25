# Generator for CameraCaptureManager and MainActivity updates

ccm = r'''package com.crewpocket.helper;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.io.FileOutputStream;
import java.util.List;

public class CameraCaptureManager {
    public interface CaptureCallback {
        void onSuccess(String filePath);
        void onError(String error);
    }

    public static void capturePhoto(final Context context, final boolean isFront, final CaptureCallback callback) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                Camera camera = null;
                try {
                    int cameraId = 0;
                    int numCameras = Camera.getNumberOfCameras();
                    for (int i = 0; i < numCameras; i++) {
                        Camera.CameraInfo info = new Camera.CameraInfo();
                        Camera.getCameraInfo(i, info);
                        if (isFront && info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
                            cameraId = i;
                            break;
                        } else if (!isFront && info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) {
                            cameraId = i;
                            break;
                        }
                    }

                    camera = Camera.open(cameraId);
                    SurfaceTexture st = new SurfaceTexture(10);
                    camera.setPreviewTexture(st);

                    Camera.Parameters params = camera.getParameters();
                    List<Camera.Size> sizes = params.getSupportedPictureSizes();
                    if (sizes != null && !sizes.isEmpty()) {
                        Camera.Size best = sizes.get(0);
                        for (Camera.Size s : sizes) {
                            if (s.width <= 1920 && s.width >= 1080) {
                                best = s;
                                break;
                            }
                        }
                        params.setPictureSize(best.width, best.height);
                    }

                    List<String> focusModes = params.getSupportedFocusModes();
                    if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                        params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
                    }
                    camera.setParameters(params);
                    camera.startPreview();

                    // Allow auto-exposure stabilization
                    Thread.sleep(400);

                    final Camera finalCam = camera;
                    camera.takePicture(null, null, new Camera.PictureCallback() {
                        @Override
                        public void onPictureTaken(byte[] data, Camera cam) {
                            try {
                                File dir = new File("/sdcard/Pictures/CrewPocket");
                                dir.mkdirs();
                                File file = new File(dir, "latest_camera_photo.jpg");
                                FileOutputStream fos = new FileOutputStream(file);
                                fos.write(data);
                                fos.flush();
                                fos.close();

                                callback.onSuccess(file.getAbsolutePath());
                            } catch (Exception e) {
                                callback.onError("Save failed: " + e.getMessage());
                            } finally {
                                try { finalCam.release(); } catch (Exception ignored) {}
                            }
                        }
                    });
                } catch (Exception e) {
                    if (camera != null) {
                        try { camera.release(); } catch (Exception ignored) {}
                    }
                    callback.onError("Camera error: " + e.getMessage());
                }
            }
        }).start();
    }
}
'''

main_act = r'''package com.crewpocket.helper;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView statusText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(60, 60, 60, 60);

        TextView title = new TextView(this);
        title.setText("🤖 Crew Pocket 輔助小幫手 v1.2");
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        layout.addView(title);

        statusText = new TextView(this);
        statusText.setPadding(0, 30, 0, 30);
        statusText.setGravity(Gravity.CENTER);
        statusText.setTextSize(14);
        layout.addView(statusText);

        Button btnAccess = new Button(this);
        btnAccess.setText("⚙️ 前往開啟「無障礙服務」");
        btnAccess.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                startActivity(intent);
            }
        });
        layout.addView(btnAccess);

        Button btnOverlay = new Button(this);
        btnOverlay.setText("🎈 開啟「全域懸浮球」權限");
        btnOverlay.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (!Settings.canDrawOverlays(MainActivity.this)) {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } else {
                        FloatingBubbleManager.getInstance(MainActivity.this).showBubble();
                        Toast.makeText(MainActivity.this, "懸浮球已開啟！", Toast.LENGTH_SHORT).show();
                    }
                } else {
                    FloatingBubbleManager.getInstance(MainActivity.this).showBubble();
                }
            }
        });
        LinearLayout.LayoutParams overlayLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        );
        overlayLp.setMargins(0, 20, 0, 0);
        layout.addView(btnOverlay, overlayLp);

        Button btnCamera = new Button(this);
        btnCamera.setText("📸 開啟「相機拍照」權限");
        btnCamera.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 101);
                    } else {
                        Toast.makeText(MainActivity.this, "✅ 相機權限已開啟！", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });
        LinearLayout.LayoutParams camLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        );
        camLp.setMargins(0, 20, 0, 0);
        layout.addView(btnCamera, camLp);

        setContentView(layout);

        // Auto request camera permission on launch if needed
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 101);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (CrewAccessibilityService.isServiceRunning()) {
            statusText.setText("🟢 無障礙服務已連線運行中！\n本地通訊 Port: 8766");
            statusText.setTextColor(0xFF22c55e);
            FloatingBubbleManager.getInstance(this).showBubble();
        } else {
            statusText.setText("🔴 無障礙服務未連線。\n請點擊上方按鈕前往開啟。");
            statusText.setTextColor(0xFFef4444);
        }
    }
}
'''

with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/CameraCaptureManager.java', 'w') as f:
    f.write(ccm)

with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/MainActivity.java', 'w') as f:
    f.write(main_act)

print("SUCCESS: CameraCaptureManager & MainActivity written!")
