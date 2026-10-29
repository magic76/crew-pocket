'use strict';
// Optional CTXAgent-inspired sidecar: never rewrite provider transcripts or native context.
// Store only complete, bounded tool outputs captured from the provider's readable history.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = process.env.CREW_CONTEXT_ARCHIVE_DIR ||
  path.join(os.homedir(), '.crew-pocket', 'context-archive');
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024; // per conversation, never evict originals
const MAX_CAPTURE_PER_TURN = 24;
const MAX_RECALL_CHARS = 12000;
const locks = new Map();

function scope({ roleId, provider, conversationId }) {
  // Role IDs can contain dots; reject traversal components before joining paths.
  if (roleId === '.' || roleId === '..' ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(String(roleId || '')) ||
      !/^[a-z0-9_-]{1,80}$/i.test(String(provider || '')) ||
      !/^[a-zA-Z0-9_-]+$/.test(String(conversationId || ''))) {
    throw new Error('Invalid context archive identity');
  }
  return path.join(ROOT, roleId, provider, conversationId);
}

function serialize(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

async function readIndex(dir) {
  try {
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
    if (!index || index.version !== 1 || !Array.isArray(index.segments)) {
      throw new Error('Invalid context archive index');
    }
    return index;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, segments: [], proposal: null };
    throw error;
  }
}

async function saveIndex(dir, index) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, '.index-' + crypto.randomUUID() + '.tmp');
  try {
    await fs.writeFile(tmp, JSON.stringify(index) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, path.join(dir, 'index.json'));
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function serializeMutation(dir, mutation) {
  const prior = locks.get(dir) || Promise.resolve();
  const pending = prior.catch(() => {}).then(async () => {
    const index = await readIndex(dir);
    const result = await mutation(index, dir);
    await saveIndex(dir, index);
    return result;
  });
  locks.set(dir, pending);
  try { return await pending; }
  finally { if (locks.get(dir) === pending) locks.delete(dir); }
}

function extractOutput(tool) {
  if (!tool || typeof tool !== 'object') return '';
  // Never try to re-serialize opaque provider payloads or hidden reasoning.
  return serialize(tool.output ?? tool.result ?? tool.response ?? null);
}

async function captureToolOutputs(identity, history = {}) {
  const dir = scope(identity);
  const messages = Array.isArray(history.active_messages) ? history.active_messages
    : Array.isArray(history.messages) ? history.messages : [];
  const candidates = [];
  let skipped = 0;
  for (const message of messages) {
    for (const tool of Array.isArray(message?.tools) ? message.tools : []) {
      const output = extractOutput(tool);
      if (!output) continue;
      const bytes = Buffer.byteLength(output);
      if (bytes > MAX_OUTPUT_BYTES) { skipped++; continue; }
      const name = String(tool.name || tool.tool_name || 'tool').slice(0, 100);
      const args = serialize(tool.args ?? tool.arguments ?? tool.input ?? '');
      const id = crypto.createHash('sha256')
        .update(name).update('\0').update(args).update('\0').update(output).digest('hex');
      candidates.push({ id, name, output, bytes });
    }
  }
  return serializeMutation(dir, async (index) => {
    const known = new Set(index.segments.map(item => item.id));
    let storedBytes = index.segments.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
    let added = 0;
    for (const item of candidates.slice(-MAX_CAPTURE_PER_TURN)) {
      if (known.has(item.id)) continue;
      if (storedBytes + item.bytes > MAX_ARCHIVE_BYTES) { skipped++; continue; }
      await fs.mkdir(path.join(dir, 'blobs'), { recursive: true, mode: 0o700 });
      // Immutable content-addressed files, written before they become visible in the index.
      await fs.writeFile(path.join(dir, 'blobs', item.id + '.txt'), item.output,
        { mode: 0o600, flag: 'wx' }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      index.segments.push({
        id: item.id, name: item.name, bytes: item.bytes, createdAt: new Date().toISOString(),
        note: null
      });
      known.add(item.id);
      storedBytes += item.bytes;
      added++;
    }
    return { added, skipped: skipped + Math.max(0, candidates.length - MAX_CAPTURE_PER_TURN),
      total: index.segments.length };
  });
}

async function listArchive(identity, { limit = 15 } = {}) {
  const index = await readIndex(scope(identity));
  const n = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 30)) : 15;
  return { segments: index.segments.slice(-n).reverse(), total: index.segments.length };
}

