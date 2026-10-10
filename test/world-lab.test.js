const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('public/world-lab.html');
const kit=read('public/js/world-lab-kit.js');
const engine=read('public/js/world-lab.js');
const css=read('public/css/world-lab.css');
for(const name of ['world-lab-kit.js','world-lab-events.js','world-lab-chat.js','world-lab.js']){
  execFileSync(process.execPath,['--check',path.join(root,'public/js',name)]);
}
const sequence=['/vendor/three.min.js','/js/world-lab-kit.js','/js/world-lab-events.js','/js/world-lab-chat.js','/js/world-lab.js'];
assert.ok(sequence.every((file,index)=>html.indexOf(file)>-1&&
  (!index||html.indexOf(file)>html.indexOf(sequence[index-1]))));
assert.ok(fs.statSync(path.join(root,'public/vendor/three.min.js')).size>500000);
assert.match(html,/獨立示範 · 非即時狀態/);
assert.match(html,/id="world-stage"/);
assert.match(kit,/const roles = \[/);
for(const name of ['Pocket Developer','Teacher Developer','Story Developer']){
  assert.ok(kit.includes(name));
}
assert.match(kit,/function character\(/);
assert.match(kit,/roleId=role.id/);
assert.match(engine,/new T.WebGLRenderer/);
assert.match(engine,/ray.intersectObjects/);
assert.match(engine,/pointermove/);
assert.match(engine,/pinch/);
assert.match(engine,/prefers-reduced-motion/);
assert.match(engine,/webglcontextlost/);
assert.match(engine,/不會啟動真實任務/);
assert.match(engine,/不會發送 Role 訊息/);
for(const src of [kit,html]){
  assert.doesNotMatch(src,/https?:\/\/|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/);
}
assert.match(engine,/fetch\('\/api\/crew-status'/);
assert.doesNotMatch(engine,/fetch\('\/api\/(chat|role-submit|role-runtime|memories)'/);
assert.doesNotMatch(engine,/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/);
assert.match(engine,/crew-world-open-role/);
assert.match(kit,/makeLiveRoles/);
assert.match(kit,/LIVE_COLORS/);
const sampleWindow={THREE:{}};
vm.runInNewContext(kit,{window:sampleWindow});
const six=sampleWindow.WorldLabKit.makeLiveRoles([
  {roleId:'one',roleName:'Pocket A',state:'working'},
  {roleId:'two',roleName:'Pocket B',state:'waiting'},
  {roleId:'three',roleName:'Teacher Dev',state:'idle'},
  {roleId:'four',roleName:'Story Dev',state:'new'},
  {roleId:'five',roleName:'Fortune Dev',state:'unknown'},
  {roleId:'six',roleName:'Helper Dev',state:'idle'},
  {roleId:'seven',roleName:'Extra Dev',state:'idle'}
]);
assert.equal(six.length,6,'world caps the rendered 3D characters at six');
assert.equal(new Set(six.map(r=>r.color)).size,6,'every displayed Role must have a distinct color');
assert.deepEqual(Array.from(six,r=>r.id),['one','two','three','four','five','six']);
assert.equal(six[4].state,'unknown','untrusted statuses cannot masquerade as work');
assert.equal(six[0].workTitle,'','no work title without verified currentWork field');
const busy=sampleWindow.WorldLabKit.makeLiveRoles([{
  roleId:'busy',roleName:'Busy agent',state:'working',
  currentWork:{title:'Reviewing code'},attentionCount:2
}]);
assert.equal(busy[0].workTitle,'Reviewing code');
assert.equal(busy[0].attention,2);
const idleWithStale=sampleWindow.WorldLabKit.makeLiveRoles([{
  roleId:'idle',roleName:'Idle agent',state:'idle',
  currentWork:{title:'Old successful job'}
}]);
assert.equal(idleWithStale[0].workTitle,'','idle must not show stale work titles');

assert.equal(sampleWindow.WorldLabKit.makeLiveRoles([]).length,0);

assert.match(css,/touch-action:none/);
assert.match(css,/safe-area-inset-bottom/);
assert.match(css,/prefers-reduced-motion/);
const main=read('public/index.html');
assert.match(main,/id="crew-world-open-btn"/);
assert.match(main,/id="crew-world-modal"/);
assert.match(main,/\/js\/crew-world-launcher.js/);
assert.doesNotMatch(main,/<script src="\/js\/world-lab.js"/);
const launcher=read('public/js/crew-world-launcher.js');
execFileSync(process.execPath,['--check',path.join(root,'public/js/crew-world-launcher.js')]);
assert.match(launcher,/event.origin!==location.origin/);
assert.match(launcher,/event.source!==frame.contentWindow/);
assert.match(launcher,/frame.src='about:blank'/);
assert.match(launcher,/getCrewCockpitSnapshot/);

const events=require('../public/js/world-lab-events.js');
const chat=require('../public/js/world-lab-chat.js');
const now=Date.now(), allowed=['a','b'];
const old={id:'old',fromRoleId:'a',toRoleId:'b',createdAt:now-10000};
const fresh={id:'fresh',fromRoleId:'a',toRoleId:'b',kind:'handoff',createdAt:now-1200};
const unauthorized={id:'secret',fromRoleId:'private',toRoleId:'b',createdAt:now-100};
const self={id:'self',fromRoleId:'a',toRoleId:'a',createdAt:now-100};
const baseline=events.observe([old],null,allowed,now);
assert.deepEqual(baseline.arrivals,[],'initial load cannot replay old handoffs');
const observed=events.observe([old,fresh,unauthorized,self],baseline.seenIds,allowed,now);
assert.deepEqual(observed.arrivals.map(x=>x.id),['fresh'],'only fresh known participants move');
assert.equal(events.observe([old,fresh],observed.seenIds,allowed,now).arrivals.length,0,
  're-polling must never replay seen saved messages');
const expired={...fresh,id:'expired',createdAt:now-90000};
assert.equal(events.observe([expired],baseline.seenIds,allowed,now).arrivals.length,0);
assert.deepEqual(events.trail({x:-6,z:2},{x:6,z:2},0),{x:-6,z:2});
assert.deepEqual(events.trail({x:-6,z:2},{x:6,z:2},1),{x:6,z:2});
assert.deepEqual(events.trail({x:-6,z:2},{x:6,z:2},.5),{x:0,z:-.8},
  'recorded motion goes via the visible hub');
assert.match(engine,/fetch\('\/api\/crew-room-events'/);
assert.match(engine,/planner\.observe/);
assert.match(engine,/observed-handoff/);
assert.match(engine,/headStatus/);
assert.match(engine,/world-chat-open/);
assert.match(html,/id="world-chat-sheet"/);
assert.match(html,/id="world-chat-message"/);
assert.match(html,/id="world-chat-submit"/);
assert.match(css,/world-label-detail/);
assert.match(css,/world-chat-sheet/);
assert.deepEqual(chat.payload('pocket-role','  Review the PR ','world_'+ 'a'.repeat(32)),{
  role_id:'pocket-role',request_id:'world_'+ 'a'.repeat(32),
  prompt:'Review the PR',image_path:''
});
assert.throws(()=>chat.payload('role/other','hello','world_'+ 'a'.repeat(32)));
assert.throws(()=>chat.payload('pocket','  ','world_'+ 'a'.repeat(32)));
assert.throws(()=>chat.payload('pocket','x'.repeat(5001),'world_'+ 'a'.repeat(32)));
const entropy={getRandomValues(a){a.fill(12);return a;}};
assert.equal(chat.requestId(entropy),'world_'+'0c'.repeat(16));
assert.throws(()=>chat.requestId(null),/安全/);
const composer=read('public/js/world-lab-chat.js');
assert.match(composer,/fetcher\('\/api\/role-submit'/);
assert.match(composer,/method:'POST'/);
assert.match(composer,/requestId:|request_id:id/);
assert.match(composer,/pending&&pending\.role_id===targetId/);
assert.doesNotMatch(composer,/\/api\/(?:chat|role-queue|memories)|localStorage|sessionStorage|WebSocket/);
assert.match(kit,/function accessory/);
assert.match(kit,/function profession/);

console.log('world-lab isolated 3D demo tests: ok');
