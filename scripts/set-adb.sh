#!/data/data/com.termux/files/usr/bin/bash
set -eu
crew_target=${1:?Usage: set-adb.sh <port-or-IP:port>}
if [[ "$crew_target" =~ ^[0-9]+$ ]]; then crew_target="127.0.0.1:$crew_target"; fi
if [[ ! "$crew_target" =~ ^([A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\]):([1-9][0-9]{0,4})$ ]]; then
    echo '請輸入有效的 Port 或 IP:Port。' >&2; exit 2
fi
crew_port=${BASH_REMATCH[2]}
[ "$crew_port" -le 65535 ] || { echo 'Port 必須小於或等於 65535。' >&2; exit 2; }
crew_runner="$HOME/crew-adb.sh"
[ -f "$crew_runner" ] || crew_runner="$(dirname "$0")/crew-adb.sh"
mkdir -p "$HOME/.crew-pocket"
printf '%s\n' "$crew_target" > "$HOME/.adb_port"
crew_output=$(bash "$crew_runner" connect "$crew_target" 2>&1) || {
    crew_result=$?
    printf 'connect: %s\n' "$crew_output" > "$HOME/.crew-pocket/adb-last-result"
    printf '%s\n' "$crew_output" >&2
    exit "$crew_result"
}
printf 'connect: %s\n' "$crew_output" > "$HOME/.crew-pocket/adb-last-result"
crew_devices=$(bash "$crew_runner" devices) || exit $?
printf '%s\n' "$crew_devices" | awk -v target="$crew_target" '$1 == target && $2 == "device" {found=1} END {exit !found}' || {
    printf '%s\n' "$crew_output" >&2
    echo '尚未連線，請確認 Wi-Fi、無線偵錯與目前 Port；尚未配對時請先配對。' >&2
    exit 4
}
printf 'ADB 已連線：%s\n' "$crew_target"
