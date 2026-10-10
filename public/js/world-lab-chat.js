/* Map-side Role instruction composer.
 * Explicit user click -> existing idempotent Role quick-share submitter.
 * The server, not this visualizer, owns conversation/provider/workspace selection.
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
  function mount({getSelected,openConversation,fetcher,cryptoProvider,document:doc}){
    const sheet=doc.getElementById('world-chat-sheet');
    const openButton=doc.getElementById('world-chat-open');
    const closeButton=doc.getElementById('world-chat-close');
    const title=doc.getElementById('world-chat-title');
    const form=doc.getElementById('world-chat-form');
    const message=doc.getElementById('world-chat-message');
    const sendButton=doc.getElementById('world-chat-submit');
    const status=doc.getElementById('world-chat-feedback');
    const conversation=doc.getElementById('world-chat-conversation');
    if(!sheet||!openButton||!form||!message||!sendButton||!status)return null;
    const info=doc.getElementById('world-info');
    const drafts=new Map();
    let targetId=null,pending=null,lastFocus=null,inflight=false;
    function sync(){
      const role=getSelected();
      openButton.hidden=!role?.live;
      if(!sheet.hidden&&role?.id!==targetId)close();
    }
    function open(){
      const role=getSelected();
      if(!role?.live||inflight)return;
      lastFocus=doc.activeElement;
      targetId=role.id;
      title.textContent='傳話給 '+role.name;
      message.value=drafts.get(targetId)||'';
      status.textContent='';status.dataset.kind='';
      sheet.hidden=false;
      if(info)info.hidden=true;
      message.focus({preventScroll:true});
    }
    function close(){
      if(sheet.hidden||inflight)return;
      if(targetId)drafts.set(targetId,message.value);
      sheet.hidden=true;
      if(info)info.hidden=false;
      targetId=null;pending=null;
      lastFocus?.focus?.({preventScroll:true});
    }
    async function submit(){
      if(inflight||sheet.hidden)return;
      const target=getSelected();
      if(!target?.live||target.id!==targetId){
        status.dataset.kind='error';
        status.textContent='角色已切換，請重新選擇傳送對象。';
        return;
      }
      let command;
      try{
        const text=message.value.trim();
        if(pending&&pending.role_id===targetId&&pending.prompt===text)command=pending;
        else{
          command=payload(targetId,text,requestId(cryptoProvider));
          pending=command;
        }
      }catch(error){
        status.textContent=error.message;status.dataset.kind='error';return;
      }
      inflight=true;sendButton.disabled=true;message.disabled=true;
      status.dataset.kind='pending';status.textContent='傳送中，正在確認是否排入 Role 對話…';
      try{
        const response=await fetcher('/api/role-submit',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify(command)
        });
        const data=await response.json();
        if(!response.ok||data.success!==true||!data.submission?.requestId){
          throw new Error(data.error||'尚未確認傳送結果');
        }
        if(data.submission.requestId!==command.request_id)throw new Error('提交確認編號不一致');
        // A 202 receipt confirms durable acceptance, not execution success.
        status.dataset.kind='success';
        const queueState=data.submission.status==='queued'?'已加入佇列':
          data.submission.status==='running'?'Role 正在處理':
          data.submission.status==='completed'?'已處理，請至完整對話查看結果':
          '已記錄，請至完整對話確認執行狀態';
        status.textContent=target.name+'：'+queueState+'（不代表任務完成）';
        drafts.delete(targetId);
        message.value='';pending=null;
      }catch(error){
        status.dataset.kind='error';
        status.textContent=(error?.message||'網路狀態未知')+'。原訊息已保留，重試會使用相同提交編號，避免重複排隊。';
      }finally{
        inflight=false;sendButton.disabled=false;message.disabled=false;
      }
    }
    openButton.addEventListener('click',open);
    closeButton.addEventListener('click',close);
    form.addEventListener('submit',event=>{event.preventDefault();void submit();});
    message.addEventListener('input',()=>{
      if(pending&&pending.prompt!==message.value.trim())pending=null;
      if(targetId)drafts.set(targetId,message.value);
    });
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
    sync();
    return{sync,close};
  }
  return{requestId,payload,mount};
});
