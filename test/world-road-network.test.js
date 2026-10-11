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
  const groundSide=kit.townGroundSide(lots);
  assert.ok(Number.isFinite(groundSide)&&groundSide>0,
    title+': finite physical terrain size');
  const groundHalf=groundSide/2;
  for(const lot of lots){
    assert.ok(Math.abs(lot.x)+6<groundHalf&&Math.abs(lot.z)+6<groundHalf,
      title+': buildings stay inside the square ground on both axes');
  }
  // A central plaza, branched gently curving avenues, and each building's
  // own real curb connection replace the former rectangular street grid.
  assert.ok(roads.some(e=>e.a.id==='plaza'),title+': connected plaza');
  const graph=new Map();
  for(const edge of roads){
    assert.ok(edge.length>0&&Array.isArray(edge.points)&&edge.points.length>=2);
    for(const point of edge.points){
      assert.ok(Math.abs(point.x)<groundHalf&&Math.abs(point.z)<groundHalf,
        title+': navigable streets fit within the square ground');
    }
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
  // Every rendered road is sampled against each rotated building footprint.
  // It must never run under a workshop, even when a curved loop approaches.
  for(const road of roads){
    for(let step=1;step<road.points.length;step++){
      const a=road.points[step-1],b=road.points[step];
      const count=Math.max(1,Math.ceil(distance(a,b)/.3));
      for(let sample=0;sample<=count;sample++){
        const t=sample/count;
        const point={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
        for(const lot of lots){
          const p=navigation.localOffset(point,lot);
          assert.ok(!(Math.abs(p.x)<2.9&&p.z>-3.4&&p.z<.40),
            title+': street crosses rotated workshop '+lot.id+
            ' on '+road.a.id+'→'+road.b.id);
        }
      }
    }
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
assert.match(source,/function townGroundSide\(/);
assert.match(source,/box\(scene,'#748b80',side,\.70,side/);
assert.match(source,/box\(scene,'#a8cba8',side,\.22,side/);
assert.equal(kit.townGroundSide([{x:8,z:32}]),kit.townGroundSide([{x:32,z:8}]),
  'the town square is independent of which axis holds the most distant house');
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
