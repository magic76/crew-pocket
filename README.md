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

## 🚀 快速啟動 (Quick Start)

### 1. 啟動 Web 服務
```bash
bash ~/start-web.sh
```
或直接執行：
```bash
node ~/agy-web/server.js
```

### 2. 瀏覽器訪問
打開手機或電腦瀏覽器：
```
http://127.0.0.1:8000
```

---

## 🛠️ 技術架構 (Architecture)

- **後端 (Backend)**: Node.js 原生 HTTP + Server-Sent Events (SSE) 雙向管道流 + Resident Process Pool
- **前端 (Frontend)**: 原生 Modular JavaScript (`app.js`, `chat.js`, `tools.js`, `ui.js`) + Tailwind CSS (Glassmorphism 2.0)
- **安全防護 (Security)**: DOMPurify 離線安全消毒 + 沙盒化 Iframe 隔離執行
- **格式支援 (Formats)**: Marked.js + Highlight.js + heic2any
