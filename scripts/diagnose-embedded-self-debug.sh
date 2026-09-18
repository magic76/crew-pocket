#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== branch =="
git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true
git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true
echo

echo "== runtime status API =="
if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 http://127.0.0.1:8000/api/runtime/status 2>/dev/null || echo "runtime status unavailable"
else
    echo "curl unavailable"
fi
echo
echo

echo "== self-debug job =="
if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 http://127.0.0.1:8000/api/runtime/self-debug 2>/dev/null || echo "self-debug status unavailable"
else
    echo "curl unavailable"
fi
echo
echo

echo "== APK private supervisor state =="
if command -v adb >/dev/null 2>&1; then
    adb shell run-as com.crewpocket.app sh -c         'cat files/workspaces/agy-web/.crew-runtime/state.json 2>/dev/null || echo state.json-missing'
else
    echo "adb unavailable"
fi
echo
echo

echo "== APK private node log (latest 80) =="
if command -v adb >/dev/null 2>&1; then
    adb shell run-as com.crewpocket.app sh -c         'tail -n 80 files/workspaces/agy-web/.crew-runtime/node.log 2>/dev/null || echo node.log-missing'
else
    echo "adb unavailable"
fi
echo

echo "== native runtime files =="
find "$ROOT_DIR/android-wrapper/app/src/main/jniLibs/arm64-v8a" -maxdepth 1 -type f     \( -name 'libnode_exec.so' -o -name 'libcodex_exec.so' -o -name 'libcrew_node_*.so' \)     -printf '%f %s bytes\n' 2>/dev/null | sort || true
