#!/data/data/com.termux/files/usr/bin/bash
# Bounded ADB calls. No background reconnect loop.
set -u
crew_binary=${CREW_ADB_BINARY:-${PREFIX:-/data/data/com.termux/files/usr}/bin/adb}
crew_seconds=10
crew_device_operation=false
crew_serial=
crew_next_serial=false
for crew_argument in "$@"; do
    if [ "$crew_next_serial" = true ]; then crew_serial=$crew_argument; crew_next_serial=false; fi
    if [ "$crew_argument" = -s ]; then crew_next_serial=true; fi
done
for crew_argument in "$@"; do
    case "$crew_argument" in
        devices|get-state) crew_seconds=3; break ;;
        connect) crew_seconds=5; break ;;
        pair) crew_seconds=12; break ;;
        install|push|pull|uninstall) crew_seconds=120; crew_device_operation=true; break ;;
        shell) crew_seconds=20; crew_device_operation=true; break ;;
    esac
done
crew_seconds=${CREW_ADB_TIMEOUT_SECONDS:-$crew_seconds}
case "$crew_seconds" in ''|*[!0-9]*|0) echo 'ADB timeout must be a positive number of seconds' >&2; exit 2 ;; esac
[ -x "$crew_binary" ] || { echo 'ADB is not installed; install android-tools in Termux.' >&2; exit 127; }
if [ "$crew_device_operation" = true ]; then
    crew_devices=$(env -u LD_LIBRARY_PATH -u LD_PRELOAD timeout -s KILL 3s "$crew_binary" devices -l) || {
        echo 'ADB 狀態查詢失敗或超時，已停止本次裝置操作。' >&2; exit 4
    }
    if [ -z "$crew_serial" ]; then
        crew_serial=$(printf '%s\n' "$crew_devices" | awk '$2 == "device" && $1 ~ /:[0-9]+$/ {print $1}')
        [ "$(printf '%s\n' "$crew_serial" | awk 'NF {n++} END {print n+0}')" = 1 ] || {
            echo 'ADB 未連線或有多個裝置，請確認無線偵錯 Port；聊天可繼續。' >&2; exit 4
        }
        set -- -s "$crew_serial" "$@"
    fi
    printf '%s\n' "$crew_devices" | awk -v target="$crew_serial" '$1 == target && $2 == "device" {found=1} END {exit !found}' || {
        echo 'ADB 裝置已離線，停止本次操作。請在需要時開啟 Wi-Fi／無線偵錯。' >&2; exit 4
    }
    env -u LD_LIBRARY_PATH -u LD_PRELOAD timeout -s KILL 3s "$crew_binary" -s "$crew_serial" shell true >/dev/null 2>&1 || {
        echo 'ADB 裝置未回應，停止本次操作。請確認 Wi-Fi 與目前 Port。' >&2; exit 4
    }
fi
env -u LD_LIBRARY_PATH -u LD_PRELOAD timeout -s KILL "${crew_seconds}s" "$crew_binary" "$@"
crew_result=$?
if [ "$crew_result" = 124 ] || [ "$crew_result" = 137 ]; then
    echo "ADB 等待超過 ${crew_seconds} 秒，本次操作已停止。需要裝置操作時，請開啟 Wi-Fi／無線偵錯並確認目前 Port。" >&2
    exit 124
fi
exit "$crew_result"
