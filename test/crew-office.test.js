const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const model = require('../public/js/crew-office-model.js');
const office = require('../public/js/crew-office.js');
const portraits = require('../public/js/crew-room.js');

const page = read('public/index.html');
const css = read('public/css/crew-office.css');
const roomJS = read('public/js/crew-room.js');
assert.ok(page.includes('id="crew-room-switchyard"'));
assert.ok(page.includes('id="crew-room-view-switch"'));
assert.ok(page.includes('id="crew-room-office"'));
assert.ok(page.includes('id="role-nav-list" class="crew-role-grid"'), 'keep original roster');
assert.ok(page.indexOf('/js/crew-office-model.js') < page.indexOf('/js/crew-office.js'));
assert.ok(page.indexOf('/js/crew-office.js') < page.indexOf('/js/ui.js'));
assert.ok(page.includes('CrewOffice?.init(window, document)'));
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /min-width: 670px/);
assert.match(css, /is-handoff-walker/);
assert.match(roomJS, /crew:handoff-observed/);
assert.match(roomJS, /stage.closest\('#crew-room-switchyard'\)/);
assert.equal(office.validView('unknown'), 'office');
assert.equal(office.validView('list'), 'list');

const roles = [
  { id: 'teacher', name: 'Teacher <script>alert(1)</script>', project: 'crew-teacher',
    status: { state: 'waiting', queuedRequestCount: 2, unreadReplyCount: 1 } },
  { id: 'story', name: 'Story Dev', project: 'crew-story',
    status: { state: 'idle', currentWork: { title: 'Old task' } } },
  { id: 'dev', name: 'Pocket Dev', project: 'crew-pocket',
    status: { state: 'working', busy: true,
      currentWork: { title: 'Fix <img src=x onerror=1>' } } }
];
const snapshot = { verified: true, activeRoleId: 'dev', roles };
const state = model.project(snapshot);
assert.deepEqual(state.roles.map(r => r.id), ['dev', 'story', 'teacher'],
  'stable order by Role ID, not array or display name');
assert.equal(state.working, 1);
assert.equal(state.attention, 3);
assert.equal(state.roles.find(r => r.id === 'story').busy, false);
assert.equal(state.roles.find(r => r.id === 'teacher').kind, 'teacher');
assert.equal(state.roles.find(r => r.id === 'story').kind, 'story');
assert.equal(state.roles.find(r => r.id === 'dev').kind, 'developer');
assert.equal(model.specialty({ name: 'Fortune Dev' }), 'fortune');

const unknown = model.project({ ...snapshot, verified: false });
assert.equal(unknown.working, null, 'unverified Runtime must not invent work');
assert.equal(unknown.attention, null);
assert.ok(unknown.roles.every(r => r.state === 'unknown' && !r.busy));

const now = Date.now();
const valid = { id: 'handoff-1', fromRoleId: 'dev', toRoleId: 'teacher',
  createdAt: now - 1000 };
assert.equal(model.planHandoff(valid, unknown, now), null);
assert.equal(model.planHandoff({ ...valid, createdAt: now - 100000 }, state, now), null);
assert.equal(model.planHandoff({ ...valid, toRoleId: 'missing' }, state, now), null);
assert.equal(model.planHandoff({ ...valid, toRoleId: 'dev' }, state, now), null);
assert.equal(model.planHandoff(valid, state, now)?.from.id, 'dev');

