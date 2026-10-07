# Companion toolchain

`tools.json` is the build registry; `packages.lock.json` pins the Android package
versions and checksums. Use `bash android-wrapper/runtime/scripts/fetch-toolchain.sh
--refresh-lock` when adding packages or deliberately updating versions, then review
the lock diff. If a mirror removes a pinned package, explicitly refresh the lock
and repeat device verification. Generated payloads are ignored by Git:

- ARM64 ELF executables and their recursive `DT_NEEDED` closure → JNI libraries.
- Python standard library, npm JS, Git templates and ImageMagick resources → assets.
- Python/ImageMagick dynamic modules → JNI libraries plus logical-name symlinks.
- Dynamic libraries have matching relocated DT_NEEDED/SONAME entries and private
  logical-name aliases; Python ctypes metadata names the relocated libpython; `LD_LIBRARY_PATH` contains only the Runtime native directory
  and its private toolchain/lib directory.
- npm/npx/Jev and Git shell helpers → an installer-owned C launcher that executes
  the bundled Node/Bash interpreter. No `/usr/bin/env` or executable app-data script.

Build on Termux:

```sh
bash android-wrapper/runtime/scripts/fetch-toolchain.sh
CREW_RUNTIME_ENABLE_COMPANION=true gradle -p android-wrapper :runtime:assembleDebug
```

CI uses Android NDK 27.2.12479018; local builds use Android's Clang. The packager
checks each downloaded `.deb` against the repository's SHA256 metadata and aborts
on missing dynamic dependencies. APK completeness checking also rejects missing
assets/modules, including underscore-prefixed directories that AAPT normally drops. `manifest.json` records package versions, hashes,
command aliases and module links; upstream documentation/license files travel
with the assets. Source for GPL components is available from the corresponding
Termux package recipes and upstream project releases; preserve this provenance
when distributing a release.

## Add a tool

1. Add its Android package to `packages` and its command → package-relative ELF
   path to `commands`. Termux is the **build source**, not the running application's
   HOME, PATH or binary directory.
2. Add required runtime data glob patterns to `data`. For a JS/shell entry, add
   `scripts`: `["node" or "bash" or "python3", "asset-relative-entry"]`.
3. Add environment overrides in `EmbeddedToolchain.environment` when the upstream
   binary contains compiled paths. Check actual subprocess execution, native module
   imports, TLS, and at least one useful command; a discovered executable or version
   string alone does not certify the tool.
4. Rebuild, install the Runtime APK with a signature compatible with Pocket, and
   restart Dev Pocket. Runtime status discovers commands from the generated manifest.
   Update this document with remaining limitations.

Do not copy Linux/glibc ELF binaries or arbitrary npm native addons into app data
and assume they can execute. New native binaries/modules need an Android build
and a signed Runtime APK update. JS/Python source packages can run as data using
bundled interpreters; native npm/pip packages require compatible bundled modules
and toolchains. This payload does not include a general native compiler.

## Boundaries

- Python subprocess shell defaults to `/system/bin/sh`, executable defaults use
  Android directories, and ctypes discovery prefers private bundled libraries.
  Build-time package-manager helpers are excluded. Python named semaphores use the vendored MIT-licensed Android implementation
  with a private TMPDIR override. Python includes the standard library and its packaged extension modules; pip is
  not currently bundled.
- npm/npx support JS packages and scripts. A newly installed package's app-data
  shebang launcher is not itself an Android native executable; invoke its JS entry
  with `node`, or add a registered native launcher during the next APK build.
- Git supports built-in commands and bundled HTTP(S) helpers. SSH, Perl-based Git
  extensions and interactive editors are not included; hooks require compatible
  interpreters. Git TLS uses Android's exported trust roots. Git's compiled
  credential-helper shell is relocated to `/system/bin/sh` during ELF packaging.
- GitHub CLI (`gh`) is an Android ARM64 executable in the Runtime APK.
  `GH_CONFIG_DIR` is private `$HOME/.config/gh`, outside the replaceable tool payload.
  Use HTTPS: SSH tooling and a desktop browser opener are not bundled.
  For device login run `gh auth login --hostname github.com --git-protocol https --web`;
  open the displayed device URL in the phone browser and enter the displayed code.
  Then run `gh auth setup-git`. For GitHub HTTPS, replace the generated native-library
  path helper with a PATH-based helper so a later APK replacement does not invalidate it:
  `git config --global --replace-all credential.https://github.com.helper ""` followed by
  `git config --global --add credential.https://github.com.helper "!gh auth git-credential"`.
  `gh auth status` checks login. Never print `gh auth token` into chat or logs.
- ImageMagick bundles coders and configuration. External delegates such as
  Ghostscript, Graphviz and GUI programs are not registered commands; formats
  requiring those delegates are not certified. PNG/JPEG conversion is the first gate.
- ADB has its own socket (Dev `tcp:localhost:5038`, Stable `tcp:localhost:5039`),
  private HOME and pairing keys.
  Pair the Runtime ADB client through Wireless Debugging before controlling a device.
  It never reads Termux ADB keys or kills the existing port-5037 daemon.
