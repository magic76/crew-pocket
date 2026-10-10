const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AUTO_COMPACT_CONFIG, isStageTransition } = require('./auto-compact');

const AUTO_COMPACT_STATE_FILE = process.env.CREW_AUTO_COMPACT_STATE_FILE ||
  path.join(os.homedir(), '.crew-pocket', 'auto-compact.json');
const AUTO_COMPACT_TELEMETRY_FILE = process.env.CREW_AUTO_COMPACT_TELEMETRY_FILE ||
  path.join(os.homedir(), '.crew-pocket', 'auto-compact-telemetry.jsonl');

let pendingWrite = Promise.resolve();
let pendingTelemetry = Promise.resolve();

function key(provider, conversationId) {
  if (!/^[a-z0-9_-]{1,80}$/i.test(String(provider || '')) ||
      !/^[a-z0-9_-]+$/i.test(String(conversationId || ''))) {
    throw new Error('Invalid auto compact identity');
  }
  return `${provider}:${conversationId}`;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(AUTO_COMPACT_STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { enabled: parsed.enabled === true, conversations: parsed.conversations || {} }
      : { enabled: false, conversations: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, conversations: {} };
    throw error;
  }
}

function updateStore(mutator) {
  const operation = pendingWrite.catch(() => {}).then(async () => {
    const data = await readStore();
    const value = mutator(data);
    await fs.mkdir(path.dirname(AUTO_COMPACT_STATE_FILE), { recursive: true });
    const temp = `${AUTO_COMPACT_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
      await fs.rename(temp, AUTO_COMPACT_STATE_FILE);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    return value;
  });
  pendingWrite = operation;
  return operation;
}

async function getAutoCompactSettings() {
  await pendingWrite.catch(() => {});
  return { enabled: (await readStore()).enabled === true };
}

async function setAutoCompactSettings(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  return updateStore(data => {
    data.enabled = enabled;
    return { enabled };
  });
}

async function getAutoCompactState(provider, conversationId) {
  const id = key(provider, conversationId);
  await pendingWrite.catch(() => {});
  return (await readStore()).conversations[id] || {};
}

function updateConversation(provider, conversationId, mutate) {
  const id = key(provider, conversationId);
  return updateStore(data => {
    const state = data.conversations[id] || { turnCount: 0 };
    const result = mutate(state);
    data.conversations[id] = state;
    return result || state;
  });
}

async function recordAutoCompactTurn(provider, conversationId, currentStage = null) {
  return updateConversation(provider, conversationId, state => {
    state.turnCount = (Number(state.turnCount) || 0) + 1;
    if (['research','implementation','test','review'].includes(currentStage)) {
      if (isStageTransition(state.stage, currentStage)) state.stageTransitionAt = Date.now();
      state.stage = currentStage;
    }
    state.updatedAt = Date.now();
  });
}

async function recordAutoCompactSuccess(provider, conversationId, { afterTokens = 0 } = {}) {
  return updateConversation(provider, conversationId, state => {
    state.lastCompactedAt = new Date().toISOString();
    state.stageTransitionAt = null;
    state.lastCompactedTurn = Number(state.turnCount) || 0;
    state.lastCompactedTokenCount = Math.max(0, Number(afterTokens) || 0);
    state.updatedAt = Date.now();
  });
}

function appendAutoCompactTelemetry(entry) {
  const write = pendingTelemetry.catch(() => {}).then(async () => {
    const allowed = [
      'conversationId','agentId','provider','timestamp','beforeTokens','afterTokens',
      'contextPressure','staleContextRatio','toolOutputRatio','repetitionScore',
      'taskStageTransition','workingStateStable','recommendation','score','safeNow',
      'didCompact','mode','toolCalls','repeatedToolCalls','taskSuccess','taskFailure','rollback'
    ];
    const payload = {};
    for (const field of allowed) if (entry?.[field] !== undefined) payload[field] = entry[field];
    await fs.mkdir(path.dirname(AUTO_COMPACT_TELEMETRY_FILE), { recursive: true });
    const stat = await fs.stat(AUTO_COMPACT_TELEMETRY_FILE).catch(error =>
      error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat && stat.size >= AUTO_COMPACT_CONFIG.telemetryMaxBytes) {
      await fs.rename(AUTO_COMPACT_TELEMETRY_FILE, `${AUTO_COMPACT_TELEMETRY_FILE}.previous`);
    }
    await fs.appendFile(AUTO_COMPACT_TELEMETRY_FILE, JSON.stringify(payload) + '\n', 'utf8');
  });
  pendingTelemetry = write;
  return write;
}

module.exports = {
  AUTO_COMPACT_STATE_FILE, AUTO_COMPACT_TELEMETRY_FILE,
  getAutoCompactSettings, setAutoCompactSettings, getAutoCompactState,
  recordAutoCompactTurn, recordAutoCompactSuccess, appendAutoCompactTelemetry
};
