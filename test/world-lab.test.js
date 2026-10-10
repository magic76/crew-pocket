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
for(const name of ['world-lab-kit.js','world-lab-events.js','world-lab.js']){
  execFileSync(process.execPath,['--check',path.join(root,'public/js',name)]);
}
const sequence=['/vendor/three.min.js','/js/world-lab-kit.js','/js/world-lab-events.js','/js/world-lab.js'];
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
assert.match(engine,/previous===undefined\|\|previous===signature/);
assert.match(engine,/const recentlyWorking=/);
assert.match(engine,/lastWorkingAt\.set\(actor\.role\.id,Date\.now\(\)\)/);
assert.match(engine,/remaining=300000-age/);
assert.match(engine,/else if\(!labels\[index\]\.speech\.hidden\)hideSpeech\(index\)/);
assert.match(engine,/const overview=zoom<1\.65/,
  'small crews also hide idle and waiting badges at overview zoom');
assert.match(engine,/const active=roles\[index\]\.state==='working'\|\|!speech\.hidden/);
assert.match(engine,/const lowPriority=overview&&!active/);
assert.match(engine,/pin\.members\.some\(role=>role\.state==='working'\)/,
  'overview project pins appear only while a member is working');
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
assert.equal(six.length,7,'world must not drop the seventh live Role');
assert.equal(new Set(six.map(r=>r.color)).size,7,'every displayed Role must have a distinct color');
assert.deepEqual(Array.from(six,r=>r.id),['one','two','three','four','five','six','seven']);
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

const allSixteen=sampleWindow.WorldLabKit.makeLiveRoles(
  Array.from({length:16},(_,i)=>({roleId:'role-'+i,roleName:'Crew Agent '+i,projectId:'crew-pocket',state:'idle'}))
);
assert.equal(allSixteen.length,16,'six plus ten new agents must all appear');
assert.equal(new Set(allSixteen.map(role=>role.districtId)).size,6,
  'sixteen agents of one project share six islands, not sixteen islands');
assert.equal(new Set(allSixteen.map(role=>role.color)).size,16,'every agent gets distinguishable identity');
assert.ok(allSixteen.every(role=>role.districtSize<=3));
const groups=new Map();
for(const r of allSixteen){
  if(!groups.has(r.districtId))groups.set(r.districtId,[]);
  groups.get(r.districtId).push(r);
}
for(const members of groups.values()){
  assert.ok(members.length<=3);
  assert.equal(new Set(members.map(r=>r.x)).size,members.length,
    'each person in district stands at an individual position');
}
assert.ok(sampleWindow.WorldLabKit.mapExtent(allSixteen)<20,
  'sixteen agents fit in the compact inner ring rather than an expanding 16-island circle');
const mixed=sampleWindow.WorldLabKit.makeLiveRoles([
  ...Array.from({length:4},(_,i)=>({roleId:'t'+i,projectId:'teacher'})),
  ...Array.from({length:5},(_,i)=>({roleId:'p'+i,projectId:'pocket'})),
  ...Array.from({length:2},(_,i)=>({roleId:'s'+i,projectId:'story'}))
]);
assert.equal(new Set(mixed.map(r=>r.districtId)).size,5,
  'project identities determine districts');
const forty=sampleWindow.WorldLabKit.makeLiveRoles(Array.from({length:40},(_,i)=>({roleId:'agent-'+i})));
assert.equal(forty.length,sampleWindow.WorldLabKit.MAX_WORLD_ROLES);
assert.equal(sampleWindow.WorldLabKit.MEMBERS_PER_DISTRICT,3);
assert.ok(sampleWindow.WorldLabKit.mapExtent(forty)<28);

assert.equal(sampleWindow.WorldLabKit.makeLiveRoles([]).length,0);

