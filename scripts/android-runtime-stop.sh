#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/server.pid"

find_repo_server_pids() {
    local pid cwd
    while read -r pid; do
        [ -n "$pid" ] || continue
        cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
        if [ "$cwd" = "$ROOT_DIR" ]; then
            printf '%s\n' "$pid"
        fi
    done < <(pgrep -f 'node .*server\.js' 2>/dev/null || true)
}

if [ -s "$PID_FILE" ]; then
    SERVER_PID="$(cat "$PID_FILE")"
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        SERVER_CWD="$(readlink "/proc/$SERVER_PID/cwd" 2>/dev/null || true)"
        if [ "$SERVER_CWD" = "$ROOT_DIR" ]; then
            kill "$SERVER_PID" || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# Also stop legacy/manual Crew servers from this exact repo, even if the PID
# file did not exist yet.
while read -r SERVER_PID; do
    [ -n "$SERVER_PID" ] || continue
    kill "$SERVER_PID" 2>/dev/null || true
done < <(find_repo_server_pids)
