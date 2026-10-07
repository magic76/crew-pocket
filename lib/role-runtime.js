const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_ROLE_RUNTIME_PATH = process.env.CREW_ROLE_RUNTIME_PATH || path.join(
  process.env.HOME || '/data/data/com.termux/files/home',
  '.crew-pocket',
  'role-runtime.json'
);

const ROLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function cleanText(value, maxLength = 512) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeRuntime(input = {}, fallback = {}, now = Date.now()) {
  const roleId = cleanText(input.roleId || fallback.roleId, 160);
  const providerId = cleanText(input.providerId || fallback.providerId, 80);
  const pendingNew = input.pendingNew === true || (input.pendingNew === undefined && fallback.pendingNew === true);
  const conversationId = cleanText(input.conversationId ?? fallback.conversationId, 200) || null;

  if (!ROLE_ID_PATTERN.test(roleId)) throw new Error('Invalid role runtime role id');
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error('Invalid role runtime provider id');
  if (!pendingNew && !CONVERSATION_ID_PATTERN.test(conversationId || '')) throw new Error('Invalid role runtime conversation id');
  if (pendingNew && conversationId && !CONVERSATION_ID_PATTERN.test(conversationId)) throw new Error('Invalid role runtime conversation id');

  return {
    roleId,
    providerId,
    conversationId,
    pendingNew: pendingNew && !conversationId,
    model: cleanText(input.model ?? fallback.model, 120) || null,
    effort: cleanText(input.effort ?? fallback.effort, 32) || 'low',
    workspace: cleanText(input.workspace ?? fallback.workspace, 1024) || null,
    activatedAt: Number(input.activatedAt || fallback.activatedAt) || now,
    updatedAt: Number(input.updatedAt) || now
  };
}

class RoleRuntimeStore {
  constructor({ storagePath = DEFAULT_ROLE_RUNTIME_PATH } = {}) {
    this.storagePath = storagePath;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      const source = parsed && typeof parsed.roles === 'object' && !Array.isArray(parsed.roles)
        ? parsed.roles
        : {};
      const roles = {};
      for (const [roleId, value] of Object.entries(source)) {
        try {
          roles[roleId] = normalizeRuntime({ ...value, roleId }, value);
        } catch (_) {}
      }
      return roles;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async writeAll(roles) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = this.storagePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.writeFile(
      tempPath,
      JSON.stringify({ version: 1, roles }, null, 2) + '\n',
      'utf8'
    );
    await fs.rename(tempPath, this.storagePath);
  }

  async get(roleId) {
    const id = cleanText(roleId, 160);
    if (!ROLE_ID_PATTERN.test(id)) return null;
    const roles = await this.readAll();
    return roles[id] || null;
  }

  async list() {
    return Object.values(await this.readAll())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async activate(input = {}) {
    const run = this.mutationQueue.then(async () => {
      const roles = await this.readAll();
      const previous = roles[input.roleId] || null;
      const now = Date.now();
      const next = normalizeRuntime({
        ...previous,
        ...input,
        activatedAt: input.activatedAt || (
          previous &&
          previous.providerId === input.providerId &&
          previous.conversationId === input.conversationId &&
          Boolean(previous.pendingNew) === Boolean(input.pendingNew)
            ? previous.activatedAt
            : now
        ),
        updatedAt: now
      }, previous || {}, now);
      roles[next.roleId] = next;
      await this.writeAll(roles);
      return next;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async prepareNew(input = {}) {
    const run = this.mutationQueue.then(async () => {
      const roles = await this.readAll();
      const previous = roles[input.roleId] || null;
      const now = Date.now();
      const next = normalizeRuntime({
        ...previous,
        ...input,
        conversationId: null,
        pendingNew: true,
        activatedAt: now,
        updatedAt: now
      }, previous || {}, now);
      roles[next.roleId] = next;
      await this.writeAll(roles);
      return next;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async clearRole(roleId) {
    const id = cleanText(roleId, 160);
    if (!ROLE_ID_PATTERN.test(id)) return false;
    const run = this.mutationQueue.then(async () => {
      const roles = await this.readAll();
      if (!roles[id]) return false;
      delete roles[id];
      await this.writeAll(roles);
      return true;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async clearConversation(providerId, conversationId) {
    const provider = cleanText(providerId, 80);
    const conversation = cleanText(conversationId, 200);
    if (!PROVIDER_ID_PATTERN.test(provider) || !CONVERSATION_ID_PATTERN.test(conversation)) return 0;
    const run = this.mutationQueue.then(async () => {
      const roles = await this.readAll();
      let removed = 0;
      for (const [roleId, runtime] of Object.entries(roles)) {
        if (runtime.providerId !== provider || runtime.conversationId !== conversation) continue;
        delete roles[roleId];
        removed += 1;
      }
      if (removed) await this.writeAll(roles);
      return removed;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultRoleRuntimeStore = new RoleRuntimeStore();

module.exports = {
  DEFAULT_ROLE_RUNTIME_PATH,
  RoleRuntimeStore,
  normalizeRuntime,
  getRoleRuntime: roleId => defaultRoleRuntimeStore.get(roleId),
  listRoleRuntimes: () => defaultRoleRuntimeStore.list(),
  activateRoleConversation: input => defaultRoleRuntimeStore.activate({ ...input, pendingNew: false }),
  prepareNewRoleConversation: input => defaultRoleRuntimeStore.prepareNew(input),
  clearRoleConversation: roleId => defaultRoleRuntimeStore.clearRole(roleId),
  clearRoleConversationByConversation: (providerId, conversationId) =>
    defaultRoleRuntimeStore.clearConversation(providerId, conversationId)
};
