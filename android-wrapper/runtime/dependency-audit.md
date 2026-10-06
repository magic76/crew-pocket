# Companion runtime dependency audit

Inspected on 2026-10-06 for `feature/companion-runtime`, Dev packages on Samsung
SM-S938B / Android 16. Runtime ports are 8100 (server), 8867 (Codex bridge), and
8868 (status). Dev disables Termux fallback.

## Provided by the Runtime APK

| Dependency | Delivery and current evidence |
| --- | --- |
| Node | `libnode_exec.so`, launched by absolute installer-owned path. `/healthz` returns 204. |
| Codex | `libcodex_exec.so`, spawned by the Android bridge. Device Auth and a real `gpt-6.1-sol` task returned `CODEX_RUNTIME_OK` with `status=completed`. |
| Code-mode host | Packaged as `libcode_mode_host.so`; the preparer adapts Codex's fixed sibling filename with an equal-length substitution. Previously `CODEX_CODE_MODE_HOST_PATH` was ignored. A real `functions.exec` cell now returns `42`. |
| Bash | `libbash_exec.so` and its rewritten native dependencies are bundled with Node. `.crew-pocket/bin/bash` is a symlink to the installer-owned ELF. Codex's `df -h /data` tool call completed with exit code 0. |
| AGY | `libagy_exec.so`, launched by absolute path. The current local payload is 1.2.16; the earlier CI payload was 1.2.17. `--version` executes; an authenticated task remains unverified. |
| Native libraries | Generated JNI payload includes its dependencies. `LD_LIBRARY_PATH` points only to Runtime's nativeLibraryDir. |
| Server and UI | APK workspace assets copied to Runtime's app-private workspace. The revision marker includes the APK update timestamp, so same-version Dev reinstall refreshes source files without deleting unrelated workspace data. |
| Provider data | Runtime-private `HOME`, `.codex`, `.gemini`, media and workspaces; Stable/Termux credentials are not implicitly shared. |
| CA bundle | Generated from Android's default X509 trust managers into `.crew-pocket/ca-certificates.pem`; native clients receive an absolute PEM path. |

## Provided by Android

| Dependency | Evidence / boundary |
| --- | --- |
| ELF loader | Codex and helper request `/system/bin/linker64`. |
| Bionic libraries | Codex needs `libdl.so`, `libm.so`, `libc.so`; helper additionally needs `liblog.so`. These are Android system libraries. |
| Shell | Android supplies `/system/bin/sh`; companion shell snippets currently use this POSIX shell. Codex uses the separately bundled Bash. |
| System commands | PATH contains Runtime's private executable aliases followed by Android system directories. `df` is supplied by Android; its real Codex tool call passed. |

## Remaining dependencies and gaps

| Feature | Dependency / current result |
| --- | --- |
| Python snippets | `lib/sandbox.js` spawns `python3`; no Python payload is supplied. |
| JavaScript snippets | The private `node` alias now targets the bundled ELF. `/api/run-code` executed `console.log(19 + 23)` and returned `42`, exit code 0. |
| Image thumbnails | `server.js` and `lib/storage.js` invoke `magick`; ImageMagick is not bundled. The image route falls back to the original file. |
| Browser extension ZIP export | `server.js` invokes `python3`; archive regeneration is not supported by the bundled dependencies. |
| ADB UI routes | `server.js` invokes `adb`; companion does not bundle it. Wireless Debugging tests were performed using Termux's external ADB tool, not Runtime's PATH. |
| Remote access restart | `scheduleCrewRuntimeRestart()` spawns Bash and a Termux startup script. Companion needs an Android service restart path for this route. |
| Provider updater | Termux updater invokes Bash/npm. Companion provider-manager explicitly rejects this route and requests a Runtime APK update instead. |
| Jev | CLI is absent and no API key is configured in Dev. `/api/auth/status` reports this accurately. |
| AGY auth | Dev's OAuth token is absent. This prevents the real AGY task gate. |

Fallback literals such as `/data/data/com.termux/files/home` remain in shared JS
for Stable operation. The companion overrides HOME, CODEX_HOME, brain paths,
workspace roots and native provider commands. The remaining feature-specific
executables above mean successful Codex chat does not yet certify every Pocket
feature as Termux independent.

Companion Node and Codex share the same sandbox, so provider dispatch now keeps
the validated conversation cwd rather than remapping it to a nonexistent
`workspaces/agy-web`. Codex's native default shell can still fall back to the
nonexistent `/bin/sh`; the companion tool environment instructs command calls
to select `shell: "bash", login: false`. This is part of the tested command flow.
Bash retains optional compiled-in Termux configuration-file locations, but its
required ELF dependencies are installer-owned files or Android system libraries;
the tested flow does not load Termux HOME, PATH, binaries or libraries.

Do not mark the complete runtime verified until code-mode tools and an
authenticated AGY task pass on the companion, followed by the Pocket user flow.
