# Crew Runtime companion

This module is the migration target for removing Crew Pocket's production dependency on Termux.

## Boundary

- `com.crewpocket.app` owns UI, WebView, conversations, notifications, and runtime selection.
- `com.crewpocket.runtime` owns the local executable runtime.
- The apps communicate through a small versioned contract instead of sharing implementation details.
- Crew Pocket must depend on the runtime **protocol**, not a Codex or AGY version.

The companion currently exposes a loopback status contract on `127.0.0.1:8768/status`.
It deliberately declares `com.crewpocket.runtime.READY=false`, so production continues to use the existing Termux fallback until the embedded host is complete.

## Update model

Codex and AGY are executable runtime payloads delivered by the companion APK. They are intentionally **not** downloaded and executed from writable app storage: Android 10+ blocks executing binaries from the writable app home, and Google Play does not allow Play-distributed apps to fetch native executable code from outside Play.

Provider upgrades therefore happen by updating **Crew Runtime**, not Crew Pocket. Crew Pocket only depends on the versioned runtime protocol, so its UI release cadence stays independent from Codex / AGY changes.

The web UI reports the installed provider versions and, when the companion runtime is active, routes the update action to the Crew Runtime app listing instead of trying to overwrite provider binaries in place.

The runtime status contract reports:

- protocol version
- runtime APK version
- provider delivery/version/state
- host readiness

Crew Pocket only switches to the companion when the declared runtime is ready and the protocol is compatible.

## Migration sequence

1. Establish the companion contract and independent build artifact.
2. Move the archived Embedded Node host and workspace manager into this module.
3. Move the archived Codex bridge and AGY runtime into this module.
4. Package provider native dependencies in Crew Runtime and report their actual versions.
5. Publish/update Crew Runtime independently from Crew Pocket.
6. Mark `READY=true` after device verification.
7. Remove the Termux permission/bridge from Crew Pocket once fallback is no longer needed.

The old experiments remain under `android-wrapper/experimental-runtime/` until their code has been migrated and verified.


## Packaging a runnable local Runtime APK

The checked-in companion builds as a safe shell in CI. Provider binaries are deliberately not committed.

For a device build, prepare the runtime payloads first:

```bash
bash android-wrapper/runtime/scripts/prepare-embedded-node.sh
bash android-wrapper/runtime/scripts/prepare-embedded-codex.sh
bash android-wrapper/runtime/scripts/prepare-embedded-agy.sh
gradle -p android-wrapper :runtime:assembleDebug
```

These are developer packaging helpers only. End users do not need Termux. The resulting Crew Runtime APK owns Node, Codex, AGY, auth state, and the localhost host.

At build time the module packages the current `server.js`, `lib/`, `public/`, `extensions/`, and supporting scripts into the Runtime APK. It does not download Crew source from GitHub at runtime.

When Node, Codex, the Codex version manifest, and AGY payloads are present, the manifest advertises `READY=true`; Crew Pocket can then select the companion automatically. Otherwise Pocket keeps the migration fallback.

Do not add an in-app native-binary downloader as an update mechanism. If Codex or another executable provider needs a new native build, ship a new Crew Runtime version through the normal app update channel.
