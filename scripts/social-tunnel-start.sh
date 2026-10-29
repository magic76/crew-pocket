#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

export PATH="$HOME/.local/bin:${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"

CONFIG_FILE="$HOME/.cloudflared/config.yml"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/social-tunnel.pid"
LOG_FILE="$HOME/.social-tunnel.log"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is not installed." >&2
    exit 1
fi
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Cloudflare Tunnel config is missing: $CONFIG_FILE" >&2
    exit 1
fi

mkdir -p "$STATE_DIR"
if [ -s "$PID_FILE" ]; then
    EXISTING_PID="$(cat "$PID_FILE")"
    if kill -0 "$EXISTING_PID" 2>/dev/null; then
        echo "Social OAuth tunnel is already running (PID $EXISTING_PID)."
        exit 0
    fi
    rm -f "$PID_FILE"
fi

setsid cloudflared tunnel --config "$CONFIG_FILE" run crew-pocket-social-auth \
    </dev/null >>"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!
printf '%s\n' "$TUNNEL_PID" > "$PID_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "Cloudflare Tunnel exited. See $LOG_FILE" >&2
        exit 1
    fi
    sleep 0.5
done

echo "Social OAuth tunnel is starting. See $LOG_FILE for connection status."
