const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../public/js/cockpit-model.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/js/ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/cockpit.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public/js/cockpit.js'), 'utf8');

assert.match(html, /id="cockpit-switch"/);
assert.match(html, /id="cockpit-scroll"/);
assert.match(html, /data-cockpit-mode="focus"/);
assert.match(html, /data-cockpit-mode="command"/);
assert.match(html, /id="cockpit-command-panel"/);
assert.match(html, /id="cockpit-focus-panel"/);
assert.match(html, /href="\/css\/cockpit\.css"/);
assert.match(html, /src="\/js\/cockpit-model\.js"/);
assert.match(html, /src="\/js\/cockpit\.js"/);
assert.ok(html.indexOf('/js/ui.js') < html.indexOf('/js/cockpit-model.js'));
assert.ok(html.indexOf('/js/cockpit-model.js') < html.indexOf('/js/cockpit.js'));
assert.ok(html.includes('auto-rows-max grid-cols-2'));
assert.ok(!html.includes('data-primary-tab="tasks"'));
assert.match(ui, /crewStatusVerified = false/);
assert.match(ui, /crewStatusVerified = true/);
assert.match(ui, /window.getCrewCockpitSnapshot/);
assert.match(ui, /window.openCrewCockpitRole = \(roleId, newWork = false\) => selectRole\(roleId, newWork\)/);
assert.match(ui, /new CustomEvent\('crew:status-updated'\)/);
assert.match(ui, /crewStatusEvents\.addEventListener\('error'/);
assert.match(ui, /document\.addEventListener\('visibilitychange'/);
assert.match(css, /data-cockpit-mode="focus"/);
assert.match(css, /prefers-reduced-motion: reduce/);

const mockRoles = [
  {
    id: 'helper', name: 'Helper <script>alert(1)</script>', project: 'Helper',
    icon: '🧠', latestTitle: 'review', latestUpdatedAt: 10,
    status: { state: 'working', busy: true, queuedRequestCount: 1, queuedMessageCount: 1, unreadReplyCount: 1,
      lastActivityAt: 20, currentWork: { title: 'Fix login <bad>' } }
  },
  {
    id: 'story', name: 'Story Dev', project: 'Story', icon: '📚',
    status: { state: 'waiting', queuedMessageCount: 1, queuedRequestCount: 0, unreadReplyCount: 0,
      currentWork: { title: 'Cover' } }
  },
  {
    id: 'teacher', name: 'Teacher Dev', project: 'Teacher', icon: '🎓',
    status: { state: 'idle', queuedMessageCount: 0, unreadReplyCount: 0 }
  }
];
const input = { verified: true, updatedAt: Date.now(), activeRoleId: 'helper', roles: mockRoles };
const result = model.project(input);
assert.equal(result.totals.working, 1);
assert.equal(result.totals.waiting, 1);
assert.equal(result.totals.attention, 4);
assert.equal(result.attention.length, 2);
assert.equal(result.attention[0].id, 'helper');
assert.equal(result.active.id, 'helper');
assert.equal(result.working.length, 1);
assert.equal(result.working[0].title, 'Fix login <bad>');
assert.equal(model.project({ ...input, verified: false }).totals, null,
  'disconnected Runtime must not generate guessed totals');
assert.deepEqual(model.project({ ...input, verified: false }).working, []);
assert.equal(model.project({ verified: true, roles: [{ id: 'x', status: { state: '???' } }] }).roles[0].state,
  'unknown', 'unexpected states cannot be disguised as successful work');

const callbacks = new Map();
const makeNode = () => ({
  dataset: {}, innerHTML: '', listeners: {},
  classList: { toggle() {} },
  addEventListener(name, cb) { this.listeners[name] = cb; },
  setAttribute() {}, querySelectorAll() { return []; },
  contains() { return true; }
});
const elements = {
  'role-nav-view': makeNode(),
  'cockpit-focus-panel': makeNode(),
  'cockpit-command-panel': makeNode(),
  'cockpit-status-line': makeNode(),
  'cockpit-refresh-btn': makeNode()
};
const modes = ['focus', 'command'].map(mode => ({
  dataset: { cockpitMode: mode },
  classList: { toggle() {} },
  listeners: {},
  addEventListener(name, cb) { this.listeners[name] = cb; },
  setAttribute() {}
}));
const storage = new Map();
let opened = null;
let refreshed = 0;
let current = { ...input, verified: false };
const localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value)
};
const document = {
  activeElement: { dataset: {} },
  getElementById: id => elements[id] || null,
  querySelectorAll: query => query === '[data-cockpit-mode]' ? modes : [],
  addEventListener(type, cb) { callbacks.set('doc:' + type, cb); }
};
const window = {
  CrewCockpitModel: model,
  getCrewCockpitSnapshot: () => current,
  getCrewLocale: () => 'zh-TW',
  openCrewCockpitRole: (id, isNew) => { opened = [id, isNew]; },
  loadCrewStatus: async () => { refreshed++; },
  addEventListener(type, cb) { callbacks.set(type, cb); }
};
vm.runInNewContext(controller, { window, document, localStorage, Date, CustomEvent: class {} },
  { filename: 'cockpit.js' });

assert.equal(window.CrewCockpit.getMode(), 'command');
assert.match(elements['cockpit-command-panel'].innerHTML, /狀態/);
assert.doesNotMatch(elements['cockpit-command-panel'].innerHTML, /cockpit-stats/);
current = input;
callbacks.get('crew:status-updated')();
assert.match(elements['cockpit-command-panel'].innerHTML, /cockpit-stats/);
assert.match(elements['cockpit-command-panel'].innerHTML, /Fix login &lt;bad&gt;/);
assert.doesNotMatch(elements['cockpit-command-panel'].innerHTML, /<script>/);
modes[0].listeners.click();
assert.equal(storage.get('crew_cockpit_mode'), 'focus');
assert.equal(elements['role-nav-view'].dataset.cockpitMode, 'focus');
assert.match(elements['cockpit-focus-panel'].innerHTML, /繼續對話/);
const action = { dataset: { cockpitRoleId: 'story', cockpitAction: 'open' } };
elements['role-nav-view'].listeners.click({ target: { closest: () => action } });
assert.equal(opened[0], 'story');
assert.equal(opened[1], false);
const newAction = { dataset: { cockpitRoleId: 'story', cockpitAction: 'new' } };
elements['role-nav-view'].listeners.click({ target: { closest: () => newAction } });
assert.equal(opened[1], true);
elements['cockpit-refresh-btn'].listeners.click();
assert.equal(refreshed, 1);
console.log('crew-cockpit tests: ok');
