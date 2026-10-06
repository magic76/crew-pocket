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
  interpreters. Git TLS uses Android's exported trust roots.
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
