# Companion runtime dependency audit

Inspected on 2026-10-06 for `feature/companion-runtime`, Dev packages on Samsung
SM-S938B / Android 16. Runtime ports are 8100 (server), 8867 (Codex bridge), and
8868 (status). Dev disables Termux fallback.

## GitHub CLI delivery (2026-10-06)

Runtime Dev bundles Android ARM64 GitHub CLI 2.102.0 from a SHA256-pinned package.
`gh` resolves into Runtime's installer-owned nativeLibraryDir. Its ELF interpreter
is `/system/bin/linker64`; DT_NEEDED includes only liblog, libdl and libc. Credentials
use Runtime's private `.config/gh`, not Termux HOME. SSH and browser launch helpers
are not bundled; device authorization can be completed manually in the phone browser.

Device checks passed: actual Runtime `gh --version`, `gh auth login --help`, PTY
version execution, and HTTPS to GitHub API (an intentionally invalid probe token
received HTTP 401, confirming network/TLS rather than account authorization).
`gh auth status` correctly reports not logged in. User OAuth login and authenticated
repo access remain for the user to authorize; no real credentials were copied.

The credential integration probe found a real runtime dependency: Git's compiled
SHELL_PATH still pointed to `/data/data/com.termux/files/usr/bin/sh`, so `!` helpers
failed with `fatal: cannot exec ...: No such file or directory`. The packager now
relocates that NUL-terminated C string to `/system/bin/sh` without changing ELF
offsets. After rebuilding/installing Runtime Dev, both a harmless shell credential
helper and `!gh auth git-credential` returned credentials with exit 0 using synthetic
probe data only. Runtime status remained running and Node health returned 204.
See toolchain README for a PATH-based Git helper that survives APK native directory changes.

## Agent APK build delivery (2026-10-06)

On Samsung SM-S938B / Android 16, Runtime Dev now provides OpenJDK 21.0.12,
Gradle 9.8.0, ARM64 AAPT/AAPT2/AIDL/zipalign, apksigner, SDK platform 35 and
build-tools 34 Java resources. Build tools use private HOME/JAVA_HOME/SDK/Gradle
cache; Termux paths are only development/package sources.

Actual gate: a new Java Android Activity project was created under Runtime HOME.
`crew-build` downloaded its Android Gradle plugin dependencies into Runtime's
private cache and completed all 31 Gradle tasks in 42.9 seconds. The APK contained
AndroidManifest.xml and classes.dex; Runtime apksigner verified its APK v2
signature and Runtime zipalign returned 0. Artifact download returned matching
SHA256. A second request went through Dev `/api/chat` to Codex `gpt-6-sol`:
Agent edited the Activity text and ran `crew-build . --offline assembleDebug`.
The build completed in 12.1 seconds and the Agent turn completed in 37.6 seconds,
with three executions and one changed file.

Agent-produced artifact: build `509b4867-5857-4d1f-813a-2c2e98042bb2`,
7375 bytes, SHA256 `b52f825cdf628167db71b1e5ee5f84c57bdedbc3001216966311af8d035d7f12`.
The proof conversation is `01a10fdc-40ef-7770-b6f8-76df4eef3ec4`.

First Java failure was `could not find libjava.so`: the installer owns ELF files
in a flat native directory. A Java-only launcher/path adapter exposes the private
logical JDK layout to JLI and HotSpot, while every executable remains APK-owned.
Javac and Java child processes then executed successfully. Android-generated
PKCS12 exported certificates lacked OpenJDK trusted-certificate attributes;
OpenJDK saw zero entries. Runtime now exports certificate-only JKS data; keytool
reads all 143 Android roots and Gradle dependency downloads succeed.

`crew-build` retains per-build logs, reports and APK copies in private HOME,
with authenticated `/api/build-artifacts/<id>/<filename>` downloads. Projects,
authentication data and signing keys are outside the immutable payload directory.
The Java/Gradle payload is used on demand and Gradle runs without a persistent
build daemon. A basic PTY terminal is also available; it is secondary to Agent
execution.

Scope: the actual proof covers Java APK builds with AGP 8.6.1 / SDK35. NDK/C/C++,
Flutter, arbitrary SDK versions and Kotlin projects are not yet certified.
Legacy SDK dexdump/split-select inspection entries return explicit unsupported
errors; they are not certified tools. Runtime ADB still requires separate pairing.
AGY authentication and the complete Termux-shutdown gate remain pending.

