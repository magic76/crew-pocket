/* One-WebView Crew World. The ORIGINAL Chat DOM is temporarily moved into
 * an overlay sheet, never cloned: one message renderer, input, SSE and Role runtime.
 */
(() => {
  'use strict';
  const opener=document.getElementById('crew-world-open-btn');
  const dashboardButton=document.getElementById('crew-home-dashboard-btn');
  const settingsButton=document.getElementById('crew-open-settings-btn');
  const addRoleButton=document.getElementById('drawer-new-role-btn');
  const toggle=document.getElementById('crew-home-view-toggle');
  const headerHost=document.getElementById('crew-home-header-host');
  const homeHeader=document.getElementById('crew-home-header');
  const modal=document.getElementById('crew-world-modal');
  const panel=document.getElementById('crew-world-chat-panel');
  const messagesSlot=document.getElementById('crew-world-chat-messages-slot');
  const composerSlot=document.getElementById('crew-world-chat-composer-slot');
  const messages=document.getElementById('messages-container');
  const composer=document.getElementById('chat-composer-footer');
  const hideButton=document.getElementById('crew-world-chat-hide');
  const expandButton=document.getElementById('crew-world-chat-expand');
  const chatButton=document.getElementById('world-chat-open');
  const roleName=document.getElementById('crew-world-chat-role-name');
  const commandRole=document.getElementById('crew-world-command-role');
  const commandState=document.getElementById('crew-world-command-state');
  const commandRead=document.getElementById('crew-world-command-read');
  const switchSpinner=document.getElementById('crew-world-role-spinner');
  const switchRetry=document.getElementById('crew-world-command-retry');
  const promptInput=document.getElementById('prompt-input');
  const sendButton=document.getElementById('send-btn');
  const peek=document.getElementById('crew-world-result-peek');
  const peekKind=document.getElementById('crew-world-result-peek-kind');
  const peekText=document.getElementById('crew-world-result-peek-text');
  const commandContext=document.getElementById('crew-world-command-context');
  if(!opener||!dashboardButton||!toggle||!headerHost||!homeHeader||!modal||!panel||!messagesSlot||!composerSlot||
     !messages||!composer||!hideButton||!expandButton)return;
  let restoreMessages=null,restoreComposer=null;
  let stopWorld=null,previousFocus=null,selectedRoleId=null,selectedRoleName='';
  let selectVersion=0,previousTab=null,restoreTab=false,openVersion=0;
  let sceneScripts=null;
  let requestedRole=null,roleSwitchQueue=Promise.resolve(),switchingRole=false,commandDraft='';
  let switchFailed=false,switchTimer=null,sendLockHeld=false,sendWasDisabled=false;
  let rolesSignature='',previewObserver=null,previewFrame=0;
  function stopSwitchTimer(){
    if(switchTimer!==null){window.clearTimeout(switchTimer);switchTimer=null;}
    if(switchSpinner)switchSpinner.hidden=true;
  }
  function guardSend(guard){
    if(!sendButton)return;
    if(guard&&!sendLockHeld){
      sendWasDisabled=Boolean(sendButton.disabled);
      sendLockHeld=true;
    }
    if(sendLockHeld){
      sendButton.disabled=guard||sendWasDisabled;
      if(!guard)sendLockHeld=false;
    }
  }
  function restoreWorldDraft(){
    if(!promptInput||!commandDraft||promptInput.value)return;
    promptInput.value=commandDraft;
    if(typeof Event==='function')
      promptInput.dispatchEvent?.(new Event('input',{bubbles:true}));
  }
  const roleSnapshot=()=>window.getCrewCockpitSnapshot?.();
  function liveRole(id){return roleSnapshot()?.roles?.find(role=>role.id===id)||null;}
  function syncCommandActions(){
    const ready=!modal.hidden&&!panel.hidden&&!switchingRole&&Boolean(selectedRoleId)&&
      Boolean(liveRole(selectedRoleId))&&window.getCurrentRoleId?.()===selectedRoleId;
    if(commandContext)commandContext.disabled=!ready;
    if(commandRead)commandRead.disabled=!ready;
    if(peek)peek.disabled=!ready;
    guardSend(!modal.hidden&&!ready);
  }
  function updateCommandRole(){
    if(!commandRole)return;
    const rows=roleSnapshot()?.roles||[];
    const signature=rows.map(role=>role.id+'\u0001'+role.name).join('\u0002');
    if(signature!==rolesSignature){
      rolesSignature=signature;
      commandRole.replaceChildren();
      for(const role of rows){
        const option=document.createElement('option');
        option.value=role.id;option.textContent=role.name||role.id;
        commandRole.appendChild(option);
      }
    }
    commandRole.disabled=!rows.length;
    if(selectedRoleId&&rows.some(role=>role.id===selectedRoleId))
      commandRole.value=selectedRoleId;
    if(commandState)commandState.textContent=rows.length
      ?switchFailed?'角色未就緒':switchingRole
        ?switchSpinner&&!switchSpinner.hidden?'切換中…':''
        :panel.hidden?'準備指令框…':'可以輸入指令'
      :'尚無可用 Role';
    if(switchRetry)switchRetry.hidden=!switchFailed||!rows.length;
    syncCommandActions();
  }
  function updatePreview(){
    if(!peek||!peekKind||!peekText||modal.hidden||panel.hidden)return;
    // This is a text-only projection from the already-rendered ORIGINAL
    // Chat DOM; execution state comes from the existing result card.
    const assistants=messages.querySelectorAll?.('.assistant-article, .btw-card')||[];
    const latest=assistants[assistants.length-1];
    const result=latest?.querySelector?.('.execution-result-card');
    const liveStatus=latest?.querySelector?.('.live-status .status-text');
    let kind='',value='';
    if(result){
      kind='工作結果';
      value=(result.querySelector('.execution-result-title')?.textContent||'')+
        ' · '+(result.querySelector('.execution-result-peek')?.textContent||'');
    }else if(liveStatus&&liveStatus.closest?.('.live-status')?.isConnected){
      kind='執行動態';value=liveStatus.textContent||'';
    }else if(latest){
      kind='最新回覆';
      value=latest.querySelector('.msg-content')?.textContent||latest.textContent||'';
    }
    const compact=String(value).replace(/\s+/g,' ').trim().slice(0,155);
    peek.hidden=!compact;
    if(compact){peekKind.textContent=kind;peekText.textContent=compact;}
  }
  function schedulePreview(){
    if(previewFrame||!window.requestAnimationFrame)return;
    previewFrame=window.requestAnimationFrame(()=>{previewFrame=0;updatePreview();});
  }
  function watchPreview(){
    previewObserver?.disconnect();
    if(window.MutationObserver){
      previewObserver=new window.MutationObserver(schedulePreview);
      previewObserver.observe(messages,{subtree:true,childList:true,characterData:true});
    }
    schedulePreview();
  }
  function stopPreview(){
    previewObserver?.disconnect();previewObserver=null;
    if(previewFrame&&window.cancelAnimationFrame)window.cancelAnimationFrame(previewFrame);
    previewFrame=0;
    if(peek)peek.hidden=true;
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const tag=document.createElement('script');
      tag.src=src;tag.onload=resolve;tag.onerror=()=>reject(new Error('無法載入 '+src));
      document.head.appendChild(tag);
    });
  }
  function ensureScene(){
    if(typeof window.mountCrewWorldScene==='function')return Promise.resolve();
    if(!sceneScripts){
      sceneScripts=(async()=>{
        if(!window.THREE)await loadScript('/vendor/three.min.js');
        if(!window.WorldLabKit)await loadScript('/js/world-lab-kit.js');
        if(!window.WorldLabEvents)await loadScript('/js/world-lab-events.js');
        if(typeof window.mountCrewWorldScene!=='function')await loadScript('/js/world-lab.js');
        if(typeof window.mountCrewWorldScene!=='function')throw new Error('3D 啟動功能未載入');
      })().catch(error=>{sceneScripts=null;throw error;});
    }
    return sceneScripts;
  }
  function moved(){return Boolean(restoreMessages);}
  function putChatBack(){
    if(!moved())return;
    restoreMessages.replaceWith(messages);
    restoreComposer.replaceWith(composer);
    restoreMessages=null;restoreComposer=null;
  }
  function putChatInPanel(){
    if(moved())return;
    restoreMessages=document.createComment('crew world: original messages position');
    restoreComposer=document.createComment('crew world: original composer position');
    messages.replaceWith(restoreMessages);
    composer.replaceWith(restoreComposer);
    messagesSlot.appendChild(messages);
    composerSlot.appendChild(composer);
    watchPreview();
  }
  function updateKeyboard(){
    if(modal.hidden)return;
    const vv=window.visualViewport;
    const bottom=vv?Math.max(0,window.innerHeight-vv.offsetTop-vv.height):0;
    panel.style.setProperty('--crew-keyboard-rise',Math.round(bottom)+'px');
    panel.style.setProperty('--crew-visible-height',
      Math.floor(vv?.height||window.innerHeight)+'px');
    panel.classList.toggle('keyboard-open',bottom>100);
  }
  function syncReadAction(){
    if(!commandRead)return;
    const reading=!panel.hidden&&!panel.classList.contains('compact');
    commandRead.textContent=reading?'收合':'對話';
    commandRead.setAttribute('aria-label',reading?'收合地圖對話':'展開地圖對話');
    commandRead.setAttribute('aria-pressed',String(reading));
  }
  function hideChat(){
    panel.hidden=true;panel.classList.remove('expanded','compact','keyboard-open');
    expandButton.textContent='展開';
    expandButton.setAttribute('aria-pressed','false');
    hideButton.textContent='收合';
    stopPreview();
    putChatBack();
    syncCommandActions();
    syncReadAction();
    // We preserve the active Role and its stream, only move DOM visibility.
    window.requestAnimationFrame(()=>{
      document.getElementById('world-stage')?.focus?.({preventScroll:true});
    });
  }
  function showCompactChat(){
    if(panel.hidden)return;
    panel.classList.remove('expanded');
    panel.classList.add('compact');
    expandButton.textContent='展開';
    expandButton.setAttribute('aria-pressed','false');
    hideButton.textContent='收合';
    updateKeyboard();
    syncReadAction();
  }
  function collapseChat(){
    if(!panel.hidden)showCompactChat();
  }
  function updateHomeView(mode){
    const dashboard=mode==='dashboard';
    toggle.dataset.view=dashboard?'dashboard':'map';
    dashboardButton?.setAttribute('aria-pressed',String(dashboard));
    opener.setAttribute('aria-pressed',String(!dashboard));
    dashboardButton?.classList.toggle('is-active',dashboard);
    opener.classList.toggle('is-active',!dashboard);
  }
  function syncHeaderHeight(){
    const height=headerHost.getBoundingClientRect?.().height||headerHost.offsetHeight||0;
    if(height>0)document.documentElement.style.setProperty('--crew-shared-header-height',Math.ceil(height)+'px');
  }
  function close(){
    if(modal.hidden)return;
    selectVersion++;openVersion++;
    stopSwitchTimer();
    hideChat();
    requestedRole=null;switchingRole=false;switchFailed=false;selectVersion++;
    stopWorld?.pause?.();
    modal.hidden=true;
    updateHomeView('dashboard');
    panel.style.removeProperty('--crew-keyboard-rise');
    panel.style.removeProperty('--crew-visible-height');
    selectedRoleId=null;selectedRoleName='';rolesSignature='';
    document.body.classList.remove('crew-world-active');
    guardSend(false);
    if(switchRetry)switchRetry.hidden=true;
    // Leave the underlying active Role untouched; restore the tab from which
    // the optional map was opened, without touching ongoing generations.
    if(restoreTab&&previousTab==='crew'&&document.body.dataset.primaryTab==='chat'){
      // Calling the existing primary-tab action is safer than direct dataset
      // mutation, because it also updates navigation and original chat state.
      document.getElementById('crew-back-home-btn')?.click();
    }
    restoreTab=false;previousTab=null;
    const focus=previousFocus;previousFocus=null;
    focus?.focus?.({preventScroll:true});
  }
  async function open(){
    if(!modal.hidden)return;
    const version=++openVersion;
    previousTab=document.body.dataset.primaryTab||null;
    previousFocus=document.activeElement;
    restoreTab=true;
    document.body.classList.add('crew-world-active');
    updateCommandRole();
    syncHeaderHeight();
    modal.hidden=false;
    updateHomeView('map');
    const loading=document.getElementById('world-loading');
    if(loading&&!stopWorld){loading.hidden=false;loading.textContent='正在載入 3D 場景…';}
    opener.focus({preventScroll:true});
    updateKeyboard();
    try{
      await ensureScene();
      if(modal.hidden||openVersion!==version)return;
      if(stopWorld)stopWorld.resume?.();
      else stopWorld=window.mountCrewWorldScene?.()||null;
      // The scene eventually selects its map Role. Until then, use the
      // active Role identity, not a hard-coded first entry.
      const initial=roleSnapshot()?.roles?.find(role=>role.id===window.getCurrentRoleId?.())||
        roleSnapshot()?.roles?.find(role=>role.id===roleSnapshot()?.activeRoleId)||
        roleSnapshot()?.roles?.[0];
      if(initial&&!selectedRoleId)onSelectedRole(initial.id,initial.name);
    }catch(error){
      if(!modal.hidden&&openVersion===version&&loading){
        loading.textContent='無法載入 3D 世界，請重新開啟。'+(error.message||'');
        loading.hidden=false;
      }
    }
  }
  function openChat(roleId=selectedRoleId,{compact=false}={}){
    if(modal.hidden||!roleId||!window.openCrewCockpitRole||!liveRole(roleId))
      return Promise.resolve(false);
    const version=++selectVersion;
    if(!switchingRole)commandDraft=promptInput?.value||'';
    requestedRole=roleId;switchingRole=true;switchFailed=false;
    stopSwitchTimer();
    if(peek)peek.hidden=true; // Never show prior Role results during a switch.
    panel.classList.add('role-switching');
    updateCommandRole();
    // Fast Role switches do not flash any progress UI. Only a slow switch
    // gets a small spinner beside the still-interactive Role picker.
    switchTimer=window.setTimeout(()=>{
      switchTimer=null;
      if(modal.hidden||!switchingRole||version!==selectVersion)return;
      if(switchSpinner)switchSpinner.hidden=false;
      updateCommandRole();
    },200);
    // Serialize navigation. A superseded Role must never mount a stale
    // composer or overwrite the user's unsent global command draft.
    const navigate=roleSwitchQueue.catch(()=>{}).then(async()=>{
      if(modal.hidden||version!==selectVersion)return false;
      try{await window.openCrewCockpitRole(roleId);}
      catch(error){console.warn('[Crew World] Role unavailable:',error);return false;}
      if(modal.hidden||version!==selectVersion||window.getCurrentRoleId?.()!==roleId)
        return false;
      selectedRoleId=roleId;
      selectedRoleName=liveRole(roleId)?.name||roleId;
      roleName.textContent=selectedRoleName;
      putChatInPanel();
      panel.hidden=false;
      panel.classList.remove('expanded');
      if(compact)showCompactChat();
      else{
        panel.classList.remove('compact');
        expandButton.textContent='全螢幕';
        updateKeyboard();
        syncReadAction();
      }
      // selectRole / loadConversationHistory can clear the original textarea.
      // Restore the unsent draft only after the intended Role is verified.
      restoreWorldDraft();
      messages.scrollTop=messages.scrollHeight;
      updatePreview();
      syncCommandActions();
      return true;
    });
    roleSwitchQueue=navigate;
    void navigate.then(ok=>{
      if(version!==selectVersion||modal.hidden)return;
      switchingRole=false;
      switchFailed=!ok;
      stopSwitchTimer();
      panel.classList.remove('role-switching');
      requestedRole=null;
      // A failed navigation must not discard an in-progress unsent draft.
      restoreWorldDraft();
      updateCommandRole();
    });
    return navigate;
  }
  function openCollaboration(roleId,eventId=null){
    const snapshot=window.getCrewCockpitSnapshot?.();
    if(!roleId||!snapshot?.roles?.some(role=>role.id===roleId))return;
    // Reuse existing Role-scoped collaboration evidence (including previews,
    // reply links, delivery receipts). The World owns no parallel messages.
    close();
    window.openCrewCollaboration?.(roleId,eventId);
  }
  function openFullChat(roleId=selectedRoleId){
    if(!roleId||(!modal.hidden&&(switchingRole||switchFailed||
      window.getCurrentRoleId?.()!==roleId)))return;
    restoreTab=false;
    close();
    window.openCrewCockpitRole?.(roleId);
  }
  function onSelectedRole(id,name){
    if(!liveRole(id))return;
    const changed=selectedRoleId!==id;
    selectedRoleId=id;selectedRoleName=name||liveRole(id).name||id;
    updateCommandRole();
    if(modal.hidden)return;
    // Tapping a Role on the map changes the command target immediately,
    // without requiring focus, walking or another chat page.
    if((changed||panel.hidden)&&requestedRole!==id)void openChat(id,{compact:true});
  }
  function toggleExpand(){
    if(panel.hidden)return;
    if(panel.classList.contains('compact')){
      panel.classList.remove('compact');
      panel.classList.remove('expanded');
      expandButton.textContent='全螢幕';
      expandButton.setAttribute('aria-pressed','false');
    }else{
      const expanded=panel.classList.toggle('expanded');
      expandButton.textContent=expanded?'縮小':'展開';
      expandButton.setAttribute('aria-pressed',String(expanded));
    }
    updateKeyboard();
    syncReadAction();
  }
  opener.addEventListener('click',open);
  dashboardButton.addEventListener('click',()=>{if(!modal.hidden)close();else updateHomeView('dashboard');});
  settingsButton?.addEventListener('click',()=>{if(!modal.hidden)close();});
  addRoleButton?.addEventListener('click',()=>{if(!modal.hidden)close();});
  // Both actions stay attached to the ORIGINAL active Role Chat. Switching
  // target cannot open stale Context or another Role's conversation.
  commandContext?.addEventListener('click',()=>{
    syncCommandActions();
    if(commandContext.disabled)return;
    document.getElementById('context-pill')?.click();
  });
  commandRole?.addEventListener('change',()=>{
    const id=commandRole.value;
    if(!liveRole(id)||modal.hidden)return;
    if(stopWorld?.selectRole)stopWorld.selectRole(id);
    else onSelectedRole(id,liveRole(id).name);
  });
  switchRetry?.addEventListener('click',()=>{
    if(modal.hidden||switchingRole||!switchFailed||!liveRole(selectedRoleId))return;
    void openChat(selectedRoleId,{compact:true});
  });
  commandRead?.addEventListener('click',()=>{
    if(switchingRole||switchFailed)return;
    if(panel.hidden){if(selectedRoleId)void openChat(selectedRoleId,{compact:false});return;}
    if(panel.classList.contains('compact'))toggleExpand();
    else collapseChat();
  });
  peek?.addEventListener('click',()=>{
    if(switchingRole||switchFailed)return;
    if(!panel.hidden&&panel.classList.contains('compact')){
      toggleExpand();
      messages.scrollTop=messages.scrollHeight;
    }
  });
  promptInput?.addEventListener('input',()=>{
    if(!modal.hidden)commandDraft=promptInput.value;
  });
  // Native button and Ctrl/Cmd+Enter are both guarded. Keep the textarea
  // enabled so an existing draft remains editable while Role history loads.
  promptInput?.addEventListener('keydown',event=>{
    if(modal.hidden||(!switchingRole&&!switchFailed))return;
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  },true);
  hideButton.addEventListener('click',collapseChat);
  expandButton.addEventListener('click',toggleExpand);
  chatButton?.addEventListener('click',()=>{void openChat();});
  window.addEventListener('resize',updateKeyboard);
  window.addEventListener('resize',syncHeaderHeight);
  if(window.ResizeObserver){const observer=new window.ResizeObserver(syncHeaderHeight);observer.observe(homeHeader);}
  syncHeaderHeight();
  window.visualViewport?.addEventListener('resize',updateKeyboard);
  window.visualViewport?.addEventListener('scroll',updateKeyboard);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!modal.hidden){
      event.preventDefault();
      if(!panel.hidden&&!panel.classList.contains('compact'))collapseChat();
      else close();
    }
  });
  // Exposed only to the scene in this same document, not cross-frame messages.
  window.CrewWorldHost={open,close,hideChat,openChat,openFullChat,onSelectedRole,
    openCollaboration};
})();
