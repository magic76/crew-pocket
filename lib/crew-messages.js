'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MESSAGES_PATH = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'crew-messages.json');

async function listCrewMessages(roleId, limit = 200) {
  const id = String(roleId || '').trim();
  if (!id) throw new Error('role_id is required');

  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(MESSAGES_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
  return (Array.isArray(parsed?.messages) ? parsed.messages : [])
    .filter(message => message && (message.fromRoleId === id || message.toRoleId === id))
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .slice(-safeLimit);
}

module.exports = { listCrewMessages };