- `jev` is Crew's small CLI adapter for the official API, not a relabeled third-party
  CLI. It supports `ask <state> --questions <JSON> --format json`, `run <file|->`,
  `--version`, `--help`; API keys stay in environment or private `~/.config/jev/.env`.
  Missing credentials exit 3. Real model requests need a TypeSafe key.

Sources: [Termux recipes](https://github.com/termux/termux-packages),
[TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart).

## Terminal

Open **Tools → Terminal** in Pocket. The terminal uses vendored xterm.js and an
APK-owned `libcrew_terminal_host.so` PTY host running bundled Bash, initially in
`$HOME`. Create projects directly at `~/project-name`. Terminal commands run as the Runtime app, without the code
sandbox's 15-second timeout. Directory changes, interactive prompts and Ctrl+C
work through the PTY. Returning to chat retains the session; **End** closes the
shell and its foreground command. Runtime restart loses live terminal sessions,
while project files and credentials remain in private HOME.

Only opening Terminal creates a shell. The server bounds retained output to
2 MiB per session and limits sessions to three. Streaming and input routes use
Crew's existing API authorization; each terminal has a random session handle.
The PTY host is compiled with the same Android compiler as the tool launcher.
Termux-hosted development can set `CREW_TERMINAL_HOST` to a compatible compiled
helper; companion mode only uses its own nativeLibraryDir.

Vendored xterm.js 5.5.0 and fit addon 0.10.0 include their MIT licenses and npm
registry integrity metadata under `public/vendor/xterm/`.

## Agent APK builds

Ask the Agent to build an Android project under Runtime HOME. Use
`crew-build <workspace>` (default `assembleDebug`) or pass Gradle task/options,
for example `crew-build ~/my-app --offline assembleDebug` after a first
online build. The CLI prints `CREW_BUILD_RESULT` with completion/error status,
artifact SHA256 and a download URL. Return the URL as a clickable Markdown link.
Logs and copied APKs stay under `~/.crew-pocket/builds/<id>`; debug signing keys
remain in private `~/.android`. Native payload updates preserve these directories.

The build payload provides JDK21, Gradle8.13 and Gradle9.8, Android SDK35/36, build-tools34/35 data,
ARM64 AAPT2/AIDL/zipalign and apksigner. Official Google SDK archives are pinned
in `android-build-sdk.lock.json` and verified against SHA256 and upstream SHA1.
Desktop SDK ELF tools are excluded. Termux Android packages are build inputs;
Agent commands execute APK-owned binaries and private data. New SDK/native tools
require reviewed payload updates. Android ARM64 NDK28.2.13676358, CMake3.22.1
and Ninja are bundled; pip is not included. Their pinned archives and SHA256
are in `native-build.lock.json`. NDK sysroot libraries remain compilation data;
host executables run from installer-owned nativeLibraryDir. The NDK host folder
uses AGP's `linux-x86_64` layout name but contains ARM64 Android binaries.

The Gradle launcher respects `gradle-wrapper.properties` when its version is
bundled. Without a wrapper, an AGP8 project uses 8.13; other projects use 9.8.
Set `CREW_GRADLE_VERSION=8.13` or `9.8.0` explicitly when needed. Unsupported
wrapper versions fail with an actionable message rather than running 9.8 silently.

OpenJDK needs the private logical JDK layout even though ELF files are installed
in a flat directory. The Java launcher applies its path adapter only to Java
processes. Java uses private tmp/home, fork-based child processes and an Android
CA export in certificate-only JKS format. Gradle uses private caches and bundled
AAPT2; `--no-daemon` prevents a long-lived Gradle daemon after builds. Upstream
Gradle wrappers are app-data scripts: use the bundled `gradle`/`crew-build` entry.

The Java Activity sample and a real Codex edit/build request passed on Android16.
Kotlin, Flutter and arbitrary Gradle/AGP combinations need separate checks.
SDK dexdump/split-select legacy inspection commands fail explicitly as unsupported.
APK download links in Pocket use Android's download notification; installation
remains a separate user action.

## Shared Downloads

Pocket's Tools → Downloads 存取 opens a signature-protected activity in the
matching Runtime package. Android11+ asks the user to enable the Runtime's
`MANAGE_EXTERNAL_STORAGE` special access in Android settings. This grants access
to shared storage beyond Downloads; it does not grant access to other apps'
private HOME directories. Earlier Android versions use runtime read/write
storage permissions. Grant/revocation is always a user action in system settings.

Runtime exports `CREW_DOWNLOADS_DIR` and creates `~/storage/downloads` pointing to
Android's shared Download directory, preserving any preexisting user path. Agent
commands can list/read/write/copy files using that path while retaining the
conversation's existing workspace. No Termux process or ADB grant is required.
Runtime `/status.sharedDownloads` reports the path and current Android permission;
provider tool snapshots also report filesystem readability/writability.

The existing file explorer follows the downloads directory alias. Absolute text
links inside Downloads are readable through `/api/file/read?absolute=1`; the
realpath must remain inside the configured Downloads root. Workspace validation
remains scoped to Runtime HOME. APK download links through Android DownloadManager
continue to work independently of this special access grant.
