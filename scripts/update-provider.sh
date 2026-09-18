#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

provider="${1:-}"
case "$provider" in
  codex)
    command -v npm >/dev/null 2>&1 || {
      echo "npm is required to update Codex" >&2
      exit 1
    }
    echo "Updating Codex..."
    npm install -g @mmmbuto/codex-cli-termux@latest
    echo "Codex version:"
    codex --version
    ;;

  antigravity|agy)
    command -v curl >/dev/null 2>&1 || {
      echo "curl is required to update Antigravity CLI" >&2
      exit 1
    }
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    echo "Downloading official Antigravity CLI installer..."
    curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location       https://antigravity.google/cli/install.sh       -o "$tmp"
    echo "Updating Antigravity CLI..."
    bash "$tmp"
    echo "Antigravity version:"
    agy --version
    ;;

  *)
    echo "Usage: $0 codex|antigravity" >&2
    exit 2
    ;;
esac
