const fs = require('node:fs/promises');
const path = require('node:path');

// Keep Crew Pocket-owned preferences outside provider-owned transcripts. This
// lets an AGY brain and a Codex JSONL remain untouched while both can restore
// their chosen model after a browser restart.
const SETTINGS_DIR = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket');
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'conversation-settings.json');
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function key(provider, conversationId) {
  return `${provider}:${conversationId}`;
}

async function readAll() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAll(data) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryPath, SETTINGS_PATH);
}

function validate(provider, conversationId, settings = {}) {
  if (!['antigravity', 'codex'].includes(provider)) throw new Error('Invalid provider');
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId || '')) throw new Error('Invalid conversation id');
  if (typeof settings.model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(settings.model)) throw new Error('Invalid model');
  if (!VALID_EFFORTS.has(settings.effort)) throw new Error('Invalid reasoning effort');
}

async function getConversationSettings(provider, conversationId) {
  if (!provider || !conversationId) return null;
  const data = await readAll();
  return data[key(provider, conversationId)] || null;
}

async function saveConversationSettings(provider, conversationId, settings) {
  validate(provider, conversationId, settings);
  const data = await readAll();
  const value = { provider, model: settings.model, effort: settings.effort, updatedAt: Date.now() };
  data[key(provider, conversationId)] = value;
  await writeAll(data);
  return value;
}

async function deleteConversationSettings(provider, conversationId) {
  const data = await readAll();
  const settingKey = key(provider, conversationId);
  if (!Object.prototype.hasOwnProperty.call(data, settingKey)) return;
  delete data[settingKey];
  await writeAll(data);
}

module.exports = { getConversationSettings, saveConversationSettings, deleteConversationSettings };
