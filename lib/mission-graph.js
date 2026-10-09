'use strict';

// A read-only, role-scoped evidence projection. A message is NOT a task, and
// replyToId is the only supported dependency edge. Never infer mission progress.
const MAX_GRAPH_EVENTS = 40;
const MAX_PREVIEW_CHARS = 180;
const idPattern = /^[A-Za-z0-9._-]{1,160}$/;

function clean(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function makeMissionGraph({ focusRole, activity, limit = MAX_GRAPH_EVENTS } = {}) {
  const roleId = clean(focusRole?.id);
  if (!idPattern.test(roleId)) throw new Error('Invalid focus role');
  const boundedLimit = Math.max(1, Math.min(MAX_GRAPH_EVENTS, Math.trunc(Number(limit)) || MAX_GRAPH_EVENTS));
  const messages = (Array.isArray(activity) ? activity : [])
    .filter(message => (
      message && typeof message === 'object' &&
      (message.fromRoleId === roleId || message.toRoleId === roleId) &&
      idPattern.test(String(message.fromRoleId || '')) &&
      idPattern.test(String(message.toRoleId || '')) &&
      String(message.fromRoleId) !== String(message.toRoleId)
    ))
    .map(message => ({
      id: clean(message.id),
      fromRoleId: clean(message.fromRoleId),
      fromRoleName: clean(message.fromRoleName || message.fromRoleNameSnapshot || message.fromRoleId, 120),
      toRoleId: clean(message.toRoleId),
      toRoleName: clean(message.toRoleName || message.toRoleNameSnapshot || message.toRoleId, 120),
      kind: message.replyToId ? 'reply' : 'handoff',
      replyToId: message.replyToId ? clean(message.replyToId) : null,
      createdAt: Number.isFinite(Number(message.createdAt)) && Number(message.createdAt) > 0
        ? Math.trunc(Number(message.createdAt)) : null,
      deliveredAt: Number.isFinite(Number(message.deliveredAt)) && Number(message.deliveredAt) > 0
        ? Math.trunc(Number(message.deliveredAt)) : null,
      preview: clean(message.content, MAX_PREVIEW_CHARS)
    }))
    .filter(item => idPattern.test(item.id))
    .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id))
    .slice(0, boundedLimit);
  const includedIds = new Set(messages.map(item => item.id));
  const events = messages.map(item => ({
    ...item,
    linkedReplyId: item.replyToId && includedIds.has(item.replyToId) ? item.replyToId : null
  }));
  const participants = new Map([[roleId, { id: roleId, name: clean(focusRole.name, 120) || roleId }]]);
  for (const event of events) {
    if (!participants.has(event.fromRoleId)) participants.set(event.fromRoleId, {
      id: event.fromRoleId, name: event.fromRoleName
    });
    if (!participants.has(event.toRoleId)) participants.set(event.toRoleId, {
      id: event.toRoleId, name: event.toRoleName
    });
  }
  return {
    focusRoleId: roleId,
    focusRoleName: clean(focusRole.name, 120) || roleId,
    events,
    participants: [...participants.values()],
    relationCount: events.length,
    // "hasMore" would be a guess without a cursor. Explicitly omit it.
    evidence: 'crew-messages',
    // Never claim historical "mission" or completion for live Runtime state.
    graphVersion: 1
  };
}

module.exports = { makeMissionGraph, MAX_GRAPH_EVENTS };
