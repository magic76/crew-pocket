/* Crew World 3D visual prototype: sample-only states, zero Runtime writes. */
(() => {
  'use strict';
  const stage=document.getElementById('world-stage');
  const loading=document.getElementById('world-loading');
  if(!stage)return;
  const fail=msg=>{if(loading)loading.textContent=msg;};
  if(!window.THREE || !window.WorldLabKit){fail('缺少本地 3D 資源，請更新 Crew Runtime。');return;}
  const T=window.THREE, kit=window.WorldLabKit;
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
  const actors=kit.create(scene), roles=kit.roles, hub={x:0,z:-.8};
  const view=new T.Vector3(0,.7,-1.8),direction=new T.Vector3(16,21,25).normalize();
  let width=1,height=1,zoom=1,selected=0,focus=null;
  const labelsHost=document.getElementById('world-labels');
  const rosterHost=document.getElementById('world-roster');
  const status=a=>a.mode==='working'?'示範 · 正在工作':a.mode==='handoff'?'示範 · 正在移動交接':'示範 · 待命';
  const labels=roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    button.className='world-label';
    const title=document.createElement('b');title.textContent=role.short;
    const state=document.createElement('small');state.textContent='示範 · 待命';
    button.append(title,state);button.addEventListener('click',()=>select(index));
    labelsHost.appendChild(button);return{button,state};
  });
  const roster=roles.map((role,index)=>{
    const button=document.createElement('button');button.type='button';
    const dot=document.createElement('span');dot.style.background=role.color;
    button.append(dot,document.createTextNode(role.short));
    button.addEventListener('click',()=>select(index,true));
    rosterHost.appendChild(button);return button;
  });
  const portrait=document.getElementById('world-portrait');
  function updateInfo(){
    const actor=actors[selected],role=actor.role;
    document.getElementById('world-role-name').textContent=role.name;
    document.getElementById('world-role-state').textContent=status(actor);
    document.getElementById('world-role-description').textContent=role.description;
    portrait.textContent=role.initial;portrait.style.background=role.coat;
    labels.forEach((entry,i)=>{
      entry.button.dataset.selected=String(i===selected);
      entry.state.textContent=status(actors[i]);
    });
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
      const moving=actor.mode==='handoff',working=actor.mode==='working';
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
})();
