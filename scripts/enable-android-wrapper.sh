#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROP_DIR="$HOME/.termux"
PROP_FILE="$PROP_DIR/termux.properties"

mkdir -p "$PROP_DIR"
touch "$PROP_FILE"

if grep -q '^allow-external-apps=' "$PROP_FILE"; then
    sed -i 's/^allow-external-apps=.*/allow-external-apps=true/' "$PROP_FILE"
else
    printf '\nallow-external-apps=true\n' >> "$PROP_FILE"
fi

if command -v termux-reload-settings >/dev/null 2>&1; then
    termux-reload-settings || true
fi

cat <<'EOF'
✓ Termux external command integration enabled.

After installing the Crew Pocket APK, also grant:
Android Settings
→ Apps
→ Crew Pocket
→ Permissions
→ Additional permissions
→ Run commands in Termux environment

Then open Crew Pocket again.
EOF
