#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
JNI_DIR="$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a"
ASSET_DIR="$ROOT_DIR/android-wrapper/runtime/src/main/assets/agy-runtime"
REPO="${AGY_GITHUB_REPO:-google-antigravity/antigravity-cli}"
TAG="${AGY_RELEASE_TAG:-latest}"
WORK_DIR="${AGY_RELEASE_WORK_DIR:-$(mktemp -d)}"
KEEP_WORK="${AGY_RELEASE_KEEP_WORK:-0}"

cleanup() {
  if [ "$KEEP_WORK" != "1" ]; then
    rm -rf "$WORK_DIR"
  else
    echo "Keeping AGY release workspace: $WORK_DIR"
  fi
}
trap cleanup EXIT

for command in curl python3 tar file readelf sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for official AGY packaging." >&2
    exit 1
  }
done

API="https://api.github.com/repos/$REPO/releases"
if [ "$TAG" = "latest" ]; then
  API="$API/latest"
else
  API="$API/tags/$TAG"
fi

AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

mkdir -p "$WORK_DIR/extract"
RELEASE_JSON="$WORK_DIR/release.json"
curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" "$API" -o "$RELEASE_JSON"

readarray -t RELEASE_INFO < <(python3 - "$RELEASE_JSON" <<'PY'
import json
import sys

release = json.load(open(sys.argv[1], encoding='utf-8'))
tag = str(release.get('tag_name') or '').strip()
assets = release.get('assets') or []
asset = next((item for item in assets if item.get('name') == 'agy_cli_linux_arm64.tar.gz'), None)
if not tag or not asset:
    raise SystemExit('Official release is missing tag or agy_cli_linux_arm64.tar.gz')
url = str(asset.get('browser_download_url') or '')
digest = str(asset.get('digest') or '')
if not url:
    raise SystemExit('Official AGY asset has no download URL')
print(tag)
print(url)
print(digest)
PY
)

VERSION="${RELEASE_INFO[0]}"
URL="${RELEASE_INFO[1]}"
DIGEST="${RELEASE_INFO[2]:-}"
ARCHIVE="$WORK_DIR/agy_cli_linux_arm64.tar.gz"

echo "Downloading official Antigravity CLI $VERSION"
curl -fL --retry 3 "${AUTH[@]}" "$URL" -o "$ARCHIVE"

if [[ "$DIGEST" == sha256:* ]]; then
  EXPECTED="${DIGEST#sha256:}"
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "Official AGY release digest mismatch." >&2
    echo "expected: $EXPECTED" >&2
    echo "actual:   $ACTUAL" >&2
    exit 2
  fi
  echo "✓ release digest verified"
else
  echo "Official release did not publish a SHA-256 digest; refusing unverified payload." >&2
  exit 2
fi

tar -xzf "$ARCHIVE" -C "$WORK_DIR/extract"

echo "Inspecting official ARM64 release contents:"
find "$WORK_DIR/extract" -maxdepth 3 -type f -print | sort | while read -r item; do
  printf '  %s: ' "${item#"$WORK_DIR/extract/"}"
  file -b "$item" || true
done

CANDIDATE=""
while IFS= read -r item; do
  DESCRIPTION="$(file -b "$item" 2>/dev/null || true)"
  case "$DESCRIPTION" in
    *ELF*64-bit*ARM*aarch64*|*ELF*64-bit*ARM*AArch64*) ;;
    *) continue ;;
  esac

  INTERP="$(readelf -l "$item" 2>/dev/null | sed -n 's/.*Requesting program interpreter: \(.*\)]/\1/p' | head -n 1)"
  if [ -z "$INTERP" ]; then
    echo "Candidate Android/static ELF: ${item#"$WORK_DIR/extract/"} (no PT_INTERP)"
    CANDIDATE="$item"
    break
  fi
  case "$INTERP" in
    /system/bin/linker64|/apex/*/bin/linker64)
      echo "Candidate Android ELF: ${item#"$WORK_DIR/extract/"} ($INTERP)"
      CANDIDATE="$item"
      break
      ;;
    *)
      echo "Skipping non-Android ELF: ${item#"$WORK_DIR/extract/"} ($INTERP)"
      ;;
  esac
done < <(find "$WORK_DIR/extract" -type f -perm -u+x -o -type f -name 'agy*')

if [ -z "$CANDIDATE" ]; then
  echo "No directly runnable Android ARM64 AGY ELF was found in the official release archive." >&2
  echo "The release may require a different Android artifact/layout; refusing to package the Linux/glibc binary." >&2
  exit 3
fi

mkdir -p "$JNI_DIR" "$ASSET_DIR"
rm -rf "$ASSET_DIR/package" "$ASSET_DIR/files"
cp "$CANDIDATE" "$JNI_DIR/libagy_exec.so"
chmod 0755 "$JNI_DIR/libagy_exec.so"

# Copy native shared-library companions if the official archive ships them.
while IFS= read -r library; do
  name="$(basename "$library")"
  case "$name" in
    lib*.so|lib*.so.*)
      safe="$name"
      if [[ "$safe" != *.so ]]; then
        safe="libagy_${safe//[^A-Za-z0-9_]/_}.so"
      fi
      cp "$library" "$JNI_DIR/$safe"
      chmod 0644 "$JNI_DIR/$safe"
      ;;
  esac
done < <(find "$WORK_DIR/extract" -type f ! -path "$CANDIDATE" -name 'lib*.so*')

cat > "$ASSET_DIR/manifest.json" <<EOF
{
  "type": "native-command",
  "version": "$VERSION",
  "source": "official-github-release",
  "command": ["\${NATIVE_DIR}/libagy_exec.so"]
}
EOF

echo "✓ Official Android AGY payload prepared"
echo "  version: $VERSION"
echo "  binary:  $JNI_DIR/libagy_exec.so"
