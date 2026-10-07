const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const restoreRole = source.slice(source.indexOf('window.setConversationRoleDirect ='), source.indexOf('window.setConversationCrewMemberDirect ='));
const restoreSettings = source.slice(source.indexOf('window.applyConversationSettings ='), source.indexOf('window.saveCurrentConversationSettings ='));
const stored = new Map();
const members = [{ id: 'member-a', workspace: '/runtime/home/project-a', project: { id: 'project-a' } }];
const context = vm.createContext({
  window: {},
  localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
  DEFAULT_ROLE_ID: 'role-general',
  HOME_WORKSPACE: '/termux/home',
  availableWorkspaces: [{ id: 'home', path: '/runtime/home' }],
  currentRoleId: 'role-a', currentCrewMemberId: 'member-a', currentWorkspace: members[0].workspace,
  currentProvider: 'codex', availableModels: [],
  roleMeta: id => id === 'role-a' ? { id, projectId: 'project-a' } : null,
  crewMemberMeta: id => members.find(member => member.id === id),
  crewMemberForProject: id => members.find(member => member.project.id === id),
  inferCrewMemberForWorkspace: workspace => members.find(member => member.workspace === workspace),
  updateWorkspaceUI() {}, renderProviderOptions() {}, updateModelUI() {}, updateEffortUI() {}
});
vm.runInContext(restoreRole + restoreSettings, context);

function restoreProject() {
  context.window.setConversationRoleDirect('role-a', 'project-a', 'member-a', members[0].workspace);
  assert.equal(context.currentCrewMemberId, 'member-a');
  assert.equal(context.currentWorkspace, members[0].workspace);
}

// Restoring a General conversation must discard the previous project's identity.
restoreProject();
context.window.setConversationRoleDirect('role-general', null, null, '/runtime/home/legacy');
assert.equal(context.currentCrewMemberId, '');
assert.equal(context.currentWorkspace, '/runtime/home/legacy');
assert.equal(stored.has('crew_current_member'), false);

// Older settings without a workspace use this Runtime's Home, including APK hosts.
restoreProject();
context.window.applyConversationSettings({ provider: 'codex', roleId: 'role-general' });
assert.equal(context.currentWorkspace, '/runtime/home');
assert.equal(context.currentCrewMemberId, '');
assert.equal(context.currentRoleId, 'role-general');

// Workspace-only legacy settings still recover the corresponding Crew Member.
context.window.applyConversationSettings({ provider: 'codex', workspace: members[0].workspace });
assert.equal(context.currentCrewMemberId, 'member-a');
assert.equal(context.currentWorkspace, members[0].workspace);

// A role can restore its project even without a cached member or workspace field.
context.window.setConversationRoleDirect('role-a');
assert.equal(context.currentCrewMemberId, 'member-a');
assert.equal(context.currentWorkspace, members[0].workspace);
console.log('role-conversation-state tests: ok');
