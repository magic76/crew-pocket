const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'js', 'ui.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const premium = fs.readFileSync(path.join(root, 'public', 'css', 'style-premium.css'), 'utf8');

// Role-first navigation: Crew Home is the root, and conversation is a child.
assert.ok(html.includes('<body data-primary-tab="crew"'));
assert.ok(html.includes('id="crew-main-layout"'));
assert.ok(html.includes('id="crew-open-settings-btn"'));
assert.ok(html.includes('id="crew-settings-back-btn"'));
assert.ok(html.includes('id="crew-back-home-btn"'));
assert.equal(html.includes('data-primary-tab="tasks"'), false);
assert.equal(html.includes('id="task-center-modal"'), false);
assert.equal(html.includes('/js/tasks.js'), false);
assert.equal(html.includes('id="primary-bottom-nav"'), false);
assert.equal(html.includes('class="primary-tab'), false);
assert.ok(app.includes('function setPrimaryTab('));
assert.ok(app.includes("window.setPrimaryTab = setPrimaryTab"));
assert.ok(app.includes("chatComposerFooter?.classList.toggle('hidden', primaryTab !== 'chat')"));
assert.equal(app.includes('setTaskCenterVisible'), false);

// Header has no duplicate navigation triggers. Role identity remains primary.
assert.equal(html.includes('id="menu-btn"'), false);
assert.equal(html.includes('id="tools-menu-btn"'), false);
assert.ok(html.includes('<div id="workspace-selector-btn"'));
assert.ok(html.includes('id="workspace-label"'));
assert.ok(html.includes('id="header-current-task"'));
assert.ok(ui.includes("const workTitle = status?.currentWork?.title || status?.conversationTitle || latest?.title || '新工作'"));
assert.ok(ui.includes('if (headerCurrentTask) headerCurrentTask.textContent = workTitle'));

// Settings remains a first-class primary view.
assert.ok(html.includes('id="tools-menu-dropdown"'));
assert.ok(html.includes('Runtime、連線、工具與偏好集中在這裡'));
assert.ok(html.includes('id="adb-settings-btn"'));
assert.ok(html.includes('id="auth-menu-btn"'));
assert.equal(html.includes('id="tools-sheet-overlay"'), false);
assert.equal(html.includes('id="sheet-quick-actions"'), false);
assert.ok(premium.includes('#tools-menu-dropdown'));
assert.ok(!premium.includes('bottom: var(--crew-primary-nav-height)'));
assert.equal(premium.includes('#task-center-modal'), false);

// Crew is a top-level view, not a modal navigation dead end.
assert.ok(premium.includes('#drawer,'));
assert.ok(ui.includes("window.setPrimaryTab(open ? 'crew' : 'chat'"));
assert.ok(app.includes("setPrimaryTab('crew', { hapticFeedback: false, recordHistory: false })"));
assert.ok(app.includes("window.addEventListener('popstate'"));

// Context is understandable at a glance, but unknown budgets still show token usage rather than a fake percentage.
assert.ok(html.includes('id="context-progress-track"'));
assert.ok(html.includes('id="context-progress-bar"'));
assert.ok(chat.includes("const hasBudget = Number.isFinite(maxTokens) && maxTokens > 0"));
assert.ok(chat.includes("textEl.textContent = percent === null"));
assert.ok(chat.includes("progressTrack.classList.toggle('hidden', percent === null)"));

// Role cards surface one work summary only.
assert.ok(ui.includes("const title = status?.currentWork?.title || status?.conversationTitle || latest?.title || ''"));
assert.ok(ui.includes("hasWork ? escapeHtml(title) : '尚無工作'"));
assert.equal(ui.includes("'尚未開始工作'"), false);
assert.ok(ui.includes('unreadReplyCount'));

console.log('navigation-simplification tests: ok');

assert.equal(ui.includes('currentTask'), false, 'Role UI should use currentWork terminology');
assert.match(ui, /new EventSource\('\/api\/crew-status\/events'\)/, 'Crew status should be event-driven');