assert.match(css,/touch-action:none/);
assert.match(css,/safe-area-inset-bottom/);
assert.match(css,/prefers-reduced-motion/);
const main=read('public/index.html');
assert.match(main,/id="crew-world-open-btn"/);
assert.match(main,/id="crew-world-modal"/);
assert.match(main,/id="crew-home-dashboard-btn"/);
assert.match(main,/id="crew-world-dashboard-btn"/);
assert.match(main,/id="crew-world-map-btn"/);
assert.match(main,/id="world-districts"/);
assert.match(html,/id="world-districts"/);
assert.match(main,/\/js\/crew-world-launcher.js/);
assert.doesNotMatch(main,/<script src="\/js\/world-lab.js"/);
assert.doesNotMatch(main,/<script src="\/vendor\/three.min.js"/);
assert.match(main,/id="world-stage"/);
assert.match(main,/id="crew-world-chat-messages-slot"/);
assert.match(main,/id="crew-world-chat-composer-slot"/);
assert.doesNotMatch(main,/<iframe|id="crew-world-frame"/i);
assert.equal((main.match(/id="messages-container"/g)||[]).length,1,
  'one original Chat message container');
assert.equal((main.match(/id="chat-composer-footer"/g)||[]).length,1,
  'one original Chat composer');
assert.doesNotMatch(main,/<script src="\/js\/world-lab-chat.js"/);
const launcher=read('public/js/crew-world-launcher.js');
execFileSync(process.execPath,['--check',path.join(root,'public/js/crew-world-launcher.js')]);
assert.match(launcher,/ensureScene/);
assert.match(launcher,/loadScript\('\/vendor\/three.min.js'\)/);
assert.match(launcher,/loadScript\('\/js\/world-lab.js'\)/);
assert.match(launcher,/window\.openCrewCockpitRole/);
assert.match(launcher,/messagesSlot\.appendChild\(messages\)/);
assert.match(launcher,/composerSlot\.appendChild\(composer\)/);
assert.match(launcher,/restoreMessages\.replaceWith\(messages\)/);
assert.match(launcher,/restoreComposer\.replaceWith\(composer\)/);
assert.doesNotMatch(launcher,/postMessage|frame\.src|\/api\/role-submit|\/api\/world-chat-result/);
assert.match(launcher,/getCrewCockpitSnapshot/);
assert.match(engine,/mountCrewWorldScene/);
assert.match(engine,/renderer\.dispose\(\)/);
assert.match(engine,/renderer\.forceContextLoss/);
assert.match(engine,/cancelAnimationFrame/);
assert.match(engine,/observer\.disconnect/);

const events=require('../public/js/world-lab-events.js');

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
assert.equal(events.roadRoute([], 'island-a', 'island-b').length,0,
  'no glowing road route may be fabricated across open water');
assert.deepEqual(events.roadRoute([{a:{id:'a'},b:{id:'b'}}],'a','b'),[0],
  'recorded digital signal uses an existing bridge rather than old hub trajectory');
assert.equal(events.roadPulse([0],0,500,1000)>.6,true);
assert.match(engine,/fetch\('\/api\/crew-room-events'/);
assert.match(engine,/planner\.observe/);
assert.match(engine,/observed-handoff/);
assert.match(engine,/launchPaperPlane/);
assert.match(engine,/updateFlights/);
assert.match(engine,/paperFlightPoint/);
assert.match(engine,/edge\.light\.material\.opacity=opacity/);
assert.doesNotMatch(engine,/planner\.trail|root\.position\.set\(point\.x|root\.position\.set\(\s*T\.MathUtils\.lerp/);
assert.match(engine,/headStatus/);
assert.match(engine,/worldExtent/);
assert.match(engine,/districtPins/);
assert.match(engine,/world-district-pin/);
assert.match(css,/world-district-pin/);
assert.match(launcher,/worldDashboardButton/);

assert.match(html,/id="world-chat-open"/);
assert.doesNotMatch(html,/id="world-chat-sheet"|id="world-chat-submit"/);
assert.match(kit,/function accessory/);
assert.match(kit,/function profession/);


assert.doesNotMatch(html,/\/js\/world-lab-chat.js/);
assert.doesNotMatch(main,/\/js\/world-lab-chat.js/);
assert.match(launcher,/window\.openCrewCockpitRole/);
assert.match(engine,/CrewWorldHost\.openFullChat/);
console.log('world-lab isolated 3D demo tests: ok');
