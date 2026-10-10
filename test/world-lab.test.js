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
for(const name of ['world-lab-kit.js','world-lab.js']){
  execFileSync(process.execPath,['--check',path.join(root,'public/js',name)]);
}
const sequence=['/vendor/three.min.js','/js/world-lab-kit.js','/js/world-lab.js'];
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
assert.deepEqual(six.map(r=>r.id),['one','two','three','four','five','six']);
assert.equal(six[4].state,'unknown','untrusted statuses cannot masquerade as work');
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
console.log('world-lab isolated 3D demo tests: ok');
