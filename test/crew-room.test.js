const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const visual = require('../public/js/crew-room.js');
const { CrewMessageStore } = require('../lib/crew-messages');

async function run() {
  const root = path.join(__dirname, '..');
  const [page, css, ui, server, messages] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/css/crew-room.css'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/ui.js'), 'utf8'),
    fs.readFile(path.join(root, 'server.js'), 'utf8'),
    fs.readFile(path.join(root, 'lib/crew-messages.js'), 'utf8')
  ]);

  assert.match(page, /id="crew-room-roster-stage"/);
  assert.match(page, /id="crew-room-handoffs"/);
  assert.ok(page.indexOf('/js/crew-room.js') < page.indexOf('/js/ui.js'));
  assert.match(page, /CrewRoomVisual\?\.init\(window, document\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-state="working"/);
  assert.match(css, /data-state="waiting"/);
  assert.match(ui, /CrewRoomVisual\?\.portraitMarkup\(role\)/);
  assert.match(server, /pathname === '\/api\/crew-room-events' && req\.method === 'GET'/);
  assert.match(messages, /async recentRoomEvents/);

  const role = { id: 'role-helper', name: 'Private <script>alert(1)</script>' };
  const person = visual.portraitMarkup(role);
  assert.equal(person, visual.portraitMarkup(role), 'Role portrait must remain stable across re-renders');
  assert.match(person, /shape-rendering="crispEdges"/);
  assert.match(person, /crew-pixel-hand/);
  assert.doesNotMatch(person, /Private|<script>|http:|https:/, 'never embed untrusted labels or external sprites');
  const distinct = new Set(['helper', 'story', 'teacher', 'fortune'].map(id =>
    visual.portraitMarkup({ id })));
  assert.ok(distinct.size >= 3, 'different Roles should have distinct pixel identities');

  const now = Date.now();
  const older = { id: 'one', fromRoleId: 'helper', toRoleId: 'teacher', createdAt: now - 2000 };
  const reply = { id: 'two', fromRoleId: 'teacher', toRoleId: 'helper', createdAt: now - 1000 };
  const historical = { id: 'old', fromRoleId: 'helper', toRoleId: 'teacher', createdAt: now - 100000 };
  const baseline = visual.planNewEvents([older], null, now);
  assert.equal(baseline.arrivals.length, 0, 'initial load cannot replay historical events');
  const updated = visual.planNewEvents([reply, older, historical], baseline.seenIds, now);
  assert.deepEqual(updated.arrivals.map(e => e.id), ['two'], 'only newly observed and fresh events fly');
  assert.equal(visual.planNewEvents([reply, older, historical], updated.seenIds, now).arrivals.length, 0);
  assert.equal(visual.planNewEvents([historical], baseline.seenIds, now).arrivals.length, 0);
  assert.equal(visual.planNewEvents([{
    id: 'same', fromRoleId: 'helper', toRoleId: 'helper', createdAt: now
  }], baseline.seenIds, now).arrivals.length, 0, 'no fake self handoffs');

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-room-events-'));
  try {
    const roles = [{ id: 'helper' }, { id: 'teacher' }];
    const store = new CrewMessageStore({
      storagePath: path.join(temp, 'crew-messages.json'),
      roleProvider: {
        listRoles: async () => roles,
        getRole: async id => roles.find(role => role.id === id) || null
      }
    });
    await store.writeAll([
      { id: 'a', fromRoleId: 'helper', toRoleId: 'teacher', content: 'TOP SECRET',
        createdAt: now - 8000, deliveredAt: null },
      { id: 'b', fromRoleId: 'teacher', toRoleId: 'helper', content: 'DO NOT EXPOSE',
        replyToId: 'a', createdAt: now - 4000, deliveredAt: now - 3000 },
      { id: 'c', fromRoleId: 'deleted', toRoleId: 'helper', content: 'HIDDEN',
        createdAt: now - 2000, deliveredAt: null }
    ]);
    const events = await store.recentRoomEvents({ limit: 24 });
    assert.deepEqual(events.map(event => event.id), ['b', 'a']);
    assert.equal(events[0].kind, 'reply');
    assert.equal(events[1].kind, 'handoff');
    for (const event of events) {
      assert.deepEqual(Object.keys(event).sort(),
        ['id', 'fromRoleId', 'toRoleId', 'kind', 'createdAt'].sort(),
        'room events may not share message, memory or workspace content');
    }
    assert.doesNotMatch(JSON.stringify(events), /SECRET|EXPOSE|HIDDEN|conversation|workspace|memory/i);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  console.log('crew-room tests: ok');
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
