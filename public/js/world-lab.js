/* Crew World 3D visual prototype: sample-only states, zero Runtime writes. */
(() => {
  'use strict';
  function mountWorld(){
  let disposed=false,teardown=null,raf=0;
  const cleanups=[];
  function listen(target,event,handler,options){
    if(!target)return;
    target.addEventListener(event,handler,options);
    cleanups.push(()=>target.removeEventListener(event,handler,options));
  }
  function trackedInterval(handler,delay){
    const handle=setInterval(handler,delay);cleanups.push(()=>clearInterval(handle));return handle;
  }
  function trackedTimeout(handler,delay){
    const handle=setTimeout(handler,delay);cleanups.push(()=>clearTimeout(handle));return handle;
  }
  const stage=document.getElementById('world-stage');
  const loading=document.getElementById('world-loading');
  if(loading){loading.textContent='正在建立 3D 世界…';loading.hidden=false;}
  if(!stage)return ()=>{};
  const fail=msg=>{if(loading)loading.textContent=msg;};
  if(!window.THREE || !window.WorldLabKit){fail('缺少本地 3D 資源，請更新 Crew Runtime。');return;}
  const T=window.THREE, kit=window.WorldLabKit, planner=window.WorldLabEvents;
  async function loadStatus() {
    const response=await fetch('/api/crew-status',{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error('Crew status request failed');
    const data=await response.json();
    if(data.success!==true||!Array.isArray(data.roles))throw new Error('Invalid status response');
    return data.roles;
  }
  async function start() {
    let liveRows=null;
    try { liveRows=await loadStatus(); } catch (_) { /* Keep standalone art preview available. */ }
    if(disposed)return;
    const roles=liveRows?.length?kit.makeLiveRoles(liveRows):kit.roles;
    const isLive=Boolean(liveRows?.length);
    let synced=isLive;
    const pill=stage.closest('.world-app')?.querySelector('.world-demo-pill');
    if(pill)pill.textContent=isLive?'真實 Role · '+roles.length+' 位':'示範場景 · 非即時';
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
  let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}
  catch(_){fail('無法啟動 WebGL，請檢查瀏覽器硬體加速。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.08;
  stage.prepend(renderer.domElement);if(loading)loading.hidden=true;
  const scene=new T.Scene();
  const camera=new T.OrthographicCamera(-8,8,8,-8,.1,150);
  const sunlight=new T.DirectionalLight(0xffffff,1.65);
  sunlight.position.set(-7,18,13);
  sunlight.castShadow=true;
  sunlight.shadow.mapSize.set(1024,1024);
  sunlight.shadow.camera.left=-24;sunlight.shadow.camera.right=24;
  sunlight.shadow.camera.top=24;sunlight.shadow.camera.bottom=-24;
  sunlight.shadow.bias=-.0005;
  scene.add(sunlight,new T.HemisphereLight(0xc5e6ff,0x4f527d,1.12));
  const actors=kit.create(scene,roles), hub={x:0,z:-.8};
  const view=new T.Vector3(0,.7,-1.8),direction=new T.Vector3(16,21,25).normalize();
  let width=1,height=1,zoom=1,selected=0,focus=null;
  const labelsHost=document.getElementById('world-labels');
  const rosterHost=document.getElementById('world-roster');
  const liveStates={working:'工作中',waiting:'待處理',idle:'待命',new:'新角色',unknown:'未知'};
  const status=a=>{
    const actual=isLive?(synced?'真實狀態 · '+(liveStates[a.role.state]||'未知'):'狀態未同步 · 未知'):'示範 · 待命';
    return a.mode==='observed-handoff'?actual+' · 已記錄角色交接':
      a.mode==='working'?actual+' · 工作動畫示範':
      a.mode==='handoff'?actual+' · 交接動畫示範':actual;
  };
  function headStatus(actor){
    if(actor.mode==='observed-handoff')
      return {state:'已記錄交接',detail:'來自真實訊息紀錄 · 非送達確認',tone:'handoff'};
    if(!isLive||!synced)return{state:isLive?'狀態未同步':'示範角色',detail:'',tone:'unknown'};
    const role=actor.role;
    const state=liveStates[role.state]||'未知';
    const detail=role.state==='working'&&role.workTitle
      ?'目前對話：'+role.workTitle
      :role.state==='waiting'&&role.attention
        ?'待處理 '+role.attention+' 項':'';
    return{state,detail,tone:role.state};
  }
  const labels=roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    button.className='world-label';
    const title=document.createElement('b');title.textContent=role.short;
    const state=document.createElement('small');state.textContent='示範 · 待命';
    const detail=document.createElement('span');detail.className='world-label-detail';
    const speech=document.createElement('span');speech.className='world-speech-bubble';
    speech.hidden=true;
    button.append(speech,title,state,detail);listen(button,'click',()=>select(index));
    listen(speech,'click',event=>{
      event.preventDefault();event.stopPropagation();
      hideSpeech(index,true);
    });
    button.style.setProperty('--world-role-color',role.color);
    labelsHost.appendChild(button);return{button,state,detail,speech};
  });
  const roster=roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    const dot=document.createElement('span');dot.style.background=role.color;
    button.append(dot,document.createTextNode(role.short));
    listen(button,'click',()=>select(index,true));
    rosterHost.appendChild(button);return button;
  });
  const portrait=document.getElementById('world-portrait');
  let chat=null;
  const openRole=document.getElementById('world-open-role');
  if(openRole)openRole.hidden=!isLive;
  const inlineChat=document.getElementById('world-chat-open');
  if(inlineChat)inlineChat.hidden=!isLive;
  const actionRow=document.querySelector('.world-action-row');
  // Real usage emphasizes talking and opening conversations; demo controls
  // remain available only in offline art-preview mode.
  if(isLive){
    document.getElementById('world-work').hidden=true;
    document.getElementById('world-handoff').hidden=true;
  }
  if(actionRow)actionRow.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
  function updateInfo(){
    const actor=actors[selected],role=actor.role;
    document.getElementById('world-role-name').textContent=role.name;
    document.getElementById('world-role-state').textContent=status(actor);
    document.getElementById('world-role-description').textContent=role.description;
    portrait.textContent=role.initial;portrait.style.background=role.coat;
    labels.forEach((entry,i)=>{
      const head=headStatus(actors[i]);
      entry.button.dataset.selected=String(i===selected);
      entry.button.dataset.tone=head.tone;
      entry.state.textContent=head.state;
      entry.detail.textContent=head.detail;
      entry.button.title=roles[i].name+' · '+head.state+(head.detail?' · '+head.detail:'');
      entry.button.setAttribute('aria-label',roles[i].name+' · '+head.state+
        (entry.speech.hidden?'':' · 最新回覆：'+entry.speech.textContent));
    });
    chat?.sync();
    roster.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===selected)));
  }
  function cameraSync(){
    const aspect=width/Math.max(1,height);
    const vertical=Math.max(14.8,24.5/aspect)/zoom;
    camera.left=-vertical*aspect/2;
    camera.right=vertical*aspect/2;
    camera.top=vertical/2;
    camera.bottom=-vertical/2;
    camera.position.copy(view).addScaledVector(direction,37);
    camera.lookAt(view);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  }
  function resize(){
    width=Math.max(1,stage.clientWidth);height=Math.max(1,stage.clientHeight);
    renderer.setSize(width,height,false);cameraSync();
  }
  function panTo(x,z,newZoom){
    if(reduced){view.set(x,.7,z);zoom=newZoom;cameraSync();return;}
    focus={start:performance.now(),fromX:view.x,fromZ:view.z,toX:x,toZ:z,
      fromZoom:zoom,toZoom:newZoom};
  }
  function select(index,center=false){
    if(index<0||index>=actors.length)return;
    selected=index;updateInfo();
    window.CrewWorldHost?.onSelectedRole?.(roles[index].id,roles[index].name);
    if(center){
      const role=roles[index];
      panTo(role.islandX,role.islandZ,width<700?2.4:1.72);
    }
  }
  const toast=document.getElementById('world-toast');
  let toastTimer;
  function notify(message){
    toast.textContent=message;toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer=trackedTimeout(()=>toast.classList.remove('visible'),2400);
  }
  listen(document.getElementById('world-focus'),'click',()=>{
    select(selected,true);notify('已聚焦 '+roles[selected].short);
  });
  listen(document.getElementById('world-work'),'click',()=>{
    const a=actors[selected];a.mode='working';a.expires=performance.now()+6500;
    a.root.position.set(a.role.x,.43,a.role.z);a.root.rotation.y=0;
    updateInfo();notify('僅播放工作動畫，不會啟動真實任務');
  });
  listen(document.getElementById('world-handoff'),'click',()=>{
    const a=actors[selected];a.mode='handoff';a.expires=performance.now()+8000;
    updateInfo();notify('僅播放交接動畫，不會發送 Role 訊息');
  });
  function openConversation(roleId){
    if(window.CrewWorldHost){
      window.CrewWorldHost.openFullChat(roleId);
    }else if(window.parent!==window){
      window.parent.postMessage({type:'crew-world-open-role',roleId},location.origin);
    }else{
      notify('請返回小隊頁查看 '+(roles.find(role=>role.id===roleId)?.name||'Role')+' 的完整對話');
    }
  }
  chat=window.WorldLabChat?.mount({
    getSelected:()=>isLive?roles[selected]:null,
    openConversation,
    fetcher:window.fetch.bind(window),
    cryptoProvider:window.crypto,
    document
  })||null;
  listen(openRole,'click',()=>{
    if(!isLive)return;
    openConversation(roles[selected].id);
  });
  const back=document.getElementById('world-back');
  listen(back,'click',event=>{
    if(window.CrewWorldHost){
      event.preventDefault();window.CrewWorldHost.close();return;
    }
    if(window.parent===window)return;
    event.preventDefault();
    window.parent.postMessage({type:'crew-world-close'},location.origin);
  });
  async function synchronize(){
    if(!isLive||document.hidden)return;
    try{
      const next=await loadStatus();
      if(disposed)return;
      const byId=new Map(next.map(item=>[item.roleId,item]));
      for(const actor of actors){
        const item=byId.get(actor.role.id);
        actor.role.state=item&&['working','waiting','idle','new'].includes(item.state)?item.state:'unknown';
        actor.role.workTitle=actor.role.state==='working'&&typeof item?.currentWork?.title==='string'
          ?item.currentWork.title.slice(0,75):'';
        actor.role.attention=Number.isSafeInteger(item?.attentionCount)
          ?Math.max(0,Math.min(999,item.attentionCount)):0;
      }
      synced=true;
      if(pill)pill.textContent=next.length===roles.length?'真實 Role · '+roles.length+' 位':'Role 已變更 · 重新開啟更新';
    }catch(_){
      if(disposed)return;
      synced=false;
      for(const actor of actors){actor.role.state='unknown';actor.role.workTitle='';actor.role.attention=0;}
      if(pill)pill.textContent='Runtime 未同步';
    }
    updateInfo();
  }
  const speechSeen=new Map(),speechDismissed=new Set(),speechTimers=new Map();
  function hideSpeech(index,dismissed=false){
    const entry=labels[index],signature=speechSeen.get(roles[index].id);
    entry.speech.hidden=true;
    if(dismissed&&signature){
      speechDismissed.add(signature);
      if(speechDismissed.size>64)speechDismissed.delete(speechDismissed.values().next().value);
    }
    const timer=speechTimers.get(roles[index].id);
    if(timer){clearTimeout(timer);speechTimers.delete(roles[index].id);}
    const head=headStatus(actors[index]);
    entry.button.setAttribute('aria-label',roles[index].name+' · '+head.state);
  }
  let speechRequest=false;
  async function refreshSpeechBubbles(){
    if(!isLive||document.hidden||speechRequest)return;
    speechRequest=true;
    try{
      await Promise.all(roles.map(async(role,index)=>{
        try{
          const response=await fetch('/api/world-chat-latest?role_id='+encodeURIComponent(role.id),{
            cache:'no-store',credentials:'same-origin'
          });
          if(!response.ok)return;
          const data=await response.json();
          if(disposed||data.success!==true||data.roleId!==role.id)return;
          const entry=labels[index];
          const text=typeof data.message?.text==='string'?data.message.text.trim():'';
          if(!text){entry.speech.textContent='';entry.speech.hidden=true;return;}
          const signature=role.id+':'+String(data.message.id||'')+':'+
            String(data.message.timestamp||'')+':'+text.slice(0,1200);
          const previous=speechSeen.get(role.id);
          speechSeen.set(role.id,signature);
          if(previous===signature||speechDismissed.has(signature))return;
          const receivedAt=Date.parse(data.message.timestamp||'');
          const age=Number.isFinite(receivedAt)?Math.max(0,Date.now()-receivedAt):0;
          const remaining=300000-age;
          if(remaining<=0||(previous===undefined&&!Number.isFinite(receivedAt)))return;
          const compact=text.replace(/\s+/g,' ');
          entry.speech.textContent=compact.length>240?compact.slice(0,239)+'…':compact;
          entry.speech.title=text;
          entry.speech.hidden=false;
          const head=headStatus(actors[index]);
          entry.button.setAttribute('aria-label',role.name+' · '+head.state+' · 最新回覆：'+entry.speech.textContent);
          const oldTimer=speechTimers.get(role.id);
          if(oldTimer)clearTimeout(oldTimer);
          speechTimers.set(role.id,trackedTimeout(()=>hideSpeech(index),remaining));
        }catch(_){/* Keep the last verified bubble when one Role is temporarily unavailable. */}
      }));
    }finally{speechRequest=false;}
  }
  // An observed handoff is a saved message record, NOT confirmation of delivery.
  // Initial polling establishes a baseline; no old message is ever replayed.
  let seenEvents=null,eventRequest=false;
  const pendingTransitions=[];
  async function observeHandoffs(){
    if(!isLive||!synced||!planner||document.hidden||eventRequest)return;
    eventRequest=true;
    try{
      const response=await fetch('/api/crew-room-events',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error('No Room event metadata');
      const data=await response.json();
      if(data.success!==true||!Array.isArray(data.events))throw new Error('Room events invalid');
      if(disposed)return;
      const result=planner.observe(data.events,seenEvents,roles.map(role=>role.id),Date.now());
      seenEvents=result.seenIds;
      for(const event of result.arrivals){
        if(pendingTransitions.length>=3)break;
        pendingTransitions.push(event);
      }
    }catch(_){
      // If tracking was interrupted, the next success resets baseline rather than
      // interpreting historical records as newly sent messages.
      seenEvents=null;pendingTransitions.length=0;
    }finally{eventRequest=false;}
  }
  function runRecordedHandoff(now){
    if(!pendingTransitions.length||!synced)return;
    const event=pendingTransitions[0];
    const actor=actors.find(a=>a.role.id===event.fromRoleId);
    const recipient=actors.find(a=>a.role.id===event.toRoleId);
    if(!actor||!recipient){pendingTransitions.shift();return;}
    if(actor.mode!=='idle')return;
    pendingTransitions.shift();
    if(Date.now()-event.createdAt>45000)return;
    actor.mode='observed-handoff';
    actor.handoff={start:now,toId:event.toRoleId,toX:recipient.role.x,toZ:recipient.role.z};
    actor.expires=now+(reduced?2700:8600);
    updateInfo();
  }
  if(isLive){
    // First fetch is a baseline only; subsequent newly saved events trigger motion.
    void observeHandoffs();
    void refreshSpeechBubbles();
    trackedInterval(()=>{if(!disposed&&!document.hidden)void synchronize();},7000);
    trackedInterval(()=>{if(!disposed&&!document.hidden)void observeHandoffs();},3200);
    trackedInterval(()=>{if(!disposed&&!document.hidden)void refreshSpeechBubbles();},9000);
    listen(document,'visibilitychange',()=>{
      if(document.hidden){seenEvents=null;pendingTransitions.length=0;}
      else{void synchronize();void observeHandoffs();void refreshSpeechBubbles();}
    });
  }
  listen(document.getElementById('world-reset'),'click',()=>{
    panTo(0,-1.8,1);notify('返回全景');
  });
  function setZoom(value){
    zoom=T.MathUtils.clamp(value,.65,3.5);cameraSync();
  }
  listen(document.getElementById('world-zoom-in'),'click',()=>setZoom(zoom*1.2));
  listen(document.getElementById('world-zoom-out'),'click',()=>setZoom(zoom/1.2));
  listen(stage,'wheel',event=>{
    event.preventDefault();focus=null;setZoom(zoom*(event.deltaY<0?1.1:.9));
  },{passive:false});

  // Pointer map supports single-finger drag, pinch zoom, and raycast tap.
  const fingers=new Map();
  let pinch=0,tap=null;
  listen(stage,'pointerdown',event=>{
    if(event.target.closest?.('.world-label'))return;
    stage.setPointerCapture?.(event.pointerId);
    fingers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(fingers.size===1)tap={x:event.clientX,y:event.clientY,at:performance.now(),moved:false};
    else{tap=null;pinch=0;}
    focus=null;
  });
  listen(stage,'pointermove',event=>{
    const last=fingers.get(event.pointerId);
    if(!last)return;
    const dx=event.clientX-last.x,dy=event.clientY-last.y;
    fingers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(fingers.size===2){
      const pts=[...fingers.values()];
      const next=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      if(pinch>0)setZoom(zoom*next/pinch);
      pinch=next;return;
    }
    if(fingers.size!==1)return;
    if(tap&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>6)tap.moved=true;
    if(tap?.moved){
      stage.classList.add('dragging');
      const unit=(camera.top-camera.bottom)/height;
      const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
      const up=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
      right.y=0;up.y=0;right.normalize();up.normalize();
      view.addScaledVector(right,-dx*unit).addScaledVector(up,dy*unit);
      view.x=T.MathUtils.clamp(view.x,-13,13);
      view.z=T.MathUtils.clamp(view.z,-16,12);
      cameraSync();
    }
  });
  const ray=new T.Raycaster();
  function pick(x,y){
    const b=renderer.domElement.getBoundingClientRect();
    const point=new T.Vector2((x-b.left)/b.width*2-1,-(y-b.top)/b.height*2+1);
    ray.setFromCamera(point,camera);
    const hits=ray.intersectObjects(actors.map(a=>a.root),true);
    const hit=hits.find(h=>h.object.userData.roleId);
    if(hit){
      const index=roles.findIndex(r=>r.id===hit.object.userData.roleId);
      select(index,true);
    }
  }
  function pointerEnd(event){
    if(fingers.size===1&&fingers.has(event.pointerId)&&tap&&!tap.moved&&
       performance.now()-tap.at<500)pick(event.clientX,event.clientY);
    fingers.delete(event.pointerId);
    if(fingers.size<2)pinch=0;
    if(!fingers.size){tap=null;stage.classList.remove('dragging');}
  }
  listen(stage,'pointerup',pointerEnd);
  listen(stage,'pointercancel',pointerEnd);
  listen(stage,'lostpointercapture',pointerEnd);
  listen(window,'resize',resize);
  if(window.ResizeObserver){const observer=new ResizeObserver(resize);observer.observe(stage);cleanups.push(()=>observer.disconnect());}
  listen(stage,'webglcontextlost',event=>{
    event.preventDefault();fail('3D 繪圖環境中斷，請重新開啟頁面。');
  });

  let elapsed=0,last=performance.now();
  function frame(now){
    if(disposed)return;
    raf=requestAnimationFrame(frame);
    const delta=Math.min((now-last)/1000,.06);last=now;
    if(document.hidden)return;
    elapsed+=delta;
    if(focus){
      const t=Math.min(1,(now-focus.start)/650),ease=1-Math.pow(1-t,3);
      view.x=T.MathUtils.lerp(focus.fromX,focus.toX,ease);
      view.z=T.MathUtils.lerp(focus.fromZ,focus.toZ,ease);
      zoom=T.MathUtils.lerp(focus.fromZoom,focus.toZoom,ease);
      cameraSync();
      if(t===1)focus=null;
    }
    if(isLive)runRecordedHandoff(now);
    actors.forEach((actor,index)=>{
      if(now>=actor.expires&&actor.mode!=='idle'){
        actor.mode='idle';actor.handoff=null;
        actor.root.position.set(actor.role.x,.43,actor.role.z);
        actor.root.rotation.y=0;updateInfo();
      }
      const recorded=actor.mode==='observed-handoff';
      const moving=actor.mode==='handoff'||recorded;
      const working=actor.mode==='working'||(isLive&&synced&&actor.mode==='idle'&&actor.role.state==='working');
      if(recorded&&!reduced&&actor.handoff){
        const h=actor.handoff;
        const progress=T.MathUtils.clamp((now-h.start)/8600,0,1);
        const outward=progress<.46?progress/.46:progress<.60?1:1-(progress-.60)/.40;
        const point=planner.trail({x:actor.role.x,z:actor.role.z},
          {x:h.toX,z:h.toZ},outward,hub);
        const dx=point.x-actor.root.position.x,dz=point.z-actor.root.position.z;
        actor.root.position.set(point.x,.43,point.z);
        if(Math.hypot(dx,dz)>.001)actor.root.rotation.y=Math.atan2(dx,dz);
      }
      if(moving&&!reduced){
        const progress=T.MathUtils.clamp(1-(actor.expires-now)/8000,0,1);
        const route=progress<.5?progress*2:(1-progress)*2;
        const ease=route*route*(3-2*route);
        actor.root.position.set(
          T.MathUtils.lerp(actor.role.x,hub.x,ease),.43,
          T.MathUtils.lerp(actor.role.z,hub.z,ease));
        const heading=Math.atan2(hub.x-actor.role.x,hub.z-actor.role.z);
        actor.root.rotation.y=progress<.5?heading:heading+Math.PI;
      }
      const phase=elapsed*(moving?11:working?8:2)+index;
      actor.body.position.y=reduced?0:moving?Math.abs(Math.sin(phase))*.14:
        working?Math.sin(phase)*.022:Math.sin(phase)*.035;
      actor.body.rotation.z=reduced?0:Math.sin(phase*.6)*.025;
      actor.arms[0].rotation.x=reduced?0:moving?Math.sin(phase)*.65:
        working?Math.sin(phase)*.3:0;
      actor.arms[1].rotation.x=reduced?0:moving?-Math.sin(phase)*.65:
        working?-Math.sin(phase+1)*.27:0;
      actor.legs.forEach(({mesh,side})=>{
        mesh.rotation.x=reduced?0:moving?Math.sin(phase)*side*.45:0;
      });
    });
    labels.forEach(({button},index)=>{
      const projected=actors[index].root.position.clone().add(new T.Vector3(0,3.3,0)).project(camera);
      const x=(projected.x+1)/2*width,y=(-projected.y+1)/2*height;
      button.style.display=projected.z<-1||projected.z>1||x<12||x>width-12||
        y<100||y>height-115?'none':'';
      button.style.left=x+'px';button.style.top=y+'px';
    });
    renderer.render(scene,camera);
  }
  updateInfo();
  window.CrewWorldHost?.onSelectedRole?.(roles[selected].id,roles[selected].name);
  resize();frame(performance.now());
  teardown=()=>{
    clearTimeout(toastTimer);
    for(const timer of speechTimers.values())clearTimeout(timer);
    cancelAnimationFrame(raf);
    for(const cleanup of cleanups.splice(0).reverse())cleanup();
    scene.traverse(object=>{
      object.geometry?.dispose?.();
      if(Array.isArray(object.material))object.material.forEach(m=>m?.dispose?.());
      else object.material?.dispose?.();
    });
    renderer.renderLists?.dispose?.();
    renderer.dispose();renderer.forceContextLoss?.();
    renderer.domElement.remove();
    labelsHost.replaceChildren();rosterHost.replaceChildren();
  };
  }
  void start().catch(()=>{if(!disposed)fail('無法建立 3D 世界，請重新開啟頁面。');});
  return ()=>{
    disposed=true;teardown?.();teardown=null;
    for(const cleanup of cleanups.splice(0).reverse())cleanup();
  };
  }
  window.mountCrewWorldScene=mountWorld;
  if(document.body?.firstElementChild?.id==='world-app')mountWorld();
})();
