#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST="$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a"

if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to locate @mmmbuto/codex-cli-termux" >&2
    exit 1
fi

NPM_ROOT="$(npm root -g)"
PACKAGE_DIR="$NPM_ROOT/@mmmbuto/codex-cli-termux"
CODEX_BIN="${CODEX_EMBED_BIN:-$PACKAGE_DIR/bin/codex.bin}"
CXX_LIB="${CODEX_EMBED_LIBCXX:-$PACKAGE_DIR/bin/libc++_shared.so}"

if [ ! -f "$CODEX_BIN" ]; then
    echo "Codex native binary not found: $CODEX_BIN" >&2
    echo "Install it first: npm install -g @mmmbuto/codex-cli-termux" >&2
    exit 1
fi

if [ ! -f "$CXX_LIB" ]; then
    echo "libc++_shared.so not found: $CXX_LIB" >&2
    exit 1
fi

mkdir -p "$DEST"
cp "$CODEX_BIN" "$DEST/libcodex_exec.so"
cp "$CXX_LIB" "$DEST/libc++_shared.so"
chmod 0755 "$DEST/libcodex_exec.so"
chmod 0644 "$DEST/libc++_shared.so"

echo "✓ Embedded Codex runtime prepared"
echo "  binary: $DEST/libcodex_exec.so"
echo "  libc++: $DEST/libc++_shared.so"
echo
echo "These files are gitignored. Rebuild the APK now:"
echo "  gradle -p android-wrapper :runtime:assembleDebug"

CODEX_VERSION="$(LD_LIBRARY_PATH="$DEST" "$DEST/libcodex_exec.so" --version 2>/dev/null | head -n 1 || true)"
[ -n "$CODEX_VERSION" ] || CODEX_VERSION="unknown"
MANIFEST_DIR="$ROOT_DIR/android-wrapper/runtime/src/main/assets/provider-manifests"
mkdir -p "$MANIFEST_DIR"
printf '{"version":"%s"}\n' "$CODEX_VERSION" > "$MANIFEST_DIR/codex.json"
