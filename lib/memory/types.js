const crypto = require('node:crypto');

const MemoryScope = Object.freeze({
  GLOBAL: 'GLOBAL',
  ROLE: 'ROLE',
  PROJECT: 'PROJECT',
  SESSION: 'SESSION'
});

const VALID_SCOPES = new Set(Object.values(MemoryScope));

function cleanText(value, maxLength = 12000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeScope(scope) {
  const value = String(scope || '').trim().toUpperCase();
  if (!VALID_SCOPES.has(value)) throw new Error(`Invalid memory scope: ${scope}`);
  return value;
}

function normalizeMemoryRecord(input = {}, now = Date.now()) {
  const scope = normalizeScope(input.scope || MemoryScope.ROLE);
  const record = {
    id: cleanText(input.id, 180) || crypto.randomUUID(),
    text: cleanText(input.text, 12000),
    scope,
    roleId: cleanText(input.roleId, 160) || null,
    projectId: cleanText(input.projectId, 160) || null,
    conversationId: cleanText(input.conversationId, 180) || null,
    kind: cleanText(input.kind, 80) || 'experience',
    tags: Array.isArray(input.tags)
      ? [...new Set(input.tags.map(value => cleanText(value, 80)).filter(Boolean))].slice(0, 32)
      : [],
    importance: Number.isFinite(Number(input.importance))
      ? Math.max(0, Math.min(1, Number(input.importance)))
      : 0.5,
    source: cleanText(input.source, 160) || 'manual',
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now
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
  return {
    text: cleanText(input.text, 8000),
    scopes,
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
  normalizeScope,
  normalizeMemoryRecord,
  normalizeMemoryQuery
};
