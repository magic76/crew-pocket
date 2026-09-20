#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$ROOT_DIR/android-wrapper/app/src/main/assets/agy-runtime"
JNI_DIR="$ROOT_DIR/android-wrapper/app/src/main/jniLibs/arm64-v8a"
AGY_BIN="${AGY_EMBED_BIN:-$(command -v agy || true)}"

if [ -z "$AGY_BIN" ] || [ ! -e "$AGY_BIN" ]; then
  echo "agy not found. Install Antigravity CLI first." >&2
  exit 1
fi

AGY_REAL="$(readlink -f "$AGY_BIN")"
mkdir -p "$ASSET_DIR"
rm -rf "$ASSET_DIR/package"
rm -f "$ASSET_DIR/manifest.json"

ELF_MAGIC="$(dd if="$AGY_REAL" bs=1 count=4 2>/dev/null | od -An -tx1 | tr -d " \n")"
if [ "$ELF_MAGIC" = "7f454c46" ]; then
  echo "Detected native ELF agy: $AGY_REAL" >&2
  echo "This build currently supports the Node-script AGY distribution only." >&2
  echo "Send this output back so the ELF dependencies can be packaged safely." >&2
  if command -v file >/dev/null 2>&1; then file "$AGY_REAL" >&2 || true; fi
  if command -v ldd >/dev/null 2>&1; then ldd "$AGY_REAL" >&2 || true; fi
  exit 2
fi

FIRST_LINE="$(head -n 1 "$AGY_REAL" 2>/dev/null || true)"
case "$FIRST_LINE" in
  *node*|*env*node*) ;;
  *)
    echo "Unsupported agy launcher: $AGY_REAL" >&2
    echo "Expected a Node shebang. First line: $FIRST_LINE" >&2
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
  echo "Validating AGY package with embedded Node..."
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

echo "✓ Embedded AGY runtime prepared"
echo "  source: $PACKAGE_ROOT"
echo "  entry: $ENTRY_REL"
echo "  version: $AGY_VERSION"
