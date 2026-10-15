'use strict';

// Read provider-owned lifecycle events without modifying the rollout. Message
// timestamps are indexed while reading their native turn, never matched to a
// nearby answer, matching text, or the conversation's current busy state.
class CodexTurnOutcomes {
  constructor() {
    this.activeId = null;
    this.starts = new Map();
    this.owners = new Map();
    this.outcomes = new Map();
  }

  consume(entry) {
    const payload = entry.payload || {};
    const event = entry.type === 'event_msg' ? payload.type : null;
    if (event === 'task_started') {
      this.activeId = payload.turn_id || null;
      if (this.activeId) this.starts.set(this.activeId, Date.parse(entry.timestamp));
    }
    if (this.activeId && entry.timestamp) {
      const previous = this.owners.get(entry.timestamp);
      this.owners.set(entry.timestamp, previous !== undefined && previous !== this.activeId ? null : this.activeId);
    }
    if (!['task_complete', 'turn_aborted'].includes(event)) return;
    const id = payload.turn_id;
    if (!id || !this.starts.has(id)) return;
    const error = payload.error
      ? (typeof payload.error === 'string' ? payload.error : payload.error.message || 'Codex turn failed') : null;
    const startedAt = this.starts.get(id);
    const endedAt = Date.parse(entry.timestamp);
    const explicitDuration = payload.duration_ms;
    const duration = typeof explicitDuration === 'number' && Number.isFinite(explicitDuration) && explicitDuration >= 0
      ? explicitDuration : Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt - startedAt : null;
    const rawStatus = payload.status;
    const status = error || ['failed', 'error'].includes(rawStatus) ? 'failed'
      : event === 'turn_aborted' || ['interrupted', 'cancelled', 'canceled', 'aborted'].includes(rawStatus) ? 'interrupted'
        : !rawStatus || ['completed', 'complete', 'success', 'succeeded'].includes(rawStatus) ? 'completed' : 'unknown';
    this.outcomes.set(id, {
      version: 1, kind: 'execution', native_turn_id: id, source: 'codex_lifecycle',
      status, duration_ms: duration, started_at: startedAt, ended_at: endedAt,
      ...(error ? { error: String(error).slice(0, 4000) } : {}),
      ...(typeof payload.error?.codex_error_info === 'string' ? { error_code: payload.error.codex_error_info } : {})
    });
    if (this.activeId === id) this.activeId = null;
  }

  apply(messages) {
    const attached = messages.map(message => {
      const id = this.owners.get(message.timestamp);
      if (!id) return message;
      const outcome = this.outcomes.get(id);
      return { ...message, native_turn_id: id,
        ...(message.role === 'assistant' && outcome && (message.tools?.length || outcome.status !== 'completed')
          ? { turn_result: outcome } : {}) };
    });
    // A failed turn can end before its first assistant token. Keep that failure
    // visible beside its own user message, without inventing an assistant reply.
    const assistantIds = new Set(attached.filter(message => message.role === 'assistant').map(message => message.native_turn_id));
    const lastUser = new Map();
    attached.forEach((message, index) => { if (message.role === 'user' && message.native_turn_id) lastUser.set(message.native_turn_id, index); });
    return attached.flatMap((message, index) => {
      const outcome = this.outcomes.get(message.native_turn_id);
      if (!outcome || !['failed', 'interrupted'].includes(outcome.status) || assistantIds.has(message.native_turn_id) ||
          lastUser.get(message.native_turn_id) !== index) return [message];
      return [message, { role: 'assistant', content: '', tools: [], thinking: '',
        timestamp: Number.isFinite(outcome.ended_at) ? new Date(outcome.ended_at).toISOString() : message.timestamp,
        native_turn_id: message.native_turn_id, turn_result: outcome }];
    });
  }
}

module.exports = { CodexTurnOutcomes };
