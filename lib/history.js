const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, cleanUserContent } = require('./config');
const { sessionManager } = require('./session');
const { getCachedTitle } = require('./title');

async function handleListConversations(res) {
  try {
    if (!fs.existsSync(BRAIN_DIR)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ conversations: [] }));
    }

    const dirs = await fsPromises.readdir(BRAIN_DIR, { withFileTypes: true });
    const convList = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const convId = dir.name;
      const logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
      
      let title = '對話 ' + convId.slice(0, 8);
      let updatedAt = 0;

      try {
        const stat = await fsPromises.stat(path.join(BRAIN_DIR, convId));
        updatedAt = stat.mtimeMs;

        // Prefer AI-generated cached title
        const aiTitle = getCachedTitle(convId);
        if (aiTitle) {
          title = aiTitle;
        } else if (fs.existsSync(logPath)) {
          // Fallback: use first user message
          const logStat = await fsPromises.stat(logPath);
          updatedAt = Math.max(updatedAt, logStat.mtimeMs);
          
          const content = await fsPromises.readFile(logPath, 'utf-8');
          const lines = content.trim().split('\n');
          for (const line of lines) {
            try {
              const item = JSON.parse(line);
              if (item.type === 'USER_INPUT' && item.content) {
                const cleaned = cleanUserContent(item.content);
                if (cleaned) {
                  title = cleaned.slice(0, 35) + (cleaned.length > 35 ? '...' : '');
                  break;
                }
              }
            } catch (e) {}
          }
        }

        // Still need log stat for updatedAt even when we have AI title
        if (aiTitle && fs.existsSync(logPath)) {
          try {
            const logStat = await fsPromises.stat(logPath);
            updatedAt = Math.max(updatedAt, logStat.mtimeMs);
          } catch (e) {}
        }

        convList.push({ id: convId, title, updatedAt });
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

module.exports = {
  handleListConversations,
  handleGetHistory,
  handleDeleteConversation,
  handleRewindConversation
};

