# Crew Pocket (口袋特勤隊 2.0) 🚀

> **Flagship Tactical Mobile AI Assistant running on Android Termux.**  
> 專為行動端量身打造的旗艦級隨身特工 AI 助理。

---

## 🌟 核心特色 (Key Features)

- 🌐 **原生無縫內嵌沙盒 2.0 (Seamless Inline Sandboxes)**：HTML / SVG / Web Audio / Chart.js 產物直接在對話中滿版動態渲染，高度智慧自適應，支援觸控互動、全螢幕大視野與代碼一鍵複製。
- 📱 **滿版極致視野 (Full-Width Top-Header Layout)**：捨棄傳統側邊頭像縮排，採用頂部精緻抬頭，釋放 100% 手機螢幕橫向空間，讓代碼與視覺組件更開闊。
- ⚡ **賽博朋克即時思考跑馬燈 (Cyberpunk Live Ticker)**：AI 思考推理（CoT）、工具呼叫（Tool Call）與文字生成脈絡即時滾動展示。
- 📦 **深度記憶提煉壓縮 (`/compact`)**：一鍵精簡長篇對話核心脈絡，釋放 ~85% Tokens 同時無縫繼承上下文。
- 💬 **支線解答獨立卡片 (`/btw`)**：主副話題精準分離，可折疊收合，保持主線對話乾淨俐落。
- 🎙️ **Gemini 2.0 Flash Realtime 語音對話 (Live Mode)**：低延遲雙向 Web Audio PCM 即時語音串流，支援多種風格音色。
- 🧠 **思考強度自訂 (Thinking Effort)**：3 段式推理深度調節（`Low 極速` / `Medium 平衡` / `High 深度`）。
- 🤖 **全旗艦模型支援**：支援 `Gemini 3.7 Flash`、`Claude Sonnet 4.6`、`Claude Opus 4.6`、`Gemini 3.1 Pro`、`GPT-OSS 120B`。
- 📎 **多模態相機與相簿附加**：支援 iPhone / Android 原生 **HEIC/HEIF** 解碼與 AI 視覺專用輕量自動壓縮。
- 📍 **GPS 即時定位與地圖**：一鍵獲取手機 GPS 並生成可於新分頁開啟的 Google Maps 導航卡片。
- 📁 **Termux 本地檔案總管**：行動端目錄導航、代碼預覽與直接送入 AI 對話。
- 📊 **模型用量監控 (`/usage`)**：即時掌握各模型重置週期與配額進度。
- 🛡️ **會話隔離與無損日誌引擎**：徹底杜絕多 Session 切換串台 Race Condition，並優先讀取完整日誌避免代碼截斷。

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

## ⌨️ 快捷指令清單 (Slash Commands)

| 指令 | 功能說明 | 適用場景 |
| :--- | :--- | :--- |
| `/compact [焦點]` | **對話記憶精簡壓縮** | 當對話太長、Token 消耗過多時，提煉核心脈絡並釋放記憶 |
| `/btw [問題]` | **順帶一提 · 支線解答** | 在主線討論中插入短小問題，生成獨立折疊卡片 |
| `/clear` | **一鍵清空開新對話** | 快速重置目前對話上下文 |
| `/plan [目標]` | **自主架構規劃模式** | 複雜多模組專案逐步拆解 |
| `/goal [目標]` | **自主特勤目標達成** | 高難度、長時程任務不達目的不停止 |

---

## 🛠️ 技術架構 (Architecture)

- **後端 (Backend)**: Node.js 原生 HTTP + Server-Sent Events (SSE) 雙向管道流 + Resident Process Pool
- **前端 (Frontend)**: 原生 Modular JavaScript (`app.js`, `chat.js`, `tools.js`, `ui.js`, `live.js`) + Tailwind CSS (Glassmorphism 2.0)
- **安全防護 (Security)**: DOMPurify 離線安全消毒 + 沙盒化 Iframe 隔離執行
- **格式支援 (Formats)**: Marked.js + Highlight.js + heic2any + Chart.js
