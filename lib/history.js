const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, cleanUserContent } = require('./config');
const { sessionManager } = require('./session');
const { getCachedTitle } = require('./title');

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

      try {
        const stat = await fsPromises.stat(convDir);
        if (now - stat.mtimeMs < TEN_MINS) continue; // Keep recent active/standby sessions

        let isOrphan = false;
        if (!fs.existsSync(logPath)) {
          isOrphan = true;
        } else {
          const content = await fsPromises.readFile(logPath, 'utf-8');
          const hasUserMsg = content.includes('"type":"USER_INPUT"');
          if (!hasUserMsg) isOrphan = true;
        }

        if (isOrphan) {
          await fsPromises.rm(convDir, { recursive: true, force: true });
          console.log(`[GC] Cleaned orphan brain directory: ${convId}`);
        }
      } catch (e) {}
    }
  } catch (e) {}
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

        // Scan transcript for real user messages
        const content = await fsPromises.readFile(logPath, 'utf-8');
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
            updatedAt
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

    const logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ conversation_id: convId, messages: [] }));
    }

    const content = await fsPromises.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    const messages = [];

    let currentAssistantMsg = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'USER_INPUT') {
          const text = cleanUserContent(item.content);
          if (text) {
            currentAssistantMsg = null;
            messages.push({
              role: 'user',
              content: text,
              timestamp: item.created_at || new Date().toISOString()
            });
          }
        } else if (item.type === 'PLANNER_RESPONSE') {
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
      if (m.role === 'user') return Boolean(m.content && m.content.trim());
      return Boolean(m.content && m.content.trim()) || (m.tools && m.tools.length > 0);
    });

    const title = getCachedTitle(convId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversation_id: convId, title: title || null, messages: filteredMessages }));
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
    let { conversation_id, user_message, assistant_message } = body;

    if (!user_message && !assistant_message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing message content' }));
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

    const assistantEntry = JSON.stringify({
      created_at: now,
      type: 'PLANNER_RESPONSE',
      content: assistant_message || ''
    }) + '\n';

    await fsPromises.appendFile(logPath, userEntry + assistantEntry, 'utf-8');
    await fsPromises.appendFile(logFullPath, userEntry + assistantEntry, 'utf-8');

    // Notify session manager to keep memory in sync
    sessionManager.closeSession(conversation_id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id }));
  } catch (err) {
    console.error('[Live Sync Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ⚡ Transcribe Live audio clips using Gemini Flash (ultra-fast transcription)
async function handleLiveTranscribe(req, res) {
  try {
    const { parseJsonBody } = require('./config');
    const body = await parseJsonBody(req);
    const { api_key, user_audio, model_audio } = body;

    const apiKey = api_key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'API key is required for transcription' }));
    }

    const transcribeClip = async (base64Audio) => {
      if (!base64Audio) return '';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: 'audio/wav',
                  data: base64Audio
                }
              },
              {
                text: '請精確轉錄這段語音錄音中的中文內容，只需輸出繁體中文轉錄文字，不要加任何其他備註、解釋或前後綴。'
              }
            ]
          }
        ]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        return (data.candidates[0].content.parts[0].text || '').trim();
      }
      return '';
    };

    const [userText, modelText] = await Promise.all([
      user_audio ? transcribeClip(user_audio) : Promise.resolve(''),
      model_audio ? transcribeClip(model_audio) : Promise.resolve('')
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      user_text: userText,
      model_text: modelText
    }));
  } catch (err) {
    console.error('[Live Transcribe Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleListConversations,
  handleGetHistory,
  handleDeleteConversation,
  handleRewindConversation,
  handleLiveSync,
  handleLiveTranscribe
};

