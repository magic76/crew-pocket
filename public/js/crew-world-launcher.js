/* One-WebView Crew World. The ORIGINAL Chat DOM is temporarily moved into
 * an overlay sheet, never cloned: one message renderer, input, SSE and Role runtime.
 */
(() => {
  'use strict';
  const opener=document.getElementById('crew-world-open-btn');
  const dashboardButton=document.getElementById('crew-home-dashboard-btn');
  const worldDashboardButton=document.getElementById('crew-world-dashboard-btn');
  const worldMapButton=document.getElementById('crew-world-map-btn');
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
  const focusBar=document.getElementById('crew-world-focus-bar');
  const focusBack=document.getElementById('crew-world-focus-back');
  const focusName=document.getElementById('crew-world-focus-name');
  const focusFull=document.getElementById('crew-world-focus-full');
  if(!opener||!modal||!worldDashboardButton||!panel||!messagesSlot||!composerSlot||
     !messages||!composer||!hideButton||!expandButton)return;
  let restoreMessages=null,restoreComposer=null;
  let stopWorld=null,previousFocus=null,selectedRoleId=null,selectedRoleName='';
  let selectVersion=0,previousTab=null,restoreTab=false,openVersion=0;
  let focusedRoleId=null;
  let sceneScripts=null;
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
        if(!window.WorldLabNavigation)await loadScript('/js/world-lab-navigation.js');
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
  function hideChat(){
    panel.hidden=true;panel.classList.remove('expanded','compact','keyboard-open');
    expandButton.textContent='展開';
    expandButton.setAttribute('aria-pressed','false');
    hideButton.textContent='收合';
    putChatBack();
    // We preserve the active Role and its stream, only move DOM visibility.
    window.requestAnimationFrame(()=>{
      document.getElementById('world-stage')?.focus?.({preventScroll:true});
    });
  }
  function exitFocus(){
    if(!focusedRoleId)return;
    focusedRoleId=null;
    modal.classList.remove('is-role-focused');
    if(focusBar)focusBar.hidden=true;
    selectVersion++; // Ignore an unfinished Role navigation.
    hideChat();
  }
  function showCompactChat(){
    if(panel.hidden)return;
    panel.classList.remove('expanded');
    panel.classList.add('compact');
    expandButton.textContent='展開';
    expandButton.setAttribute('aria-pressed','false');
    hideButton.textContent='收合';
    updateKeyboard();
  }
  function focusRole(roleId,name){
    if(modal.hidden||!roleId)return;
    const changed=focusedRoleId!==roleId;
    focusedRoleId=roleId;
    modal.classList.add('is-role-focused');
    if(focusBar)focusBar.hidden=false;
    if(focusName)focusName.textContent=name||roleId;
    const sameActiveChat=!panel.hidden&&window.getCurrentRoleId?.()===roleId;
    if(changed&&!sameActiveChat)hideChat();
    if(sameActiveChat){
      showCompactChat(); // Reuse the already mounted Role Chat synchronously.
    }else{
      void openChat(roleId,{compact:true});
    }
  }
  function collapseChat(){
    if(focusedRoleId)showCompactChat();
    else hideChat();
  }
  function updateHomeView(mode){
    const dashboard=mode==='dashboard';
    dashboardButton?.setAttribute('aria-pressed',String(dashboard));
    opener.setAttribute('aria-pressed',String(!dashboard));
    dashboardButton?.classList.toggle('is-active',dashboard);
    opener.classList.toggle('is-active',!dashboard);
    worldDashboardButton?.setAttribute('aria-pressed',String(dashboard));
    worldMapButton?.setAttribute('aria-pressed',String(!dashboard));
    worldDashboardButton?.classList.toggle('is-active',dashboard);
    worldMapButton?.classList.toggle('is-active',!dashboard);
  }
  function close(){
    if(modal.hidden)return;
    selectVersion++;openVersion++;
    if(focusedRoleId)exitFocus();else hideChat();
    stopWorld?.();stopWorld=null;
    modal.hidden=true;
    updateHomeView('dashboard');
    panel.style.removeProperty('--crew-keyboard-rise');
    panel.style.removeProperty('--crew-visible-height');
    selectedRoleId=null;selectedRoleName='';
    document.body.classList.remove('crew-world-active');
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
    modal.hidden=false;
    focusedRoleId=null;
    modal.classList.remove('is-role-focused');
    if(focusBar)focusBar.hidden=true;
    updateHomeView('map');
    document.body.classList.add('crew-world-active');
    const loading=document.getElementById('world-loading');
    if(loading){loading.hidden=false;loading.textContent='正在載入 3D 場景…';}
    worldDashboardButton.focus({preventScroll:true});
    updateKeyboard();
    try{
      await ensureScene();
      if(modal.hidden||openVersion!==version)return;
      stopWorld=window.mountCrewWorldScene?.()||null;
    }catch(error){
      if(!modal.hidden&&openVersion===version&&loading)
        loading.textContent='無法載入 3D 世界，請重新開啟。'+(error.message||'');
    }
  }
  async function openChat(roleId=selectedRoleId,{compact=false}={}){
    if(modal.hidden||!roleId||!window.openCrewCockpitRole)return;
    const snapshot=window.getCrewCockpitSnapshot?.();
    if(!snapshot?.roles?.some(role=>role.id===roleId))return;
    const version=++selectVersion;
    // This is the *same* Role navigation used by the normal Chat tab.
    try{
      await window.openCrewCockpitRole(roleId);
    }catch(error){
      console.warn('[Crew World] Could not open Role chat:',error);
      return;
    }
    if(modal.hidden||selectVersion!==version)return;
    selectedRoleId=roleId;
    selectedRoleName=snapshot.roles.find(role=>role.id===roleId)?.name||roleId;
    roleName.textContent=selectedRoleName;
    putChatInPanel();
    panel.hidden=false;
    panel.classList.remove('expanded','compact');
    expandButton.textContent='展開';
    expandButton.setAttribute('aria-pressed','false');
    hideButton.textContent='收合';
    if(compact&&focusedRoleId===roleId)showCompactChat();
    else updateKeyboard();
    messages.scrollTop=messages.scrollHeight;
  }
  function openFullChat(roleId=selectedRoleId){
    if(!roleId)return;
    restoreTab=false;
    close();
    window.openCrewCockpitRole?.(roleId);
  }
  function onSelectedRole(id,name){
    if(selectedRoleId!==id)selectVersion++; // invalidate pending async openChat for prior role
    selectedRoleId=id;selectedRoleName=name||id;
    if(!panel.hidden&&window.getCurrentRoleId?.()!==id)hideChat();
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
      expandButton.textContent=expanded?'縮小':(focusedRoleId?'全螢幕':'展開');
      expandButton.setAttribute('aria-pressed',String(expanded));
    }
    updateKeyboard();
  }
  opener.addEventListener('click',open);
  dashboardButton?.addEventListener('click',()=>updateHomeView('dashboard'));
  worldDashboardButton?.addEventListener('click',close);
  worldMapButton?.addEventListener('click',()=>updateHomeView('map'));
  focusBack?.addEventListener('click',()=>document.getElementById('world-reset')?.click());
  focusFull?.addEventListener('click',()=>openFullChat(focusedRoleId));
  hideButton.addEventListener('click',collapseChat);
  expandButton.addEventListener('click',toggleExpand);
  chatButton?.addEventListener('click',()=>{void openChat();});
  window.addEventListener('resize',updateKeyboard);
  window.visualViewport?.addEventListener('resize',updateKeyboard);
  window.visualViewport?.addEventListener('scroll',updateKeyboard);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!modal.hidden){
      event.preventDefault();
      if(!panel.hidden&&!panel.classList.contains('compact'))collapseChat();
      else if(focusedRoleId)document.getElementById('world-reset')?.click();
      else close();
    }
  });
  // Exposed only to the scene in this same document, not cross-frame messages.
  window.CrewWorldHost={open,close,hideChat,openChat,openFullChat,onSelectedRole,
    focusRole,exitFocus,isRoleFocused:id=>focusedRoleId===id,
    isFocusActive:()=>Boolean(focusedRoleId)};
})();
