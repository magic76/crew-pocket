const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'public', 'js', 'live.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const crewStatus = fs.readFileSync(path.join(root, 'lib', 'crew-status.js'), 'utf8');

assert.match(live, /name: "send_role_message"/, 'Live should expose one direct Role message tool');
assert.match(live, /sendCurrentRoleMessage\(args\)/, 'Live tool should route into the current Role');
assert.match(live, /window\.sendRoleMessage/, 'Live should use the normal Role Conversation send path');
assert.match(chat, /window\.sendRoleMessage = sendRoleMessage/, 'chat should expose the direct Role send bridge');
assert.match(chat, /const pendingQueuedMessagesByRole = new Map\(\)/, 'busy Roles should keep independent queued messages');
assert.match(chat, /status: 'queued'/, 'direct Live messages should queue on a busy Role');

for (const legacy of ['prepare_main_task', 'confirm_main_task', '/api/live-delegate', '/api/tasks', 'startTaskBriefing']) {
  assert.equal(live.includes(legacy), false, `Live must not depend on legacy task flow: ${legacy}`);
}
assert.equal(server.includes("require('./lib/tasks')"), false);
assert.equal(server.includes('/api/live-delegate'), false);
assert.equal(server.includes('/api/tasks'), false);
assert.equal(server.includes('handleLiveDelegate'), false);
assert.equal(server.includes('handleTasks'), false);
assert.equal(crewStatus.includes('listTasks'), false, 'Role status must come from Role/Conversation runtime');
assert.equal(html.includes('task-center-modal'), false);
assert.equal(html.includes('data-primary-tab="tasks"'), false);
assert.equal(html.includes('/js/tasks.js'), false);
assert.equal(app.includes("['chat', 'crew', 'tasks', 'settings']"), false);

console.log('live-role-direct-message tests: ok');
