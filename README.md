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
- 🤖 **雙 Agent Provider**：可在介面中切換既有的 **Antigravity / agy** 與可選的 **OpenAI Codex CLI**；兩者的對話、Session 與歷史紀錄完全隔離。
- 🧩 **持久 Codex 工作階段**：透過 `codex app-server` 常駐連線，支援串流回答、thinking、工具事件、檔案圖片輸入、模型清單、原生 context compaction 與對話回朔。
- 🔐 **Codex 全自動執行模式**：Codex 工作回合使用 `approvalPolicy: never` 與 `dangerFullAccess` sandbox，等效於非互動式全權限開發流程；請只在你信任的本機環境與專案中使用。
- 📈 **Context 與用量**：對話頁與歷史側欄顯示目前 context 用量；Codex 另提供前往 ChatGPT Codex 用量設定頁的連結。
- 🤖 **多模型選單**：Antigravity 提供既有模型；Codex 啟動後會由本機 CLI 動態讀取可用模型（例如 Sol、Terra、Luna）與其支援的 reasoning effort。
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

### 步驟 4（可選）：啟用 OpenAI Codex Provider

Antigravity / agy 仍是預設 Provider，不安裝 Codex 也可以照常使用。若要在模型選單中切換到 Codex，請先在 Termux 完成 Codex CLI 登入，並確認它可執行：

```bash
codex --version
codex login
```

Crew Pocket 會在第一次選用 Codex 時啟動 `codex app-server`。Codex 模型選單由該 CLI 動態取得，因此實際可用模型取決於你的 Codex 帳號與安裝版本。

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

> `/compact` 依目前 Provider 執行：AGY 使用 Crew Pocket 的既有記憶摘要機制；Codex 使用 CLI 原生的 context compaction。

---

## 🧩 Provider 與對話資料

| Provider | 預設狀態 | 對話與 Session | 特有能力 |
| :--- | :--- | :--- | :--- |
| Antigravity / agy | 預設，原有行為不變 | 既有 resident session 與本機 brain 歷史 | `/compact` 記憶摘要、`/usage` 用量彈窗、Gemini Live 語音 |
| OpenAI Codex | 可選 | `codex app-server` thread，與 AGY 完全隔離 | 動態模型、工具／reasoning 串流、context 用量、原生 compact、回朔到任一使用者回合 |

切換 Provider 不會遷移、覆寫或刪除另一個 Provider 的對話。左側歷史列表會以 `AGY` 或 `Codex` 標籤區分來源。

Codex context 用量由 app-server 在工作回合中回報；伺服器剛重啟時，舊 Codex 對話可能先顯示 `—`，完成新的 Codex 回合後即會更新。

---

## 🛠️ 技術架構 (Architecture)

- **後端 (Backend)**: Node.js 原生 HTTP + Server-Sent Events (SSE)；Provider 層將 AGY resident process 與 Codex app-server 事件正規化後送往前端
- **Provider**: `lib/providers/antigravity.js` 保留既有 AGY 實作；`lib/providers/codex.js` 管理持久 JSON-RPC app-server 與 Codex thread
- **前端 (Frontend)**: 原生 Modular JavaScript (`app.js`, `chat.js`, `tools.js`, `ui.js`, `live.js`) + Tailwind CSS (Glassmorphism 2.0)
- **安全防護 (Security)**: DOMPurify 離線安全消毒 + 沙盒化 Iframe 隔離執行
- **格式支援 (Formats)**: Marked.js + Highlight.js + heic2any + Chart.js
