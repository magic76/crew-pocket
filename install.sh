#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# Crew Pocket - minimal Android Termux installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/magic76/crew-pocket/main/install.sh | bash
# Optional non-interactive provider selection: CREW_PROVIDER=agy|codex|both|skip
# ==============================================================================

set -euo pipefail

REPOSITORY="https://github.com/magic76/crew-pocket.git"
if [ -d "/data/data/com.termux/files/home" ]; then
    TARGET_DIR="$HOME/agy-web"
    BIN_DIR="$PREFIX/bin"
    IS_TERMUX=true
else
    TARGET_DIR="$HOME/crew-pocket"
    BIN_DIR="$HOME/.local/bin"
    IS_TERMUX=false
fi

say() { printf '%s\n' "$*"; }
fail() { say "\n✗ $*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

choose_provider() {
    if [ -n "${CREW_PROVIDER:-}" ]; then
        PROVIDER="$CREW_PROVIDER"
    elif [ -r /dev/tty ]; then
        say "\n選擇這次要安裝的 AI 引擎："
        say "  1) agy（建議，預設）"
        say "  2) Codex"
        say "  3) 兩者都裝"
        say "  4) 暫時略過，之後可再執行安裝器"
        printf '請輸入 1-4 [1]: ' >/dev/tty
        IFS= read -r reply </dev/tty || reply=""
        case "${reply:-1}" in
            1) PROVIDER=agy ;;
            2) PROVIDER=codex ;;
            3) PROVIDER=both ;;
            4) PROVIDER=skip ;;
            *) fail "選項無效。請重新執行安裝器。" ;;
        esac
    else
        PROVIDER=agy
        say "未偵測到互動終端，將安裝預設 agy；可用 CREW_PROVIDER=codex 或 both 指定。"
    fi

    case "$PROVIDER" in agy|codex|both|skip) ;; *) fail "CREW_PROVIDER 只能是 agy、codex、both 或 skip。" ;; esac
}

install_ai_engine() {
    local provider="$1" package="$2"
    if has "$provider"; then
        say "✓ $provider 已可使用：$("$provider" --version 2>/dev/null | head -n 1 || true)"
        return
    fi
    say "安裝 $provider…"
    npm install -g "$package" || fail "$provider 安裝失敗；請確認網路與 npm 設定後再試。"
    has "$provider" || fail "$provider 安裝完成後仍找不到指令。"
    say "✓ $provider 安裝完成"
}

say "🚀 Crew Pocket 最小安裝器"

if [ "$IS_TERMUX" = true ]; then
    if [ ! -d "$HOME/storage" ]; then
        say "\n[1/5] 請授權手機儲存空間…"
        termux-setup-storage || fail "無法取得儲存空間權限。請允許後重新執行。"
    else
        say "[1/5] ✓ 儲存空間權限已就緒"
    fi
else
    say "[1/5] 非 Termux 環境：略過 Android 儲存空間權限"
fi

say "\n[2/5] 安裝最小執行環境（Node.js、Git、curl）…"
if [ "$IS_TERMUX" = true ]; then
    pkg update -y
    pkg install -y nodejs git curl
else
    has node || fail "請先安裝 Node.js。"
    has git || fail "請先安裝 Git。"
    has curl || fail "請先安裝 curl。"
fi

say "\n[3/5] 下載或更新 Crew Pocket…"
if [ -d "$TARGET_DIR/.git" ]; then
    git -C "$TARGET_DIR" pull --ff-only origin main || fail "既有目錄無法快轉更新；請先處理本機 Git 變更。"
elif [ -e "$TARGET_DIR" ]; then
    fail "$TARGET_DIR 已存在但不是 Crew Pocket Git 專案，為避免覆寫已停止。"
else
    git clone --depth 1 "$REPOSITORY" "$TARGET_DIR"
fi

say "\n[4/5] 設定 AI 引擎…"
choose_provider
case "$PROVIDER" in
    agy) install_ai_engine agy agy ;;
    codex) install_ai_engine codex @mmmbuto/codex-cli-termux ;;
    both)
        install_ai_engine agy agy
        install_ai_engine codex @mmmbuto/codex-cli-termux
        ;;
    skip) say "! 已略過 AI 引擎；完成後請自行安裝至少一個 Provider。" ;;
