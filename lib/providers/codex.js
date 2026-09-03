const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AVAILABLE_MODELS, cleanUserContent } = require('../config');
const { getConversationTitles } = require('../conversation-settings');

const CODEX_SESSIONS_DIR = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.codex', 'sessions');
const CODEX_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function isCodexSessionPath(candidatePath) {
  if (typeof candidatePath !== 'string' || !candidatePath) return false;
  const resolvedPath = path.resolve(candidatePath);
  return resolvedPath.startsWith(`${CODEX_SESSIONS_DIR}${path.sep}`);
}

function getConversationPreview(raw) {
  const text = cleanUserContent(String(raw || '')).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Codex session files can begin with Crew Pocket's injected capability and
  // project-guideline messages. They are context, never a conversation title.
  if (/^(?:<recommended_plugins>|#\s*AGENTS\.md\s+instructions|#\s*GEMINI\.md\s+instructions|<environment_context>|<permissions)/i.test(text)) return '';
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return '';
  return text.slice(0, 72);
}

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
    // App-server cannot reliably address historical turns in long, compacted
    // CLI sessions, so keep rewind exclusive to the established AGY provider.
    rewind: false,
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
    this.threadIndex = new Map();
    this.historyCache = new Map();
    this.startPromise = null;
    this.idleTimer = null;
  }

  clearIdleTimer() {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleIdleShutdown() {
    this.clearIdleTimer();
    if (!this.process || this.process.killed || this.turns.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.process || this.process.killed || this.turns.size > 0) return;
      console.log('[Codex Provider] Idle for 15m; stopping app-server to save RAM.');
      try { this.process.kill('SIGTERM'); } catch (_) {}
    }, CODEX_IDLE_TIMEOUT_MS);
  }

  getCachedHistory(threadId, sessionPath, stat) {
    const cached = this.historyCache.get(threadId);
    if (!cached || cached.path !== sessionPath || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) return null;
    this.historyCache.delete(threadId);
    this.historyCache.set(threadId, cached);
    return cached.history;
  }

  cacheHistory(threadId, sessionPath, stat, history) {
    this.historyCache.delete(threadId);
    this.historyCache.set(threadId, { path: sessionPath, size: stat.size, mtimeMs: stat.mtimeMs, history });
    while (this.historyCache.size > 6) this.historyCache.delete(this.historyCache.keys().next().value);
    return history;
  }

  invalidateHistory(threadId) {
    if (threadId) this.historyCache.delete(threadId);
  }

  isCodexSessionPath(candidatePath) {
    return isCodexSessionPath(candidatePath);
  }

  async ensureStarted() {
    this.clearIdleTimer();
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
        this.handleExit(err, child);
      });
      child.on('close', code => {
        const err = new Error(`Codex app-server exited with code ${code}`);
        if (!settled) { settled = true; reject(err); }
        this.handleExit(err, child);
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
      if (active) {
        active.lastContextStats = stats;
        active.emit({ type: 'context_usage', stats });
      }
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
          const parameters = this.toolParameters(item);
          emit({
            type: 'tool',
            toolId: item.id ? String(item.id) : null,
            toolGroupId: this.toolGroupId(item, parameters),
            state: message.method === 'item/started' ? 'running' : (item.status || 'completed'),
            name: item.type,
            info: { parameters, output: item.aggregatedOutput || item.output || null },
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
        this.scheduleIdleShutdown();
        break;
      }
    }
  }

  toolParameters(item) {
    if (item.command) return { command: item.command, cwd: item.cwd };
    if (item.changes) return { changes: item.changes };
    return item.arguments || item.input || {};
  }

  toolGroupId(item, parameters = {}) {
    let serialized;
    try { serialized = JSON.stringify(parameters); }
    catch (_) { serialized = String(parameters); }
    return crypto
      .createHash('sha1')
      .update(`${item.type || 'tool'}:${serialized}`)
      .digest('hex')
      .slice(0, 16);
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

  handleExit(error, child = null) {
    if (!this.process || (child && this.process !== child)) return;
    this.clearIdleTimer();
    this.process = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const active of this.turns.values()) {
      active.emit({ type: 'error', message: error.message });
      active.resolve();
    }
    this.turns.clear();
  }

  async startTurn({ conversationId, model, effort, prompt, imagePath, workspace, onEvent, onAbort }) {
    this.invalidateHistory(conversationId);
    await this.ensureStarted();
    const codexModel = model && model !== 'codex-default' ? model : undefined;
    let threadId = conversationId;
    if (threadId) {
      const result = await this.request('thread/resume', { threadId });
      threadId = result?.thread?.id || threadId;
    } else {
      const result = await this.request('thread/start', {
        model: codexModel,
        cwd: workspace || '/data/data/com.termux/files/home'
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
        cwd: workspace || '/data/data/com.termux/files/home',
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
    const beforeStats = this.usageByThread.get(resumedThreadId) || this.usageByThread.get(threadId) || null;
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
      lastContextStats: null,
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
      this.invalidateHistory(resumedThreadId);
      const isEnglish = locale === 'en';
      const afterStats = active.lastContextStats;
      const beforeTokens = beforeStats?.active_tokens || null;
      const afterTokens = afterStats?.active_tokens || null;
      const verification = {
        before_tokens: beforeTokens,
        after_tokens: afterTokens,
        status: !beforeTokens || !afterTokens
          ? 'pending'
          : (afterTokens < beforeTokens * 0.8 ? 'effective' : 'not_reduced')
      };
      return {
        conversationId: resumedThreadId,
        contextVerification: verification,
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

  getStatus(conversationId) {
    return { conversation_id: conversationId, isBusy: this.turns.has(conversationId) };
  }

  async stop() {
    await Promise.all([...this.turns.entries()].map(([threadId, turn]) => this.interrupt(threadId, turn.turnId)));
  }

  async prewarm() {
    await this.ensureStarted();
    this.scheduleIdleShutdown();
  }

  async listModels() {
    // The initial model catalog must not wake Codex just to populate the UI.
    // Its known fallback models keep the picker usable until Codex is actually used.
    if (!this.process || this.process.killed) return this.fallbackModels;
    const result = await this.request('model/list', { limit: 100, includeHidden: false });
    const models = (result?.data || []).map(model => {
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
    this.scheduleIdleShutdown();
    return models;
  }

  async listConversations() {
    const customTitles = await getConversationTitles('codex').catch(() => new Map());
    const pending = [CODEX_SESSIONS_DIR];
    const files = [];
    while (pending.length > 0) {
      const directory = pending.pop();
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (_) { continue; }
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try { files.push({ path: entryPath, stat: await fs.stat(entryPath) }); } catch (_) {}
        }
      }
    }
    files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const rows = await Promise.all(files.slice(0, 100).map(async ({ path: sessionPath, stat }) => {
      // Codex multi-agent v2 child threads are result-only sessions. The
      // app-server rejects direct user input for them, so never expose them as
      // selectable conversations in Crew Pocket's history drawer.
      try {
        const metadataHandle = await fs.open(sessionPath, 'r');
        try {
          const metadataBuffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
          await metadataHandle.read(metadataBuffer, 0, metadataBuffer.length, 0);
          const metadataLine = metadataBuffer.toString('utf8').split('\n').find(Boolean);
          const metadata = metadataLine ? JSON.parse(metadataLine).payload || {} : {};
          const source = metadata.source;
          if (
            metadata.thread_source === 'subagent' ||
            metadata.parent_thread_id ||
            metadata.forked_from_id ||
            (source && typeof source === 'object' && source.subagent)
          ) return null;
        } finally { await metadataHandle.close(); }
      } catch (_) {
        // A malformed/legacy session is still allowed through; only an
        // explicit subagent marker should hide a history row.
      }
      const idMatch = path.basename(sessionPath).match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i);
      let id = idMatch ? idMatch[1] : null;
      let preview = '';
      try {
        const handle = await fs.open(sessionPath, 'r');
        try {
          const bytes = Math.min(stat.size, 64 * 1024);
          const buffer = Buffer.alloc(bytes);
          await handle.read(buffer, 0, bytes, 0);
          for (const line of buffer.toString('utf8').split('\n')) {
            let entry;
            try { entry = JSON.parse(line); } catch (_) { continue; }
            const payload = entry.payload || {};
            if (!id && entry.type === 'session_meta') id = payload.session_id || payload.id || null;
            const userText = entry.type === 'event_msg' && payload.type === 'user_message'
              ? payload.message
              : (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user' ? this.itemText(payload) : '');
            if (userText && !preview) {
              preview = getConversationPreview(userText);
            }
            if (id && preview) break;
          }
        } finally { await handle.close(); }
      } catch (_) {}
      if (!id) return null;
      const title = customTitles.get(id) || preview || `Codex ${id.slice(0, 8)}`;
      const thread = { id, path: sessionPath, name: title, preview: preview || null, updatedAt: stat.mtimeMs / 1000 };
      this.threadIndex.set(id, thread);
      return { id, provider: 'codex', title, updatedAt: stat.mtimeMs, is_compacted: false };
    }));
    return rows.filter(Boolean);
  }

  async getStoredTurnCount(thread) {
    if (!thread?.id || !thread.path) {
      return Array.isArray(thread?.turns) ? thread.turns.length : (thread?.turnCount || 0);
    }
    const sessionPath = path.resolve(thread.path);
    if (!isCodexSessionPath(sessionPath)) {
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
    if (!isCodexSessionPath(sessionPath)) return null;

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

  async findSessionPath(threadId, { exactFilename = false } = {}) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(threadId || '')) return null;
    const indexed = this.threadIndex.get(threadId);
    if (indexed?.path) {
      const indexedPath = path.resolve(indexed.path);
      const indexedName = path.basename(indexedPath);
      const matches = exactFilename
        ? (indexedName === `${threadId}.jsonl` || indexedName.endsWith(`-${threadId}.jsonl`))
        : indexedName.includes(threadId);
      if (matches && isCodexSessionPath(indexedPath)) return indexedPath;
    }

    const pending = [CODEX_SESSIONS_DIR];
    while (pending.length > 0) {
      const directory = pending.pop();
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (_) { continue; }
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const matches = exactFilename
            ? (entry.name === `${threadId}.jsonl` || entry.name.endsWith(`-${threadId}.jsonl`))
            : entry.name.includes(threadId);
          if (matches) return entryPath;
        }
      }
    }
    return null;
  }

  async removeEmptySessionDirectories(sessionPath) {
    let directory = path.dirname(sessionPath);
    while (isCodexSessionPath(directory)) {
      try {
        await fs.rmdir(directory);
      } catch (err) {
        if (err.code === 'ENOENT') {
          directory = path.dirname(directory);
          continue;
        }
        if (err.code === 'ENOTEMPTY') break;
        throw err;
      }
      directory = path.dirname(directory);
    }
  }

  parseStoredToolInput(input) {
    if (typeof input !== 'string') return input || {};
    try { return JSON.parse(input); }
    catch (_) { return { input }; }
  }

  // Codex thread/read rebuilds every tool item through app-server. Large coding
  // sessions can take several seconds despite producing a small UI response, so
  // hydrate the display history directly from Codex's local session JSONL.
  async getLocalHistory(threadId) {
    const sessionPath = await this.findSessionPath(threadId);
    if (!sessionPath || !isCodexSessionPath(sessionPath)) return null;

    try {
      const stat = await fs.stat(sessionPath);
      const cached = this.getCachedHistory(threadId, sessionPath, stat);
      if (cached) return cached;
      const content = await fs.readFile(sessionPath, 'utf8');
      const messages = [];
      let currentAssistant = null;
      let pendingTools = [];

      for (const line of content.split('\n')) {
        if (!line) continue;
        let entry;
        try { entry = JSON.parse(line); }
        catch (_) { continue; }
        const payload = entry.payload || {};
        const timestamp = entry.timestamp;

        if (entry.type === 'event_msg' && payload.type === 'user_message') {
          const userMessage = payload.message || '';
          if (!userMessage) continue;
          messages.push({ role: 'user', content: userMessage, timestamp });
          currentAssistant = null;
          pendingTools = [];
          continue;
        }

        if (entry.type === 'response_item' && payload.type === 'custom_tool_call') {
          const tool = { name: payload.name || 'tool', args: this.parseStoredToolInput(payload.input), output: null };
          if (currentAssistant) currentAssistant.tools.push(tool);
          else pendingTools.push(tool);
          continue;
        }

        if (entry.type === 'response_item' && payload.type === 'reasoning') {
          const reasoning = (payload.summary || []).map(part => part.text || part).join('\n').trim();
          if (reasoning) {
            if (!currentAssistant) {
              currentAssistant = { role: 'assistant', content: '', tools: pendingTools, thinking: '', timestamp };
              pendingTools = [];
              messages.push(currentAssistant);
            }
            currentAssistant.thinking += `${currentAssistant.thinking ? '\n' : ''}${reasoning}`;
          }
          continue;
        }

        if (entry.type === 'event_msg' && payload.type === 'agent_message') {
          if (!currentAssistant) {
            currentAssistant = { role: 'assistant', content: '', tools: pendingTools, thinking: '', timestamp };
            pendingTools = [];
            messages.push(currentAssistant);
          }
          currentAssistant.content = payload.message || currentAssistant.content;
          currentAssistant.timestamp = currentAssistant.timestamp || timestamp;
        }
      }

      // Some Codex versions persist only response_item records (without the
      // event_msg user_message/agent_message pair). Keep those older sessions
      // readable instead of leaving the conversation loader with no transcript.
      if (!messages.some(message => message.role === 'user')) {
        let fallbackAssistant = null;
        let fallbackTools = [];
        for (const line of content.split('\n')) {
          if (!line) continue;
          let entry;
          try { entry = JSON.parse(line); }
          catch (_) { continue; }
          if (entry.type !== 'response_item') continue;
          const payload = entry.payload || {};
          const timestamp = entry.timestamp;

          if (payload.type === 'custom_tool_call') {
            const tool = { name: payload.name || 'tool', args: this.parseStoredToolInput(payload.input), output: null };
            if (fallbackAssistant) fallbackAssistant.tools.push(tool);
            else fallbackTools.push(tool);
            continue;
          }

          if (payload.type !== 'message') continue;
          if (payload.role === 'user') {
            const userMessage = this.itemText(payload);
            if (!userMessage) continue;
            messages.push({ role: 'user', content: userMessage, timestamp });
            fallbackAssistant = null;
            fallbackTools = [];
          } else if (payload.role === 'assistant') {
            const response = this.itemText(payload);
            if (!fallbackAssistant) {
              fallbackAssistant = { role: 'assistant', content: '', tools: fallbackTools, thinking: '', timestamp };
              fallbackTools = [];
              messages.push(fallbackAssistant);
            }
            fallbackAssistant.content = response || fallbackAssistant.content;
          }
        }
      }

      const thread = this.threadIndex.get(threadId) || { id: threadId, path: sessionPath };
      const contextStats = await this.getStoredTokenUsage({ ...thread, id: threadId, path: sessionPath }) || this.usageByThread.get(threadId);
      return this.cacheHistory(threadId, sessionPath, stat, {
        conversation_id: threadId,
        provider: 'codex',
        title: thread.name || thread.preview || null,
        context_stats: { ...(contextStats || { active_tokens: 0, active_tokens_formatted: '—', total_tokens: 0, total_tokens_formatted: '—', context_window: 0, context_window_formatted: '—', saved_percent: 0, status_level: 'green', status_text: '等待下一輪取得 Codex 用量', provider: 'codex' }), user_turns: messages.filter(message => message.role === 'user').length, is_compacted: false },
        messages: messages.filter(message => message.content || message.thinking || message.tools?.length),
        sourceMtimeMs: stat.mtimeMs
      });
    } catch (_) {
      return null;
    }
  }

  // Live voice memos are produced outside the Codex app-server turn stream.
  // Persist them using the same event_msg records Codex writes so the local
  // history reader and future app-server reads see one continuous thread.
  async appendLiveMemo(threadId, { userMessage = '', assistantMessage = '', callMemo = null } = {}) {
    const sessionPath = await this.findSessionPath(threadId);
    if (!sessionPath || !isCodexSessionPath(sessionPath)) {
      const error = new Error('找不到對應的 Codex session 檔案');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();
    const userContent = `<USER_REQUEST>\n[🎙️ Live 語音] ${userMessage || '(語音通話)'}\n</USER_REQUEST>`;
    let assistantContent = assistantMessage || '';
    if (callMemo) {
      assistantContent = `<!-- CALL_MEMO_DATA:${JSON.stringify(callMemo)} -->\n${assistantContent}`;
    }

    const records = [
      {
        timestamp: now,
        type: 'event_msg',
        payload: { type: 'user_message', message: userContent }
      },
      {
        timestamp: now,
        type: 'response_item',
        payload: {
          type: 'message',
          id: `live-${crypto.randomUUID()}`,
          role: 'user',
          content: [{ type: 'input_text', text: userContent }]
        }
      },
      {
        timestamp: now,
        type: 'event_msg',
        payload: { type: 'agent_message', message: assistantContent, phase: 'final', memory_citation: null }
      },
      {
        timestamp: now,
        type: 'response_item',
        payload: {
          type: 'message',
          id: `live-${crypto.randomUUID()}`,
          role: 'assistant',
          content: [{ type: 'output_text', text: assistantContent }],
          phase: 'final'
        }
      }
    ];

    await fs.appendFile(sessionPath, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    this.invalidateHistory(threadId);
    this.usageFileState.delete(threadId);
    this.turnCountByThread.delete(threadId);
    return { conversationId: threadId, sessionPath };
  }

  async getHistory(threadId) {
    const localHistory = await this.getLocalHistory(threadId);
    if (localHistory) return localHistory;
    return this.getAppServerHistory(threadId);
  }

  async getAppServerHistory(threadId) {
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
    const history = {
      conversation_id: threadId,
      provider: 'codex',
      title: thread.name || thread.preview || null,
      context_stats: { ...(contextStats || { active_tokens: 0, active_tokens_formatted: '—', total_tokens: 0, total_tokens_formatted: '—', context_window: 0, context_window_formatted: '—', saved_percent: 0, status_level: 'green', status_text: '等待下一輪取得 Codex 用量', provider: 'codex' }), user_turns: (thread.turns || []).length, is_compacted: false },
      messages: messages.filter(message => message.content || message.thinking || message.tools.length)
    };
    this.scheduleIdleShutdown();
    return history;
  }

  async deleteConversation(threadId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(threadId || '')) throw new Error('Invalid Codex conversation id');
    if (this.turns.has(threadId)) {
      const error = new Error('Cannot delete a Codex conversation while it is generating');
      error.statusCode = 409;
      throw error;
    }

    // Keep a precise path before asking app-server to delete the thread. Some
    // Codex versions remove the JSONL themselves; others only delete thread
    // metadata. Crew Pocket owns the local-storage guarantee either way.
    const sessionPath = await this.findSessionPath(threadId, { exactFilename: true });
    let storageFreedBytes = 0;
    if (sessionPath) {
      try { storageFreedBytes = (await fs.lstat(sessionPath)).size; }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    }

    await this.ensureStarted();
    await this.request('thread/delete', { threadId });
    if (sessionPath) {
      await fs.rm(sessionPath, { force: true });
      await this.removeEmptySessionDirectories(sessionPath);
    }

    this.usageByThread.delete(threadId);
    this.usageFileState.delete(threadId);
    this.turnCountByThread.delete(threadId);
    this.threadIndex.delete(threadId);
    this.invalidateHistory(threadId);
    this.scheduleIdleShutdown();
    return { localDataDeleted: true, storageFreedBytes };
  }

  async renameConversation(threadId, name) {
    await this.ensureStarted();
    await this.request('thread/resume', { threadId });
    await this.request('thread/name/set', { threadId, name });
    this.invalidateHistory(threadId);
    this.scheduleIdleShutdown();
  }

  isAvailable() {
    try {
      require('node:child_process').execSync('command -v codex', { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = new CodexProvider();
