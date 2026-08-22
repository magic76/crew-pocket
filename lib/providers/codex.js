const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AVAILABLE_MODELS } = require('../config');

const CODEX_SESSIONS_DIR = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.codex', 'sessions');

const metadata = {
  id: 'codex',
  label: 'OpenAI Codex',
  shortLabel: 'Codex',
  icon: '🧩',
  storagePrefix: 'codex',
  badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  greeting: '你好！Codex provider 已就緒。有什麼開發任務？',
  capabilities: {
    models: true,
    history: true,
    contextUsage: true,
    rename: true,
    delete: true,
    rewind: true,
    compact: 'native',
    usage: { mode: 'external-link', url: 'https://chatgpt.com/codex/settings/usage' },
    autoTitle: false
  }
};

class CodexProvider {
  constructor() {
    this.id = 'codex';
    this.metadata = metadata;
    this.fallbackModels = AVAILABLE_MODELS.filter(model => model.provider === 'codex');
    this.process = null;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.nextRequestId = 1;
    this.pending = new Map();
    this.turns = new Map();
    this.usageByThread = new Map();
    this.usageFileState = new Map();
    this.turnCountByThread = new Map();
    this.startPromise = null;
  }

  async ensureStarted() {
    if (this.process && !this.process.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
        cwd: '/data/data/com.termux/files/home',
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.process = child;
      let settled = false;

      child.stdout.on('data', chunk => this.handleOutput(chunk));
      child.stderr.on('data', chunk => console.error(`[Codex app-server stderr] ${chunk.toString()}`));
      child.on('error', err => {
        if (!settled) { settled = true; reject(err); }
        this.handleExit(err);
      });
      child.on('close', code => {
        const err = new Error(`Codex app-server exited with code ${code}`);
        if (!settled) { settled = true; reject(err); }
        this.handleExit(err);
      });

      this.request('initialize', {
        clientInfo: { name: 'crew_pocket', title: 'Crew Pocket', version: '0.1.0' }
      }).then(() => {
        this.notify('initialized', {});
        settled = true;
        resolve();
      }).catch(err => {
        if (!settled) { settled = true; reject(err); }
      });
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  request(method, params = {}) {
    if (!this.process || this.process.killed) return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method, params = {}) {
    if (this.process && !this.process.killed) {
      this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
    }
  }

  handleOutput(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this.handleMessage(JSON.parse(line)); }
      catch (_) { console.log(`[Codex app-server stdout note] ${line.trim()}`); }
    }
  }

  handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    const params = message.params || {};
    const threadId = params.threadId || (params.thread && params.thread.id);
    const active = threadId && this.turns.get(threadId);
    if (message.method === 'thread/tokenUsage/updated' && threadId) {
      const stats = this.normalizeTokenUsage(params.tokenUsage);
      this.usageByThread.set(threadId, stats);
      if (active) active.emit({ type: 'context_usage', stats });
      return;
    }
    if (!active) return;
    const emit = active.emit;
    const item = params.item || {};

    switch (message.method) {
      case 'item/agentMessage/delta': {
        const delta = params.delta || '';
        active.response += delta;
        emit({ type: 'text_delta', delta, accumulated: active.response });
        break;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        if (params.delta) emit({ type: 'reasoning_delta', delta: params.delta });
        break;
      case 'item/started':
      case 'item/completed':
        if (item.type === 'contextCompaction') {
          if (message.method === 'item/completed') active.compacted = true;
          emit({
            type: 'compaction',
            state: message.method === 'item/started' ? 'running' : 'completed'
          });
          break;
        }
        if (item.type && !['agentMessage', 'reasoning', 'userMessage'].includes(item.type)) {
          emit({
            type: 'tool',
            state: message.method === 'item/started' ? 'running' : (item.status || 'completed'),
            name: item.type,
            info: { parameters: this.toolParameters(item), output: item.aggregatedOutput || item.output || null },
            durationSeconds: item.durationMs ? item.durationMs / 1000 : undefined
          });
        }
        if (message.method === 'item/completed' && item.type === 'agentMessage') {
          const text = this.itemText(item);
          if (text) active.response = text;
        }
        break;
      case 'error':
        emit({ type: 'error', message: params.error?.message || params.message || 'Codex turn failed' });
        break;
      case 'turn/completed': {
        const status = params.turn?.status || 'completed';
        const error = params.turn?.error;
        if (error) {
          active.error = new Error(error.message || 'Codex turn failed');
          emit({ type: 'error', message: active.error.message });
        } else emit({ type: 'turn_completed', conversationId: threadId, response: active.response, status });
        this.turns.delete(threadId);
        active.resolve();
        break;
      }
    }
  }

