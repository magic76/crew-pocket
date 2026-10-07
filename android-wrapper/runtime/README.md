# Crew Runtime companion

## Parallel Dev stack

Android debug builds are intentionally installable alongside the existing stable setup so Runtime migration work does not disrupt the daily-use app:

| Build | Pocket package | Runtime package | Crew server | Codex bridge | Runtime status |
| --- | --- | --- | ---: | ---: | ---: |
| Stable / release | `com.crewpocket.app` | `com.crewpocket.runtime` | 8000 | 8767 | 8768 |
| Debug / Dev | `com.crewpocket.app.dev` | `com.crewpocket.runtime.dev` | 8100 | 8867 | 8868 |

The debug apps are labeled **Crew Pocket Dev** and **Crew Runtime Dev**. The Dev Pocket only talks to the Dev Runtime and does not fall back to the stable Termux host; this prevents a broken Dev runtime from accidentally appearing healthy by connecting to the user's daily-use server.

Pocket and Runtime in each stack must be signed with a compatible certificate because Runtime control uses a signature-level permission. The Dev stack uses its own `com.crewpocket.permission.CONTROL_RUNTIME_DEV` permission so it cannot cross-control the stable Runtime.


This module is the migration target for removing Crew Pocket's production dependency on Termux.

## Boundary

- `com.crewpocket.app` owns UI, WebView, conversations, notifications, and runtime selection.
- `com.crewpocket.runtime` owns the local executable runtime.
- The apps communicate through a small versioned contract instead of sharing implementation details.
- Crew Pocket must depend on the runtime **protocol**, not a Codex or AGY version.

The companion exposes a loopback status contract on `127.0.0.1:8768/status`.
Runtime activation is deliberately separate from payload packaging: a build can contain all providers while still declaring `com.crewpocket.runtime.READY=false`. Production keeps the Termux fallback until the companion has passed device verification and the release build explicitly enables it.

## Update model

Codex and AGY are executable runtime payloads delivered by the companion APK. They are intentionally **not** downloaded and executed from writable app storage: Android 10+ blocks executing binaries from the writable app home, and Google Play does not allow Play-distributed apps to fetch native executable code from outside Play.

Provider upgrades therefore happen by updating **Crew Runtime**, not Crew Pocket. Crew Pocket only depends on the versioned runtime protocol, so its UI release cadence stays independent from Codex / AGY changes.

The web UI reports the installed provider versions and, when the companion runtime is active, routes the update action to the Crew Runtime app listing instead of trying to overwrite provider binaries in place.

The runtime status contract reports:

- protocol version
- runtime APK version
- provider delivery/version/state
- host readiness

### Signing requirement

Crew Pocket controls the companion service through the signature-level permission `com.crewpocket.permission.CONTROL_RUNTIME`. Release builds of `com.crewpocket.app` and `com.crewpocket.runtime` must therefore be signed by the same certificate. If both apps are distributed through Google Play, configure Play App Signing so they keep a shared signing identity; otherwise Pocket will see the Runtime package but Android will reject service control.

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

Provider binaries are generated during packaging and are not committed to the repository.

Codex 0.160 discovers its code-mode helper by a fixed sibling filename; it does
not recognize `CODEX_CODE_MODE_HOST_PATH`. During packaging,
`patch-codex-helper-name.js` changes the embedded `codex-code-mode-host` filename
to the equal-length `libcode_mode_host.so`. This preserves ELF offsets and Rust
string lengths and matches Android's extracted native library filename. The
preparer fails if it cannot recognize that layout, so new Codex layouts require
inspection rather than silently shipping a missing helper.

The runtime exports Android's trusted CA certificates to an app-private PEM
bundle and passes it through `SSL_CERT_FILE` and `CODEX_CA_CERTIFICATE`. Native
Codex WebSocket requests otherwise fail with `UnknownIssuer` on the tested
Android device even when its HTTPS login succeeds.

See [the companion dependency audit](dependency-audit.md) for remaining tooling
that is not supplied by the companion APK.

### CI / cross-architecture packaging

A normal Linux GitHub runner can prepare the Android ARM64 payloads without Termux:

```bash
# Downloads ARM64 Node, Bash and dependencies and repackages them for the APK.
bash android-wrapper/runtime/scripts/fetch-termux-node-payload.sh

# Downloads the current Android Codex npm tarball, including codex-code-mode-host.
bash android-wrapper/runtime/scripts/fetch-codex-payload.sh

# Downloads the latest official Antigravity release, verifies its GitHub SHA-256
# digest, and only accepts an ARM64 ELF that is directly Android-compatible.
bash android-wrapper/runtime/scripts/fetch-official-agy-payload.sh
```

Node and Bash have app-private PATH aliases pointing to their installer-owned
ELF files. The companion provider preserves the validated conversation cwd and
instructs command tools to use the bundled Bash rather than Codex's native
`/bin/sh` fallback, which does not exist on Android.

Antigravity CLI 1.2.15 release notes added native Android/Termux support. Current releases expose the ARM64-compatible build through the musl archive rather than a separately named Android asset. The official fetcher therefore prefers an Android-named asset if one appears in a future release, then the ARM64 musl archive, and only falls back to the regular Linux ARM64 archive for inspection. It still validates the ELF loader/dependencies and refuses glibc or other non-Android binaries instead of trusting the asset name.

The Android workflow packages Node and Codex automatically and probes the official AGY release. If the AGY probe does not find a directly runnable Android ELF, the build still completes but the companion remains disabled.

### Verified AGY bundle fallback

For an AGY build that needs an additional compatibility launcher or support files, use a pre-verified bundle:

```text
verified-android-agy-bundle/
├── manifest.json
├── jniLibs/
│   └── arm64-v8a/
│       ├── lib<launcher>.so
│       └── lib<support>.so ...
└── files/                 # optional non-executable support data
```

```bash
AGY_ANDROID_BUNDLE_DIR=/path/to/verified-android-agy-bundle \
  bash android-wrapper/runtime/scripts/prepare-embedded-agy.sh
```

The manifest must use `"type": "native-command"`, include a version, and provide a command array whose first item is an APK-owned executable under `${NATIVE_DIR}`. Additional command arguments may reference `${NATIVE_DIR}`, `${AGY_DIR}`, `${FILES_DIR}`, or `${CACHE_DIR}`.

Legacy Node-script AGY payloads remain supported by `prepare-embedded-agy.sh`, but they are no longer the primary distribution model.

### Activation gate

Packaging and activation are separate:

- `BuildConfig.PAYLOAD_READY` means Node, Codex, the Codex code-mode host, provider metadata, and AGY passed build-time payload checks.
- `BuildConfig.COMPANION_ENABLED` is controlled by `CREW_RUNTIME_ENABLE_COMPANION=true`.
- The manifest advertises `READY=true` only when **both** are true.

For a manually verified debug build:

```bash
CREW_RUNTIME_ENABLE_COMPANION=true \
  gradle -p android-wrapper :runtime:assembleDebug
```

The feature-branch CI may enable the companion for its test artifact when all payload probes pass. Main/release builds remain disabled until device verification is explicitly complete.

These are developer packaging helpers only. End users do not need Termux. The resulting Crew Runtime APK owns Node, Codex, AGY, auth state, and the localhost host.

At build time the module packages the current `server.js`, `lib/`, `public/`, `extensions/`, and supporting scripts into the Runtime APK. It does not download Crew source from GitHub at runtime.

Do not add an in-app native-binary downloader as an update mechanism. Executable provider upgrades ship as a new Crew Runtime version through the normal app update channel.
