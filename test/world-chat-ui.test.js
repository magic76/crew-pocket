'use strict';
const assert=require('node:assert/strict');
const {mount}=require('../public/js/world-lab-chat.js');

class FakeElement {
  constructor(id='',doc=null){
    this.id=id;this.doc=doc;this.children=[];this.listeners={};
    this.className='';this.dataset={};this.value='';this.textContent='';
    this.hidden=id==='world-chat-sheet';this.disabled=false;
    this.style={setProperty(){},removeProperty(){}};
    this.classList={toggle(){}};
    this.clientHeight=100;this.scrollHeight=200;this.scrollTop=0;
  }
  addEventListener(event,fn){(this.listeners[event]||=[]).push(fn);}
  fire(event,props={}){
    for(const fn of this.listeners[event]||[])fn({preventDefault(){},...props});
  }
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);}
  replaceChildren(...nodes){this.children=nodes;}
  focus(){if(this.doc)this.doc.activeElement=this;}
}
function tick(){return new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  const ids=[
    'world-chat-sheet','world-chat-open','world-chat-close','world-chat-title',
    'world-chat-form','world-chat-message','world-chat-submit',
    'world-chat-feedback','world-chat-conversation','world-chat-history',
    'world-chat-read-state','world-info'
  ];
  const nodes={};
  const doc={
    hidden:false,activeElement:null,listeners:{},
    getElementById(id){return nodes[id]||null;},
    createElement(tag){return new FakeElement(tag,doc);},
    addEventListener(event,fn){(this.listeners[event]||=[]).push(fn);}
  };
  for(const id of ids)nodes[id]=new FakeElement(id,doc);
  const timers=new Map();let counter=0;
  const win={
    innerHeight:760,
    visualViewport:{offsetTop:0,height:760,addEventListener(){}},
    addEventListener(){},requestAnimationFrame(fn){fn();},
    setInterval(fn,delay){timers.set(++counter,{fn,delay});return counter;},
    clearInterval(id){timers.delete(id);}
  };
  win.parent=win;doc.defaultView=win;
  let completed=false;let submittedId=null;
  const calls=[];
  async function fetcher(url,options={}){
    calls.push({url,method:options.method||'GET'});
    const u=String(url);
    if(u.startsWith('/api/world-chat-history?'))
      return{ok:true,json:async()=>({success:true,roleId:'pocket',busy:!completed,
        messages:[{role:'user',text:'之前的任務'},{role:'assistant',text:'之前的回覆'}]})};
    if(u==='/api/role-submit'){
      const command=JSON.parse(options.body);
      assert.equal(command.role_id,'pocket');
      assert.equal(command.prompt,'修好這個問題');
      submittedId=command.request_id;
      return{ok:true,json:async()=>({success:true,submission:{
        requestId:submittedId,status:'queued'
      }})};
    }
    if(u.startsWith('/api/world-chat-result?')){
      assert.equal(new URL(u,'http://localhost').searchParams.get('request_id'),submittedId);
      return{ok:true,json:async()=>({
        success:true,roleId:'pocket',requestId:submittedId,
        status:completed?'completed':'running',
        response:completed?'這是本輪真正完成的 AI 回覆':''
      })};
    }
    throw new Error('Unexpected fetch: '+u);
  }
  const ui=mount({
    document:doc,window:win,fetcher,
    getSelected:()=>({id:'pocket',name:'Pocket Developer',live:true}),
    openConversation(){throw new Error('Should not navigate');},
    cryptoProvider:{getRandomValues(bytes){bytes.fill(42);return bytes;}}
  });
  nodes['world-chat-open'].fire('click');
  await tick();await tick();
  assert.equal(nodes['world-chat-sheet'].hidden,false);
  assert.equal(nodes['world-chat-history'].children.length,2);
  assert.equal(nodes['world-chat-history'].children[0].className,'world-chat-bubble user');
  assert.equal(nodes['world-chat-history'].children[0].children[1].textContent,'之前的任務');
  nodes['world-chat-message'].value='修好這個問題';
  nodes['world-chat-form'].fire('submit');
  await tick();await tick();
  let bubbles=nodes['world-chat-history'].children;
  assert.equal(bubbles.at(-1).className,'world-chat-bubble user',
    "queued request shows user input, not an old assistant reply");
  assert.equal(bubbles.at(-1).children[1].textContent,'修好這個問題');
  completed=true;
  await ui.refreshResult();
  bubbles=nodes['world-chat-history'].children;
  assert.equal(bubbles.at(-2).className,'world-chat-bubble user');
  assert.equal(bubbles.at(-1).className,'world-chat-bubble assistant');
  assert.equal(bubbles.at(-1).children[1].textContent,'這是本輪真正完成的 AI 回覆');
  assert.ok(nodes['world-chat-feedback'].textContent.includes('已完成'));
  const doneCount=calls.filter(x=>x.url.startsWith('/api/world-chat-result?')).length;
  await ui.refreshResult();
  assert.equal(calls.filter(x=>x.url.startsWith('/api/world-chat-result?')).length,doneCount,
    'completed request is never polled again');
  ui.close();
  assert.equal(nodes['world-chat-sheet'].hidden,true);
  assert.equal(timers.size,0,'closed sheet releases pollers');
  console.log('World chat UI: queue -> completion -> correct assistant bubble passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
