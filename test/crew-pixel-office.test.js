'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=path=>fs.readFileSync(require('node:path').join(root,path),'utf8');
const src=read('public/js/crew-pixel-office.js');
const host={};
vm.runInNewContext(src,{window:host});
assert.equal(typeof host.mountCrewPixelOfficeScene,'function');
const project=host.CrewPixelOffice.projectRoles;
const rows=project([
  {roleId:'r1',roleName:'Dev',state:'working',currentWork:{title:'Real job'},attentionCount:1},
  {roleId:'r2',roleName:'QA',state:'waiting',attentionCount:2},
  {roleId:'r3',roleName:'Idle',state:'idle',currentWork:{title:'Stale job'}},
  {roleId:'r1',roleName:'Duplicate',state:'working'},
  {roleId:'r4',roleName:'Unknown',state:'complete',currentWork:{title:'Fake'}},
]);
assert.deepEqual(Array.from(rows,row=>row.id),['r1','r2','r3','r4']);
assert.equal(rows[0].work,'Real job');
assert.equal(rows[1].attention,2);
assert.equal(rows[2].work,'','idle job title must not imply active work');
assert.equal(rows[3].state,'unknown','invalid state must never imply work');
assert.equal(rows[3].work,'');
assert.equal(project([]).length,0,'no demo agents on verified empty roster');
assert.equal(project(Array.from({length:44},(_,i)=>({roleId:'r'+i}))).length,36);
assert.match(src,/fetch\('\/api\/crew-status'/);
assert.doesNotMatch(src,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
assert.match(src,/document\.hidden/);
assert.match(src,/dispose\.pause/);
assert.match(src,/dispose\.resume/);
assert.match(src,/CrewWorldHost\?\.onSelectedRole/);
assert.match(src,/role\.state==='working'/);
const html=read('public/index.html');
const launcher=read('public/js/crew-world-launcher.js');
const css=read('public/css/crew-pixel-office.css');
assert.match(html,/id="world-render-mode"/);
assert.match(html,/id="crew-pixel-office"/);
assert.match(html,/id="crew-pixel-roles"/);
assert.match(html,/\/css\/crew-pixel-office\.css/);
assert.match(launcher,/function switchRenderer\(/);
assert.match(launcher,/stopWorld\?\.\(\);stopWorld=null/);
assert.match(launcher,/stopWorld=mountScene\(/);
assert.match(launcher,/crew-world-renderer/);
assert.match(css,/data-world-renderer="pixel"/);
assert.match(css,/\.crew-pixel-role:focus-visible/);
console.log('Pixel Office P0 renderer and integration contracts OK');
