# Crew Pocket Android Wrapper (Phase 1)

This module is an experimental Android APK shell for the existing Crew Pocket runtime.

## What this phase does

- Keeps the existing Node.js + Antigravity + Codex runtime in Termux.
- Starts a real Android foreground service when the APK is opened.
- Monitors `http://127.0.0.1:8000`.
- If the local Crew server disappears, asks Termux to run the repository's
  `scripts/android-runtime-start.sh`.
- Shows the existing Crew Pocket web UI inside a WebView.
- Keeps a Browser button as a fallback so the current PWA can still be opened in
  the normal browser.
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


## Phase 2A: optional embedded Codex process

This branch can now move only the **Codex app-server process** into the APK while
keeping the existing Crew Node/PWA host in Termux.

```text
Crew Node server (Termux)
        |
        | TCP 127.0.0.1:8767
        v
Crew Pocket APK
        |
        v
native Codex app-server
```

If the embedded bridge is missing or unavailable,
`lib/runtime/codex-transport.js` automatically falls back to the existing
Termux `codex app-server`.

### Prepare the native binary on the phone

The repository does not commit third-party native binaries. Use the Android
ARM64 binary already installed by `@mmmbuto/codex-cli-termux`:

```bash
cd ~/agy-web
bash scripts/prepare-embedded-codex.sh
gradle -p android-wrapper :app:assembleDebug
~/install-apk.sh android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

The prepare script copies `codex.bin` and `libc++_shared.so` into
`jniLibs/arm64-v8a`. Both are gitignored.

Android 10+ blocks executing code downloaded into an app's writable home
directory, so the Codex ELF is packaged into the APK and executed from Android's
installer-owned `nativeLibraryDir`.

### Verify the transport

Open the APK first, then send a Codex message. Watch:

```bash
tail -f ~/.agy-web.log
```

Embedded path:

```text
[Codex Runtime] Connected to embedded Android bridge at 127.0.0.1:8767
[Codex Provider] transport=embedded-android-bridge
```

Fallback path:

```text
[Codex Runtime] Embedded bridge unavailable; using local codex process.
[Codex Provider] transport=local-codex-process
```

Use `CREW_CODEX_BRIDGE=required` for strict testing if you want the request to
fail instead of silently falling back.

### Important sandbox limitation

The APK and Termux are separate Android application sandboxes. Embedded Codex
therefore cannot automatically read:

- Termux's private `~/.codex` login state.
- Repositories under `/data/data/com.termux/files/home`.

Phase 2A proves native binary packaging, process startup, stdio JSON-RPC relay,
and fallback. To make embedded Codex a full coding replacement, Phase 2B needs:

1. an embedded Codex login/bootstrap flow; and
2. a workspace location intentionally accessible to the APK (or a controlled
   workspace sync/import layer).

Do not remove Termux yet.


## Phase 2B: APK auth + workspace

Phase 2B makes embedded Codex usable inside the Android app sandbox instead of
only proving that the native process can start.

The embedded bridge is now opened only when all three prerequisites are ready:

1. `libcodex_exec.so` is bundled in the APK.
2. APK-private Codex auth exists at `files/.codex/auth.json`.
3. APK-private workspace exists at `files/workspaces/agy-web`.

Until all three are ready, Crew Pocket keeps using the Termux Codex fallback.

### Embedded Codex login

Embedded Codex now owns its authentication lifecycle. Crew Pocket does **not**
copy Termux's `~/.codex/auth.json`.

Open the existing Authentication panel and use **Device Code Login**. The Node
host forwards the login request to the active Codex app-server:

```text
account/login/start
{ "type": "chatgptDeviceCode" }
```

The APK-private Codex process returns a verification URL and user code. After the
user completes authorization, Codex writes and refreshes its own credentials
inside:

```text
/data/user/0/com.crewpocket.app/files/.codex/
```

The wrapper pins `cli_auth_credentials_store = "file"` for this private
`CODEX_HOME`.

Older Phase 2B builds briefly copied Termux auth into the APK. On upgrade, Crew
Pocket removes that legacy copied auth once and requires a fresh embedded login,
so Termux and the APK never compete over the same OAuth refresh token.

### Workspace bootstrap

The APK downloads the current `magic76/crew-pocket`
`feature/agent-runtime` GitHub snapshot and extracts it into:

```text
/data/user/0/com.crewpocket.app/files/workspaces/agy-web
```

This first version intentionally bootstraps a source snapshot, not a Git worktree.
Git support / sync-back is a later phase.

When Codex transport is embedded, Crew's Termux workspace path is translated to
the APK-private workspace. When transport falls back to Termux, existing paths
are unchanged.

### Debug verification

The debug APK is debuggable, so ADB can inspect the app sandbox:

```bash
adb shell run-as com.crewpocket.app ls -l files/.codex/auth.json
adb shell run-as com.crewpocket.app ls -l files/workspaces/agy-web/server.js
adb shell run-as com.crewpocket.app cat files/workspaces/agy-web/.crew-embedded-workspace
```

Then start a **new Codex conversation** and ask it to create a simple file such as
`EMBEDDED_RUNTIME_TEST.txt`. Verify it was created inside the APK workspace:

```bash
adb shell run-as com.crewpocket.app cat files/workspaces/agy-web/EMBEDDED_RUNTIME_TEST.txt
```

Expected Termux log:

```text
[Codex Runtime] Connected to embedded Android bridge at 127.0.0.1:8767
[Codex Provider] transport=embedded-android-bridge
[Codex Runtime] workspace=/data/user/0/com.crewpocket.app/files/workspaces/agy-web
```

Existing Codex thread IDs created under Termux may not exist in the APK-private
`CODEX_HOME`. The provider therefore starts a new embedded thread if a previous
Termux thread cannot be resumed.


## Phase 2C: embedded Node + self-debug supervisor

Phase 2C adds an optional APK-owned Node host. Termux stays installed as a
rescue host until the embedded runtime is proven.

Architecture:

```text
Crew Pocket APK
├─ Embedded Codex app-server
├─ Embedded Node host :8000
├─ Runtime Supervisor
│  ├─ health check
│  ├─ node.log / state.json
│  ├─ Termux rescue fallback
│  └─ source-change retry
└─ APK-private workspace
   └─ agy-web/
      └─ .crew-runtime/
         ├─ SELF_DEBUG.md
         ├─ node.log
         └─ state.json
