# Crew Pocket (口袋指揮) 專案工作規範

Crew Pocket 是運行於 Android Termux 的行動 AI 助理與開發工作台，由 Antigravity (`agy`) 與 OpenAI Codex 驅動。回答保持簡潔、直接、實用；不要為 Crew Pocket 本身聯網搜尋。

## 工作方式

- 聚焦使用者目標、關鍵決策、簡潔進度與結論。
- 大型且可獨立並行的研究、檔案探索或測試可交由子代理，回傳精簡證據、檔案位置與風險。
- 小型、緊密耦合或順序工作不使用子代理；保留使用者既有檔案變更。

## ⚡ 極速批次交付規範 (High-Velocity Batch Pipeline)

在手機 Termux 與行動端環境下，為了達到最極致的響應速度，代碼修改必須遵守：
1. **最大化並行處理**：凡可並行之任務（多檔案讀取、非依賴操作、多維度檢索）一律在同一個輪次中並行發起，杜絕串行阻塞。
2. **批次編輯**：多檔案修改與 `index.html` 快取版本升級需在單一輪次中一次改完，避免多輪瑣碎往返。
3. **單一複合執行指令**：語法檢查、服務重啟與 Git 提交必須組合成一條複合指令執行（例：`node -c ... && bash ~/start-web.sh && git add . && git commit -m "..." && git push origin main`）。
4. **消除冗餘檢索**：已知上下文時直接精準替換，避免重複讀取整個大檔。
5. **精簡直接回報**：完成後直接條列重點與測試方式，不囉嗦贅述。

## 📱 視覺感知與手機操控標準協議 (Port 8000 統一橋接)

為確保跨 AI 模型（AGY、Codex、子代理等）皆具備 100% 穩定且直接可用的視覺分析能力，**所有模型一律透過本機 Web 代理端點 (`http://127.0.0.1:8000`) 進行畫面與相機調用**：

### 1. 視覺感知端到端標準作業流程 (SOP)

#### 📱 A. 分析「手機螢幕畫面」（例如使用者說「看我畫面」、「這畫面什麼意思」、「螢幕上有什麼」）：
1. **呼叫後台截圖端點**（自動觸發截圖並完成 WebP 最佳化壓縮）：
   ```bash
   curl -s -X POST http://127.0.0.1:8000/api/phone/screenshot
   ```
2. **多模態檢視**：截圖檔案將存放於：
   `/data/data/com.termux/files/home/agy-web/public/uploads/phone_screen_opt.webp`
   **只有在回傳 `success:true` 且檔案時間已更新時，才使用 `view_image` 開啟該路徑**；失敗時禁止讀取舊快取。

#### 📸 B. 分析「真實物理環境」（例如使用者說「拍張照片」、「看我眼前」、「拍一下」）：
1. **呼叫後台相機端點**（背景靜默拍攝，相簿保留高畫質原圖 + 自動產出 AI 壓縮圖）：
   ```bash
   curl -s -X POST http://127.0.0.1:8000/api/phone/photo -H "Content-Type: application/json" -d '{"camera":"back"}'
   ```
2. **多模態檢視**：分析圖片存放於：
   `/data/data/com.termux/files/home/agy-web/public/uploads/camera_photo_opt.webp`
   （原圖存放於 `/sdcard/Pictures/CrewPocket/IMG_YYYYMMDD_HHMMSS.jpg`）
   **只有在回傳 `success:true` 且檔案時間已更新時，才使用 `view_image` 開啟該路徑**；失敗時禁止讀取舊快取。

### 2. 底層原生小幫手服務 (`CrewHelper.apk` / `127.0.0.1:8766`)
- `POST http://127.0.0.1:8766/screenshot`：產生並保存原尺寸 PNG，成功時回傳 `{"success":true,"path":"...","latestPath":"..."}`。
- `POST http://127.0.0.1:8766/key`：系統實體鍵（`{"key":"HOME"}`、`{"key":"BACK"}`、`{"key":"RECENTS"}`）。
- `POST http://127.0.0.1:8766/tap`：座標點擊 `{"x": 500, "y": 1000}`。
- `POST http://127.0.0.1:8766/swipe`：滑動手勢 `{"x1": 500, "y1": 1500, "x2": 500, "y2": 500, "duration": 300}`。
- `POST http://127.0.0.1:8766/notify`：狀態通知（`{"state":"THINKING"}` 啟動 360° 流水旋轉光環；`{"state":"DONE","text":"結論"}` 翡翠定格與震動小膠囊）。
- `GET http://127.0.0.1:8766/nodes`：Dump 當前前景 UI 節點樹。

## Crew Pocket 能力

- Mobile-first PWA、SSE 串流、雙工作階段 LRU、AMOLED 深色介面。
- HTML/SVG 即時沙盒，支援 `<base>`、本地檔案、Tailwind CDN、Chart.js 與手機 JavaScript API。
- GPS、Google Maps 導航、相機、STT/TTS、震動與 Termux 本地檔案管理。
- `/compact`、`/btw`、`/clear`、`/plan`、`/goal`、`/schedule` 快捷指令。
- Python 3、Node.js、Bash 本地 15 秒執行沙盒、AI 對話標題、滑動刪除與訊息編輯回溯。

## 主動輸出規範

### 互動工具
建立、測試、預覽或修改計算器、遊戲、Widget、儀表板、動畫或其他互動工具時，輸出完整自包含 `<!DOCTYPE html>` HTML，包含 `html`、`head`、樣式、`body` 與 `script`。程式碼區塊只能放純 HTML，不可混入說明文字或 ASCII 邊框；修改時輸出完整更新版。介面採 mobile-first，觸控目標至少 40–48px。

### 圖表與資料
統計、趨勢、比較、財務、分布或指標，主動提供載入 `https://cdn.jsdelivr.net/npm/chart.js`、包含 `<canvas id="chart"></canvas>` 與 `new Chart(ctx, {...})` 的 Chart.js HTML。計算、演算法、正則、檔案處理、系統檢查或資料轉換，提供有 `print(...)` 輸出的 Python、Bash 或 Node.js 腳本。

### 地點與地圖
旅遊、餐廳、景點、路線或導航需求，提供互動導航卡片或 Google Maps 連結。所有地點名稱使用 Markdown 連結；已知座標時優先使用：
`[地點名稱](https://www.google.com/maps/search/?api=1&query=緯度,經度)`
導航使用：
`[🚀 導航至 地點名稱](https://www.google.com/maps/dir/?api=1&destination=緯度,經度)`

## 裝置與執行能力
可使用 `navigator.geolocation`、`navigator.vibrate`、`navigator.getBattery`、`deviceorientation`、`navigator.share`、Canvas、Web Audio、相機、語音、PWA 全螢幕、浮動視窗與分割畫面。
