const crypto = require('node:crypto');
const { MemoryScope, MemoryState } = require('./types');

const MIN_REFLECTION_CONFIDENCE = 0.72;
const AUTO_ACTIVATE_CONFIDENCE = 0.92;
const PROMOTION_CONFIRMATIONS = 2;
const MAX_REFLECTED_MEMORIES = 3;
const VALID_KINDS = new Set(['architecture', 'decision', 'constraint', 'workflow', 'lesson', 'preference']);

function clamp01(value, fallback = 0.5) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function durableCue(text) {
  return /(?:\b(?:always|never|must|source of truth|prefer|preference|rule|convention|from now on|remember)\b|以後|往後|永遠|不要再|一定要|必須|偏好|慣例|規則|記住|source of truth)/i.test(String(text || ''));
}

function shouldReflectTurn({
  prompt,
  response,
  executionMode,
  status,
  isBtw = false,
  changedFiles = [],
  toolMetrics = {}
} = {}) {
  if (isBtw) return false;
  if (status && !/^(?:completed|success|succeeded|done)$/i.test(String(status))) return false;
  const userText = String(prompt || '').trim();
  const assistantText = String(response || '').trim();
  if (userText.length < 4 || assistantText.length < 30) return false;

  const mode = String(executionMode || '').toUpperCase();
  if (['INSPECT', 'SURGICAL_EDIT', 'DEBUG', 'BUILD'].includes(mode)) return true;
  if (Array.isArray(changedFiles) && changedFiles.length > 0) return true;
  if (Number(toolMetrics.executions) > 0) return true;
  return durableCue(userText);
}

function normalizeFingerprintText(text) {
  return String(text || '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_./-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memoryFingerprint(memory) {
  const owner = memory.scope === MemoryScope.PROJECT
    ? memory.projectId
    : memory.scope === MemoryScope.ROLE
      ? memory.roleId
      : memory.scope === MemoryScope.SESSION
        ? memory.conversationId
        : 'global';
  return crypto.createHash('sha256')
    .update([memory.scope, owner || '', normalizeFingerprintText(memory.text)].join('|'))
    .digest('hex')
    .slice(0, 24);
}

function tokenSet(text) {
  return new Set(
    normalizeFingerprintText(text)
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
  );
}

function memorySimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function hasSensitiveContent(text) {
  const value = String(text || '');
  return /(?:\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization)\s*[:=]\s*\S+)/i.test(value);
}

