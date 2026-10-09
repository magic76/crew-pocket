const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { MemoryProvider } = require('./provider');
const { MemoryScope, MemoryStatus, normalizeMemoryRecord, normalizeMemoryQuery } = require('./types');

const MAX_MEMORY_REVISIONS = 1500;

function semanticRecord(record) {
  const { updatedAt, ...semantic } = record;
  return JSON.stringify(semantic);
}

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

  async readState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      return {
        records: (Array.isArray(parsed?.records) ? parsed.records : [])
          .map(record => normalizeMemoryRecord(record, record.updatedAt || Date.now())),
        revisions: (Array.isArray(parsed?.revisions) ? parsed.revisions : [])
          .filter(entry => entry && typeof entry === 'object' && entry.record && entry.recordId)
          .slice(-MAX_MEMORY_REVISIONS),
        historyTruncated: parsed?.historyTruncated === true
          || (Array.isArray(parsed?.revisions) && parsed.revisions.length > MAX_MEMORY_REVISIONS)
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { records: [], revisions: [], historyTruncated: false };
      throw error;
    }
  }

  async readAll() {
    return (await this.readState()).records;
  }

  // Writes the canonical records and their history in one atomic rename.
  async writeState(state) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    const revisions = Array.isArray(state.revisions) ? state.revisions : [];
    const bounded = revisions.slice(-MAX_MEMORY_REVISIONS);
    await fs.writeFile(tempPath, JSON.stringify({
      version: 2,
      records: state.records,
      revisions: bounded,
      historyTruncated: Boolean(state.historyTruncated || revisions.length > MAX_MEMORY_REVISIONS)
    }, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.storagePath);
  }

  // Compatibility for legacy callers; preserves existing audit metadata.
  async writeAll(records) {
    const state = await this.readState();
    await this.writeState({ ...state, records });
  }

  async retain(memory) {
    const run = this.mutationQueue.then(async () => {
      const state = await this.readState();
      const records = state.records;
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
      const revisions = state.revisions;
      if (!existing || semanticRecord(existing) !== semanticRecord(record)) {
        revisions.push({
          id: crypto.randomUUID(),
          roleId: record.scope === MemoryScope.ROLE ? record.roleId : null,
          recordId: record.id,
          action: existing ? 'updated' : 'created',
          at: now,
          record
        });
      }

      if (record.supersedes.length) {
        const supersededIds = new Set(record.supersedes);
        for (let index = 0; index < records.length; index++) {
          const target = records[index];
          if (!supersededIds.has(target.id) || target.id === record.id) continue;
          // Avoid rewriting and duplicating supersede events on repeated checkpoints.
          if (target.status === MemoryStatus.SUPERSEDED) continue;
          const superseded = normalizeMemoryRecord({
            ...target,
            status: MemoryStatus.SUPERSEDED,
            updatedAt: now
          }, now);
          records[index] = superseded;
          revisions.push({
            id: crypto.randomUUID(),
            roleId: superseded.scope === MemoryScope.ROLE ? superseded.roleId : null,
            recordId: superseded.id,
            action: 'superseded',
            causedBy: record.id,
            at: now,
            record: superseded
          });
        }
      }
      await this.writeState({ ...state, records, revisions });
      return record;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  // Strictly local ROLE scope: no inherited/global/project/other Role information.
  async inspectRole(roleId, { limit = 150 } = {}) {
    const target = String(roleId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(target)) throw new Error('Invalid role id');
    await this.mutationQueue;
    const state = await this.readState();
    const records = state.records
      .filter(record => record.scope === MemoryScope.ROLE && record.roleId === target)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const allowedIds = new Set(records.map(record => record.id));
    const count = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 150));
    const filtered = state.revisions.filter(entry => (
      entry.roleId === target && allowedIds.has(entry.recordId) &&
      entry.record?.scope === MemoryScope.ROLE && entry.record?.roleId === target
    ));
    return {
      records,
      revisions: filtered.slice(-count).reverse(),
      revisionCount: filtered.length,
      historyTruncated: state.historyTruncated,
      trackingNote: 'Revision history only includes writes after version 2 storage was introduced.'
    };
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
      const state = await this.readState();
      const next = state.records.filter(record => record.id !== target);
      if (next.length === state.records.length) return false;
      // Forget must erase historical snapshots as well, not retain hidden copies.
      const revisions = state.revisions.filter(entry => entry.recordId !== target);
      await this.writeState({ ...state, records: next, revisions });
      return true;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async forgetRole(roleId) {
    const target = String(roleId || '').trim();
    if (!target) return 0;
    const run = this.mutationQueue.then(async () => {
      const state = await this.readState();
      const next = state.records.filter(record =>
        !(record.scope === MemoryScope.ROLE && record.roleId === target)
      );
      const removed = state.records.length - next.length;
      const revisions = state.revisions.filter(entry => entry.roleId !== target);
      if (removed || revisions.length !== state.revisions.length) {
        await this.writeState({ ...state, records: next, revisions });
      }
      return removed;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

module.exports = {
  DEFAULT_MEMORY_PATH,
  MAX_MEMORY_REVISIONS,
  LocalMemoryProvider,
  scoreMemory,
  scopeMatches,
  statusMatches
};
