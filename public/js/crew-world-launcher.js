/* One-WebView Crew World. The ORIGINAL Chat DOM is temporarily moved into
 * an overlay sheet, never cloned: one message renderer, input, SSE and Role runtime.
 */
(() => {
  'use strict';
  const opener=document.getElementById('crew-world-open-btn');
  const modal=document.getElementById('crew-world-modal');
  const closeButton=document.getElementById('crew-world-close-btn');
  const panel=document.getElementById('crew-world-chat-panel');
  const messagesSlot=document.getElementById('crew-world-chat-messages-slot');
  const composerSlot=document.getElementById('crew-world-chat-composer-slot');
  const messages=document.getElementById('messages-container');
  const composer=document.getElementById('chat-composer-footer');
  const hideButton=document.getElementById('crew-world-chat-hide');
  const expandButton=document.getElementById('crew-world-chat-expand');
  const chatButton=document.getElementById('world-chat-open');
  const roleName=document.getElementById('crew-world-chat-role-name');
  if(!opener||!modal||!panel||!messagesSlot||!composerSlot||
     !messages||!composer||!closeButton||!hideButton||!expandButton)return;
  let restoreMessages=null,restoreComposer=null;
  let stopWorld=null,previousFocus=null,selectedRoleId=null,selectedRoleName='';
  let selectVersion=0,previousTab=null,restoreTab=false;
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
  }
  function hideChat(){
    panel.hidden=true;panel.classList.remove('expanded');
    expandButton.textContent='展開';
    putChatBack();
    // We preserve the active Role and its stream, only move DOM visibility.
    window.requestAnimationFrame(()=>{
      document.getElementById('world-stage')?.focus?.({preventScroll:true});
    });
  }
  function close(){
    if(modal.hidden)return;
    selectVersion++;
    hideChat();
    stopWorld?.();stopWorld=null;
    modal.hidden=true;
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
  function open(){
    if(!modal.hidden)return;
    previousTab=document.body.dataset.primaryTab||null;
    previousFocus=document.activeElement;
    restoreTab=true;
    modal.hidden=false;
    document.body.classList.add('crew-world-active');
    stopWorld=window.mountCrewWorldScene?.()||null;
    closeButton.focus({preventScroll:true});
    updateKeyboard();
  }
  async function openChat(roleId=selectedRoleId){
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
    updateKeyboard();
    messages.scrollTop=messages.scrollHeight;
  }
  function openFullChat(roleId=selectedRoleId){
    if(!roleId)return;
    restoreTab=false;
    close();
    window.openCrewCockpitRole?.(roleId);
  }
  function onSelectedRole(id,name){
    selectedRoleId=id;selectedRoleName=name||id;
    if(!panel.hidden&&window.getCurrentRoleId?.()!==id)hideChat();
  }
  function toggleExpand(){
    if(panel.hidden)return;
    const expanded=panel.classList.toggle('expanded');
    expandButton.textContent=expanded?'縮小':'展開';
    expandButton.setAttribute('aria-pressed',String(expanded));
    updateKeyboard();
  }
  opener.addEventListener('click',open);
  closeButton.addEventListener('click',close);
  hideButton.addEventListener('click',hideChat);
  expandButton.addEventListener('click',toggleExpand);
  chatButton?.addEventListener('click',()=>{void openChat();});
  window.addEventListener('resize',updateKeyboard);
  window.visualViewport?.addEventListener('resize',updateKeyboard);
  window.visualViewport?.addEventListener('scroll',updateKeyboard);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!modal.hidden){
      event.preventDefault();
      if(!panel.hidden)hideChat();else close();
    }
  });
  // Exposed only to the scene in this same document, not cross-frame messages.
  window.CrewWorldHost={open,close,hideChat,openChat,openFullChat,onSelectedRole};
})();
