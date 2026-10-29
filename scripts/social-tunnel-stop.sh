#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/social-tunnel.pid"

if [ ! -s "$PID_FILE" ]; then
    echo "Social OAuth tunnel is not running."
    exit 0
fi

TUNNEL_PID="$(cat "$PID_FILE")"
if kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID"
fi
rm -f "$PID_FILE"
echo "Social OAuth tunnel stopped."
