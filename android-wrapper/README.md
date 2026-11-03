# Crew Pocket Android Wrapper (Phase 1)

This module is an experimental Android APK shell for the existing Crew Pocket runtime.

## What this phase does

- Keeps the existing Node.js + Antigravity + Codex runtime in Termux.
- Starts a real Android foreground service when the APK is opened.
- Monitors `http://127.0.0.1:8000`.
- If the local Crew server disappears, asks Termux to run the repository's
  `scripts/android-runtime-start.sh`.
- Shows the existing Crew Pocket web UI inside a WebView.
- Keeps a Browser button only as a diagnostics fallback for the localhost UI.
- Uses `START_STICKY` so Android may recreate the monitor service after process
  reclamation.

This phase intentionally does **not** embed Node.js, Codex, Antigravity, or a full
Termux runtime inside the APK.

## One-time Termux setup

Pull this branch in your current Termux clone, then run:

```bash
cd ~/agy-web
bash scripts/enable-android-wrapper.sh
```

The script enables Termux's mandatory `allow-external-apps=true` setting.

After installing the APK, Android must also grant Crew Pocket:

**App info → Permissions → Additional permissions → Run commands in Termux environment**

Both requirements are mandatory for Termux's official `RUN_COMMAND` integration.

## Wireless debugging setup from the APK

Open the Crew Pocket tools menu and choose **無線偵錯設定**.

On Android 11+, the default **快速配對（通知輸入 6 位碼）** works similarly
to Shizuku's setup without requiring Shizuku itself:

1. Allow Crew Pocket notifications and the Termux Run Command permission.
2. Tap 快速配對. Crew Pocket starts a temporary foreground mDNS discovery
   service, shows a pairing-code notification, and opens Developer Options.
3. Enable Wireless debugging, select **Pair device with pairing code**.
   Keep Android's pairing dialog open.
4. Pull down the notification shade and enter the six-digit code in the
   Crew Pocket notification. Neither a pairing IP nor a connect IP is needed.
5. Crew Pocket discovers `_adb-tls-pairing._tcp` and
   `_adb-tls-connect._tcp`, probes their **local loopback** ports, sends
   `adb pair` and `adb connect` through the existing Termux bridge, and
   verifies the connection via `/api/adb`.

The six-digit code is not saved in Crew Pocket preferences or notification
text. The discovery times out after two minutes. The user must enable
Wireless debugging in Android Settings; Crew Pocket cannot enable it silently.
This requires a Wi-Fi network and may need repeating after reboot or network
changes. If discovery or notifications fail, expand **手動 IP:Port 設定**
to use the previous pairing, connection and diagnostic commands.

The confirmed connection endpoint is stored in `~/.adb_port`, so
`~/install-apk.sh` uses the same setting afterward. The Android wrapper
continues to use Termux for the ADB binary; this change does not embed
ADB, grant privileges, or install Shizuku.

## Build

With JDK 17 and Gradle available:

```bash
gradle -p android-wrapper :app:assembleDebug
```

APK:

```text
android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

The branch also contains a GitHub Actions workflow that builds the same debug APK.

## Test background recovery

1. Start Crew Pocket from the APK.
2. Confirm the persistent **Crew Pocket** notification is visible.
3. Send a normal AGY/Codex message and verify the existing UI still works.
4. Swipe the Crew Pocket activity away from Recents.
5. Confirm the foreground-service notification remains.
6. In Termux, kill only the Node server:
   `pkill -f 'node.*server\.js'`.
7. Leave the APK UI closed and wait for the foreground monitor to detect the
   missing localhost service.
8. Reopen the APK and verify `http://127.0.0.1:8000` is reachable again.

## Important limitation

Android can still kill any ordinary app process under memory, battery, force-stop,
or OEM power-management conditions. A foreground service greatly improves
survivability but cannot guarantee an immortal process. The wrapper therefore
uses monitoring + restart rather than assuming the process never dies.

For a later phase, `AgentRuntime` can gain an embedded implementation so the APK
no longer depends on Termux.

## Archived embedded-runtime experiments

The production APK is intentionally Termux-first. Previous embedded Codex / embedded
Node / self-debug experiments are kept under `android-wrapper/experimental-runtime/`
for reference, but they are not compiled into or validated as part of the production APK.
