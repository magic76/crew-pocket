#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if pgrep -f 'node.*server\.js' >/dev/null 2>&1; then
    pkill -f 'node.*server\.js' || true
fi
