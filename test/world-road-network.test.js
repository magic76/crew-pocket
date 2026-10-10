'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const nav=require('../public/js/world-lab-navigation.js');
const sandbox={window:{THREE:{}}};
vm.runInNewContext(source,sandbox);
const kit=sandbox.window.WorldLabKit;

function checkTown(roles,name){
  const lots=nav.uniqueLots(roles);
  const expected=nav.dimensions(lots.length);
  assert.equal(kit.mapExtent(roles)>0,true);
  assert.ok(lots.length>0);
  const positions=new Set();
  for(const lot of lots){
    const key=lot.x+','+lot.z;
    assert.ok(!positions.has(key),name+': two buildings may not share a lot');
    positions.add(key);
    assert.ok(Number.isInteger(lot.col)&&Number.isInteger(lot.row));
    const cell=nav.lotPosition(lot.col+lot.row*expected.cols,lots.length);
    assert.equal(lot.x,cell.x);
    assert.equal(lot.z,cell.z);
  }
  const roads=kit.planRoadNetwork(roles);
  const navRoads=nav.streetEdges(lots);
  const expectedEdges=expected.cols*(expected.rows-1)+
    (expected.cols-1)*expected.rows;
  assert.equal(roads.length,expectedEdges,name+': complete grid street graph');
  assert.equal(navRoads.length,expectedEdges,name+': navigator and geometry share topology');
  const keys=new Set(roads.map(e=>[e.a.id,e.b.id].sort().join(':')));
  assert.equal(keys.size,roads.length,'no duplicated streets');
  for(let i=0;i<roads.length;i++){
    const road=roads[i],match=navRoads[i];
    assert.equal(road.a.id,match.a.id);
    assert.equal(road.b.id,match.b.id);
    assert.equal(road.a.x,match.a.x);
    assert.equal(road.b.z,match.b.z);
    assert.equal(road.length,nav.SPACING);
    assert.ok(road.a.x===road.b.x||road.a.z===road.b.z,
      name+': each visible street is strictly horizontal or vertical');
    assert.ok(!('shore' in road.a)&&!('shore' in road.b),
      name+': town is not an island bridge network');
  }
  assert.equal(nav.streetLines(lots).length,expected.cols+expected.rows,
    'the grass town contains every street centerline');
}
for(const n of [1,2,3,4,5,6,7,9,10,16,24,36]){
  const records=Array.from({length:n},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,projectId:'app'
  }));
  checkTown(kit.makeLiveRoles(records),n+' same-project Roles');
}
for(const n of [6,11,16,24,36]){
  const records=Array.from({length:n},(_,i)=>({
    roleId:'agent-'+i,roleName:'Agent '+i,projectId:'project-'+i
  }));
  checkTown(kit.makeLiveRoles(records),n+' distinct-project Roles');
}
checkTown(kit.roles,'standalone town preview');
const grouped=kit.makeLiveRoles(Array.from({length:16},(_,i)=>({
  roleId:'a'+i,roleName:'Role '+i,projectId:'same'
})));
assert.equal(nav.uniqueLots(grouped).length,6,
  'same-project Role grouping preserves max three people per studio');
assert.match(source,/function buildTown\(/);
assert.match(source,/function districtBuilding\(/);
assert.match(source,/const TOWN_SPACING=10/);
assert.doesNotMatch(source,/function island\(scene|function bridge\(scene|const HUB=\{/,
  'remove every free-standing island and cross-water bridge');
assert.match(source,/actors\.roadVisuals=planRoadNetwork\(roleDefs\)/);
console.log('World town layout: continuous floor and connected streets for 1–36 Roles passed');
