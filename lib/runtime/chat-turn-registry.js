'use strict';

// Recovery is tied to one operation ID, never to a matching prompt or an idle
// conversation. HTTP turns and background operations share this bounded cache.
// After a Runtime restart, an unknown operation must never be replayed.
function publicTurnActivity(turn) {
  if (!turn) return null;
  return {
    request_id: turn.request_id, provider: turn.provider,
    conversation_id: turn.conversation_id, role_id: turn.role_id || null,
    kind: turn.kind || 'chat', source: turn.source || null, status: turn.status,
    terminal: turn.terminal, phase: turn.activity_phase || turn.status,
    started_at: turn.started_at, last_activity_at: turn.last_activity_at || null,
    ended_at: turn.ended_at || null
  };
}

class ChatTurnRegistry {
  constructor({ now = Date.now, ttlMs = 30 * 60_000, maxFinished = 100, maxBytes = 8 * 1024 * 1024 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxFinished = maxFinished;
    this.maxBytes = maxBytes;
    this.sizes = new Map();
    this.records = new Map();
  }

  prune() {
    const finished = [...this.records.values()].filter(record => record.terminal);
    for (const record of finished) {
      if (this.now() - record.ended_at >= this.ttlMs) this.records.delete(record.request_id);
    }
    const remaining = finished.filter(record => this.records.has(record.request_id));
    let bytes = remaining.reduce((sum, record) => sum + (this.sizes.get(record.request_id) || 0), 0);
    for (const record of remaining) {
      if (bytes <= this.maxBytes) break;
      bytes -= this.sizes.get(record.request_id) || 0;
      this.records.delete(record.request_id);
    }
    for (const record of remaining.slice(0, Math.max(0, remaining.length - this.maxFinished))) {
      this.records.delete(record.request_id);
    }
    for (const key of this.sizes.keys()) if (!this.records.has(key)) this.sizes.delete(key);
  }

  start(requestId, provider, conversationId, { kind = 'chat', source = null, roleId = null } = {}) {
    this.prune();
    if (this.records.has(requestId)) return false;
    this.records.set(requestId, {
      request_id: requestId, provider, conversation_id: conversationId || null,
      kind, source, role_id: roleId,
      status: 'preparing', terminal: false, accepted: false,
      started_at: this.now(), last_event_at: this.now()
    });
    return true;
  }

  update(requestId, values) {
    const record = this.records.get(requestId);
    if (record && !record.terminal) Object.assign(record, values, { last_event_at: this.now() });
  }

  noteProviderEvent(requestId, event) {
    const phases = {
      session_started: 'waiting', text_delta: 'responding', reasoning_delta: 'thinking',
      reasoning_complete: 'thinking', compaction: 'compacting', error: 'awaiting_result',
      turn_completed: 'finishing'
    };
    let phase = phases[event?.type];
    if (event?.type === 'error' && event.retryable === true) phase = 'retrying';
    if (event?.type === 'tool') {
      phase = ['completed', 'complete', 'done', 'success', 'succeeded', 'failed', 'error', 'cancelled', 'canceled', 'interrupted']
        .includes(String(event.state || '').toLowerCase()) ? 'tool_result' : 'tool';
    }
    if (!phase && event?.type !== 'context_usage') return;
    this.update(requestId, {
      last_activity_at: this.now(), ...(phase ? { activity_phase: phase } : {}),
      ...(event.type === 'session_started' ? {
        ...(event.conversationId ? { conversation_id: event.conversationId } : {}),
        accepted: true, status: 'running'
      } : {})
    });
  }

  latestForConversation(provider, conversationId) {
    return this.latestMatching(record => record.provider === provider && record.conversation_id === conversationId);
  }

  latestForRole(roleId) {
    return this.latestMatching(record => record.role_id === roleId);
  }

  latestMatching(matches) {
    this.prune();
    let active = null;
    let latest = null;
    for (const record of this.records.values()) {
      if (!matches(record)) continue;
      if (!latest || record.started_at >= latest.started_at) latest = record;
      if (!record.terminal && (!active || record.started_at >= active.started_at)) active = record;
    }
    return active || latest;
  }

  finish(requestId, payload) {
    const record = this.records.get(requestId);
    if (!record || record.terminal) return;
    Object.assign(record, {
      conversation_id: payload.conversation_id || record.conversation_id,
      status: payload.status || 'unknown', terminal: true, ended_at: this.now(),
      result: { ...payload, request_id: requestId, provider: record.provider }
    });
    this.sizes.set(requestId, Buffer.byteLength(JSON.stringify(record)));
    this.prune();
  }

  get(requestId, provider) {
    this.prune();
    const record = this.records.get(requestId);
    return record?.provider === provider ? record : null;
  }
}

module.exports = { ChatTurnRegistry, publicTurnActivity };
