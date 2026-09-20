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

Open the Crew Pocket tools menu and choose **無線偵錯設定**. The native setup
sheet can save the debug `IP:Port`, run `adb connect` through Termux, show the
current ADB status, open Android's developer settings, and copy a matching
command for Termux. For a new pairing, enter the pairing `IP:Port` and the
six-digit pairing code, then choose **配對並連線**. The endpoint is stored in
`~/.adb_port`, so `~/install-apk.sh` uses the same setting afterward.

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
