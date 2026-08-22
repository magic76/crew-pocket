// Lightweight, dependency-free UI localization for Crew Pocket.
// Chinese is the source language; English is an opt-in display locale.
(() => {
  const STORAGE_KEY = 'crew_locale';
  const DEFAULT_LOCALE = (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh-TW';
  let locale = localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALE;
  if (!['zh-TW', 'en'].includes(locale)) locale = 'zh-TW';

  const en = {
    '歷史對話選單': 'Conversation history menu',
    '網路連線正常 (可正常與 AI 對話)': 'Online — ready to chat with AI',
    '手機無網路連線 (請檢查 Wi-Fi/行動數據)': 'Offline — check Wi-Fi or mobile data',
    '離線': 'Offline',
    '點擊修改對話標題': 'Rename this conversation',
    '修改當前對話標題': 'Rename current conversation',
    '點擊切換 AI 模型與思考強度 (Gemini / Claude / GPT)': 'Choose AI model and reasoning effort (Gemini / Claude / GPT)',
    '點擊查看當前對話 Context 用量與記憶提煉': 'View current context usage and compaction',
    '🎙️ Gemini 2.0 Live 原生雙向全雙工通話 (端到端音訊)': '🎙️ Gemini Live two-way full-duplex voice call',
    'Live 通話': 'Live call',
    '🧰 工具與功能選單 (檔案 / 用量 / 錦囊 / 通知)': '🧰 Tools and features (files / usage / guide / notifications)',
    '本地檔案總管': 'Local files',
    '瀏覽 Termux 檔案與專案': 'Browse Termux files and projects',
    '模型配額用量': 'Model usage',
    '查詢今日 / 5hr API 配額': 'Check daily / 5-hour API quota',
    '功能錦囊與指令': 'Features and commands',
    '快捷指令與超能力清單': 'Shortcut commands and capabilities',
    '系統推播通知': 'System notifications',
    '點擊開啟 / 關閉': 'Tap to enable / disable',
    '開啟新對話': 'Start a new conversation',
    '新對話': 'New conversation',
    '你好！已為你開啟新對話。有什麼可以幫你的？': 'Hi! I’ve opened a new conversation. How can I help?',
    '你好！Codex provider 已就緒。有什麼開發任務？': 'Hi! The Codex provider is ready. What would you like to build?',
    '你好！已為你開啟此對話。有什麼可以幫你的？': 'Hi! I’ve opened this conversation. How can I help?',
    '歷史對話紀錄': 'Conversation history',
    '‹ 由右往左滑動即可直接刪除': '‹ Swipe from right to left to delete',
    '載入歷史紀錄中...': 'Loading conversation history...',
    '所有資料 100% 存於手機本地': 'All data stays 100% on this device',
    '你好！我是你的 Crew Pocket 隨身助理 🚀': 'Hi! I’m your Crew Pocket assistant 🚀',
    '我具備': 'I can help with',
    '即時相機視覺辨識': 'live camera vision',
    '雙向中文語音對話': 'two-way voice conversations',
    'Python / Bash 後端沙盒執行': 'Python / Bash sandbox execution',
    'Chart.js 瀏覽器圖表動態渲染': 'interactive Chart.js rendering',
    '以及': 'and',
    'Google Maps 一鍵導航卡片': 'one-tap Google Maps navigation cards',
    '等超能力。': '.',
    '💡 提示詞開頭輸入': '💡 Start a prompt with',
    '可呼叫快捷指令': 'to use shortcut commands',
    '📱 點擊下方膠囊可快速測試各種超能力': '📱 Tap the chips below to try capabilities quickly',
    '回到底部': 'Back to bottom',
    '新訊息': 'New messages',
    '⚡ Crew Pocket 快捷指令': '⚡ Crew Pocket commands',
    '點擊自動填入': 'Tap to insert',
    '逐步規劃複雜任務': 'Plan a complex task step by step',
    '自主達成目標': 'Pursue a goal autonomously',
    '記憶精簡提煉': 'Compact conversation memory',
    '清空畫面 / 開啟新對話': 'Clear the screen / start a new conversation',
    '當前對話 Context 用量監控': 'Current conversation context usage',
    '即時計算活躍 Tokens 與記憶負載': 'Live active-token and memory-load estimate',
    '狀態：全新對話': 'Status: new conversation',
    '模型用量監控': 'Model usage monitor',
    '即時調用 agy /usage 獲取': 'Live data from agy /usage',
    '配額以各模型重置時間為準': 'Quota resets vary by model',
    'AI 模型與思考強度設定': 'AI model and reasoning effort',
    '選擇 Provider': 'Choose provider',
    '選擇思考強度': 'Choose reasoning effort',
    'Gemini Live 語音設定': 'Gemini Live voice settings',
    'Gemini Live 原生雙向全雙工語音（對話流內嵌卡片 + 即時鏡頭視覺辨識）。': 'Gemini Live two-way full-duplex voice (inline conversation card + live camera vision).',
    '選擇 Live 模型：': 'Choose Live model:',
    '選擇音色：': 'Choose voice:',
    '音色: Puck (預設 · 活潑)': 'Voice: Puck (default · lively)',
    '音色: Charon (沉穩磁性)': 'Voice: Charon (calm)',
    '音色: Kore (溫柔親切)': 'Voice: Kore (warm)',
    '音色: Fenrir (低沉雄厚)': 'Voice: Fenrir (deep)',
    '音色: Aoede (明亮悅耳)': 'Voice: Aoede (bright)',
    '安全儲存於手機本機': 'Stored safely on this device',
    '👉 免費申請 API Key': '👉 Get a free API key',
    '儲存並啟動通話': 'Save and start call',
    '語言：繁中': 'Language: English',
    '切換介面語言': 'Switch interface language',
    '繁體中文': 'Traditional Chinese',
    'English': 'English',
    '繁體中文 / English': 'Traditional Chinese / English',
    '順帶一提 / 附帶詢問': 'Ask an aside',
    '設定定時提醒排程': 'Set a scheduled reminder',
    '互動訪談對齊需求': 'Clarify requirements interactively',
    '記憶行為模式': 'Memory behavior mode',
    '精簡對話記憶 / 釋放 Token': 'Compact memory / free tokens',
    '已最佳化壓縮': 'Optimized',
    '移除圖片': 'Remove image',
    '偵測到剪貼簿': 'Clipboard detected',
    '字': 'characters',
    '關閉提示': 'Dismiss',
    '感應並讀取手機剪貼簿': 'Read phone clipboard',
    '感應剪貼簿': 'Read clipboard',
    '即時定位': 'Live location',
    '景點導航': 'Navigate nearby',
    '畫圖表': 'Make a chart',
    '跑 Python': 'Run Python',
    '做網頁': 'Build web UI',
    '系統巡檢': 'System check',
    '深度搜尋': 'Deep search',
    '檔案總管': 'Files',
    '查詢用量': 'Check usage',
    '功能錦囊': 'Guide',
    '附加相簿圖片 (支援 HEIC/JPG/PNG 自動壓縮)': 'Attach image (HEIC/JPG/PNG with automatic compression)',
    '相機即時拍照': 'Take a photo',
    '問任何問題... (Ctrl+Enter 發送)': 'Ask anything... (Ctrl+Enter to send)',
    'Enter 換行 · Ctrl+Enter 發送 ·': 'Enter for a new line · Ctrl+Enter to send ·',
    '隨身助理超能力功能錦囊': 'Pocket assistant capabilities',
    'Termux 行動端專屬強大能力全覽': 'A guide to Crew Pocket’s mobile capabilities',
    '1. 原生無縫內嵌沙盒 2.0 (HTML / SVG / Chart.js / Web Audio)': '1. Inline interactive sandboxes (HTML / SVG / Chart.js / Web Audio)',
    '2. Python / Bash 後端即時直譯執行 (Termux 算力)': '2. Run Python / Bash in Termux',
    '3. Google 地圖導航與景點卡片': '3. Google Maps navigation cards',
    '4. 手機硬體原生整合 (GPS / 震動 / 雙向語音 / 相機)': '4. Native phone integration (GPS / vibration / voice / camera)',
    '5. 專業快捷指令 (/compact, /btw, /plan, /goal, /clear)': '5. Professional shortcuts (/compact, /btw, /plan, /goal, /clear)',
    '6. 滿版極致視野 ＆ 賽博朋克思考跑馬燈': '6. Full-width view and live thinking ticker',
    '請 AI 製作互動小工具、數據圖表或遊戲，系統會': 'Ask AI for an interactive tool, chart, or game and Crew Pocket will',
    '直接在對話氣泡內滿版動態渲染': 'render it interactively inside the conversation',
    '，高度自適應，點擊右上角': ', adapting to the available space. Tap',
    '【全螢幕】': 'Full screen',
    '可另開新分頁操作，點': 'to open it in a new page, or',
    '【代碼】': 'Code',
    '可一鍵複製。': 'to copy it.',
    '演算法計算、正則解析、磁碟巡檢（': 'For calculations, regex parsing, disk checks (',
    '）或腳本處理，點擊代碼右上角': '), or scripts, tap',
    '【執行】': 'Run',
    '秒出結果。': 'to get results in Termux.',
    '推薦餐廳、旅遊行程或交通路線時，AI 會生成': 'For restaurants, travel, or routes, AI creates',
    '一鍵喚醒 Google 地圖 App': 'one-tap Google Maps',
    '的導航卡片，並在新分頁獨立開啟，不中斷對話。': 'navigation cards in a new page without interrupting the conversation.',
    '支援手機相機拍照秒壓縮上傳、中文語音輸入辨識（STT）、語音合成朗讀（TTS）、Gemini Live 雙向語音對話與觸覺震動回饋。': 'Supports camera uploads with compression, speech input (STT), text-to-speech (TTS), Gemini Live voice calls, and haptic feedback.',
    '在輸入框輸入': 'Type',
    '即可快速呼叫：記憶精簡提煉（': 'in the input to use shortcuts: memory compaction (',
    '釋放 ~85% Token）、順帶一提（': 'frees ~85% of tokens), asides (',
    '支線卡片）、自主目標規劃（': 'creates a side card), autonomous planning (',
    '）與一鍵清空重置（': '), and reset (',
    '）。': ').',
    '全新頂部抬頭設計釋放 100% 手機螢幕水平寬度，AI 思考推理與工具呼叫過程透過底部跑馬燈即時視覺化呈現。': 'The full-width header maximizes phone screen space, while AI reasoning and tool calls appear in a live ticker.',
    '當對話輪次漸多、Tokens 累積較大時，執行': 'When a conversation grows long, run',
    '可提煉核心脈絡並釋放 ~85% 負擔，所有歷史對話仍完好保留在畫面上！': 'to retain core context while freeing about 85% of token load; all history remains visible.',
    '活躍 Context 負載:': 'Active context load:',
    '輪對話': 'conversation turns',
    '全新對話': 'New conversation',
    '輕盈流暢 (極速秒回)': 'Light and responsive',
    '建議精簡 (/compact)': 'Compaction recommended (/compact)',
    '上下文累積中': 'Context is growing',
    '等待下一輪取得 Codex 用量': 'Waiting for the next Codex turn to report usage',
    '歷史累積總量': 'Total history',
    '記憶提煉節省率': 'Memory saved',
    '提煉記憶以保持秒級響應': 'Compact memory for fast responses',
    '立即執行 /compact 提煉記憶': 'Run /compact now',
    'AI 模型配額用量監控': 'AI model usage monitor',
    '重新整理': 'Refresh',
    '自訂推理深度與出字速度': 'Customize reasoning depth and response speed',
    '思考強度 (Thinking Effort)': 'Reasoning effort',
    'Termux 本地檔案總管': 'Termux local files',
    '點擊檔案即可一鍵傳給 AI 分析或即時預覽': 'Tap a file to send it to AI or preview it',
    '重新整理目錄': 'Refresh directory',
    '複製內容': 'Copy contents',
    '推薦': 'Recommended',
    '極速混合推理 · 預設推薦': 'Fast hybrid reasoning · recommended default',
    '深度思考 · 代碼與架構大師': 'Deep thinking · code and architecture',
    '最強旗艦 · 複雜邏輯思維': 'Flagship · complex reasoning',
    '深度多模態推理': 'Deep multimodal reasoning',
    '千億級開源大模型': 'Large open-source model',
    '本機 Codex CLI · 全自動權限': 'Local Codex CLI · autonomous permissions',
    '旗艦能力 · 複雜推理與大型開發任務': 'Flagship capability · complex reasoning and large development tasks',
    '能力與速度平衡 · 日常開發推薦': 'Balanced capability and speed · recommended for daily development',
    '快速省資源 · 高頻輕量工作': 'Fast and efficient · frequent lightweight work',
    'OpenAI Codex 模型': 'OpenAI Codex model',
    '預設': 'Default',
    'Low (極速)': 'Low (Fast)',
    'Medium (平衡)': 'Medium (Balanced)',
    'High (深度)': 'High (Deep)',
    '極速 (Low)': 'Fast (Low)',
    '平衡 (Medium)': 'Balanced (Medium)',
    '深度 (High)': 'Deep (High)',
    '極深 (XHigh)': 'Extra deep (XHigh)',
    '最大 (Max)': 'Maximum (Max)',
    '終極 (Ultra)': 'Ultimate (Ultra)',
    '⚡ 0~1s 秒回 · 日常對話': '⚡ Fast responses · everyday chat',
    '⚖️ 基礎推理 · 平衡模式': '⚖️ Balanced reasoning',
    '🧠 深度邏輯 · 複雜架構': '🧠 Deep logic · complex architecture',
    '⚡ 快速回應': '⚡ Fast responses',
    '⚖️ 平衡推理': '⚖️ Balanced reasoning',
    '🧠 深度推理': '🧠 Deep reasoning',
    '🔬 強化推理': '🔬 Enhanced reasoning',
    '🚀 最大推理': '🚀 Maximum reasoning',
    '💫 終極推理': '💫 Ultimate reasoning',
    '系統動作': 'System action',
    '終端指令': 'Terminal command',
    '檢視檔案': 'View file',
    '編輯修改': 'Edit file',
    '寫入建立': 'Create file',
    '代碼搜尋': 'Code search',
    '搜尋檔案': 'Find files',
    '網路檢索': 'Web search',
    '生成圖片': 'Generate image',
    '目錄清單': 'Directory listing',
    '調度代理': 'Delegate agent',
    '執行終端命令': 'Run terminal command',
    '檢視檔案內容': 'View file contents',
    '替換檔案內容': 'Replace file contents',
    '寫入檔案': 'Write file',
    '搜尋代碼庫': 'Search codebase',
    '依名稱查找檔案': 'Find files by name',
    '搜尋網路公開資料': 'Search the public web',
    'AI 圖片生成': 'AI image generation',
    '列出檔案目錄': 'List directory contents',
    '調派子代理協同工作': 'Delegate work to a sub-agent',
    '展開 ▼': 'Expand ▼',
    '收合 ▲': 'Collapse ▲',
    '深度思考推理中...': 'Deep reasoning in progress...',
    '深度思考推理過程': 'Deep reasoning',
    '即時': 'Live',
    '編輯此問題並回溯對話': 'Edit this question and rewind the conversation',
    '編輯回溯': 'Edit & rewind',
    '我': 'Me',
    '順帶一提': 'By the way',
    '語音朗讀': 'Read aloud',
    '朗讀': 'Read aloud',
    '請先等待當前回覆完成或點擊中斷生成！': 'Wait for the current reply to finish or stop generation first.',
    '尚無歷史對話': 'No conversation history yet',
    '刪除中...': 'Deleting...',
    '輪': 'turns',
    '目前': 'Current',
    '修改對話標題': 'Rename conversation',
    '載入失敗': 'Failed to load',
    '載入歷史對話失敗：': 'Failed to load conversation history: ',
    '中斷生成': 'Stop generation',
    '送出': 'Send',
    '思考分析中...': 'Thinking...',
    '順帶一提解答中...': 'Answering your aside...',
    '準備分析任務...': 'Preparing to analyze task...',
    '思考分析': 'Thinking',
    '深度推理': 'Deep reasoning',
    '組織撰寫': 'Writing response',
    '回覆組織撰寫中...': 'Writing response...',
    '連線暫時重置，正在自動補齊完整回覆...': 'Connection reset; restoring the complete response...',
    '已成功同步並補齊完整回覆': 'Response restored successfully',
    '已保留現有回覆內容': 'Current response content was preserved',
    '重整': 'Refresh',
    '重試': 'Retry',
    '標題生成中...': 'Generating title...',
    '⚠️ 當前為新對話，尚未有歷史紀錄可供壓縮。請在對話累積後再執行 `/compact` 進行精簡！': '⚠️ This is a new conversation with no history to compact yet. Continue the conversation, then run `/compact`.',
    '📦 正在深度提煉並精簡壓縮對話記憶...': '📦 Compacting conversation memory...',
    'AI 正在梳理核心目標、已完成模組、關鍵檔案與當前脈絡，為您釋放 Token 並精簡上下文...': 'AI is organizing objectives, completed work, key files, and current context to reduce token load...',
    '⚠️ 手機目前處於離線狀態，請檢查 Wi-Fi 或行動數據連線！': '⚠️ Your phone is offline. Check Wi-Fi or mobile data.',
    '可以開始說話': 'You can start speaking',
    '準備中...': 'Preparing...',
    '點擊切換音色': 'Choose voice',
    '靜音 / 開啟麥克風': 'Mute / enable microphone',
    '靜音': 'Mute',
    '相機': 'Camera',
    '掛斷': 'End call',
    '待命中 (說話時自動發送)': 'Standing by (sends while speaking)',
    '截圖存檔': 'Save snapshot',
    '放大': 'Expand',
    '縮小': 'Minimize',
    '已靜音': 'Muted',
    '關閉相機': 'Turn off camera',
    '通話中': 'In call',
    '聆聽中...': 'Listening...',
    'Gemini 說話中...': 'Gemini is speaking...',
    '連線出錯': 'Connection error',
    '麥克風未開啟': 'Microphone is not enabled',
    '無法開啟相機：': 'Unable to open camera: ',
    '啟動失敗': 'Failed to start',
    '瀏覽器動態渲染視窗': 'Browser rendering window',
    '關閉': 'Close',
    '執行中...': 'Running...',
    '正在 Termux 環境中調度直譯器...': 'Starting the interpreter in Termux...',
    '執行完成': 'Completed',
    '執行異常': 'Execution failed',
    '無輸出內容': 'No output',
    '執行請求失敗': 'Execution request failed',
    '全螢幕': 'Full screen',
    '代碼': 'Code',
    '瀏覽器渲染': 'Render in browser',
    '複製': 'Copy',
    '停止': 'Stop',
    '定位中...': 'Locating...',
    '網頁連結': 'Web link',
    '總結網頁': 'Summarize page',
    '填入': 'Insert',
    '錯誤報錯 (Error/Trace)': 'Error / trace',
    '除錯分析': 'Debug analysis',
    'JSON 結構化資料': 'Structured JSON data',
    '格式美化': 'Format JSON',
    '轉為圖表': 'Turn into chart',
    '程式碼片段': 'Code snippet',
    '解釋代碼': 'Explain code',
    '優化審查': 'Review and optimize',
    '日語內容': 'Japanese text',
    '英文內容': 'English text',
    '翻譯繁中': 'Translate to Chinese',
    '潤飾文法': 'Improve grammar',
    '長文字': 'Long text',
    '萃取重點': 'Extract key points',
    '剪貼簿': 'Clipboard',
    '填入輸入框': 'Insert into input',
    '發送給 AI': 'Send to AI',
    '已複製': 'Copied',
    '複製失敗': 'Copy failed',
    '讀取失敗：': 'Failed to read: ',
    '此資料夾為空': 'This folder is empty',
    '回上一層': 'Go up',
    '進入 ▸': 'Open ▸',
    '傳給 AI': 'Send to AI',
    '預覽內容': 'Preview content',
    '家目錄': 'Home directory'
  };

  const originals = new WeakMap();
  const attributeOriginals = new WeakMap();
  const translatableAttributes = ['title', 'aria-label', 'placeholder', 'alt'];
  const englishQuickPrompts = {
    '/btw 順帶一提，': '/btw By the way, ',
    '請推薦周邊景點並附上 Google 地圖一鍵導航卡片：': 'Recommend nearby places and include one-tap Google Maps navigation cards:',
    '請幫我用 Chart.js 繪製一份圖表：': 'Create a chart with Chart.js:',
    '請寫一段 Python 腳本並輸出結果：': 'Write a Python script and show the output:',
    '請幫我設計一個可互動的 HTML 小工具：': 'Design an interactive HTML tool:',
    '請寫一段 Bash 腳本檢查當前 Termux 系統與磁碟狀態': 'Write a Bash script to check the current Termux system and disk status',
    '請深入搜尋網路並整理完整分析：': 'Search the web in depth and provide a complete analysis:'
  };

  function translate(source, params = {}) {
    const value = locale === 'en' ? (en[source] || source) : source;
    return value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
  }

  function localizeTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
    const parent = node.parentElement;
    if (parent.closest('script, style, pre, code, textarea')) return;
    const current = node.nodeValue;
    const existing = originals.get(node);
    const currentCore = current.trim();
    const existingCore = existing?.trim();
    const existingEnglish = existingCore ? (en[existingCore] || existingCore) : null;
    // Keep the original Chinese source when the current node is either its
    // Chinese or English rendering; only record a new source for real updates.
    if (!existing || (currentCore !== existingCore && currentCore !== existingEnglish)) originals.set(node, current);
    const source = originals.get(node);
    const leading = source.match(/^\s*/)[0];
    const trailing = source.match(/\s*$/)[0];
    const core = source.trim();
    const next = core ? `${leading}${translate(core)}${trailing}` : source;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function localizeAttributes(element) {
    if (!(element instanceof Element)) return;
    let stored = attributeOriginals.get(element);
    if (!stored) { stored = new Map(); attributeOriginals.set(element, stored); }
    for (const attribute of translatableAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const existing = stored.get(attribute);
      const existingEnglish = existing ? (en[existing] || existing) : null;
      if (!existing || (current !== existing && current !== existingEnglish)) stored.set(attribute, current);
      const next = translate(stored.get(attribute));
      if (current !== next) element.setAttribute(attribute, next);
    }
  }

  function translateTree(root = document.body) {
    if (!root) return;
    if (root instanceof Element) localizeAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(localizeTextNode);
    if (root.querySelectorAll) root.querySelectorAll('*').forEach(localizeAttributes);
    (root.querySelectorAll ? root.querySelectorAll('.quick-chip[data-fill]') : []).forEach(element => {
      const source = element.dataset.i18nFill || element.dataset.fill;
      if (!element.dataset.i18nFill) element.dataset.i18nFill = source;
      element.dataset.fill = locale === 'en' ? (englishQuickPrompts[source] || source) : source;
    });
    document.documentElement.lang = locale;
    const languageButton = document.getElementById('language-toggle-btn');
    if (languageButton) {
      languageButton.setAttribute('title', translate('切換介面語言'));
      const label = languageButton.querySelector('[data-language-label]');
      if (label) label.textContent = locale === 'en' ? 'Language: English' : '語言：繁中';
    }
  }

  function setLocale(nextLocale) {
    locale = nextLocale === 'en' ? 'en' : 'zh-TW';
    localStorage.setItem(STORAGE_KEY, locale);
    translateTree(document.body);
    document.dispatchEvent(new CustomEvent('crew:localechange', { detail: { locale } }));
  }

  function observe() {
    if (!document.body || window.__crewI18nObserver) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') localizeTextNode(record.target);
        if (record.type === 'attributes') localizeAttributes(record.target);
        record.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
          else if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: translatableAttributes });
    window.__crewI18nObserver = observer;
  }

  window.t = translate;
  window.getCrewLocale = () => locale;
  window.setCrewLocale = setLocale;
  window.toggleCrewLocale = () => setLocale(locale === 'en' ? 'zh-TW' : 'en');

  document.addEventListener('DOMContentLoaded', () => {
    translateTree(document.body);
    observe();
    document.getElementById('language-toggle-btn')?.addEventListener('click', window.toggleCrewLocale);
  });
})();
