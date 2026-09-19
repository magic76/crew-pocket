const { sessionManager } = require('../session');
const { Readable } = require('node:stream');
const { AVAILABLE_MODELS } = require('../config');
const { handleListConversations, handleGetHistory, handleDeleteConversation, handleRewindConversation } = require('../history');
const { handleRenameConversation } = require('../title');
const { handleCompact } = require('../compact');
const { spawnAgy, execAgy, isAgyAvailable } = require('../runtime/agy-transport');

const metadata = {
  id: 'antigravity',
  label: 'Antigravity',
  shortLabel: 'AGY',
  icon: '✨',
  storagePrefix: 'agy',
  badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  greeting: '你好！已為你開啟新對話。有什麼可以幫你的？',
  capabilities: {
    models: true,
    history: true,
    contextUsage: true,
    rename: true,
    delete: true,
    rewind: true,
    compact: 'checkpoint',
    usage: { mode: 'endpoint', endpoint: '/api/usage' },
    autoTitle: false
  }
};

function callLegacyHandler(handler, { query = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let settled = false;
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload = '') {
        if (settled) return;
        settled = true;
        let data = payload;
        try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
        if (statusCode >= 400) {
          const error = new Error(data?.error || `Antigravity request failed (${statusCode})`);
          error.statusCode = statusCode;
          reject(error);
        } else resolve(data || {});
      }
    };
    const req = body === undefined ? null : Readable.from([JSON.stringify(body)]);
    try {
      Promise.resolve(req ? handler(req, res) : handler({ query }, res)).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function startTurn({ conversationId, model, effort, prompt, workspace, onEvent, onAbort }) {
  const session = await sessionManager.getOrCreateSession(conversationId, model, effort, workspace);
  session.isBusy = true;
  let fullResponse = '';
  let finished = false;

  onEvent({
    type: 'session_started',
    conversationId: session.conversationId,
    model: session.model,
    effort: session.effort
  });

  const cleanup = () => {
    if (finished) return;
    finished = true;
    session.isBusy = false;
    session.emitter.removeListener('event', handleEvent);
    session.emitter.removeListener('raw', handleRaw);
    if (session.process) session.process.removeListener('close', handleClose);
    sessionManager.resetIdleTimer(session);
  };

  const handleEvent = (item) => {
    if (item.event === 'step_update' && item.step_update) {
      const update = item.step_update;
      if (update.step_type === 'agent_response' && update.text_delta) {
        fullResponse += update.text_delta;
        onEvent({ type: 'text_delta', delta: update.text_delta, accumulated: fullResponse });
      } else if (update.step_type === 'thought' || update.thinking_delta || update.thinking) {
        const delta = update.thinking_delta || update.thinking || update.text || '';
        if (delta) onEvent({ type: 'reasoning_delta', delta });
      } else if (update.step_type === 'tool') {
        const toolInfo = update.tool_info || {};
        onEvent({
          type: 'tool',
          state: update.state,
          name: update.tool_name,
          toolId: update.tool_id || update.tool_call_id || update.id || toolInfo.tool_id || null,
          toolGroupId: update.tool_group_id || toolInfo.tool_group_id || null,
          info: toolInfo,
          durationSeconds: update.duration_seconds
        });
      }
      return;
    }

    if (item.event === 'result' && item.result) {
      if (item.result.conversation_id) session.conversationId = item.result.conversation_id;
      if (item.result.thinking) {
        onEvent({ type: 'reasoning_complete', thinking: item.result.thinking });
      }
      if (item.result.response) fullResponse = item.result.response;
      onEvent({
        type: 'turn_completed',
        response: fullResponse,
        conversationId: session.conversationId,
        status: item.result.status
      });
      cleanup();
    }
  };

  const handleRaw = (line) => {
    if (line && line.trim()) console.log(`[Resident agy stdout note] ${line.trim()}`);
  };

  const handleClose = (code) => {
    if (!finished) {
      let message;
      if (session.authError) {
        message = 'AGY 登入已過期，請在 Termux 互動執行 agy 完成 Google 授權後再試。';
      } else if (code === null) {
        message = '後台核心程序已安全休眠（閒置節電或系統回收資源），已自動重連，請直接再次發送訊息。';
      } else {
        message = `agy process crashed or closed with code ${code}`;
      }
      onEvent({ type: 'error', message });
    }
    cleanup();
  };

  session.emitter.on('event', handleEvent);
  session.emitter.on('raw', handleRaw);
  if (session.process) session.process.on('close', handleClose);

  onAbort(() => {
    if (!finished && session.isBusy) sessionManager.closeSession(session.conversationId);
    cleanup();
  });

  const payload = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] }
  };
  session.process.stdin.write(`${JSON.stringify(payload)}\n`);
  return { conversationId: session.conversationId, cleanup };
}


