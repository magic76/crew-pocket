const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, cleanUserContent } = require('./config');
const { sessionManager } = require('./session');
const { getCachedTitle } = require('./title');
const codexProvider = require('./providers/codex');

// Clean empty or abandoned brain directories (older than 10 mins)
async function cleanOrphanSessions() {
  try {
    if (!fs.existsSync(BRAIN_DIR)) return;
    const dirs = await fsPromises.readdir(BRAIN_DIR, { withFileTypes: true });
    const now = Date.now();
    const TEN_MINS = 10 * 60 * 1000;

    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
      const convId = dir.name;
      const convDir = path.join(BRAIN_DIR, convId);
      const logPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      const titlePath = path.join(convDir, '.auto_title.json');

      try {
        const stat = await fsPromises.stat(convDir);
        if (now - stat.mtimeMs < TEN_MINS) continue; // Keep recent active/standby sessions
        
        // Never delete if conversation has custom title
        if (fs.existsSync(titlePath)) continue;

        let isOrphan = false;
        if (!fs.existsSync(logPath)) {
          isOrphan = true;
        } else {
          const logStat = await fsPromises.stat(logPath);
          if (logStat.size === 0) isOrphan = true;
        }

        if (isOrphan) {
          await fsPromises.rm(convDir, { recursive: true, force: true });
          console.log(`[GC] Cleaned orphan brain directory: ${convId}`);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// Format token counts into clean human-readable strings (e.g. 450 tok, 12.5k tok, 1.2M tok)
function formatTokens(tokens) {
  if (tokens < 1000) return `${tokens} tok`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${(tokens / 1000000).toFixed(2)}M tok`;
}

async function readTranscriptPreview(logPath, stat, maxBytes = 128 * 1024) {
  const bytes = Math.min(stat.size, maxBytes);
  if (bytes === 0) return '';
  const handle = await fsPromises.open(logPath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, 0);
    const content = buffer.toString('utf8');
    // Do not attempt to parse a partially-read JSONL record.
    return stat.size > bytes ? content.slice(0, content.lastIndexOf('\n')) : content;
  } finally {
    await handle.close();
  }
}

// Calculate active context tokens (from last CHECKPOINT to end) vs total history tokens
function calculateContextStats(lines) {
  let totalChars = 0;
  let activeChars = 0;
  let hasCheckpoint = false;
  let userTurns = 0;
  let lastCheckpointIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item.type === 'CHECKPOINT') {
        hasCheckpoint = true;
        lastCheckpointIdx = i;
      } else if (item.type === 'USER_INPUT') {
        userTurns++;
      }
      
      const charCount = (item.content ? item.content.length : 0) + 
                        (item.thinking ? item.thinking.length : 0);
      totalChars += charCount;
    } catch (e) {}
  }

  // Calculate active chars starting from the latest checkpoint or the beginning
  const startIdx = (lastCheckpointIdx !== -1) ? lastCheckpointIdx : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const charCount = (item.content ? item.content.length : 0) + 
                        (item.thinking ? item.thinking.length : 0);
      activeChars += charCount;
    } catch (e) {}
  }

  // Estimate tokens (Approx 1 token per 2.2 characters in mixed CJK/English/Code)
  const totalTokens = Math.max(1, Math.round(totalChars / 2.2));
  const activeTokens = Math.max(1, Math.round(activeChars / 2.2));

  let statusLevel = 'green';
  let statusText = '輕盈流暢 (極速秒回)';
  if (activeTokens > 80000) {
    statusLevel = 'red';
    statusText = '建議精簡 (/compact)';
  } else if (activeTokens > 30000) {
    statusLevel = 'yellow';
    statusText = '上下文累積中';
  }

  const savedPercent = hasCheckpoint && totalTokens > activeTokens
    ? Math.round(((totalTokens - activeTokens) / totalTokens) * 100)
    : 0;

  return {
    active_tokens: activeTokens,
    active_tokens_formatted: formatTokens(activeTokens),
    total_tokens: totalTokens,
    total_tokens_formatted: formatTokens(totalTokens),
    saved_percent: savedPercent,
    status_level: statusLevel,
    status_text: statusText,
    user_turns: userTurns,
    is_compacted: hasCheckpoint
  };
}

async function handleListConversations(res) {
  try {
    if (!fs.existsSync(BRAIN_DIR)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ conversations: [] }));
    }

    // Trigger asynchronous orphan directory cleanup in background
    setTimeout(cleanOrphanSessions, 100);

    const dirs = await fsPromises.readdir(BRAIN_DIR, { withFileTypes: true });
    const convList = [];

    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
      const convId = dir.name;
      const logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
      
      // 🛡️ If no transcript log exists, this is an empty standby/pre-warmed session. Skip it!
      if (!fs.existsSync(logPath)) continue;

      let title = null;
      let updatedAt = 0;
      let hasValidUserMessage = false;

      try {
        const logStat = await fsPromises.stat(logPath);
        updatedAt = logStat.mtimeMs;

        // Prefer cached/custom title
        const cachedTitle = getCachedTitle(convId);
        if (cachedTitle) title = cachedTitle;

        // The drawer needs a title only. Reading whole transcripts just to show
        // turn/token metadata made switching and opening the drawer expensive.
        const content = await readTranscriptPreview(logPath, logStat);
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (item.type === 'USER_INPUT' && item.content) {
              const cleaned = cleanUserContent(item.content);
              if (cleaned) {
                // Ignore internal one-shot system tasks (e.g., memory compact, title generator)
                if (cleaned.startsWith('你是一個專業的對話記憶精簡壓縮器') ||
                    cleaned.startsWith('你是一個對話標題生成器') ||
                    cleaned.startsWith('你是一個資深系統安全審查專家')) {
                  continue;
                }
                hasValidUserMessage = true;
                if (!title) {
                  title = cleaned.slice(0, 35) + (cleaned.length > 35 ? '...' : '');
                }
                break;
              }
            }
          } catch (e) {}
        }

        // 🛡️ Only include conversations that have real user conversations or an explicit custom title
        if (hasValidUserMessage || cachedTitle) {
          convList.push({
            id: convId,
            title: title || ('對話 ' + convId.slice(0, 8)),
            updatedAt,
            is_compacted: false
          });
        }
      } catch (err) {}
    }

    convList.sort((a, b) => b.updatedAt - a.updatedAt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations: convList }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleGetHistory(parsedUrl, res) {
  try {
    const convId = parsedUrl.query.id;
    if (!convId || !/^[a-zA-Z0-9_\-]+$/.test(convId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation id' }));
    }

    let logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript_full.jsonl');
    if (!fs.existsSync(logPath)) {
      logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
    }
    if (!fs.existsSync(logPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        conversation_id: convId,
        title: null,
        context_stats: {
          active_tokens: 0,
          active_tokens_formatted: '0 tok',
          total_tokens: 0,
          total_tokens_formatted: '0 tok',
          saved_percent: 0,
          status_level: 'green',
          status_text: '全新對話',
          user_turns: 0,
          is_compacted: false
        },
        messages: []
      }));
    }

    const content = await fsPromises.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    const messages = [];

    let currentAssistantMsg = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'CHECKPOINT') {
          currentAssistantMsg = null;
          let checkpointSummary = item.content || '';
          const match = checkpointSummary.match(/# Compacted Conversation Context\s*\n\n([\s\S]*)/);
          if (match) checkpointSummary = match[1];
          messages.push({
            role: 'checkpoint',
            content: checkpointSummary.trim(),
            timestamp: item.created_at || new Date().toISOString()
          });
        } else if (item.type === 'USER_INPUT') {
          const text = cleanUserContent(item.content);
          if (text) {
            // Skip redundant /compact user prompt right after a checkpoint
            if (text.startsWith('/compact') && messages.length > 0 && messages[messages.length - 1].role === 'checkpoint') {
              continue;
            }
            currentAssistantMsg = null;
            messages.push({
              role: 'user',
              content: text,
              timestamp: item.created_at || new Date().toISOString()
            });
          }
        } else if (item.type === 'PLANNER_RESPONSE') {
          // Skip redundant confirmation right after a checkpoint
          if (item.content && item.content.startsWith('📦 **對話記憶已成功精簡壓縮！') && messages.length > 0 && messages[messages.length - 1].role === 'checkpoint') {
            continue;
          }
          if (!currentAssistantMsg) {
            currentAssistantMsg = {
              role: 'assistant',
              content: item.content || '',
              tools: [],
              thinking: item.thinking || '',
              timestamp: item.created_at || new Date().toISOString()
            };
            messages.push(currentAssistantMsg);
          }

          if (item.content) currentAssistantMsg.content = item.content;
          if (item.thinking) currentAssistantMsg.thinking = item.thinking;
          if (item.tool_calls && Array.isArray(item.tool_calls)) {
            for (const tc of item.tool_calls) {
              currentAssistantMsg.tools.push({ name: tc.name, args: tc.args });
            }
          }
        }
      } catch (e) {}
    }

    const filteredMessages = messages.filter(m => {
      if (m.role === 'checkpoint') return Boolean(m.content && m.content.trim());
      if (m.role === 'user') return Boolean(m.content && m.content.trim());
      return Boolean(m.content && m.content.trim()) || (m.tools && m.tools.length > 0);
    });

    const title = getCachedTitle(convId);
    const contextStats = calculateContextStats(lines);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      conversation_id: convId,
      title: title || null,
      context_stats: contextStats,
      messages: filteredMessages
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleDeleteConversation(parsedUrl, res) {
  try {
    const convId = parsedUrl.query.id;
    if (!convId || !/^[a-zA-Z0-9_\-]+$/.test(convId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation id' }));
    }

    const targetDir = path.join(BRAIN_DIR, convId);
    if (!targetDir.startsWith(BRAIN_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }

    sessionManager.onSessionDeleted(convId);

    if (fs.existsSync(targetDir)) {
      await fsPromises.rm(targetDir, { recursive: true, force: true });
      console.log(`[Delete] Deleted conversation session: ${convId}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: convId }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleRewindConversation(req, res) {
  try {
    const { parseJsonBody } = require('./config');
    const body = await parseJsonBody(req);
    const { conversation_id, user_turn_index } = body;

    if (!conversation_id || !/^[a-zA-Z0-9_\-]+$/.test(conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation id' }));
    }

    const logDir = path.join(BRAIN_DIR, conversation_id, '.system_generated', 'logs');
    const logPath = path.join(logDir, 'transcript.jsonl');
    const logFullPath = path.join(logDir, 'transcript_full.jsonl');

    // Close any active resident session for this conversation
    sessionManager.closeSession(conversation_id);

    const truncateFile = async (filePath) => {
      if (!fs.existsSync(filePath)) return;
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const keptLines = [];
      let currentTurn = 0;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.type === 'USER_INPUT') {
            if (currentTurn >= user_turn_index) {
              // Reached target user turn, truncate all lines from here onward
              break;
            }
            currentTurn++;
          }
          keptLines.push(line);
        } catch (e) {
          keptLines.push(line);
        }
      }

      await fsPromises.writeFile(filePath, keptLines.join('\n') + (keptLines.length > 0 ? '\n' : ''));
    };

    await truncateFile(logPath);
    await truncateFile(logFullPath);

    console.log(`[Rewind] Rewound conversation ${conversation_id} to turn ${user_turn_index}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id, user_turn_index }));
  } catch (err) {
    console.error('[Rewind Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 🎙️ Synchronize Live Voice Dialogue into Active Brain Session Log
async function handleLiveSync(req, res) {
  try {
    const { parseJsonBody } = require('./config');
    const crypto = require('node:crypto');
    const body = await parseJsonBody(req);
    let { conversation_id, provider, user_message, assistant_message, call_memo } = body;
    const providerId = String(provider || '').trim().toLowerCase();
    let isCodex = providerId === 'codex' || providerId === 'openai' || codexProvider.isCodexSessionPath(conversation_id);
    // Older clients did not send provider. If the id resolves to a Codex
    // session file, route it there instead of creating an AGY orphan.
    if (!isCodex && !providerId && conversation_id) {
      isCodex = Boolean(await codexProvider.findSessionPath(conversation_id));
    }

    if (!user_message && !assistant_message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing message content' }));
    }

    // Codex sessions are owned by CodexProvider. Never create an AGY brain
    // directory when a Live memo belongs to a Codex conversation.
    if (isCodex) {
      if (!conversation_id || codexProvider.isCodexSessionPath(conversation_id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Codex conversation_id 必須是目前的 thread id' }));
      }

      const result = await codexProvider.appendLiveMemo(conversation_id, {
        userMessage: user_message,
        assistantMessage: assistant_message,
        callMemo: call_memo
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        provider: 'codex',
        conversation_id: result.conversationId
      }));
    }

    if (!conversation_id) {
      conversation_id = crypto.randomUUID();
    }

    const logDir = path.join(BRAIN_DIR, conversation_id, '.system_generated', 'logs');
    if (!fs.existsSync(logDir)) {
      await fsPromises.mkdir(logDir, { recursive: true });
    }

    const logPath = path.join(logDir, 'transcript.jsonl');
    const logFullPath = path.join(logDir, 'transcript_full.jsonl');
    const now = new Date().toISOString();

    const userEntry = JSON.stringify({
      created_at: now,
      type: 'USER_INPUT',
      content: `<USER_REQUEST>\n[🎙️ Live 語音] ${user_message || '(語音通話)'}\n</USER_REQUEST>`
    }) + '\n';

    let assistantContent = assistant_message || '';
    if (call_memo) {
      assistantContent = `<!-- CALL_MEMO_DATA:${JSON.stringify(call_memo)} -->\n` + assistantContent;
    }

    const assistantEntry = JSON.stringify({
      created_at: now,
      type: 'PLANNER_RESPONSE',
      content: assistantContent
    }) + '\n';

    await fsPromises.appendFile(logPath, userEntry + assistantEntry, 'utf-8');
    await fsPromises.appendFile(logFullPath, userEntry + assistantEntry, 'utf-8');

    // Notify session manager to keep memory in sync
    sessionManager.closeSession(conversation_id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, provider: 'antigravity', conversation_id }));
  } catch (err) {
    console.error('[Live Sync Error]', err);
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ⚡ Transcribe Live full call audio session and generate structured JSON memo
async function handleLiveTranscribe(req, res) {
  try {
    const { parseJsonBody } = require('./config');
    const body = await parseJsonBody(req);
    const { api_key, audio_base64, mime_type = 'audio/wav', sample_count = 0, duration_sec = 0 } = body;

    const apiKey = (api_key || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'API Key 未設定或無效' }));
    }

    if (!audio_base64 || audio_base64.length < 100) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `音訊數據過短 (Base64 長度: ${audio_base64 ? audio_base64.length : 0})` }));
    }

    // 🌟 Dynamically discover available Flash/GenerateContent models for this API key
    let candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro'];
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.models && Array.isArray(listData.models)) {
          const available = listData.models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));
          const flashModels = available.filter(m => m.includes('flash'));
          if (flashModels.length > 0) {
            candidateModels = [...new Set([...flashModels, ...available])];
          } else if (available.length > 0) {
            candidateModels = [...new Set(available)];
          }
          console.log('[Live Transcribe Discovered Models]', candidateModels.slice(0, 8));
        }
      }
    } catch (e) {
      console.warn('[Model List Fetch Warning]', e.message);
    }

    for (const m of candidateModels) {
      const cleanModel = m.replace(/^models\//, '');
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const payload = {
          contents: [
            {
              parts: [
                {
                  text: "這是一段即時雙向語音通話的錄音檔（包含用戶提問與 AI 助理的回應）。請仔細聆聽音訊，並生成繁體中文（台灣）的通話備忘錄。請嚴格輸出純 JSON 物件（不要 markdown 程式碼區塊標記、不要額外文字）：\n{\n  \"summary\": [\"重點結論 1\", \"重點結論 2\"],\n  \"transcript\": [\n    {\"speaker\": \"user\", \"text\": \"用戶說的話\"},\n    {\"speaker\": \"model\", \"text\": \"AI 回應的話\"}\n  ]\n}"
                },
                {
                  inlineData: {
                    mimeType: mime_type,
                    data: audio_base64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          lastError = `Google API ${cleanModel} HTTP ${response.status}: ${errText}`;
          console.warn(`[Live Transcribe ${cleanModel} HTTP ${response.status}]`, errText);
          continue;
        }

        const data = await response.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
          result = JSON.parse(rawText);
          console.log(`[Live Transcribe Success with ${cleanModel}]`);
          break;
        } else {
          lastError = `Google API ${cleanModel} 回傳結構未包含 text: ` + JSON.stringify(data);
        }
      } catch (e) {
        lastError = `Google API ${cleanModel} 請求異常: ${e.message}`;
        console.warn(`[Live Transcribe ${cleanModel} Exception]`, e.message);
      }
    }

    if (result && (result.summary || result.transcript)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        summary: result.summary || [],
        transcript: result.transcript || [],
        debug: {
          sample_count,
          duration_sec,
          audio_bytes: audio_base64.length,
          lastError: null
        }
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: lastError || 'Google API 未能成功轉錄此音訊',
        debug: {
          sample_count,
          duration_sec,
          audio_bytes: audio_base64.length,
          lastError: lastError
        }
      }));
    }
  } catch (err) {
    console.error('[Live Transcribe Server Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// 🎙️ Quick Speech-to-Text Transcribe (Single Utterance for Prompt Input)
async function handleQuickTranscribe(req, res) {
  try {
    const { parseJsonBody } = require('./config');
    const body = await parseJsonBody(req);
    const { api_key, audio_base64, mime_type = 'audio/wav' } = body;

    const apiKey = (api_key || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: '請先在右上角 Live 設定中填入 Gemini API Key！' }));
    }

    if (!audio_base64 || audio_base64.length < 50) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: '音訊數據為空' }));
    }

    let candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.models && Array.isArray(listData.models)) {
          const flashModels = listData.models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') && m.name.includes('flash'))
            .map(m => m.name.replace(/^models\//, ''));
          if (flashModels.length > 0) candidateModels = [...new Set([...flashModels, ...candidateModels])];
        }
      }
    } catch (e) {}

    let transcribedText = '';
    let lastError = null;

    for (const m of candidateModels) {
      const cleanModel = m.replace(/^models\//, '');
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const payload = {
          contents: [
            {
              parts: [
                {
                  text: "請將這段語音錄音轉錄為繁體中文文字。請直接輸出轉錄出的文字內容，不要包含任何開場白、不要解釋、不要使用 markdown 語法。"
                },
                {
                  inlineData: {
                    mimeType: mime_type,
                    data: audio_base64
                  }
                }
              ]
            }
          ]
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          transcribedText = text.trim();
          break;
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (transcribedText) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, text: transcribedText }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: lastError || '無法識別語音內容' }));
    }
  } catch (err) {
    console.error('[Quick Transcribe Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

module.exports = {
  handleListConversations,
  handleGetHistory,
  handleDeleteConversation,
  handleRewindConversation,
  handleLiveSync,
  handleLiveTranscribe,
  handleQuickTranscribe
};