  toolParameters(item) {
    if (item.command) return { command: item.command, cwd: item.cwd };
    if (item.changes) return { changes: item.changes };
    return item.arguments || item.input || {};
  }

  itemText(item) {
    if (typeof item.text === 'string') return item.text;
    if (!Array.isArray(item.content)) return '';
    return item.content.map(part => part.text || '').join('');
  }

  normalizeTokenUsage(tokenUsage = {}) {
    const last = tokenUsage.last || tokenUsage.last_token_usage || {};
    const total = tokenUsage.total || tokenUsage.total_token_usage || {};
    const activeTokens = last.inputTokens ?? last.input_tokens ?? 0;
    const totalTokens = total.totalTokens ?? total.total_tokens ?? 0;
    const contextWindow = tokenUsage.modelContextWindow ?? tokenUsage.model_context_window ?? 0;
    const ratio = contextWindow > 0 ? activeTokens / contextWindow : 0;
    const statusLevel = ratio >= 0.8 ? 'red' : ratio >= 0.5 ? 'yellow' : 'green';
    return {
      active_tokens: activeTokens,
      active_tokens_formatted: this.formatTokens(activeTokens),
      total_tokens: totalTokens,
      total_tokens_formatted: this.formatTokens(totalTokens),
      context_window: contextWindow,
      context_window_formatted: contextWindow ? this.formatTokens(contextWindow) : '—',
      saved_percent: 0,
      status_level: statusLevel,
      status_text: statusLevel === 'red' ? '建議精簡 (/compact)' : statusLevel === 'yellow' ? '上下文累積中' : '輕盈流暢',
      provider: 'codex'
    };
  }

  formatTokens(value) {
    if (!Number.isFinite(value)) return '—';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M tok`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K tok`;
    return `${value} tok`;
  }

