#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/server.pid"

if [ -s "$PID_FILE" ]; then
    SERVER_PID="$(cat "$PID_FILE")"
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" || true
    fi
    rm -f "$PID_FILE"
fi
