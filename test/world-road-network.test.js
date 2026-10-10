'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const sandbox={window:{THREE:{}}};
vm.runInNewContext(source,sandbox);
const kit=sandbox.window.WorldLabKit;

function checkNetwork(roles,caseName){
  const edges=kit.planRoadNetwork(roles);
  const districts=[...new Set(roles.map(role=>role.districtId||role.id))];
  assert.equal(edges.length,districts.length,caseName+': all islands connect to Hub');
  assert.equal(edges.filter(edge=>edge.a.id==='hub'||edge.b.id==='hub').length,
    districts.length<=3?districts.length:1,
    caseName+': no more than one crowded Hub connection for larger islands');
  const visited=new Set(['hub']);
  for(let i=0;i<edges.length+1;i++){
    for(const edge of edges){
      if(visited.has(edge.a.id))visited.add(edge.b.id);
      if(visited.has(edge.b.id))visited.add(edge.a.id);
    }
  }
  for(const id of districts)assert.ok(visited.has(id),caseName+': reachable '+id);
  for(let i=0;i<edges.length;i++){
    const edge=edges[i];
    assert.ok(edge.length>edge.a.shore+edge.b.shore+.35,
      caseName+': bridge must have water to span, not overlap islands');
    for(let j=i+1;j<edges.length;j++)
      assert.equal(kit.roadCrosses(edge.a,edge.b,edges[j].a,edges[j].b),false,
        caseName+': no crossing bridges ('+i+','+j+')');
    for(const other of edges.flatMap(item=>[item.a,item.b])){
      if(other.id==='hub'||other.id===edge.a.id||other.id===edge.b.id)continue;
      const distance=kit.segmentDistance(other,edge.a,edge.b);
      assert.ok(distance>=other.shore+.54,
        caseName+': no road may cut through a third island ('+other.id+')');
    }
  }
}

for(const count of [1,2,3,4,5,6,7,9,10,16,24,36]){
  const roleData=Array.from({length:count},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,projectId:'app'
  }));
  checkNetwork(kit.makeLiveRoles(roleData),count+' same-project agents');
}
for(const count of [6,11,16,24,36]){
  const roleData=Array.from({length:count},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,
    projectId:['pocket','teacher','story','fortune','helper'][i%5]
  }));
  checkNetwork(kit.makeLiveRoles(roleData),count+' mixed-project agents');
}
checkNetwork(kit.roles,'standalone demo');
const sample=kit.makeLiveRoles(Array.from({length:16},(_,i)=>({
  roleId:'r'+i,roleName:'Agent '+i,projectId:'same'
})));
const roads=kit.planRoadNetwork(sample);
assert.equal(roads.length,6,'six neighborhoods use six bridges rather than sixteen spokes');
assert.equal(roads.filter(e=>e.a.id==='hub'||e.b.id==='hub').length,1,
  'town has one natural Central Hub entrance');
assert.ok(source.includes('roads.forEach(edge=>bridge(scene,edge))'));
assert.ok(source.includes('a.x+ux*a.shore'));
assert.ok(source.includes('b.x-ux*b.shore'));
assert.doesNotMatch(source,/districts\.forEach\(role=>bridge\(scene/);
console.log('World bridges: no crossed roads, no third-party island cuts, one hub entrance, 1-36 roles passed');
