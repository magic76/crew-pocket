const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'js', 'ui.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const tasks = fs.readFileSync(path.join(root, 'public', 'js', 'tasks.js'), 'utf8');
const premium = fs.readFileSync(path.join(root, 'public', 'css', 'style-premium.css'), 'utf8');

// Primary navigation is one persistent four-tab model.
for (const tab of ['chat', 'crew', 'tasks', 'settings']) {
  assert.ok(html.includes(`data-primary-tab="${tab}"`), tab);
}
assert.ok(html.includes('id="primary-bottom-nav"'));
assert.ok(app.includes('function setPrimaryTab('));
assert.ok(app.includes("window.setPrimaryTab = setPrimaryTab"));
assert.ok(app.includes("chatComposerFooter?.classList.toggle('hidden', primaryTab !== 'chat')"));

// Header has no duplicate navigation triggers. Role identity remains primary.
assert.equal(html.includes('id="menu-btn"'), false);
assert.equal(html.includes('id="tools-menu-btn"'), false);
assert.ok(html.includes('<div id="workspace-selector-btn"'));
assert.ok(html.includes('id="workspace-label"'));
assert.ok(html.includes('id="header-current-task"'));
assert.ok(ui.includes("const taskTitle = status?.currentTask?.title || status?.conversationTitle || latest?.title || '新工作'"));
assert.ok(ui.includes('if (headerCurrentTask) headerCurrentTask.textContent = taskTitle'));

// Settings is no longer a mobile bottom sheet; Runtime / wireless debugging remain reachable there.
assert.ok(html.includes('id="tools-menu-dropdown"'));
assert.ok(html.includes('Runtime、連線、工具與偏好集中在這裡'));
assert.ok(html.includes('id="adb-settings-btn"'));
assert.ok(html.includes('id="auth-menu-btn"'));
assert.equal(html.includes('id="tools-sheet-overlay"'), false);
assert.equal(html.includes('id="sheet-quick-actions"'), false);
assert.ok(premium.includes('#tools-menu-dropdown'));
assert.ok(premium.includes('bottom: var(--crew-primary-nav-height)'));

// Crew and Task are top-level views, not modal navigation dead ends.
assert.ok(premium.includes('#drawer,'));
assert.ok(premium.includes('#task-center-modal,'));
assert.ok(tasks.includes('window.setTaskCenterVisible = setModalVisible'));
assert.ok(ui.includes("window.getPrimaryTab?.() === 'crew'"));

// Context is understandable at a glance, but unknown budgets still show token usage rather than a fake percentage.
assert.ok(html.includes('id="context-progress-track"'));
assert.ok(html.includes('id="context-progress-bar"'));
assert.ok(chat.includes("const hasBudget = Number.isFinite(maxTokens) && maxTokens > 0"));
assert.ok(chat.includes("textEl.textContent = percent === null"));
assert.ok(chat.includes("progressTrack.classList.toggle('hidden', percent === null)"));

// Role cards surface one work summary only; no duplicate empty-state wording.
assert.ok(ui.includes("const title = status?.currentTask?.title || status?.conversationTitle || latest?.title || ''"));
assert.ok(ui.includes("hasWork ? escapeHtml(title) : '尚無工作'"));
assert.equal(ui.includes("'尚未開始工作'"), false);
assert.ok(ui.includes('unreadReplyCount'));

console.log('navigation-simplification tests: ok');
