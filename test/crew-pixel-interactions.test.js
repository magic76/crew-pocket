'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const layout=JSON.parse(read('public/vendor/pixel-agents/default-layout.json'));
class Node{
 constructor(name){this.name=name;this.hidden=/^(crew-pixel-settings|crew-pixel-editor|crew-pixel-floor-group)$/.test(name);
   this.events=new Map();this.children=[];this.dataset={};this.attrs={};this.style={};
   this.clientWidth=390;this.clientHeight=700;this.value='';this.checked=true;this.disabled=false;}
 addEventListener(event,cb){const set=this.events.get(event)||[];set.push(cb);this.events.set(event,set);}
 removeEventListener(event,cb){this.events.set(event,(this.events.get(event)||[]).filter(f=>f!==cb));}
 trigger(event,payload={}){for(const cb of this.events.get(event)||[])cb({pointerId:1,preventDefault(){},...payload});}
 setAttribute(k,v){this.attrs[k]=v;}
 getAttribute(k){return this.attrs[k];}
 append(...children){this.children.push(...children);}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(...children){this.children=children;}
 getBoundingClientRect(){return{left:0,top:0,width:390,height:700};}
 setPointerCapture(){}
 click(){this.trigger('click');}
 getContext(){return ctx;}
}
let paints=0,outlinePixels=0;
const ctx={setTransform(){},fillRect(){paints++;},drawImage(){paints++;},save(){},restore(){},
 translate(){},scale(){},strokeRect(){paints++;},fillText(){},beginPath(){},
 moveTo(){},lineTo(){},stroke(){paints++;},
 getImageData(){outlinePixels++;return{data:new Uint8ClampedArray(16*32*4).fill(255)}}
};
const ids=[
 'crew-pixel-office','crew-pixel-canvas','crew-pixel-roles','crew-pixel-feedback',
 'crew-pixel-settings','crew-pixel-editor','crew-pixel-settings-toggle',
 'crew-pixel-settings-close','crew-pixel-edit-toggle','crew-pixel-edit-done',
 'crew-pixel-label-mode','crew-pixel-outline','crew-pixel-follow','crew-pixel-interaction',
 'crew-pixel-appearance','crew-pixel-pets','crew-pixel-edit-tool','crew-pixel-edit-role',
 'crew-pixel-furniture-type','crew-pixel-floor-type','crew-pixel-editor-hint',
 'crew-pixel-undo','crew-pixel-redo','crew-pixel-rotate','crew-pixel-duplicate',
 'crew-pixel-reset-layout','crew-pixel-export','crew-pixel-import','crew-pixel-import-file',
 'crew-pixel-floor-group','crew-pixel-furniture-group','world-reset','world-zoom-in',
 'world-zoom-out','world-focus'
];
const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id)]));
const doc={hidden:false,getElementById:id=>nodes[id]||null,createElement:tag=>new Node(tag)};
let taskId=0;const timers=new Map(),storage=new Map(),navigation=[],urls=[];
const win={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
 devicePixelRatio:1,innerWidth:390,innerHeight:700,
 getCurrentRoleId:()=> 'dev',
 CrewWorldHost:{onSelectedRole:(id,name)=>navigation.push([id,name])},
 matchMedia:()=>({matches:false}),
 setInterval(fn){let id=++taskId;timers.set(id,fn);return id;},
 clearInterval(id){timers.delete(id);},
 addEventListener(){},removeEventListener(){}
};
const images=[];
class ImageMock{
 constructor(){this.width=16;this.height=32;}
 set src(value){images.push(value);this.url=value;
   setImmediate(()=>{if(value.includes('char_')){this.width=112;this.height=96;}this.onload?.();});
 }
 get src(){return this.url;}
}
const statuses=[
 {roleId:'dev',roleName:'Developer',state:'working',currentWork:{title:'Implementing'}},
 {roleId:'qa',roleName:'QA',state:'idle'}
];
const fetchMock=async url=>{
 if(url.includes('default-layout.json'))return{ok:true,json:async()=>layout};
 if(url==='/api/crew-status')return{ok:true,json:async()=>({success:true,roles:statuses})};
 throw Error('Unexpected remote fetch: '+url);
};
vm.runInNewContext(read('public/js/crew-pixel-config.js'),{window:win});
vm.runInNewContext(read('public/js/crew-pixel-office.js'),{window:win,document:doc,fetch:fetchMock,Image:ImageMock,
 Uint8ClampedArray});
