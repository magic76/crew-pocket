# Android signing inventory

Verified 2026-10-06 on SM-S938B / Android16; key copy updated 2026-10-07. This document contains public
certificate fingerprints and file locations only. Keystore passwords and private
keys are not stored here or committed.

## Current Crew Helper update key

Package: `com.crewpocket.helper`.

Canonical existing key file (Termux private HOME):
`/data/data/com.termux/files/home/.local/share/crew-helper/keys/CrewHelper-release.keystore`

Alias: `crew`. Certificate SHA256:
`fdf3c9351b55a2dfb403d7892ec933acdf5850aa18f22d18bf85e9155cec3db7`

This certificate matches installed Helper1.8.104 and the signed1.8.105 CI APK
from main a5a8b63, versionCode142. Use this key to prepare updates for the
currently installed Helper. The name of a keystore file alone does not establish
compatibility: compare the certificate with the installed APK before signing.

## Other keys (different certificates)

| Key file | Alias | Certificate SHA256 |
| --- | --- | --- |
| Termux `~/.local/share/crew-helper/keys/CrewHelper-test.keystore` | test | `261ba37311cd807d351907757187d961573ec11e9a2b1cd9dc536621c460c972` |
| Termux `~/.local/share/crew-helper/keys/CrewHelper-project-test.keystore` | crewhelper | `8edf07a07f868b790f5a371583320ce36eb93f2303544157525f45b956075c73` |
| Termux `~/crew-helper/test.keystore` | crewhelper | `89b1d1ae27331b174f0c381d3462be39f7a65ba8fdc6f35aaaa50974b4bf7b63` |
| Termux `~/.android/debug.keystore` | androiddebugkey | `21adcee5760d5614aa136cb32bdb3b1ebe013cf958526e8843310e5949caa2d8` |
| Runtime Dev `~/.android/debug.keystore` | androiddebugkey | `30c7618dc1816235e0f337e57eadd9ce3fca1198bb82c7ea94b0d6b1a8e20721` |

The Termux debug certificate signs the installed Pocket Dev / Runtime Dev pair.
Runtime's generated debug certificate is different and cannot update the
currently installed Helper. The test keystores also differ from the Helper
release key. They have not been renamed, moved or deleted by this inventory.

## Two different HOME directories

- Termux HOME: `/data/data/com.termux/files/home`.
- Runtime Dev HOME: `/data/user/0/com.crewpocket.runtime.dev/files`.

Identical relative filenames in these directories refer to different files.
Runtime Dev cannot directly read Termux's private release keystore. The initial
CI APK updates were signed in Termux. On 2026-10-07 the user explicitly requested
copying the key to Dev, and a matching copy was placed at:
`/data/user/0/com.crewpocket.runtime.dev/files/crew-helper/.signing/CrewHelper-release.keystore`.

The `.signing` directory is mode0700 and the key mode0600. The project's local
`.git/info/exclude` includes `/.signing/`; `git check-ignore` passed and the
checkout remained clean. Runtime keytool verified alias `crew` and the current
Helper update certificate above. No private key was committed. The original
Termux key remains in its canonical location. For the project's lightweight
build script, `CREW_HELPER_KEYSTORE` can point at this Runtime copy; Gradle/CI
signing still requires explicit project configuration.

## Other credentials are separate

- `.android/adbkey` / `adbkey.pub`: Wireless ADB identity, not APK signing.
- Runtime `.crew-pocket/java-truststore.jks`: HTTPS trust store, not APK signing.
- Codex / AGY authentication: provider login credentials, not APK signing.
- A signed APK contains public certificates, not its signing private key.

## Helper 1.8.105 delivery

- Termux Downloads:
  `/data/data/com.termux/files/home/storage/downloads/CrewHelper-v1.8.105.apk`.
- Runtime Dev signed artifact:
  `/data/user/0/com.crewpocket.runtime.dev/files/.crew-pocket/crew-helper-ci-a5a8b63/CrewHelper-Release-APK/CrewHelper-v1.8.105.apk`.
- The adjacent `app-release-unsigned.apk` is the original CI output.
- Verified package `com.crewpocket.helper`, versionCode142, versionName1.8.105;
  `apksigner verify` passes with the current Helper update certificate above.

Future Dev requests can refer to `.crew-pocket/signing-inventory.md` in Runtime
HOME and use the project-local release key copy above. Always compare the signer
with the installed APK before updating. Public certificate information may be
committed; private keys must remain excluded.
