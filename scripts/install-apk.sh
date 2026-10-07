#!/data/data/com.termux/files/usr/bin/bash
set -eu
crew_apk=${1:?Usage: install-apk.sh <apk-path> [wireless-target]}
[ -f "$crew_apk" ] || { echo "APK not found: $crew_apk" >&2; exit 2; }
crew_runner="$HOME/crew-adb.sh"
[ -f "$crew_runner" ] || crew_runner="$(dirname "$0")/crew-adb.sh"
crew_devices=$(bash "$crew_runner" devices) || exit $?
crew_target=${2:-}
if [ -z "$crew_target" ]; then
    crew_target=$(printf '%s\n' "$crew_devices" | awk '$2 == "device" && $1 ~ /:[0-9]+$/ {print $1}')
    [ "$(printf '%s\n' "$crew_target" | awk 'NF {n++} END {print n+0}')" = 1 ] || {
        echo 'ADB 未連線或有多個裝置。請開啟無線偵錯，確認目前 Port；離線不影響聊天。' >&2
        exit 4
    }
fi
printf '%s\n' "$crew_devices" | awk -v target="$crew_target" '$1 == target && $2 == "device" {found=1} END {exit !found}' || {
    echo "ADB 裝置未連線：$crew_target。已停止安裝，不會自動重試。" >&2
    exit 4
}
if bash "$crew_runner" -s "$crew_target" install -r "$crew_apk"; then exit 0; fi
# The required non-streaming fallback is attempted only while the same target is online.
crew_devices=$(bash "$crew_runner" devices) || exit $?
printf '%s\n' "$crew_devices" | awk -v target="$crew_target" '$1 == target && $2 == "device" {found=1} END {exit !found}' || {
    echo 'ADB 已離線，停止安裝。請確認目前無線偵錯 Port。' >&2
    exit 4
}
echo '串流安裝未完成，改用同一裝置的檔案安裝。'
bash "$crew_runner" -s "$crew_target" push "$crew_apk" /data/local/tmp/crew-pocket-app-debug.apk
crew_install_output=$(CREW_ADB_TIMEOUT_SECONDS=60 bash "$crew_runner" -s "$crew_target" shell pm install -r -d /data/local/tmp/crew-pocket-app-debug.apk) || {
    crew_status=$?
    printf '%s\n' "$crew_install_output" >&2
    exit "$crew_status"
}
printf '%s\n' "$crew_install_output"
printf '%s\n' "$crew_install_output" | tr -d '\r' | grep -qx 'Success' || exit 1
