const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { listRoles, getRole } = require('./roles');

const DEFAULT_CREW_MESSAGES_PATH = process.env.CREW_MESSAGES_PATH || path.join(
  process.env.HOME || '/data/data/com.termux/files/home',
  '.crew-pocket',
  'crew-messages.json'
);
const MAX_MESSAGES = 2000;
const MAX_MESSAGE_LENGTH = 4000;

function cleanText(value, maxLength = MAX_MESSAGE_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

function validateRoleId(value) {
  const id = cleanText(value, 160);
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) throw new Error('Invalid role id');
  return id;
}

function normalizeMessage(input = {}) {
  return {
    id: cleanText(input.id, 160) || ('crew-msg-' + crypto.randomUUID()),
    fromRoleId: validateRoleId(input.fromRoleId),
    toRoleId: validateRoleId(input.toRoleId),
    content: cleanText(input.content),
    replyToId: cleanText(input.replyToId, 160) || null,
    createdAt: Number(input.createdAt) || Date.now(),
    deliveredAt: Number(input.deliveredAt) || null
  };
}

class CrewMessageStore {
  constructor({
    storagePath = DEFAULT_CREW_MESSAGES_PATH,
    roleProvider = { listRoles, getRole }
  } = {}) {
    this.storagePath = storagePath;
    this.roleProvider = roleProvider;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.messages)
        ? parsed.messages.map(normalizeMessage)
        : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async writeAll(messages) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = this.storagePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    const bounded = messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_MESSAGES);
    await fs.writeFile(
      tempPath,
      JSON.stringify({ version: 1, messages: bounded }, null, 2) + '\n',
      'utf8'
    );
    await fs.rename(tempPath, this.storagePath);
  }

  async listAvailableRoles() {
    const roles = await this.roleProvider.listRoles();
    return roles.map(role => ({
      id: role.id,
      name: role.name,
      description: role.description || ''
    }));
  }

  async send({ fromRoleId, toRoleId, content, replyToId = null } = {}) {
    const fromId = validateRoleId(fromRoleId);
    const toId = validateRoleId(toRoleId);
    const messageText = cleanText(content);
    if (!messageText) throw new Error('Message content is required');
    if (fromId === toId) throw new Error('Crew message recipient must be another Role');

    const [fromRole, toRole] = await Promise.all([
      this.roleProvider.getRole(fromId),
      this.roleProvider.getRole(toId)
    ]);
    if (!fromRole) throw new Error('Sender Role does not exist');
    if (!toRole) throw new Error('Recipient Role does not exist');

    const run = this.mutationQueue.then(async () => {
      const messages = await this.readAll();
      if (replyToId && !messages.some(message => message.id === replyToId)) {
        throw new Error('Reply target does not exist');
      }
      const message = normalizeMessage({
        fromRoleId: fromId,
        toRoleId: toId,
        content: messageText,
        replyToId,
        createdAt: Date.now()
      });
      messages.push(message);
      await this.writeAll(messages);
      return {
        ...message,
        fromRoleName: fromRole.name,
        toRoleName: toRole.name
      };
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async inbox(roleId, { undeliveredOnly = true, limit = 20 } = {}) {
    const id = validateRoleId(roleId);
    if (!(await this.roleProvider.getRole(id))) throw new Error('Role does not exist');
    const messages = (await this.readAll())
      .filter(message => message.toRoleId === id && (!undeliveredOnly || !message.deliveredAt))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-Math.max(1, Math.min(100, Number(limit) || 20)));
    if (!messages.length) return [];

    const roles = await this.roleProvider.listRoles();
    const names = new Map(roles.map(role => [role.id, role.name]));
    return messages.map(message => ({
      ...message,
      fromRoleName: names.get(message.fromRoleId) || message.fromRoleId,
      toRoleName: names.get(message.toRoleId) || message.toRoleId
    }));
  }

  async recentAll({ limit = 12 } = {}) {
    const roles = await this.roleProvider.listRoles();
    const names = new Map(roles.map(role => [role.id, role.name]));
    return (await this.readAll())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 12)))
      .map(message => ({
        ...message,
        fromRoleName: names.get(message.fromRoleId) || message.fromRoleId,
        toRoleName: names.get(message.toRoleId) || message.toRoleId
      }));
  }

  async recentActivity(roleId, { limit = 8 } = {}) {
    const id = validateRoleId(roleId);
    if (!(await this.roleProvider.getRole(id))) throw new Error('Role does not exist');
    const roles = await this.roleProvider.listRoles();
    const names = new Map(roles.map(role => [role.id, role.name]));
    return (await this.readAll())
      .filter(message => message.fromRoleId === id || message.toRoleId === id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 8)))
      .map(message => ({
        ...message,
        direction: message.fromRoleId === id ? 'outgoing' : 'incoming',
        fromRoleName: names.get(message.fromRoleId) || message.fromRoleId,
        toRoleName: names.get(message.toRoleId) || message.toRoleId
      }));
  }

  async markDelivered(roleId, messageIds = []) {
    const id = validateRoleId(roleId);
    const ids = new Set(
      (Array.isArray(messageIds) ? messageIds : [])
        .map(value => cleanText(value, 160))
        .filter(Boolean)
    );
    if (!ids.size) return 0;

    const run = this.mutationQueue.then(async () => {
      const messages = await this.readAll();
      let updated = 0;
      const now = Date.now();
      const next = messages.map(message => {
        if (message.toRoleId !== id || !ids.has(message.id) || message.deliveredAt) return message;
        updated += 1;
        return { ...message, deliveredAt: now };
      });
      if (updated) await this.writeAll(next);
      return updated;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultCrewMessageStore = new CrewMessageStore();

module.exports = {
  DEFAULT_CREW_MESSAGES_PATH,
  MAX_MESSAGE_LENGTH,
  CrewMessageStore,
  listCrewRoles: () => defaultCrewMessageStore.listAvailableRoles(),
  sendCrewMessage: input => defaultCrewMessageStore.send(input),
  getCrewInbox: (roleId, options) => defaultCrewMessageStore.inbox(roleId, options),
  getCrewRecentActivity: options => defaultCrewMessageStore.recentAll(options),
  getCrewMessageActivity: (roleId, options) => defaultCrewMessageStore.recentActivity(roleId, options),
  markCrewMessagesDelivered: (roleId, messageIds) => defaultCrewMessageStore.markDelivered(roleId, messageIds)
};
