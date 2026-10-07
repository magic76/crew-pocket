const fs = require('node:fs/promises');
const path = require('node:path');
const { MemoryProvider } = require('./provider');
const { MemoryScope, MemoryStatus, normalizeMemoryRecord, normalizeMemoryQuery } = require('./types');

const DEFAULT_MEMORY_PATH = path.join(
  process.env.HOME || '/data/data/com.termux/files/home',
  '.crew-pocket',
  'memory',
  'records.json'
);

function terms(text) {
  return [...new Set(
    String(text || '')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map(value => value.trim())
      .filter(value => value.length >= 2)
  )];
}

function scopeMatches(record, query) {
  if (!query.scopes.includes(record.scope)) return false;
  if (record.scope === MemoryScope.GLOBAL) return true;
  if (record.scope === MemoryScope.ROLE) return Boolean(query.roleId && record.roleId === query.roleId);
  if (record.scope === MemoryScope.PROJECT) return Boolean(query.projectId && record.projectId === query.projectId);
  if (record.scope === MemoryScope.SESSION) {
    return Boolean(query.conversationId && record.conversationId === query.conversationId);
  }
  return false;
}

function statusMatches(record, query) {
  return query.statuses.includes(record.status || MemoryStatus.ACTIVE);
}

function scoreMemory(record, query) {
  const queryTerms = terms(query.text);
  const haystack = `${record.text} ${record.tags.join(' ')} ${record.kind}`.toLocaleLowerCase();
  const matchedTerms = queryTerms.filter(term => haystack.includes(term));
  const keywordScore = queryTerms.length ? matchedTerms.length / queryTerms.length : 0;
  const phraseScore = query.text && record.text.toLocaleLowerCase().includes(query.text.toLocaleLowerCase()) ? 0.35 : 0;
  const ageDays = Math.max(0, (query.now - record.updatedAt) / 86400000);
  const recencyScore = 1 / (1 + ageDays / 30);
  const score = keywordScore * 0.7 + phraseScore + recencyScore * 0.2 + record.importance * 0.1;
  return { score, matchedTerms };
}

class LocalMemoryProvider extends MemoryProvider {
  constructor({ storagePath = DEFAULT_MEMORY_PATH } = {}) {
    super();
    this.storagePath = storagePath;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed?.records) ? parsed.records : [];
      return records.map(record => normalizeMemoryRecord(record, record.updatedAt || Date.now()));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async writeAll(records) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({ version: 1, records }, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.storagePath);
  }

  async retain(memory) {
    const run = this.mutationQueue.then(async () => {
      const records = await this.readAll();
      const existingIndex = memory?.id ? records.findIndex(record => record.id === memory.id) : -1;
      const existing = existingIndex >= 0 ? records[existingIndex] : null;
      const now = Date.now();
      const record = normalizeMemoryRecord({
        ...existing,
        ...memory,
        createdAt: existing?.createdAt || memory?.createdAt || now,
        updatedAt: now
      }, now);
      if (existingIndex >= 0) records[existingIndex] = record;
      else records.push(record);

      if (record.supersedes.length) {
        const supersededIds = new Set(record.supersedes);
        for (let index = 0; index < records.length; index++) {
          const target = records[index];
          if (!supersededIds.has(target.id) || target.id === record.id) continue;
          records[index] = normalizeMemoryRecord({
            ...target,
            status: MemoryStatus.SUPERSEDED,
            updatedAt: now
          }, now);
        }
      }

      await this.writeAll(records);
      return record;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async recall(input = {}) {
    const query = normalizeMemoryQuery(input);
    const records = await this.readAll();
    const scored = records
      .filter(record => statusMatches(record, query) && scopeMatches(record, query))
      .map(record => {
        const { score, matchedTerms } = scoreMemory(record, query);
        return { id: record.id, record, score, matchedTerms };
      })
      .sort((a, b) =>
        b.score - a.score ||
        b.record.updatedAt - a.record.updatedAt ||
        a.record.id.localeCompare(b.record.id)
      );

    const hits = [];
    let chars = 0;
    for (const hit of scored) {
      if (hits.length >= query.limit) break;
      const cost = hit.record.text.length;
      if (hits.length > 0 && chars + cost > query.maxChars) continue;
      if (hits.length === 0 && cost > query.maxChars) {
        hit.record = { ...hit.record, text: hit.record.text.slice(0, query.maxChars) };
      }
      chars += hit.record.text.length;
      hits.push(hit);
    }
    return hits;
  }

  async forget(id) {
    const target = String(id || '').trim();
    if (!target) return false;
    const run = this.mutationQueue.then(async () => {
      const records = await this.readAll();
      const next = records.filter(record => record.id !== target);
      if (next.length === records.length) return false;
      await this.writeAll(next);
      return true;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async forgetRole(roleId) {
    const target = String(roleId || '').trim();
    if (!target) return 0;
    const run = this.mutationQueue.then(async () => {
      const records = await this.readAll();
      const next = records.filter(record =>
        !(record.scope === MemoryScope.ROLE && record.roleId === target)
      );
      const removed = records.length - next.length;
      if (removed) await this.writeAll(next);
      return removed;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

module.exports = {
  DEFAULT_MEMORY_PATH,
  LocalMemoryProvider,
  scoreMemory,
  scopeMatches,
  statusMatches
};