let activeLogin = null;

function agyLoginSnapshot() {
  if (!activeLogin) return { status: 'idle' };
  return {
    sessionId: activeLogin.sessionId,
    status: activeLogin.status,
    url: activeLogin.url || '',
    error: activeLogin.error || '',
    output: activeLogin.output.slice(-3000)
  };
}

function inspectAgyLoginOutput(session, text) {
  session.output = (session.output + text).slice(-12000);

  const urlMatch = session.output.match(/https:\/\/[^\s<>"']+/i);
  if (urlMatch && !session.url) {
    session.url = urlMatch[0].replace(/[),.;]+$/, '');
    session.status = 'awaiting_code';
  }

  if (/authorization code|paste.*code|enter.*code/i.test(session.output)) {
    session.status = 'awaiting_code';
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const item = JSON.parse(line);
      if (item.event === 'init' || item.type === 'init') {
        session.status = 'completed';
        try { session.process.kill('SIGTERM'); } catch (_) {}
        break;
      }
    } catch (_) {}
  }
}

function startLogin() {
  if (activeLogin && ['starting', 'awaiting_code', 'verifying'].includes(activeLogin.status)) {
    return agyLoginSnapshot();
  }
  if (!isAgyAvailable()) {
    throw new Error('Embedded Antigravity runtime is not available');
  }

  const sessionId = `agy_auth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const env = {
    ...process.env,
    SSH_CONNECTION: process.env.SSH_CONNECTION || 'crew-pocket 127.0.0.1 127.0.0.1 22',
    TERM: 'dumb',
    NO_COLOR: '1'
  };
  const args = [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--disable-slash-commands'
  ];
  const child = spawnAgy(args, {
    cwd: process.env.HOME || process.cwd(),
    env
  });

  activeLogin = {
    sessionId,
    process: child,
    status: 'starting',
    url: '',
    error: '',
    output: ''
  };

  child.stdout.on('data', chunk => inspectAgyLoginOutput(activeLogin, chunk.toString('utf8')));
  child.stderr.on('data', chunk => inspectAgyLoginOutput(activeLogin, chunk.toString('utf8')));
  child.once('error', error => {
    if (!activeLogin || activeLogin.sessionId !== sessionId) return;
    activeLogin.status = 'failed';
    activeLogin.error = error.message;
  });
  child.once('close', code => {
    if (!activeLogin || activeLogin.sessionId !== sessionId) return;
    if (activeLogin.status === 'completed' || activeLogin.status === 'cancelled') return;
    activeLogin.status = 'failed';
    activeLogin.error = activeLogin.error || `AGY login process exited with code ${code}`;
  });

  return agyLoginSnapshot();
}

function submitLoginCode(sessionId, code) {
  if (!activeLogin || activeLogin.sessionId !== sessionId) {
    throw new Error('AGY login session not found');
  }
  const value = String(code || '').trim();
  if (!value) throw new Error('Authorization code is required');
  if (!activeLogin.process || activeLogin.process.killed) {
    throw new Error('AGY login process is no longer running');
  }

  activeLogin.process.stdin.write(value + '\n');
  activeLogin.status = 'verifying';
  return agyLoginSnapshot();
}

function cancelLogin(sessionId) {
  if (!activeLogin || (sessionId && activeLogin.sessionId !== sessionId)) {
    return { success: false, status: 'idle' };
  }
  activeLogin.status = 'cancelled';
  try { activeLogin.process?.kill('SIGTERM'); } catch (_) {}
  return { success: true, status: 'cancelled' };
}

let cachedDynamicModels = null;
let lastModelDiscoveryAt = 0;
let modelDiscoveryPromise = null;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

function staticAgyModels() {
  return AVAILABLE_MODELS.filter(model => (model.provider || 'antigravity') === 'antigravity');
}

function refreshAgyModels() {
  if (modelDiscoveryPromise) return modelDiscoveryPromise;
  const now = Date.now();
  const staticModels = staticAgyModels();
  const knownIds = new Set(staticModels.map(m => m.id));
  modelDiscoveryPromise = (async () => {
    const { stdout: output } = await execAgy(['models'], { timeout: 25000 });

    const discovered = [...staticModels];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes('Fetching available models')) continue;
      const parts = trimmed.split(/\s+/);
      const rawId = parts[0];
      if (!rawId) continue;

      // Base model ID (strip -low, -medium, -high for display)
      const baseId = rawId.replace(/-(?:low|medium|high)$/, '');
      if (knownIds.has(baseId)) continue;
      knownIds.add(baseId);

      const displayName = parts.slice(1).join(' ').replace(/\s*\((?:Low|Medium|High)\)$/i, '') || baseId;
      discovered.unshift({
        id: baseId,
        provider: 'antigravity',
        name: displayName,
        desc: '雲端最新同步模型',
        icon: baseId.includes('flash') ? '⚡' : (baseId.includes('pro') ? '🔵' : '✨'),
        badge: '最新',
        badgeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40'
      });
    }

    cachedDynamicModels = discovered;
    lastModelDiscoveryAt = now;
    return discovered;
  })().catch(err => {
    console.warn('[Antigravity Provider] Dynamic model discovery error, falling back to static config:', err.message);
    // Keep a negative result cached for the same TTL as a successful lookup.
    // A broken/absent `agy models` command should not be spawned on every app
    // boot or model-catalog request while the static picker is already usable.
    cachedDynamicModels = staticModels;
    lastModelDiscoveryAt = Date.now();
    return cachedDynamicModels;
  }).finally(() => { modelDiscoveryPromise = null; });
  return modelDiscoveryPromise;
}

async function discoverAgyModels() {
  const now = Date.now();
  if (cachedDynamicModels && (now - lastModelDiscoveryAt < MODEL_CACHE_TTL_MS)) return cachedDynamicModels;
  refreshAgyModels();
  return cachedDynamicModels || staticAgyModels();
}

module.exports = {
  id: 'antigravity',
  metadata,
  fallbackModels: staticAgyModels(),
  startTurn,
  async listModels() {
    return discoverAgyModels();
  },
  async listConversations() {
    const data = await new Promise((resolve, reject) => {
      let statusCode = 200;
      const res = {
        writeHead(code) { statusCode = code; },
        end(payload = '') {
          let parsed;
          try { parsed = payload ? JSON.parse(payload) : {}; } catch (err) { return reject(err); }
          if (statusCode >= 400) return reject(new Error(parsed.error || 'Failed to list Antigravity conversations'));
          resolve(parsed);
        }
      };
      Promise.resolve(handleListConversations(res)).catch(reject);
    });
    return (data.conversations || []).map(conversation => ({ ...conversation, provider: 'antigravity' }));
  },
  async getHistory(conversationId) {
    const history = await callLegacyHandler(handleGetHistory, { query: { id: conversationId } });
    return { ...history, provider: 'antigravity' };
  },
  async deleteConversation(conversationId) {
    await callLegacyHandler(handleDeleteConversation, { query: { id: conversationId } });
    return { localDataDeleted: true, storageFreedBytes: null };
  },
  async rewindConversation(conversationId, userTurnIndex) {
    const data = await callLegacyHandler(handleRewindConversation, {
      body: { conversation_id: conversationId, user_turn_index: userTurnIndex }
    });
    return { conversationId: data.conversation_id || conversationId, removedTurns: null };
  },
  async renameConversation(conversationId, title) {
    return callLegacyHandler(handleRenameConversation, { body: { conversation_id: conversationId, title } });
  },
  async compactConversation(conversationId, { focus, mode, locale } = {}) {
    return callLegacyHandler(handleCompact, {
      body: { conversation_id: conversationId, focus, mode, locale }
    });
  },
  getStatus(conversationId) {
    const session = sessionManager.sessions.get(conversationId);
    return { conversation_id: conversationId, isBusy: Boolean(session && session.isBusy) };
  },
  isAvailable() {
    return isAgyAvailable();
  },
  startLogin,
  getLoginStatus(sessionId) {
    if (!activeLogin || (sessionId && activeLogin.sessionId !== sessionId)) {
      return { status: 'idle' };
    }
    return agyLoginSnapshot();
  },
  submitLoginCode,
  cancelLogin,
  stop() { sessionManager.closeActiveSession(); },
  prewarm(model, effort, workspace) { return sessionManager.prewarm(model, effort, workspace); }
};