(async()=>{
 const scene=win.mountCrewPixelOfficeScene({selectedId:'dev'});
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(scene);
 assert.equal(nodes['crew-pixel-roles'].children.length,2);
 assert.ok(outlinePixels>0,'selected character draws an alpha silhouette');
 const preferences=()=>win.CrewPixelConfig.read();
 nodes['crew-pixel-settings-toggle'].click();
 assert.equal(nodes['crew-pixel-settings'].hidden,false);
 const label=nodes['crew-pixel-label-mode'];
 label.value='hidden';label.trigger('change');
 assert.equal(preferences().labelMode,'hidden');
 assert.equal(nodes['crew-pixel-office'].dataset.labelMode,'hidden');
 const appearance=nodes['crew-pixel-appearance'];
 appearance.value='4';appearance.trigger('change');
 assert.equal(preferences().appearance.dev,4);
 const interaction=nodes['crew-pixel-interaction'];
 interaction.value='two-tap';interaction.trigger('change');
 assert.equal(preferences().interaction,'two-tap');
 const pets=nodes['crew-pixel-pets'];pets.checked=true;pets.trigger('change');
 assert.ok(images.some(url=>url.includes('/pets/gitcat/pet.png')),'optional pet is bundled');
 nodes['crew-pixel-settings-close'].click();
 nodes['crew-pixel-edit-toggle'].click();
 assert.equal(nodes['crew-pixel-editor'].hidden,false);
 const tool=nodes['crew-pixel-edit-tool'];
 tool.value='role';tool.trigger('change');
 const camera=scene.getCameraState();
 const coordinate=(col,row)=>{
   return{clientX:390/2+((col+.5)*16-camera.panX)*camera.zoom,
    clientY:700/2+((row+.5)*16-camera.panY)*camera.zoom,pointerId:11};
 };
 const tap=(col,row)=>{
   const point=coordinate(col,row);
   nodes['crew-pixel-canvas'].trigger('pointerdown',point);
   nodes['crew-pixel-canvas'].trigger('pointerup',point);
 };
 tap(4,19);
 assert.equal(preferences().placements.dev.col,4,'editor moves Role, independent of Conversation');
 assert.equal(preferences().placements.dev.row,19);
 assert.equal(navigation.length,0,'edit operations must not navigate the native Role conversation');
 const picker=nodes['crew-pixel-edit-role'];
 picker.value='qa';picker.trigger('change');
 assert.equal(scene.getCameraState().selectedId,'qa','editor can choose which Role to reposition');
 tool.value='floor';tool.trigger('change');
 nodes['crew-pixel-floor-type'].value='2';
 const before=(preferences().layout||layout).tiles[19*21+4];
 const c2=scene.getCameraState();
 const x=390/2+((4.5*16)-c2.panX)*c2.zoom;
 const y=700/2+((19.5*16)-c2.panY)*c2.zoom;
 nodes['crew-pixel-canvas'].trigger('pointerdown',{clientX:x,clientY:y,pointerId:12});
 nodes['crew-pixel-canvas'].trigger('pointerup',{clientX:x,clientY:y,pointerId:12});
 assert.equal(preferences().layout.tiles[19*21+4],2,'floor edit persists');
 nodes['crew-pixel-undo'].click();
 assert.equal(preferences().layout.tiles[19*21+4],before,'undo restores prior tile');
 nodes['crew-pixel-redo'].click();
 assert.equal(preferences().layout.tiles[19*21+4],2,'redo replays tile edit');
 nodes['crew-pixel-edit-done'].click();
 assert.equal(nodes['crew-pixel-editor'].hidden,true);
 assert.equal(timers.size,2);
 scene.pause();assert.equal(timers.size,0);
 scene.resume();assert.equal(timers.size,2);
 scene();assert.equal(timers.size,0);
 assert.equal(nodes['crew-pixel-office'].hidden,true);
 assert.ok(paints>0);
 console.log('Pixel Office: settings, silhouette, appearance, pets, seat editing, tile editing, undo/redo and lifecycle passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
