'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'public/js/crew-pixel-config.js'),'utf8');
const official=JSON.parse(fs.readFileSync(path.join(root,'public/vendor/pixel-agents/default-layout.json'),'utf8'));
const storage=new Map(),mockWin={localStorage:{
 getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)
}};
vm.runInNewContext(src,{window:mockWin});
const c=mockWin.CrewPixelConfig;
assert.ok(c,'Pixel Office configuration bootstraps');
assert.equal(c.validateLayout(official).furniture.length,official.furniture.length);
const raw=JSON.parse(JSON.stringify(official));
assert.equal(raw.cols,21);
const roleIds=Array.from({length:36},(_,i)=>'role-'+i);
const places=c.allocateRoles(roleIds,official);
assert.equal(Object.keys(places).length,36);
assert.equal(places['role-0'].room,0);
assert.equal(places['role-9'].room,1);
assert.equal(places['role-27'].room,3);
const fixed=c.allocateRoles(roleIds.slice().reverse(),official,places);
assert.deepEqual(JSON.parse(JSON.stringify(fixed)),JSON.parse(JSON.stringify(places)),
  'reordering roles must not move their seats');
const conflict=c.allocateRoles(roleIds.slice(0,2),official,{
 'role-0':{room:0,col:3,row:16},'role-1':{room:0,col:3,row:16}
});
assert.notDeepEqual(JSON.parse(JSON.stringify(conflict['role-0'])),
 JSON.parse(JSON.stringify(conflict['role-1'])),'no duplicate workstation');
assert.equal(c.moveRole('role-1',{room:0,col:3,row:16},places,official),null,
 'occupied desks cannot be assigned twice');
const moved=c.moveRole('role-1',{room:0,col:4,row:19},places,official);
assert.ok(moved&&moved['role-1'].col===4,'valid custom Role position');
const route=c.findPath(official,{col:3,row:16},{col:3,row:18});
assert.ok(route.length>=1,'short walkable route through official layout');
assert.throws(()=>c.validateLayout({...raw,tiles:raw.tiles.slice(1)}));
assert.throws(()=>c.validateLayout({...raw,furniture:[{type:'MALICIOUS',col:2,row:2}]}));
assert.throws(()=>c.validateLayout({...raw,furniture:[{type:'PLANT',col:30,row:2}]}));
const preference=c.write({labelMode:'hidden',outline:false,appearance:{'role-0':5},
 placements:{'role-0':{room:0,col:4,row:19}},layout:raw});
assert.equal(c.read().labelMode,'hidden');
assert.equal(c.read().appearance['role-0'],5);
assert.equal(c.read().placements['role-0'].col,4);
assert.equal(c.read().layout.furniture.length,official.furniture.length);
const unsafe=JSON.parse('{"appearance":{"__proto__":5},"placements":{"__proto__":{"room":1,"col":2,"row":3}}}');
const clean=c.normalize(unsafe);
assert.equal(Object.prototype.hasOwnProperty.call(clean.appearance,'__proto__'),false);
assert.equal(Object.prototype.hasOwnProperty.call(clean.placements,'__proto__'),false);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const renderer=fs.readFileSync(path.join(root,'public/js/crew-pixel-office.js'),'utf8');
assert.ok(html.indexOf('/js/crew-pixel-config.js')<html.indexOf('/js/crew-world-launcher.js'));
for(const id of ['crew-pixel-settings','crew-pixel-editor','crew-pixel-rotate','crew-pixel-duplicate',
 'crew-pixel-label-mode','crew-pixel-edit-role','crew-pixel-export','crew-pixel-import',
 'crew-pixel-reset-layout','world-focus'])
 assert.ok(html.includes('id="'+id+'"'),id+' UI control present');
for(const method of ['syncControls','applyEdit','updateWalkers','drawActor','focusSelected'])
 assert.ok(renderer.includes('function '+method+'('),method+' wired');
assert.doesNotMatch(renderer,/ctx\.strokeRect\(Math\.round\(charX\)/,
 'selected agent must use alpha silhouette instead of rectangular outline');
assert.match(renderer,/getImageData\(0,0,CHAR_W,CHAR_H\)/);
assert.match(renderer,/CrewWorldHost\?\.onSelectedRole/);
assert.doesNotMatch(renderer,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
console.log('Pixel Office settings, stable Role placements, layout validation, editor wiring passed');
