#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ASSET_DIR="$ROOT_DIR/android-wrapper/runtime/src/main/assets/agy-runtime"
JNI_DIR="$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a"
BUNDLE_DIR="${AGY_ANDROID_BUNDLE_DIR:-}"
AGY_BIN="${AGY_EMBED_BIN:-$(command -v agy || true)}"

install_android_bundle() {
  local bundle="$1"
  local manifest="$bundle/manifest.json"
  local bundle_jni="$bundle/jniLibs/arm64-v8a"
  local bundle_files="$bundle/files"

  [ -f "$manifest" ] || {
    echo "Android AGY bundle is missing manifest.json: $manifest" >&2
    exit 2
  }
  [ -d "$bundle_jni" ] || {
    echo "Android AGY bundle is missing jniLibs/arm64-v8a: $bundle_jni" >&2
    exit 2
  }

  command -v node >/dev/null 2>&1 || {
    echo "Node.js is required to validate the AGY Android bundle manifest." >&2
    exit 2
  }

  local validation
  if ! validation="$(node - "$manifest" "$bundle_jni" <<'NODE'
const fs = require('fs');
const path = require('path');
const [manifestPath, jniDir] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.type !== 'native-command') {
  throw new Error('manifest.type must be native-command');
}
if (!Array.isArray(manifest.command) || manifest.command.length === 0) {
  throw new Error('manifest.command must be a non-empty array');
}
if (!manifest.version || typeof manifest.version !== 'string') {
  throw new Error('manifest.version is required');
}
const first = String(manifest.command[0] || '');
const prefix = '${NATIVE_DIR}/';
if (!first.startsWith(prefix)) {
  throw new Error('manifest.command[0] must start with ${NATIVE_DIR}/');
}
const launcher = first.slice(prefix.length);
if (!/^lib[A-Za-z0-9._+-]+\.so$/.test(launcher)) {
  throw new Error('native launcher must be packaged as lib*.so');
}
if (!fs.existsSync(path.join(jniDir, launcher))) {
  throw new Error('native launcher is missing from jniLibs: ' + launcher);
}
for (const name of fs.readdirSync(jniDir)) {
  if (!/^lib[A-Za-z0-9._+-]+\.so$/.test(name)) {
    throw new Error('all packaged native files must use Android lib*.so names: ' + name);
  }
}
process.stdout.write(manifest.version + '\n' + launcher);
NODE
  )"; then
    echo "Invalid Android AGY bundle." >&2
    exit 2
  fi

  local version launcher
  version="$(printf '%s\n' "$validation" | sed -n '1p')"
  launcher="$(printf '%s\n' "$validation" | sed -n '2p')"

  mkdir -p "$ASSET_DIR" "$JNI_DIR"
  rm -rf "$ASSET_DIR/package" "$ASSET_DIR/files"
  cp "$manifest" "$ASSET_DIR/manifest.json"
  cp -a "$bundle_jni"/. "$JNI_DIR"/

  if [ -d "$bundle_files" ]; then
    mkdir -p "$ASSET_DIR/files"
    cp -a "$bundle_files"/. "$ASSET_DIR/files"/
  fi

  chmod 0644 "$JNI_DIR"/lib*.so 2>/dev/null || true
  chmod 0755 "$JNI_DIR/$launcher"

  echo "✓ Android-compatible AGY bundle prepared"
  echo "  source: $bundle"
  echo "  launcher: $launcher"
  echo "  version: $version"
  echo "  delivery: Crew Runtime APK"
}

if [ -n "$BUNDLE_DIR" ]; then
  [ -d "$BUNDLE_DIR" ] || {
    echo "AGY_ANDROID_BUNDLE_DIR does not exist: $BUNDLE_DIR" >&2
    exit 2
  }
  install_android_bundle "$(cd "$BUNDLE_DIR" && pwd)"
  exit 0
fi

if [ -z "$AGY_BIN" ] || [ ! -e "$AGY_BIN" ]; then
  echo "agy not found." >&2
  echo "For modern native AGY builds, set AGY_ANDROID_BUNDLE_DIR to a verified Android compatibility bundle." >&2
  exit 1
fi

AGY_REAL="$(readlink -f "$AGY_BIN")"
mkdir -p "$ASSET_DIR"
rm -rf "$ASSET_DIR/package" "$ASSET_DIR/files"
rm -f "$ASSET_DIR/manifest.json"

ELF_MAGIC="$(dd if="$AGY_REAL" bs=1 count=4 2>/dev/null | od -An -tx1 | tr -d " \n")"
if [ "$ELF_MAGIC" = "7f454c46" ]; then
  echo "Detected native ELF agy: $AGY_REAL" >&2
  echo "Raw modern AGY Linux binaries are glibc-linked and are not directly runnable on Android/Bionic." >&2
  echo "Do not copy this binary into the APK unchanged." >&2
  echo "Prepare a verified Android compatibility bundle and rerun with:" >&2
  echo "  AGY_ANDROID_BUNDLE_DIR=/path/to/bundle $0" >&2
  if command -v file >/dev/null 2>&1; then file "$AGY_REAL" >&2 || true; fi
  exit 2
fi

FIRST_LINE="$(head -n 1 "$AGY_REAL" 2>/dev/null || true)"
case "$FIRST_LINE" in
  *node*|*env*node*) ;;
  *)
    echo "Unsupported agy launcher: $AGY_REAL" >&2
    echo "Expected a legacy Node shebang or an Android native bundle." >&2
    echo "First line: $FIRST_LINE" >&2
    exit 2
    ;;
esac

PACKAGE_ROOT="$(dirname "$AGY_REAL")"
while [ "$PACKAGE_ROOT" != "/" ] && [ ! -f "$PACKAGE_ROOT/package.json" ]; do
  PACKAGE_ROOT="$(dirname "$PACKAGE_ROOT")"
done
if [ ! -f "$PACKAGE_ROOT/package.json" ]; then
  echo "Could not locate package.json above $AGY_REAL" >&2
  exit 2
fi

ENTRY_REL="${AGY_REAL#"$PACKAGE_ROOT"/}"
if [ "$ENTRY_REL" = "$AGY_REAL" ]; then
  echo "agy entry is outside package root" >&2
  exit 2
fi

AGY_VERSION="$("$AGY_REAL" --version 2>/dev/null | head -n 1 || true)"
[ -n "$AGY_VERSION" ] || AGY_VERSION="unknown"

mkdir -p "$ASSET_DIR/package"
cp -aL "$PACKAGE_ROOT"/. "$ASSET_DIR/package/"

cat > "$ASSET_DIR/manifest.json" <<EOF
{
  "type": "node-script",
  "entry": "$ENTRY_REL",
  "version": "$AGY_VERSION"
}
EOF

NODE_EMBED="$JNI_DIR/libnode_exec.so"
if [ -x "$NODE_EMBED" ]; then
  echo "Validating legacy AGY package with embedded Node..."
  if ! OUT="$(HOME="$HOME" LD_LIBRARY_PATH="$JNI_DIR" "$NODE_EMBED" "$ASSET_DIR/package/$ENTRY_REL" --version 2>&1)"; then
    echo "Embedded Node could not execute packaged AGY:" >&2
    echo "$OUT" >&2
    exit 3
  fi
  echo "  $OUT"
else
  echo "! libnode_exec.so not prepared yet; validation deferred."
  echo "  Run scripts/prepare-embedded-node.sh before building the APK."
fi

echo "✓ Legacy Node-script AGY runtime prepared"
echo "  source: $PACKAGE_ROOT"
echo "  entry: $ENTRY_REL"
echo "  version: $AGY_VERSION"
