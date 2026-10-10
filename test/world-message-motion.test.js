'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const kitSource=fs.readFileSync(path.join(__dirname,'../public/js/world-lab-kit.js'),'utf8');
const sceneSource=fs.readFileSync(path.join(__dirname,'../public/js/world-lab.js'),'utf8');
const events=require('../public/js/world-lab-events.js');
const nav=require('../public/js/world-lab-navigation.js');

const now=Date.now();
const old={id:'old',fromRoleId:'a',toRoleId:'b',createdAt:now-1200};
const fresh={id:'new',fromRoleId:'a',toRoleId:'b',kind:'reply',createdAt:now-200};
const baseline=events.observe([old],null,['a','b'],now);
assert.deepEqual(baseline.arrivals,[],'do not replay old saved handoffs');
const observed=events.observe([old,fresh],baseline.seenIds,['a','b'],now);
assert.deepEqual(observed.arrivals.map(x=>x.id),['new']);
assert.equal(observed.arrivals[0].kind,'reply');
assert.equal(events.observe([old,fresh],observed.seenIds,['a','b'],now).arrivals.length,0);
assert.equal(events.observe([{...fresh,id:'invalid',fromRoleId:'other'}],
  observed.seenIds,['a','b'],now).arrivals.length,0);

const point=events.paperFlightPoint({x:-10,y:3.25,z:0},{x:10,y:3.25,z:0},.5);
assert.ok(point.y>3.25,'the digital message may fly over streets and buildings');
assert.match(sceneSource,/launchPaperPlane\(actor,recipient,now,event.kind\)/,
  'only previously saved Role events cause real-scene flights');
assert.match(sceneSource,/planner\.paperFlightPoint\(flight.from,flight.to/);
assert.match(sceneSource,/const MAX_ACTIVE_PLANES=3/);
assert.match(sceneSource,/sender.mode='handoff'/);
assert.match(sceneSource,/flight\.recipient\.reactionUntil=now/);
assert.match(sceneSource,/非送達確認/);
assert.doesNotMatch(sceneSource,/planner\.trail|actor\.root\.position\.set\(point\.x/);
assert.match(sceneSource,/actor\.legs\.forEach\(\(\{mesh\}\)=>\{mesh\.rotation\.x=0;\}\)/);
assert.ok(nav.SPACING>nav.FRONT_Z);
assert.match(kitSource,/actors\.roadVisuals=planRoadNetwork\(roleDefs\)/);
assert.doesNotMatch(kitSource,/function bridge\(|function island\(/,
  'paper plane animation no longer depends on physical bridges');
console.log('Town Role messages: saved-event-only flights, no avatar displacement, real street scene passed');
