#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$HOME/.agy-web.log"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/server.pid"

cd "$ROOT_DIR"
mkdir -p "$STATE_DIR"

if [ -s "$PID_FILE" ]; then
    EXISTING_PID="$(cat "$PID_FILE")"
    if kill -0 "$EXISTING_PID" 2>/dev/null; then
        exit 0
    fi
    rm -f "$PID_FILE"
fi

setsid node server.js </dev/null >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" > "$PID_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 1 http://127.0.0.1:8000/ >/dev/null 2>&1; then
        exit 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "Crew Pocket server exited during startup. See $LOG_FILE" >&2
        exit 1
    fi
    sleep 0.5
done

echo "Crew Pocket server is still starting. See $LOG_FILE if it does not become ready." >&2
exit 0
