#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$HOME/.agy-web.log"

cd "$ROOT_DIR"

if pgrep -f 'node.*server\.js' >/dev/null 2>&1; then
    exit 0
fi

setsid node server.js </dev/null >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 1 http://127.0.0.1:8000/ >/dev/null 2>&1; then
        exit 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Crew Pocket server exited during startup. See $LOG_FILE" >&2
        exit 1
    fi
    sleep 0.5
done

echo "Crew Pocket server is still starting. See $LOG_FILE if it does not become ready." >&2
exit 0
