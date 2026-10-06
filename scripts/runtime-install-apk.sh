#!/system/bin/sh
# Invoke with bundled bash: bash ~/install-apk.sh <apk> [wireless-target] [expected-package]
set -eu
crew_apk_path=${1:?Usage: install-apk.sh <apk> [wireless-target] [expected-package]}
crew_device=${2:-}
crew_expected_package=${3:-${EXPECTED_PACKAGE:-}}
[ -f "$crew_apk_path" ] || { echo 'APK not found' >&2; exit 2; }
crew_package=$(aapt dump badging "$crew_apk_path" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -n 1)
printf '%s\n' "$crew_package" | grep -Eq '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' || { echo 'Cannot identify APK package' >&2; exit 3; }
if [ -n "$crew_expected_package" ] && [ "$crew_package" != "$crew_expected_package" ]; then
    echo "Unexpected package: $crew_package (expected $crew_expected_package)" >&2
    exit 3
fi
apksigner verify "$crew_apk_path"
if [ -z "$crew_device" ]; then
    crew_device=$(adb devices | awk '$2 == "device" && $1 ~ /:[0-9]+$/ { print $1 }')
    [ "$(printf '%s\n' "$crew_device" | grep -c .)" = 1 ] || {
        echo 'Need one connected Wireless ADB device; pair this Runtime first, or supply the target.' >&2
        exit 4
    }
fi
[ "$(adb -s "$crew_device" get-state)" = device ] || { echo 'ADB device is unavailable' >&2; exit 4; }
crew_existing=$(adb -s "$crew_device" shell pm path "$crew_package" | tr -d '\r' | sed -n 's/^package://p' | head -n 1)
if [ -n "$crew_existing" ]; then
    crew_tmp=$(mktemp -d "${TMPDIR:-/data/local/tmp}/crew-install.XXXXXX")
    trap 'rm -rf "$crew_tmp"' EXIT
    adb -s "$crew_device" pull "$crew_existing" "$crew_tmp/installed.apk" >/dev/null
    apksigner verify --print-certs "$crew_tmp/installed.apk" | sed -n 's/.*certificate SHA-256 digest: //p' | sort -u > "$crew_tmp/installed.certs"
    apksigner verify --print-certs "$crew_apk_path" | sed -n 's/.*certificate SHA-256 digest: //p' | sort -u > "$crew_tmp/new.certs"
    [ -s "$crew_tmp/new.certs" ] && [ -s "$crew_tmp/installed.certs" ] && cmp -s "$crew_tmp/installed.certs" "$crew_tmp/new.certs" || {
        echo 'Signing certificate differs from installed app. Obtain an APK signed with the existing key; app data was not changed.' >&2
        exit 5
    }
fi
adb -s "$crew_device" install -r "$crew_apk_path"
adb -s "$crew_device" shell pm path "$crew_package"
