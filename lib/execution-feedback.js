// UI metadata lives outside provider-owned transcripts. Prefer exact native turn
// IDs; legacy records require both an answer hash and its original time window.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'execution-feedback');
function recordPath(provider, conversationId) {
  if (![provider, conversationId].every(value => /^[A-Za-z0-9_-]+$/.test(value || ''))) throw new Error('Invalid feedback identity');
  return path.join(root, provider, `${conversationId}.jsonl`);
}
function hash(text) { return crypto.createHash('sha256').update(String(text || '')).digest('hex'); }
async function saveExecutionFeedback(provider, conversationId, { response, startedAt, endedAt = Date.now(), turnResult, tools,
  requestId, nativeTurnId, status, error, errorCode, durationMs } = {}) {
  if (!conversationId || (!turnResult && !status)) return;
  const result = turnResult || {
    version: 1, kind: 'execution', status, request_id: requestId || null,
    duration_ms: durationMs ?? Math.max(0, endedAt - startedAt)
  };
  const file = recordPath(provider, conversationId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify({ responseHash: response ? hash(response) : null,
    requestId: requestId || result.request_id || null, nativeTurnId: nativeTurnId || null,
    startedAt, endedAt, turnResult: { ...result, ...(error ? { error: String(error).slice(0, 4000) } : {}),
      ...(typeof errorCode === 'string' ? { error_code: errorCode } : {}) }, tools }) + '\n');
}
async function enrichExecutionHistory(provider, conversationId, history) {
  let source;
  try { source = await fs.readFile(recordPath(provider, conversationId), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return history; throw error; }
  const records = source.split('\n').flatMap(line => {
    try {
      const record = JSON.parse(line);
      return record && typeof record === 'object' && record.turnResult ? [record] : [];
    } catch (_) { return []; }
  });
  return { ...history, messages: (history.messages || []).map(message => {
    if (message.role !== 'assistant') return message;
    const timestamp = Date.parse(message.timestamp);
    const fingerprint = hash(message.content);
    const record = records.findLast(record => message.native_turn_id && record.nativeTurnId
      ? record.nativeTurnId === message.native_turn_id
      : record.responseHash && record.responseHash === fingerprint && Number.isFinite(timestamp)
        && timestamp >= record.startedAt && timestamp <= record.endedAt);
    if (!record) return message;
    const turnResult = { ...record.turnResult, ...message.turn_result };
    if (message.turn_result?.source === 'codex_lifecycle') {
      // A native completion supersedes an earlier transport interruption.
      // Do not carry a stale error into the provider's confirmed outcome.
      turnResult.error = message.turn_result.error || null;
      turnResult.error_code = message.turn_result.error_code || null;
    }
    // Plain successful chat remains plain chat; failures and tool work retain
    // terminal metadata even when no complete answer was produced.
    return { ...message,
      ...(message.turn_result || record.turnResult.execution_mode || message.tools?.length || record.tools?.length || turnResult.status !== 'completed'
        ? { turn_result: turnResult } : {}),
      tools: record.tools || message.tools };
  }) };
}
module.exports = { saveExecutionFeedback, enrichExecutionHistory };
