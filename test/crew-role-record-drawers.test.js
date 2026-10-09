const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const ui = read('public/js/ui.js');
const app = read('public/js/app.js');
const chat = read('public/js/chat.js');
const css = read('public/css/crew-home.css');
const graph = read('public/js/mission-graph.js');

for (const id of ['role-history-modal', 'role-collaboration-modal','role-history-title',
  'conv-list', 'mission-graph', 'mission-graph-body','role-collaboration-title']) {
  assert.ok(html.includes('id="' + id + '"'), id + ' must exist in DOM');
}
assert.ok(html.includes('id="role-history-modal" class="crew-record-modal'));
assert.ok(html.includes('id="role-collaboration-modal" class="crew-record-modal'));
assert.ok(html.indexOf('id="role-history-modal"') > html.indexOf('<!-- History is a real Role-scoped sheet'));
assert.ok(html.indexOf('id="role-collaboration-modal"') < html.indexOf('id="crew-role-detail-modal"'));
assert.ok(html.indexOf('id="mission-graph"') > html.indexOf('id="role-collaboration-modal"'),
  'graph must render inside dedicated collaboration sheet');
assert.ok(html.indexOf('id="conv-list"') > html.indexOf('id="role-history-modal"'));
assert.ok(!html.slice(html.indexOf('<section id="drawer"'), html.indexOf('<!-- History is a real Role-scoped sheet')).includes('id="role-history-view"'),
  'history can no longer be an invisible second child of Crew Home');
assert.ok(ui.includes("case 'history': return showRoleHistoryView(roleId)"),
  'history link must pass the clicked Role ID, not switch active identity');
assert.ok(ui.includes("case 'collaboration': return openCrewCollaboration(roleId)"),
  'collaboration uses a drawer instead of scrolling the home page');
assert.ok(ui.includes("window.getCrewHistoryRoleId = () => historyRoleId"));
assert.ok(chat.includes('const historyRoleId = window.getCrewHistoryRoleId?.()'));
assert.ok(chat.includes('window.renderCrewHistoryFromCache'));
assert.ok(chat.includes('window.closeCrewHistory?.()'));
assert.ok(graph.includes('root.open = false'));
assert.ok(graph.includes('controller?.abort()'));
assert.ok(graph.includes('window.closeCrewCollaboration?.()'));
assert.ok(css.includes('#role-history-modal #conv-list'));
assert.ok(css.includes('#role-collaboration-modal #mission-graph'));
assert.ok(css.includes('width: 48px; height: 48px'));
assert.ok(css.includes('background: var(--cp-accent-soft)'));
assert.ok(css.includes('border: 1px solid var(--cp-accent)'));
assert.ok(ui.includes('aria-label="管理 '), 'menu button retains accessible name');
assert.ok(!app.includes("backToRoleNavBtn.addEventListener('click', () => window.showRoleNavigationView"),
  'old handler must not keep the history drawer stuck open');

// Interaction regression: exercise the actual public history/collaboration sheet
// helpers for a Role different from the currently active one.
function makeElement() {
  const states = new Set(['hidden']);
  return {
    classList: {
      add(...args) {args.forEach(a=>states.add(a));},
      remove(...args) {args.forEach(a=>states.delete(a));},
      contains(a) {return states.has(a);}
    },
    textContent: '',innerHTML: '',focused: 0,listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    focus() { this.focused++; }
  };
}
const ids = Object.fromEntries([
  'role-history-modal','role-collaboration-modal','role-collaboration-title',
  'back-to-role-nav-btn','close-role-collaboration-btn','crew-collaboration-open'
].map(id=>[id,makeElement()]));
const nav = makeElement(), title=makeElement(), conversations=makeElement();
const focus=makeElement();
const document = {
  activeElement: focus,
  listeners: {},
  getElementById(id) { return ids[id] || null; },
  addEventListener(type,fn) { this.listeners[type]=fn; }
};
let requested=0,rendered=0,inspected=null,closed=0,activation=0;
const window = {
  CrewMissionGraph:{
    inspectRole(id){inspected=id;}, close(){closed++;}
  },
  renderCrewHistoryFromCache(){rendered++;},
  addEventListener(){ }
};
const start = ui.indexOf('function showRoleNavigationView() {');
const end = ui.indexOf('// Compatibility boundary for existing Role navigation call sites.',start);
assert.ok(start>=0&&end>start, 'must locate real sheet controller');
vm.runInNewContext(ui.slice(start,end), {
  document,window,roleNavView:nav,renderRoleNavigation() {},
  roleHistoryTitle:title,convList:conversations,currentRoleId:'role-a',
  DEFAULT_ROLE_ID:'role-a',
  roleMeta:id=>id==='role-a'||id==='role-b'?{id,name:id.toUpperCase()}:null,
  roleProjectLabel:()=> 'Project',
  toggleRoleModal(el,open) {el.classList[open?'remove':'add']('hidden');},
  loadConversations:async()=>{requested++;},
});
assert.equal(window.getCrewHistoryRoleId(), null);
window.showRoleHistoryView('role-b');
assert.equal(window.getCrewHistoryRoleId(),'role-b');
assert.equal(ids['role-history-modal'].classList.contains('hidden'), false);
assert.match(title.textContent,/ROLE-B · 工作紀錄/);
assert.equal(rendered,1,'cached work history should render immediately');
assert.equal(requested,1,'history also refreshes from providers');
assert.equal(activation,0,'looking at history does not change current role');
window.closeCrewHistory();
assert.equal(ids['role-history-modal'].classList.contains('hidden'), true);
assert.equal(window.getCrewHistoryRoleId(), null);
assert.ok(focus.focused>0,'return keyboard focus to the previous control');
window.openCrewCollaboration('role-b');
assert.equal(inspected,'role-b');
assert.equal(ids['role-collaboration-modal'].classList.contains('hidden'),false);
assert.match(ids['role-collaboration-title'].textContent,/ROLE-B/);
window.closeCrewCollaboration();
assert.equal(closed,1,'closing collaboration cancels graph loads');
assert.equal(ids['role-collaboration-modal'].classList.contains('hidden'),true);
window.openCrewCollaboration('unrelated-id');
assert.equal(inspected,'role-b', 'unrecognized role cannot open private collaboration data');

console.log('crew-role-record-drawers tests: ok');
