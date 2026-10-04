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
preferred = [
    'agy_cli_android_arm64.tar.gz',
    'agy_cli_linux_arm64_musl.tar.gz',
    'agy_cli_linux_arm64.tar.gz',
]
asset = next(
    (item for name in preferred for item in assets if item.get('name') == name),
    None,
)
if not tag or not asset:
    raise SystemExit(
        'Official release is missing a supported ARM64 AGY asset: '
        + ', '.join(preferred)
    )
name = str(asset.get('name') or '').strip()
url = str(asset.get('browser_download_url') or '')
digest = str(asset.get('digest') or '')
if not name or not url:
    raise SystemExit('Official AGY asset has no name or download URL')
print(tag)
print(name)
print(url)
print(digest)
PY
)

VERSION="${RELEASE_INFO[0]}"
ASSET_NAME="${RELEASE_INFO[1]}"
URL="${RELEASE_INFO[2]}"
DIGEST="${RELEASE_INFO[3]:-}"
ARCHIVE="$WORK_DIR/$ASSET_NAME"

echo "Downloading official Antigravity CLI $VERSION"
echo "  asset: $ASSET_NAME"
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

  RELATIVE="${item#"$WORK_DIR/extract/"}"
  INTERP="$(readelf -l "$item" 2>/dev/null | sed -n 's/.*Requesting program interpreter: \(.*\)]/\1/p' | head -n 1)"
  NEEDED="$(readelf -d "$item" 2>/dev/null | sed -n 's/.*Shared library: \[\(.*\)\].*/\1/p' | paste -sd, - || true)"

  if [ -z "$INTERP" ]; then
    if [ -n "$NEEDED" ]; then
      echo "Skipping ambiguous ARM64 ELF: $RELATIVE (no PT_INTERP; NEEDED=$NEEDED)"
      continue
    fi
    echo "Candidate Android/static ELF: $RELATIVE (no PT_INTERP, no shared-library dependencies)"
    CANDIDATE="$item"
    break
  fi

  case "$INTERP" in
    /system/bin/linker64|/apex/*/bin/linker64)
      echo "Candidate Android ELF: $RELATIVE ($INTERP; NEEDED=${NEEDED:-none})"
      CANDIDATE="$item"
      break
      ;;
    *)
      echo "Skipping non-Android ELF: $RELATIVE ($INTERP; NEEDED=${NEEDED:-none})"
      ;;
  esac
done < <(find "$WORK_DIR/extract" -type f \( -perm -u+x -o -name 'agy*' \) -print)

if [ -z "$CANDIDATE" ]; then
  echo "No directly runnable Android-compatible ARM64 AGY ELF was found in $ASSET_NAME." >&2
  echo "Refusing to package a binary that depends on a non-Android loader." >&2
  exit 3
fi

mkdir -p "$JNI_DIR" "$ASSET_DIR"
rm -rf "$ASSET_DIR/package" "$ASSET_DIR/files"
cp "$CANDIDATE" "$JNI_DIR/libagy_exec.so"
chmod 0755 "$JNI_DIR/libagy_exec.so"

# Copy native shared-library companions when an Android-linked release ships them.
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
  "asset": "$ASSET_NAME",
  "command": ["\${NATIVE_DIR}/libagy_exec.so"]
}
EOF

echo "✓ Official Android-compatible AGY payload prepared"
echo "  version: $VERSION"
echo "  asset:   $ASSET_NAME"
echo "  binary:  $JNI_DIR/libagy_exec.so"
