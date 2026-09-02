#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
#  🚀 Crew Pocket (口袋指揮 2.0) - One-Line Universal Installer
# ==============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/magic76/crew-pocket/main/install.sh | bash
# ==============================================================================

set -e

# ANSI Color Codes
CYAN='\033[0;36m'
GREEN='\033[0;32m'
PURPLE='\033[0;35m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${PURPLE}${BOLD}"
echo "  ____                                ____            _        _   "
echo " / ___|_ __ _____      __            |  _ \ ___   ___| | _____| |_ "
echo "| |   | '__/ _ \ \ /\ / /  _____     | |_) / _ \ / __| |/ / _ \ __|"
echo "| |___| | |  __/\ V  V /  |_____|    |  __/ (_) | (__|   <  __/ |_ "
echo " \____|_|  \___| \_/\_/              |_|   \___/ \___|_|\_\___|\__|"
echo -e "${NC}"
echo -e "${CYAN}🚀 正在準備安裝 Crew Pocket (口袋指揮 2.0) 行動隨身 AI 工作站...${NC}\n"

# 1. Check Operating Environment
IS_TERMUX=false
if [ -d "/data/data/com.termux/files/home" ]; then
    IS_TERMUX=true
    TARGET_DIR="$HOME/agy-web"
    BIN_DIR="$PREFIX/bin"
else
    TARGET_DIR="$HOME/crew-pocket"
    BIN_DIR="/usr/local/bin"
    if [ ! -w "$BIN_DIR" ]; then
        BIN_DIR="$HOME/.local/bin"
        mkdir -p "$BIN_DIR"
    fi
fi

# 2. Storage Permission Check (Termux only)
if [ "$IS_TERMUX" = true ]; then
    echo -e "${YELLOW}📱 [1/5] 檢查手機儲存權限...${NC}"
    if [ ! -d "$HOME/storage" ]; then
        echo -e "   正在請求儲存權限，若手機跳出授權視窗請點擊【允許】..."
        termux-setup-storage || true
        sleep 1
    else
        echo -e "   ${GREEN}✓ 儲存權限已就緒${NC}"
    fi
fi

# 3. System Packages Installation
echo -e "\n${YELLOW}📦 [2/5] 檢查並安裝必要套件 (Node.js, Git, curl)...${NC}"
if [ "$IS_TERMUX" = true ]; then
    pkg update -y > /dev/null 2>&1 || true
    pkg install -y git nodejs curl python > /dev/null 2>&1
else
    if ! command -v node > /dev/null 2>&1 || ! command -v git > /dev/null 2>&1 || ! command -v curl > /dev/null 2>&1; then
        echo "請確保系統已安裝 git, nodejs, curl"
    fi
fi
echo -e "   ${GREEN}✓ 系統環境套件安裝完成${NC}"

# 4. Clone or Update Project
echo -e "\n${YELLOW}📥 [3/5] 下載 / 更新 Crew Pocket 程式庫...${NC}"
if [ -d "$TARGET_DIR/.git" ]; then
    echo -e "   發現既有安裝，正在拉取最新版本代碼..."
    cd "$TARGET_DIR"
    git pull origin main || true
else
    echo -e "   正在下載至 $TARGET_DIR..."
    git clone https://github.com/magic76/crew-pocket.git "$TARGET_DIR"
    cd "$TARGET_DIR"
fi
echo -e "   ${GREEN}✓ 程式庫代碼已同步至最新版${NC}"

# 5. Core AI CLI Providers Discovery & Setup
echo -e "\n${YELLOW}🤖 [4/5] 檢查 AI 核心引擎 (Antigravity / Codex)...${NC}"

AGY_INSTALLED=false
if command -v agy > /dev/null 2>&1; then
    AGY_INSTALLED=true
    echo -e "   ${GREEN}✓ 已偵測到 Antigravity (agy) 核心${NC}"
else
    echo -e "   正在自動安裝預設 AI 引擎 Antigravity (agy)..."
    npm install -g agy > /dev/null 2>&1 || true
    if command -v agy > /dev/null 2>&1; then
        AGY_INSTALLED=true
        echo -e "   ${GREEN}✓ Antigravity (agy) 安裝成功${NC}"
    else
        echo -e "   ${YELLOW}⚠️ agy 自動安裝未完成，可稍後手動執行 npm i -g agy${NC}"
    fi
