// Staged memory proposals are immutable files, never canonical long-term memories.
// Separate files avoid lost updates when several MCP stdio processes run for different Roles.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_DIR = process.env.CREW_MCP_MEMORY_CANDIDATES_DIR ||
  path.join(process.env.HOME || '/data/data/com.termux/files/home',
    '.crew-pocket', 'memory', 'mcp-candidates');
const MAX_PENDING = 300;
const MAX_TEXT = 2000;

function boundedText(value, max = MAX_TEXT) {
  return String(value || '').trim().slice(0, max);
}

class MemoryCandidateStore {
  constructor({ storageDir = DEFAULT_DIR } = {}) {
    this.storageDir = storageDir;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    let names;
    try {
      names = (await fs.readdir(this.storageDir))
        .filter(name => /^mcp-memory-[a-f0-9-]{36}\.json$/.test(name))
        .slice(0, MAX_PENDING + 100);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const candidates = await Promise.all(names.map(async name => {
      try {
        return JSON.parse(await fs.readFile(path.join(this.storageDir, name), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }));
    return candidates.filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
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
      if (current.filter(item => item.status === 'pending').length >= MAX_PENDING) {
        throw new Error('Memory candidate inbox is full');
      }
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
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
      // O_EXCL guarantees a new proposal can never overwrite another process's
      // proposal. Cross-process duplicate submissions may exist but no writes
      // are lost; admission can coalesce them later.
      await fs.writeFile(
        path.join(this.storageDir, candidate.id + '.json'),
        JSON.stringify(candidate, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 }
      );
      return candidate;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultMemoryCandidateStore = new MemoryCandidateStore();
module.exports = { MemoryCandidateStore, defaultMemoryCandidateStore };
