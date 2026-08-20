const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

const PORT = process.env.PORT || 8000;
const HOST = '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const BRAIN_DIR = '/data/data/com.termux/files/home/.gemini/antigravity-cli/brain';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 mins idle sleep

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let done = false;

    const onData = chunk => {
      if (done) return;
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) {
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.destroy();
        reject(new Error('Payload too large'));
      }
    };

    const onEnd = () => {
      if (done) return;
      done = true;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    };

    const onError = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function cleanUserContent(raw) {
  if (!raw) return '';
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (match) return match[1].trim();
  return raw.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
            .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
            .trim();
}

// ==========================================
// 🚀 Persistent Active Session Manager
// ==========================================
class ActiveSessionManager {
  constructor() {
    this.current = null; // { conversationId, process, emitter, isBusy, idleTimer, buffer }
    this.initPromise = null;
  }

  // Get or initialize persistent session
  async getOrCreateSession(targetConversationId, targetModel) {
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch (e) {}
    }

    // If targetConversationId matches current running session AND model matches (if specified), reuse it!
    if (targetConversationId && this.current && this.current.process && !this.current.process.killed) {
      const modelMatches = !targetModel || this.current.model === targetModel;
      if (this.current.conversationId === targetConversationId && modelMatches) {
        this.resetIdleTimer();
        return this.current;
      }
    }

    // Otherwise (new session requested, switching conversation or switching model): spawn new process
    this.closeActiveSession();

    console.log(`[SessionManager] Spawning resident agy process for session: ${targetConversationId || 'NEW'} (Model: ${targetModel || 'default'})`);
    
    // Check if target conversation exists in brain directory
    let validConvId = targetConversationId;
    if (validConvId) {
      const convDir = path.join(BRAIN_DIR, validConvId);
      if (!fs.existsSync(convDir)) {
        console.warn(`[SessionManager] Conversation ${validConvId} directory not found in brain. Starting a new session.`);
        validConvId = null;
      }
    }

    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions'
    ];

    if (targetModel) {
      args.push('--model', targetModel);
    }

    if (validConvId) {
      args.push('--conversation', validConvId);
    }

    const child = spawn('agy', args, {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const sessionObj = {
      conversationId: validConvId || null,
      model: targetModel || 'gemini-3.7-flash-high',
      process: child,
      emitter,
      isBusy: false,
      idleTimer: null,
      buffer: ''
    };

    this.current = sessionObj;
    this.resetIdleTimer();

    let initDone = false;
    let timeoutTimer = null;

    this.initPromise = new Promise((resolve, reject) => {
      timeoutTimer = setTimeout(() => {
        if (!initDone) {
          initDone = true;
          try { child.kill('SIGKILL'); } catch (e) {}
          reject(new Error('Timeout waiting for agy process initialization'));
        }
      }, 15000);

      const onInitData = (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (item.event === 'init' && item.conversation_id) {
              sessionObj.conversationId = item.conversation_id;
              console.log(`[SessionManager] Resident session initialized: ${sessionObj.conversationId}`);
              if (!initDone) {
                initDone = true;
                clearTimeout(timeoutTimer);
                child.stdout.removeListener('data', onInitData);
                resolve();
              }
              return;
            }
          } catch (e) {}
        }
      };

      child.stdout.on('data', onInitData);

      child.once('error', (err) => {
        if (!initDone) {
          initDone = true;
          clearTimeout(timeoutTimer);
          reject(err);
        }
      });

      child.once('close', (code) => {
        if (!initDone) {
          initDone = true;
          clearTimeout(timeoutTimer);
          reject(new Error(`agy process exited prematurely with code ${code}`));
        }
      });
    });

    child.stdout.on('data', (chunk) => {
      sessionObj.buffer += chunk.toString();
      const lines = sessionObj.buffer.split('\n');
      sessionObj.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          emitter.emit('event', item);
        } catch (e) {
          emitter.emit('raw', line);
        }
      }
    });

    child.stderr.on('data', (errChunk) => {
      console.error(`[Resident agy stderr] ${errChunk.toString()}`);
    });

    child.on('close', (code) => {
      console.log(`[SessionManager] Resident process exited with code ${code}`);
      if (this.current === sessionObj) {
        this.current = null;
      }
    });

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
    return sessionObj;
  }

  resetIdleTimer() {
    if (!this.current) return;
    if (this.current.idleTimer) clearTimeout(this.current.idleTimer);
    this.current.idleTimer = setTimeout(() => {
      console.log(`[SessionManager] Session idle for 30m, sleeping process to save battery/RAM.`);
      this.closeActiveSession();
    }, IDLE_TIMEOUT_MS);
  }

  closeActiveSession() {
    if (this.current && this.current.process) {
      if (this.current.idleTimer) clearTimeout(this.current.idleTimer);
      try {
        this.current.process.kill('SIGTERM');
      } catch (e) {}
      this.current = null;
    }
  }

  // Handle deletion of a session
  onSessionDeleted(convId) {
    if (this.current && this.current.conversationId === convId) {
      this.closeActiveSession();
    }
  }
}