```

Android 10+ does not allow executing binaries copied into the writable app home,
so the Node executable and its native dependencies are prepared as APK native
libraries and executed from Android's installer-owned native library directory.

### Prepare Node on the phone

The current PoC reuses the Termux ARM64 Node build but rewrites its non-system
native dependencies to APK-safe library names.

```bash
pkg install patchelf
cd ~/agy-web
bash scripts/prepare-embedded-codex.sh
bash scripts/prepare-embedded-node.sh

gradle -p android-wrapper :app:assembleDebug
~/install-apk.sh android-wrapper/app/build/outputs/apk/debug/app-debug.apk
```

If Embedded Node starts successfully, the status API should report:

```bash
curl -s http://127.0.0.1:8000/api/runtime/status
```

Expected host field:

```json
{
  "host": {
    "runtime": "embedded-node"
  }
}
```

### Self-debug loop

The supervisor intentionally keeps Termux as a rescue path:

```text
Embedded Node crashes
→ Android writes .crew-runtime/node.log + state.json
→ Termux rescue host takes port 8000
→ Embedded Codex keeps using the APK-private workspace
→ Codex patches the broken source
→ source fingerprint changes
→ Android supervisor stops the rescue host
→ Embedded Node is started and health-checked again
→ success: Embedded Node owns :8000
→ failure: rescue host comes back
```

For a deliberate test, first confirm the embedded host is active, then ask
Codex to introduce a temporary startup syntax error in the APK-private
`server.js`. After fallback appears, ask:

```text
Crew runtime 掛掉了，請自我 debug。
先讀 .crew-runtime/state.json 和 .crew-runtime/node.log，
找出你剛才造成的問題，修好後不要手動啟動 server，
讓 Runtime Supervisor 自己驗證。
```

A self-debug related prompt automatically receives the runtime log/state
location as extra context.

### Current boundary

Phase 2C proves the self-hosting loop for the Codex path. Antigravity still
depends on Termux and is not yet embedded. Do not remove Termux or merge this
branch into main until both the embedded Node host and the rescue loop have
passed device testing.
