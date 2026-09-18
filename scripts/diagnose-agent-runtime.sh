#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crew-pocket"
PID_FILE="$STATE_DIR/server.pid"
TOKEN_FILE="$HOME/.crew-pocket/embedded-bridge-token"
LOG_FILE="$HOME/.agy-web.log"

echo "== time =="
date
echo

echo "== branch =="
git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true
git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true
echo

echo "== server =="
if curl -fsS --max-time 2 http://127.0.0.1:8000/ >/dev/null 2>&1; then
    echo "localhost:8000 HTTP 200"
else
    echo "localhost:8000 unavailable"
fi
echo

echo "== pid file =="
if [ -s "$PID_FILE" ]; then
    SERVER_PID="$(cat "$PID_FILE")"
    echo "$SERVER_PID"
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "alive=yes"
        echo "cwd=$(readlink "/proc/$SERVER_PID/cwd" 2>/dev/null || echo unknown)"
        echo "cmd=$(tr '\0' ' ' < "/proc/$SERVER_PID/cmdline" 2>/dev/null || echo unknown)"
    else
        echo "alive=no"
    fi
else
    echo "missing"
fi
echo

echo "== repo node server candidates =="
FOUND=0
while read -r pid; do
    [ -n "$pid" ] || continue
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$ROOT_DIR" ]; then
        FOUND=1
        printf 'pid=%s cwd=%s cmd=' "$pid" "$cwd"
        tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
        echo
    fi
done < <(pgrep -f 'node .*server\.js' 2>/dev/null || true)
[ "$FOUND" -eq 1 ] || echo "none"
echo

echo "== embedded bridge token =="
if [ -s "$TOKEN_FILE" ]; then
    echo "present"
else
    echo "missing"
fi
echo

echo "== embedded bridge :8767 =="
if [ -s "$TOKEN_FILE" ] && command -v nc >/dev/null 2>&1; then
    TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
    RESPONSE="$(printf 'CREW-CODEX-BRIDGE/1 %s\n' "$TOKEN" | nc -w 2 127.0.0.1 8767 2>/dev/null | head -n 1 || true)"
    if [ "$RESPONSE" = "OK" ]; then
        echo "authenticated=yes"
    else
        echo "authenticated=no response=${RESPONSE:-<empty>}"
    fi
elif command -v nc >/dev/null 2>&1; then
    echo "not tested: token missing"
else
    echo "not tested: nc command missing"
fi
echo

echo "== recent Codex runtime transport =="
if [ -f "$LOG_FILE" ]; then
    grep -E '\[Codex Runtime\]|\[Codex Provider\] transport=' "$LOG_FILE" | tail -n 10 || echo "no transport entries"
else
    echo "log missing"
fi
echo

echo "== recent runtime log =="
if [ -f "$LOG_FILE" ]; then
    tail -n 30 "$LOG_FILE"
else
    echo "log missing"
fi
