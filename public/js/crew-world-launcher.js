/* Opt-in Crew World viewer: no chat changes, no persistent navigation replacement. */
(() => {
  'use strict';
  const opener=document.getElementById('crew-world-open-btn');
  const modal=document.getElementById('crew-world-modal');
  const frame=document.getElementById('crew-world-frame');
  const closeButton=document.getElementById('crew-world-close-btn');
  if(!opener||!modal||!frame||!closeButton)return;
  let previousFocus=null;
  function open(){
    if(!modal.hidden)return;
    previousFocus=document.activeElement;
    modal.hidden=false;
    frame.src='/world-lab.html';
    closeButton.focus({preventScroll:true});
  }
  function close(){
    if(modal.hidden)return;
    modal.hidden=true;
    // Explicit teardown releases WebGL, polling and 3D scene resources.
    frame.src='about:blank';
    const focus=previousFocus;
    previousFocus=null;
    focus?.focus?.({preventScroll:true});
  }
  opener.addEventListener('click',open);
  closeButton.addEventListener('click',close);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!modal.hidden){event.preventDefault();close();}
    if(event.key==='Tab'&&!modal.hidden&&document.activeElement===closeButton){
      // Embedded iframe owns its own keyboard controls; keep host focus safe.
      event.preventDefault();frame.focus();
    }
  });
  window.addEventListener('message',event=>{
    if(modal.hidden||event.origin!==location.origin||
       event.source!==frame.contentWindow||!event.data||
       typeof event.data!=='object')return;
    if(event.data.type==='crew-world-close'){close();return;}
    if(event.data.type!=='crew-world-open-role')return;
    const id=event.data.roleId;
    if(typeof id!=='string'||!id)return;
    // Only navigate to an existing Role from the host roster; never trust
    // an incoming frame id to create a Role or mutate another conversation.
    const snapshot=window.getCrewCockpitSnapshot?.();
    if(!snapshot?.roles?.some(role=>role.id===id))return;
    close();
    window.openCrewCockpitRole?.(id);
  });
  window.CrewWorldLauncher={open,close};
})();
