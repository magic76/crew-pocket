const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_ROLE_MESSAGE_QUEUE_PATH = process.env.CREW_ROLE_MESSAGE_QUEUE_PATH || path.join(
  process.env.HOME || '/data/data/com.termux/files/home',
  '.crew-pocket',
  'role-message-queue.json'
);

const ROLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_QUEUE_PER_ROLE = 20;

function cleanText(value, maxLength = 5000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeMessage(input = {}, now = Date.now()) {
  const roleId = cleanText(input.roleId || input.role_id, 160);
  const providerId = cleanText(input.providerId || input.provider || input.provider_id, 80);
  const conversationId = cleanText(input.conversationId || input.conversation_id, 200) || null;
  const text = cleanText(input.text || input.message, 5000);
  const imagePath = cleanText(input.imagePath || input.image_path, 2048) || null;

  if (!ROLE_ID_PATTERN.test(roleId)) throw new Error('Invalid queued message role id');
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error('Invalid queued message provider id');
  if (conversationId && !CONVERSATION_ID_PATTERN.test(conversationId)) throw new Error('Invalid queued message conversation id');
  if (!text && !imagePath) throw new Error('Queued message cannot be empty');

  return {
    id: cleanText(input.id, 160) || `roleq-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    roleId,
    providerId,
    conversationId,
    text,
    imagePath,
    source: cleanText(input.source || 'chat', 48) || 'chat',
    createdAt: Number(input.createdAt) || now
  };
}

class RoleMessageQueueStore {
  constructor({ storagePath = DEFAULT_ROLE_MESSAGE_QUEUE_PATH } = {}) {
    this.storagePath = storagePath;
    this.mutationQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed?.messages) ? parsed.messages : [];
      return source.map(item => {
        try { return normalizeMessage(item, item.createdAt || Date.now()); }
        catch (_) { return null; }
      }).filter(Boolean);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async writeAll(messages) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({ version: 1, messages }, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.storagePath);
  }

  async list(roleId = null) {
    const messages = await this.readAll();
    const id = cleanText(roleId, 160);
    return (id ? messages.filter(message => message.roleId === id) : messages)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async enqueue(input = {}) {
    const run = this.mutationQueue.then(async () => {
      const messages = await this.readAll();
      const next = normalizeMessage(input);
      const roleMessages = messages.filter(message => message.roleId === next.roleId);
      if (roleMessages.length >= MAX_QUEUE_PER_ROLE) {
        const error = new Error(`Role queue is full (max ${MAX_QUEUE_PER_ROLE})`);
        error.statusCode = 409;
        throw error;
      }
      messages.push(next);
      await this.writeAll(messages);
      return next;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async remove(roleId, messageId) {
    const role = cleanText(roleId, 160);
    const id = cleanText(messageId, 160);
    const run = this.mutationQueue.then(async () => {
      const messages = await this.readAll();
      const index = messages.findIndex(message => message.roleId === role && message.id === id);
      if (index < 0) return null;
      const [removed] = messages.splice(index, 1);
      await this.writeAll(messages);
      return removed;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async clearRole(roleId) {
    const role = cleanText(roleId, 160);
    const run = this.mutationQueue.then(async () => {
      const messages = await this.readAll();
      const kept = messages.filter(message => message.roleId !== role);
      const removed = messages.length - kept.length;
      if (removed) await this.writeAll(kept);
      return removed;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultRoleMessageQueueStore = new RoleMessageQueueStore();

module.exports = {
  DEFAULT_ROLE_MESSAGE_QUEUE_PATH,
  MAX_QUEUE_PER_ROLE,
  RoleMessageQueueStore,
  normalizeMessage,
  listRoleQueuedMessages: roleId => defaultRoleMessageQueueStore.list(roleId),
  enqueueRoleMessage: input => defaultRoleMessageQueueStore.enqueue(input),
  removeRoleQueuedMessage: (roleId, messageId) => defaultRoleMessageQueueStore.remove(roleId, messageId),
  clearRoleMessageQueue: roleId => defaultRoleMessageQueueStore.clearRole(roleId)
};
