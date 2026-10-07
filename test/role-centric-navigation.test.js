const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'js', 'ui.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');

// Role is the primary visible identity, not a secondary conversation setting.
assert.ok(html.includes('id="role-nav-list"'));
assert.ok(html.includes('MY CREW'));
assert.ok(html.includes('id="drawer-new-role-btn"'));
assert.ok(html.includes('id="drawer-new-work-btn"'));
assert.equal(html.includes('id="conversation-workspaces"'), false);

// Header shows who is active; Project/work title are kept out of the visible header.
assert.ok(html.includes('<button id="workspace-selector-btn"'));
assert.ok(html.includes('id="workspace-label"'));
assert.ok(html.includes('General Developer'));
assert.ok(html.includes('id="header-role-project" class="hidden"'));
assert.ok(html.includes('id="header-title" type="button" class="hidden"'));
assert.ok(html.includes('id="role-editor-workspace"'));
assert.ok(app.includes("workspaceSelectorBtn.addEventListener('click', () => toggleDrawer(true))"));

// Each Role owns its own secondary actions.
for (const action of ['new-work', 'history', 'memory', 'settings']) {
  assert.ok(ui.includes(`data-role-action="${action}"`), action);
}
assert.ok(html.includes('id="role-editor-modal"'));
assert.ok(html.includes('id="role-memory-modal"'));
assert.ok(ui.includes("fetch('/api/roles'"));
assert.ok(ui.includes('/api/memories?roleId='));

// Role navigation restores recent work unless the user explicitly creates new work.
assert.ok(ui.includes('getLatestConversationForRole'));
assert.ok(ui.includes('await window.openCrewConversation(latest.provider, latest.id)'));
assert.ok(ui.includes('A fresh Conversation is created only'));

// Main New Work action preserves the active Role and no longer opens the old picker.
const newWorkStart = app.indexOf('// New Work Action');
const renameStart = app.indexOf('// ✏️ Inline work title rename.');
assert.ok(newWorkStart >= 0 && renameStart > newWorkStart);
const newWorkBlock = app.slice(newWorkStart, renameStart);
assert.ok(newWorkBlock.includes("headerTitle.textContent = '新工作'"));
assert.equal(newWorkBlock.includes('openWorkspacePicker'), false);

// Work history is scoped to the current Role and recent work sorts first.
assert.ok(chat.includes('getRoleConversations(activeRoleId, conversations)'));
assert.ok(chat.includes('Number(b.updatedAt || 0) - Number(a.updatedAt || 0)'));

// Deleting a current work record resets short-term context, not Role identity.
assert.ok(chat.includes("localStorage.setItem(activeConversationStorageKey(), '__new__')"));
assert.ok(chat.includes("headerTitle.textContent = '新工作'"));

console.log('role-centric-navigation tests: ok');
