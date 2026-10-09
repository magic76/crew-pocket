const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { makeMissionGraph, MAX_GRAPH_EVENTS } = require('../lib/mission-graph');
const { CrewMessageStore } = require('../lib/crew-messages');

const root = path.join(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

async function run() {
  const base = { id: 'role-a', name: 'Role A' };
  const records = [
    { id: 'm1', fromRoleId: 'role-a', toRoleId: 'role-b', fromRoleName: 'Role A',
      toRoleName: 'Role B', createdAt: 123, deliveredAt: 140, content: 'Please inspect <script>alert(1)</script>' },
    { id: 'm2', fromRoleId: 'role-b', toRoleId: 'role-a', fromRoleName: 'Role B',
      toRoleName: 'Role A', createdAt: 150, replyToId: 'm1', content: 'Reviewed' },
    { id: 'm3', fromRoleId: 'role-c', toRoleId: 'role-b', createdAt: 160, content: 'Not related' },
    { id: 'm4', fromRoleId: 'role-b', toRoleId: 'role-a', createdAt: 155,
      replyToId: 'm0', content: 'Earlier reply' }
  ];
  const graph = makeMissionGraph({ focusRole: base, activity: records });
  assert.equal(graph.focusRoleId, 'role-a');
  assert.equal(graph.relationCount, 3, 'never include messages between unrelated Roles');
  assert.deepEqual(graph.events.map(e => e.id), ['m4', 'm2', 'm1']);
  assert.equal(graph.events[1].linkedReplyId, 'm1');
  assert.equal(graph.events[0].linkedReplyId, null);
  assert.equal(graph.events[2].kind, 'handoff');
  assert.equal(graph.events[1].kind, 'reply');
  assert.equal(graph.events[2].deliveredAt, 140);
  assert.equal(graph.participants.length, 2);
  assert.ok(!('status' in graph.events[0]), 'no fake task outcome');
  assert.ok(!('progress' in graph), 'no invented progress');
  assert.ok(!('context' in graph.events[0]));
  assert.ok(!('workspace' in graph.events[0]));
  assert.equal(makeMissionGraph({ focusRole: base, activity: records, limit: 2 }).events.length, 2);
  assert.equal(makeMissionGraph({ focusRole: base, activity: Array(80).fill(records[0]), limit: 500 }).events.length, MAX_GRAPH_EVENTS);
  assert.equal(makeMissionGraph({ focusRole: base, activity: [{
    ...records[0], id: 'long', content: 'x'.repeat(900)
  }] }).events[0].preview.length, 180);
  assert.throws(() => makeMissionGraph({ focusRole: { id: '../etc', name: 'oops' } }), /Invalid/);

  const tmp = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'crew-mission-'));
  try {
    const roles = [{ id: 'role-a', name: 'Role A' }, { id: 'role-b', name: 'Role B' }];
    const store = new CrewMessageStore({
      storagePath: path.join(tmp, 'messages.json'),
      roleProvider: {
        listRoles: async () => roles,
        getRole: async id => roles.find(r => r.id === id) || null
      }
    });
    const first = await store.send({ fromRoleId: 'role-a', toRoleId: 'role-b', content: 'Plan' });
    await store.markDelivered('role-b', [first.id]);
    await store.send({ fromRoleId: 'role-b', toRoleId: 'role-a', content: 'Acknowledged', replyToId: first.id });
    const real = makeMissionGraph({
      focusRole: roles[0],
      activity: await store.recentActivity('role-a', { limit: 40 })
    });
    assert.equal(real.relationCount, 2);
    assert.ok(real.events.some(e => e.deliveredAt && e.kind === 'handoff'));
    assert.ok(real.events.some(e => e.linkedReplyId === first.id));
    for (const event of real.events) {
      for (const forbidden of ['context', 'memory', 'workspace', 'project']) {
        assert.ok(!(forbidden in event), 'private ' + forbidden + ' must not leak');
      }
    }
  } finally {
    await fsAsync.rm(tmp, { recursive: true, force: true });
  }

  const server = read('server.js');
  const html = read('public/index.html');
  const js = read('public/js/mission-graph.js');
  const css = read('public/css/mission-graph.css');
  assert.ok(server.includes("pathname === '/api/mission-graph'"));
  assert.ok(server.includes("const role = await getRole(roleId)"));
  assert.ok(server.includes('getCrewMessageActivity(role.id, { limit: MAX_GRAPH_EVENTS })'));
  assert.ok(server.indexOf("if (pathname.startsWith('/api/'))") < server.indexOf("pathname === '/api/mission-graph'"),
    'route must be protected by the same authenticated API dispatcher');
  for (const id of ['mission-graph','mission-graph-body','mission-graph-summary']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.ok(html.includes('/js/mission-graph.js'));
  assert.ok(html.includes('/css/mission-graph.css'));
  assert.ok(css.includes('#role-nav-view[data-cockpit-mode="focus"] #mission-graph'));
  assert.ok(js.includes("const available = new Set((currentSnapshot()?.roles || []).map(role => role.id))"));
  assert.ok(js.includes('encodeURIComponent(roleId)'));
  assert.ok(js.includes('AbortController'));
  assert.ok(js.includes('controller?.abort()'));
  assert.ok(js.includes('escape(event.preview'));
  assert.ok(js.includes('event.linkedReplyId'));
  assert.ok(js.includes('window.openCrewCockpitRole'));
  assert.ok(!js.includes('setInterval('), 'no background graph polling');

  // Render the actual interactive view in a minimal DOM harness.
  const listeners = {};
  const elements = {};
  function element(id) {
    return elements[id] = {
      id, open: id === 'mission-graph' ? false : undefined,
      innerHTML: '', textContent: '', listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; }
    };
  }
  const dialog = element('mission-graph');
  const body = element('mission-graph-body');
  const meta = element('mission-graph-summary');
  let roleId = 'role-a';
  let fetches = 0;
  let visited = null;
  let currentLocale = 'zh-TW';
  const document = {
    getElementById: id => elements[id] || null,
    addEventListener: (type, fn) => { listeners['doc:' + type] = fn; }
  };
  const window = {
    getCrewLocale: () => currentLocale,
    getCrewCockpitSnapshot: () => ({ activeRoleId: roleId, roles: [
      { id: 'role-a' }, { id: 'role-b' }
    ] }),
    openCrewCockpitRole: id => { visited = id; },
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  const response = makeMissionGraph({ focusRole: base, activity: records });
  const fetch = async url => {
    assert.ok(url.endsWith('role-a'));
    fetches++;
    return { ok: true, json: async () => ({ success: true, ...response }) };
  };
  vm.runInNewContext(js, { document, window, fetch, AbortController, Date, encodeURIComponent,
    String, Number, Array, Map, Set }, { filename: 'mission-graph.js' });
  assert.equal(fetches, 0, 'collapsed graph should not fetch');
  dialog.open = true;
  dialog.listeners.toggle();
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(fetches, 1);
  assert.match(body.innerHTML, /mission-network/);
  assert.match(body.innerHTML, /mission-timeline/);
  assert.match(body.innerHTML, /Please inspect &lt;script&gt;alert/);
  assert.doesNotMatch(body.innerHTML, /<script>/);
  assert.match(body.innerHTML, /data-mission-jump="m1"/);
  assert.equal(meta.textContent, '3 則最近訊息');
  dialog.listeners.click({ target: { closest: selector => selector === '[data-mission-open-role]'
    ? { dataset: { missionOpenRole: 'role-b' } } : null } });
  assert.equal(visited, 'role-b');
  currentLocale = 'en';
  listeners['doc:crew:localechange']();
  assert.match(body.innerHTML, /recent message/);
  dialog.open = false;
  dialog.listeners.toggle();
  assert.equal(fetches, 1, 'collapsing the graph does not poll');
  console.log('mission-graph tests: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
