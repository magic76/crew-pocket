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

Codex and AGY will be delivered by the companion APK. Updating those agents therefore updates Crew Runtime, not Crew Pocket. This keeps the UI APK stable while the executable runtime can ship on its own cadence.

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
5. Mark `READY=true` after device verification.
6. Remove the Termux permission/bridge from Crew Pocket once fallback is no longer needed.

The old experiments remain under `android-wrapper/experimental-runtime/` until their code has been migrated and verified.
