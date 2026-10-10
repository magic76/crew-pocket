'use strict';
const assert=require('node:assert/strict');
const {projectReplies,createWorldChatHistory,createWorldChatLatest,createWorldChatResult}=require('../lib/world-chat-history');
(async()=>{
  assert.deepEqual(projectReplies({messages:[
    {role:'system',content:'private system'},
    {role:'user',content:'My personal prompt'},
    {role:'assistant',content:'  visible answer  ',thinking:'private thought',tools:[{result:'hidden'}]},
    {role:'assistant',content:''},
    {role:'tool',content:'secret tool output'},
    {role:'assistant',content:'second answer'}
  ]}).map(x=>[x.role,x.text]),[
    ['user','My personal prompt'],['assistant','visible answer'],['assistant','second answer']
  ]);
  const historyReads=[];
  const providers={codex:{
      getHistory:async id=>{historyReads.push(id);return{messages:[
      {role:'user',content:'Teacher task'},
      {role:'assistant',content:'Only teacher reply'}
    ]};},
    getStatus:()=>({isBusy:true})
  }};
  const runtime={roleId:'teacher',providerId:'codex',conversationId:'teacher-session'};
  const make=(overrides={})=>createWorldChatHistory({
    getRole:async id=>id==='teacher'?{id}:null,
    getRoleRuntime:async()=>runtime,
    getConversationSettings:async()=>({roleId:'teacher'}),
    getProvider:()=>providers.codex,
    ...overrides
  });
  assert.deepEqual((await make()('teacher')).messages.map(m=>[m.role,m.text]),[
    ['user','Teacher task'],['assistant','Only teacher reply']
  ]);
  const latest=createWorldChatLatest({readWorldChatHistory:make()});
  assert.deepEqual(await latest('teacher'),{
    roleId:'teacher',message:{id:'1',text:'Only teacher reply',timestamp:null},busy:true
  });
  assert.deepEqual(historyReads,['teacher-session','teacher-session']);
  assert.equal((await make()('teacher')).busy,true);
  await assert.rejects(()=>make()('../teacher'),{statusCode:400});
  await assert.rejects(()=>make()('missing'),{statusCode:404});
  await assert.rejects(()=>make({getConversationSettings:async()=>({roleId:'pocket'})})('teacher'),
    {statusCode:409},'another role must never read this conversation');
  await assert.rejects(()=>make({getConversationSettings:async()=>null})('teacher'),
    {statusCode:409},'missing ownership must not silently expose conversation');
  assert.equal(historyReads.length,3,'mismatched role never reaches provider history');
  const empty=await make({getRoleRuntime:async()=>null})('teacher');
  assert.deepEqual(empty.messages,[]);assert.equal(empty.conversationId,null);
  const submissions={
    'world_accepted_0001':{roleId:'teacher',status:'completed',replyText:'Actual completed answer',replyTruncated:false},
    'world_pending_00002':{roleId:'teacher',status:'running'},
    'world_other_000003':{roleId:'pocket',status:'completed',replyText:'Private Pocket reply'}
  };
  const readResult=createWorldChatResult({
    getRole:async id=>id==='teacher'?{id}:null,
    readReceipts:async()=>submissions
  });
  const answer=await readResult('teacher','world_accepted_0001');
  assert.equal(answer.response,'Actual completed answer');
  assert.equal(answer.status,'completed');
  assert.equal((await readResult('teacher','world_pending_00002')).response,'');
  await assert.rejects(()=>readResult('teacher','world_other_000003'),{statusCode:404},
    'never leak a different Role submission');
  await assert.rejects(()=>readResult('teacher','../invalid'),{statusCode:400});
    console.log('World chat history: Role ownership and bounded user/assistant history passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