const fakeWindow = {
  CrewOfficeModel: model, CrewRoomVisual: portraits, getCrewLocale: () => 'zh-TW'
};
const markup = office.renderScene(state, fakeWindow);
assert.match(markup, /crew-office-building/);
assert.match(markup, /crew-office-desk-grid/);
assert.match(markup, /data-office-role="dev"/);
assert.match(markup, /data-office-action="collaboration"/);
assert.match(markup, /data-office-action="attention"/);
assert.match(markup, /data-office-details="teacher"/);
assert.match(markup, /Teacher &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(markup, /Fix &lt;img src=x onerror=1&gt;/);
assert.doesNotMatch(markup, /<script>|<img src=x|onerror="/);
assert.ok(!office.renderScene(unknown, fakeWindow).includes('data-office-action="attention"'));
assert.ok(!office.renderScene(unknown, fakeWindow).includes('位工作中'));

// Simulate user control and click delegation with a light DOM double.
// This is not a full browser screenshot/layout validation.
function node() {
  const handlers = {};
  return {
    dataset: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} },
    handlers,
    addEventListener: (type, callback) => { handlers[type] = callback; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}
const shell = node();
const scene = node();
const switches = node();
const officeButton = { dataset: { crewOfficeView: 'office' }, classList: { toggle() {} },
  setAttribute(key, value) { this[key] = value; } };
const listButton = { dataset: { crewOfficeView: 'list' }, classList: { toggle() {} },
  setAttribute(key, value) { this[key] = value; } };
switches.querySelectorAll = () => [officeButton, listButton];
const activity = node();
const elements = {
  'crew-room-switchyard': shell,
  'crew-room-office': scene,
  'crew-room-view-switch': switches,
  'crew-office-activity-line': activity,
  'crew-attention-panel': { scrollIntoView: () => { scrolled++; } }
};
let scrolled = 0;
let entered, managed, opened, stored = '';
const events = new Map();
const doc = { body: { dataset: { primaryTab: 'crew' } }, hidden: false,
  activeElement: { dataset: {} },
  getElementById: id => elements[id] || null,
  addEventListener(type, callback) { events.set('doc:' + type, callback); } };
const win = {
  ...fakeWindow, getCrewCockpitSnapshot: () => snapshot,
  localStorage: { getItem: () => stored || null, setItem: (_key, value) => { stored = value; } },
  matchMedia: () => ({ matches: true }), // reduced motion still shows evidence text
  setTimeout: () => 0,
  addEventListener(type, callback) { events.set(type, callback); },
  openCrewCockpitRole: id => { entered = id; },
  openCrewRoleDetail: id => { managed = id; },
  openCrewCollaboration: id => { opened = id; }
};
const runtime = office.init(win, doc);
assert.ok(runtime);
assert.equal(shell.dataset.view, 'office');
assert.equal(officeButton['aria-pressed'], 'true');
assert.match(scene.innerHTML, /CREW OFFICE/);
switches.handlers.click({ target: { closest: () => ({ dataset: { crewOfficeView: 'list' } }) } });
assert.equal(shell.dataset.view, 'list');
assert.equal(stored, 'list');
assert.equal(listButton['aria-pressed'], 'true');
switches.handlers.click({ target: { closest: () => ({ dataset: { crewOfficeView: 'office' } }) } });
assert.equal(shell.dataset.view, 'office');

function sceneClick(selector, data) {
  scene.handlers.click({
    target: { closest: requested => requested === selector ? { dataset: data } : null }
  });
}
sceneClick('[data-office-role]', { officeRole: 'dev' });
assert.equal(entered, 'dev');
sceneClick('[data-office-details]', { officeDetails: 'teacher' });
assert.equal(managed, 'teacher');
sceneClick('[data-office-action]', { officeAction: 'collaboration' });
assert.equal(opened, 'dev', 'collaboration shows the active Role evidence');
sceneClick('[data-office-action]', { officeAction: 'attention' });
assert.equal(scrolled, 1);

events.get('crew:handoff-observed')({ detail: valid });
assert.match(activity.textContent, /Pocket Dev → Teacher/);
activity.textContent = 'unchanged';
events.get('crew:handoff-observed')({ detail: { ...valid, createdAt: now - 999999 } });
assert.equal(activity.textContent, 'unchanged', 'reject stale event');
doc.hidden = true;
events.get('crew:handoff-observed')({ detail: valid });
assert.equal(activity.textContent, 'unchanged', 'hidden app must not animate or announce');

console.log('crew-office tests: ok');
