# Runtime Provider Handoff

## Production decision

Crew Pocket will use **Termux as the production runtime engine** for now.

The Android APK is responsible for:

- WebView/UI.
- Foreground service supervision.
- Starting/stopping/recovering the Termux Crew runtime.
- Showing provider status and versions.
- Triggering safe provider updates.

Termux is responsible for:

- Node.js / Crew Pocket server.
- OpenAI Codex CLI.
- Google Antigravity (AGY) CLI.
- Git, shell, native dependencies, and workspace tooling.
- Provider login state.

This is intentional. Codex and AGY evolve independently and are easier to update safely in Termux than when vendored into every APK build.

## Embedded runtime status

The branch still contains the Embedded Node / Embedded Codex / Embedded AGY experiments and history migration work. Keep them as research code, but **do not enable them in production**.

At service startup:

- `embedded_runtime_enabled=false` is enforced.
- `embedded_ready=false` is enforced.
- `host_mode=termux-runtime`.
- Termux owns localhost:8000.
- `CREW_CODEX_BRIDGE=off` prevents production Codex traffic from accidentally using the experimental APK bridge.

Do not remove the experimental code until the Termux-first path has been merged and proven stable. It remains useful for future Android-native provider work.

## Provider update model

Crew Pocket exposes:

```text
GET  /api/runtime/providers
POST /api/runtime/providers
```

GET reports the installed Codex and AGY versions.

POST accepts only:

```json
{ "provider": "codex" }
```

or:

```json
{ "provider": "antigravity" }
```

Before updating, the active resident process for that provider is stopped.

Update commands are intentionally fixed and not user-controlled:

- Codex: `npm install -g @mmmbuto/codex-cli-termux@latest`
- AGY: download and execute the official installer from
  `https://antigravity.google/cli/install.sh`

The PWA Authentication panel contains version labels and Update buttons for both providers.

## Runtime recovery

The Android foreground service checks localhost:8000 periodically.

If Crew is unavailable:

1. Android calls Termux RUN_COMMAND.
2. `scripts/android-runtime-start.sh` starts the Node server.
3. The start script rebuilds PWA cache first.
4. Existing repo-owned server processes can still be adopted through the PID logic.

The APK Stop action stops the Termux Crew server. Restart restarts the Termux Crew runtime.

## Required device verification

Before merging this branch:

1. Confirm APK startup launches the Termux Crew server without manually running `crew start`.
2. Confirm Codex new chat + existing history.
3. Confirm AGY new chat + existing history.
4. Confirm Codex update from the Provider Runtime panel, then run a new Codex turn.
5. Confirm AGY update from the Provider Runtime panel, then run a new AGY turn.
6. Kill `node server.js` from Termux and verify the foreground service restores it.
7. Swipe Crew Pocket from recents and verify the foreground service remains active.
8. Reopen the APK and verify the same conversations remain available.

## Relevant files

- `android-wrapper/app/src/main/java/com/crewpocket/app/CrewRuntimeService.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/MainActivity.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/TermuxBridge.kt`
- `scripts/android-runtime-start.sh`
- `scripts/android-runtime-stop.sh`
- `scripts/update-provider.sh`
- `lib/runtime/provider-manager.js`
- `server.js`
- `public/js/auth.js`

## Future embedded work

Only revisit full provider embedding when it provides a concrete benefit over Termux and has a clean solution for:

- provider upgrades without rebuilding the APK;
- OAuth/keyring behavior;
- native dependencies;
- Git/shell/toolchain compatibility;
- rollback after a broken provider release.

Until then, Termux is the supported runtime boundary.
