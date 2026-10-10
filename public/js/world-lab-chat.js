/* Crew World direct Role messages + read-only assistant replies.
 * POST uses the existing idempotent Role queue; GET reads the same owned conversation.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorldLabChat=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function requestId(cryptoProvider){
    if(!cryptoProvider||typeof cryptoProvider.getRandomValues!=='function'){
      throw new Error('此裝置無法產生安全的訊息識別碼，請改用完整對話。');
    }
    const bytes=new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return 'world_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function payload(roleId,prompt,id){
    if(!/^[A-Za-z0-9._-]{1,160}$/.test(String(roleId||'')))throw new Error('Role ID 無效');
    const text=String(prompt||'').trim();
    if(!text||text.length>5000)throw new Error('請輸入 1–5000 個字');
    return{role_id:roleId,request_id:id,prompt:text,image_path:''};
  }
  function readableMessages(data,roleId){
    if(!data||data.success!==true||data.roleId!==roleId||!Array.isArray(data.messages)){
      throw new Error('無法驗證這個 Role 的回覆');
    }
    return data.messages.filter(m=>m?.role==='assistant'&&typeof m.text==='string')
      .slice(-8).map(m=>m.text.slice(0,6000));
  }
  function mount({getSelected,openConversation,fetcher,cryptoProvider,document:doc,window:win}){
    win=win||doc.defaultView;
    const sheet=doc.getElementById('world-chat-sheet');
    const openButton=doc.getElementById('world-chat-open');
    const closeButton=doc.getElementById('world-chat-close');
    const title=doc.getElementById('world-chat-title');
    const form=doc.getElementById('world-chat-form');
    const message=doc.getElementById('world-chat-message');
    const sendButton=doc.getElementById('world-chat-submit');
    const status=doc.getElementById('world-chat-feedback');
    const conversation=doc.getElementById('world-chat-conversation');
    const history=doc.getElementById('world-chat-history');
    const readState=doc.getElementById('world-chat-read-state');
    if(!sheet||!openButton||!form||!message||!sendButton||!status||!history||!readState)return null;
    const info=doc.getElementById('world-info');
    const drafts=new Map(), pendingByRole=new Map(), localTurns=new Map();
    let targetId=null,lastFocus=null,inflight=false,reading=false,readTimer=null,visit=0;
    let lastRendered=null;
    function addBubble(text,kind){
      const bubble=doc.createElement('div');
      bubble.className='world-chat-bubble '+kind;
      const label=doc.createElement('strong');
      label.textContent=kind==='user'?'你':'AI';
      const body=doc.createElement('p');
      body.textContent=text;
      bubble.append(label,body);
      history.appendChild(bubble);
    }
    function renderMessages(texts){
      const local=localTurns.get(targetId)||null;
      const fingerprint=JSON.stringify([targetId,texts,local]);
      if(lastRendered===fingerprint)return;
      const stick=history.scrollHeight-history.scrollTop-history.clientHeight<55;
      history.replaceChildren();
      if(!texts.length&&!local){
        const empty=doc.createElement('p');
        empty.className='world-chat-empty';
        empty.textContent='這位角色目前沒有可顯示的 AI 回覆。';
        history.appendChild(empty);
      }
      for(const text of texts)addBubble(text,'assistant');
      if(local)addBubble(local,'user');
      lastRendered=fingerprint;
      if(stick||local)history.scrollTop=history.scrollHeight;
    }
    function updateViewport(){
      if(sheet.hidden)return;
      let covered=0;
      const vv=win.visualViewport;
      if(vv){
        covered=Math.max(covered,win.innerHeight-(vv.offsetTop+vv.height));
      }
      // Inside Android WebView, parent viewport can shrink while iframe remains
      // the old layout size. Translate parent visual viewport to frame coordinates.
      try{
        if(win.parent!==win&&win.frameElement){
          const pv=win.parent.visualViewport;
          if(pv){
            const frame=win.frameElement.getBoundingClientRect();
            covered=Math.max(covered,frame.bottom-(pv.offsetTop+pv.height));
          }
        }
      }catch(_){}
      covered=Math.min(Math.max(0,covered),Math.max(0,win.innerHeight-175));
      sheet.style.setProperty('--world-chat-keyboard-overlap',Math.ceil(covered)+'px');
      sheet.style.setProperty('--world-chat-available-height',
        Math.max(175,Math.floor(win.innerHeight-covered-26))+'px');
      sheet.classList.toggle('keyboard-open',covered>90);
    }
    async function refreshReplies(){
      const id=targetId,token=visit;
      if(!id||sheet.hidden||reading||doc.hidden)return;
      reading=true;
      try{
        const response=await fetcher('/api/world-chat-history?role_id='+encodeURIComponent(id),{
          cache:'no-store',credentials:'same-origin'
        });
        const data=await response.json();
        if(!response.ok||data.success!==true)throw new Error(data.error||'暫時無法讀取回覆');
        const texts=readableMessages(data,id);
        if(sheet.hidden||visit!==token||targetId!==id)return;
        if(localTurns.has(id)&&texts.length){
          // Do not claim any historical reply answered a newly submitted prompt.
          // Remove the provisional user bubble only after a changed assistant reply.
          const latest=texts[texts.length-1];
          const baseline=readState.dataset.replyBaseline||'';
          if(baseline&&latest!==baseline){localTurns.delete(id);}
        }
        renderMessages(texts);
        readState.dataset.replyBaseline=readState.dataset.replyBaseline||texts.at(-1)||'';
        readState.textContent=data.busy?'AI 正在回應，持續更新最近回覆…':
          texts.length?'已同步這個 Role 的最近 AI 回覆':'等待 Role 的第一則回覆…';
      }catch(error){
        if(visit===token&&targetId===id&&!sheet.hidden)
          readState.textContent='暫時無法同步回覆；'+(error.message||'請稍後再試');
      }finally{reading=false;}
    }
    function startReading(){
      if(readTimer!==null)win.clearInterval(readTimer);
      readTimer=win.setInterval(()=>{void refreshReplies();},4500);
      void refreshReplies();
    }
    function sync(){
      const role=getSelected();
      openButton.hidden=!role?.live;
      if(!sheet.hidden&&role?.id!==targetId)close();
    }
    function open(){
      const role=getSelected();
      if(!role?.live||inflight)return;
      lastFocus=doc.activeElement;
      targetId=role.id;visit++;
      title.textContent='跟 '+role.name+' 說話';
      message.value=drafts.get(targetId)||'';
      status.textContent='';status.dataset.kind='';
      readState.textContent='正在讀取 '+role.name+' 的最新回覆…';
      readState.dataset.replyBaseline='';
      lastRendered=null;history.replaceChildren();
      sheet.hidden=false;
      if(info)info.hidden=true;
      updateViewport();
      startReading();
      // Avoid forcing a mobile keyboard open as soon as the chat panel appears.
      win.requestAnimationFrame(()=>updateViewport());
    }
    function close(){
      if(sheet.hidden||inflight)return;
      if(targetId)drafts.set(targetId,message.value);
      sheet.hidden=true;visit++;
      if(info)info.hidden=false;
      targetId=null;lastRendered=null;
      if(readTimer!==null){win.clearInterval(readTimer);readTimer=null;}
      sheet.style.removeProperty('--world-chat-keyboard-overlap');
      lastFocus?.focus?.({preventScroll:true});
    }
    async function submit(){
      if(inflight||sheet.hidden)return;
      const target=getSelected();
      if(!target?.live||target.id!==targetId){
        status.dataset.kind='error';status.textContent='角色已切換，請重新選擇傳送對象。';return;
      }
      let command;
      try{
        const text=message.value.trim();
        const pending=pendingByRole.get(targetId);
        if(pending&&pending.role_id===targetId&&pending.prompt===text)command=pending;
        else{command=payload(targetId,text,requestId(cryptoProvider));pendingByRole.set(targetId,command);}
      }catch(error){status.textContent=error.message;status.dataset.kind='error';return;}
      inflight=true;sendButton.disabled=true;message.disabled=true;
      status.dataset.kind='pending';status.textContent='傳送中，正在確認是否排入 Role 對話…';
      try{
        const response=await fetcher('/api/role-submit',{
          method:'POST',headers:{'Content-Type':'application/json'},
          credentials:'same-origin',body:JSON.stringify(command)
        });
        const data=await response.json();
        if(!response.ok||data.success!==true||!data.submission?.requestId)
          throw new Error(data.error||'尚未確認傳送結果');
        if(data.submission.requestId!==command.request_id)throw new Error('提交確認編號不一致');
        const queueState=data.submission.status==='queued'?'已加入佇列':
          data.submission.status==='running'?'Role 正在處理':
          data.submission.status==='completed'?'已處理，請查看回覆':
          '已記錄，請確認執行狀態';
        status.dataset.kind='success';
        status.textContent=target.name+'：'+queueState+'（不代表任務完成）';
        localTurns.set(targetId,command.prompt);
        drafts.delete(targetId);pendingByRole.delete(targetId);
        message.value='';
        renderMessages([]);
        void refreshReplies();
      }catch(error){
        status.dataset.kind='error';
        status.textContent=(error?.message||'網路狀態未知')+
          '。原訊息已保留，重試會使用相同提交編號，避免重複排隊。';
      }finally{
        inflight=false;sendButton.disabled=false;message.disabled=false;
      }
    }
    openButton.addEventListener('click',open);
    closeButton.addEventListener('click',close);
    form.addEventListener('submit',event=>{event.preventDefault();void submit();});
    message.addEventListener('input',()=>{
      const pending=pendingByRole.get(targetId);
      if(pending&&pending.prompt!==message.value.trim())pendingByRole.delete(targetId);
      if(targetId)drafts.set(targetId,message.value);
    });
    message.addEventListener('focus',()=>win.requestAnimationFrame(updateViewport));
    conversation?.addEventListener('click',()=>{
      const target=getSelected();
      if(!target?.live||target.id!==targetId||inflight)return;
      close();openConversation(target.id);
    });
    doc.addEventListener('keydown',event=>{
      if(sheet.hidden)return;
      if(event.key==='Escape'&&!inflight){event.preventDefault();close();}
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submit();}
    });
    win.addEventListener('resize',updateViewport);
    win.visualViewport?.addEventListener('resize',updateViewport);
    win.visualViewport?.addEventListener('scroll',updateViewport);
    try{
      if(win.parent!==win)win.parent.visualViewport?.addEventListener('resize',updateViewport);
    }catch(_){}
    doc.addEventListener('visibilitychange',()=>{
      if(!doc.hidden&&!sheet.hidden){updateViewport();void refreshReplies();}
    });
    sync();
    return{sync,close,refreshReplies};
  }
  return{requestId,payload,readableMessages,mount};
});
