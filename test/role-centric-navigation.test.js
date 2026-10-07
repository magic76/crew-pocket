const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'js', 'ui.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');

// Role is now the primary drawer entity.
assert.match(html, /id="role-nav-list"/);
assert.match(html, /id="open-work-history-btn"/);
assert.match(html, /id="drawer-new-work-btn"/);
assert.doesNotMatch(html, /id="conversation-workspaces"/);

// Header Role identity is informational rather than another picker button.
assert.match(html, /<div id="workspace-selector-btn"/);
assert.doesNotMatch(html, /<button id="workspace-selector-btn"/);

// Role navigation restores recent work unless the user explicitly creates new work.
assert.match(ui, /getLatestConversationForRole/);
assert.match(ui, /await window\.openCrewConversation\(latest\.provider, latest\.id\)/);
assert.match(ui, /A fresh Conversation is created only/);

// Main New Work action preserves the active Role and no longer opens the Role picker.
const newWorkStart = app.indexOf('// New Work Action');
const renameStart = app.indexOf('// ✏️ Inline conversation title rename.');
assert.ok(newWorkStart >= 0 && renameStart > newWorkStart);
const newWorkBlock = app.slice(newWorkStart, renameStart);
assert.match(newWorkBlock, /headerTitle\.textContent = '新工作'/);
assert.doesNotMatch(newWorkBlock, /openWorkspacePicker/);

// Work history is scoped to the current Role and recent work sorts first.
assert.match(chat, /getRoleConversations\(activeRoleId, conversations\)/);
assert.match(chat, /Number\(b\.updatedAt \|\| 0\) - Number\(a\.updatedAt \|\| 0\)/);

// Deleting a current work record resets short-term context, not Role identity.
assert.match(chat, /localStorage\.setItem\(activeConversationStorageKey\(\), '__new__'\)/);
assert.match(chat, /headerTitle\.textContent = '新工作'/);

console.log('role-centric-navigation tests: ok');