fi

if command -v codex > /dev/null 2>&1; then
    echo -e "   ${GREEN}✓ 已偵測到 OpenAI Codex CLI${NC}"
fi

# 6. Create Global 'crew' Launcher Command
echo -e "\n${YELLOW}⚙️ [5/5] 設定全域捷徑指令 'crew'...${NC}"
LAUNCHER_SCRIPT="$BIN_DIR/crew"

cat << 'LAUNCHER_EOF' > "$LAUNCHER_SCRIPT"
#!/data/data/com.termux/files/usr/bin/bash
TARGET_DIR="$HOME/agy-web"
[ -d "$HOME/crew-pocket" ] && TARGET_DIR="$HOME/crew-pocket"

case "$1" in
    start)
        echo "🚀 正在背景啟動 Crew Pocket..."
        cd "$TARGET_DIR"
        nohup node server.js > server.log 2>&1 &
        sleep 1
        echo "✓ Crew Pocket 已在背景運行！"
        echo "👉 網址: http://127.0.0.1:8000"
        if command -v termux-open-url > /dev/null 2>&1; then
            termux-open-url http://127.0.0.1:8000
        fi
        ;;
    stop)
        echo "🛑 正在停止 Crew Pocket..."
        pkill -f "node.*server.js" || echo "Crew Pocket 未在運行中"
        ;;
    status)
        if pgrep -f "node.*server.js" > /dev/null; then
            echo "🟢 Crew Pocket 正在運行中 (PID: $(pgrep -f "node.*server.js" | head -n1))"
            echo "👉 網址: http://127.0.0.1:8000"
        else
            echo "⚪ Crew Pocket 目前已停止"
        fi
        ;;
    update)
        echo "🔄 正在更新 Crew Pocket 至最新版本..."
        cd "$TARGET_DIR"
        git pull origin main
        echo "✓ 更新完成！請重啟服務：crew stop && crew"
        ;;
    apk)
        echo "📱 正在開啟 Crew Helper APK 下載頁面..."
        echo "👉 請至: https://github.com/magic76/crew-helper/releases/latest"
        if command -v termux-open-url > /dev/null 2>&1; then
            termux-open-url https://github.com/magic76/crew-helper/releases/latest
        fi
        ;;
    *)
        echo "🚀 正在啟動 Crew Pocket 行動服務 (127.0.0.1:8000)..."
        echo "按 Ctrl+C 可停止服務。"
        cd "$TARGET_DIR"
        if command -v termux-open-url > /dev/null 2>&1; then
            (sleep 2 && termux-open-url http://127.0.0.1:8000) &
        fi
        exec node server.js
        ;;
esac
LAUNCHER_EOF

chmod +x "$LAUNCHER_SCRIPT"
chmod +x /data/data/com.termux/files/home/agy-web/install.sh
echo -e "   ${GREEN}✓ 全域指令 'crew' 建立成功！${NC}"

# 7. Summary & Next Steps
echo -e "\n${GREEN}${BOLD}🎉 恭喜！Crew Pocket 安裝與環境配置全部完成！${NC}\n"
echo -e "${BOLD}📌 常用指令指引：${NC}"
echo -e "  • ${CYAN}crew${NC}          👉 啟動服務並自動打開手機瀏覽器"
echo -e "  • ${CYAN}crew start${NC}    👉 背景常駐啟動"
echo -e "  • ${CYAN}crew stop${NC}     👉 停止服務"
echo -e "  • ${CYAN}crew status${NC}   👉 查看服務狀態"
echo -e "  • ${CYAN}crew update${NC}   👉 一鍵更新到最新版本"
echo -e "  • ${CYAN}crew apk${NC}      👉 安裝 / 更新手機隨身輔助 APK (CrewHelper.apk)"

if [ "$AGY_INSTALLED" = true ]; then
    echo -e "\n${YELLOW}💡 提示：若您是首次使用 agy，請先在終端輸入一次 ${BOLD}agy${NC}${YELLOW} 完成 Google 帳號授權登入。${NC}"
fi

echo -e "\n${PURPLE}現在您可以直接輸入 ${BOLD}crew${NC}${PURPLE} 開始使用！${NC}\n"
