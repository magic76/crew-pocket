# Crew Pocket (口袋特勤隊) 🚀

> **Flagship Tactical Mobile AI Assistant running on Android Termux.**  
> 專為行動端打造的 Antigravity 隨身特工 Web 應用程式。

---

## 🌟 核心特色 (Key Features)

- ⚡ **秒級即時回應**：支援 `Gemini 3.7 Flash`、`Claude Sonnet 4.6`、`Claude Opus 4.6`、`GPT-OSS 120B`。
- 🧠 **思考強度自訂 (Thinking Effort)**：3 段式推理深度調節（`Low 極速` / `Medium 平衡` / `High 深度`）。
- 🔥 **背景進程預熱 (Standby Pre-warming)**：0ms 冷啟動等待，開新對話即刻待命。
- 📎 **多模態相機與相簿附加**：支援 iPhone / Android 原生 **HEIC/HEIF** 解碼與 AI 視覺專用輕量自動壓縮。
- 🎙️ **即時語音轉文字 (STT) ＋ 語音合成朗讀 (TTS)**：支援即時文字轉寫與 1.28x 俐落語音播放。
- 🌐 **前端即時沙盒 (Live Sandbox)**：支援 HTML / SVG / Canvas 互動執行與 Chart.js 動態視覺化圖表。
- 📍 **GPS 即時定位**：一鍵獲取手機 GPS 並生成 Google Maps 導航卡片。
- 📁 **Termux 本地檔案總管**：行動端目錄導航、代碼預覽與直接送入 AI 對話。
- 📊 **模型用量監控 (/usage)**：即時掌握各模型重置週期與配額進度。
- 💬 **支線解答卡片 (/btw)**：主副話題分離與一鍵收合展示。

---

## 📲 Android Termux 安裝與環境設定指南

### 步驟 1：下載並安裝 Termux
> ⚠️ **重要提示**：請**勿**從 Google Play 商店下載（Play 商店版本已停止維護，無法正常更新套件）。

請選擇以下官方管道下載並安裝 Termux：
* 📥 **F-Droid 推薦下載**：[Termux on F-Droid](https://f-droid.org/en/packages/com.termux/)
* 📥 **GitHub Releases**：[Termux GitHub Releases](https://github.com/termux/termux-app/releases) *(下載 `termux-app_v..._universal.apk` 或對應您手機架構的 `arm64-v8a.apk`)*

---

### 步驟 2：初始化 Termux 環境與權限

打開 Termux App，依序執行以下指令：

```bash
# 1. 取得手機儲存空間存取權限（手機彈窗請點「允許」）
termux-setup-storage

# 2. 更新套件庫索引與系統套件
pkg update && pkg upgrade -y

# 3. 安裝 Node.js、Git、Python 與網路工具
pkg install -y git nodejs python curl gh
```

---

### 步驟 3：下載 Crew Pocket 專案

在 Termux 終端中複製本專案：

```bash
git clone https://github.com/magic76/crew-pocket.git ~/agy-web
```

---

## 🚀 啟動與使用 (Usage)

### 1. 啟動 Web 服務
```bash
cd ~/agy-web
node server.js
```
*或是建立背景啟動腳本執行：`bash ~/start-web.sh`*

### 2. 打開手機瀏覽器
在手機瀏覽器輸入網址：
```
http://127.0.0.1:8000
```

### 3. 📱 升級為全螢幕 App（PWA）
1. 在手機 Chrome / Edge / Safari 瀏覽器打開 `http://127.0.0.1:8000`。
2. 點選瀏覽器選單（右上角或底部的 `⋮` / 分享按鈕）。
3. 點擊 **「加到主畫面」 (Add to Home screen)** 或 **「安裝應用程式」**。
4. 手機桌面即會產生 **Crew Pocket** 專屬圖標，點開即享沉浸式無邊框 App 體驗！🎉

---

## 🛠️ 技術架構 (Architecture)

- **後端 (Backend)**: Node.js 原生 HTTP + Server-Sent Events (SSE) 雙向管道流 + Resident Process Pool
- **前端 (Frontend)**: 原生 Modular JavaScript (`app.js`, `chat.js`, `tools.js`, `ui.js`) + Tailwind CSS (Glassmorphism 2.0)
- **安全防護 (Security)**: DOMPurify 離線安全消毒 + 沙盒化 Iframe 隔離執行
- **格式支援 (Formats)**: Marked.js + Highlight.js + heic2any
