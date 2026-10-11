'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { cleanUserContent } = require('../config');

const DATA_DIR = process.env.CREW_CLAUDE_DATA_DIR || path.join(os.homedir(), '.crew-pocket', 'claude-conversations');
const ID_PATTERN = /^claude_[a-f0-9]{32}$/;
const MODELS = [
  { id: 'sonnet', provider: 'claude', name: 'Claude Sonnet', desc: 'Claude Code CLI · 平衡', icon: '🟣', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'] },
  { id: 'opus', provider: 'claude', name: 'Claude Opus', desc: 'Claude Code CLI · 深度推理', icon: '🟣', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'] },
  { id: 'haiku', provider: 'claude', name: 'Claude Haiku', desc: 'Claude Code CLI · 輕量工作', icon: '🟣', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'] }
];
const metadata = {
  id: 'claude',
  label: 'Claude Code',
  shortLabel: 'Claude',
  icon: '🟣',
  storagePrefix: 'claude',
  badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  greeting: 'Claude Code 已連線。請先在本機完成 claude login。',
  capabilities: {
    models: true, history: true, contextUsage: false,
    rename: true, delete: true, rewind: false, compact: false, autoTitle: false,
    usage: { mode: 'unsupported' }
  }
};

function validateId(id) {
  if (!ID_PATTERN.test(String(id || ''))) throw new Error('Invalid Claude conversation id');
  return id;
}

function fileFor(id) {
  return path.join(DATA_DIR, validateId(id) + '.json');
}

async function readRecord(id) {
  try {
    return JSON.parse(await fs.readFile(fileFor(id), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const err = new Error('Claude conversation not found in Crew Pocket');
      err.statusCode = 404;
      throw err;
    }
    throw error;
  }
}

async function saveRecord(record) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const destination = fileFor(record.id);
  const temporary = destination + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fs.rename(temporary, destination);
}

function cliArgs(record, { model, effort, prompt }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (record.sessionId) args.push('--resume', record.sessionId);
  if (model && /^[A-Za-z0-9._-]{1,100}$/.test(model)) args.push('--model', model);
  const mode = process.env.CREW_CLAUDE_PERMISSION_MODE || 'default';
  if (!['default', 'plan', 'acceptEdits', 'dontAsk'].includes(mode)) {
    throw new Error('Unsupported CREW_CLAUDE_PERMISSION_MODE; bypassPermissions is not allowed');
  }
  args.push('--permission-mode', mode, '--', prompt);
  return args;
}

function parseToolInput(value) {
  return value && typeof value === 'object' ? value : {};
}

class ClaudeProvider {
  constructor() {
    this.id = 'claude';
    this.metadata = metadata;
    this.fallbackModels = MODELS;
    this.turns = new Map();
    this.available = null;
    this.checkedAt = 0;
  }

  isAvailable() {
    if (Date.now() - this.checkedAt < 10000 && this.available !== null) return this.available;
    const result = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 4000, stdio: 'ignore' });
    this.available = !result.error && result.status === 0;
    this.checkedAt = Date.now();
    return this.available;
  }

  async listModels() { return MODELS; }
  async prewarm() { /* Claude CLI runs on demand, never launches a hidden conversation. */ }

  getStatus(conversationId) {
    return { conversation_id: conversationId, isBusy: this.turns.has(conversationId) };
  }

  async stop(conversationId = null) {
    const targets = conversationId
      ? [[conversationId, this.turns.get(conversationId)]]
      : [...this.turns.entries()];
    let stopped = false;
    for (const [, turn] of targets) {
      if (!turn || turn.aborted) continue;
      turn.aborted = true;
      stopped = true;
      turn.child.kill('SIGTERM');
    }
    return { stopped, conversationId };
  }

  async listConversations() {
    let names;
    try { names = await fs.readdir(DATA_DIR); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const records = await Promise.all(names.filter(name => ID_PATTERN.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
      .map(async name => {
        try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), 'utf8')); }
        catch (_) { return null; }
      }));
    return records.filter(record => record && ID_PATTERN.test(record.id))
      .map(record => ({
        id: record.id, provider: 'claude',
        title: record.title || (record.messages || []).find(message => message.role === 'user')?.content?.slice(0, 55) || 'Claude Code',
        updatedAt: record.updatedAt || record.createdAt
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getHistory(conversationId) {
    const record = await readRecord(conversationId);
    return {
      conversation_id: record.id, provider: 'claude', title: record.title || null,
      context_stats: {
        active_tokens: 0, active_tokens_formatted: '—',
        total_tokens: 0, total_tokens_formatted: '—',
        context_window: 0, context_window_formatted: '—',
        saved_percent: 0, status_level: 'green',
        status_text: 'Claude CLI 未提供完整 Context Window 使用量',
        provider: 'claude', user_turns: record.messages.filter(m => m.role === 'user').length,
        is_compacted: false
      },
      messages: record.messages || []
    };
  }

  async renameConversation(id, title) {
    const record = await readRecord(id);
    record.title = String(title || '').trim().slice(0, 60);
    record.updatedAt = Date.now();
    await saveRecord(record);
  }

  async deleteConversation(id) {
    validateId(id);
    if (this.turns.has(id)) {
      const error = new Error('Cannot delete an active Claude conversation');
      error.statusCode = 409;
      throw error;
    }
    // Only remove Crew Pocket's reference and transcript; never delete ~/.claude sessions.
    let bytes = 0;
    try { bytes = (await fs.stat(fileFor(id))).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(fileFor(id), { force: true });
    return { localDataDeleted: true, storageFreedBytes: bytes };
  }

  async startTurn({ conversationId, model = 'sonnet', effort = 'medium', prompt, imagePath, workspace, onEvent, onAbort }) {
    if (imagePath) throw new Error('Claude Code Provider 尚未支援圖片附件，請先使用文字訊息。');
    if (!this.isAvailable()) throw new Error('找不到 Claude Code CLI；請在執行 Crew Runtime 的主機安裝 claude 並完成登入。');

    const id = conversationId ? validateId(conversationId) : 'claude_' + crypto.randomUUID().replace(/-/g, '');
    const record = conversationId
      ? await readRecord(id)
      : { id, sessionId: null, title: '', messages: [], createdAt: Date.now() };
    const cwd = path.resolve(workspace || record.workspace || os.homedir());
    if (record.workspace && path.resolve(record.workspace) !== cwd) {
      throw new Error('Claude conversation workspace cannot change on resume; create a new conversation');
    }
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) throw new Error('Claude workspace is not a directory');
    if (this.turns.has(id)) {
      const error = new Error('Claude conversation is already running');
      error.statusCode = 409;
      throw error;
    }

    const env = { ...process.env };
    if (['low', 'medium', 'high'].includes(effort)) env.CLAUDE_CODE_EFFORT_LEVEL = effort;
    const args = cliArgs(record, { model, effort, prompt });
    const userMessage = { role: 'user', content: cleanUserContent(prompt), timestamp: new Date().toISOString() };
    record.workspace = cwd;
    record.model = model;
    record.messages.push(userMessage);
    record.updatedAt = Date.now();
    // Persist the Pocket conversation ID before any CLI event can be streamed.
    // Interrupted first turns must remain visible and must not bind to another Role.
    await saveRecord(record);
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const turn = { child, aborted: false };
    this.turns.set(id, turn);

    const emit = event => { if (!turn.aborted) onEvent(event); };
    let announced = false;
    let answer = '';
    let resultText = '';
    let resultSeen = false;
    let resultError = false;
    let overflowError = null;
    let stderr = '';
    let buffer = '';
    let activeMessageId = '';
    const streamedMessageIds = new Set();
    const tools = new Map();
    const decoder = new StringDecoder('utf8');

    function announce() {
      if (announced) return;
      announced = true;
      emit({ type: 'session_started', conversationId: id, model, effort });
    }

    function pushText(text) {
      if (!text) return;
      answer += text;
      emit({ type: 'text_delta', delta: text, accumulated: answer });
    }

    function handleLine(line) {
      if (!line.trim()) return;
      let item;
      try { item = JSON.parse(line); } catch (_) { return; }
      if (item.type === 'system' && item.subtype === 'init') {
        if (item.session_id) record.sessionId = item.session_id;
        announce();
      } else if (item.type === 'stream_event') {
        const event = item.event || {};
        if (event.type === 'message_start') activeMessageId = event.message?.id || '';
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          if (activeMessageId) streamedMessageIds.add(activeMessageId);
          pushText(event.delta.text);
        }
        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          emit({ type: 'reasoning_delta', delta: event.delta.thinking || '' });
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const block = event.content_block;
          tools.set(block.id, { name: block.name || 'tool', args: parseToolInput(block.input), output: null });
          emit({ type: 'tool', state: 'running', toolId: block.id, name: block.name || 'tool', info: { input: block.input || {} } });
        }
      } else if (item.type === 'assistant') {
        const message = item.message || {};
        for (const block of message.content || []) {
          if (block.type === 'text' && !streamedMessageIds.has(message.id)) pushText(block.text);
          if (block.type === 'tool_use') {
            if (!tools.has(block.id)) {
              tools.set(block.id, { name: block.name || 'tool', args: parseToolInput(block.input), output: null });
              emit({ type: 'tool', state: 'running', toolId: block.id, name: block.name || 'tool', info: { input: block.input || {} } });
            } else {
              tools.get(block.id).args = parseToolInput(block.input);
            }
          }
        }
      } else if (item.type === 'user') {
        for (const block of item.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          const tool = tools.get(block.tool_use_id);
          if (tool) {
            tool.output = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || []);
            emit({ type: 'tool', state: 'completed', toolId: block.tool_use_id, name: tool.name, info: { output: tool.output?.slice(0, 1500) } });
          }
        }
      } else if (item.type === 'result') {
        resultSeen = true;
        resultError = Boolean(item.is_error);
        resultText = typeof item.result === 'string' ? item.result : '';
        if (item.session_id) record.sessionId = item.session_id;
      }
    }

    const completed = new Promise(resolve => {
      onAbort(() => {
        if (!turn.aborted) {
          turn.aborted = true;
          child.kill('SIGTERM');
        }
      });
      child.stdout.on('data', chunk => {
        buffer += decoder.write(chunk);
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          handleLine(line);
        }
        if (buffer.length > 4 * 1024 * 1024) {
          overflowError = new Error('Claude CLI returned an oversized JSON stream record');
          child.kill('SIGTERM');
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-3000); });
      let finished = false;
      async function finish(error) {
        if (finished) return;
        finished = true;
        this.turns.delete(id);
        const finalText = resultText || answer;
        if (turn.aborted) {
          // Persist the native session pointer even when the first turn was interrupted.
          record.updatedAt = Date.now();
          await saveRecord(record).catch(err => console.warn('[Claude] Interrupted session checkpoint failed:', err.message));
        } else {
          record.messages.push({
            role: 'assistant', content: finalText, thinking: '',
            tools: [...tools.values()], timestamp: new Date().toISOString()
          });
          record.updatedAt = Date.now();
          try { await saveRecord(record); } catch (saveError) { error = saveError; }
          if (error) emit({ type: 'error', message: String(error.message || error) });
          else emit({ type: 'turn_completed', conversationId: id, response: finalText, status: 'completed' });
        }
        resolve({ conversationId: id });
      }
      const end = finish.bind(this);
      child.once('error', error => end(error));
      child.once('close', code => {
        const tail = decoder.end();
        if (tail) buffer += tail;
        if (buffer.trim()) handleLine(buffer);
        if (!announced && !turn.aborted) announce();
        const error = overflowError || (!turn.aborted && (code !== 0 || !resultSeen || resultError)
          ? new Error((stderr || resultText || 'Claude CLI exited without a successful result').slice(-1200))
          : null);
        end(error);
      });
    });
    return completed;
  }
}

module.exports = new ClaudeProvider();
