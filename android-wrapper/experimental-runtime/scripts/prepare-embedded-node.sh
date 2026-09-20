#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/android-wrapper/app/src/main/jniLibs/arm64-v8a"
NODE_BIN="${NODE_EMBED_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ] || [ ! -f "$NODE_BIN" ]; then
    echo "Node binary not found. Install Termux nodejs first." >&2
    exit 1
fi

if ! command -v patchelf >/dev/null 2>&1; then
    echo "patchelf is required. Install it with: pkg install patchelf" >&2
    exit 1
fi

if ! command -v ldd >/dev/null 2>&1; then
    echo "ldd is required." >&2
    exit 1
fi

PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"
mkdir -p "$DEST"
rm -f "$DEST/libnode_exec.so" "$DEST"/libcrew_node_*.so

declare -A SOURCE_BY_NEEDED
declare -A SAFE_BY_NEEDED
declare -a QUEUE

is_system_path() {
    case "$1" in
        /system/*|/apex/*|/vendor/*|/product/*) return 0 ;;
        *) return 1 ;;
    esac
}

safe_name() {
    local name="$1"
    local clean
    clean="$(printf '%s' "$name" | sed 's/[^A-Za-z0-9_]/_/g')"
    printf 'libcrew_node_%s.so' "$clean"
}

resolve_needed() {
    local binary="$1"
    local needed="$2"
    local resolved

    resolved="$(ldd "$binary" 2>/dev/null | awk -v n="$needed" '
        $1 == n && $2 == "=>" { print $3; exit }
        $1 == n && $2 ~ /^\// { print $2; exit }
    ')"

    if [ -z "$resolved" ] || [ "$resolved" = "not" ]; then
        for candidate in             "$PREFIX_DIR/lib/$needed"             "$PREFIX_DIR/lib64/$needed"; do
            if [ -e "$candidate" ]; then
                resolved="$(readlink -f "$candidate")"
                break
            fi
        done
    fi

    [ -n "$resolved" ] && printf '%s\n' "$(readlink -f "$resolved")"
}

collect_binary() {
    local binary="$1"
    local needed resolved safe
    while read -r needed; do
        [ -n "$needed" ] || continue
        resolved="$(resolve_needed "$binary" "$needed" || true)"
        if [ -z "$resolved" ]; then
            echo "warning: could not resolve $needed required by $binary" >&2
            continue
        fi
        if is_system_path "$resolved"; then
            continue
        fi
        case "$resolved" in
            "$PREFIX_DIR"/*) ;;
            *)
                echo "warning: skipping non-Termux dependency $resolved" >&2
                continue
                ;;
        esac
        if [ -n "${SOURCE_BY_NEEDED[$needed]:-}" ]; then
            continue
        fi
        safe="$(safe_name "$needed")"
        SOURCE_BY_NEEDED["$needed"]="$resolved"
        SAFE_BY_NEEDED["$needed"]="$safe"
        QUEUE+=("$needed")
    done < <(patchelf --print-needed "$binary")
}

collect_binary "$NODE_BIN"
index=0
while [ "$index" -lt "${#QUEUE[@]}" ]; do
    needed="${QUEUE[$index]}"
    collect_binary "${SOURCE_BY_NEEDED[$needed]}"
    index=$((index + 1))
done

cp "$NODE_BIN" "$DEST/libnode_exec.so"
chmod 0755 "$DEST/libnode_exec.so"

for needed in "${!SOURCE_BY_NEEDED[@]}"; do
    cp "${SOURCE_BY_NEEDED[$needed]}" "$DEST/${SAFE_BY_NEEDED[$needed]}"
    chmod 0644 "$DEST/${SAFE_BY_NEEDED[$needed]}"
done

patch_binary() {
    local file="$1"
    local needed
    while read -r needed; do
        [ -n "$needed" ] || continue
        if [ -n "${SAFE_BY_NEEDED[$needed]:-}" ]; then
            patchelf --replace-needed "$needed" "${SAFE_BY_NEEDED[$needed]}" "$file"
        fi
    done < <(patchelf --print-needed "$file")
    patchelf --set-rpath '$ORIGIN' "$file"
}

patch_binary "$DEST/libnode_exec.so"

for needed in "${!SOURCE_BY_NEEDED[@]}"; do
    target="$DEST/${SAFE_BY_NEEDED[$needed]}"
    patch_binary "$target"
    patchelf --set-soname "${SAFE_BY_NEEDED[$needed]}" "$target" || true
done

echo "Validating patched Node runtime..."
if ! NODE_VERSION="$(LD_LIBRARY_PATH="$DEST" "$DEST/libnode_exec.so" --version 2>&1)"; then
    echo "Patched embedded Node failed to start:" >&2
    echo "$NODE_VERSION" >&2
    exit 1
fi

echo "✓ Embedded Node runtime prepared"
echo "  node: $DEST/libnode_exec.so"
echo "  version: $NODE_VERSION"
echo "  bundled Termux dependencies: ${#SOURCE_BY_NEEDED[@]}"
echo
echo "Verify dependencies:"
echo "  patchelf --print-needed $DEST/libnode_exec.so"
echo
echo "Then rebuild:"
echo "  gradle -p android-wrapper :app:assembleDebug"
