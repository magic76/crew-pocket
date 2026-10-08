// UI metadata lives outside provider-owned transcripts. Only exact, timestamped
// answer matches are enriched; older or rewound answers remain unconfirmed.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'execution-feedback');
function recordPath(provider, conversationId) {
  if (![provider, conversationId].every(value => /^[A-Za-z0-9_-]+$/.test(value || ''))) throw new Error('Invalid feedback identity');
  return path.join(root, provider, `${conversationId}.jsonl`);
}
function hash(text) { return crypto.createHash('sha256').update(String(text || '')).digest('hex'); }
async function saveExecutionFeedback(provider, conversationId, { response, startedAt, endedAt = Date.now(), turnResult, tools }) {
  if (!conversationId || !response || !turnResult) return;
  const file = recordPath(provider, conversationId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify({ responseHash: hash(response), startedAt, endedAt, turnResult, tools }) + '\n');
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
    if (message.role !== 'assistant' || message.turn_result) return message;
    const timestamp = Date.parse(message.timestamp);
    const fingerprint = hash(message.content);
    const record = records.find(record => record.responseHash === fingerprint && Number.isFinite(timestamp)
      && timestamp >= record.startedAt && timestamp <= record.endedAt);
    return record ? { ...message, turn_result: record.turnResult, tools: record.tools || message.tools } : message;
  }) };
}
module.exports = { saveExecutionFeedback, enrichExecutionHistory };
