#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="${CREW_TOOLCHAIN_WORK_DIR:-$(mktemp -d)}"
trap 'if [ "${CREW_TOOLCHAIN_KEEP_WORK:-0}" != 1 ]; then rm -rf "$WORK_DIR"; fi' EXIT
python3 "$ROOT_DIR/android-wrapper/runtime/scripts/fetch-toolchain.py" --work "$WORK_DIR" "$@"
COMPILER="${CREW_TOOLCHAIN_CC:-clang}"
if [ -n "${ANDROID_NDK_HOME:-}" ]; then
  COMPILER="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang"
fi
"$COMPILER" -O2 -fPIE -pie "$ROOT_DIR/android-wrapper/runtime/toolchain/launcher.c" -o "$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a/libcrew_tool_launcher.so"

patchelf --set-rpath '$ORIGIN' "$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a/libcrew_tool_launcher.so"

SEMAPHORE_LIBRARY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["links"]["lib/libandroid-posix-semaphore.so"])' "$ROOT_DIR/android-wrapper/runtime/src/main/assets/toolchain/manifest.json")"
"$COMPILER" -O2 -fPIC -shared "$ROOT_DIR/android-wrapper/runtime/toolchain/posix-semaphore.c" -Wl,-soname,"$SEMAPHORE_LIBRARY" -o "$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a/$SEMAPHORE_LIBRARY"
patchelf --set-rpath '$ORIGIN' "$ROOT_DIR/android-wrapper/runtime/src/main/jniLibs/arm64-v8a/$SEMAPHORE_LIBRARY"
