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
const coords=(role)=>({x:role.x,z:role.z});
const near=(a,b,delta=.03)=>Math.hypot(a.x-b.x,a.z-b.z)<delta;
assert.equal(nav.isSafeGround({x:1,z:-1.5},{x:0,z:0}),false,
  'visitor may not enter building');
assert.equal(nav.isSafeGround({x:0,z:3},{x:0,z:0}),true);
assert.equal(nav.isSafeGround({x:0,z:4.2},{x:0,z:0}),false);
assert.equal(nav.locateIsland({x:100,z:100},[{id:'a',x:0,z:0}]),null,
  'a tap over water never starts a walk');
for(const total of [1,2,3,4,5,6,7,9,16,24,36]){
  const records=Array.from({length:total},(_,i)=>({
    roleId:'role-'+i,roleName:'Member '+i,projectId:'p'+(i%5)
  }));
  const roles=kit.makeLiveRoles(records);
  const islands=[...new Map(roles.map(r=>[r.districtId,
    {id:r.districtId,x:r.islandX,z:r.islandZ,shore:3.30}])).values()];
  const edges=kit.planRoadNetwork(roles);
  assert.equal(islands.length,edges.length,'bridges still span every district');
  for(const from of [roles[0],roles[Math.floor(roles.length/2)]])
    for(const to of [roles[0],roles[roles.length-1]]){
      const origin=islands.find(n=>n.id===from.districtId);
      const target=islands.find(n=>n.id===to.districtId);
      const start={x:origin.x,z:origin.z+nav.WALK_RING};
      const destination={x:target.x,z:target.z+nav.WALK_RING};
      const route=nav.planWalk({roads:edges,islands,from:start,to:destination,
        fromDistrict:origin.id,toDistrict:target.id});
      assert.ok(route,'1–36 Role scene must have an accessible path');
      assert.ok(route.waypoints.length<256,'bound all waypoints for mobile');
      assert.ok(near(route.waypoints[0],start));
      assert.ok(near(route.waypoints.at(-1),destination));
      assert.equal(route.steps.length,from.districtId===to.districtId?0:
        nav.graphRoute(edges,origin.id,target.id).length);
      for(let i=0;i<route.waypoints.length;i++){
        const point=route.waypoints[i];
        const district=point.districtId;
        assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z));
        assert.equal(point.y,nav.FOOT_Y,'feet remain on grounded surfaces');
        const node=islands.find(n=>n.id===district);
        if(node)assert.ok(near(point,node,3.36),
          'on-land navigation stays in island footprint');
        if(i>0){
          const previous=route.waypoints[i-1],gap=Math.hypot(
            point.x-previous.x,point.z-previous.z);
          if(previous.districtId!==point.districtId){
            const bridge=edges.find(e=>
              (e.a.id===previous.districtId&&e.b.id===point.districtId)||
              (e.b.id===previous.districtId&&e.a.id===point.districtId));
            assert.ok(bridge,'across-water movement only along built bridge');
          }else if(gap>3.4){
            assert.fail('unreasonably long on-island jump '+gap);
          }
        }
      }
    }
}
const island={id:'a',x:0,z:0,shore:3.30};
const sameIsland=nav.planWalk({
  roads:[],islands:[island],from:{x:0,z:3},to:{x:-3,z:0},
  fromDistrict:'a',toDistrict:'a'
});
assert.ok(sameIsland.distance>4&&sameIsland.distance<7);
assert.equal(nav.planWalk({roads:[],islands:[island],
  from:{x:0,z:3},to:{x:2,z:3},fromDistrict:'a',toDistrict:'missing'}),null);
assert.equal(nav.graphRoute([], 'a','b'),null);
assert.deepEqual(nav.graphRoute([], 'a','a'),[]);

assert.match(world,/const visitor=firstIsland/);
assert.match(world,/kit\.createPlayer/);
assert.match(world,/navigation\.planWalk/);
assert.match(world,/startWalk\(destination,'role',role.id\)/);
assert.match(world,/void window\.CrewWorldHost\.openChat\(role.id\)/,
  'approaching a Role opens the ORIGINAL Role conversation');
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
assert.match(kitSource,/new T\.TorusGeometry\(3\.0,.045/);
assert.match(kitSource,/function createPlayer/);
console.log('Crew World player exploration: land/bridge path, no teleports, 1-36 Roles, chat reuse, ambient states passed');
