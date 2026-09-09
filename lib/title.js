const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR } = require('./config');

const TITLE_FILENAME = '.auto_title.json';

// Read cached title for a conversation
function getCachedTitle(convId) {
  try {
    const titlePath = path.join(BRAIN_DIR, convId, TITLE_FILENAME);
    if (fs.existsSync(titlePath)) {
      const data = JSON.parse(fs.readFileSync(titlePath, 'utf-8'));
      return data.title || null;
    }
  } catch (e) {}
  return null;
}

// Save title for a conversation
async function saveTitleCache(convId, title) {
  try {
    const dir = path.join(BRAIN_DIR, convId);
    if (!fs.existsSync(dir)) return;
    const titlePath = path.join(dir, TITLE_FILENAME);
    await fsPromises.writeFile(titlePath, JSON.stringify({ title, generated_at: new Date().toISOString() }));
  } catch (e) {
    console.warn('[Title] Failed to save title cache:', e.message);
  }
}

// POST /api/rename-conversation (Custom rename conversation title)
async function handleRenameConversation(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { conversation_id, title } = body;

    if (!conversation_id || !/^[a-zA-Z0-9_\-]+$/.test(conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Valid conversation_id is required' }));
    }

    const cleanTitle = (title || '').trim();
    if (!cleanTitle) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Title cannot be empty' }));
    }

    const dir = path.join(BRAIN_DIR, conversation_id);
    if (!fs.existsSync(dir)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Conversation not found' }));
    }

    const titlePath = path.join(dir, TITLE_FILENAME);
    await fsPromises.writeFile(titlePath, JSON.stringify({
      title: cleanTitle.slice(0, 60),
      custom: true,
      updated_at: new Date().toISOString()
    }));

    console.log(`[Title] Custom title saved for ${conversation_id}: "${cleanTitle}"`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id, title: cleanTitle }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleRenameConversation,
  getCachedTitle
};