function normalizeReflectedCandidate(candidate, context = {}) {
  const text = String(candidate?.text || '').trim().slice(0, 600);
  if (!text || hasSensitiveContent(text)) return null;

  let scope = String(candidate?.scope || '').trim().toUpperCase();
  if (scope === MemoryScope.PROJECT && !context.projectId) scope = MemoryScope.ROLE;
  if (![MemoryScope.ROLE, MemoryScope.PROJECT].includes(scope)) {
    scope = context.projectId ? MemoryScope.PROJECT : MemoryScope.ROLE;
  }
  if (scope === MemoryScope.ROLE && !context.roleId) return null;

  const confidence = clamp01(candidate?.confidence, 0);
  if (confidence < MIN_REFLECTION_CONFIDENCE) return null;
  const importance = clamp01(candidate?.importance, 0.5);
  const kind = VALID_KINDS.has(String(candidate?.kind || '').toLowerCase())
    ? String(candidate.kind).toLowerCase()
    : 'lesson';
  const tags = Array.isArray(candidate?.tags)
    ? [...new Set(candidate.tags.map(value => String(value || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 12)
    : [];

  const record = {
    text,
    scope,
    roleId: scope === MemoryScope.ROLE ? context.roleId : (context.roleId || null),
    projectId: scope === MemoryScope.PROJECT ? context.projectId : (context.projectId || null),
    kind,
    tags,
    importance,
    confidence,
    source: 'reflection',
    sourceConversationId: context.conversationId || null,
    lastObservedAt: Date.now()
  };
  record.fingerprint = memoryFingerprint(record);
  return record;
}

function sameScopeIdentity(a, b) {
  if (a.scope !== b.scope) return false;
  if (a.scope === MemoryScope.ROLE) return a.roleId === b.roleId;
  if (a.scope === MemoryScope.PROJECT) return a.projectId === b.projectId;
  if (a.scope === MemoryScope.SESSION) return a.conversationId === b.conversationId;
  return true;
}

function chooseCompatibleMemory(candidate, hits = []) {
  let best = null;
  for (const hit of hits) {
    const record = hit?.record;
    if (!record || !sameScopeIdentity(record, candidate)) continue;
    if (record.fingerprint && record.fingerprint === candidate.fingerprint) return record;
    const similarity = memorySimilarity(record.text, candidate.text);
    if (similarity < 0.64) continue;
    if (!best || similarity > best.similarity) best = { record, similarity };
  }
  return best?.record || null;
}

async function retainReflectedCandidate(memoryProvider, candidate) {
  const hits = await memoryProvider.recall({
    text: candidate.text,
    scopes: [candidate.scope],
    states: [MemoryState.ACTIVE, MemoryState.CANDIDATE],
    roleId: candidate.roleId,
    projectId: candidate.projectId,
    conversationId: candidate.sourceConversationId,
    limit: 20,
    maxChars: 12000
  });
  const existing = chooseCompatibleMemory(candidate, hits);
  const now = Date.now();

  if (existing) {
    const confirmations = Math.max(1, Number(existing.confirmations) || 1) + 1;
    const confidence = Math.max(Number(existing.confidence) || 0, candidate.confidence);
    const importance = Math.max(Number(existing.importance) || 0, candidate.importance);
    const state = existing.state === MemoryState.ACTIVE ||
      confirmations >= PROMOTION_CONFIRMATIONS ||
      confidence >= AUTO_ACTIVATE_CONFIDENCE
      ? MemoryState.ACTIVE
      : MemoryState.CANDIDATE;
    const text = candidate.confidence >= (Number(existing.confidence) || 0)
      ? candidate.text
      : existing.text;
    return memoryProvider.retain({
      ...existing,
      text,
      state,
      confidence,
      importance,
      confirmations,
      tags: [...new Set([...(existing.tags || []), ...(candidate.tags || [])])].slice(0, 32),
      fingerprint: memoryFingerprint({ ...candidate, text }),
      source: 'reflection',
      sourceConversationId: candidate.sourceConversationId || existing.sourceConversationId || null,
      lastObservedAt: now,
      activatedAt: state === MemoryState.ACTIVE ? (existing.activatedAt || now) : null
    });
  }

  const state = candidate.confidence >= AUTO_ACTIVATE_CONFIDENCE
    ? MemoryState.ACTIVE
    : MemoryState.CANDIDATE;
  return memoryProvider.retain({
    ...candidate,
    state,
    confirmations: 1,
    activatedAt: state === MemoryState.ACTIVE ? now : null
  });
}

async function reflectTurn({
  memoryProvider,
  reflectionEngine,
  roleId,
  roleName,
  projectId,
  projectName,
  conversationId,
  prompt,
  response,
  executionMode,
  status = 'completed',
  isBtw = false,
  changedFiles = [],
  toolMetrics = {},
  taskSummary = '',
  force = false
} = {}) {
  if (!memoryProvider || !reflectionEngine) throw new Error('Memory reflection requires provider and engine');
  if (!force && !shouldReflectTurn({ prompt, response, executionMode, status, isBtw, changedFiles, toolMetrics })) {
    return { skipped: true, reason: 'not_durable', retained: [] };
  }

  const input = {
    roleId,
    roleName,
    projectId,
    projectName,
    conversationId,
    prompt: String(prompt || '').slice(0, 3000),
    response: String(response || '').slice(-5000),
    executionMode,
    changedFiles: Array.isArray(changedFiles) ? changedFiles.slice(0, 20) : [],
    toolMetrics,
    taskSummary
  };

  let extracted = null;
  if (typeof memoryProvider.reflect === 'function') {
    extracted = await memoryProvider.reflect(input);
  }
  if (!Array.isArray(extracted)) extracted = await reflectionEngine.extract(input);
  const candidates = extracted
    .slice(0, MAX_REFLECTED_MEMORIES)
    .map(candidate => normalizeReflectedCandidate(candidate, { roleId, projectId, conversationId }))
    .filter(Boolean);

  const retained = [];
  for (const candidate of candidates) {
    retained.push(await retainReflectedCandidate(memoryProvider, candidate));
  }
  return {
    skipped: false,
    extracted: extracted.length,
    accepted: candidates.length,
    retained
  };
}

module.exports = {
  AUTO_ACTIVATE_CONFIDENCE,
  MAX_REFLECTED_MEMORIES,
  MIN_REFLECTION_CONFIDENCE,
  PROMOTION_CONFIRMATIONS,
  durableCue,
  hasSensitiveContent,
  memoryFingerprint,
  memorySimilarity,
  normalizeReflectedCandidate,
  reflectTurn,
  retainReflectedCandidate,
  shouldReflectTurn
};
