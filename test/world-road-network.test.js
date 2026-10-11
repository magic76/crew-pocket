'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const navigation=require('../public/js/world-lab-navigation.js');
const scope={window:{THREE:{}}};
vm.runInNewContext(source,scope);
const kit=scope.window.WorldLabKit;
function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}
function check(roles,title){
  const lots=navigation.uniqueLots(roles),roads=kit.planRoadNetwork(roles);
  assert.ok(lots.length>=1&&lots.length<=36);
  assert.equal(roles.length>=lots.length,true);
  // A central plaza, branched gently curving avenues, and each building's
  // own real curb connection replace the former rectangular street grid.
  assert.ok(roads.some(e=>e.a.id==='plaza'),title+': connected plaza');
  const graph=new Map();
  for(const edge of roads){
    assert.ok(edge.length>0&&Array.isArray(edge.points)&&edge.points.length>=2);
    assert.ok(distance(edge.points[0],edge.a)<1e-8);
    assert.ok(distance(edge.points.at(-1),edge.b)<1e-8);
    const measured=edge.points.reduce((sum,p,i)=>i?sum+distance(p,edge.points[i-1]):0,0);
    assert.ok(Math.abs(measured-edge.length)<1e-7);
    for(const [a,b] of [[edge.a.id,edge.b.id],[edge.b.id,edge.a.id]]){
      if(!graph.has(a))graph.set(a,[]);
      graph.get(a).push(b);
    }
  }
  const seen=new Set(['plaza']),queue=['plaza'];
  while(queue.length){
    const id=queue.shift();
    for(const next of graph.get(id)||[]){
      if(!seen.has(next)){seen.add(next);queue.push(next);}
    }
  }
  for(const lot of lots){
    assert.ok(seen.has(lot.id),title+': '+lot.id+' must be reachable');
    assert.ok(Number.isFinite(lot.rotation)&&Number.isFinite(lot.frontX));
    assert.ok(distance(lot,{x:lot.frontX,z:lot.frontZ})>3.25,
      'door curb stays outside the building envelope');
    const ux=lot.roadX-lot.x,uz=lot.roadZ-lot.z;
    assert.ok(ux*(lot.frontX-lot.x)+uz*(lot.frontZ-lot.z)>0,
      'every rotated house entrance faces its actual access street');
    assert.equal(roads.filter(e=>e.b.id===lot.id).length,1,
      'each workshop connects to the street network exactly once');
  }
  for(let i=0;i<lots.length;i++)for(let j=i+1;j<lots.length;j++){
    assert.ok(distance(lots[i],lots[j])>=7.8,
      title+': no colliding buildings '+lots[i].id+' / '+lots[j].id);
  }
  if(lots.length>=9){
    assert.ok(roads.some(e=>e.points.length>2),
      'the loop near the square needs curved street segments');
    const rotations=new Set(lots.map(l=>Math.round(l.rotation*10)));
    assert.ok(rotations.size>=3,'workshops face multiple different directions');
  }
}
for(const count of [1,2,3,4,5,6,7,9,10,16,24,36]){
  check(kit.makeLiveRoles(Array.from({length:count},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,projectId:'project'
  }))),count+' same-project');
}
for(const count of [3,6,9,10,16,24,36]){
  check(kit.makeLiveRoles(Array.from({length:count},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,projectId:'project-'+i
  }))),count+' mixed-project');
}
check(kit.roles,'standalone');
assert.equal(navigation.uniqueLots(kit.makeLiveRoles(Array.from({length:16},(_,i)=>({
  roleId:'agent-'+i,roleName:'Agent '+i,projectId:'project'
})))).length,6);
assert.match(source,/function districtPosition\(/);
assert.match(source,/function lanePoint\(/);
assert.match(source,/function buildTown\(/);
assert.match(source,/function districtBuilding\(/);
assert.match(source,/variant===0/);
assert.match(source,/variant===5|else\{ \/\/ studio with asymmetric/);
assert.match(source,/group\.rotation\.y=role\.townRotation\|\|0/);
assert.doesNotMatch(source,/for\(let col=0;col<cols;col\+\+\)/);
assert.doesNotMatch(source,/function island\(scene|function bridge\(scene/);
assert.match(source,/actors\.roadVisuals=roads/);
console.log('Organic Crew World: curved plaza loop, connected real lanes, rotating diverse workshops, safe 1–36 Role spacing');
