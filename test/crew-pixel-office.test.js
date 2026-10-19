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

(async()=>{
  const ids=['crew-pixel-office','crew-pixel-room','crew-pixel-canvas',
    'crew-pixel-roles','crew-pixel-feedback'];
  class FakeNode {
    constructor(){this.children=[];this.style={};this.dataset={};this.attrs={};
      this.hidden=false;this.clientWidth=360;this.clientHeight=660;this.events={};}
    setAttribute(k,v){this.attrs[k]=v;}
    getAttribute(k){return this.attrs[k];}
    addEventListener(k,cb){this.events[k]=cb;}
    append(...items){this.children.push(...items);}
    appendChild(node){this.children.push(node);return node;}
    replaceChildren(...items){this.children=items;}
    getBoundingClientRect(){return{width:360,height:660};}
    click(){this.events.click?.();}
  }
  const nodes=Object.fromEntries(ids.map(id=>[id,new FakeNode()]));
  let renders=0;
  const ctx={setTransform(){},fillRect(){renders++;},fillText(){},imageSmoothingEnabled:false};
  nodes['crew-pixel-canvas'].getContext=()=>ctx;
  const intervals=new Map();let seq=0,selected=[];
  const mockWindow={
    devicePixelRatio:1,matchMedia:()=>({matches:true}),
    getCurrentRoleId:()=> 'dev',
    CrewWorldHost:{onSelectedRole(id,name){selected.push([id,name]);}},
    setInterval(fn){const id=++seq;intervals.set(id,fn);return id;},
    clearInterval(id){intervals.delete(id);},
    addEventListener(){},removeEventListener(){},
    performance:{now:()=>10}
  };
  const doc={
    hidden:false,
    getElementById:id=>nodes[id]||null,
    createElement:()=>new FakeNode()
  };
  const mockRows=[
    {roleId:'dev',roleName:'Developer',state:'working',currentWork:{title:'Editing code'}},
    {roleId:'qa',roleName:'Reviewer',state:'waiting',attentionCount:1}
  ];
  let calls=0;
  const readStatus=async()=>{calls++;return{ok:true,json:async()=>({success:true,roles:mockRows})};};
  vm.runInNewContext(src,{window:mockWindow,document:doc,fetch:readStatus});
  const scene=mockWindow.mountCrewPixelOfficeScene({selectedId:'dev'});
  assert.ok(scene,'Pixel renderer mounts independently of Three.js');
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1,'only read real crew-status');
  assert.equal(nodes['crew-pixel-roles'].children.length,2);
  assert.equal(nodes['crew-pixel-roles'].children[0].attrs['aria-pressed'],'true');
  assert.equal(nodes['crew-pixel-roles'].children[1].dataset.state,'waiting');
  nodes['crew-pixel-roles'].children[1].click();
  assert.equal(selected.at(-1)[0],'qa','tapping desk targets original Role Chat');
  assert.equal(scene.getCameraState().selectedId,'qa');
  assert.ok(renders>0);
  assert.equal(intervals.size,1,'reduced-motion disables decorative animation');
  scene.pause();
  assert.equal(intervals.size,0,'hidden mode stops polling');
  scene.resume();
  assert.equal(intervals.size,1);
  scene();
  assert.equal(intervals.size,0);
  assert.equal(nodes['crew-pixel-office'].hidden,true);
  assert.equal(nodes['crew-pixel-roles'].children.length,0);
  console.log('Pixel Office live-role mount, tap, pause/resume/disposal OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
console.log('Pixel Office P0 renderer and integration contracts OK');

