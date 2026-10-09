const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const src = file => fs.readFileSync(path.join(root, file), 'utf8');
const engine = require('../public/js/crew-world-model.js');
const renderer = require('../public/js/crew-world-canvas.js');
const controller = require('../public/js/crew-world.js');
const projector = require('../public/js/crew-office-model.js');

const names = ['Pocket Dev', 'Story Dev', 'Teacher Dev', 'Fortune Dev',
  'Helper Dev', 'General Dev', 'QA Dev', 'Research Dev'];
const input = names.map((name, index) => ({
  id: 'role-' + index, name, project: 'crew-' + name.toLowerCase(),
  status: { state: index === 0 ? 'working' : index === 2 ? 'waiting' : 'idle',
    busy: index === 0, queuedRequestCount: index === 2 ? 1 : 0 }
}));
const snapshot = { verified: true, activeRoleId: 'role-0', roles: input };
const projected = projector.project(snapshot);
const world = new engine.World(projector);
world.reconcile(projected);
const map = world.map;
assert.ok(map.width >= 800 && map.height >= 800, 'full navigable room');
assert.equal(map.seats.length, 8);
assert.equal(world.actors.size, 8);
assert.ok(map.meeting.y < map.rows);
for (const seat of map.seats) {
  assert.equal(engine.walkable(map, seat.home), true);
  const out = engine.findPath(map, seat.home, map.meeting);
  assert.ok(out.length > 1, 'A* route to shared area for ' + seat.roleId);
  assert.ok(out.every(pt => engine.walkable(map, pt)), 'never walk through desk tiles');
  assert.deepEqual(out[0], seat.home);
  assert.deepEqual(out.at(-1), map.meeting);
}
assert.equal(engine.findPath(map, {x:0,y:0}, map.meeting).length, 0,
  'walls cannot be used as a spawn point');
assert.equal(engine.findPath(map, map.meeting, map.meeting).length, 1);

const persistent = world.actors.get('role-0');
persistent.pos.x += 3;
const oldCameraPos = persistent.pos.x;
world.reconcile(projector.project(snapshot));
assert.strictEqual(world.actors.get('role-0'), persistent, 'Role entities survive status refresh');
assert.equal(persistent.pos.x, oldCameraPos);

const event = {
  id: 'saved-real-message', fromRoleId: 'role-0', toRoleId: 'role-2',
  createdAt: Date.now()
};
assert.equal(world.acceptHandoff(event), true);
assert.equal(world.acceptHandoff(event), false, 'deduplicate the same evidence');
assert.equal(world.acceptHandoff({...event, id:'old', createdAt: Date.now()-120000}), false);
assert.equal(world.acceptHandoff({...event, id:'unknown', toRoleId:'absent'}), false);
assert.equal(world.acceptHandoff({...event, id:'fake-self', toRoleId:'role-0'}), false);
assert.equal(world.log.length,1);
assert.ok(!JSON.stringify(world.log).includes('content'));

let moved = false, visitedTable = false, visitedRecipient = false;
for(let i=0;i<1500;i++) {
  world.tick(.03);
  const a=world.actors.get('role-0');
  const meet=engine.pixel(map.meeting);
  const to=engine.pixel(map.seats.find(s=>s.roleId==='role-2').reception);
  moved ||= a.walking;
  visitedTable ||= Math.hypot(a.pos.x-meet.x,a.pos.y-meet.y)<3;
  visitedRecipient ||= Math.hypot(a.pos.x-to.x,a.pos.y-to.y)<3;
}
const final=world.actors.get('role-0');
assert.ok(moved, 'physical character actually walks');
assert.ok(visitedTable, 'enters shared space');
assert.ok(visitedRecipient, 'walks to the recipient');
assert.equal(final.mode, 'seated', 'returns home after the handoff');
assert.ok(Math.hypot(final.pos.x-engine.pixel(final.home).x,
  final.pos.y-engine.pixel(final.home).y)<2);

const before = world.actors.get('role-0');
world.reconcile(projector.project({...snapshot, verified:false}));
assert.equal(world.room.verified, false);
assert.equal(world.actors.get('role-0'), before);
assert.equal(before.walking,false);
assert.equal(before.queue.length,0);
assert.equal(before.work,'unknown');
assert.equal(world.acceptHandoff({...event,id:'offline'}),false,
  'do not animate unverified Runtime');
assert.equal(world.tick(.05),false,'offline world does not progress fabricated work');

// Canvas smoke test without a browser, for invalid paints or renderer exceptions.
const calls = [];
const ctx = {
  fillRect(...p){calls.push(p);},clearRect(){},setTransform(){},translate(){},
  scale(){},save(){},restore(){},strokeRect(){},
  fillText(value){ assert.equal(typeof value,'string'); },
  measureText(value){return {width:String(value).length*8};}
};
world.reconcile(projector.project(snapshot));
renderer.draw(ctx,world,{x:416,y:325,scale:1},
  {w:360,h:520,dpr:1},1,false,'zh-TW');
assert.ok(calls.length>100,'render actual world tiles and furniture');
assert.equal(controller.validView('list'),'list');

// Preserve legacy office as a compatibility fallback when WebView has no 2D canvas.
const host = {innerHTML:'original'};
const nodes = {
  'crew-room-switchyard': {dataset:{}},
  'crew-room-office': host,
  'crew-room-view-switch': {}
};
const fakeDoc = {
  getElementById(id) {
    if (id==='crew-world-canvas') return { getContext:()=>null };
    return nodes[id] || null;
  }
};
const noCanvas = controller.init({
  CrewWorldModel:engine, CrewOfficeModel:projector,
  CrewWorldCanvas:renderer, getCrewLocale:()=> 'zh-TW'
},fakeDoc);
assert.equal(noCanvas,null);
assert.equal(host.innerHTML,'','fallback has no half-built Canvas UI');

const html = src('public/index.html');
assert.ok(html.includes('/js/crew-world-model.js'));
assert.ok(html.includes('/js/crew-world-canvas.js'));
assert.ok(html.includes('/js/crew-world.js'));
assert.ok(html.includes('/css/crew-world.css'));
assert.ok(html.includes('CrewWorld?.init(window, document) || window.CrewOffice?.init'));
assert.ok(html.includes('id="role-nav-list" class="crew-role-grid"'),
  'the Role roster is the fast and accessible alternative');
const source = src('public/js/crew-world.js');
assert.match(source,/pointerdown/);
assert.match(source,/pointermove/);
assert.match(source,/pointercancel/);
assert.match(source,/aria-label/);
assert.match(source,/crew:handoff-observed/);
assert.match(source,/visibilitychange/);
assert.match(source,/cancelAnimationFrame/);
assert.match(source,/data-primary-tab/);
assert.match(src('public/css/crew-world.css'),/prefers-reduced-motion:reduce/);
console.log('crew-world tests: ok');