## Toolchain delivery update (2026-10-06)

Python, Git, npm, ripgrep, ImageMagick, ADB and a Crew Jev CLI adapter are now
bundled in Runtime Dev. The earlier missing-tool tables below are historical.
All checks in this section ran through Dev's `/api/run-code` on port 8100, with
Runtime-private HOME/PATH/data and APK-owned native executables. `/healthz` is 204.

| Tool | Actual device result |
| --- | --- |
| Python 3.14.6 | PASS: ssl, sqlite3, ctypes, zlib, bz2, lzma, hashlib imports; SQLite returned 42; compression roundtrip passed. `ctypes.CDLL("libsqlite3.so")` and multiprocessing semaphore passed. Android CA bundle supplied 143 trusted certificates. |
| Git 2.56.0 | PASS: temporary repository init/add/commit/log; HTTPS `ls-remote` returned remote HEAD; empty submodule status passed. Fixtures removed. SSH/Perl extensions are not included. |
| npm 11.20.0 | PASS: a package script invoked bundled Node and returned 42; installed `is-number@7.0.0` from the public registry and loaded it successfully. JS packages are supported; native addons/compilation and arbitrary app-data shebang executables are not certified. |
| ripgrep 15.2.0 | PASS: searched a private temporary file and returned its matching text. |
| ImageMagick 7.1.2-32 | PASS: created PNG, converted to JPEG, identified both; rendered DejaVu font text. External Ghostscript/Graphviz delegates are not registered commands. |
| ADB 37.0.0 | PASS: version and private daemon startup/devices on 5038. Private device list was empty; Runtime keys require separate Wireless Debugging pairing. Test daemon was stopped; development connection on Termux port 5037 stayed online. Stable Runtime reserves 5039. |
| Jev adapter 1.0.0 | CLI PASS: version/help execute; compatible `ask` invocation correctly exits 3 when TypeSafe key is absent. Authenticated model request NOT VERIFIED. This is a repository-owned adapter to the official API, not a renamed community CLI. |

Packaging now has one registry (`toolchain/tools.json`), a package version/hash
lock, recursive ELF closure, native command aliases, script launchers, and
private data/module extraction. JNI contains 238 tool ELF files plus the native
script launcher; package provenance covers 102 Android packages including license
data. Libraries rewrite DT_NEEDED and SONAME consistently. LD_LIBRARY_PATH uses
only Runtime's native directory and private toolchain/lib aliases. Nothing in the
tested command chain executes a Termux binary or reads Termux HOME.

First actual failure: Python `ctypes` called `dlopen("libpython3.14.so")` after its
APK relocation. Fix: update the packaged Python LDLIBRARY metadata and provide
private logical library aliases. Preserving the old SONAME instead was invalid
on Android (`cannot find ... from verneed ... in DT_NEEDED list`); dependency and
SONAME rewrites must agree. Both conditions are handled in the packager.

Further useful-command checks exposed shared packaging issues:

