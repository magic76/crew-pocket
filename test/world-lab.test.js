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
assert.ok(engine.includes('renderer.toneMappingExposure=.78'));
assert.ok(engine.includes('new T.DirectionalLight(0xfff5dd,1.05)'));
assert.ok(engine.includes('new T.RingGeometry(1.08,1.42,36)'),
  'the selected agent has an explicit map highlight');
assert.ok(engine.includes('index!==selected'),
  'a selected idle Role remains visible at overview zoom');
assert.ok(kit.includes('const keepClear=(x,z)=>'),
  'decorative greenery avoids navigation lanes');
assert.match(kit,/function planTownDecorations\(/);
assert.match(kit,/function buildTownDecorations\(/);
assert.match(kit,/function profession\(/);
assert.ok(kit.includes("return 'writer'"),'writer gets a distinct studio identity');
assert.ok(kit.includes('group.userData.decorative=true'),
  'scenery cannot inherit a Role identity');
assert.ok(kit.includes('actors.workshops=workshops'),
  'workshop effects have explicit handles separate from Role rigs');
assert.ok(engine.includes('workshopGroups=new Map()'));
assert.ok(engine.includes("actor.role.state==='working'"));
assert.ok(engine.includes('isLive?Boolean(synced&&actor.role.state'),
  'live work animations are gated by verified Runtime state');
assert.ok(engine.includes('isLive&&synced&&!working'),
  'waiting attention cues never masquerade as work');
assert.ok(engine.includes('const wander=idle&&!reduced'),
  'idle motion is gentle and respects reduced-motion settings');
assert.match(engine,/new T.WebGLRenderer/);
assert.ok(kit.includes('mesh.userData.districtId=role.districtId||role.id'),
  'workshop meshes have a real district hit target');
assert.ok(kit.includes('mesh.userData.decorative=true'),
  'decorative buildings cannot route to a Role');
assert.ok(kit.includes('actors.pickableObjects='),
  '3D scene provides a bounded pickable set');
assert.match(engine,/function showDistrictPicker\(members\)/);
assert.match(engine,/members.length>1\)showDistrictPicker\(members\)/,
  'a shared workshop opens the full Role picker');
assert.match(engine,/function handleRoleTap\(index\)/);
assert.match(engine,/now-lastRoleTap.at<340/,
  'double tap is a separate focus action');
assert.doesNotMatch(engine,/if\(!explore\)|startWalk\(|advanceVisitor\(|\.nearestWalkSpot\(/,
  'empty ground does not start a walk or change view mode');
assert.ok(engine.includes('closeDistrictPicker();'),
  'tapping unused ground only dismisses a temporary member picker');
assert.ok(engine.includes("event.type==='pointerup'"),
  'cancelled gestures cannot accidentally select a Role');
assert.ok(!engine.includes('isFocusActive?.()'),
  'single tap directly selects a Role without switching modes');
assert.match(engine,/fetch\('\/api\/context\/compaction-plan\?'/,
  'Context Health uses the existing authorized read endpoint');
assert.ok(engine.includes('if(!document.getElementById('),
  'Context Health is only requested with details expanded');
assert.ok(engine.includes('liveRuntimeByRole=new Map('),
  'Context identity stays scoped to the selected Runtime conversation');
assert.ok(engine.includes('if(!synced)addStatus('),
  'unknown Runtime state cannot be shown as verified');
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
assert.match(engine,/pin\.members\.some\(role=>role\.state==='working'\|\|role\.attention>0\)/,
  'overview district pins appear only for verified work or attention');
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
  assert.equal(new Set(members.map(r=>r.x.toFixed(4)+','+r.z.toFixed(4))).size,
    members.length,'every member occupies a distinct point along the rotated frontage');
}
assert.ok(sampleWindow.WorldLabKit.mapExtent(allSixteen)>16&&
  sampleWindow.WorldLabKit.mapExtent(allSixteen)<45,
  'sixteen agents keep six separated workshops on organic branches');
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
assert.ok(sampleWindow.WorldLabKit.mapExtent(forty)>24&&
  sampleWindow.WorldLabKit.mapExtent(forty)<65,
  'up to 36 Roles form safely separated groups around a compact plaza');

assert.equal(sampleWindow.WorldLabKit.makeLiveRoles([]).length,0);

assert.match(css,/touch-action:none/);
assert.ok(html.includes('class="world-stage-frame"'));
assert.ok(css.includes('.world-stage-frame{position:absolute;inset:0'),
  'map frame fills its entire available viewport');
assert.ok(css.includes('#world-stage{position:absolute;inset:0;width:100%;height:100%}'),
  'the 3D canvas remains full-bleed');
assert.ok(!css.includes('aspect-ratio:1 / 1')&&!css.includes('100cqh'),
  'a square town must not force the WebGL viewport to a square');
assert.match(css,/safe-area-inset-bottom/);
assert.match(css,/prefers-reduced-motion/);
const main=read('public/index.html');
const launcher=read('public/js/crew-world-launcher.js');
const worldShell=read('public/css/crew-world-launcher.css');
const originalChat=read('public/js/chat.js');
assert.ok(originalChat.includes("document.body?.classList?.contains('crew-world-active')"),
  'original Chat history loader bypasses full-screen blur only inside World');
assert.ok(originalChat.includes("historyLoadOverlay = null;\n    return null;"),
  'suppressed history loader remains optional for cleanup');
assert.ok(originalChat.includes("const overlay = document.createElement('div');"),
  'ordinary Chat still preserves original history-loading overlay');
assert.ok(!worldShell.includes('.role-switching .crew-world-chat-composer-slot{opacity:.58'),
  'Role switching must not dim the editable command draft');
assert.ok(!worldShell.includes('.role-switching .crew-world-command-head select{pointer-events:none}'),
  'Role selector remains usable during slow navigation');
for(const id of ['crew-world-role-spinner','crew-world-command-retry']){
  assert.ok(main.includes('id="'+id+'"'),id+' is available inside the existing command dock');
}
assert.ok(launcher.includes('},200);'),'quick switch cannot flash the inline spinner');
assert.ok(launcher.includes('window.getCurrentRoleId?.()===selectedRoleId'),
  'Context and native Send only activate for the intended live Role');
assert.ok(launcher.includes('sendButton.disabled=guard||sendWasDisabled'),
  'native send/stop button stays guarded without blurring the textarea');
assert.ok(launcher.includes('event.stopImmediatePropagation?.()'),
  'Ctrl/Cmd+Enter cannot send against the previous Role while switching');
assert.ok(launcher.includes('switchFailed=!ok'),
  'failed navigation keeps the outgoing message locked until retry');
assert.ok(launcher.includes('if(!modal.hidden)commandDraft=promptInput.value'),
  'user can keep editing the unsent draft during pending navigation');

// Only the standalone art lab keeps its debug control strip. The actual
// Crew Pocket map has a compact utility corner and the P10 Role commander.
assert.ok(!main.includes('id="world-roster"'),'no duplicate Role strip in hosted map');
assert.ok(!main.includes('id="world-exit-map"'),
  'remove redundant map Dashboard exit in favor of the common nav toggle');
assert.ok(worldShell.includes('body.crew-world-active > #crew-chat-main-header{display:none!important}'),
  'both World modes hide the original Role Chat header while P10 is active');
assert.ok(worldShell.includes('body.crew-world-active #crew-home-header-host{'),
  'shared Dashboard/Map nav remains mounted throughout World');
assert.ok(worldShell.includes('display:block!important;position:fixed;top:0;left:0;right:0;'),
  'shared controls float above the World instead of reserving a header band');
assert.ok(worldShell.includes('body.crew-world-active .crew-world-modal:not([hidden]){inset:0}'),
  'World canvas must extend underneath the transparent navigation');
assert.ok(!worldShell.includes('.crew-world-modal.is-role-focused{inset:0}'),
  'Role focus cannot cover the shared navigation');
assert.ok(!worldShell.includes('body.crew-world-focused #crew-home-header-host{display:none!important}'),
  'Role focus must never suppress the Dashboard / Map nav');
assert.ok(!launcher.includes('worldExitMap'),
  'Dashboard switching happens through the existing common nav toggle');
assert.ok(!main.includes('id="world-zoom-in"'),'touch pinch replaces hosted zoom+');
assert.ok(!main.includes('id="world-zoom-out"'),'touch pinch replaces hosted zoom-');
assert.ok(!main.includes('<footer class="world-bottom">'),'no hosted bottom control row');
for(const id of ['world-reset']){
  assert.ok(main.includes('id="'+id+'"'),'hosted toolbar preserves '+id);
}
assert.ok(main.includes('aria-label="回到世界全景"'),'overview reset remains accessible');
assert.ok(!main.includes('aria-label="更多地圖操作"'),
  'there is no empty secondary menu when player navigation is removed');
assert.ok(!main.includes('world-explore-toggle'),
  'human-controlled exploration no longer appears in the map');
assert.ok(!html.includes('world-explore-toggle'),
  'standalone demo also omits the old exploration mode');
assert.ok(!kit.includes('function createPlayer('),
  'the human visitor mesh is no longer constructed at all');
assert.ok(engine.includes("panTo(role.islandX,role.islandZ,width<700?2.65:2.0)"),
  'double-tap Role focus pans smoothly with no walking delay');
assert.ok(html.includes('id="world-roster"'),'standalone debug lab may keep its Role roster');
assert.ok(!worldShell.includes('is-role-focused'),
  'overview and close-up use the same map controls');
assert.ok(!engine.includes('toolsMenu'),
  'no obsolete exploration-menu state survives in the map');
assert.ok(engine.includes("panTo(0,-1.8,overviewZoom);notify('返回全景')"),
  'the small overview button uses the original smooth reset');
assert.ok(engine.includes('const roster=rosterHost?roles.map('),
  'hosted world does not allocate a hidden duplicate list');

assert.match(main,/id="crew-world-open-btn"/);
assert.match(main,/id="crew-world-modal"/);
assert.match(main,/id="crew-home-dashboard-btn"/);
assert.match(main,/id="crew-home-view-toggle"/);
assert.match(main,/id="crew-home-view-toggle"[^>]*data-view="map"/);
assert.match(main,/id="crew-world-open-btn"[^>]*aria-pressed="true"/);
assert.match(main,/id="crew-home-dashboard-btn"[^>]*aria-pressed="false"/);
assert.ok(main.indexOf('id="crew-world-open-btn"')<main.indexOf('id="crew-home-dashboard-btn"'),
  'map is the first main toggle, Dashboard is the secondary destination');
assert.ok(worldShell.includes('.crew-home-view-toggle[data-view="dashboard"]::before{transform:translateX(100%)}'),
  'secondary Dashboard occupies the right side of the shared toggle');
assert.doesNotMatch(main,/id="crew-world-modal"[^>]*aria-modal="true"/,
  'primary 3D map is a Region, not an always-open dialog');
assert.match(launcher,/function restoreHomeView\(\)/);
assert.match(launcher,/function onBootstrapReady\(\)/);
assert.match(main,/id="crew-home-header-host"/);
assert.match(main,/id="crew-home-header"/);
assert.doesNotMatch(main,/id="crew-world-dashboard-btn"|id="crew-world-map-btn"/);
assert.match(main,/id="world-districts"/);
assert.match(html,/id="world-districts"/);
assert.match(main,/\/js\/crew-world-launcher.js/);
assert.doesNotMatch(main,/<script src="\/js\/world-lab.js"/);
assert.doesNotMatch(main,/<script src="\/vendor\/three.min.js"/);
assert.match(main,/id="world-stage"/);
for(const document of [main,html]){
  assert.ok(document.includes('id="world-district-picker"'));
  assert.ok(document.includes('id="world-district-picker-list"'));
  assert.ok(document.includes('id="world-status-strip"'));
}
assert.ok(css.includes('.world-district-picker[hidden]'));
assert.ok(html.includes('id="world-role-context"'),
  'standalone 3D Lab still supports its diagnostic role details');
for(const id of ['world-info','world-info-toggle','world-info-quick-focus',
  'world-role-name','world-role-state','world-role-context']){
  assert.ok(!main.includes('id="'+id+'"'),
    'hosted World removes the redundant selected-Role card: '+id);
}
assert.ok(html.includes('id="world-info-toggle"'),
  'standalone 3D Lab retains separate demo-only controls');
assert.ok(!worldShell.includes('.crew-world-modal .world-info{'),
  'no dead World-portal card layout rules remain');
assert.ok(css.includes('.world-label-context'),
  'Context warnings live in existing Role nameplates');
assert.ok(main.includes('class="world-stage-frame"'));
assert.ok(!main.includes('id="crew-world-focus-bar"'),
  'remove duplicated focus toolbar completely');
assert.equal((main.match(/id="crew-chat-main-header"/g)||[]).length,1,
  'the original Chat header remains a single DOM node');
assert.ok(main.includes('id="crew-world-command-context"'),
  'Context is available on the persistent Role command dock');
assert.ok(main.includes('/js/crew-context-usage.js'),
  'shared read-only per-Role Context warnings are loaded before World');
assert.ok(engine.includes("window.CrewContextUsage.load()"),
  'Context warning data is cached and refreshed only while World is visible');
assert.ok(engine.includes("contextMark.hidden=!pressure"),
  'unknown Context values never show a warning badge');
assert.ok(engine.includes("contextForRole(roles[selected].id)"),
  'selected Role Context action uses only selected identity');
assert.ok(engine.includes("command.dataset.contextTone=pressure?.tone||''"),
  'existing Context action receives amber/red warning, not a duplicate dialog');
assert.ok(worldShell.includes('#crew-world-command-context[data-context-tone="critical"]'),
  'critical Context warns in original command dock');
assert.ok(css.includes('[data-context-tone="critical"] .world-label-context'),
  'critical Context visually distinguishes role nameplates');
assert.ok(engine.includes("pill.dataset.contextWarningCount=String(elevated)"),
  'overview reports the count in the existing status strip, not another bar');
assert.ok(!main.includes('id="crew-world-command-full"'),
  'no redundant full-read control occupies the mobile command dock');
assert.ok(main.includes('id="crew-world-chat-expand"'),
  'the original floating reader still owns full-screen Chat expansion');
assert.equal((main.match(/id="context-pill"/g)||[]).length,1,
  'the original Context control remains the single entry to its state');
assert.equal((main.match(/id="context-modal"/g)||[]).length,1,
  'no duplicate Context Health dialog is introduced');
assert.match(main,/id="crew-world-chat-messages-slot"/);
assert.match(main,/id="crew-world-chat-composer-slot"/);

assert.match(main,/id="crew-world-command-role"/);
assert.match(main,/id="crew-world-command-read"/);
assert.match(main,/id="crew-world-result-peek"/);
assert.equal((main.match(/id="prompt-input"/g)||[]).length,1,
  'P10 commands use the only original Chat input');
assert.ok(launcher.includes("roleSwitchQueue=Promise.resolve()"),
  'Role target navigation is serialized to avoid stale selection races');
assert.ok(launcher.includes("if(!promptInput||!commandDraft||promptInput.value)return;")&&
  launcher.includes("restoreWorldDraft();"),
  'the global unsent draft survives Role navigation, including slow and failed loads');
assert.ok(launcher.includes("messages.querySelectorAll?.('.assistant-article, .btw-card')"),
  'P11 result preview projects the original message DOM');
assert.ok(launcher.includes("const result=latest?.querySelector?.('.execution-result-card')"),
  'only an actual execution card may be labeled as a work result');
assert.ok(launcher.includes("watchPreview()"),
  'the dock observes original SSE-rendered messages rather than duplicating chat');
assert.ok(engine.includes("dispose.selectRole=roleId=>activeSelectWorldRole(roleId)"),
  'the commander can pan directly to a Role on the live map');
assert.ok(engine.includes("const currentRole=window.getCurrentRoleId?.()"),
  'the map begins at the active Role, never a hard-coded first actor');
const commanderCss=read('public/css/crew-world-launcher.css');
assert.ok(commanderCss.includes('.crew-world-chat-panel .crew-world-command-head'));
assert.ok(commanderCss.includes('.crew-world-chat-panel.compact .crew-world-chat-top{display:none!important}'),
  'compact commander does not duplicate header chrome');
assert.ok(commanderCss.includes('.crew-world-modal .crew-world-chat-panel:not(.compact):not(.expanded):not([hidden])'),
  'P11 floats the original message DOM in a map reading sheet');
assert.doesNotMatch(main,/<iframe|id="crew-world-frame"/i);
assert.equal((main.match(/id="messages-container"/g)||[]).length,1,
  'one original Chat message container');
assert.equal((main.match(/id="chat-composer-footer"/g)||[]).length,1,
  'one original Chat composer');
assert.doesNotMatch(main,/<script src="\/js\/world-lab-chat.js"/);

execFileSync(process.execPath,['--check',path.join(root,'public/js/crew-world-launcher.js')]);

assert.doesNotMatch(launcher,/function focusRole\(|function exitFocus\(|crew-world-focused|focusedRoleId/,
  'no second focus state or focus-mode header class remains');
assert.doesNotMatch(engine,/CrewWorldHost\?\.(?:focusRole|exitFocus|isFocusActive|isRoleFocused)/,
  '3D scene uses direct camera movement instead of the old focus state');
assert.ok(launcher.includes("document.getElementById('context-pill')?.click()"),
  'Context delegates to original Context Health');
assert.ok(launcher.includes("window.getCurrentRoleId?.()===selectedRoleId"),
  'Context/full actions reject stale or still-switching Role target');
assert.ok(launcher.includes("panel.classList.toggle('expanded')"),
  'full conversation expands the original Chat panel, not a second renderer');
assert.ok(launcher.includes("commandRead.textContent=reading?'收合':'對話'"),
  'one command entry clearly changes between reading and collapsing');
assert.ok(worldShell.includes('body.crew-world-active #context-modal{z-index:10030!important}'),
  'Context is accessible over map without entering focus mode');
assert.ok(worldShell.includes('body.crew-world-active #crew-home-header-host{display:block!important}'),
  'the shared Dashboard/Map navigation always stays visible');
assert.ok(worldShell.includes('.crew-world-chat-panel.compact .crew-world-chat-messages-slot'),
  'one original Chat composer remains compact while camera moves');
assert.ok(!worldShell.includes('crew-world-focus-bar'));
assert.match(engine,/if\(double\)\{select\(index,true\);return;\}/,
  'double tap only changes camera target');
assert.match(engine,/panTo\(0,-1\.8,overviewZoom\);notify\('返回全景'\)/,
  'reset changes camera position without losing selected Role');
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
// P12: attention is grounded in a verified Runtime count or newly observed
// reply signature. A zero count, stale reply or unknown timestamp is not an alert.
const alertNow=1_800_000;
const alerts=events.attentionItems([
  {id:'a',attention:2},{id:'b',attention:0},{id:'c',attention:0},
  {id:'d',attention:-1},{id:'e',attention:0}
],new Map([
  ['b',{at:alertNow-1200,signature:'r-2'}],
  ['c',{at:alertNow-300001,signature:'r-3'}],
  ['d',{at:alertNow+900,signature:'future'}],
  ['e',{at:alertNow-60,signature:''}]
]),alertNow);
assert.deepEqual(alerts.map(item=>item.role.id),['a','b'],
  'P12 may show only verified pending work and currently observed replies');
assert.equal(alerts[0].count,2);
assert.equal(alerts[1].reply.signature,'r-2');
assert.deepEqual(events.attentionItems(null,new Map(),alertNow),[]);
// P14: only saved directed Role edges; filter keeps actual identities/IDs.
const evidenceForTests=[
  {id:'m1',fromRoleId:'a',toRoleId:'b',kind:'handoff'},
  {id:'m2',fromRoleId:'c',toRoleId:'a',kind:'reply'},
  {id:'m3',fromRoleId:'c',toRoleId:'d',kind:'handoff'},
  {id:'m4',fromRoleId:'a',toRoleId:'a',kind:'handoff'}
];
assert.deepEqual(events.collaborationConnections(evidenceForTests,'a',true,3).map(item=>item.id),
  ['m1','m2'],'selected-role view excludes unrelated and self-events');
assert.deepEqual(events.collaborationConnections(evidenceForTests,'a',false,2).map(item=>item.id),
  ['m1','m2'],'visual arcs remain bounded');
for(const id of ['world-attention-open','world-attention-count','world-attention-panel',
  'world-attention-list','world-role-peek','world-role-peek-name',
  'world-role-peek-body','world-collaboration-links','world-handoffs-filter']){
  assert.ok(main.includes('id="'+id+'"'),id+' exists in hosted Crew World');
}
assert.ok(!html.includes('id="world-attention-open"'),
  'standalone art preview cannot masquerade as verified runtime alerts');
assert.ok(engine.includes('planner?.attentionItems?.(roles,freshReplies,Date.now())'),
  'world alerts use the tested, bounded verified-only projector');
assert.ok(engine.includes('const role=roles[index];'),
  'attention drilldown opens a real selected Role');
assert.ok(engine.includes("void window.CrewWorldHost?.openChat?.(role.id,{compact:false})"),
  'attention reuses the original Role-specific Chat, not a second sender');
assert.ok(engine.includes('rolePeekBody.textContent=message.slice(0,155)'),
  'P13 preview is read-only, bounded and sourced from actual work or response');
assert.ok(engine.includes('actors[selected].root.add(selectionHalo,focusHalo)'),
  'P13 accent rings follow only the selected Role');
assert.ok(engine.includes('planner?.collaborationConnections?.('),
  'P14 arcs consume the validated, capped event selector');
assert.ok(engine.includes("path.setAttribute('data-kind',event.kind)"),
  'saved replies and handoffs have separate visual treatments');
assert.ok(engine.includes('evidenceVerified=false;evidenceRows=[]'),
  'unverified collaboration must remove evidence instead of lingering');
assert.ok(css.includes('.world-label[data-muted="true"]'),
  'unrelated idle Role nameplates are visually quieter');
assert.ok(css.includes('.world-label[data-attention="true"]{opacity:1}'),
  'a real attention signal is not dimmed');
assert.ok(css.includes('.world-collaboration-link[data-kind="reply"]'),
  'recorded replies remain visually distinct');
assert.ok(css.includes('.world-attention-open[hidden]'),
  'no alerts are visible without verified work');

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
for(const document of [main,html]){
  for(const id of ['world-handoffs-open','world-handoffs-panel','world-handoffs-list']){
    assert.ok(document.includes('id="'+id+'"'),id+' exists in both map experiences');
  }
}

assert.ok(!main.includes('id="world-focus-activity"')&&!html.includes('id="world-focus-activity"'),
  'the additional focus-only activity ribbon is removed');
assert.ok(!css.includes('world-focus-activity'),
  'no obsolete ribbon styles survive');
assert.ok(css.includes('.world-handoffs-panel[hidden]'));
for(const doc of [main,html]){
  assert.ok(doc.includes('id="world-flight-notice"'),
    'real-message paper-flight cue is present in both hosted and standalone 3D');
  assert.ok(doc.includes('id="world-flight-notice-text"'));
}
assert.ok(css.includes('.world-flight-notice[hidden]'),
  'flight cue remains hidden without a verified new message');
assert.ok(css.includes('.world-app:has(.world-flight-notice:not([hidden])) .world-handoffs-open'),
  'message cue and collaboration button never cover each other');
assert.ok(css.includes('.crew-world-modal:has(.crew-world-chat-panel.keyboard-open:not([hidden])) .world-flight-notice'),
  'the flight cue cannot obstruct mobile keyboard interaction in any camera state');

assert.ok(!engine.includes('refreshFocusActivity')&&!engine.includes('isRoleFocused'),
  'no P7 ribbon is gated behind a removed mode');
assert.ok(engine.includes("已停止執行 · 結果需查看對話確認"),
  'recent execution stop remains honestly visible on P13 Role peek');
assert.ok(engine.includes("rolePeekBody.textContent=message.slice(0,155)"),
  'Role peek stays read-only and grounded in actual activity');
assert.ok(engine.includes("planner.traceableEvents?.(data.events"),
  'only saved message records are listed');
assert.ok(engine.includes("evidenceVerified=false;evidenceRows=[]"),
  'stale handoff metadata clears on sync failure');
assert.ok(engine.includes("window.CrewWorldHost?.openCollaboration?.(record.toRoleId,record.id)"),
  'the evidence tray opens recipient-scoped original collaboration');
assert.doesNotMatch(engine,/fetch\('\/api\/role-submit|method:\s*'POST'/,
  'read-only World activity must never emit messages or invent tasks');
assert.match(engine,/fetch\('\/api\/crew-room-events'/);
assert.match(engine,/planner\.observe/);
assert.match(engine,/observed-handoff/);
assert.match(engine,/launchPaperPlane/);
assert.match(engine,/updateFlights/);
assert.match(engine,/paperFlightPoint/);
assert.doesNotMatch(engine,/edge\.light\.material\.opacity=opacity/);
assert.match(kit,/function buildTown/);
assert.doesNotMatch(engine,/planner\.trail|actor\.root\.position\.set\(point\.x|actor\.root\.position\.set\(\s*T\.MathUtils\.lerp/);
assert.match(engine,/headStatus/);
assert.match(engine,/worldExtent/);
assert.match(engine,/districtPins/);
assert.match(engine,/world-district-pin/);
assert.match(css,/world-district-pin/);
assert.match(launcher,/updateHomeView\('map'\)/);
assert.ok(main.includes('id="crew-home-view-toggle"'));

assert.match(html,/id="world-chat-open"/);
assert.doesNotMatch(html,/id="world-chat-sheet"|id="world-chat-submit"/);
assert.match(kit,/function accessory/);
assert.match(kit,/function profession/);


assert.doesNotMatch(html,/\/js\/world-lab-chat.js/);
assert.doesNotMatch(main,/\/js\/world-lab-chat.js/);
assert.match(launcher,/window\.openCrewCockpitRole/);
assert.match(engine,/CrewWorldHost\.openFullChat/);
console.log('world-lab isolated 3D demo tests: ok');
