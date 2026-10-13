// Agent proposals are staging records, never canonical long-term memories.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PATH = process.env.CREW_MCP_MEMORY_CANDIDATES_PATH ||
  path.join(process.env.HOME || '/data/data/com.termux/files/home',
    '.crew-pocket', 'memory', 'mcp-candidates.json');
const MAX_PENDING = 300;
const MAX_TEXT = 2000;

function boundedText(value, max = MAX_TEXT) {
  return String(value || '').trim().slice(0, max);
}

class MemoryCandidateStore {
  constructor({ storagePath = DEFAULT_PATH } = {}) {
    this.storagePath = storagePath;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      return Array.isArray(raw.candidates) ? raw.candidates : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async propose({ roleId, projectId = null, conversationId = null, text, kind = 'experience', tags = [], evidence = [] }) {
    const identity = boundedText(roleId, 160);
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(identity)) throw new Error('Invalid bound role');
    const claim = boundedText(text);
    if (!claim) throw new Error('Memory candidate text is required');
    if (String(text).length > MAX_TEXT) throw new Error('Memory candidate exceeds 2000 characters');
    const safeTags = [...new Set((Array.isArray(tags) ? tags : []).map(tag => boundedText(tag, 64)).filter(Boolean))].slice(0, 8);
    const sources = (Array.isArray(evidence) ? evidence : []).slice(0, 5).map(source => ({
      type: boundedText(source?.type, 32),
      id: boundedText(source?.id, 180)
    })).filter(source => ['conversation', 'message', 'tool', 'git', 'document'].includes(source.type) && source.id);
    const normalizedKind = boundedText(kind, 80) || 'experience';

    const run = this.mutationQueue.then(async () => {
      const current = await this.readAll();
      const duplicate = current.find(item =>
        item.status === 'pending' && item.roleId === identity && item.text === claim);
      if (duplicate) return { ...duplicate, duplicate: true };
      const pending = current.filter(item => item.status === 'pending');
      if (pending.length >= MAX_PENDING) throw new Error('Memory candidate inbox is full');
      const candidate = {
        id: 'mcp-memory-' + crypto.randomUUID(),
        roleId: identity,
        projectId: projectId || null,
        conversationId: conversationId || null,
        text: claim,
        kind: normalizedKind,
        tags: safeTags,
        provenance: { derivation: 'MODEL_INFERRED', sources },
        status: 'pending',
        createdAt: Date.now()
      };
      const updated = [...current, candidate].slice(-MAX_PENDING);
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
      const temp = this.storagePath + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
      await fs.writeFile(temp, JSON.stringify({ version: 1, candidates: updated }, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temp, this.storagePath);
      return candidate;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultMemoryCandidateStore = new MemoryCandidateStore();
module.exports = { MemoryCandidateStore, defaultMemoryCandidateStore };
