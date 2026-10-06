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
| Shell | Android supplies `/system/bin/sh`. On this Samsung device `/bin` is a symlink to `/system/bin`, so `/bin/sh` also exists. Bash snippets use bundled Bash; POSIX snippets use system `sh`. Codex's default shell and explicitly selected Bash both executed real commands. |
| System commands | PATH contains Runtime's private executable aliases followed by Android system directories. `df` is supplied by Android; its real Codex tool call passed. |

## Remaining dependencies and gaps

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
private executable aliases plus Android system PATH, and only nativeLibraryDir
for LD_LIBRARY_PATH. CA paths point to the private generated trust bundle.
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

Python, Git, npm, rg, ImageMagick, ADB and Jev require a deliberate delivery
decision. Thumbnail generation still depends on ImageMagick; original-image
fallback does not certify thumbnail creation. Companion remote access needs a
native restart/bind design. Native default shell availability differs by Android
device; this Samsung result cannot certify every manufacturer. Status payload
readiness and task completion are not proof of every tool succeeding.

The runtime must not be labelled `Termux-independent runtime verified` until AGY
authentication/task execution and the full Pocket/Termux-shutdown flow also pass.
