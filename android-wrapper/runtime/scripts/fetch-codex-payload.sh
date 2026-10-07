#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PREPARE_CODEX="$ROOT_DIR/android-wrapper/runtime/scripts/prepare-embedded-codex.sh"
PACKAGE="${CODEX_NPM_PACKAGE:-@mmmbuto/codex-cli-termux}"
VERSION="${CODEX_NPM_VERSION:-latest}"
WORK_DIR="${CODEX_WORK_DIR:-$(mktemp -d)}"
KEEP_WORK="${CODEX_KEEP_WORK:-0}"

cleanup() {
  if [ "$KEEP_WORK" != "1" ]; then
    rm -rf "$WORK_DIR"
  else
    echo "Keeping Codex package workspace: $WORK_DIR"
  fi
}
trap cleanup EXIT

for command in npm node tar; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for Codex cross-architecture packaging." >&2
    exit 1
  }
done

mkdir -p "$WORK_DIR"
echo "Downloading $PACKAGE@$VERSION"
TGZ_NAME="$(cd "$WORK_DIR" && npm pack --silent "$PACKAGE@$VERSION" | tail -n 1)"
TGZ="$WORK_DIR/$TGZ_NAME"
[ -f "$TGZ" ] || {
  echo "npm pack did not produce the expected archive: $TGZ" >&2
  exit 2
}

tar -xzf "$TGZ" -C "$WORK_DIR"
PACKAGE_DIR="$WORK_DIR/package"
[ -f "$PACKAGE_DIR/package.json" ] || {
  echo "Codex npm archive is missing package.json" >&2
  exit 2
}

PACKAGE_VERSION="$(node -p "require(process.argv[1]).version || 'unknown'" "$PACKAGE_DIR/package.json")"
echo "Preparing Android Codex payload from $PACKAGE@$PACKAGE_VERSION"

CODEX_EMBED_PACKAGE_DIR="$PACKAGE_DIR" \
CODEX_EMBED_SKIP_RUN_CHECK=1 \
CODEX_EMBED_VERSION="$PACKAGE_VERSION" \
bash "$PREPARE_CODEX"