async function curateArchive(identity, { items } = {}) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new Error('items must contain 1–20 archive entries');
  }
  for (const item of items) {
    if (!/^[a-f0-9]{64}$/.test(String(item?.id || '')) ||
        typeof item?.note !== 'string' || item.note.trim().length < 3 || item.note.length > 240) {
      throw new Error('Each item needs a valid archived id and a 3–240 character note');
    }
  }
  return serializeMutation(scope(identity), async index => {
    // Fail atomically: a made-up ID is never accepted as a statement of work performed.
    const ids = new Set(index.segments.map(segment => segment.id));
    if (items.some(item => !ids.has(item.id))) throw new Error('Archive entry not found for this Role/session');
    for (const item of items) {
      const segment = index.segments.find(segment => segment.id === item.id);
      segment.note = item.note.trim();
      segment.curatedAt = new Date().toISOString();
    }
    return { curated: items.length, nativeContextChanged: false,
      message: 'Archive notes updated. Provider-owned context was not modified.' };
  });
}

async function recallArchive(identity, { id, offset = 0, maxChars = 6000 } = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Invalid archive id');
  const dir = scope(identity);
  const index = await readIndex(dir);
  const segment = index.segments.find(item => item.id === id);
  if (!segment) throw new Error('Archive entry not found for this Role/session');
  const original = await fs.readFile(path.join(dir, 'blobs', id + '.txt'), 'utf8');
  const start = Number.isInteger(offset) ? Math.max(0, Math.min(offset, original.length)) : 0;
  const requested = Number.isInteger(maxChars) ? maxChars : 6000;
  const size = Math.max(1, Math.min(MAX_RECALL_CHARS, requested));
  const text = original.slice(start, start + size);
  return { id, name: segment.name, note: segment.note, text, offset: start,
    totalChars: original.length, nextOffset: start + text.length < original.length ? start + text.length : null };
}

async function proposeCompaction(identity, { summary, keepIds = [] } = {}) {
  if (typeof summary !== 'string' || summary.trim().length < 40 || summary.length > 2500) {
    throw new Error('summary must describe goal, decisions, results and pending work (40–2500 characters)');
  }
  if (!Array.isArray(keepIds) || keepIds.length > 12 ||
      keepIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 180)) {
    throw new Error('keepIds must be 0–12 context IDs');
  }
  return serializeMutation(scope(identity), async index => {
    const proposal = { id: crypto.randomUUID(), summary: summary.trim(),
      keepIds: [...new Set(keepIds)], status: 'pending', createdAt: new Date().toISOString() };
    index.proposal = proposal;
    return { proposalId: proposal.id, status: 'pending',
      message: 'Queued for post-turn review; no native compaction has occurred.' };
  });
}

async function pendingCompaction(identity) {
  const proposal = (await readIndex(scope(identity))).proposal;
  return proposal?.status === 'pending' ? proposal : null;
}

async function settleCompaction(identity, proposalId, status) {
  if (!['applied', 'unsupported', 'failed'].includes(status)) throw new Error('Invalid proposal state');
  return serializeMutation(scope(identity), async index => {
    if (!index.proposal || index.proposal.id !== proposalId || index.proposal.status !== 'pending') {
      return { matched: false };
    }
    index.proposal.status = status;
    index.proposal.settledAt = new Date().toISOString();
    return { matched: true, status };
  });
}

module.exports = {
  ROOT, MAX_OUTPUT_BYTES, captureToolOutputs, listArchive, curateArchive, recallArchive,
  proposeCompaction, pendingCompaction, settleCompaction
};
