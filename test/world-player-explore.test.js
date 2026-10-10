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
const near=(a,b,delta=.025)=>Math.hypot(a.x-b.x,a.z-b.z)<delta;
const sampleLot={id:'alpha',x:0,z:0,col:0,row:0};
assert.equal(nav.isSafeGround({x:1,z:-1.5},sampleLot),false,
  'the player must never enter workshop walls');
assert.equal(nav.isSafeGround({x:0,z:2.65},sampleLot),true);
assert.equal(nav.isSafeGround({x:0,z:4.2},sampleLot),true,
  'the town is continuous land, not an island radius');
assert.equal(nav.nearestLot({x:100,z:100},[sampleLot]),null,
  'far-off void taps must not move the visitor');
assert.ok(near(nav.nearestWalkSpot({x:1,z:-1.5},sampleLot),
  {x:1,z:nav.FRONT_Z}), 'interior taps snap to safe visible frontage');

for(const count of [1,2,3,4,5,6,7,9,16,24,36]){
  // Distinct Projects exercise the maximum building density case; same
  // Projects are tested by world-road-network.test.js.
  const roles=kit.makeLiveRoles(Array.from({length:count},(_,i)=>({
    roleId:'r'+i,roleName:'Role '+i,projectId:'district-'+i
  })));
  const lots=nav.uniqueLots(roles);
  assert.equal(lots.length,count);
  const network=kit.planRoadNetwork(roles);
  const segments=new Set(network.map(e=>[e.a.id,e.b.id].sort().join(':')));
  for(const a of [lots[0],lots[Math.floor(lots.length/2)]]){
    for(const b of [lots[0],lots[lots.length-1]]){
      const from={x:a.x,z:a.z+nav.FRONT_Z};
      const to={x:b.x,z:b.z+nav.FRONT_Z};
      const route=nav.planWalk({lots,from,to,
        fromDistrict:a.id,toDistrict:b.id});
      assert.ok(route,count+' district walk must be possible');
      assert.ok(route.waypoints.length>0&&route.waypoints.length<256);
      assert.ok(near(route.waypoints[0],from),'start from actual visitor');
      assert.ok(near(route.waypoints.at(-1),to),'end at chosen conversation');
      assert.equal(route.steps.length,Math.abs(a.col-b.col)+Math.abs(a.row-b.row),
        'shortest grid distance, no imaginary shortcuts');
      for(const step of route.steps){
        const fromId='street-'+step.fromCol+'-'+step.fromRow;
        const toId='street-'+step.toCol+'-'+step.toRow;
        assert.ok(segments.has([fromId,toId].sort().join(':')),
          'every cross-block step is a real rendered street');
      }
      for(let i=0;i<route.waypoints.length;i++){
        const point=route.waypoints[i];
        assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z));
        assert.equal(point.y,nav.FOOT_Y);
        if(i){
          const prev=route.waypoints[i-1];
          const dx=Math.abs(point.x-prev.x),dz=Math.abs(point.z-prev.z);
          assert.ok(dx<.0001||dz<.0001,'no diagonal cut through buildings');
          assert.ok(dx+dz<=nav.SPACING+.001,'no frame-level teleport');
        }
      }
    }
  }
}
const site={id:'a',x:0,z:0,col:0,row:0};
const other={id:'b',x:10,z:0,col:1,row:0};
const same=nav.planWalk({lots:[site],from:{x:-1,z:2.65},
  to:{x:1,z:2.65},fromDistrict:'a',toDistrict:'a'});
assert.equal(same.steps.length,0);
assert.ok(same.distance<3,'same-block conversations must not detour to intersection');
assert.equal(nav.planWalk({lots:[site],from:{x:0,z:2.65},
  to:{x:10,z:2.65},fromDistrict:'a',toDistrict:'missing'}),null);
assert.equal(nav.planWalk({lots:[site,other],from:{x:0,z:2.65},
  to:{x:10,z:2.65},fromDistrict:'a',toDistrict:'b'}).steps.length,1);
assert.match(world,/const visitor=firstLot/);
assert.match(world,/kit\.createPlayer/);
assert.match(world,/navigation\.planWalk/);
assert.match(world,/startWalk\(destination,'role',role.id\)/);
assert.match(world,/void window\.CrewWorldHost\.openChat\(role.id\)/,
  'approaching a Role uses original Chat sheet and Runtime');
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
assert.match(kitSource,/box\(scene,'#a9caa8'/);
console.log('Crew World town explorer: 1–36 districts, buildings avoided, streets grounded, chat reused');
