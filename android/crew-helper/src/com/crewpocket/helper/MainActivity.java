package com.crewpocket.helper;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.net.Uri;
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
        title.setText("🤖 Crew Pocket 輔助小幫手 v1.7.0 (聲紋門控)");
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

        Button btnNotification = new Button(this);
        btnNotification.setText("🔔 開啟通知欄控制");
        btnNotification.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                FloatingBubbleManager.getInstance(MainActivity.this).showNotification();
                Toast.makeText(MainActivity.this, "通知欄控制已開啟！", Toast.LENGTH_SHORT).show();
            }
        });
        LinearLayout.LayoutParams overlayLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        );
        overlayLp.setMargins(0, 20, 0, 0);
        layout.addView(btnNotification, overlayLp);

        Button btnVoiceBubble = new Button(this);
        btnVoiceBubble.setText("🎙️ 啟用浮動語音泡泡");
        btnVoiceBubble.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                FloatingBubbleManager manager = FloatingBubbleManager.getInstance(MainActivity.this);
                if (!manager.canDrawOverlays()) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                    return;
                }
                manager.showBubble();
                Toast.makeText(MainActivity.this, "短按泡泡開始／結束語音；長按開啟文字面板", Toast.LENGTH_LONG).show();
            }
        });
        layout.addView(btnVoiceBubble, overlayLp);

        Button btnVoice = new Button(this);
        btnVoice.setText("🎙️ 開啟原生 Gemini Live 測試");
        btnVoice.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, NativeLiveActivity.class));
            }
        });
        layout.addView(btnVoice, overlayLp);

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
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 103);
            }
            if (checkSelfPermission("android.permission.READ_MEDIA_IMAGES") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.READ_MEDIA_IMAGES"}, 102);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE}, 102);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (CrewAccessibilityService.isServiceRunning()) {
            statusText.setText("🟢 無障礙服務已連線運行中！\n本地通訊 Port: 8766");
            statusText.setTextColor(0xFF22c55e);
            FloatingBubbleManager manager = FloatingBubbleManager.getInstance(this);
            manager.showNotification();
        } else {
            statusText.setText("🔴 無障礙服務未連線。\n請點擊上方按鈕前往開啟。");
            statusText.setTextColor(0xFFef4444);
        }
    }
}
