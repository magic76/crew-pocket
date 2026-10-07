const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_ROLE_ID } = require('./roles');

// Keep Crew Pocket-owned preferences outside provider-owned transcripts. This
// lets an AGY brain and a Codex JSONL remain untouched while both can restore
// their chosen model after a browser restart.
const SETTINGS_DIR = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket');
const SETTINGS_PATH = process.env.CREW_CONVERSATION_SETTINGS_PATH || path.join(SETTINGS_DIR, 'conversation-settings.json');
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const VALID_ROLES = new Set(['lead', 'backend', 'research', 'debug', 'ux', 'general']);
const VALID_EXECUTION_MODES = new Set(['CHAT', 'INSPECT', 'SURGICAL_EDIT', 'DEBUG', 'BUILD']);
const ROLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

function key(provider, conversationId) {
  return `${provider}:${conversationId}`;
}

function migrateRoleId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  if (typeof value.roleId === 'string' && ROLE_ID_PATTERN.test(value.roleId)) {
    return { value, changed: false };
  }
  return {
    value: { ...value, roleId: DEFAULT_ROLE_ID },
    changed: true
  };
}

async function readAll() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    let changed = false;
    const data = {};
    for (const [settingKey, stored] of Object.entries(parsed)) {
      const migrated = migrateRoleId(stored);
      data[settingKey] = migrated.value;
      changed = changed || migrated.changed;
    }
    if (changed) await writeAll(data);
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAll(data) {
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryPath, SETTINGS_PATH);
}

function validate(provider, conversationId, settings = {}) {
  if (!['antigravity', 'codex'].includes(provider)) throw new Error('Invalid provider');
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId || '')) throw new Error('Invalid conversation id');
  if (typeof settings.model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(settings.model)) throw new Error('Invalid model');
  if (!VALID_EFFORTS.has(settings.effort)) throw new Error('Invalid reasoning effort');
  if (settings.workspace !== undefined && (typeof settings.workspace !== 'string' || settings.workspace.length < 1 || settings.workspace.length > 512)) {
    throw new Error('Invalid workspace');
  }
  if (settings.crewMemberId !== undefined && (typeof settings.crewMemberId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(settings.crewMemberId))) {
    throw new Error('Invalid Crew Member id');
  }
  if (settings.roleId !== undefined && (typeof settings.roleId !== 'string' || !ROLE_ID_PATTERN.test(settings.roleId))) {
    throw new Error('Invalid Role id');
  }
  if (settings.role !== undefined && !VALID_ROLES.has(settings.role)) throw new Error('Invalid role');
  if (settings.executionMode !== undefined && !VALID_EXECUTION_MODES.has(settings.executionMode)) throw new Error('Invalid execution mode');
}

async function getConversationSettings(provider, conversationId) {
  if (!provider || !conversationId) return null;
  const data = await readAll();
  return data[key(provider, conversationId)] || null;
}

async function getProviderConversationSettings(provider) {
  const data = await readAll();
  const prefix = `${provider}:`;
  const settings = new Map();
  for (const [settingKey, value] of Object.entries(data)) {
    if (settingKey.startsWith(prefix) && value?.provider === provider) settings.set(settingKey.slice(prefix.length), value);
  }
  return settings;
}

async function saveConversationSettings(provider, conversationId, settings) {
  validate(provider, conversationId, settings);
  const data = await readAll();
  const previous = data[key(provider, conversationId)] || {};
  const value = {
    ...previous,
    provider,
    model: settings.model,
    effort: settings.effort,
    roleId: settings.roleId || previous.roleId || DEFAULT_ROLE_ID,
    ...(settings.workspace ? { workspace: settings.workspace } : {}),
    ...(settings.crewMemberId ? { crewMemberId: settings.crewMemberId } : {}),
    ...(settings.role ? { role: settings.role } : {}),
    ...(settings.executionMode ? { executionMode: settings.executionMode } : {}),
    updatedAt: Date.now()
  };
  data[key(provider, conversationId)] = value;
  await writeAll(data);
  return value;
}

async function saveConversationTitle(provider, conversationId, title) {
  if (!['antigravity', 'codex'].includes(provider)) throw new Error('Invalid provider');
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId || '')) throw new Error('Invalid conversation id');
  const cleanTitle = String(title || '').trim().slice(0, 60);
  if (!cleanTitle) throw new Error('Invalid title');
  const data = await readAll();
  const settingKey = key(provider, conversationId);
  data[settingKey] = {
    ...(data[settingKey] || {}),
    provider,
    roleId: data[settingKey]?.roleId || DEFAULT_ROLE_ID,
    title: cleanTitle,
    titleUpdatedAt: Date.now()
  };
  await writeAll(data);
  return data[settingKey];
}

async function getConversationTitles(provider) {
  const data = await readAll();
  const titles = new Map();
  for (const [settingKey, value] of Object.entries(data)) {
    if (value?.provider !== provider || typeof value.title !== 'string' || !value.title.trim()) continue;
    const prefix = `${provider}:`;
    if (settingKey.startsWith(prefix)) titles.set(settingKey.slice(prefix.length), value.title.trim());
  }
  return titles;
}

async function deleteConversationSettings(provider, conversationId) {
  const data = await readAll();
  const settingKey = key(provider, conversationId);
  if (!Object.prototype.hasOwnProperty.call(data, settingKey)) return;
  delete data[settingKey];
  await writeAll(data);
}

module.exports = {
  SETTINGS_PATH,
  getConversationSettings,
  getProviderConversationSettings,
  saveConversationSettings,
  saveConversationTitle,
  getConversationTitles,
  deleteConversationSettings
};