- AAPT omitted underscore directories, dropping Python `compression._common` and
  npm `@sigstore/protobuf-specs/dist/__generated__/envelope`. Runtime now configures
  asset filtering explicitly and CI compares every staged asset/module and JNI
  entry against the APK (including AAPT's verified gzip expansion).
- Python shell subprocesses still named the Termux shell; standard-library
  defaults now select Android/private paths, and ctypes library discovery prefers
  bundled native aliases. Frozen `os.defpath` is corrected through sitecustomize.
  Actual shell execution returned Node v26.4.0, ctypes lookup/load passed, MIME
  detection returned text/html, and default PATH was /system/bin. Package-manager-only
  Python helpers are excluded.
- Named semaphore support contained a compiled temporary path. The vendored
  MIT implementation now uses private TMPDIR; the actual semaphore check passed.
- Git needs sourced shell files in addition to executable helpers; both are aliased.
- Fontconfig's compiled Termux directories are replaced with private fonts/cache.

The full original Pocket/AGY/Termux-shutdown gate remains pending. This toolchain
update does not certify an authenticated AGY task or a complete Termux shutdown.
Expansion steps and limits: [Toolchain guide](toolchain/README.md).

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
| Shell | Android supplies `/system/bin/sh`. On this Samsung device `/bin` is a symlink to `/system/bin`, so `/bin/sh` also exists. Bash snippets use bundled Bash; POSIX snippets use system `sh`. Codex's default shell and explicitly selected Bash both executed real commands. |
| System commands | PATH contains Runtime's private executable aliases followed by Android system directories. `df` is supplied by Android; its real Codex tool call passed. |

## Original review dependencies and gaps (before toolchain delivery)

| Feature | Dependency / current result |
| --- | --- |
| Python snippets | No Python payload. The endpoint returns HTTP 409 with `RUNTIME_DEPENDENCY_UNAVAILABLE` before creating a scratch file. |
| JavaScript snippets | The private `node` alias now targets the bundled ELF. `/api/run-code` executed `console.log(19 + 23)` and returned `42`, exit code 0. |
| Image thumbnails | `server.js` and `lib/storage.js` invoke `magick`; ImageMagick is not bundled. The image route falls back to the original file. |
| Browser extension ZIP export | Requires Python; missing dependency returns 409. Regeneration now uses argument-based `execFile`, and failures are no longer swallowed as successful exports. |
| ADB UI routes | ADB is absent. Status reports `available:false`; update returns 409 without writing pairing configuration. External Wireless Debugging installation used Termux ADB as a development tool, not Runtime's PATH. |
| Remote access restart | Companion POST returns 409 before changing configuration or exiting Node. Stable's restart script injects Termux PATH and starts port 8000, so invoking it from Dev was unsafe. Native companion remote access remains unsupported. |
| Provider updater | Termux updater invokes Bash/npm. Companion provider-manager explicitly rejects this route and requests a Runtime APK update instead. |
| Git/npm/rg/Jev | Not bundled and absent from Runtime PATH. Jev additionally has no API key in Dev. Native Codex and AGY are launched by absolute paths, not by bare names on PATH. |
| AGY auth | Dev's OAuth token is absent. This prevents the real AGY task gate. |

Fallback literals such as `/data/data/com.termux/files/home` remain in shared JS
for Stable operation. The companion overrides HOME, CODEX_HOME, brain paths,
workspace roots and native provider commands. The remaining feature-specific
executables above mean successful Codex chat does not yet certify every Pocket
feature as Termux independent.

Companion Node and Codex share the same sandbox, so provider dispatch now keeps
the validated conversation cwd rather than remapping it to a nonexistent
`workspaces/agy-web`. The earlier assumption that this phone lacks `/bin/sh`
was incorrect: it exists through Android's `/bin` symlink. A real diagnostic
omitting the shell argument succeeded. Explicit Bash selection is appropriate
for Bash syntax, not evidence that the native default is broken.
Bash retains optional compiled-in Termux configuration-file locations, but its
required ELF dependencies are installer-owned files or Android system libraries;
the tested flow does not load Termux HOME, PATH, binaries or libraries.

Do not mark the complete runtime verified until code-mode tools and an
authenticated AGY task pass on the companion, followed by the Pocket user flow.

## Full review findings and fixes

Reviewed Android bootstrap, native payload preparation, provider transports,
thread start/resume, HTTP command dispatch, dependency lookup, private HOME/cwd,
source refresh, status, and restart paths. Every `spawn`, `execFile`, `execSync`,
and `execFileSync` call in `server.js` and `lib/` was inventoried. Server/library
`require()` dependencies are built-in Node modules or local files; no external
Node package was found in these runtime entry points.

### Failures behind the reported `df` errors

The original conversation is `01a10cbb-35c4-70f1-8c98-3e83bf605e4b`.
Its recorded failures occurred before the latest source-refresh installation:

1. At `2026-10-06T00:44:07Z`, code-mode never reached `df`:
   `failed to spawn code-mode host .../codex-code-mode-host: No such file or directory (os error 2)`.
   Fixed by adapting the APK helper filename during payload preparation.
2. At `2026-10-06T00:50:20Z`, code-mode worked but command creation failed:
   `Failed to create unified exec process: No such file or directory (os error 2)`.
   The requested cwd was `.../files/workspaces/agy-web`, which does not exist.
   Shared-sandbox workspace remapping and stale same-version APK source were
   corrected in the preceding commit. This is not evidence that `df` is absent.

No newer failure from this original conversation appeared in the runtime log
during this review. Its history was not replaced or truncated. We forked it
through native `thread/fork` and tested the isolated copy instead.

### Additional bugs corrected in this review

| Finding | Fix / evidence |
| --- | --- |
| A six-worker bridge can deadlock: accept and two session handlers occupy three workers; one session's relays occupy the other three, leaving the second session's relays queued indefinitely. | Two admitted sessions, nine workers (one accept + four per session), immediate excess-client rejection, and socket cleanup on shutdown. Second authenticated connection initialized successfully while Pocket's connection stayed alive; the third received EOF immediately. |
| Failed snippet spawn emits both `error` and `close`, so both handlers tried to send HTTP responses. | Shared single-completion cleanup/response gate. Missing interpreters are rejected before spawn. |
| Bash snippets were actually run with POSIX `sh`. | Bash selects the bundled executable. A Bash-array calculation and `df` returned 42 and disk usage. Node snippets select `process.execPath`. |
| Codex runtime status still advertised `node:false` and outdated phase information. | Actual executable discovery feeds status and the provider's tool context. `/api/runtime/status` now lists executable paths, delivery, and missing dependencies with `discoveryOnly:true`. |
| Self-debug prompt promised a source-change supervisor that companion does not implement, and used conversation cwd as server-source cwd. | Prompt identifies the actual `workspaces/crew-host` path and explains that source changes require Pocket Restart with user approval. |
| Remote access restart could execute the Termux port-8000 startup script from Dev and terminate the companion Node server. | Unsupported companion mutation is rejected before writes or shutdown. `/healthz` still returns 204 after the rejected request. |
| ZIP export swallowed regeneration errors and interpolated paths into shell/Python code. | Explicit dependency check, separate process arguments, and propagated archive errors. |
| Workspace validation rejected valid Android path aliases yet admitted symlinks escaping HOME. | Validate real paths and directory ancestry by device/inode identity for Android bind-mount aliases; keep the user's original valid path. Existing-directory creation also validates its target. |
| Any embedded thread/resume error silently started a new thread, even a connection error. | Resume supplies current validated cwd; only recognized missing-thread errors permit a new thread. Other failures propagate without replacing the conversation. |
| `node --version` and script files passed, but `node -e` initialized OpenSSL and read its compiled-in Termux config path. | Reproduced `OpenSSL configuration error ... Permission denied ... fopen(/data/data/com.termux/files/usr/etc/tls/openssl.cnf, rb)`. Node and Codex process environments explicitly set `OPENSSL_CONF=/dev/null`; trusted CA configuration remains separate and unchanged. |

### Installed payload / environment evidence

All five installed native entry points matched the local payload SHA-256 hashes:
Node, Bash, Codex, code-mode host, and AGY. All packaged ELF `DT_NEEDED` entries
resolve to bundled libraries or Android system libraries; none were unresolved
in the dependency closure audit. Dynamic executables request
`/system/bin/linker64`; AGY has neither `PT_INTERP` nor `DT_NEEDED`.

Actual Node/Codex process environment uses Runtime-private HOME and CODEX_HOME,
private executable aliases plus Android system PATH, and nativeLibraryDir
for LD_LIBRARY_PATH in the original review (the tooling update adds private
toolchain/lib aliases). CA paths point to the private generated trust bundle.
OpenSSL uses explicit empty configuration rather than Termux's compiled-in path.
Build-time Termux/npm tools used to assemble payloads are not runtime dependencies.
This audit did not close Termux, because the debugging agent itself runs there;
process isolation evidence does not replace the still-pending shutdown user-flow gate.

### Verification after installing this review's Runtime Dev APK

| Gate | Result |
| --- | --- |
| Pocket starts companion through its normal activity | PASS; Dev activity cold launch, Runtime Node on 8100. Stable Pocket remains installed. A Stable Runtime package was not present in the current package listing. |
| `/status` | Protocol 1, delivery companion-apk, ready/payloadReady/companionEnabled true, hostState running, lastError null. Codex 0.160.0-termux.2 and AGY 1.2.16 bundled. |
| `/healthz` | 204 before and after tests. |
| Native code-mode and commands in fork of failed history | PASS: fork `01a10ebf-b803-7202-a450-1c15dc2540a3`, request `e657624d-d917-4451-b832-5d508023595f`; `text(19+23)` returned 42; omitted-shell command `df -h /data; node --version` exited 0 and returned disk usage plus v26.4.0. Turn completed in 9.8 seconds. Original transcript hash was unchanged across fork creation. |
| Node/Bash snippets | PASS: both returned 42, exit 0; Bash also returned actual disk usage. |
| Node eval / OpenSSL config | PASS after fix: resumed fork request `82276a31-bfee-4ee3-a9e1-c041ce60d865` executed `node -e "console.log(19+23)"` and `df`, exit 0. Final installed APK request `9867b1e6-1b2a-47a2-8ef7-8e59bb6ebfe4` independently returned code-mode 42, Node eval 42, and actual disk usage, exit 0. |
| Android workspace aliases / containment | PASS on final installed APK: HOME and nested workspaces via `/data/data` accepted; `/system` and a temporary in-HOME symlink to `/system` rejected. Temporary fixture removed. Final Codex task used `/data/data/com.crewpocket.runtime.dev/files/workspaces` successfully. |
| Local report links | Added an in-app reader for absolute file links, `file://`, and file line references. Report is included in Runtime assets and opens through `/api/file/read?source=app&path=android-wrapper/runtime/dependency-audit.md`. Dev WebView click opened rendered Markdown with five tables without navigating away; line 10 highlighted correctly. A Termux-private path displayed a readable 403 error, and a missing report returned 404. Temporary DOM fixture was removed; histories were untouched. |
| Missing Python/ADB/export capability | Expected HTTP 409 with explicit unsupported dependency; ADB status available false. No generic ENOENT loop. |
| Companion remote access | Expected 409, restarting false; Node stays healthy. |
| Bridge concurrency | PASS: second session initializes; third rejected promptly. |
| Codex authentication | Retained ChatGPT Plus authentication across APK update; no auth data copied from Termux. |
| AGY task | NOT VERIFIED: no Dev OAuth token. Version execution passes; authenticated agent request remains a gate. |
| Dev fallback | Disabled by design; no Termux fallback exercised or enabled. |
| Full WebView interaction, notification recovery, Termux shutdown | NOT REVALIDATED in this review. Activity launch and HTTP/provider flow are narrower checks. |

Final `/status` response:

```json
{
  "protocolVersion": 1,
  "runtimeVersion": "0.2.0-dev",
  "delivery": "companion-apk",
  "ready": true,
  "payloadReady": true,
  "companionEnabled": true,
  "hostState": "running",
  "lastError": null,
  "providers": {
    "codex": {"delivery": "runtime-apk", "version": "0.160.0-termux.2", "state": "bundled"},
    "antigravity": {"delivery": "runtime-apk", "version": "1.2.16", "state": "bundled"}
  }
}
```

Final `/healthz`: HTTP 204, empty body.

### Remaining work / boundaries

Python, Git, npm, rg, ImageMagick, ADB and Jev now have explicit APK delivery.
The new checks above supersede their earlier missing-tool results. Full Pocket
thumbnail/export user flows still need their own interaction gates. Companion remote access needs a
native restart/bind design. Native default shell availability differs by Android
device; this Samsung result cannot certify every manufacturer. Status payload
readiness and task completion are not proof of every tool succeeding.

The runtime must not be labelled `Termux-independent runtime verified` until AGY
authentication/task execution and the full Pocket/Termux-shutdown flow also pass.

## Native Android build payload (2026-10-06)

Added pinned Gradle 8.13 alongside existing Gradle 9.8, official SDK Platform 36
and Build Tools 35.0.0 alongside 35/34, Android ARM64 NDK r28c
(28.2.13676358), CMake 3.22.1 and Ninja. Registry and archive locks are under
`toolchain/`; upstream checksum verification runs before extraction.

NDK host executables are statically linked ARM64 Android binaries from
HomuHomu833/android-ndk-custom; CMake/Ninja are Android binaries from
MrIkso/AndroidIDE-NDK. Their source archives, revisions and SHA256 are recorded in
`native-build.lock.json` and the generated manifest. The `linux-x86_64` NDK host
folder is an AGP-compatible layout name, not the binary architecture.
Cross-compilation sysroot libraries stay in private assets without ELF rewriting.
Only host executables are relocated to installer-owned JNI entries.

Pre-install checks on the development phone:

- Gradle 8.13 launcher loaded successfully with JDK21.
- Flattening CMake into a JNI-like directory first reproduced `Could not find
  CMAKE_ROOT`. The native launcher/path adapter restored its logical module path;
  `--system-information` then reported the correct `share/cmake-3.22` directory.
- Flattened NDK Clang invoked through the native launcher compiled and linked a
  C++17 ARM64 Android shared library using `<vector>` and `<android/log.h>`.
  `DT_NEEDED` included `libc++_shared.so`, libc, libm and libdl.
- Runtime Dev APK built successfully. These checks ran under the development
  Termux UID; they are not proof of execution under the Runtime app UID.

Wireless ADB was initially offline and the required install script refused
installation. After reconnection and explicit approval to interrupt the Dev
Terminal, installation and the Runtime UID build succeeded as recorded below.

New Terminal sessions start at Runtime HOME. Opening Terminal no longer creates
`~/projects`; existing terminal sessions are left alone.

The isolated `crew-teacher` checkout subsequently completed `assembleDebug` in
27 seconds with Gradle8.13, AGP8.11.1, SDK36, NDK r28c and CMake3.22.1/Ninja.
CMake identified both compilers as Clang19, and the signed APK includes
`lib/arm64-v8a/libcrewaudio.so`. This is a development UID
integration check using the packaged tool layout, not Runtime UID certification.
The integration also caught CMake resolving the launcher symlink instead of the
actual tool; the path adapter now preserves its logical argv[0] path. Gradle now
passes the SDK alias for APK-owned AAPT2 as a project property, preventing a
legacy global/project Termux AAPT2 path from taking precedence.

### Installed Runtime UID verification

On Samsung SM-S938B, Android 16, the required `~/install-apk.sh` installed the
Runtime Dev APK successfully. The APK SHA256 was
`aa630ca62e407c88bdf5852f673fe3ffea47f1940627f59055446ca9f560658b`;
its signing certificate matched Dev Pocket. Stable Pocket remained installed.
Dev Pocket normally started the companion through its signature permission.

Commands launched through Dev server `/api/run-code` ran as Runtime UID 10608:

- HOME: `/data/user/0/com.crewpocket.runtime.dev/files`.
- PATH: Runtime HOME `/.crew-pocket/bin`, `/system/bin`, `/system/xbin`,
  `/product/bin`; no Termux directory.
- Node: installer-owned Runtime Dev `lib/arm64/libnode_exec.so`.
- Gradle 8.13 selected for `crew-teacher`; explicit Gradle 9.8.0 also exited 0.
- CMake 3.22.1, Ninja 1.11.1 and Clang 19.0.0 each executed successfully.
- Java, SDK and NDK paths were under Runtime HOME `/.crew-pocket/toolchain`.
- Status on 8868 reported `ready`, `payloadReady`, `companionEnabled` true,
  `hostState: running`, `lastError: null`; providers were bundled Codex
  `0.160.0-termux.3` and Antigravity `1.2.16`.
- Dev Node `/healthz` on 8100 returned HTTP 204.

The project fetches Oboe in CI rather than through a Git submodule. Its missing
ignored `third_party/oboe` directory was populated with bundled Git using the
same tag 1.9.3 (commit `b15f5e39c01a7ada306d959e5129620b145fb8b4`).
The checkout retains a debug `.dev` application ID/version suffix modification;
the native build also generates untracked `app/.cxx/` data. These project files
were not reverted or committed during verification.

Bundled `crew-build ~/crew-teacher --max-workers=2 assembleDebug` then completed
under the Runtime UID with `CMAKE_BUILD_PARALLEL_LEVEL=2`, exit 0, duration
56,575 ms. Gradle reported 35 executed tasks and `BUILD SUCCESSFUL in 55s`,
including ARM64 CMake configuration, compilation, native library merge and APK
packaging. Report ID: `eab4ca38-981b-40bc-995b-75bd452e798a`.

The output APK was downloaded successfully through Dev Node's
`/api/build-artifacts/eab4ca38-981b-40bc-995b-75bd452e798a/1-app-debug.apk`:

- Size: 4,358,294 bytes.
- SHA256: `c409318754c85f90d166940e559a9633cd0f5fe48230bc4d3fe165a6cf2326c0`.
- Contains `lib/arm64-v8a/libcrewaudio.so` (AArch64).
- Native `DT_NEEDED`: liblog.so, libOpenSLES.so, libm.so, libdl.so, libc.so;
  all Android system libraries. This project links its C++ runtime statically.
- Teacher APK was built and downloaded, not installed.

The native Android build pipeline is verified under the Runtime app UID. This
does not supersede the separate AGY authentication/task and full Pocket shutdown
verification gates above.
