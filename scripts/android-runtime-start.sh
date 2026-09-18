#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$HOME/.agy-web.log"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/server.pid"
SERVER_URL="http://127.0.0.1:8000/"

cd "$ROOT_DIR"
mkdir -p "$STATE_DIR"

find_repo_server_pid() {
    local pid cwd
    while read -r pid; do
        [ -n "$pid" ] || continue
        cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
        if [ "$cwd" = "$ROOT_DIR" ]; then
            printf '%s\n' "$pid"
            return 0
        fi
    done < <(pgrep -f 'node .*server\.js' 2>/dev/null || true)
    return 1
}

if [ -s "$PID_FILE" ]; then
    EXISTING_PID="$(cat "$PID_FILE")"
    if kill -0 "$EXISTING_PID" 2>/dev/null; then
        EXISTING_CWD="$(readlink "/proc/$EXISTING_PID/cwd" 2>/dev/null || true)"
        if [ "$EXISTING_CWD" = "$ROOT_DIR" ]; then
            exit 0
        fi
    fi
    rm -f "$PID_FILE"
fi

# Adopt a legacy/manual Crew server that is already running from this repo.
if EXISTING_PID="$(find_repo_server_pid)"; then
    printf '%s\n' "$EXISTING_PID" > "$PID_FILE"
    exit 0
fi

# If something else owns :8000, do not report a false successful start.
if curl -fsS --max-time 1 "$SERVER_URL" >/dev/null 2>&1; then
    echo "Port 8000 is already serving HTTP, but no Crew server from $ROOT_DIR could be identified." >&2
    echo "Refusing to start a second server. Run scripts/diagnose-agent-runtime.sh." >&2
    exit 2
fi

CREW_HOST_RUNTIME=termux-node CREW_CODEX_BRIDGE=off setsid node server.js </dev/null >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" > "$PID_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "Crew Pocket server exited during startup. See $LOG_FILE" >&2
        exit 1
    fi

    if curl -fsS --max-time 1 "$SERVER_URL" >/dev/null 2>&1; then
        exit 0
    fi
    sleep 0.5
done

echo "Crew Pocket server is still starting. See $LOG_FILE if it does not become ready." >&2
exit 0
