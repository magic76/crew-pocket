const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { CrewTaskStore }=require('../lib/mcp/tasks');
const { CrewTaskRunner }=require('../lib/mcp/task-runner');
const { createCrewMcpTools }=require('../lib/mcp/agent-tools');
const { MemoryCandidateStore }=require('../lib/mcp/memory-candidates');
const { LocalMemoryProvider }=require('../lib/memory/local-memory-provider');
const { DreamingManager }=require('../lib/memory/dreaming');

async function fixture(t){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'crew-mcp-p1p2-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const roles=['role-a','role-b','role-c'].map(id=>({id,name:id,projectId:null}));
  const resolveRole=async id=>roles.find(x=>x.id===id)||null;
  const taskStore=new CrewTaskStore({storageDir:path.join(home,'tasks'),resolveRole});
  const memoryProvider=new LocalMemoryProvider({storagePath:path.join(home,'memory.json')});
  const candidateStore=new MemoryCandidateStore({storageDir:path.join(home,'candidates')});
  const toolsFor=roleId=>createCrewMcpTools({
    roleId, resolveRole, resolveRoles:async()=>roles, resolveRuntime:async id=>({
      roleId:id,providerId:'codex',conversationId:'thread-'+id
    }),
    taskStore,candidateStore,memoryProvider,
    sendMessage:async()=>({id:'fake-message'}),
    getInbox:async()=>[]
  });
  return {home,roles,resolveRole,taskStore,memoryProvider,candidateStore,toolsFor};
}
test('handoff limits identity, recursion, and duplicate active jobs',async t=>{
  const f=await fixture(t),a=f.toolsFor('role-a'),b=f.toolsFor('role-b'),c=f.toolsFor('role-c');
  const first=await a.crew_handoff({toRoleId:'role-b',task:'Inspect regression'});
  assert.equal(first.status,'queued');
  const again=await a.crew_handoff({toRoleId:'role-b',task:'Inspect regression',fromRoleId:'role-c'});
  assert.equal(again.taskId,first.taskId);
  assert.equal(again.duplicate,true);
  await assert.rejects(a.crew_handoff({toRoleId:'role-a',task:'self'}),/same Role/);
  await assert.rejects(c.crew_get_task_status({taskId:first.taskId}),/not visible/);
  await assert.rejects(b.crew_report_done({taskId:first.taskId,summary:'not started'}),/No running task/);
  await f.taskStore.transition(first.taskId,['queued'],{status:'running'});
  const child=await b.crew_handoff({toRoleId:'role-c',parentTaskId:first.taskId,task:'Review findings'});
  await assert.rejects(b.crew_handoff({toRoleId:'role-a',parentTaskId:first.taskId,task:'cycle'}),/Circular/);
  await f.taskStore.transition(child.taskId,['queued'],{status:'running'});
  await assert.rejects(c.crew_handoff({toRoleId:'role-b',parentTaskId:child.taskId,task:'cycle'}),/Circular/);
  await assert.rejects(c.crew_handoff({toRoleId:'role-a',parentTaskId:child.taskId,task:'cycle'}),/Maximum handoff depth|Circular/);
  const report=await c.crew_report_done({taskId:child.taskId,summary:'Reviewed with no findings'});
  assert.equal(report.status,'reported');
  assert.equal((await f.taskStore.getReport(child.taskId)).roleId,'role-c');
  assert.equal((await a.crew_get_task_status({taskId:first.taskId})).status,'running');
});

test('worker continues recipient session, completes job, and delivers one task-result message',async t=>{
  const f=await fixture(t);
  const messages=[];
  const runtime={roleId:'role-b',providerId:'codex',conversationId:'thread-existing',
    model:'gpt-test',effort:'low',workspace:f.home};
  const provider={
    getStatus:()=>({isBusy:false}),
    async startTurn({conversationId,roleId,sandboxMode,executionMode,executionPolicy,prompt,onEvent}){
      assert.equal(sandboxMode,'readOnly');
      assert.equal(conversationId,'thread-existing');
      assert.equal(roleId,'role-b');
      assert.equal(executionMode,'INSPECT');
      assert.equal(executionPolicy.allowWrite,false);
      assert.match(prompt,/Inspect a config problem/);
      onEvent({type:'session_started',conversationId:'thread-existing'});
      onEvent({type:'turn_completed',conversationId:'thread-existing',status:'completed',
        response:'Inspection finished; no files were changed.'});
    }
  };
  const runner=new CrewTaskRunner({
    taskStore:f.taskStore,
    resolveRole:f.resolveRole,
    resolveRuntime:async()=>runtime,
    resolveProject:async()=>null,
    getProvider:()=>provider,
    getDefaultModel:()=> 'gpt-test',
    contextBuilder:async()=>null,
    contextFormatter:()=>'',rootWorkspace:f.home,
    saveSettings:async(_,id,input)=>({...input,conversationId:id}),
    activateRuntime:async()=>({}),
    sendMessage:async x=>{messages.push(x);return {id:x.id};}
  });
  const task=await f.taskStore.create({fromRoleId:'role-a',toRoleId:'role-b',
    task:'Inspect a config problem'});
  await runner.execute(task,runtime,provider);
  assert.equal((await f.taskStore.get(task.id)).status,'completed');
  assert.match((await f.taskStore.get(task.id)).result,/Inspection finished/);
  await runner.pump();await runner.pump();
  assert.equal(messages.length,1);
  assert.equal(messages[0].kind,'task_result');
  assert.equal(messages[0].toRoleId,'role-a');
  assert.equal((await f.taskStore.get(task.id)).notifiedAt>0,true);
  assert.equal((await f.taskStore.get(task.id)).conversationId,'thread-existing');
});

test('dreaming reviews one candidate after idle, deduplicates lesson, preserves source',async t=>{
  const f=await fixture(t);
  const input=await f.toolsFor('role-a').crew_propose_memory({
    text:'Recovery after failed code search: reduce scope and retry exact paths.',
    kind:'failure_recovery',
    evidence:[{type:'git',id:'abc456'}]
  });
  const now=()=>Date.now()+20*60000;
  let summarizations=0;
  const provider={turns:new Map(),summarizeMemoryEvents:async ({events})=>{
    summarizations++;
    assert.equal(events.length,1);
    assert.match(events[0].outcome,/reduce scope/);
    return {workingSummary:'',memories:[{text:'When code search fails, narrow to exact paths and retry.'}],skills:[]};
  }};
  const manager=new DreamingManager({
    storagePath:path.join(f.home,'dreaming.json'),memoryProvider:f.memoryProvider,
    candidateStore:f.candidateStore,getRole:f.resolveRole,getProvider:()=>provider,now,
    skillRegistry:{propose:async()=>{}}
  });
  await manager.runDue();
  assert.equal(summarizations,1);
  const candidate=(await f.candidateStore.readAll())[0];
  assert.equal(candidate.id,input.candidateId);
  assert.equal(candidate.status,'consolidated');
  const memories=await f.memoryProvider.readAll();
  const memory=memories.find(x=>x.kind==='experience');
  assert.ok(memory);
  assert.ok(memory.provenance.sources.some(x=>x.id===input.candidateId));
  assert.ok(memory.provenance.sources.some(x=>x.id==='abc456'));
  await manager.runDue();
  assert.equal(summarizations,1);
  assert.equal((await f.memoryProvider.readAll()).length,memories.length);
});
