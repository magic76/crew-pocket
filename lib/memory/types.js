const crypto = require('node:crypto');

const MemoryScope = Object.freeze({
  GLOBAL: 'GLOBAL',
  ROLE: 'ROLE',
  PROJECT: 'PROJECT',
  SESSION: 'SESSION'
});

const MemorySourceType = Object.freeze({
  CONVERSATION: 'conversation',
  MESSAGE: 'message',
  TOOL: 'tool',
  GIT: 'git',
  DOCUMENT: 'document',
  MEMORY: 'memory'
});

const MemoryDerivationType = Object.freeze({
  USER_EXPLICIT: 'USER_EXPLICIT',
  SYSTEM_OBSERVED: 'SYSTEM_OBSERVED',
  TOOL_OBSERVED: 'TOOL_OBSERVED',
  MODEL_INFERRED: 'MODEL_INFERRED'
});

const MemoryStatus = Object.freeze({
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  DISPUTED: 'disputed',
  ARCHIVED: 'archived'
});

const VALID_SCOPES = new Set(Object.values(MemoryScope));
const VALID_SOURCE_TYPES = new Set(Object.values(MemorySourceType));
const VALID_DERIVATIONS = new Set(Object.values(MemoryDerivationType));
const VALID_STATUSES = new Set(Object.values(MemoryStatus));

function cleanText(value, maxLength = 12000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeScope(scope) {
  const value = String(scope || '').trim().toUpperCase();
  if (!VALID_SCOPES.has(value)) throw new Error(`Invalid memory scope: ${scope}`);
  return value;
}

function normalizeMemoryStatus(status) {
  const value = String(status || MemoryStatus.ACTIVE).trim().toLowerCase();
  if (!VALID_STATUSES.has(value)) throw new Error(`Invalid memory status: ${status}`);
  return value;
}

function normalizeMemorySourceRef(input = {}) {
  const type = String(input.type || '').trim().toLowerCase();
  if (!VALID_SOURCE_TYPES.has(type)) throw new Error(`Invalid memory source type: ${input.type}`);
  const id = cleanText(input.id, 500);
  if (!id) throw new Error('Memory source id is required');

  const timestamp = input.timestamp === undefined || input.timestamp === null || input.timestamp === ''
    ? null
    : Number(input.timestamp);
  if (timestamp !== null && !Number.isFinite(timestamp)) throw new Error('Invalid memory source timestamp');

  return {
    type,
    id,
    ...(cleanText(input.uri, 2000) ? { uri: cleanText(input.uri, 2000) } : {}),
    ...(timestamp !== null ? { timestamp } : {})
  };
}

function normalizeMemoryProvenance(input) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid memory provenance');

  const derivation = String(input.derivation || '').trim().toUpperCase();
  if (!VALID_DERIVATIONS.has(derivation)) {
    throw new Error(`Invalid memory derivation: ${input.derivation}`);
  }

  const sources = Array.isArray(input.sources)
    ? input.sources.map(normalizeMemorySourceRef).slice(0, 64)
    : [];
  const derivedFrom = Array.isArray(input.derivedFrom)
    ? [...new Set(input.derivedFrom.map(value => cleanText(value, 180)).filter(Boolean))].slice(0, 64)
    : [];

  return {
    sources,
    ...(derivedFrom.length ? { derivedFrom } : {}),
    derivation
  };
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Invalid memory confidence');
  return Math.max(0, Math.min(1, numeric));
}

function normalizeMemoryRecord(input = {}, now = Date.now()) {
  const scope = normalizeScope(input.scope || MemoryScope.ROLE);
  const status = normalizeMemoryStatus(input.status || MemoryStatus.ACTIVE);
  const record = {
    id: cleanText(input.id, 180) || crypto.randomUUID(),
    text: cleanText(input.text ?? input.content, 12000),
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
    provenance: normalizeMemoryProvenance(input.provenance),
    confidence: normalizeConfidence(input.confidence),
    status,
    supersedes: Array.isArray(input.supersedes)
      ? [...new Set(input.supersedes.map(value => cleanText(value, 180)).filter(Boolean))].slice(0, 64)
      : [],
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now
  };

  record.supersedes = record.supersedes.filter(id => id !== record.id);

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

  const rawStatuses = Array.isArray(input.statuses)
    ? input.statuses
    : (input.status ? [input.status] : [MemoryStatus.ACTIVE]);
  const statuses = [...new Set(rawStatuses.map(normalizeMemoryStatus))];

  return {
    text: cleanText(input.text, 8000),
    scopes,
    statuses,
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
  MemorySourceType,
  MemoryDerivationType,
  MemoryStatus,
  normalizeScope,
  normalizeMemoryStatus,
  normalizeMemorySourceRef,
  normalizeMemoryProvenance,
  normalizeMemoryRecord,
  normalizeMemoryQuery
};
