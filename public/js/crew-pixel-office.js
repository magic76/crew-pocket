/*
 * Crew Pocket pixel-office renderer.
 * Upstream visual source: pixel-agents-hq/pixel-agents, commit b1bafd02896d90d83457266575a1e8e5011ce997.
 * Uses the original floor, wall, furniture, and 112x96 animated character sprites
 * and default-layout-1.json. Sprite crop/frame mapping and z-order follow upstream
 * pngDecoder.ts, spriteData.ts and renderer.ts. Role state is Crew's, not Claude hooks.
 * MIT attribution in /vendor/pixel-agents/LICENSE.txt.
 */
(() => {
  'use strict';
  const TILE=16,CHAR_W=16,CHAR_H=32,FRAME_TIME=420;
  const STATES=new Set(['working','waiting','idle','new']);
  const BASE='/vendor/pixel-agents/assets/';
  const FALLBACK='https://raw.githubusercontent.com/pixel-agents-hq/pixel-agents/b1bafd02896d90d83457266575a1e8e5011ce997/webview-ui/public/assets/';
  const sourceLayouts='/vendor/pixel-agents/default-layout.json';
  const furniturePaths=[
    'BIN','BOOKSHELF','CACTUS','CLOCK','COFFEE','COFFEE_TABLE','CUSHIONED_BENCH',
    'CUSHIONED_CHAIR','DESK','DOUBLE_BOOKSHELF','HANGING_PLANT','LARGE_PAINTING',
    'LARGE_PLANT','PC','PLANT','PLANT_2','POT','SMALL_PAINTING','SMALL_PAINTING_2',
    'SMALL_TABLE','SOFA','TABLE_FRONT','WHITEBOARD','WOODEN_BENCH','WOODEN_CHAIR'
  ];
  const labelFor={working:'工作中',waiting:'等待確認',idle:'待命',new:'剛加入',unknown:'未同步'};
  const hash=id=>{
    let h=2166136261;for(const ch of id){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}
    return h>>>0;
  };
  function projectRoles(rows){
    if(!Array.isArray(rows))return [];
    const seen=new Set();
    return rows.filter(role=>{
      if(!role||typeof role.roleId!=='string'||!role.roleId.trim()||seen.has(role.roleId))return false;
      seen.add(role.roleId);return true;
    }).slice(0,36).map(role=>{
      const state=STATES.has(role.state)?role.state:'unknown';
      return {
        id:role.roleId,
        name:String(role.roleName||'Role').slice(0,80),
        state,project:String(role.projectId||''),
        palette:hash(role.roleId)%6,
        work:state==='working'&&typeof role.currentWork?.title==='string'
          ?role.currentWork.title.slice(0,80):'',
        attention:Number.isSafeInteger(role.attentionCount)
          ?Math.max(0,Math.min(999,role.attentionCount)):0
      };
    });
  }
  function resolveFurniture(type){
    const base=String(type).split(':')[0];
    const group=furniturePaths.find(part=>base===part||base.startsWith(part+'_')&&
      !furniturePaths.some(other=>other.length>part.length&&base.startsWith(other+'_')));
    return group?{path:'furniture/'+group+'/'+base+'.png',
      mirrored:String(type).endsWith(':left')}:null;
  }
  const positions=[
    [3,16],[3,18],[7,16],[7,18],[3,14],[7,14],
    [13,14],[14,16],[14,13]
  ];
  function seatFor(index,layout){
    const count=positions.length,segment=Math.floor(index/count),seat=positions[index%count];
    return {segment,col:seat[0],row:seat[1],x:(segment*layout.cols+seat[0]+.5)*TILE,
      y:(seat[1]+.5)*TILE};
  }
  function mount(initial={}){
    const board=document.getElementById('crew-pixel-office');
    const canvas=document.getElementById('crew-pixel-canvas');
    const layer=document.getElementById('crew-pixel-roles');
    const note=document.getElementById('crew-pixel-feedback');
    if(!board||!canvas||!layer||!note)return null;
    const ctx=canvas.getContext('2d');
    if(!ctx){note.textContent='Canvas 無法使用，請從角色選單切換';return null;}
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
    const assets=new Map(),failed=new Set(),loadTasks=[];
    let disposed=false,paused=false,polling=false,ready=false,synced=false,roles=[];
    let width=1,height=1,layout=null,selectedId=initial?.selectedId||window.getCurrentRoleId?.()||null;
    let refreshTimer=null,frameTimer=null,observer=null,panX=168,panY=254,zoom=2.2;
    const pointers=new Map(),lastGesture={dragged:false};
    let animationTick=0,loadingError=false;
    board.hidden=false;
    function getAsset(path){return assets.get(path)||null;}
    function scheduleAsset(path){
      if(assets.has(path)||failed.has(path))return;
      const img=new Image();
      assets.set(path,null);
      const promise=new Promise(resolve=>{
        let remote=false;
        img.onload=()=>{
          if(disposed){resolve();return;}
          assets.set(path,img);draw();resolve();
        };
        img.onerror=()=>{
          if(!remote){remote=true;img.src=FALLBACK+path;return;}
          failed.add(path);assets.delete(path);loadingError=true;draw();resolve();
        };
        img.src=BASE+path;
      });
      loadTasks.push(promise);
    }
    const roomFloor=(tile)=>tile===1?'#a99c8b':tile===7?'#526f88':'#7a7f86';
    function renderRoom(roomIdx){
      if(!layout)return;
      const shift=roomIdx*layout.cols*TILE;
      const top=layout.rows;
      for(let row=0;row<top;row++)for(let col=0;col<layout.cols;col++){
        const tile=layout.tiles[row*layout.cols+col],x=shift+col*TILE,y=row*TILE;
        if(tile===255)continue;
        if(tile===0){
          ctx.fillStyle='#2d3d4a';ctx.fillRect(x,y,16,16);
          const sprite=getAsset('walls/wall_0.png');
          if(sprite){
            let mask=0;
            if(row>0&&layout.tiles[(row-1)*layout.cols+col]===0)mask|=1;
            if(col<layout.cols-1&&layout.tiles[row*layout.cols+col+1]===0)mask|=2;
            if(row<layout.rows-1&&layout.tiles[(row+1)*layout.cols+col]===0)mask|=4;
            if(col>0&&layout.tiles[row*layout.cols+col-1]===0)mask|=8;
            ctx.drawImage(sprite,(mask%4)*16,Math.floor(mask/4)*32,16,32,x,y-16,16,32);
          }
          continue;
        }
        const file='floors/floor_'+Math.max(0,Math.min(8,tile-1))+'.png';
        const sprite=getAsset(file);
        ctx.fillStyle=roomFloor(tile);ctx.fillRect(x,y,16,16);
        if(sprite){
          ctx.save();ctx.globalAlpha=.44;ctx.drawImage(sprite,x,y,16,16);ctx.restore();
        }
      }
    }
    function drawActor(role,index,seat){
      const sprite=getAsset('characters/char_'+role.palette+'.png');
      const charY=seat.y-CHAR_H+7,charX=seat.x-CHAR_W/2;
      if(sprite){
        // Exact 112x96 upstream sprite sheet: 3 directions x 7 frames.
        const frame=role.state==='working'&&!reduced?3+(animationTick%2):0;
        ctx.drawImage(sprite,frame*CHAR_W,0,CHAR_W,CHAR_H,charX,charY,CHAR_W,CHAR_H);
      }else{
        ctx.fillStyle='#bcb4a5';ctx.fillRect(charX+4,charY+7,8,21);
      }
      if(role.id===selectedId){
        ctx.strokeStyle='#d7f8ff';ctx.lineWidth=1;
        ctx.strokeRect(Math.round(charX)-2,Math.round(charY)-2,CHAR_W+4,CHAR_H+4);
      }
      if(role.state==='waiting'||role.attention>0){
        ctx.fillStyle='#ffdb85';ctx.fillRect(seat.x+7,charY-7,10,10);
        ctx.font='bold 9px monospace';ctx.fillStyle='#533f24';ctx.fillText('!',seat.x+10,charY+1);
      }
    }
    function worldToScreen(x,y){
      return{x:width/2+(x-panX)*zoom,y:height/2+(y-panY)*zoom};
    }
    function snapCamera(){
      if(!layout)return;
      const worldW=layout.cols*TILE*Math.max(1,Math.ceil(roles.length/positions.length));
      panX=Math.max(Math.min(panX,worldW+80-width/zoom/2),width/zoom/2-80);
      panY=Math.max(142,Math.min(338,panY));
    }
    function redrawControls(){
      if(disposed||paused||!layout)return;
      layer.replaceChildren();
      roles.forEach((role,index)=>{
        const seat=seatFor(index,layout),point=worldToScreen(seat.x,seat.y);
        if(point.x < -80||point.x>width+80||point.y< -100||point.y>height+100)return;
        const button=document.createElement('button');
        button.type='button';button.className='crew-pixel-role';
        button.dataset.state=role.state;
        button.dataset.attention=String(role.attention>0);
        button.style.left=point.x+'px';button.style.top=(point.y+30*zoom)+'px';
        button.setAttribute('aria-pressed',String(role.id===selectedId));
        button.setAttribute('aria-label',role.name+' · '+labelFor[role.state]+' · 切換對話');
        const dot=document.createElement('span');dot.className='crew-pixel-state';dot.setAttribute('aria-hidden','true');
        const name=document.createElement('strong');name.textContent=role.name;
        button.append(dot,name);
        button.addEventListener('click',()=>selectRole(role.id));
        layer.appendChild(button);
      });
    }
    function draw(){
      if(disposed||paused||!layout||board.hidden)return;
      const pixelRatio=Math.min(2,window.devicePixelRatio||1);
      const nextW=Math.max(1,board.clientWidth||window.innerWidth||320);
      const nextH=Math.max(1,board.clientHeight||window.innerHeight||600);
      if(width!==nextW||height!==nextH){
        width=nextW;height=nextH;
        canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);
      }
      const sX=canvas.width/width,sY=canvas.height/height;
      ctx.setTransform(sX,0,0,sY,0,0);
      ctx.imageSmoothingEnabled=false;
      ctx.fillStyle='#171c28';ctx.fillRect(0,0,width,height);
      ctx.save();
      ctx.translate(width/2-panX*zoom,height/2-panY*zoom);
      ctx.scale(zoom,zoom);
      const rooms=Math.max(1,Math.ceil(roles.length/positions.length));
      for(let room=0;room<rooms;room++)renderRoom(room);
      const drawables=[];
      for(let room=0;room<rooms;room++){
        for(const f of layout.furniture){
          const ref=resolveFurniture(f.type);if(!ref)continue;
          const asset=getAsset(ref.path);
          if(!asset)continue;
          let file=asset;
          if(f.type==='PC_FRONT_OFF'){
            const team=roles.slice(room*positions.length,(room+1)*positions.length);
            if(team.some(r=>r.state==='working')){
              const next=getAsset('furniture/PC/PC_FRONT_ON_'+(1+animationTick%3)+'.png');
              if(next)file=next;
            }
          }
          drawables.push({depth:f.row*TILE+file.height,
            draw:()=>{
              const x=(room*layout.cols+f.col)*TILE,y=f.row*TILE;
              if(ref.mirrored){
                ctx.save();ctx.translate(x+file.width,y);ctx.scale(-1,1);
                ctx.drawImage(file,0,0);ctx.restore();
              }else ctx.drawImage(file,x,y);
            }
          });
        }
      }
      roles.forEach((role,index)=>{
        const seat=seatFor(index,layout);
        drawables.push({depth:seat.y+TILE/2+.1,draw:()=>drawActor(role,index,seat)});
      });
      drawables.sort((a,b)=>a.depth-b.depth).forEach(entry=>entry.draw());
      ctx.restore();
      redrawControls();
    }
    function selectRole(id){
      const role=roles.find(entry=>entry.id===id);
      if(disposed||!role)return false;
      selectedId=id;
      const seat=seatFor(roles.indexOf(role),layout);
      // Focus the selected workstation, without moving the actual agent.
      const point=worldToScreen(seat.x,seat.y);
      if(point.x<50||point.x>width-50||point.y<90||point.y>height-100){
        panX=seat.x;panY=seat.y+30;
      }
      snapCamera();draw();
      window.CrewWorldHost?.onSelectedRole?.(role.id,role.name);
      return true;
    }
    async function sync(){
      if(disposed||paused||polling||document.hidden)return;
      polling=true;
      try{
        const res=await fetch('/api/crew-status',{cache:'no-store',credentials:'same-origin'});
        if(!res.ok)throw Error('status HTTP '+res.status);
        const data=await res.json();
        if(data.success!==true||!Array.isArray(data.roles))throw Error('invalid Crew roster');
        if(disposed||paused)return;
        const next=projectRoles(data.roles);
        const diff=JSON.stringify(next)!==JSON.stringify(roles);
        roles=next;synced=true;
        if(selectedId&&!roles.some(role=>role.id===selectedId))selectedId=null;
        if(diff)draw();
        note.textContent=roles.length?
          'CREW OFFICE · '+roles.length+' ROLES · '+roles.filter(r=>r.state==='working').length+' WORKING':
          'CREW OFFICE · 尚無 Role';
      }catch(_){
        if(disposed||paused)return;
        synced=false;roles=roles.map(role=>({...role,state:'unknown',work:'',attention:0}));
        note.textContent='CREW OFFICE · Runtime 未同步';
        draw();
      }finally{polling=false;}
    }
    function gesturePoint(event){
      const rect=canvas.getBoundingClientRect();
      return{x:event.clientX-rect.left,y:event.clientY-rect.top};
    }
    function onPointerDown(event){
      if(disposed)return;
      event.preventDefault();canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId,gesturePoint(event));lastGesture.dragged=false;
    }
    function onPointerMove(event){
      if(!pointers.has(event.pointerId)||disposed||paused)return;
      const point=gesturePoint(event),prev=pointers.get(event.pointerId);
      if(pointers.size===1){
        const dx=point.x-prev.x,dy=point.y-prev.y;
        if(Math.abs(dx)+Math.abs(dy)>2)lastGesture.dragged=true;
        panX-=dx/zoom;panY-=dy/zoom;
      }else if(pointers.size===2){
        const other=[...pointers].find(([k])=>k!==event.pointerId)?.[1];
        if(other){
          const oldDistance=Math.hypot(prev.x-other.x,prev.y-other.y);
          const newDistance=Math.hypot(point.x-other.x,point.y-other.y);
          if(oldDistance>5)zoom=Math.max(.9,Math.min(5,zoom*newDistance/oldDistance));
          lastGesture.dragged=true;
        }
      }
      pointers.set(event.pointerId,point);snapCamera();draw();
    }
    function onPointerUp(event){
      const point=gesturePoint(event);pointers.delete(event.pointerId);
      if(disposed||lastGesture.dragged||!layout)return;
      const x=panX+(point.x-width/2)/zoom,y=panY+(point.y-height/2)/zoom;
      const nearest=roles.map((r,i)=>({r,d:Math.hypot(seatFor(i,layout).x-x,seatFor(i,layout).y-y)}))
        .sort((a,b)=>a.d-b.d)[0];
      if(nearest&&nearest.d<20)selectRole(nearest.r.id);
    }
    function onPointerCancel(event){pointers.delete(event.pointerId);}
    function onResize(){if(!disposed&&!paused)draw();}
    canvas.addEventListener('pointerdown',onPointerDown);
    canvas.addEventListener('pointermove',onPointerMove);
    canvas.addEventListener('pointerup',onPointerUp);
    canvas.addEventListener('pointercancel',onPointerCancel);
    const reset=document.getElementById('world-reset');
    const zoomIn=document.getElementById('world-zoom-in');
    const zoomOut=document.getElementById('world-zoom-out');
    function resetCamera(){
      zoom=Math.max(1.05,Math.min(2.4,(width-32)/(21*TILE)));
      const roleIndex=roles.findIndex(r=>r.id===selectedId);
      panX=(Math.max(0,Math.floor(Math.max(0,roleIndex)/positions.length))*21+10.5)*TILE;
      panY=255;draw();
    }
    function zoomBy(factor){zoom=Math.min(5,Math.max(.9,zoom*factor));snapCamera();draw();}
    const handleReset=()=>resetCamera(),handleIn=()=>zoomBy(1.25),handleOut=()=>zoomBy(.8);
    reset?.addEventListener('click',handleReset);
    zoomIn?.addEventListener('click',handleIn);
    zoomOut?.addEventListener('click',handleOut);
    window.addEventListener('resize',onResize);
    if(window.ResizeObserver){observer=new window.ResizeObserver(onResize);observer.observe(board);}
    function stopTimers(){
      window.clearInterval(refreshTimer);window.clearInterval(frameTimer);
      refreshTimer=null;frameTimer=null;
    }
    function startTimers(){
      stopTimers();
      paused=false;
      refreshTimer=window.setInterval(()=>{void sync();},5500);
      if(!reduced)frameTimer=window.setInterval(()=>{
        if(roles.some(role=>role.state==='working')){
          animationTick++;draw();
        }
      },FRAME_TIME);
      void sync();
      draw();
    }
    async function start(){
      try{
        const res=await fetch(sourceLayouts,{credentials:'same-origin'});
        if(!res.ok)throw Error('layout unavailable');
        const data=await res.json();
        if(!Number.isInteger(data.cols)||data.cols!==21||data.rows!==22||!Array.isArray(data.tiles)||
          data.tiles.length!==data.cols*data.rows||!Array.isArray(data.furniture))throw Error('invalid Pixel Agents layout');
        if(disposed)return;
        layout=data;
        for(let i=0;i<6;i++)scheduleAsset('characters/char_'+i+'.png');
        for(let i=0;i<9;i++)scheduleAsset('floors/floor_'+i+'.png');
        scheduleAsset('walls/wall_0.png');
        for(const f of layout.furniture){
          const ref=resolveFurniture(f.type);if(ref)scheduleAsset(ref.path);
        }
        for(let i=1;i<=3;i++)scheduleAsset('furniture/PC/PC_FRONT_ON_'+i+'.png');
        ready=true;draw();
        // Do not claim full fidelity while remote asset downloads are incomplete.
        await Promise.allSettled(loadTasks);
        if(!disposed)draw();
      }catch(error){
        if(!disposed)note.textContent='無法載入 Pixel Agents 佈局：'+error.message;
      }
    }
    const dispose=()=>{
      if(disposed)return;
      disposed=true;stopTimers();observer?.disconnect();layer.replaceChildren();
      canvas.removeEventListener('pointerdown',onPointerDown);
      canvas.removeEventListener('pointermove',onPointerMove);
      canvas.removeEventListener('pointerup',onPointerUp);
      canvas.removeEventListener('pointercancel',onPointerCancel);
      reset?.removeEventListener('click',handleReset);
      zoomIn?.removeEventListener('click',handleIn);
      zoomOut?.removeEventListener('click',handleOut);
      window.removeEventListener('resize',onResize);
      board.hidden=true;
    };
    dispose.pause=()=>{paused=true;stopTimers();};
    dispose.resume=()=>{if(!disposed){board.hidden=false;startTimers();}};
    dispose.getCameraState=()=>({selectedId,panX,panY,zoom});
    dispose.selectRole=selectRole;
    startTimers();
    void start();
    return dispose;
  }
  window.CrewPixelOffice={projectRoles,resolveFurniture,seatFor};
  window.mountCrewPixelOfficeScene=mount;
})();
