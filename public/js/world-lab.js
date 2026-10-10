/* Crew World 3D visual prototype: sample-only states, zero Runtime writes. */
(() => {
  'use strict';
  const stage=document.getElementById('world-stage');
  const loading=document.getElementById('world-loading');
  if(!stage)return;
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
    const roles=liveRows?.length?kit.makeLiveRoles(liveRows):kit.roles;
    const isLive=Boolean(liveRows?.length);
    let synced=isLive;
    const pill=document.querySelector('.world-demo-pill');
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
  stage.prepend(renderer.domElement);loading?.remove();
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
    button.append(title,state,detail);button.addEventListener('click',()=>select(index));
    button.style.setProperty('--world-role-color',role.color);
    labelsHost.appendChild(button);return{button,state,detail};
  });
  const roster=roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    const dot=document.createElement('span');dot.style.background=role.color;
    button.append(dot,document.createTextNode(role.short));
    button.addEventListener('click',()=>select(index,true));
    rosterHost.appendChild(button);return button;
  });
  const portrait=document.getElementById('world-portrait');
  let chat=null;
  const openRole=document.getElementById('world-open-role');
  if(openRole)openRole.hidden=!isLive;
  const actionRow=document.querySelector('.world-action-row');
  if(actionRow)actionRow.style.gridTemplateColumns='repeat('+(isLive?5:3)+',minmax(0,1fr))';
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
    toastTimer=setTimeout(()=>toast.classList.remove('visible'),2400);
  }
  document.getElementById('world-focus').addEventListener('click',()=>{
    select(selected,true);notify('已聚焦 '+roles[selected].short);
  });
  document.getElementById('world-work').addEventListener('click',()=>{
    const a=actors[selected];a.mode='working';a.expires=performance.now()+6500;
    a.root.position.set(a.role.x,.43,a.role.z);a.root.rotation.y=0;
    updateInfo();notify('僅播放工作動畫，不會啟動真實任務');
  });
  document.getElementById('world-handoff').addEventListener('click',()=>{
    const a=actors[selected];a.mode='handoff';a.expires=performance.now()+8000;
    updateInfo();notify('僅播放交接動畫，不會發送 Role 訊息');
  });
  function openConversation(roleId){
    if(window.parent!==window){
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
  openRole?.addEventListener('click',()=>{
    if(!isLive)return;
    openConversation(roles[selected].id);
  });
  const back=document.getElementById('world-back');
  back?.addEventListener('click',event=>{
    if(window.parent===window)return;
    event.preventDefault();
    window.parent.postMessage({type:'crew-world-close'},location.origin);
  });
  async function synchronize(){
    if(!isLive||document.hidden)return;
    try{
      const next=await loadStatus();
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
      synced=false;
      for(const actor of actors){actor.role.state='unknown';actor.role.workTitle='';actor.role.attention=0;}
      if(pill)pill.textContent='Runtime 未同步';
    }
    updateInfo();
  }
  if(isLive){
    setInterval(()=>{if(!document.hidden)void synchronize();},12000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void synchronize();});
  }
  document.getElementById('world-reset').addEventListener('click',()=>{
    panTo(0,-1.8,1);notify('返回全景');
  });
  function setZoom(value){
    zoom=T.MathUtils.clamp(value,.65,3.5);cameraSync();
  }
  document.getElementById('world-zoom-in').addEventListener('click',()=>setZoom(zoom*1.2));
  document.getElementById('world-zoom-out').addEventListener('click',()=>setZoom(zoom/1.2));
  stage.addEventListener('wheel',event=>{
    event.preventDefault();focus=null;setZoom(zoom*(event.deltaY<0?1.1:.9));
  },{passive:false});

  // Pointer map supports single-finger drag, pinch zoom, and raycast tap.
  const fingers=new Map();
  let pinch=0,tap=null;
  stage.addEventListener('pointerdown',event=>{
    if(event.target.closest?.('.world-label'))return;
    stage.setPointerCapture?.(event.pointerId);
    fingers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(fingers.size===1)tap={x:event.clientX,y:event.clientY,at:performance.now(),moved:false};
    else{tap=null;pinch=0;}
    focus=null;
  });
  stage.addEventListener('pointermove',event=>{
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
  stage.addEventListener('pointerup',pointerEnd);
  stage.addEventListener('pointercancel',pointerEnd);
  stage.addEventListener('lostpointercapture',pointerEnd);
  window.addEventListener('resize',resize);
  if(window.ResizeObserver)new ResizeObserver(resize).observe(stage);
  stage.addEventListener('webglcontextlost',event=>{
    event.preventDefault();fail('3D 繪圖環境中斷，請重新開啟頁面。');
  });

  let elapsed=0,last=performance.now();
  function frame(now){
    requestAnimationFrame(frame);
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
    actors.forEach((actor,index)=>{
      if(now>=actor.expires&&actor.mode!=='idle'){
        actor.mode='idle';
        actor.root.position.set(actor.role.x,.43,actor.role.z);
        actor.root.rotation.y=0;updateInfo();
      }
      const moving=actor.mode==='handoff';
      const working=actor.mode==='working'||(isLive&&synced&&actor.mode==='idle'&&actor.role.state==='working');
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
  updateInfo();resize();frame(performance.now());
  }
  start().catch(()=>fail('無法建立 3D 世界，請重新開啟頁面。'));
})();
