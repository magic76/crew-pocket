const crypto = require('node:crypto');

const MemoryScope = Object.freeze({
  GLOBAL: 'GLOBAL',
  ROLE: 'ROLE',
  PROJECT: 'PROJECT',
  SESSION: 'SESSION'
});

const MemoryState = Object.freeze({
  ACTIVE: 'ACTIVE',
  CANDIDATE: 'CANDIDATE',
  ARCHIVED: 'ARCHIVED'
});

const VALID_SCOPES = new Set(Object.values(MemoryScope));
const VALID_STATES = new Set(Object.values(MemoryState));

function cleanText(value, maxLength = 12000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeScope(scope) {
  const value = String(scope || '').trim().toUpperCase();
  if (!VALID_SCOPES.has(value)) throw new Error(`Invalid memory scope: ${scope}`);
  return value;
}

function normalizeMemoryState(state) {
  const value = String(state || MemoryState.ACTIVE).trim().toUpperCase();
  if (!VALID_STATES.has(value)) throw new Error(`Invalid memory state: ${state}`);
  return value;
}

function normalizeMemoryRecord(input = {}, now = Date.now()) {
  const scope = normalizeScope(input.scope || MemoryScope.ROLE);
  const state = normalizeMemoryState(input.state || MemoryState.ACTIVE);
  const createdAt = Number(input.createdAt) || now;
  const record = {
    id: cleanText(input.id, 180) || crypto.randomUUID(),
    text: cleanText(input.text, 12000),
    scope,
    state,
    roleId: cleanText(input.roleId, 160) || null,
    projectId: cleanText(input.projectId, 160) || null,
    conversationId: cleanText(input.conversationId, 180) || null,
    sourceConversationId: cleanText(input.sourceConversationId, 180) || null,
    kind: cleanText(input.kind, 80) || 'experience',
    tags: Array.isArray(input.tags)
      ? [...new Set(input.tags.map(value => cleanText(value, 80)).filter(Boolean))].slice(0, 32)
      : [],
    importance: Number.isFinite(Number(input.importance))
      ? Math.max(0, Math.min(1, Number(input.importance)))
      : 0.5,
    confidence: Number.isFinite(Number(input.confidence))
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : (input.source === 'reflection' ? 0.5 : 1),
    confirmations: Math.max(1, Math.min(Number(input.confirmations) || 1, 1000000)),
    fingerprint: cleanText(input.fingerprint, 120) || null,
    source: cleanText(input.source, 160) || 'manual',
    createdAt,
    updatedAt: Number(input.updatedAt) || now,
    lastObservedAt: Number(input.lastObservedAt) || Number(input.updatedAt) || now,
    activatedAt: state === MemoryState.ACTIVE
      ? (Number(input.activatedAt) || createdAt)
      : null
  };

  if (!record.text) throw new Error('Memory text is required');
  if (scope === MemoryScope.ROLE && !record.roleId) throw new Error('ROLE memory requires roleId');
  if (scope === MemoryScope.PROJECT && !record.projectId) throw new Error('PROJECT memory requires projectId');
  if (scope === MemoryScope.SESSION && !record.conversationId) throw new Error('SESSION memory requires conversationId');
  return record;
}

function normalizeMemoryQuery(input = {}) {
  const rawScopes = Array.isArray(input.scopes)
    ? input.scopes
    : (input.scope ? [input.scope] : Object.values(MemoryScope));
  const scopes = [...new Set(rawScopes.map(normalizeScope))];

  const rawStates = Array.isArray(input.states)
    ? input.states
    : (input.state
      ? [input.state]
      : (input.includeCandidates
        ? [MemoryState.ACTIVE, MemoryState.CANDIDATE]
        : [MemoryState.ACTIVE]));
  const states = [...new Set(rawStates.map(normalizeMemoryState))];

  return {
    text: cleanText(input.text, 8000),
    scopes,
    states,
    roleId: cleanText(input.roleId, 160) || null,
    projectId: cleanText(input.projectId, 160) || null,
    conversationId: cleanText(input.conversationId, 180) || null,
    limit: Math.max(1, Math.min(Number(input.limit) || 8, 50)),
    maxChars: Math.max(256, Math.min(Number(input.maxChars) || 4000, 24000)),
    now: Number(input.now) || Date.now()
  };
}

module.exports = {
  MemoryScope,
  MemoryState,
  normalizeScope,
  normalizeMemoryState,
  normalizeMemoryRecord,
  normalizeMemoryQuery
};
