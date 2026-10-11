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
  const T=window.THREE, kit=window.WorldLabKit, planner=window.WorldLabEvents, navigation=window.WorldLabNavigation;
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
    const originalCount=liveRows?.length||roles.length;
    const districtMap=new Map();
    for(const role of roles){
      const key=role.districtId||role.id;
      if(!districtMap.has(key))districtMap.set(key,[]);
      districtMap.get(key).push(role);
    }
    const districts=[...districtMap.values()];
    const isLive=Boolean(liveRows?.length);
    let synced=isLive;
    const pill=stage.closest('.world-app')?.querySelector('.world-demo-pill');
    const statusSummary=()=>originalCount>roles.length
      ?'地圖 '+roles.length+'/'+originalCount+' 位 · '+districts.length+' 區'
      :'地圖 '+roles.length+' 位 · '+districts.length+' 區';
    if(pill)pill.textContent=isLive?statusSummary():'示範場景 · 非即時';
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
  const actors=kit.create(scene,roles);
  const roadVisuals=actors.roadVisuals||[];
  // This is the same immutable lot/frontage geometry used for mesh rotation
  // and Role standing positions. Navigation never invents parallel roads.
  const townLots=navigation?.uniqueLots(roles)||[];
  const firstLot=townLots[0];
  const visitor=firstLot&&navigation&&kit.createPlayer
    ?kit.createPlayer(scene,{x:roles[0].x,z:roles[0].z}):null;
  let visitorDistrict=firstLot?.id||null;
  let walking=null,queuedDestination=null,explore=true,followPlayer=false;
  const exploreToggle=document.getElementById('world-explore-toggle');
  const hint=stage.closest('.world-app')?.querySelector('.world-hint');
  function updateExploreUI(){
    if(exploreToggle){
      exploreToggle.setAttribute('aria-pressed',String(explore));
      exploreToggle.textContent=explore?'探索中':'瀏覽中';
      exploreToggle.disabled=Boolean(walking);
    }
    if(hint)hint.textContent=explore
      ?'點角色走近聊天 · 點街道移動 · 拖曳地圖 · 雙指縮放'
      :'點角色定位 · 拖曳地圖 · 雙指縮放';
  }
  updateExploreUI();
  listen(exploreToggle,'click',()=>{
    if(walking)return;
    explore=!explore;
    followPlayer=false;updateExploreUI();
  });
  const activePlanes=[];
  const arrivalFlashes=[];
  const MAX_ACTIVE_PLANES=3;
  const MAX_PENDING_MESSAGES=6;
  function launchPaperPlane(sender,recipient,now,kind='handoff'){
    if(activePlanes.length>=MAX_ACTIVE_PLANES||!planner?.paperFlightPoint||
       !kit?.createPaperPlane)return false;
    const from={x:sender.role.x,y:3.25,z:sender.role.z};
    const to={x:recipient.role.x,y:3.25,z:recipient.role.z};
    const duration=reduced?760:planner.paperFlightDuration(from,to);
    const plane=kit.createPaperPlane(scene,kind);
    plane.root.scale.setScalar(Math.max(.80,Math.min(1.55,worldExtent/22)));
    const flight={from,to,startedAt:now,duration,plane,kind,recipient};
    activePlanes.push(flight);
    // Digital message only: the paper plane doesn't require the sender
    // to travel or turn on unrelated roads and never implies delivery.
    return true;
  }
  function showArrivalCue(flight,now){
    if(reduced)return;
    const ring=new T.Mesh(new T.TorusGeometry(.67,.065,5,20),
      new T.MeshBasicMaterial({
        color:flight.kind==='reply'?'#7af1b1':'#88dbff',
        transparent:true,opacity:.48,depthWrite:false
      }));
    ring.rotation.x=-Math.PI/2;
    ring.position.set(flight.to.x,.64,flight.to.z);
    scene.add(ring);
    arrivalFlashes.push({ring,startedAt:now,duration:460});
  }
  function updateFlights(now){
    for(let i=activePlanes.length-1;i>=0;i--){
      const flight=activePlanes[i];
      const elapsed=Math.max(0,now-flight.startedAt);
      if(elapsed>=flight.duration){
        activePlanes.splice(i,1);
        kit.disposePaperPlane?.(scene,flight.plane);
        if(flight.recipient)flight.recipient.reactionUntil=now+(reduced?550:1350);
        showArrivalCue(flight,now);
        continue;
      }
      const t=elapsed/flight.duration;
      const point=planner.paperFlightPoint(flight.from,flight.to,reduced?.5:t);
      const next=planner.paperFlightPoint(flight.from,flight.to,Math.min(1,t+.015));
      const prev=planner.paperFlightPoint(flight.from,flight.to,Math.max(0,t-.015));
      const dx=next.x-prev.x,dz=next.z-prev.z,dy=next.y-prev.y;
      const root=flight.plane.root;
      root.position.set(point.x,point.y,point.z);
      root.rotation.y=Math.atan2(dx,dz);
      root.rotation.x=reduced?0:-Math.atan2(dy,Math.hypot(dx,dz));
      root.rotation.z=reduced?0:Math.sin(Math.PI*t*2)*.13;
      for(let j=0;j<flight.plane.trails.length;j++){
        const bead=flight.plane.trails[j];
        const behind=t-(j+1)*.033;
        const visible=!reduced&&behind>0;
        bead.visible=visible;
        if(!visible)continue;
        const tail=planner.paperFlightPoint(flight.from,flight.to,behind);
        bead.position.set(tail.x,tail.y,tail.z);
        bead.material.opacity=(.23-j*.055)*Math.sin(Math.PI*t);
      }
    }
    for(let i=arrivalFlashes.length-1;i>=0;i--){
      const cue=arrivalFlashes[i],t=(now-cue.startedAt)/cue.duration;
      if(t>=1){
        scene.remove(cue.ring);
        cue.ring.geometry.dispose();cue.ring.material.dispose();
        arrivalFlashes.splice(i,1);
        continue;
      }
      cue.ring.scale.setScalar(1+t*.45);
      cue.ring.material.opacity=.48*(1-t);
    }
  }
  const worldExtent=kit.mapExtent?.(roles)||15;
  const view=new T.Vector3(0,.7,-1.8),direction=new T.Vector3(16,21,25).normalize();
  let width=1,height=1,zoom=1,selected=0,focus=null;
  const labelsHost=document.getElementById('world-labels');
  const visitorLabel=document.createElement('span');
  visitorLabel.className='world-player-label';visitorLabel.textContent='你';
  if(visitor)labelsHost?.appendChild(visitorLabel);
  const districtsHost=document.getElementById('world-districts');
  const districtPins=districts.map((members,districtIndex)=>{
    const marker=document.createElement('button');
    marker.type='button';marker.className='world-district-pin';
    const name=String(members[0].projectId||'General').slice(0,24);
    const label=document.createElement('b');label.textContent=name;
    const count=document.createElement('small');
    count.textContent=members.length+' 位 Role'+(districtIndex?' · '+(districtIndex+1)+' 區':'');
    marker.append(label,count);
    marker.title=name+'：'+members.map(role=>role.name).join('、');
    listen(marker,'click',()=>{
      const member=members[0];
      panTo(member.islandX,member.islandZ,width<700?2.35:1.85);
    });
    districtsHost?.appendChild(marker);
    return {marker,role:members[0],members,count};
  });
  const rosterHost=document.getElementById('world-roster');
  const liveStates={working:'工作中',waiting:'待處理',idle:'待命',new:'新角色',unknown:'未知'};
  const status=a=>{
    const actual=isLive?(synced?'真實狀態 · '+(liveStates[a.role.state]||'未知'):'狀態未同步 · 未知'):'示範 · 待命';
    return a.mode==='observed-handoff'?actual+' · 已記錄訊息（非送達確認）':
      a.mode==='working'?actual+' · 工作動畫示範':
      a.mode==='handoff'?actual+' · 紙飛機訊息示範':actual;
  };
  function headStatus(actor){
    if(actor.mode==='observed-handoff')
      return {state:actor.handoff?.kind==='reply'?'已記錄回覆':'已記錄訊息',detail:'紙飛機僅呈現訊息事件 · 非送達確認',tone:'handoff'};
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
    button.append(speech,title,state,detail);listen(button,'click',()=>select(index,true));
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
  if(openRole)openRole.hidden=!isLive||!window.CrewWorldHost;
  const inlineChat=document.getElementById('world-chat-open');
  if(inlineChat)inlineChat.hidden=!isLive||!window.CrewWorldHost;
  const actionRow=document.querySelector('.world-action-row');
  // Real usage emphasizes talking and opening conversations; demo controls
  // remain available only in offline art-preview mode.
  document.getElementById('world-work').hidden=isLive;
  document.getElementById('world-handoff').hidden=isLive;
  if(actionRow)actionRow.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
  function updateInfo(){
    for(const pin of districtPins){
      const working=pin.members.filter(r=>r.state==='working').length;
      const waiting=pin.members.filter(r=>r.state==='waiting').length;
      pin.marker.dataset.state=!synced?'unknown':working?'working':waiting?'waiting':'idle';
      pin.count.textContent=pin.members.length+' 位 · '+
        (!synced?'狀態未同步':working?working+' 工作中':waiting?waiting+' 待處理':'待命');
    }
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
    const span=Math.max(24.5,worldExtent*2.15);
    const vertical=Math.max(14.8,span/aspect)/zoom;
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
  function startWalk(destination,kind='ground',roleId=null){
    if(!visitor||!navigation||!destination)return false;
    if(walking){
      queuedDestination={destination,kind,roleId};
      notify('已排入下一個目的地');return false;
    }
    const route=navigation.planWalk({
      lots:townLots,roads:roadVisuals,
      from:{x:visitor.root.position.x,z:visitor.root.position.z},
      to:{x:destination.x,z:destination.z},
      fromDistrict:visitorDistrict,toDistrict:destination.districtId
    });
    if(!route||route.waypoints.length<1){
      notify('這裡沒有可行走的步道，請改點其他街道');return false;
    }
    const sameSpot=route.distance<.22;
    walking={points:route.waypoints,index:1,kind,roleId,districtId:destination.districtId};
    focus=null;followPlayer=true;
    zoom=Math.max(zoom,width<700?1.55:1.85);
    updateExploreUI();
    if(sameSpot)finishWalk();
    return true;
  }
  function finishWalk(){
    if(!walking)return;
    const completed=walking;
    visitorDistrict=completed.districtId;
    walking=null;updateExploreUI();
    if(queuedDestination){
      const next=queuedDestination;queuedDestination=null;
      startWalk(next.destination,next.kind,next.roleId);return;
    }
    if(completed.roleId){
      const role=roles.find(r=>r.id===completed.roleId);
      if(role&&isLive&&window.CrewWorldHost?.openChat){
        void window.CrewWorldHost.openChat(role.id);
      }else if(role){
        notify('已靠近 '+role.short+' · 示範地圖不會發送訊息');
      }
    }
  }
  function roleDestination(role){
    const lot=townLots.find(n=>n.id===(role.districtId||role.id));
    if(!lot)return null;
    return {districtId:lot.id,x:role.x,z:role.z};
  }
  function select(index,center=false){
    if(index<0||index>=actors.length)return;
    selected=index;updateInfo();
    if(center)roster[index]?.scrollIntoView?.({inline:'center',block:'nearest'});
    window.CrewWorldHost?.onSelectedRole?.(roles[index].id,roles[index].name);
    if(center){
      const role=roles[index];
      if(explore&&visitor&&navigation){
        const destination=roleDestination(role);
        if(destination)startWalk(destination,'role',role.id);
      }else panTo(role.islandX,role.islandZ,width<700?2.65:2.0);
    }
  }
  function advanceVisitor(delta,now){
    if(!walking||!visitor)return;
    let remaining=Math.min(.06,delta)*11.5;
    while(remaining>0&&walking&&walking.index<walking.points.length){
      const target=walking.points[walking.index];
      const root=visitor.root;
      const dx=target.x-root.position.x,dz=target.z-root.position.z;
      const length=Math.hypot(dx,dz);
      if(length<=.025){walking.index++;continue;}
      const step=Math.min(length,remaining);
      root.position.x+=dx/length*step;root.position.z+=dz/length*step;
      root.rotation.y=Math.atan2(dx,dz);
      remaining-=step;
      if(step>=length-.001)walking.index++;
    }
    const moving=Boolean(walking);
    const phase=now*.012;
    visitor.legs.forEach(({mesh,side})=>{
      mesh.rotation.x=moving&&!reduced?Math.sin(phase)*side*.56:0;
    });
    visitor.arms.forEach((arm,index)=>{
      arm.rotation.x=moving&&!reduced?Math.sin(phase)*(.36*(index?1:-1)):0;
    });
    visitor.body.position.y=moving&&!reduced?Math.abs(Math.sin(phase))*.055:0;
    if(walking&&walking.index>=walking.points.length)finishWalk();
    if(followPlayer){
      view.x=T.MathUtils.lerp(view.x,visitor.root.position.x,.12);
      view.z=T.MathUtils.lerp(view.z,visitor.root.position.z,.12);
      cameraSync();
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
    if(actors.length<2){
      notify('示範交接至少需要兩位 Role');return;
    }
    const sender=actors[selected],recipient=actors[(selected+1)%actors.length];
    const now=performance.now();
    const launched=launchPaperPlane(sender,recipient,now,'demo');
    if(launched){sender.mode='handoff';sender.expires=now+(reduced?800:1750);}
    updateInfo();
    notify(launched?'紙飛機傳訊示範 · 不會真的發送 Role 訊息':
      '同時飛行數量已達上限 · 不會發送 Role 訊息');
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
  // The shared main Chat is owned by CrewWorldHost; standalone scene is visual-only.
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
      actors.forEach((actor,index)=>{
        const item=byId.get(actor.role.id);
        actor.role.state=item&&['working','waiting','idle','new'].includes(item.state)?item.state:'unknown';
        actor.role.workTitle=actor.role.state==='working'&&typeof item?.currentWork?.title==='string'
          ?item.currentWork.title.slice(0,75):'';
        actor.role.attention=Number.isSafeInteger(item?.attentionCount)
          ?Math.max(0,Math.min(999,item.attentionCount)):0;
        if(actor.role.state==='working')lastWorkingAt.set(actor.role.id,Date.now());
        else if(!labels[index].speech.hidden)hideSpeech(index);
      });
      synced=true;
      if(pill)pill.textContent=next.length===originalCount?statusSummary():'角色名單已改變 · 重新進入地圖更新';
    }catch(_){
      if(disposed)return;
      synced=false;
      actors.forEach((actor,index)=>{
        actor.role.state='unknown';actor.role.workTitle='';actor.role.attention=0;
        if(!labels[index].speech.hidden)hideSpeech(index);
      });
      if(pill)pill.textContent='Runtime 未同步';
    }
    updateInfo();
  }
  const speechSeen=new Map(),speechDismissed=new Set(),speechTimers=new Map();
  const lastWorkingAt=new Map(roles.filter(role=>role.state==='working')
    .map(role=>[role.id,Date.now()]));
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
          // Initial fetch establishes a baseline; never replay old chat bubbles.
          if(previous===undefined||previous===signature||speechDismissed.has(signature))return;
          const lastWork=lastWorkingAt.get(role.id)||0;
          const recentlyWorking=role.state==='working'||Date.now()-lastWork<=20000;
          if(!recentlyWorking)return;
          const receivedAt=Date.parse(data.message.timestamp||'');
          const age=Number.isFinite(receivedAt)?Math.max(0,Date.now()-receivedAt):0;
          const remaining=300000-age;
          if(remaining<=0)return;
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
        if(pendingTransitions.length>=MAX_PENDING_MESSAGES)pendingTransitions.shift();
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
    let changed=false;
    while(pendingTransitions.length&&activePlanes.length<MAX_ACTIVE_PLANES){
      const event=pendingTransitions.shift();
      if(Date.now()-event.createdAt>45000)continue;
      const actor=actors.find(a=>a.role.id===event.fromRoleId);
      const recipient=actors.find(a=>a.role.id===event.toRoleId);
      if(!actor||!recipient)continue;
      if(!launchPaperPlane(actor,recipient,now,event.kind))continue;
      actor.mode='observed-handoff';
      actor.handoff={start:now,toId:event.toRoleId,kind:event.kind};
      actor.expires=now+(reduced?800:1750);
      changed=true;
    }
    // Visualizes a saved Role message, never read/delivery/task completion.
    if(changed)updateInfo();
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
    zoom=T.MathUtils.clamp(value,.65,4.5);cameraSync();
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
    if(event.target.closest?.('.world-label, .world-district-pin, .world-player-label'))return;
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
      followPlayer=false;
      stage.classList.add('dragging');
      const unit=(camera.top-camera.bottom)/height;
      const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
      const up=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
      right.y=0;up.y=0;right.normalize();up.normalize();
      view.addScaledVector(right,-dx*unit).addScaledVector(up,dy*unit);
      const panLimit=Math.max(13,worldExtent+2);
      view.x=T.MathUtils.clamp(view.x,-panLimit,panLimit);
      view.z=T.MathUtils.clamp(view.z,-panLimit,panLimit);
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
      select(index,true);return;
    }
    if(!explore||!visitor||!navigation)return;
    // Ground-only tap. The nearest workshop's connected frontage provides
    // a reachable walking target; roofs never become player destinations.
    const intersection=ray.ray.intersectPlane(
      new T.Plane(new T.Vector3(0,1,0),-.37),new T.Vector3());
    if(!intersection)return;
    // The central square and actual street junctions are walkable places,
    // not merely decoration surrounding the Project buildings.
    const junction=navigation.nearestStreetNode?.(intersection,roadVisuals,2.25);
    if(junction){
      startWalk({districtId:junction.id,x:junction.x,z:junction.z});
      return;
    }
    const lot=navigation.nearestLot(intersection,townLots);
    if(!lot)return;
    const spot=navigation.nearestWalkSpot(intersection,lot);
    if(!spot)return;
    startWalk({districtId:lot.id,x:spot.x,z:spot.z});
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
    updateFlights(now);
    if(isLive)runRecordedHandoff(now);
    advanceVisitor(delta,now);
    actors.forEach((actor,index)=>{
      if(now>=actor.expires&&actor.mode!=='idle'){
        actor.mode='idle';actor.handoff=null;
        actor.root.position.set(actor.role.x,.43,actor.role.z);
        actor.root.rotation.y=0;updateInfo();
      }
      const signaling=actor.mode==='handoff'||actor.mode==='observed-handoff';
      const working=actor.mode==='working'||(isLive&&synced&&actor.role.state==='working');
      // AI Roles remain at their own miniature workshop. Digital messages
      // travel as paper planes; there is no fabricated avatar journey.
      const reaction=now<actor.reactionUntil;
      const idle=actor.role.state==='idle'&&!working&&!signaling&&!reaction;
      // Quiet idle gestures are ambient only; they never claim tool progress.
      // Verified Runtime work gets a distinct ring and purposeful desk motion.
      const phase=elapsed*(signaling?6:working?8:2)+index;
      const idleGesture=idle&&Math.sin(elapsed*.67+index*1.71)>.89;
      actor.body.position.y=reduced?0:signaling?Math.sin(phase)*.024:
        working?Math.sin(phase)*.024:Math.sin(phase)*.022;
      actor.body.rotation.z=reduced?0:Math.sin(phase*.6)*.025;
      actor.arms[0].rotation.x=reduced?0:reaction?-.86:
        signaling?Math.sin(phase)*.24:working?Math.sin(phase)*.34:
        idleGesture?-.36:0;
      actor.arms[1].rotation.x=reduced?0:reaction?Math.sin(phase*1.2)*.27:
        signaling?-.25:working?-Math.sin(phase+1)*.27:
        idleGesture?-.16:0;
      actor.legs.forEach(({mesh})=>{mesh.rotation.x=0;});
      actor.workHalo.material.opacity=working?(reduced?.32:.22+Math.sin(elapsed*3+index)*.08):0;
    });
    if(visitor){
      const projected=visitor.root.position.clone().add(new T.Vector3(0,3.6,0)).project(camera);
      const x=(projected.x+1)/2*width,y=(-projected.y+1)/2*height;
      const visible=projected.z>=-1&&projected.z<=1&&x>18&&x<width-18&&y>110&&y<height-110;
      visitorLabel.style.display=visible?'':'none';
      if(visible){visitorLabel.style.left=x+'px';visitorLabel.style.top=y+'px';}
    }
    // At overview zoom, hide waiting/idle badges even in small crews. Only
    // active work and a newly received reply should add labels to the map.
    const overview=zoom<1.65;
    const placements=labels.map(({button,speech},index)=>{
      const projected=actors[index].root.position.clone().add(new T.Vector3(0,3.3,0)).project(camera);
      const x=(projected.x+1)/2*width,y=(-projected.y+1)/2*height;
      const active=roles[index].state==='working'||!speech.hidden;
      const priority=active?(!speech.hidden?0:1):
        index===selected?2:
        roles[index].state==='working'?2:roles[index].state==='waiting'?3:4;
      return {button,index,x,y,priority,depth:projected.z,active};
    }).sort((a,b)=>a.priority-b.priority);
    const occupied=[];
    for(const item of placements){
      const {button,index,x,y,depth,priority,active}=item;
      const out=depth<-1||depth>1||x<12||x>width-12||y<100||y>height-115;
      const lowPriority=overview&&!active;
      const collides=occupied.some(point=>Math.abs(point.x-x)<112&&Math.abs(point.y-y)<50);
      const visible=!out&&!lowPriority&&!collides;
      button.style.display=visible?'':'none';
      if(visible){occupied.push({x,y});button.style.left=x+'px';button.style.top=y+'px';}
    }
    for(const pin of districtPins){
      const pos=new T.Vector3(pin.role.islandX,2.9,pin.role.islandZ).project(camera);
      const x=(pos.x+1)/2*width,y=(-pos.y+1)/2*height;
      const visible=zoom<1.75&&roles.length>=6&&
        pin.members.some(role=>role.state==='working')&&pos.z>=-1&&pos.z<=1&&
        x>35&&x<width-35&&y>115&&y<height-120;
      pin.marker.style.display=visible?'':'none';
      if(visible){pin.marker.style.left=x+'px';pin.marker.style.top=y+'px';}
    }
    renderer.render(scene,camera);
  }
  updateInfo();
  window.CrewWorldHost?.onSelectedRole?.(roles[selected].id,roles[selected].name);
  resize();frame(performance.now());
  teardown=()=>{
    for(const flight of activePlanes)kit.disposePaperPlane?.(scene,flight.plane);
    activePlanes.length=0;
    for(const cue of arrivalFlashes){
      scene.remove(cue.ring);
      cue.ring.geometry.dispose();cue.ring.material.dispose();
    }
    arrivalFlashes.length=0;
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
    districtsHost?.replaceChildren();
    kit.releaseMaterials?.();
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
