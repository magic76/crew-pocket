const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public/js/ui.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public/js/chat.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const live = fs.readFileSync(path.join(root, 'public/js/live.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'lib/projects.js'), 'utf8');
const contextBuilder = fs.readFileSync(path.join(root, 'lib/context-builder.js'), 'utf8');

assert.equal(projects.includes("require('./crew-members')"), false, 'Project discovery must not depend on Crew Member');
for (const legacy of ['currentCrewMemberId', 'availableCrewMembers', 'crew_member_id']) {
  assert.equal(ui.includes(legacy), false, `UI must not use legacy Crew Member identity: ${legacy}`);
  assert.equal(chat.includes(legacy), false, `chat must not send legacy Crew Member identity: ${legacy}`);
}
assert.equal(server.includes('buildCrewMemberGuide'), false, 'core server must not inject Crew Member context');
assert.equal(server.includes('getCrewMember('), false, 'core server must not resolve execution through Crew Member');

assert.match(chat, /\/api\/role-queue/, 'chat queue must persist on backend');
assert.match(chat, /hydrateRoleMessageQueue/, 'Role queue must hydrate after reload');
assert.match(live, /await window\.sendRoleMessage/, 'Live must await the shared Role input path');
assert.match(app, /window\.sendRoleMessage/, 'external input must use the shared Role input path');

assert.match(ui, /new EventSource\('\/api\/crew-status\/events'\)/, 'Crew UI must receive status invalidations');
assert.match(server, /broadcastCrewStatusEvent\('turn-complete'/, 'turn completion must invalidate Role status');
assert.match(server, /broadcastCrewStatusEvent\('queue-enqueue'/, 'queue mutations must invalidate Role status');

assert.equal(ui.includes('currentTask'), false, 'Role UI must expose currentWork, not currentTask');
assert.equal(server.includes('currentTask:'), false, 'new server context assembly must use currentWork');
assert.match(contextBuilder, /currentWork/, 'context builder must use currentWork terminology');
assert.match(contextBuilder, /ContextSourceType\.WORK/, 'new current work context must use WORK source type');

console.log('role-runtime-kernel-v2 tests: ok');
