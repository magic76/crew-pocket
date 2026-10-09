const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeContextContribution, ContextSourceType } = require('./types');

const CONTEXT_STATE_PATH = process.env.CREW_CONTEXT_STATE_PATH ||
  path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'context-state.json');

function stateKey(provider, conversationId) {
  return `${provider}:${conversationId}`;
}

function validateIdentity(provider, conversationId) {
  if (!/^[a-z0-9_-]{1,80}$/i.test(String(provider || ''))) throw new Error('Invalid context provider');
  if (!/^[a-zA-Z0-9_-]+$/.test(String(conversationId || ''))) throw new Error('Invalid context conversation id');
}

async function readAll() {
  try {
    const raw = await fs.readFile(CONTEXT_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeAll(data) {
  await fs.mkdir(path.dirname(CONTEXT_STATE_PATH), { recursive: true });
  const temp = `${CONTEXT_STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(temp, CONTEXT_STATE_PATH);
}

function sanitizeContributions(contributions = []) {
  return contributions.slice(0, 240).map(normalizeContextContribution);
}

async function getContextSnapshot(provider, conversationId) {
  if (!provider || !conversationId) return null;
  validateIdentity(provider, conversationId);
  const data = await readAll();
  return data[stateKey(provider, conversationId)] || null;
}

async function saveContextSnapshot(provider, conversationId, {
  contributions = [],
  reretrieveMemoryOnNextTurn = false,
  compactedAt = null,
  crewToolGuideVersion = undefined,
  identityFingerprint = undefined,
  memoryRevision = undefined,
  memorySignatures = undefined
} = {}) {
  validateIdentity(provider, conversationId);
  const data = await readAll();
  const key = stateKey(provider, conversationId);
  const previous = data[key] || {};
  const next = {
    ...previous,
    provider,
    conversationId,
    contributions: sanitizeContributions(contributions),
    reretrieveMemoryOnNextTurn: Boolean(reretrieveMemoryOnNextTurn),
    ...(crewToolGuideVersion !== undefined ? { crewToolGuideVersion: Number(crewToolGuideVersion) || 0 } : {}),
    ...(identityFingerprint !== undefined ? { identityFingerprint: String(identityFingerprint || '') } : {}),
    ...(memoryRevision !== undefined ? { memoryRevision: memoryRevision === null ? null : String(memoryRevision) } : {}),
    ...(memorySignatures !== undefined ? { memorySignatures: memorySignatures && typeof memorySignatures === 'object' && !Array.isArray(memorySignatures) ? memorySignatures : {} } : {}),
    ...(compactedAt ? { compactedAt } : {}),
    updatedAt: Date.now()
  };
  data[key] = next;
  await writeAll(data);
  return next;
}

async function markContextMemoryReretrieve(provider, conversationId) {
  validateIdentity(provider, conversationId);
  const current = await getContextSnapshot(provider, conversationId) || {
    provider,
    conversationId,
    contributions: []
  };
  return saveContextSnapshot(provider, conversationId, {
    contributions: (current.contributions || []).filter(item => item.type !== ContextSourceType.MEMORY),
    reretrieveMemoryOnNextTurn: true,
    compactedAt: new Date().toISOString()
  });
}

async function deleteContextSnapshot(provider, conversationId) {
  if (!provider || !conversationId) return;
  validateIdentity(provider, conversationId);
  const data = await readAll();
  delete data[stateKey(provider, conversationId)];
  await writeAll(data);
}

module.exports = {
  CONTEXT_STATE_PATH,
  getContextSnapshot,
  saveContextSnapshot,
  markContextMemoryReretrieve,
  deleteContextSnapshot
};