  handleExit(error) {
    if (!this.process) return;
    this.process = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const active of this.turns.values()) {
      active.emit({ type: 'error', message: error.message });
      active.resolve();
    }
    this.turns.clear();
  }

  async startTurn({ conversationId, model, effort, prompt, imagePath, onEvent, onAbort }) {
    await this.ensureStarted();
    const codexModel = model && model !== 'codex-default' ? model : undefined;
    let threadId = conversationId;
    if (threadId) {
      const result = await this.request('thread/resume', { threadId });
      threadId = result?.thread?.id || threadId;
    } else {
      const result = await this.request('thread/start', {
        model: codexModel,
        cwd: '/data/data/com.termux/files/home'
      });
      threadId = result.thread.id;
    }

    onEvent({ type: 'session_started', conversationId: threadId, model, effort });
    const input = [{ type: 'text', text: prompt }];
    if (imagePath) input.push({ type: 'localImage', path: imagePath });

    let resolveTurn;
    const completed = new Promise(resolve => { resolveTurn = resolve; });
    const active = { emit: onEvent, response: '', turnId: null, resolve: resolveTurn };
    this.turns.set(threadId, active);
    let result;
    try {
      result = await this.request('turn/start', {
        threadId,
        input,
        model: codexModel,
        effort: effort || undefined,
        cwd: '/data/data/com.termux/files/home',
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' }
      });
    } catch (err) {
      this.turns.delete(threadId);
      throw err;
    }
    active.turnId = result?.turn?.id;
    onAbort(() => this.interrupt(threadId, active.turnId));
    await completed;
    return { conversationId: threadId };
  }

  async interrupt(threadId, turnId) {
    if (!threadId || !turnId || !this.process) return;
    try { await this.request('turn/interrupt', { threadId, turnId }); } catch (_) {}
  }

  async compactConversation(threadId, { locale = 'zh-TW', onEvent = () => {} } = {}) {
    if (!threadId) throw new Error('Missing Codex thread id');
    await this.ensureStarted();
    if (this.turns.has(threadId)) throw new Error('Codex thread is currently busy');

    const resumed = await this.request('thread/resume', { threadId });
    const resumedThreadId = resumed?.thread?.id || threadId;
    let resolveCompact;
    let rejectCompact;
    const completed = new Promise((resolve, reject) => {
      resolveCompact = resolve;
      rejectCompact = reject;
    });
    const active = {
      emit: onEvent,
      response: '',
      turnId: null,
      compacted: false,
      resolve: resolveCompact
    };
    this.turns.set(resumedThreadId, active);

    const timeout = setTimeout(() => {
      if (this.turns.get(resumedThreadId) !== active) return;
      this.turns.delete(resumedThreadId);
      rejectCompact(new Error('Codex compaction timed out'));
    }, 120000);

    try {
      await this.request('thread/compact/start', { threadId: resumedThreadId });
      await completed;
      if (active.error) throw active.error;
      if (!active.compacted) throw new Error('Codex compaction did not complete');
      const isEnglish = locale === 'en';
      return {
        conversationId: resumedThreadId,
        summary: isEnglish
          ? 'Codex used native context compaction to condense earlier conversation content while keeping the context needed to continue the current work.'
          : 'Codex 已使用原生 context compaction 精簡較早的對話內容，並保留繼續執行目前工作的必要脈絡。',
        message: isEnglish ? 'Codex conversation context compacted successfully.' : 'Codex 對話上下文已成功精簡！'
      };
    } catch (err) {
      if (this.turns.get(resumedThreadId) === active) this.turns.delete(resumedThreadId);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async rewindConversation(threadId, userTurnIndex) {
    if (!threadId) throw new Error('Missing Codex thread id');
    if (!Number.isInteger(userTurnIndex) || userTurnIndex < 0) throw new Error('Invalid user turn index');
    await this.ensureStarted();
    if (this.turns.has(threadId)) throw new Error('Codex thread is currently busy');

    const readResult = await this.request('thread/read', { threadId, includeTurns: true });
    const thread = readResult?.thread || readResult;
    const turns = thread?.turns || [];
    const userTurnPositions = [];
    turns.forEach((turn, index) => {
      if ((turn.items || []).some(item => item.type === 'userMessage')) userTurnPositions.push(index);
    });
    const targetPosition = userTurnPositions[userTurnIndex];
    if (targetPosition === undefined) throw new Error('Codex user turn not found');

    const numTurns = turns.length - targetPosition;
    await this.request('thread/resume', { threadId });
    const result = await this.request('thread/rollback', { threadId, numTurns });
    this.usageByThread.delete(threadId);
    return { conversationId: threadId, removedTurns: numTurns, thread: result?.thread };
  }

  getStatus(conversationId) {
    return { conversation_id: conversationId, isBusy: this.turns.has(conversationId) };
  }

  async stop() {
    await Promise.all([...this.turns.entries()].map(([threadId, turn]) => this.interrupt(threadId, turn.turnId)));
  }

  prewarm() { return this.ensureStarted(); }

  async listModels() {
    await this.ensureStarted();
    const result = await this.request('model/list', { limit: 100, includeHidden: false });
    return (result?.data || []).map(model => {
      const id = model.model || model.id;
      const tier = id.includes('sol') ? 'Sol' : id.includes('terra') ? 'Terra' : id.includes('luna') ? 'Luna' : 'Codex';
      const descriptions = {
        Sol: '旗艦能力 · 複雜推理與大型開發任務',
        Terra: '能力與速度平衡 · 日常開發推薦',
        Luna: '快速省資源 · 高頻輕量工作'
      };
      return {
        id,
        provider: 'codex',
        name: model.displayName || id,
        desc: descriptions[tier] || 'OpenAI Codex 模型',
        icon: tier === 'Sol' ? '☀️' : tier === 'Terra' ? '🌍' : tier === 'Luna' ? '🌙' : '🧩',
        badge: model.isDefault ? '預設' : tier,
        badgeColor: model.isDefault ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        isDefault: Boolean(model.isDefault),
        defaultReasoningEffort: model.defaultReasoningEffort || 'medium',
        supportedReasoningEfforts: (model.supportedReasoningEfforts || []).map(item => item.reasoningEffort)
      };
    });
  }

  async listConversations() {
    await this.ensureStarted();
    const result = await this.request('thread/list', { cursor: null, limit: 100, sortKey: 'updated_at' });
    return Promise.all((result?.data || []).map(async thread => {
      const stats = await this.getStoredTokenUsage(thread) || this.usageByThread.get(thread.id);
      const turns = await this.getStoredTurnCount(thread);
      return {
        id: thread.id,
        provider: 'codex',
        title: thread.name || thread.preview || `Codex ${thread.id.slice(0, 8)}`,
        updatedAt: (thread.updatedAt || thread.createdAt || 0) * 1000,
        turns,
        context_tokens_formatted: stats?.active_tokens_formatted || '—',
        total_tokens_formatted: stats?.total_tokens_formatted || '—',
        status_level: stats?.status_level || 'green',
        is_compacted: false
      };
    }));
  }

  async getStoredTurnCount(thread) {
    if (!thread?.id || !thread.path) {
      return Array.isArray(thread?.turns) ? thread.turns.length : (thread?.turnCount || 0);
    }
    const sessionPath = path.resolve(thread.path);
    if (!sessionPath.startsWith(`${CODEX_SESSIONS_DIR}${path.sep}`)) {
      return Array.isArray(thread.turns) ? thread.turns.length : (thread.turnCount || 0);
    }

    try {
      const stat = await fs.stat(sessionPath);
      const cached = this.usageFileState.get(thread.id);
      if (cached && cached.path === sessionPath && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && this.turnCountByThread.has(thread.id)) {
        return this.turnCountByThread.get(thread.id);
      }
      const content = await fs.readFile(sessionPath, 'utf8');
      let count = 0;
      let taskCount = 0;
      for (const line of content.split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry?.type === 'event_msg' && entry.payload?.type === 'user_message') count += 1;
          if (entry?.type === 'event_msg' && entry.payload?.type === 'task_started') taskCount += 1;
        } catch (_) {}
      }
      if (count === 0) count = taskCount;
      this.turnCountByThread.set(thread.id, count);
      return count;
    } catch (_) {
      return Array.isArray(thread.turns) ? thread.turns.length : (thread.turnCount || 0);
    }
  }

  // app-server streams token usage only for active turns. The same precise data is
  // persisted in Codex's session JSONL, so hydrate historical sidebar rows from it.
  async getStoredTokenUsage(thread) {
    if (!thread?.id || !thread.path) return null;
    const sessionPath = path.resolve(thread.path);
    if (!sessionPath.startsWith(`${CODEX_SESSIONS_DIR}${path.sep}`)) return null;

    try {
      const stat = await fs.stat(sessionPath);
      const cached = this.usageFileState.get(thread.id);
      if (cached && cached.path === sessionPath && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        return this.usageByThread.get(thread.id) || null;
      }

      const bytes = Math.min(stat.size, 512 * 1024);
      const handle = await fs.open(sessionPath, 'r');
      try {
        const buffer = Buffer.alloc(bytes);
        await handle.read(buffer, 0, bytes, stat.size - bytes);
        const lines = buffer.toString('utf8').split('\n');
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          try {
            const entry = JSON.parse(lines[i]);
            const info = entry?.type === 'event_msg' && entry.payload?.type === 'token_count'
              ? entry.payload.info
              : null;
            if (info) {
              const stats = this.normalizeTokenUsage(info);
              this.usageByThread.set(thread.id, stats);
              this.usageFileState.set(thread.id, { path: sessionPath, size: stat.size, mtimeMs: stat.mtimeMs });
              return stats;
            }
          } catch (_) {}
        }
      } finally {
        await handle.close();
      }
      this.usageFileState.set(thread.id, { path: sessionPath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (_) {}
    return this.usageByThread.get(thread.id) || null;
  }

  async getHistory(threadId) {
    await this.ensureStarted();
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    const thread = result.thread || result;
    const contextStats = await this.getStoredTokenUsage(thread) || this.usageByThread.get(threadId);
    const messages = [];
    for (const turn of thread.turns || []) {
      let assistant = null;
      for (const item of turn.items || []) {
        if (item.type === 'userMessage') {
          messages.push({ role: 'user', content: this.itemText(item), timestamp: item.createdAt });
        } else if (item.type === 'agentMessage') {
          if (!assistant) {
            assistant = { role: 'assistant', content: '', tools: [], thinking: '', timestamp: item.createdAt };
            messages.push(assistant);
          }
          assistant.content = this.itemText(item);
          assistant.timestamp = assistant.timestamp || item.createdAt;
        } else if (item.type === 'reasoning') {
          if (!assistant) { assistant = { role: 'assistant', content: '', tools: [], thinking: '', timestamp: item.createdAt }; messages.push(assistant); }
          assistant.thinking += (item.summary || []).map(part => part.text || part).join('\n');
        } else if (!['plan'].includes(item.type)) {
          if (!assistant) { assistant = { role: 'assistant', content: '', tools: [], thinking: '', timestamp: item.createdAt }; messages.push(assistant); }
          assistant.tools.push({ name: item.type, args: this.toolParameters(item), output: item.aggregatedOutput || item.output });
        }
      }
    }
    return {
      conversation_id: threadId,
      provider: 'codex',
      title: thread.name || thread.preview || null,
      context_stats: { ...(contextStats || { active_tokens: 0, active_tokens_formatted: '—', total_tokens: 0, total_tokens_formatted: '—', context_window: 0, context_window_formatted: '—', saved_percent: 0, status_level: 'green', status_text: '等待下一輪取得 Codex 用量', provider: 'codex' }), user_turns: (thread.turns || []).length, is_compacted: false },
      messages: messages.filter(message => message.content || message.thinking || message.tools.length)
    };
  }

  async deleteConversation(threadId) {
    await this.ensureStarted();
    await this.request('thread/delete', { threadId });
    this.usageByThread.delete(threadId);
    this.usageFileState.delete(threadId);
    this.turnCountByThread.delete(threadId);
  }

  async renameConversation(threadId, name) {
    await this.ensureStarted();
    await this.request('thread/resume', { threadId });
    await this.request('thread/name/set', { threadId, name });
  }
}

module.exports = new CodexProvider();
