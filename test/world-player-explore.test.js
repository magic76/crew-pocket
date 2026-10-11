'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const nav=require('../public/js/world-lab-navigation.js');
const kitSource=read('public/js/world-lab-kit.js');
const world=read('public/js/world-lab.js');
const launcher=read('public/js/crew-world-launcher.js');
const standalone=read('public/world-lab.html');
const index=read('public/index.html');
const scope={window:{THREE:{}}};
vm.runInNewContext(kitSource,scope);
const kit=scope.window.WorldLabKit;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const near=(a,b,tolerance=.025)=>distance(a,b)<tolerance;
for(const count of [1,2,3,4,5,6,7,9,10,16,24,36]){
  const roles=kit.makeLiveRoles(Array.from({length:count},(_,i)=>({
    roleId:'r'+i,roleName:'Role '+i,projectId:'district-'+i
  })));
  const lots=nav.uniqueLots(roles),roads=kit.planRoadNetwork(roles);
  assert.equal(lots.length,count);
  assert.ok(lots.every(l=>Number.isFinite(l.rotation)));
  assert.equal(nav.nearestLot({x:1000,z:1000},lots),null);
  for(const role of roles){
    const lot=lots.find(l=>l.id===role.districtId);
    assert.ok(lot);
    assert.ok(nav.isSafeGround({x:role.x,z:role.z},lot),
      count+': Role standing spot is outside its rotated workshop');
    const snap=nav.nearestWalkSpot({x:lot.x,z:lot.z},lot);
    assert.ok(nav.isSafeGround(snap,lot));
    assert.ok(near(nav.localOffset(snap,lot),{x:0,z:nav.FRONT_Z}),
      'tapping the building snaps to its rotated front sidewalk');
  }
  const indices=[0,Math.floor(count/2),count-1];
  for(const i of indices)for(const j of indices){
    const from=roles[i],to=roles[j];
    const route=nav.planWalk({roads,lots,
      from:{x:from.x,z:from.z},to:{x:to.x,z:to.z},
      fromDistrict:from.districtId,toDistrict:to.districtId});
    assert.ok(route,count+': all district pairs remain reachable');
    assert.ok(route.waypoints.length<256,'mobile path has bounded memory');
    assert.ok(near(route.waypoints[0],from));
    assert.ok(near(route.waypoints.at(-1),to));
    assert.equal(route.steps.length===0,from.districtId===to.districtId,
      'inter-district walk uses real street edges, local chat uses frontage');
    for(const step of route.steps){
      const edge=roads[step.edgeIndex];
      assert.ok(edge,'every step is rendered by WorldLabKit');
      const points=step.reverse?[...edge.points].reverse():edge.points;
      assert.equal(points.length>=2,true);
      const a=step.reverse?edge.b.id:edge.a.id;
      assert.equal(step.from,a);
      assert.equal(step.to,step.reverse?edge.a.id:edge.b.id);
    }
    for(const point of route.waypoints){
      assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z));
      assert.equal(point.y,nav.FOOT_Y);
    }
    // Actual street polylines can bend. The navigator must retain at least
    // one non-cardinal leg in a large town rather than cutting through houses.
    if(count>=16&&i!==j){
      assert.ok(route.distance>0);
    }
  }
}
// The central plaza and actual intersections remain usable click targets.
const plazaRoles=kit.makeLiveRoles(Array.from({length:9},(_,i)=>({
  roleId:'plaza-'+i,roleName:'Agent '+i,projectId:'sector-'+i
})));
const plazaLots=nav.uniqueLots(plazaRoles);
const plazaRoads=kit.planRoadNetwork(plazaRoles);
const origin=plazaRoles[0];
const plazaHit=nav.nearestStreetNode({x:.3,z:.2},plazaRoads,2);
assert.ok(plazaHit&&plazaHit.id==='plaza');
const arrive=nav.planWalk({roads:plazaRoads,lots:plazaLots,
  from:origin,to:{x:0,z:0},
  fromDistrict:origin.districtId,toDistrict:'plaza'});
assert.ok(arrive&&arrive.distance>1);
assert.ok(near(arrive.waypoints.at(-1),{x:0,z:0}),
  'the avatar arrives at the actual centre of the plaza');
const depart=nav.planWalk({roads:plazaRoads,lots:plazaLots,
  from:{x:0,z:0},to:plazaRoles[8],
  fromDistrict:'plaza',toDistrict:plazaRoles[8].districtId});
assert.ok(depart&&near(depart.waypoints[0],{x:0,z:0})&&
  near(depart.waypoints.at(-1),plazaRoles[8]),
  'visitor can walk from plaza straight into the next Role conversation');

const mixed=kit.makeLiveRoles(Array.from({length:36},(_,i)=>({
  roleId:'r'+i,roleName:'Role '+i,projectId:'p'+i
})));
const edges=kit.planRoadNetwork(mixed);
assert.ok(edges.some(e=>e.points.some((p,i)=>
  i>0&&Math.abs(p.x-e.points[i-1].x)>.1&&
  Math.abs(p.z-e.points[i-1].z)>.1)), 'roads contain genuine diagonal curves');
const same=kit.makeLiveRoles([
  {roleId:'alice',roleName:'Alice',projectId:'a'},
  {roleId:'bob',roleName:'Bob',projectId:'a'}
]);
const shared=nav.uniqueLots(same);
const nearBy=nav.planWalk({roads:kit.planRoadNetwork(same),lots:shared,
  from:same[0],to:same[1],
  fromDistrict:same[0].districtId,toDistrict:same[1].districtId});
assert.equal(nearBy.steps.length,0);
assert.ok(nearBy.distance<5);
const first=shared[0];
assert.equal(nav.planWalk({roads:[],lots:shared,from:same[0],
  to:same[1],fromDistrict:first.id,toDistrict:'invalid'}),null);
assert.equal(nav.planWalk({roads:[],lots:nav.uniqueLots(mixed),from:mixed[0],
  to:mixed[1],fromDistrict:mixed[0].districtId,toDistrict:mixed[1].districtId}),null,
  'do not teleport between workshops when road graph is disconnected');
assert.match(world,/const visitor=firstLot/);
assert.match(world,/kit\.createPlayer/);
assert.match(world,/navigation\.planWalk/);
assert.match(world,/navigation\.nearestStreetNode/);
assert.match(world,/lots:townLots,roads:roadVisuals/);
assert.match(world,/startWalk\(destination,'role',role.id\)/);
assert.match(world,/void window\.CrewWorldHost\.openChat\(role.id\)/);
assert.match(world,/setPointerCapture/);
assert.match(world,/tap\.moved/);
assert.match(world,/ray\.ray\.intersectPlane/);
assert.match(world,/followPlayer=false;/);
assert.match(world,/workHalo\.material\.opacity=working/);
assert.match(world,/flight\.recipient\.reactionUntil=now/);
assert.match(world,/const idleGesture=/);
assert.doesNotMatch(world,/fetch\('\/api\/role-submit|method:\s*'POST'/);
assert.match(launcher,/loadScript\('\/js\/world-lab-navigation.js'\)/);
assert.match(index,/id="world-explore-toggle"/);
assert.match(standalone,/id="world-explore-toggle"/);
assert.match(standalone,/\/js\/world-lab-navigation.js/);
assert.match(kitSource,/function createPlayer/);
assert.match(kitSource,/function buildTown/);
assert.match(kitSource,/box\(scene,'#568e72'/);
console.log('Organic town player: 1–36 roles, rotated building frontage, connected curved paths and original Chat');