const sessionManager = new ActiveSessionManager();

// ==========================================
// 📡 API Handlers
// ==========================================

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

        if (fs.existsSync(logPath)) {
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

    // Filter out completely blank ghost messages
    const filteredMessages = messages.filter(m => {
      if (m.role === 'user') return Boolean(m.content && m.content.trim());
      return Boolean(m.content && m.content.trim()) || (m.tools && m.tools.length > 0);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversation_id: convId, messages: filteredMessages }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Delete a conversation
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

    // Stop resident process if it is running on this session
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

async function handleImageProxy(parsedUrl, res) {
  const imgPath = parsedUrl.query.path;
  if (!imgPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Image not found');
  }

  const resolvedPath = path.resolve(imgPath);
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) && !resolvedPath.startsWith(BRAIN_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(resolvedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Image not found');
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = await fsPromises.readFile(resolvedPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err.message);
  }
}

async function handleUpload(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { imageBase64, filename } = body;
    if (!imageBase64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No image data provided' }));
    }

    const ext = (filename && path.extname(filename)) ? path.extname(filename) : '.jpg';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const targetName = `photo_${Date.now()}${ext}`;
    const targetPath = path.join(UPLOADS_DIR, targetName);

    await fsPromises.writeFile(targetPath, buffer);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      filePath: targetPath,
      url: `/api/image?path=${encodeURIComponent(targetPath)}`
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 📊 Query AGY / Model Quota Usage
async function handleUsage(res) {
  try {
    const child = spawn('agy', ['-p', '/usage'], {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
    }, 12000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const raw = stdout.trim() || stderr.trim();
      const lines = raw.split('\n').filter(l => l.includes('%'));
      const quotas = lines.map(line => {
        const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const pctMatch = parts.find(p => p.includes('%'));
          const percent = pctMatch ? parseInt(pctMatch.replace('%', ''), 10) : 0;
          return {
            model: parts[0],
            type: parts[1] || 'Limit Remaining',
            percent,
            resetAt: parts[parts.length - 1]
          };
        }
        return { raw: line };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: quotas.length > 0,
        raw,
        quotas
      }));
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ⚡ One-Click Code Execution Sandbox
async function handleRunCode(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { code, language } = body;
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No code provided' }));
  }

  const lang = (language || 'javascript').toLowerCase().trim();
  const startTs = Date.now();

  let cmd = 'node';
  let ext = '.js';

  const SCRATCH_DIR = path.join(ROOT_DIR, 'scratch');
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  if (lang.includes('py')) {
    cmd = 'python3';
    ext = '.py';
  } else if (lang.includes('bash') || lang.includes('sh') || lang.includes('shell')) {
    cmd = 'bash';
    ext = '.sh';
  } else {
    cmd = 'node';
    ext = '.js';
  }

  const tempFile = path.join(SCRATCH_DIR, `run_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
  
  try {
    await fsPromises.writeFile(tempFile, code, 'utf-8');

    const child = spawn(cmd, [tempFile], {
      cwd: '/data/data/com.termux/files/home',
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';
    let isKilled = false;

    const timeout = setTimeout(() => {
      isKilled = true;
      try { child.kill('SIGTERM'); } catch (e) {}
    }, 15000); // 15s max execution time

    child.stdout.on('data', chunk => {
      if (stdout.length < 50000) stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      if (stderr.length < 50000) stderr += chunk.toString();
    });

    child.on('close', async (exitCode) => {
      clearTimeout(timeout);
      try { await fsPromises.unlink(tempFile); } catch (e) {}

      const duration_ms = Date.now() - startTs;
      let output = stdout.trim();
      let error = stderr.trim();

      if (isKilled) {
        error = (error ? error + '\n' : '') + '[執行逾時 (超過 15 秒已自動中止)]';
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: exitCode === 0 && !isKilled,
        output: output || (exitCode === 0 ? '(程式執行成功，無輸出內容)' : ''),
        error,
        exit_code: exitCode,
        duration_ms
      }));
    });

    child.on('error', async (err) => {
      clearTimeout(timeout);
      try { await fsPromises.unlink(tempFile); } catch (e) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        output: '',
        error: `無法啟動直譯器 (${cmd}): ${err.message}`,
        exit_code: -1,
        duration_ms: Date.now() - startTs
      }));
    });

  } catch (err) {
    try { await fsPromises.unlink(tempFile); } catch (e) {}
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 🤖 List Available Models
const AVAILABLE_MODELS = [
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash', desc: '極速綜合推理 · 預設推薦', icon: '✨', badge: '推薦', badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: '深度思考 · 代碼與架構大師', icon: '🟣', badge: 'Thinking', badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6', desc: '最強旗艦 · 複雜邏輯思維', icon: '👑', badge: '旗艦', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro', desc: '深度多模態推理', icon: '🔵', badge: 'Pro', badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B', desc: '千億級開源大模型', icon: '🟢', badge: '開源', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
];

function handleGetModels(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ models: AVAILABLE_MODELS }));
}

// SSE Chat using Resident Pipe
async function handleChat(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { prompt, conversation_id, image_path, model } = body;
  if (!prompt && !image_path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Prompt or image is required' }));
  }

  let finalPrompt = prompt || 'Analyze this image';
  if (image_path) {
    finalPrompt = `[Uploaded Image: ${image_path}]\n${finalPrompt}`;
  }

  // Set SSE Headers
  const origin = req.headers.origin;
  const allowOrigin = (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) ? origin : '';
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  res.writeHead(200, headers);

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const session = await sessionManager.getOrCreateSession(conversation_id, model);
    session.isBusy = true;

    sendEvent('init', { conversation_id: session.conversationId, model: session.model });

    let fullResponse = '';

    const onEvent = (item) => {
      if (item.event === 'step_update' && item.step_update) {
        const su = item.step_update;
        if (su.step_type === 'agent_response' && su.text_delta) {
          fullResponse += su.text_delta;
          sendEvent('chunk', { delta: su.text_delta, accumulated: fullResponse });
        } else if (su.step_type === 'thought' || su.thinking_delta || su.thinking) {
          const tDelta = su.thinking_delta || su.thinking || su.text || '';
          if (tDelta) sendEvent('thought', { delta: tDelta });
        } else if (su.step_type === 'tool') {
          sendEvent('tool', {
            state: su.state,
            tool_name: su.tool_name,
            tool_info: su.tool_info,
            duration_seconds: su.duration_seconds
          });
        }
      } else if (item.event === 'result' && item.result) {
        if (item.result.conversation_id) session.conversationId = item.result.conversation_id;
        if (item.result.thinking) sendEvent('thought', { fullThinking: item.result.thinking });
        if (item.result.response && !fullResponse) fullResponse = item.result.response;

        sendEvent('done', {
          response: fullResponse,
          conversation_id: session.conversationId,
          status: item.result.status
        });

        cleanup();
        res.end();
      }
    };

    const onRaw = (line) => {
      fullResponse += line + '\n';
      sendEvent('chunk', { delta: line + '\n', accumulated: fullResponse });
    };

    const onClose = (code) => {
      sendEvent('done', { error: `agy process crashed or closed with code ${code}` });
      cleanup();
      res.end();
    };

    session.emitter.on('event', onEvent);
    session.emitter.on('raw', onRaw);
    if (session.process) session.process.on('close', onClose);

    function cleanup() {
      if (session) {
        session.isBusy = false;
        session.emitter.removeListener('event', onEvent);
        session.emitter.removeListener('raw', onRaw);
        if (session.process) session.process.removeListener('close', onClose);
      }
      sessionManager.resetIdleTimer();
    }

    req.on('close', () => {
      if (session && session.isBusy) {
        console.log(`[Chat Aborted] Client closed connection while session was busy. Stopping active session.`);
        sessionManager.closeActiveSession();
      }
      cleanup();
    });

    const payload = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: finalPrompt }]
      }
    };

    console.log(`[Resident Pipe] Pushing turn to active session (${session.conversationId})...`);
    session.process.stdin.write(JSON.stringify(payload) + '\n');

  } catch (err) {
    console.error('[Chat Error]', err);
    sendEvent('done', { error: err.message });
    res.end();
  }
}

async function handleStatic(pathname, res) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = await fsPromises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

// Abort active generation
async function handleStop(req, res) {
  try {
    console.log('[Stop Request] Aborting active generation session...');
    if (sessionManager.current) {
      sessionManager.closeActiveSession();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Generation interrupted' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/conversations' && req.method === 'GET') {
    return handleListConversations(res);
  } else if (pathname === '/api/history' && req.method === 'GET') {
    return handleGetHistory(parsedUrl, res);
  } else if (pathname === '/api/conversation' && req.method === 'DELETE') {
    return handleDeleteConversation(parsedUrl, res);
  } else if (pathname === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res);
  } else if (pathname === '/api/stop' && req.method === 'POST') {
    return handleStop(req, res);
  } else if (pathname === '/api/upload' && req.method === 'POST') {
    return handleUpload(req, res);
  } else if (pathname === '/api/run-code' && req.method === 'POST') {
    return handleRunCode(req, res);
  } else if (pathname === '/api/models' && req.method === 'GET') {
    return handleGetModels(res);
  } else if (pathname === '/api/usage' && req.method === 'GET') {
    return handleUsage(res);
  } else if (pathname === '/api/image' && req.method === 'GET') {
    return handleImageProxy(parsedUrl, res);
  } else {
    return handleStatic(pathname, res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(`🚀 Antigravity Web UI (Resident Pipe) at: http://${HOST}:${PORT}`);
  console.log(`=================================================`);
});
