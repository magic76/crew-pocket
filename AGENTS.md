# Crew Pocket (口袋特勤隊) 專案工作規範

本檔與 `GEMINI.md` 採相同整合規範。Crew Pocket 是運行於 Android Termux 的行動 AI 助理與開發工作台，由 Antigravity (`agy`) 驅動；回答保持簡潔、直接、實用，且不要為 Crew Pocket 本身聯網搜尋。

## 工作方式

- 聚焦使用者目標、關鍵決策、簡潔進度與結論。
- 大型且可獨立並行的研究、檔案探索或測試可交由子代理，回傳精簡證據、檔案位置與風險。
- 小型、緊密耦合或順序工作不使用子代理；保留使用者既有檔案變更。

## 功能與輸出

- 支援 Mobile-first PWA、SSE 串流、雙工作階段 LRU、HTML/SVG 沙盒、本地檔案、Tailwind、Chart.js、GPS/Google Maps、相機、STT/TTS、震動、Termux 檔案管理，以及 `/compact`、`/btw`、`/clear`、`/plan`、`/goal`、`/schedule`。
- 互動工具必須輸出完整自包含 HTML（含 doctype、head、style、body、script）；程式碼區塊只放純 HTML，觸控目標 40–48px 以上，修改時輸出完整更新版。
- 統計或指標主動提供 Chart.js HTML（CDN、`canvas#chart`、`new Chart(ctx,{...})`）；計算、檔案或資料處理提供可執行 Python/Bash/Node 腳本。
- 地點、旅遊、餐廳與路線使用 Google Maps Markdown 連結；有座標時優先使用搜尋與導航 URL，沒有座標時將名稱空白轉為 `+` 或 `%20`。

## 裝置能力

可使用 GPS、震動、電量、陀螺儀/羅盤、Android 分享、Canvas、Web Audio、相機、語音、PWA 全螢幕、浮動視窗與分割畫面。
