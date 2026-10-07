#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PREPARE_NODE="$ROOT_DIR/android-wrapper/runtime/scripts/prepare-embedded-node.sh"
APT_BASE="${TERMUX_APT_BASE:-https://packages.termux.dev/apt/termux-main}"
NODE_PACKAGE="${TERMUX_NODE_PACKAGE:-nodejs-lts}"
WORK_DIR="${TERMUX_NODE_WORK_DIR:-$(mktemp -d)}"
KEEP_WORK="${TERMUX_NODE_KEEP_WORK:-0}"

cleanup() {
  if [ "$KEEP_WORK" != "1" ]; then
    rm -rf "$WORK_DIR"
  else
    echo "Keeping Termux package workspace: $WORK_DIR"
  fi
}
trap cleanup EXIT

for command in python3 dpkg-deb patchelf; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for cross-architecture Node packaging." >&2
    exit 1
  }
done

mkdir -p "$WORK_DIR/debs" "$WORK_DIR/root"

python3 - "$APT_BASE" "$NODE_PACKAGE" "$WORK_DIR/debs" <<'PY'
import gzip
import os
import re
import sys
import urllib.request

base, root_package, dest = sys.argv[1:]
index_url = base.rstrip('/') + '/dists/stable/main/binary-aarch64/Packages.gz'
request = urllib.request.Request(index_url, headers={'User-Agent': 'Crew-Runtime-Packager/1'})
with urllib.request.urlopen(request, timeout=60) as response:
    raw = gzip.decompress(response.read()).decode('utf-8', errors='replace')

records = {}
for paragraph in raw.split('\n\n'):
    fields = {}
    current = None
    for line in paragraph.splitlines():
        if not line:
            continue
        if line[0].isspace() and current:
            fields[current] += '\n' + line.strip()
            continue
        if ': ' not in line:
            continue
        key, value = line.split(': ', 1)
        fields[key] = value
        current = key
    name = fields.get('Package')
    if name and fields.get('Filename'):
        records[name] = fields

if root_package not in records:
    raise SystemExit(f'Package not found in Termux index: {root_package}')

def dependency_names(record):
    raw_deps = ','.join(filter(None, [
        record.get('Pre-Depends', ''),
        record.get('Depends', '')
    ]))
    for group in raw_deps.split(','):
        alternatives = []
        for item in group.split('|'):
            name = re.split(r'\s|\(', item.strip(), 1)[0]
            if name:
                alternatives.append(name)
        if not alternatives:
            continue
        selected = next((name for name in alternatives if name in records), None)
        if selected:
            yield selected

selected = []
seen = set()
queue = [root_package, 'bash']
while queue:
    name = queue.pop(0)
    if name in seen:
        continue
    seen.add(name)
    record = records.get(name)
    if not record:
        continue
    selected.append(name)
    queue.extend(dependency_names(record))

os.makedirs(dest, exist_ok=True)
for name in selected:
    record = records[name]
    rel = record['Filename']
    url = base.rstrip('/') + '/' + rel.lstrip('/')
    filename = os.path.join(dest, os.path.basename(rel))
    print(f'Downloading {name} {record.get("Version", "")}: {url}', file=sys.stderr)
    request = urllib.request.Request(url, headers={'User-Agent': 'Crew-Runtime-Packager/1'})
    with urllib.request.urlopen(request, timeout=120) as response, open(filename, 'wb') as output:
        output.write(response.read())

print('\n'.join(selected))
PY

for deb in "$WORK_DIR"/debs/*.deb; do
  dpkg-deb -x "$deb" "$WORK_DIR/root"
done

PREFIX_DIR="$WORK_DIR/root/data/data/com.termux/files/usr"
NODE_BIN="$PREFIX_DIR/bin/node"
if [ ! -f "$NODE_BIN" ]; then
  echo "Extracted Termux payload does not contain $NODE_BIN" >&2
  find "$WORK_DIR/root" -maxdepth 6 -type f -name node -print >&2 || true
  exit 2
fi

NODE_DEB="$(find "$WORK_DIR/debs" -maxdepth 1 -type f -name "${NODE_PACKAGE}_*.deb" -print -quit)"
NODE_VERSION="unknown"
if [ -n "$NODE_DEB" ]; then
  NODE_VERSION="$(dpkg-deb -f "$NODE_DEB" Version 2>/dev/null || true)"
fi

echo "Preparing Android Node payload from Termux $NODE_PACKAGE $NODE_VERSION"
NODE_EMBED_BIN="$NODE_BIN" \
PREFIX="$PREFIX_DIR" \
NODE_EMBED_SKIP_RUN_CHECK=1 \
NODE_EMBED_VERSION="$NODE_VERSION" \
bash "$PREPARE_NODE"
