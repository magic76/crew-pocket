const { sessionManager } = require('../session');
const { Readable } = require('node:stream');
const { AVAILABLE_MODELS } = require('../config');
const { handleListConversations, handleGetHistory, handleDeleteConversation, handleRewindConversation } = require('../history');
const { handleRenameConversation } = require('../title');
const { handleCompact } = require('../compact');

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
    autoTitle: true
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

async function startTurn({ conversationId, model, effort, prompt, onEvent, onAbort }) {
  const session = await sessionManager.getOrCreateSession(conversationId, model, effort);
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
      const message = session.authError
        ? 'AGY 登入已過期，請在 Termux 互動執行 agy 完成 Google 授權後再試。'
        : `agy process crashed or closed with code ${code}`;
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

let cachedDynamicModels = null;
let lastModelDiscoveryAt = 0;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

async function discoverAgyModels() {
  const now = Date.now();
  if (cachedDynamicModels && (now - lastModelDiscoveryAt < MODEL_CACHE_TTL_MS)) {
    return cachedDynamicModels;
  }

  const staticModels = AVAILABLE_MODELS.filter(model => (model.provider || 'antigravity') === 'antigravity');
  const knownIds = new Set(staticModels.map(m => m.id));

  try {
    const output = await new Promise((resolve, reject) => {
      const { exec } = require('node:child_process');
      exec('agy models', { timeout: 25000 }, (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout || '');
      });
    });

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
  } catch (err) {
    console.warn('[Antigravity Provider] Dynamic model discovery error, falling back to static config:', err.message);
    return staticModels;
  }
}

module.exports = {
  id: 'antigravity',
  metadata,
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
    try {
      require('node:child_process').execSync('command -v agy', { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  },
  stop() { sessionManager.closeActiveSession(); },
  prewarm(model, effort) { return sessionManager.prewarm(model, effort); }
};
