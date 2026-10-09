const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('public/index.html');
const app = read('public/js/app.js');
const ui = read('public/js/ui.js');
const css = read('public/css/crew-home.css');
const graph = read('public/js/mission-graph.js');

assert.ok(html.includes('<body data-primary-tab="crew"'), 'Crew Home is the first view');
assert.ok(html.includes('id="drawer" class="crew-home-view hidden'), 'compatibility anchor is a primary view, not an aside');
assert.equal(html.includes('<aside id="drawer"'), false, 'no sidebar as primary view');
assert.equal(html.includes('id="drawer-overlay"'), false, 'no modal-like overlay');
assert.equal(html.includes('id="cockpit-switch"'), false, 'remove mode choice');
assert.ok(html.indexOf('id="role-nav-list"') < html.indexOf('id="mission-graph"'),
  'Role grid must appear before collaboration timeline');
assert.equal(html.includes('id="cockpit-command-panel"'), false);
assert.equal(html.includes('id="drawer-new-work-btn"'), false,
  'new work is a deliberate Role-specific secondary action');
assert.ok(html.includes('id="crew-back-home-btn"'));
assert.ok(html.includes('id="crew-role-detail-modal"'));
assert.ok(html.includes('id="crew-attention-panel"'));

assert.ok(html.includes('id="crew-open-settings-btn"'));
assert.ok(html.includes('id="crew-settings-back-btn"'));
assert.equal(html.includes('id="primary-bottom-nav"'), false);
assert.ok(app.includes("setPrimaryTab('crew', { hapticFeedback: false, recordHistory: false })"),
  'startup must select Crew Home without requiring a Role Conversation');
assert.ok(app.includes("drawer?.classList.toggle('hidden', primaryTab !== 'crew')"));
assert.ok(app.includes("chatComposerFooter?.classList.toggle('hidden', primaryTab !== 'chat')"));
assert.ok(app.includes("crewBackHomeBtn?.addEventListener('click'"));
assert.ok(app.includes("crewOpenSettingsBtn?.addEventListener('click'"));
assert.ok(app.includes("crewSettingsBackBtn?.addEventListener('click'"));
assert.ok(app.includes("window.history.pushState"));
assert.ok(app.includes("window.addEventListener('popstate'"));
assert.ok(css.includes('body[data-primary-tab="crew"] #messages-container'));
assert.ok(css.includes('position: relative !important'));
assert.ok(css.includes('body[data-primary-tab="crew"] > header'));
assert.ok(css.includes('grid-template-columns: repeat(2'));
assert.ok(css.includes('scrollbar-width: none'));

assert.match(ui, /function toggleDrawer\(open\)/, 'old callers retain a bounded compatibility method');
assert.ok(ui.includes("window.setPrimaryTab(open ? 'crew' : 'chat'"));
assert.ok(ui.includes("roleNavList?.addEventListener('click'"));
assert.ok(ui.includes("if (role) selectRole(role.dataset.roleNavId)"),
  'tap Role => select existing Role Runtime, not New Work');
assert.ok(ui.includes("case 'new-work': return selectRole(roleId, true)"),
  'only explicit New Work creates a fresh conversation');
assert.ok(ui.includes("await window.openCrewConversation(runtime.providerId, runtime.conversationId)"));
assert.ok(ui.includes("await window.openCrewConversation(latest.provider, latest.id)"),
  'historical last-work fallback remains available');
assert.ok(ui.includes("return selectRole(roleId, true)"));
assert.ok(ui.includes("window.CrewMissionGraph?.inspectRole(role.id)"));
assert.ok(ui.includes("case 'collaboration': return openCrewCollaboration(roleId)"));
assert.ok(graph.includes('inspectRole(roleId)'));
assert.ok(graph.includes('const available = new Set((currentSnapshot()?.roles || []).map(role => role.id))'),
  'collaboration detail must refuse unknown Role IDs');
assert.ok(ui.includes('if (markup === lastRoleRosterMarkup) return'),
  'unchanged status notifications must not unmount Role cards or lose touch focus');
assert.ok(ui.includes('crewRoleDetailReturnFocus'));
assert.ok(css.includes('.crew-role-detail-modal.hidden { display: none !important; }'));
assert.ok(!app.includes('function bindEdgeDrawerGesture()'),
  'old swipe-to-open behavior must not coexist with Role-first navigation');
assert.ok(!app.includes('function bindDrawerCloseGesture()'));
assert.ok(!html.includes('data-primary-tab="tasks"'));

console.log('crew-home-navigation tests: ok');
