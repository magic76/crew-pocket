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
const project=host.CrewPixelOffice.projectRoles;
const rows=project([
 {roleId:'r1',roleName:'Dev',state:'working',currentWork:{title:'Real job'},attentionCount:1},
 {roleId:'r2',roleName:'QA',state:'waiting',attentionCount:2},
 {roleId:'r3',roleName:'Idle',state:'idle',currentWork:{title:'Stale job'}},
 {roleId:'r1',roleName:'Duplicate',state:'working'},
 {roleId:'r4',roleName:'Unknown',state:'complete',currentWork:{title:'Fake'}}
]);
assert.deepEqual(Array.from(rows,row=>row.id),['r1','r2','r3','r4']);
assert.equal(rows[0].work,'Real job');
assert.equal(rows[1].attention,2);
assert.equal(rows[2].work,'');
assert.equal(rows[3].state,'unknown');
assert.equal(rows[3].work,'');
assert.equal(project([]).length,0);
assert.equal(project(Array.from({length:44},(_,i)=>({roleId:'r'+i}))).length,36);
assert.equal(host.CrewPixelOffice.resolveFurniture('PLANT_2').path,
 'furniture/PLANT_2/PLANT_2.png');
assert.equal(host.CrewPixelOffice.resolveFurniture('SOFA_SIDE:left').mirrored,true);
assert.equal(host.CrewPixelOffice.resolveFurniture('DESK_FRONT').path,
 'furniture/DESK/DESK_FRONT.png');
const layout=JSON.parse(read('public/vendor/pixel-agents/default-layout.json'));
assert.equal(layout.cols,21);assert.equal(layout.rows,22);
assert.ok(layout.furniture.length>20);
assert.equal(host.CrewPixelOffice.seatFor(9,layout).segment,1);
assert.match(src,/112x96/);
assert.match(src,/FRAME_TIME/);
assert.match(src,/\/api\/crew-status/);
assert.doesNotMatch(src,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
assert.match(src,/CrewWorldHost\?\.onSelectedRole/);
const html=read('public/index.html'),launcher=read('public/js/crew-world-launcher.js');
assert.match(html,/id="crew-pixel-office"/);
assert.match(html,/id="crew-pixel-roles"/);
assert.doesNotMatch(html,/id="world-render-mode"/);
assert.doesNotMatch(html,/id="world-stage"/);
assert.doesNotMatch(launcher,/THREE|mountCrewWorldScene|\/js\/world-lab\.js/);
assert.match(launcher,/mountCrewPixelOfficeScene/);
assert.match(read('public/css/crew-pixel-office.css'),/image-rendering:pixelated/);
(async()=>{
 class Node{
  constructor(){this.children=[];this.events=new Map();this.attrs={};this.style={};
   this.dataset={};this.hidden=false;this.clientWidth=390;this.clientHeight=700;}
  addEventListener(type,fn){const f=this.events.get(type)||[];f.push(fn);this.events.set(type,f);}
  removeEventListener(type,fn){this.events.set(type,(this.events.get(type)||[]).filter(x=>x!==fn));}
  setAttribute(name,val){this.attrs[name]=val;}
  getAttribute(name){return this.attrs[name];}
  append(...items){this.children.push(...items);}
  appendChild(el){this.children.push(el);return el;}
  replaceChildren(...items){this.children=items;}
  getBoundingClientRect(){return{left:0,top:0,width:390,height:700};}
  click(){for(const fn of this.events.get('click')||[])fn({});}
 }
 const names=['crew-pixel-office','crew-pixel-canvas','crew-pixel-roles','crew-pixel-feedback',
  'world-reset','world-zoom-in','world-zoom-out'];
 const dom=Object.fromEntries(names.map(name=>[name,new Node()]));
 const canvas=dom['crew-pixel-canvas'];let renders=0;
 canvas.getContext=()=>({
  setTransform(){},fillRect(){renders++;},fillText(){},strokeRect(){},drawImage(){renders++;},
  translate(){},scale(){},save(){},restore(){}
 });
 const timers=new Map();let tid=0;const selected=[];
 const win={devicePixelRatio:1,innerWidth:390,innerHeight:700,
  getCurrentRoleId:()=> 'dev',matchMedia:()=>({matches:true}),
  addEventListener(){},removeEventListener(){},
  setInterval(fn){const id=++tid;timers.set(id,fn);return id;},
  clearInterval(id){timers.delete(id);},
  CrewWorldHost:{onSelectedRole(id,name){selected.push([id,name]);}}
 };
 const doc={hidden:false,getElementById:id=>dom[id]||null,createElement:()=>new Node()};
 const crew=[
  {roleId:'dev',roleName:'Developer',state:'working',currentWork:{title:'Edit'}},
  {roleId:'qa',roleName:'Reviewer',state:'waiting',attentionCount:2}
 ];
 const requests=[];
 const readStatus=async url=>{
  requests.push(url);return{ok:true,json:async()=>url.includes('default-layout.json')
   ?layout:{success:true,roles:crew}};
 };
 class ImageMock{
  constructor(){this.width=16;this.height=32;}
  set src(value){this.url=value;setImmediate(()=>{if(value.includes('char_')){this.width=112;this.height=96;}this.onload?.();});}
 }
 vm.runInNewContext(src,{window:win,document:doc,fetch:readStatus,Image:ImageMock});
 const scene=win.mountCrewPixelOfficeScene({selectedId:'dev'});
 assert.ok(scene);
 for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(requests.includes('/api/crew-status'));
 assert.ok(requests.includes('/vendor/pixel-agents/default-layout.json'));
 assert.ok(renders>0,'renders original office furniture/floor and sprites');
 assert.equal(dom['crew-pixel-roles'].children.length,2);
 assert.equal(dom['crew-pixel-roles'].children[0].attrs['aria-pressed'],'true');
 assert.ok(scene.getCameraState().panX<168,'initial camera shows the selected workstation');
 dom['crew-pixel-roles'].children[1].click();
 assert.equal(selected.at(-1)[0],'qa','selects original Crew Role by ID');
 assert.equal(scene.getCameraState().selectedId,'qa');
 dom['world-zoom-in'].click();dom['world-zoom-out'].click();dom['world-reset'].click();
 scene.pause();assert.equal(timers.size,0);
 scene.resume();assert.equal(timers.size,1);
 scene();assert.equal(timers.size,0);assert.equal(dom['crew-pixel-office'].hidden,true);
 console.log('Upstream Pixel Agents sprites/layout and Crew Role lifecycle tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
