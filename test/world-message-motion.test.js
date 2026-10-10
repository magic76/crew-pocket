'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const kitSource=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const motionSource=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-events.js'),'utf8');
const sceneSource=fs.readFileSync(path.join(__dirname,'../public/js/world-lab.js'),'utf8');
const sandbox={window:{THREE:{}}};
vm.runInNewContext(kitSource,sandbox);
vm.runInNewContext(motionSource,{window:sandbox.window});
const kit=sandbox.window.WorldLabKit;
const motion=sandbox.window.WorldLabEvents;
function routeMatchesNetwork(roles){
  const edges=kit.planRoadNetwork(roles);
  const ids=new Map(roles.map(r=>[r.id,r.districtId||r.id]));
  for(const from of roles)for(const to of roles){
    const src=ids.get(from.id),dst=ids.get(to.id);
    const route=motion.roadRoute(edges,src,dst);
    if(src===dst){assert.equal(route.length,0,'local messages stay on island');continue;}
    assert.ok(route.length>0,'all distinct connected districts must have a road route');
    let cursor=src;
    const used=new Set();
    for(const index of route){
      assert.ok(index>=0&&index<edges.length,'route only refers to built bridges');
      assert.ok(!used.has(index),'tree path never loops');
      used.add(index);
      const edge=edges[index];
      assert.ok(edge.a.id===cursor||edge.b.id===cursor,'bridges must be contiguous');
      cursor=edge.a.id===cursor?edge.b.id:edge.a.id;
    }
    assert.equal(cursor,dst,'bridge route must end at the intended district');
    assert.ok(route.length<=edges.length,'finite sequence');
  }
}
for(const n of [1,2,3,4,6,9,16,24,36]){
  const roles=kit.makeLiveRoles(Array.from({length:n},(_,i)=>({
    roleId:'r'+i,roleName:'Agent '+i,projectId:'project-'+(i%5)
  })));
  routeMatchesNetwork(roles);
}
const e=[{a:{id:'alpha'},b:{id:'beta'}},{a:{id:'beta'},b:{id:'gamma'}},
  {a:{id:'beta'},b:{id:'delta'}}];
assert.deepEqual(Array.from(motion.roadRoute(e,'alpha','gamma')),[0,1]);
assert.deepEqual(Array.from(motion.roadRoute(e,'gamma','alpha')),[1,0]);
assert.deepEqual(Array.from(motion.roadRoute(e,'alpha','delta')),[0,2]);
assert.deepEqual(Array.from(motion.roadRoute(e,'alpha','alpha')),[]);
assert.deepEqual(Array.from(motion.roadRoute(e,'alpha','missing')),[],
  'disconnected or invalid destination must never receive a fake light route');
assert.deepEqual(Array.from(motion.roadRoute([], 'alpha','gamma')),[]);
assert.equal(motion.roadPulse([0,1],0,500,4000)>0,true,'bridge 0 glows first');
assert.equal(motion.roadPulse([0,1],1,500,4000),0,'bridge 1 is not glowing prematurely');
assert.equal(motion.roadPulse([0,1],1,2500,4000)>0,true,'bridge 1 glows after bridge 0');
assert.equal(motion.roadPulse([0,1],0,4000,4000),0,'no glow after route ends');
assert.equal(motion.roadPulse([],0,100,4000),0);
assert.equal(motion.roadPulse([0],0,-1,4000),0);
assert.equal(motion.roadPulse([0],0,100,0),0);
assert.ok(kitSource.includes('actors.roadVisuals=roadVisuals'));
assert.ok(kitSource.includes('return light;'));
assert.ok(kitSource.includes('light.position.set(cx,.375,cz)'),
  'signal exists on bridge surface only');
assert.ok(sceneSource.includes('playRoadSignal(actor,recipient,now,event.kind)'));
assert.ok(sceneSource.includes('roadVisuals.forEach((edge,index)=>'));
assert.ok(sceneSource.includes('edge.light.material.opacity=opacity'));
assert.ok(sceneSource.includes('sender.mode=\'handoff\''));
assert.doesNotMatch(sceneSource,/planner\.trail|T\.MathUtils\.lerp\(actor\.role\.x,hub/);
assert.doesNotMatch(sceneSource,/actor\.root\.position\.set\(point\.x/);
assert.ok(sceneSource.includes('actor.legs.forEach(({mesh})=>{mesh.rotation.x=0;})'));
console.log('Crew World message signals: 1–36 Roles follow actual bridge graph; avatars stay grounded');
