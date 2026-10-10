'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const events=require('../public/js/world-lab-events.js');
const world=fs.readFileSync(path.join(__dirname,'../public/js/world-lab.js'),'utf8');
const from={x:-6,y:3.25,z:2},to={x:8,y:3.25,z:-6};
const p0=events.paperFlightPoint(from,to,0);
const p1=events.paperFlightPoint(from,to,1);
const pm=events.paperFlightPoint(from,to,.5);
assert.deepEqual(p0,from,'airplane starts at sender');
assert.deepEqual(p1,to,'airplane ends at the chosen recipient');
assert.ok(pm.y>from.y+2,'cross-island arc visibly clears water and buildings');
assert.ok(pm.x>from.x&&pm.x<to.x,'arc flies between actual roles');
assert.equal(events.paperFlightPoint(from,to,-1).x,from.x);
assert.equal(events.paperFlightPoint(from,to,8).x,to.x);
assert.ok(events.paperFlightDuration(from,to)>=820);
assert.ok(events.paperFlightDuration(from,to)<=1650);
assert.ok(events.paperFlightDuration({x:0,y:1,z:0},{x:1,y:1,z:0})<
  events.paperFlightDuration(from,to),'short same-island flights are quicker');
for(const n of [3,6,16,36]){
  const roles=Array.from({length:n},(_,i)=>({
    roleId:'role-'+i,roleName:'Role '+i,projectId:'project-'+(i%3)
  }));
  const projected=(() => {
    const sandbox={window:{THREE:{}}};
    vm.runInNewContext(source,sandbox);
    return sandbox.window.WorldLabKit.makeLiveRoles(roles);
  })();
  const start={x:projected[0].x,y:3.25,z:projected[0].z};
  const end={x:projected[n-1].x,y:3.25,z:projected[n-1].z};
  for(let step=0;step<=20;step++){
    const point=events.paperFlightPoint(start,end,step/20);
    assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z),
      n+'-role scenes cannot produce invalid flight positions');
    assert.ok(point.y>=3.25, 'paper-plane arc stays airborne, not under the islands');
  }
}
const close={x:0,y:3.25,z:0},local={x:1.5,y:3.25,z:.25};
assert.ok(events.paperFlightPoint(close,local,.5).y>close.y,
  'same-island agents use a small airborne arc, no bridge needed');

class Object3D {
  constructor(){
    this.children=[];this.position={set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={x:0,y:0,z:0};
    this.scale={setScalar(v){this.value=v;}};
  }
  add(child){this.children.push(child);}
  remove(child){this.children=this.children.filter(x=>x!==child);}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
}
class Geometry {
  constructor(){this.disposed=false;}
  setAttribute(name,attr){this[name]=attr;}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class Material {constructor(options){Object.assign(this,options);this.disposed=false;}dispose(){this.disposed=true;}}
class Mesh extends Object3D {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Group extends Object3D {}
class BufferGeometry extends Geometry{}
class BoxGeometry extends Geometry{}
class SphereGeometry extends Geometry{}
const THREE={Mesh,Group,BufferGeometry,BoxGeometry,SphereGeometry,
  MeshBasicMaterial:Material,Float32BufferAttribute:class{constructor(data,n){this.data=data;this.itemSize=n;}},
  DoubleSide:2};
const win={THREE};
vm.runInNewContext(source,{window:win});
const kit=win.WorldLabKit;
const scene=new Group();
const outgoing=kit.createPaperPlane(scene,'handoff');
const returning=kit.createPaperPlane(scene,'reply');
assert.equal(scene.children.length,8,'two planes each allocate one body and three trail beads');
assert.equal(outgoing.trails.length,3);
assert.equal(outgoing.root.children.length,2,'origami has wings and a fold spine');
assert.notEqual(outgoing.root.children[0].material.color,returning.root.children[0].material.color,
  'reply flights must look different from outgoing messages');
kit.disposePaperPlane(scene,outgoing);
assert.equal(scene.children.length,4,'expired flight removes all of its GPU objects');
assert.ok(outgoing.root.children[0].geometry.disposed);
assert.ok(outgoing.trails.every(trail=>trail.geometry.disposed&&trail.material.disposed));
kit.disposePaperPlane(scene,returning);
assert.equal(scene.children.length,0,'all paper-airplane resources are released');

assert.match(world,/const MAX_ACTIVE_PLANES=3/);
assert.match(world,/const MAX_PENDING_MESSAGES=6/);
assert.match(world,/pendingTransitions\.shift\(\)/);
assert.match(world,/launchPaperPlane\(actor,recipient,now,event.kind\)/);
assert.match(world,/launchPaperPlane\(sender,recipient,now,'demo'\)/);
assert.match(world,/kit\.disposePaperPlane\?\.\(scene,flight.plane\)/);
assert.match(world,/paperFlightPoint\(flight.from,flight.to/);
assert.match(world,/showArrivalCue\(flight,now\)/);
assert.doesNotMatch(world,/activeRoadSignals|bridge illumination/i,
  'paper planes remain independent from the removed bridge effect');
assert.match(world,/if\(isLive\)runRecordedHandoff\(now\)/,
  'recorded Role events still trigger flights in the continuous town');
assert.doesNotMatch(world,/playRoadSignal\(/);
assert.doesNotMatch(world,/planner\.trail\(/);
assert.match(world,/非送達確認/,'the visual effect must not claim delivery');
assert.match(world,/if\(isLive\)runRecordedHandoff\(now\)/,
  'real planes must come from observed saved Role message events');
console.log('Crew World paper planes: arc, orientation inputs, 1-36 roles, GPU cleanup, routing and semantics passed');