esac

say "\n[5/5] 建立 crew 指令…"
mkdir -p "$BIN_DIR"
LAUNCHER_SCRIPT="$BIN_DIR/crew"
cat > "$LAUNCHER_SCRIPT" <<'LAUNCHER_EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TARGET_DIR="$HOME/agy-web"
[ -d "$HOME/crew-pocket" ] && TARGET_DIR="$HOME/crew-pocket"

has() { command -v "$1" >/dev/null 2>&1; }
state() { printf '%-14s %s\n' "$1" "$2"; }

doctor() {
    local failed=0 helper="未安裝或未啟動"
    printf 'Crew Pocket 環境檢查\n\n'
    if has node; then state "Node.js" "✓ $(node --version)"; else state "Node.js" "✗ 未安裝"; failed=1; fi
    if [ -f "$TARGET_DIR/server.js" ]; then state "Crew Pocket" "✓ $TARGET_DIR"; else state "Crew Pocket" "✗ 找不到專案"; failed=1; fi
    if has agy; then state "agy" "✓ 已安裝（首次請執行 agy 完成登入）"; else state "agy" "— 未安裝"; fi
    if has codex; then state "Codex" "✓ 已安裝（首次請執行 codex login）"; else state "Codex" "— 未安裝"; fi
    if [ -d "$HOME/storage" ]; then state "儲存空間" "✓ 已授權"; else state "儲存空間" "! 未授權：執行 termux-setup-storage"; fi
    if has curl && curl -fsS --connect-timeout 1 http://127.0.0.1:8766/health >/dev/null 2>&1; then helper="✓ Crew Helper 已連線"; fi
    state "Crew Helper" "$helper（選用：語音、相機、截圖）"
    if pgrep -f 'node server.js' >/dev/null 2>&1; then state "Web 服務" "✓ http://127.0.0.1:8000"; else state "Web 服務" "— 未啟動"; fi
    [ "$failed" -eq 0 ] || exit 1
}

start_server() {
    [ -f "$TARGET_DIR/server.js" ] || { echo "找不到 Crew Pocket：$TARGET_DIR"; exit 1; }
    cd "$TARGET_DIR"
    node scripts/prepare-pwa-cache.js
    pkill -f 'node server.js' 2>/dev/null || true
    setsid node server.js </dev/null >> "$HOME/.agy-web.log" 2>&1 &
    local server_pid=$!
    sleep 1
    if kill -0 "$server_pid" 2>/dev/null; then
        echo "✓ Crew Pocket 已啟動：http://127.0.0.1:8000"
        termux-open-url 'http://127.0.0.1:8000' 2>/dev/null || true
    else
        echo "啟動失敗，請查看 $HOME/.agy-web.log" >&2
        exit 1
    fi
}

case "${1:-start}" in
    start)
        start_server
        ;;
    stop)
        pkill -f 'node server.js' 2>/dev/null || echo "Crew Pocket 未在執行"
        ;;
    status)
        pgrep -af 'node server.js' || echo "Crew Pocket 目前已停止"
        ;;
    doctor) doctor ;;
    update)
        git -C "$TARGET_DIR" pull --ff-only origin main
        node "$TARGET_DIR/scripts/prepare-pwa-cache.js"
        echo "更新完成；請在需要時執行 crew start 套用新版服務。"
        ;;
    apk)
        termux-open-url 'https://github.com/magic76/crew-helper/releases/latest' 2>/dev/null || true
        ;;
    *)
        echo "用法：crew [start|stop|status|doctor|update|apk]"
        exit 1
        ;;
esac
LAUNCHER_EOF
chmod +x "$LAUNCHER_SCRIPT"

say "\n✓ Crew Pocket 已安裝。"
say "下一步："
case "$PROVIDER" in
    agy) say "  1. 執行 agy，完成 Google 登入。" ;;
    codex) say "  1. 執行 codex login，完成 OpenAI 登入。" ;;
    both) say "  1. 執行 agy 與 codex login，完成各自帳號登入。" ;;
    skip) say "  1. 安裝並登入至少一個 AI Provider。" ;;
esac
say "  2. 執行 crew doctor 檢查環境。"
say "  3. 執行 crew start 啟動。"
