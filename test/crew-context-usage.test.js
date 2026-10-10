'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {projectContextUsage,createCrewContextUsage}=require('../lib/crew-context-usage');
const health=(used,cap,exact=true)=>({
  totalUsage:{value:used,exact,source:exact?'provider':'heuristic'},
  budget:{availableInputTokens:cap},usageRatio:used/cap
});
(async()=>{
  assert.equal(projectContextUsage(null),null);
  assert.equal(projectContextUsage({budget:{availableInputTokens:null},totalUsage:{value:200},usageRatio:null}),null);
  assert.equal(projectContextUsage({budget:{availableInputTokens:0},totalUsage:{value:250},usageRatio:1}),null);
  assert.equal(projectContextUsage({budget:{availableInputTokens:100000},totalUsage:{value:0,exact:false},usageRatio:0}),null);
  assert.deepEqual(projectContextUsage(health(70000,100000)),{
    usedTokens:70000,capacityTokens:100000,ratio:.7,percent:70,
    exact:true,source:'provider',status:'warning'
  });
  assert.deepEqual(projectContextUsage(health(91500,100000,false)),{
    usedTokens:91500,capacityTokens:100000,ratio:.915,percent:92,
    exact:false,source:'estimate',status:'critical'
  });
  assert.equal(projectContextUsage(health(120000,100000)).percent,120,
    'over-budget percentage must remain visible, only the bar is capped by UI');
  let now=1000, reads=0,wrongOwnerReads=0;
  let runtimes=[
    {roleId:'a',providerId:'codex',conversationId:'conv-a'},
    {roleId:'b',providerId:'codex',conversationId:'conv-b'},
    {roleId:'new',providerId:'codex',conversationId:null},
    {roleId:'other',providerId:'codex',conversationId:'foreign'},
    {roleId:'a',providerId:'codex',conversationId:'old-a'}
  ];
  const reader=createCrewContextUsage({
    listRoleRuntimes:async()=>runtimes,
    getConversationSettings:async(_,id)=>({roleId:id==='foreign'?'a':id==='conv-a'?'a':'b'}),
    getContextHealth:async(_,id)=>{
      reads++;if(id==='foreign')wrongOwnerReads++;
      return {contextHealth:health(id==='conv-a'?81000:24000,100000)};
    },
    now:()=>now,ttlMs:30000,concurrency:2
  });
  const first=await reader();
  assert.equal(first.roles.a.percent,81);
  assert.equal(first.roles.b.percent,24);
  assert.equal(first.roles.new,null);
  assert.equal(first.roles.other,null,'owner mismatch is unknown, never another Role value');
  assert.equal(wrongOwnerReads,0);
  assert.equal(reads,2);
  await reader();assert.equal(reads,2,'TTL cache avoids re-reading complete transcripts on every status poll');
  now+=30001;
  await reader();assert.equal(reads,4,'TTL expires independently for each conversation');
  runtimes=[{roleId:'a',providerId:'codex',conversationId:'conv-b'}];
  const switched=await reader();
  assert.equal(switched.roles.a,null,'changed Role conversation must not reuse a previous conversation gauge');

  const script=fs.readFileSync(path.join(__dirname,'..','public/js/crew-context-usage.js'),'utf8');
  let events=[],fetches=0;const sandbox={
    window:{dispatchEvent:e=>events.push(e.type)},
    CustomEvent:class{constructor(type){this.type=type;}},
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({success:true,
      roles:{a:projectContextUsage(health(73000,100000,false)),b:null}})};},
    Date,console
  };
  vm.runInNewContext(script,sandbox);
  const ui=sandbox.window.CrewContextUsage;
  assert.equal(ui.describe(null).label,'—');
  assert.equal(ui.describe(null).tone,'unknown');
  await ui.load();
  assert.equal(ui.describe(ui.get('a')).label,'~73%');
  assert.equal(ui.describe(ui.get('a')).tone,'warning');
  assert.equal(ui.describe(ui.get('b')).label,'—');
  assert.equal(ui.describe(health(120000,100000)).known,false,'only projected summary objects render');
  await ui.load();assert.equal(fetches,1,'Dashboard and Map share the same client cache');
  assert.ok(events.includes('crew:context-usage-updated'));
  const uiFile=fs.readFileSync(path.join(__dirname,'..','public/js/ui.js'),'utf8');
  const scene=fs.readFileSync(path.join(__dirname,'..','public/js/world-lab.js'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'..','public/index.html'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(uiFile,/roleContextGaugeMarkup\(role.id\)/);
  assert.match(uiFile,/crew:context-usage-updated/);
  assert.match(scene,/syncGauge\(entry.gauge,roles\[i\].id\)/);
  assert.match(scene,/syncGauge\(selectedGauge,role.id\)/);
  assert.match(page,/\/js\/crew-context-usage.js/);
  assert.match(page,/\/css\/crew-context-usage.css/);
  assert.match(server,/pathname === '\/api\/crew-context-usage'/);
  console.log('crew-context-usage: precise/estimated/unknown, ownership, caching and both views passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
