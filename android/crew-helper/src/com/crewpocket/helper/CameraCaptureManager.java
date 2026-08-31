package com.crewpocket.helper;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

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
                    int[] textures = new int[1];
                    android.opengl.GLES20.glGenTextures(1, textures, 0);
                    SurfaceTexture st = new SurfaceTexture(textures[0]);
                    camera.setPreviewTexture(st);

                    Camera.Parameters params = camera.getParameters();
                    List<Camera.Size> sizes = params.getSupportedPictureSizes();
                    
                    // 🌟 Pick Maximum Sensor Resolution for Phone Storage
                    if (sizes != null && !sizes.isEmpty()) {
                        Camera.Size maxResolution = sizes.get(0);
                        long maxPixels = maxResolution.width * (long) maxResolution.height;
                        for (Camera.Size s : sizes) {
                            long pixels = s.width * (long) s.height;
                            if (pixels > maxPixels) {
                                maxResolution = s;
                                maxPixels = pixels;
                            }
                        }
                        params.setPictureSize(maxResolution.width, maxResolution.height);
                    }

                    // 🌟 100% Maximum Full Quality JPEG for pristine clarity in album
                    params.setJpegQuality(100);

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

                                String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
                                String fileName = "IMG_" + timeStamp + ".jpg";
                                File file = new File(dir, fileName);

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
