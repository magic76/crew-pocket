/* Crew World 3D visual prototype: sample-only states, zero Runtime writes. */
(() => {
  'use strict';
  function mountWorld(initialCamera=null){
  let disposed=false,paused=false,pausedAt=0,sceneReady=false,contextLost=false,teardown=null,raf=0;
  let renderCollaborationLinks=()=>{};
  let pauseScene=()=>{
    if(disposed)return;
    if(!paused)pausedAt=performance.now();
    paused=true;
    if(raf)cancelAnimationFrame(raf);
    raf=0;
  };
  let resumeScene=()=>{};
  let activeSelectWorldRole=()=>false;
  let snapshotCamera=()=>null;
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
  const worldModal=document.getElementById('crew-world-modal');
  if(loading){loading.textContent='正在建立 3D 世界…';loading.hidden=Boolean(initialCamera);}
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
    // An empty verified Runtime is not an art demo: never invent sample Roles.
    // Keep a lightweight watcher so adding the first Role activates the town.
    if(Array.isArray(liveRows)&&liveRows.length===0){
      if(loading){
        loading.dataset.empty='true';
        loading.textContent='目前沒有角色，請從上方新增 Role';
        loading.hidden=false;
      }
      trackedInterval(async()=>{
        if(disposed||paused||document.hidden)return;
        try{
          const current=await loadStatus();
          if(!disposed&&!paused&&current.length)
            window.CrewWorldHost?.refreshSceneRoles?.();
        }catch(_){/* Wait for the real Runtime rather than showing demo agents. */}
      },7000);
      return;
    }
    if(loading)delete loading.dataset.empty;
    const roles=liveRows?.length?kit.makeLiveRoles(liveRows):kit.roles;
    const liveRuntimeByRole=new Map((liveRows||[]).map(row=>[row.roleId,row.runtime]));
    const originalCount=liveRows?.length||roles.length;
    const liveSignature=JSON.stringify((liveRows||[]).map(row=>[row.roleId,row.projectId||'']));
    const districtMap=new Map();
    for(const role of roles){
      const key=role.districtId||role.id;
      if(!districtMap.has(key))districtMap.set(key,[]);
      districtMap.get(key).push(role);
    }
    const districts=[...districtMap.values()];
    const isLive=Boolean(liveRows?.length);
    let synced=isLive;
    const flightNotice=document.getElementById('world-flight-notice');
    const flightNoticeText=document.getElementById('world-flight-notice-text');
    const flightNoticeState={eventId:null,until:0};
    function hideFlightNotice(){
      flightNoticeState.eventId=null;flightNoticeState.until=0;
      if(flightNotice)flightNotice.hidden=true;
    }
    const pill=stage.closest('.world-app')?.querySelector('.world-demo-pill');
    const statusSummary=()=>originalCount>roles.length
      ?'地圖 '+roles.length+'/'+originalCount+' 位 · '+districts.length+' 區'
      :'地圖 '+roles.length+' 位 · '+districts.length+' 區';
    if(pill)pill.textContent=isLive?statusSummary():'示範場景 · 非即時';
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
  const lowPower=window.matchMedia?.('(pointer: coarse)').matches||false;
  let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}
  catch(_){fail('無法啟動 WebGL，請檢查瀏覽器硬體加速。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,lowPower?1.35:1.7));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=.78;
  stage.prepend(renderer.domElement);if(loading)loading.hidden=true;
  const scene=new T.Scene();
  const camera=new T.OrthographicCamera(-8,8,8,-8,.1,150);
  const sunlight=new T.DirectionalLight(0xfff5dd,1.05);
  sunlight.position.set(-7,18,13);
  sunlight.castShadow=true;
  sunlight.shadow.mapSize.set(lowPower||roles.length>12?512:1024,lowPower||roles.length>12?512:1024);
  sunlight.shadow.camera.left=-24;sunlight.shadow.camera.right=24;
  sunlight.shadow.camera.top=24;sunlight.shadow.camera.bottom=-24;
  sunlight.shadow.bias=-.0005;
  scene.add(sunlight,new T.HemisphereLight(0xc9e6ec,0x526459,.66));
  const actors=kit.create(scene,roles);
  const workshopGroups=new Map();
  actors.forEach(actor=>{
    const id=actor.role.districtId||actor.role.id;
    if(!workshopGroups.has(id))workshopGroups.set(id,[]);
    workshopGroups.get(id).push(actor);
  });
  const activePlanes=[];
  const arrivalFlashes=[];
  const MAX_ACTIVE_PLANES=3;
  const MAX_PENDING_MESSAGES=6;
  function launchPaperPlane(sender,recipient,now,kind='handoff',eventId=null){
    if(activePlanes.length>=MAX_ACTIVE_PLANES||!planner?.paperFlightPoint||
       !kit?.createPaperPlane)return false;
    const from={x:sender.role.x,y:3.25,z:sender.role.z};
    const to={x:recipient.role.x,y:3.25,z:recipient.role.z};
    const duration=reduced?1300:planner.paperFlightDuration(from,to);
    const plane=kit.createPaperPlane(scene,kind);
    if(eventId)plane.root.traverse(mesh=>{
      if(mesh.isMesh)mesh.userData.handoffEventId=eventId;
    });
    // Screen-space size is adjusted per frame; a 36-Role town should not
    // shrink the paper airplane into a barely visible speck.
    const flight={from,to,startedAt:now,duration,plane,kind,recipient,eventId};
    activePlanes.push(flight);
    if(eventId&&isLive&&synced&&flightNotice&&flightNoticeText){
      const fromName=sender.role.short||sender.role.name;
      const toName=recipient.role.short||recipient.role.name;
      flightNoticeText.textContent=fromName+' → '+toName+' · 已記錄'+
        (kind==='reply'?'回覆':'訊息')+'（非送達確認）';
      flightNotice.dataset.kind=kind;
      flightNoticeState.eventId=eventId;
      flightNoticeState.until=now+duration+950;
      flightNotice.hidden=false;
    }
    showDepartureCue(flight,now);
    // Digital message only: the paper plane doesn't require the sender
    // to travel or turn on unrelated roads and never implies delivery.
    return true;
  }
  function showPulseCue(point,kind,now,origin=false){
    if(reduced)return;
    // Departure = recorded message; recipient pulse = visual arrival ONLY,
    // not proof of delivery/read/execution.
    const ring=new T.Mesh(new T.TorusGeometry(origin?.76:1.02,.093,6,26),
      new T.MeshBasicMaterial({
        color:kind==='reply'?'#65f1af':'#77dcff',
        transparent:true,opacity:origin?.65:.72,depthWrite:false
      }));
    ring.rotation.x=-Math.PI/2;
    ring.position.set(point.x,.68,point.z);
    scene.add(ring);
    arrivalFlashes.push({ring,startedAt:now,duration:origin?600:740,
      initialOpacity:origin?.65:.72});
  }
  function showDepartureCue(flight,now){showPulseCue(flight.from,flight.kind,now,true);}
  function showArrivalCue(flight,now){showPulseCue(flight.to,flight.kind,now);}
  listen(flightNotice,'click',()=>{
    const id=flightNoticeState.eventId;
    if(id)openEvidence(id);
  });
  function updateFlights(now){
    if(flightNoticeState.until&&now>=flightNoticeState.until)hideFlightNotice();
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
      const worldUnitsPerPixel=(camera.top-camera.bottom)/Math.max(1,height);
      const readableScale=Math.max(.88,Math.min(3.8,worldUnitsPerPixel*42/1.37));
      root.scale.setScalar(readableScale);
      root.position.set(point.x,point.y,point.z);
      root.rotation.y=Math.atan2(dx,dz);
      root.rotation.x=reduced?0:-Math.atan2(dy,Math.hypot(dx,dz));
      root.rotation.z=reduced?0:Math.sin(Math.PI*t*2)*.13;
      for(let j=0;j<flight.plane.trails.length;j++){
        const bead=flight.plane.trails[j];
        const behind=t-(j+1)*.048;
        const visible=!reduced&&behind>0;
        bead.visible=visible;
        if(!visible)continue;
        const tail=planner.paperFlightPoint(flight.from,flight.to,behind);
        bead.position.set(tail.x,tail.y,tail.z);
        bead.scale.setScalar(Math.max(.9,Math.min(2.2,readableScale*.72)));
        bead.material.opacity=(.68-j*.12)*Math.sin(Math.PI*t);
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
      cue.ring.scale.setScalar(1+t*.85);
      cue.ring.material.opacity=cue.initialOpacity*(1-t);
    }
  }
  const worldExtent=kit.mapExtent?.(roles)||15;
  const view=new T.Vector3(0,.7,-1.8),direction=new T.Vector3(16,21,25).normalize();
  // Keep the occupied village legible on narrow screens. The larger square
  // grass ground is intentionally allowed to extend beyond the camera.
  const overviewZoom=roles.length<=12?1.32:1.12;
  // Open the world on the actual active Role, not always the first list item.
  const currentRole=window.getCurrentRoleId?.()||window.getCrewCockpitSnapshot?.()?.activeRoleId;
  const initialSelection=roles.findIndex(role=>role.id===(initialCamera?.selectedId||currentRole));
  const initialZoom=Number(initialCamera?.zoom);
  let width=1,height=1,zoom=Number.isFinite(initialZoom)&&initialZoom>=.65&&initialZoom<=4.5?initialZoom:overviewZoom,
    selected=Math.max(0,initialSelection),focus=null;
  if(Number.isFinite(initialCamera?.x)&&Number.isFinite(initialCamera?.z))
    view.set(initialCamera.x,.7,initialCamera.z);
  snapshotCamera=()=>({x:view.x,z:view.z,zoom,selectedId:roles[selected]?.id||null});
  const selectionHalo=new T.Mesh(new T.RingGeometry(1.08,1.42,36),
    new T.MeshBasicMaterial({color:'#f7de8b',transparent:true,opacity:.82,
      side:T.DoubleSide,depthWrite:false}));
  selectionHalo.rotation.x=-Math.PI/2;
  selectionHalo.position.y=.065;
  const focusHalo=new T.Mesh(new T.RingGeometry(1.55,1.69,40),
    new T.MeshBasicMaterial({color:'#9de8ff',transparent:true,opacity:reduced?.30:.24,
      side:T.DoubleSide,depthWrite:false}));
  focusHalo.rotation.x=-Math.PI/2;
  focusHalo.position.y=.07;
  actors[selected].root.add(selectionHalo,focusHalo);
  const labelsHost=document.getElementById('world-labels');
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
      if(members.length>1)showDistrictPicker(members);
      else handleRoleTap(roles.findIndex(role=>role.id===members[0].id));
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
    const attentionMark=document.createElement('span');
    attentionMark.className='world-label-alert';attentionMark.hidden=true;
    const contextMark=document.createElement('span');
    contextMark.className='world-label-context';contextMark.hidden=true;
    button.append(attentionMark,speech,title,state,detail,contextMark);
    listen(button,'click',()=>{
      // Consume only the synthetic click immediately following this label's long press.
      if(!roleMenu.hidden&&menuRoleIndex===index&&performance.now()-menuOpenedAt<650)return;
      closeRoleMenu();handleRoleTap(index);
    });
    listen(speech,'click',event=>{
      event.preventDefault();event.stopPropagation();
      hideSpeech(index,true);
    });
    button.style.setProperty('--world-role-color',role.color);
    labelsHost.appendChild(button);return{button,state,detail,speech,attentionMark,contextMark};
  });
  const roleMenu=document.createElement('div');
  roleMenu.className='world-role-menu';roleMenu.hidden=true;
  roleMenu.setAttribute('role','group');
  roleMenu.setAttribute('aria-label','角色快捷操作');
  const roleMenuActions=[
    ['chat','開啟對話'],['focus','聚焦角色'],
    ['context','Context Health'],['collaboration','協作紀錄']
  ];
  roleMenuActions.forEach(([key,label])=>{
    const button=document.createElement('button');
    button.type='button';button.dataset.roleAction=key;button.textContent=label;
    roleMenu.appendChild(button);
  });
  stage.appendChild(roleMenu);
  let menuRoleIndex=-1,menuOpenedAt=0;
  function closeRoleMenu(){roleMenu.hidden=true;menuRoleIndex=-1;}
  function openRoleMenu(index,clientX,clientY){
    if(!isLive||!window.CrewWorldHost||index<0||index>=roles.length)return;
    closeDistrictPicker();
    menuRoleIndex=index;menuOpenedAt=performance.now();select(index,false);
    const rect=stage.getBoundingClientRect();
    roleMenu.hidden=false;
    const menuWidth=roleMenu.offsetWidth||174,menuHeight=roleMenu.offsetHeight||164;
    roleMenu.style.left=Math.max(8,Math.min(rect.width-menuWidth-8,clientX-rect.left+8))+'px';
    roleMenu.style.top=Math.max(8,Math.min(rect.height-menuHeight-8,clientY-rect.top+8))+'px';
    roleMenu.querySelector('button')?.focus({preventScroll:true});
  }
  listen(roleMenu,'click',event=>{
    const button=event.target.closest?.('button[data-role-action]');
    if(!button||menuRoleIndex<0)return;
    const index=menuRoleIndex,role=roles[index],action=button.dataset.roleAction;
    closeRoleMenu();
    if(action==='focus')revealRole(index,true);
    else if(action==='chat')void window.CrewWorldHost?.openChat?.(role.id,{compact:false});
    else if(action==='context')document.getElementById('crew-world-command-context')?.click();
    else if(action==='collaboration'){
      onlySelectedHandoffs=true;
      filterHandoffs?.setAttribute('aria-pressed','true');
      evidenceSignature='';linkSignature='';showHandoffs(true);
    }
  });
  listen(window,'keydown',event=>{
    if(event.key==='Escape'&&!roleMenu.hidden)closeRoleMenu();
  });
  labels.forEach(({button},index)=>{
    listen(button,'contextmenu',event=>{
      event.preventDefault();event.stopPropagation();
      openRoleMenu(index,event.clientX,event.clientY);
    });
    let holdTimer=0,origin=null;
    const cancel=()=>{if(holdTimer)clearTimeout(holdTimer);holdTimer=0;origin=null;};
    listen(button,'pointerdown',event=>{
      cancel();if(event.button!==0||event.pointerType==='mouse')return;
      origin={x:event.clientX,y:event.clientY};
      holdTimer=setTimeout(()=>{
        holdTimer=0;openRoleMenu(index,origin.x,origin.y);origin=null;
      },500);
    });
    listen(button,'pointermove',event=>{
      if(origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>8)cancel();
    });
    listen(button,'pointerup',cancel);
    listen(button,'pointercancel',cancel);
    cleanups.push(cancel);
  });
  // Standalone 3D Lab retains its debug roster; the hosted map deliberately
  // has no duplicate Role strip beside the persistent P10 commander.
  const roster=rosterHost?roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    const dot=document.createElement('span');dot.style.background=role.color;
    button.append(dot,document.createTextNode(role.short));
    listen(button,'click',()=>handleRoleTap(index));
    rosterHost.appendChild(button);return button;
  }):[];
  const statusStrip=document.getElementById('world-status-strip');
  const picker=document.getElementById('world-district-picker');
  const pickerTitle=document.getElementById('world-district-picker-name');
  const pickerList=document.getElementById('world-district-picker-list');
  function closeDistrictPicker(){if(picker)picker.hidden=true;}
  function showDistrictPicker(members){
    if(!picker||!pickerList)return;
    pickerTitle.textContent=(members[0].projectId||'工作室')+' · '+members.length+' 位 Role';
    pickerList.replaceChildren();
    for(const role of members){
      const index=roles.findIndex(item=>item.id===role.id);
      if(index<0)continue;
      const button=document.createElement('button');
      button.type='button';button.dataset.roleIndex=String(index);
      const dot=document.createElement('span');dot.className='world-member-dot';
      dot.style.setProperty('--world-role-color',role.color);
      const text=document.createElement('span');text.className='world-member-text';
      const title=document.createElement('strong');title.textContent=role.name;
      const state=document.createElement('small');
      state.textContent=(!synced?'狀態未同步':liveStates[role.state]||'未知')+
        (synced&&role.attention?' · 待處理 '+role.attention:'');
      text.append(title,state);button.append(dot,text);pickerList.append(button);
    }
    picker.hidden=false;
    pickerList.querySelector('button')?.focus({preventScroll:true});
  }
  listen(document.getElementById('world-district-picker-close'),'click',closeDistrictPicker);
  listen(pickerList,'click',event=>{
    const button=event.target.closest('button[data-role-index]');
    if(!button||!pickerList.contains(button))return;
    closeDistrictPicker();handleRoleTap(Number(button.dataset.roleIndex));
  });
  listen(window,'keydown',event=>{
    if(event.key==='Escape'&&picker&&!picker.hidden)closeDistrictPicker();
  });
  // P7 and P8 are read-only projections of verified Runtime and saved
  // message events. No inferred tool progress, delivery or task success.
  const handoffsOpen=document.getElementById('world-handoffs-open');
  const handoffsPanel=document.getElementById('world-handoffs-panel');
  const handoffsClose=document.getElementById('world-handoffs-close');
  const handoffsList=document.getElementById('world-handoffs-list');
  const stoppedAt=new Map(),freshReplies=new Map();
  let evidenceRows=[],evidenceVerified=false,evidenceSignature='';
  const memberById=new Map(roles.map(role=>[role.id,role]));
  const attentionOpenButton=document.getElementById('world-attention-open');
  const attentionCount=document.getElementById('world-attention-count');
  const attentionPanel=document.getElementById('world-attention-panel');
  const attentionList=document.getElementById('world-attention-list');
  const attentionClose=document.getElementById('world-attention-close');
  const rolePeek=document.getElementById('world-role-peek');
  const rolePeekName=document.getElementById('world-role-peek-name');
  const rolePeekBody=document.getElementById('world-role-peek-body');
  const linkSvg=document.getElementById('world-collaboration-links');
  const filterHandoffs=document.getElementById('world-handoffs-filter');
  let onlySelectedHandoffs=false,attentionSignature='',linkSignature='';
  let linkPaths=[],nextLinkExpiryAt=0;
  const activeReply=roleId=>{
    const reply=freshReplies.get(roleId);
    const age=Date.now()-Number(reply?.at);
    return reply&&typeof reply.signature==='string'&&age>=0&&age<300000?reply:null;
  };
  function concernRoles(){
    if(!isLive||!synced)return[];
    return planner?.attentionItems?.(roles,freshReplies,Date.now())||[];
  }
  const activityOpen=document.getElementById('world-activity-open');
  const activityCount=document.getElementById('world-activity-count');
  const activityLabel=document.getElementById('world-activity-label');
  const toAttention=document.getElementById('world-activity-to-attention');
  const toHandoffs=document.getElementById('world-activity-to-handoffs');
  if(activityOpen)activityOpen.hidden=!isLive||!window.CrewWorldHost;
  // Session-local observational feed: never infer success from "not working".
  // Existing status polling is its single verified source of truth.
  const recentRuntimeEvents=[];
  const runtimeFeed=document.getElementById('world-runtime-feed');
  const runtimeFeedList=document.getElementById('world-runtime-feed-list');
  function renderRuntimeFeed(){
    if(!runtimeFeed||!runtimeFeedList)return;
    runtimeFeed.hidden=!isLive||!synced||recentRuntimeEvents.length===0;
    runtimeFeedList.replaceChildren();
    if(runtimeFeed.hidden)return;
    for(const entry of recentRuntimeEvents){
      const button=document.createElement('button');
      button.type='button';button.dataset.roleId=entry.roleId;
      const title=document.createElement('strong');title.textContent=entry.roleName;
      const line=document.createElement('small');line.textContent=entry.label;
      const time=document.createElement('time');
      time.dateTime=new Date(entry.at).toISOString();
      time.textContent=new Date(entry.at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
      button.append(title,line,time);runtimeFeedList.appendChild(button);
    }
  }
  function rememberRuntimeEvent(role,label){
    if(!isLive||!synced)return;
    const at=Date.now(),last=recentRuntimeEvents[0];
    if(last?.roleId===role.id&&last.label===label&&at-last.at<2000)return;
    recentRuntimeEvents.unshift({roleId:role.id,roleName:role.name,label,at});
    recentRuntimeEvents.length=Math.min(recentRuntimeEvents.length,16);
    renderRuntimeFeed();
  }
  listen(runtimeFeedList,'click',event=>{
    const button=event.target.closest?.('button[data-role-id]');
    if(!button)return;
    const index=roles.findIndex(role=>role.id===button.dataset.roleId);
    if(index<0)return;
    showAttention(false);select(index,false);revealRole(index);
    void window.CrewWorldHost?.openChat?.(roles[index].id,{compact:false});
  });
  function syncActivityDisclosure(){
    activityOpen?.setAttribute('aria-expanded',String(Boolean(!attentionPanel?.hidden||!handoffsPanel?.hidden)));
  }
  function syncActivityBadge(count){
    if(!activityOpen)return;
    activityOpen.dataset.alert=String(count>0);
    if(activityCount){activityCount.hidden=count===0;activityCount.textContent=String(count);}
    if(activityLabel)activityLabel.textContent=count?'待處理':'動態';
    if(toAttention)toAttention.hidden=count===0&&recentRuntimeEvents.length===0;
    activityOpen.setAttribute('aria-label',count?count+' 位角色需要關注，查看小隊動態':'查看小隊協作動態');
  }
  function renderAttention(){
    const concerns=concernRoles();
    syncActivityBadge(concerns.length);
    const signature=concerns.map(({role,reply})=>role.id+':'+role.attention+':'+(reply?.signature||'')).join('|');
    if(attentionOpenButton){
      attentionOpenButton.hidden=!concerns.length;
      attentionOpenButton.setAttribute('aria-label',concerns.length+' 位角色需要關注');
      if(attentionCount)attentionCount.textContent=String(concerns.length);
    }
    renderRuntimeFeed();
    if(attentionPanel&&((!concerns.length&&!recentRuntimeEvents.length)||!synced)){
      attentionPanel.hidden=true;
      attentionOpenButton?.setAttribute('aria-expanded','false');
      syncActivityDisclosure();
    }
    if(attentionList&&signature!==attentionSignature){
      attentionSignature=signature;
      attentionList.replaceChildren();
      for(const {role,index,reply} of concerns){
        const button=document.createElement('button');
        button.type='button';button.dataset.roleIndex=String(index);
        const title=document.createElement('strong');title.textContent=role.name;
        const detail=document.createElement('small');
        detail.textContent=[reply?'本次觀察到新回覆':null,
          role.attention>0?'Runtime 待處理 '+role.attention+' 項':null].filter(Boolean).join(' · ');
        const text=document.createElement('span');text.append(title,detail);
        button.append(text,document.createTextNode('查看 ›'));
        attentionList.appendChild(button);
      }
    }
    for(const [index,entry] of labels.entries()){
      const role=roles[index],reply=synced&&isLive?activeReply(role.id):null;
      const count=synced&&isLive?role.attention:0;
      entry.attentionMark.hidden=!(count||reply);
      entry.attentionMark.textContent=reply?'↩':String(count);
      entry.attentionMark.title=reply?'新回覆（本次觀察）':'Runtime 待處理 '+count+' 項';
      entry.button.dataset.attention=String(Boolean(count||reply));
    }
  }
  function openAttentionRole(index){
    if(!isLive||!synced||index<0||index>=roles.length)return;
    const role=roles[index];
    if(!(role.attention>0||activeReply(role.id)))return;
    showAttention(false);
    select(index,false);
    panTo(role.islandX,role.islandZ,width<700?2.25:1.85);
    // Reuse existing Chat on this Role. Showing an event is not marking it read.
    void window.CrewWorldHost?.openChat?.(role.id,{compact:false});
  }
  function showAttention(open){
    if(!attentionPanel)return;
    const available=Boolean(synced&&(concernRoles().length||recentRuntimeEvents.length));
    if(open&&!available){showHandoffs(true);return;}
    if(open)showHandoffs(false);
    attentionPanel.hidden=!open;
    attentionOpenButton?.setAttribute('aria-expanded',String(open));
    syncActivityDisclosure();
  }
  listen(attentionOpenButton,'click',()=>showAttention(Boolean(attentionPanel?.hidden)));
  listen(attentionClose,'click',()=>showAttention(false));
  listen(activityOpen,'click',()=>{
    const open=!attentionPanel?.hidden||!handoffsPanel?.hidden;
    if(open){showAttention(false);showHandoffs(false);}
    else if(concernRoles().length||recentRuntimeEvents.length)showAttention(true);
    else showHandoffs(true);
  });
  listen(toAttention,'click',()=>showAttention(true));
  listen(toHandoffs,'click',()=>showHandoffs(true));
  listen(attentionList,'click',event=>{
    const button=event.target.closest?.('button[data-role-index]');
    if(button&&attentionList.contains(button))openAttentionRole(Number(button.dataset.roleIndex));
  });
  listen(rolePeek,'click',()=>{
    if(rolePeek?.hidden||!isLive||!synced)return;
    void window.CrewWorldHost?.openChat?.(roles[selected].id,{compact:false});
  });
  function refreshRolePeek(){
    if(!rolePeek||!rolePeekName||!rolePeekBody)return;
    const role=roles[selected];
    const reply=activeReply(role.id);
    const message=reply&&!labels[selected].speech.hidden
      ?labels[selected].speech.textContent
      :role.state==='working'&&role.workTitle
        ?'執行中：'+role.workTitle
        :role.attention>0?'Runtime 待處理 '+role.attention+' 項'
        :stoppedAt.has(role.id)&&Date.now()-stoppedAt.get(role.id)<45000
          ?'已停止執行 · 結果需查看對話確認':'';
    rolePeek.hidden=!isLive||!synced||!message;
    if(!rolePeek.hidden){
      rolePeekName.textContent=role.name;
      rolePeekBody.textContent=message.slice(0,155);
    }
  }
  function showHandoffs(open){
    if(!handoffsPanel)return;
    if(open&&attentionPanel){
      attentionPanel.hidden=true;
      attentionOpenButton?.setAttribute('aria-expanded','false');
    }
    handoffsPanel.hidden=!open;
    handoffsOpen?.setAttribute('aria-expanded',String(open));
    syncActivityDisclosure();
    if(open)renderHandoffs();
  }
  function shownHandoffs(){
    if(!synced||!evidenceVerified)return[];
    return evidenceRows.filter(event=>!onlySelectedHandoffs||
      event.fromRoleId===roles[selected].id||event.toRoleId===roles[selected].id);
  }
  renderCollaborationLinks=()=>{
    if(!linkSvg)return;
    const events=planner?.collaborationConnections?.(
      shownHandoffs(),roles[selected].id,false,3,Date.now())||[];
    nextLinkExpiryAt=events.length
      ?Math.min(...events.map(event=>event.createdAt+planner.COLLABORATION_LINK_WINDOW_MS)):0;
    const signature=events.map(event=>event.id).join('|')+':'+
      (onlySelectedHandoffs?roles[selected].id:'all');
    if(signature===linkSignature)return;
    linkSignature=signature;
    linkSvg.replaceChildren();linkPaths=[];
    for(const event of events){
      if(!memberById.has(event.fromRoleId)||!memberById.has(event.toRoleId))continue;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('class','world-collaboration-link');
      path.setAttribute('data-kind',event.kind);
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent=memberById.get(event.fromRoleId).name+' → '+
        memberById.get(event.toRoleId).name+' · 已記錄'+(event.kind==='reply'?'回覆':'訊息')+
        '，不代表送達';
      path.appendChild(title);
      linkSvg.appendChild(path);linkPaths.push({event,path});
    }
  };
  listen(filterHandoffs,'click',()=>{
    onlySelectedHandoffs=!onlySelectedHandoffs;
    filterHandoffs?.setAttribute('aria-pressed',String(onlySelectedHandoffs));
    evidenceSignature='';linkSignature='';
    renderHandoffs();
  });
  function renderHandoffs(){
    if(!handoffsOpen||!handoffsList)return;
    renderCollaborationLinks();
    handoffsOpen.hidden=!isLive||!window.CrewWorldHost;
    if(handoffsOpen.hidden){handoffsPanel.hidden=true;syncActivityDisclosure();return;}
    const rows=shownHandoffs();
    // Compact icon/count control leaves more of the living map visible.
    const handoffCount=evidenceVerified?String(evidenceRows.length):'—';
    handoffsOpen.textContent='↗ '+handoffCount;
    handoffsOpen.title='協作紀錄'+(evidenceVerified?' · '+handoffCount:' · 尚未同步');
    handoffsOpen.setAttribute('aria-label','查看'+handoffsOpen.title);
    const signature=(evidenceVerified?'verified':'unknown')+':'+rows.map(row=>row.id).join('|')+
      ':'+String(onlySelectedHandoffs)+':'+roles[selected].id;
    if(signature===evidenceSignature)return;
    evidenceSignature=signature;
    handoffsList.replaceChildren();
    if(!evidenceVerified||!rows.length){
      const note=document.createElement('p');
      note.textContent=!evidenceVerified?'協作資料尚未同步':
        onlySelectedHandoffs?'目前 Role 沒有已保存的近期協作':'目前沒有已保存的角色訊息';
      handoffsList.appendChild(note);return;
    }
    for(const event of rows){
      const sender=memberById.get(event.fromRoleId),recipient=memberById.get(event.toRoleId);
      if(!sender||!recipient)continue;
      const button=document.createElement('button');
      button.type='button';button.dataset.handoffId=event.id;
      button.setAttribute('aria-label',sender.name+' 傳給 '+recipient.name+' · 查看協作證據');
      const symbol=document.createElement('span');symbol.className='world-handoff-symbol';
      symbol.textContent=event.kind==='reply'?'↩':'↗';
      const info=document.createElement('span');info.className='world-handoff-info';
      const title=document.createElement('strong');
      title.textContent=sender.name+' → '+recipient.name;
      const subtitle=document.createElement('small');
      subtitle.textContent=(event.kind==='reply'?'已記錄回覆':'已記錄訊息')+' · '+
        new Date(event.createdAt).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      info.append(title,subtitle);
      const more=document.createElement('span');more.className='world-handoff-open';
      more.textContent='查看 ›';button.append(symbol,info,more);handoffsList.appendChild(button);
    }
  }
  function openEvidence(eventId){
    if(!evidenceVerified)return;
    const record=evidenceRows.find(row=>row.id===eventId);
    if(!record||!memberById.has(record.toRoleId))return;
    // Original, Role-scoped mission graph displays actual message content,
    // reply links and recorded receipts; no parallel message reader in World.
    window.CrewWorldHost?.openCollaboration?.(record.toRoleId,record.id);
  }
  listen(handoffsOpen,'click',()=>showHandoffs(Boolean(handoffsPanel?.hidden)));
  listen(handoffsClose,'click',()=>showHandoffs(false));
  listen(handoffsList,'click',event=>{
    const button=event.target.closest?.('button[data-handoff-id]');
    if(button&&handoffsList.contains(button))openEvidence(button.dataset.handoffId);
  });
  renderHandoffs();
  const contextLine=document.getElementById('world-role-context');
  const contextCache=new Map();
  let contextRequestId=0;
  const usageText=value=>Number.isFinite(value)?Math.round(value).toLocaleString()+' tokens':'—';
  async function loadSelectedContext(){
    if(!contextLine)return;
    const role=roles[selected],requestId=++contextRequestId;
    const runtime=liveRuntimeByRole.get(role.id);
    if(!isLive){contextLine.textContent='Context · 示範場景無資料';return;}
    if(!synced){contextLine.textContent='Context · 狀態未同步';return;}
    if(!runtime?.providerId||!runtime?.conversationId){
      contextLine.textContent='Context · 尚無有效對話';return;
    }
    const key=runtime.providerId+':'+runtime.conversationId;
    const cached=contextCache.get(key);
    if(cached&&Date.now()-cached.at<60000){
      contextLine.textContent=cached.text;return;
    }
    contextLine.textContent='Context · 正在讀取…';
    try{
      const params=new URLSearchParams({provider:runtime.providerId,id:runtime.conversationId});
      // Only on deliberate detail expansion; never poll context for every Role.
      const response=await fetch('/api/context/compaction-plan?'+params,{
        cache:'no-store',credentials:'same-origin'
      });
      if(!response.ok)throw new Error('Context unavailable');
      const data=await response.json(),health=data.health;
      if(data.success!==true||!health)throw new Error('Context unavailable');
      const ratio=Number(health.usageRatio);
      const pct=health.usageRatio!=null&&Number.isFinite(ratio)
        ?Math.round(ratio*100)+'%':'比例未知';
      const accuracy=health.totalUsage?.exact===true?'':'約 ';
      const text='Context · '+pct+' · '+accuracy+usageText(health.totalUsage?.value);
      contextCache.set(key,{at:Date.now(),text});
      if(contextRequestId===requestId&&roles[selected].id===role.id)
        contextLine.textContent=text;
    }catch(_){
      if(contextRequestId===requestId&&roles[selected].id===role.id)
        contextLine.textContent='Context · 尚無可用資料';
    }
  }
  const showContextIfExpanded=()=>{
    if(!document.getElementById('world-info')?.classList.contains('is-collapsed'))
      void loadSelectedContext();
  };
  let lastRoleTap=null;
  // Selecting an already-visible Role must not reframe the whole map.
  // Explicit double-tap / Focus remains the opt-in close-up gesture.
  function roleVisibleInCamera(role){
    if(!role)return false;
    cameraSync();
    const p=new T.Vector3(role.x,2.2,role.z).project(camera);
    const sx=(p.x+1)*width/2,sy=(1-p.y)*height/2;
    const top=Math.min(height*.36,Math.max(106,height*.18));
    const bottom=Math.min(height*.39,Math.max(142,height*.22));
    return p.z>=-1&&p.z<=1&&sx>56&&sx<width-56&&sy>top&&sy<height-bottom;
  }
  function revealRole(index,closer=false){
    const role=roles[index];
    if(!closer&&roleVisibleInCamera(role))return;
    panTo(role.islandX,role.islandZ,closer?(width<700?2.65:2.0):zoom);
  }
  function handleRoleTap(index){
    if(index<0||index>=roles.length)return;
    const now=performance.now(),id=roles[index].id;
    const double=lastRoleTap&&lastRoleTap.id===id&&now-lastRoleTap.at<340;
    lastRoleTap=double?null:{id,at:now};
    closeDistrictPicker();closeRoleMenu();
    select(index,false);
    revealRole(index,Boolean(double));
    showContextIfExpanded();
  }
  const portrait=document.getElementById('world-portrait');
  let chat=null;
  const openRole=document.getElementById('world-open-role');
  if(openRole)openRole.hidden=!isLive||!window.CrewWorldHost;
  const inlineChat=document.getElementById('world-chat-open');
  if(inlineChat)inlineChat.hidden=!isLive||!window.CrewWorldHost;
  const actionRow=document.querySelector('.world-action-row');
  // Real usage emphasizes talking and opening conversations; demo controls
  // remain available only in offline art-preview mode.
  const demoWork=document.getElementById('world-work');
  const demoHandoff=document.getElementById('world-handoff');
  if(demoWork)demoWork.hidden=isLive;
  if(demoHandoff)demoHandoff.hidden=isLive;
  if(actionRow)actionRow.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
  // Context pressure belongs to each real Role's window, not to the
  // removed selected-Role details bar. Unknown data never becomes 0%.
  const contextUsageByRole=new Map();
  function contextForRole(roleId){
    return contextUsageByRole.get(roleId)||null;
  }
  function syncContextWarnings(){
    // The scene runs on requestAnimationFrame; format provider usage only on
    // 25s refresh or a Runtime status change, never during camera projection.
    contextUsageByRole.clear();
    const store=isLive&&synced?window.CrewContextUsage:null;
    let elevated=0,critical=0;
    for(let i=0;i<labels.length;i++){
      const {button,contextMark}=labels[i];
      const usage=store?.get(roles[i].id)||null;
      const detail=store?.describe(usage);
      if(detail?.known)contextUsageByRole.set(roles[i].id,{usage,detail});
      const pressure=detail?.known&&(detail.tone==='warning'||detail.tone==='critical')
        ?detail:null;
      const tone=pressure?.tone||'';
      contextMark.hidden=!pressure;
      contextMark.textContent=pressure?'Context '+pressure.label:'';
      button.dataset.contextTone=tone;
      const suffix=pressure?' · Context '+pressure.label+(pressure.tone==='critical'?'，即將達上限':'，接近上限'):'';
      button.title=(button.dataset.baseTitle||roles[i].name)+suffix;
      button.setAttribute('aria-label',(button.dataset.baseAria||roles[i].name)+suffix);
      if(pressure){elevated++;if(tone==='critical')critical++;}
    }
    if(statusStrip){
      statusStrip.querySelector('[data-context-warning-count]')?.remove();
      if(elevated){
        const pill=document.createElement('span');
        pill.dataset.contextWarningCount=String(elevated);
        pill.dataset.tone=critical?'context-critical':'context-warning';
        pill.textContent=critical
          ?critical+' 位 Context 即將達上限'
          :elevated+' 位 Context 偏高';
        statusStrip.appendChild(pill);
      }
    }
    const command=document.getElementById('crew-world-command-context');
    if(command){
      const current=contextForRole(roles[selected].id);
      const {usage,detail}=current||{};
      const store=window.CrewContextUsage;
      command.textContent=detail?.known&&usage&&store
        ?(usage.exact===true?'':'~')+store.formatTokens(usage.usedTokens)
        :'—';
      command.dataset.contextTone=detail?.known?detail.tone:'unknown';
      const info=detail?.known
        ?(usage?.exact===true?'Provider 數值':'估算')+' · '+detail.detail+' · '+detail.label+' · 點擊查看 Context Health'
        :'Context token 使用量尚無資料 · 點擊查看 Context Health';
      command.title=info;
      command.setAttribute('aria-label',info);
    }
  }
  if(isLive&&window.CrewContextUsage){
    listen(window,'crew:context-usage-updated',syncContextWarnings);
    void window.CrewContextUsage.load();
    trackedInterval(()=>{
      if(!paused&&!document.hidden)void window.CrewContextUsage.load();
    },30000);
  }
  function updateInfo(){
    if(statusStrip){
      statusStrip.replaceChildren();
      const addStatus=(label,tone)=>{
        const pill=document.createElement('span');pill.dataset.tone=tone;
        pill.textContent=label;statusStrip.append(pill);
      };
      if(!isLive)addStatus('示範 · 非即時','unknown');
      else if(!synced)addStatus('Runtime 未同步','unknown');
      // Counts already live in the shared floating header. Only warnings
      // belong on the map; syncContextWarnings adds verified Context alerts.
    }
    for(const pin of districtPins){
      const working=pin.members.filter(r=>r.state==='working').length;
      const waiting=pin.members.filter(r=>r.state==='waiting').length;
      pin.marker.dataset.state=!synced?'unknown':working?'working':waiting?'waiting':'idle';
      pin.count.textContent=pin.members.length+' 位 · '+
        (!synced?'狀態未同步':working?working+' 工作中':waiting?waiting+' 待處理':'待命');
    }
    const actor=actors[selected],role=actor.role;
    const roleName=document.getElementById('world-role-name');
    const roleState=document.getElementById('world-role-state');
    const roleDescription=document.getElementById('world-role-description');
    if(roleName)roleName.textContent=role.name;
    if(roleState)roleState.textContent=status(actor);
    if(roleDescription)roleDescription.textContent=role.description;
    if(portrait){portrait.textContent=role.initial;portrait.style.background=role.coat;}
    labels.forEach((entry,i)=>{
      const head=headStatus(actors[i]);
      entry.button.dataset.selected=String(i===selected);
      entry.button.dataset.muted=String(i!==selected&&
        !roles[i].attention&&!activeReply(roles[i].id)&&roles[i].state!=='working');
      entry.button.dataset.tone=head.tone;
      entry.state.textContent=head.state;
      entry.detail.textContent=head.detail;
      entry.button.dataset.baseTitle=roles[i].name+' · '+head.state+(head.detail?' · '+head.detail:'');
      entry.button.dataset.baseAria=roles[i].name+' · '+head.state+
        (entry.speech.hidden?'':' · 最新回覆：'+entry.speech.textContent);
    });
    chat?.sync();
    roster.forEach((button,i)=>button?.setAttribute('aria-pressed',String(i===selected)));
    actors[selected].root.add(selectionHalo,focusHalo);
    if(contextLine&&document.getElementById('world-info')?.classList.contains('is-collapsed'))
      contextLine.textContent='Context · 展開詳情後讀取';
    syncContextWarnings();
    renderAttention();
    refreshRolePeek();
    renderHandoffs();
  }
  function cameraSync(){
    const aspect=width/Math.max(1,height);
    const span=Math.max(23,worldExtent*2.05);
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
  function select(index,center=false){
    if(index<0||index>=actors.length)return;
    selected=index;contextRequestId++;updateInfo();
    if(center)roster[index]?.scrollIntoView?.({inline:'center',block:'nearest'});
    window.CrewWorldHost?.onSelectedRole?.(roles[index].id,roles[index].name);
    // Double tap is a closer camera target, not a second UI mode.
    if(attentionPanel&&!attentionPanel.hidden)showAttention(false);
    if(center){
      // This is the explicit close-up action; ordinary selections do not zoom.
      revealRole(index,true);
    }
  }
  activeSelectWorldRole=roleId=>{
    const idx=roles.findIndex(role=>role.id===roleId);
    if(idx<0)return false;
    select(idx,false);
    revealRole(idx);
    return true;
  };
  const toast=document.getElementById('world-toast');
  let toastTimer;
  function notify(message){
    toast.textContent=message;toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer=trackedTimeout(()=>toast.classList.remove('visible'),2400);
  }
  const infoPanel=document.getElementById('world-info');
  const infoToggle=document.getElementById('world-info-toggle');
  const quickFocus=document.getElementById('world-info-quick-focus');
  function syncInfoDisclosure(){
    if(!infoToggle||!infoPanel)return;
    const expanded=!infoPanel.classList.contains('is-collapsed');
    infoToggle.setAttribute('aria-expanded',String(expanded));
    infoToggle.textContent=expanded?'收合':'詳情';
  }
  listen(infoToggle,'click',()=>{
    infoPanel.classList.toggle('is-collapsed');
    syncInfoDisclosure();
    showContextIfExpanded();
  });
  listen(quickFocus,'click',()=>document.getElementById('world-focus')?.click());
  syncInfoDisclosure();
  listen(document.getElementById('world-focus'),'click',()=>{
    select(selected,true);notify('鏡頭靠近 '+roles[selected].short);
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
    if(!isLive||paused||document.hidden)return;
    try{
      const next=await loadStatus();
      if(disposed||paused)return;
      const nextSignature=JSON.stringify(next.map(row=>[row.roleId,row.projectId||'']));
      if(nextSignature!==liveSignature){window.CrewWorldHost?.refreshSceneRoles?.();return;}
      const byId=new Map(next.map(item=>[item.roleId,item]));
      actors.forEach((actor,index)=>{
        const item=byId.get(actor.role.id);
        const previous=synced?actor.role.state:'unknown';
        const previousAttention=actor.role.attention||0;
        if(previous==='working'&&item?.state!=='working')
          stoppedAt.set(actor.role.id,Date.now());
        if(item?.state==='working')stoppedAt.delete(actor.role.id);
        liveRuntimeByRole.set(actor.role.id,item?.runtime||null);
        actor.role.state=item&&['working','waiting','idle','new'].includes(item.state)?item.state:'unknown';
        actor.role.workTitle=actor.role.state==='working'&&typeof item?.currentWork?.title==='string'
          ?item.currentWork.title.slice(0,75):'';
        actor.role.attention=Number.isSafeInteger(item?.attentionCount)
          ?Math.max(0,Math.min(999,item.attentionCount)):0;
        if(synced&&item&&previous!=='unknown'&&actor.role.state!=='unknown'){
          if(previous!=='working'&&actor.role.state==='working')
            rememberRuntimeEvent(actor.role,'開始執行 · Runtime 狀態');
          else if(previous==='working'&&actor.role.state!=='working')
            rememberRuntimeEvent(actor.role,'已離開執行中 · 結果請查看對話');
          if(previousAttention===0&&actor.role.attention>0)
            rememberRuntimeEvent(actor.role,'新增待處理事項 '+actor.role.attention+' 項');
        }
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
    if(!isLive||paused||document.hidden||speechRequest)return;
    speechRequest=true;
    try{
      await Promise.all(roles.map(async(role,index)=>{
        try{
          const response=await fetch('/api/world-chat-latest?role_id='+encodeURIComponent(role.id),{
            cache:'no-store',credentials:'same-origin'
          });
          if(!response.ok)return;
          const data=await response.json();
          if(disposed||paused||data.success!==true||data.roleId!==role.id)return;
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
          entry.speech.textContent='新回覆';
          entry.speech.title=text;
          freshReplies.set(role.id,{at:Date.now(),signature});
          renderAttention();refreshRolePeek();
          entry.speech.hidden=false;
          refreshRolePeek();
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
    if(!isLive||paused||!synced||!planner||document.hidden||eventRequest)return;
    eventRequest=true;
    try{
      const response=await fetch('/api/crew-room-events',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error('No Room event metadata');
      const data=await response.json();
      if(data.success!==true||!Array.isArray(data.events))throw new Error('Room events invalid');
      if(disposed||paused)return;
      evidenceRows=planner.traceableEvents?.(data.events,roles.map(role=>role.id),6,Date.now())||[];
      evidenceVerified=true;renderHandoffs();
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
      evidenceVerified=false;evidenceRows=[];renderHandoffs();
      hideFlightNotice();
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
      if(!launchPaperPlane(actor,recipient,now,event.kind,event.id))continue;
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
    trackedInterval(()=>{if(!disposed&&!paused&&!document.hidden)void synchronize();},7000);
    trackedInterval(()=>{if(!disposed&&!paused&&!document.hidden)void observeHandoffs();},3200);
    trackedInterval(()=>{if(!disposed&&!paused&&!document.hidden)void refreshSpeechBubbles();},9000);
    listen(document,'visibilitychange',()=>{
      if(document.hidden){seenEvents=null;pendingTransitions.length=0;}
      else if(!paused){void synchronize();void observeHandoffs();void refreshSpeechBubbles();}
    });
  }
  listen(document.getElementById('world-reset'),'click',()=>{
    showHandoffs(false);
    panTo(0,-1.8,overviewZoom);notify('返回全景');
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
    if(event.target.closest?.('.world-label, .world-district-pin, .world-role-menu'))return;
    closeRoleMenu();
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
    // Respect mesh depth: scenery cannot act as a fake Role or a walk target.
    const planeRoots=activePlanes.filter(flight=>flight.eventId).map(flight=>flight.plane.root);
    const hit=ray.intersectObjects([
      ...(actors.pickableObjects||actors.map(a=>a.root)),...planeRoots
    ],true)[0];
    if(hit?.object.userData.handoffEventId){
      openEvidence(hit.object.userData.handoffEventId);return;
    }
    if(hit?.object.userData.decorative)return;
    if(hit?.object.userData.roleId){
      handleRoleTap(roles.findIndex(role=>role.id===hit.object.userData.roleId));
      return;
    }
    if(hit?.object.userData.districtId){
      const members=roles.filter(role=>(role.districtId||role.id)===hit.object.userData.districtId);
      if(members.length>1)showDistrictPicker(members);
      else if(members.length===1)handleRoleTap(roles.findIndex(role=>role.id===members[0].id));
      return;
    }
  }
  function pointerEnd(event){
    if(event.type==='pointerup'&&fingers.size===1&&fingers.has(event.pointerId)&&tap&&!tap.moved&&
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
    event.preventDefault();contextLost=true;pauseScene();
    if(!worldModal?.hidden&&loading){
      loading.textContent='正在恢復 3D 繪圖環境…';loading.hidden=false;
    }
  });
  listen(stage,'webglcontextrestored',()=>{
    contextLost=false;
    renderer.resetState?.();
    resize();
    if(loading)loading.hidden=true;
    if(!worldModal?.hidden)resumeScene();
  });

  let elapsed=0,last=performance.now();
  let lastDraw=0;
  function frame(now){
    if(disposed||paused)return;
    raf=requestAnimationFrame(frame);
    const busy=Boolean(focus||fingers.size||activePlanes.length||
      roles.some(role=>role.state==='working'));
    const minFrameMs=lowPower?(busy?30:75):(reduced&&!busy?65:16);
    if(lastDraw&&now-lastDraw<minFrameMs)return;
    lastDraw=now;
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
    actors.forEach((actor,index)=>{
      if(now>=actor.expires&&actor.mode!=='idle'){
        actor.mode='idle';actor.handoff=null;
        actor.root.position.set(actor.role.x,.43,actor.role.z);
        actor.root.rotation.y=0;updateInfo();
      }
      const signaling=actor.mode==='handoff'||actor.mode==='observed-handoff';
      // Live working effects must reflect a verified runtime status, never
      // residual demo gestures or merely moving across the town.
      const working=isLive?Boolean(synced&&actor.role.state==='working'):
        actor.mode==='working';
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
      // Small home-front idle wander; the Role never walks between lots for
      // paper-plane deliveries, and stays within its standing area.
      const wander=idle&&!reduced;
      actor.root.position.x=actor.role.x+(wander ? .12*Math.sin(elapsed*.34+index*2.1):0);
      actor.root.position.z=actor.role.z+(wander ? .10*Math.cos(elapsed*.28+index*1.4):0);
      actor.body.rotation.y=wander ? .13*Math.sin(elapsed*.4+index*1.9):0;
      actor.arms[0].rotation.x=reduced?0:reaction?-.86:
        signaling?Math.sin(phase)*.24:working?Math.sin(phase)*.34:
        idleGesture?-.36:0;
      actor.arms[1].rotation.x=reduced?0:reaction?Math.sin(phase*1.2)*.27:
        signaling?-.25:working?-Math.sin(phase+1)*.27:
        idleGesture?-.16:0;
      actor.legs.forEach(({mesh,side})=>{
        mesh.rotation.x=wander?Math.sin(elapsed*.65+index)*side*.06:0;
      });
      actor.workHalo.material.opacity=working?(reduced?.32:.22+Math.sin(elapsed*3+index)*.08):0;
    });
    // One status signal per real workshop, even when several Roles share it.
    // Waiting yields only a dim attention cue; bright windows exclusively
    // indicate a currently verified live working Role (or labeled demo).
    for(const [districtId,lights] of actors.workshops||[]){
      const members=workshopGroups.get(districtId)||[];
      const working=members.some(actor=>isLive
        ?synced&&actor.role.state==='working'
        :actor.mode==='working');
      const attention=isLive&&synced&&!working&&members.some(actor=>
        actor.role.state==='waiting'&&actor.role.attention>0);
      lights.lamp.material.opacity=working
        ?(reduced?.69:.62+Math.sin(elapsed*2.6)*.10):.08;
      lights.status.material.opacity=attention
        ?(reduced?.53:.46+Math.sin(elapsed*1.3)*.08):0;
    }
    if(!reduced){
      selectionHalo.scale.setScalar(1+.045*Math.sin(now*.003));
      focusHalo.scale.setScalar(1+.07*Math.sin(now*.0021));
    }
    // At overview zoom, hide waiting/idle badges even in small crews. Only
    // active work and a newly received reply should add labels to the map.
    const overview=zoom<1.65,near=zoom>=2.55;
    const zoomTier=overview?'overview':near?'near':'district';
    if(stage.dataset.zoomTier!==zoomTier)stage.dataset.zoomTier=zoomTier;
    const placements=labels.map(({button,speech},index)=>{
      const projected=actors[index].root.position.clone().add(new T.Vector3(0,3.3,0)).project(camera);
      const x=(projected.x+1)/2*width,y=(-projected.y+1)/2*height;
      const active=roles[index].state==='working'||roles[index].attention>0||!speech.hidden||
        Boolean(contextForRole(roles[index].id));
      const priority=index===selected?0:!speech.hidden?1:
        contextForRole(roles[index].id)?.detail?.tone==='critical'?2:
        roles[index].attention>0?3:roles[index].state==='working'?4:5;
      return {button,index,x,y,priority,depth:projected.z,active};
    }).sort((a,b)=>a.priority-b.priority);
    const occupied=[];
    for(const item of placements){
      const {button,index,x,y,depth,priority,active}=item;
      const topMargin=Math.min(100,height*.18),bottomMargin=Math.min(115,height*.22);
      const out=depth<-1||depth>1||x<12||x>width-12||
        y<topMargin||y>height-bottomMargin;
      const lowPriority=(overview&&!active&&index!==selected)||
        (!overview&&!near&&roles.length>18&&!active&&index!==selected);
      const widthHint=Math.min(near?205:155,Math.max(88,roles[index].short.length*12+30));
      const collides=occupied.some(point=>
        Math.abs(point.x-x)<(point.w+widthHint)/2+8&&Math.abs(point.y-y)<(near?57:43));
      const visible=!out&&!lowPriority&&!collides;
      button.style.display=visible?'':'none';
      if(visible){occupied.push({x,y,w:widthHint});button.style.left=x+'px';button.style.top=y+'px';}
    }
    // P13 compact response card follows the actual selected Role. It is
    // read-only; opening it delegates to the existing Role Chat.
    if(rolePeek&&!rolePeek.hidden){
      const anchor=new T.Vector3(roles[selected].x,3.7,roles[selected].z).project(camera);
      const x=(anchor.x+1)/2*width,y=(-anchor.y+1)/2*height;
      const visible=anchor.z>=-1&&anchor.z<=1&&x>28&&x<width-28&&
        y>Math.min(135,height*.24)&&y<height-Math.min(218,height*.34);
      rolePeek.style.display=visible?'':'none';
      if(visible){rolePeek.style.left=x+'px';rolePeek.style.top=(y+17)+'px';}
    }
    // Expire activity arcs on time even when event polling stalls.
    if(linkSvg&&nextLinkExpiryAt&&Date.now()>=nextLinkExpiryAt)renderCollaborationLinks();
    // P14 only draws edges from saved, verified Role-to-Role events.
    if(linkSvg&&linkPaths.length){
      linkSvg.setAttribute('viewBox','0 0 '+width+' '+height);
      for(const {event,path} of linkPaths){
        const from=memberById.get(event.fromRoleId),to=memberById.get(event.toRoleId);
        if(!from||!to){path.setAttribute('d','');continue;}
        const a=new T.Vector3(from.x,2.3,from.z).project(camera);
        const b=new T.Vector3(to.x,2.3,to.z).project(camera);
        if(a.z < -1||a.z>1||b.z < -1||b.z>1){path.setAttribute('d','');continue;}
        const x1=(a.x+1)*width/2,y1=(1-a.y)*height/2;
        const x2=(b.x+1)*width/2,y2=(1-b.y)*height/2;
        const rise=Math.min(70,Math.max(20,Math.hypot(x2-x1,y2-y1)*.16));
        path.setAttribute('d','M '+x1.toFixed(1)+' '+y1.toFixed(1)+
          ' Q '+((x1+x2)/2).toFixed(1)+' '+(((y1+y2)/2)-rise).toFixed(1)+
          ' '+x2.toFixed(1)+' '+y2.toFixed(1));
      }
    }
    for(const pin of districtPins){
      const pos=new T.Vector3(pin.role.islandX,2.9,pin.role.islandZ).project(camera);
      const x=(pos.x+1)/2*width,y=(-pos.y+1)/2*height;
      const visible=synced&&overview&&roles.length>=6&&
        pin.members.some(role=>role.state==='working'||role.attention>0)&&
        pos.z>=-1&&pos.z<=1&&
        x>35&&x<width-35&&y>Math.min(115,height*.2)&&
        y<height-Math.min(120,height*.24);
      pin.marker.style.display=visible?'':'none';
      const blocked=occupied.some(point=>Math.abs(point.x-x)<(point.w+116)/2+10&&Math.abs(point.y-y)<54);
      pin.marker.style.display=visible&&!blocked?'':'none';
      if(visible&&!blocked){pin.marker.style.left=x+'px';pin.marker.style.top=y+'px';occupied.push({x,y,w:116});}
    }
    renderer.render(scene,camera);
  }
  updateInfo();
  window.CrewWorldHost?.onSelectedRole?.(roles[selected].id,roles[selected].name);
  sceneReady=true;
  resumeScene=()=>{
    if(disposed||!paused)return;
    const gl=renderer.getContext();
    if(contextLost||gl.isContextLost?.()){
      contextLost=true;
      if(loading){loading.textContent='正在恢復 3D 繪圖環境…';loading.hidden=false;}
      try{gl.getExtension('WEBGL_lose_context')?.restoreContext();}catch(_){/* Browser may restore it automatically. */}
      return;
    }
    const now=performance.now(),duration=Math.max(0,now-pausedAt);
    paused=false;last=now;
    if(focus)focus.start+=duration;
    actors.forEach(actor=>{if(actor.mode!=='idle')actor.expires+=duration;});
    activePlanes.forEach(flight=>{flight.startedAt+=duration;});
    arrivalFlashes.forEach(cue=>{cue.startedAt+=duration;});
    if(flightNoticeState.until)flightNoticeState.until+=duration;
    resize();
    if(document.hidden)return;
    raf=requestAnimationFrame(frame);
    if(isLive){void synchronize();void observeHandoffs();void refreshSpeechBubbles();}
  };
  resize();if(!paused)frame(performance.now());
  teardown=()=>{
    hideFlightNotice();
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
    roleMenu.remove();
    scene.traverse(object=>{
      object.geometry?.dispose?.();
      if(Array.isArray(object.material))object.material.forEach(m=>m?.dispose?.());
      else object.material?.dispose?.();
    });
    renderer.renderLists?.dispose?.();
    renderer.dispose();renderer.forceContextLoss?.();
    renderer.domElement.remove();
    labelsHost.replaceChildren();rosterHost?.replaceChildren();
    districtsHost?.replaceChildren();
    kit.releaseMaterials?.();
  };
  }
  void start().catch(()=>{if(!disposed)fail('無法建立 3D 世界，請重新開啟頁面。');});
  const dispose=()=>{
    disposed=true;teardown?.();teardown=null;
    for(const cleanup of cleanups.splice(0).reverse())cleanup();
  };
  dispose.pause=()=>pauseScene();
  dispose.resume=()=>{if(!sceneReady){paused=false;return;}resumeScene();renderCollaborationLinks();};
  dispose.selectRole=roleId=>activeSelectWorldRole(roleId);
   dispose.getCameraState=()=>snapshotCamera();
  return dispose;
  }
  window.mountCrewWorldScene=mountWorld;
  if(document.body?.firstElementChild?.id==='world-app')mountWorld();
})();
