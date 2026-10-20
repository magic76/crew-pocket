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
    const group=[...furniturePaths].sort((a,b)=>b.length-a.length)
      .find(part=>base===part||base.startsWith(part+'_'));
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
    const assets=new Map(),failed=new Set(),loadTasks=[],outlineCache=new Map(),tintedSprites=new Map();
    const config=window.CrewPixelConfig;
    let prefs=config?.read?.()||{labelMode:'selected',outline:true,followSelection:true,
      interaction:'direct',showPets:false,appearance:{},placements:{},layout:null};
    let placements={...prefs.placements};
    const walkers=new Map();
    let editMode=false,editTool='move',selectedFurnitureUid=null,hoveredId=null;
    let dragItem=null;
    let undoStack=[],redoStack=[];
    function persist(){
      prefs.placements=placements;
      prefs.layout=layout&&prefs.layout?layout:prefs.layout;
      prefs=config?.write?.(prefs)||prefs;
      placements=prefs.placements;
    }
    function roleSeat(role,index){
      return layout&&placements[role.id]&&config?config.seatWorld(placements[role.id],layout):seatFor(index,layout);
    }
    function appearanceOf(role){
      const value=prefs.appearance?.[role.id];
      return Number.isInteger(value)&&value>=0&&value<24?value:role.palette;
    }
    function paletteFor(role){return appearanceOf(role)%6;}
    const costumeColors=[null,[56,113,198],[49,159,113],[208,92,105]];
    // Variations recolor only the torso on the original sprite atlas. Face,
    // hairstyle, outlines, directions and original animations stay unchanged.
    function actorSprite(role){
      const base=getAsset('characters/char_'+paletteFor(role)+'.png');
      const outfit=Math.floor(appearanceOf(role)/6);
      if(!base||outfit===0)return base;
      const key=paletteFor(role)+':'+outfit;
      if(tintedSprites.has(key))return tintedSprites.get(key)||base;
      let custom=null;
      try{
        const sheet=document.createElement('canvas');
        sheet.width=base.width;sheet.height=base.height;
        const c=sheet.getContext('2d',{willReadFrequently:true});
        c.drawImage(base,0,0);
        const image=c.getImageData(0,0,sheet.width,sheet.height);
        const rgb=costumeColors[outfit];
        for(let y=0;y<sheet.height;y++){
          const localY=y%CHAR_H;
          if(localY<16||localY>26)continue;
          for(let x=0;x<sheet.width;x++){
            const localX=x%CHAR_W;
            if(localX<3||localX>12)continue;
            const i=(y*sheet.width+x)*4;
            const r=image.data[i],g=image.data[i+1],b=image.data[i+2],alpha=image.data[i+3];
            if(alpha<90||Math.max(r,g,b)<42)continue;
            // Preserve skin-toned arms and all exposed skin pixels.
            if(r>g+16&&g>b+9&&r>112&&g>68)continue;
            const value=Math.max(.4,Math.min(1.35,(r+g+b)/350));
            for(let k=0;k<3;k++)
              image.data[i+k]=Math.round(image.data[i+k]*.16+rgb[k]*value*.84);
          }
        }
        c.putImageData(image,0,0);
        custom=sheet;
      }catch(_){/* Keep original sprite if pixel readback is restricted. */}
      tintedSprites.set(key,custom);
      return custom||base;
    }
    function rolePosition(role,index){
      const seat=roleSeat(role,index),move=walkers.get(role.id);
      return move&&role.state==='idle'?{...seat,x:move.x,y:move.y}:seat;
    }
    let disposed=false,paused=false,polling=false,ready=false,synced=false,roles=[];
    let width=1,height=1,layout=null,selectedId=initial?.selectedId||window.getCurrentRoleId?.()||null;
    let refreshTimer=null,frameTimer=null,observer=null,
      panX=Number.isFinite(initial?.panX)?initial.panX:168,
      panY=Number.isFinite(initial?.panY)?initial.panY:254,
      zoom=Number.isFinite(initial?.zoom)?Math.max(.25,Math.min(5,initial.zoom)):2.2;
    const pointers=new Map(),lastGesture={dragged:false};
    let animationTick=0,loadingError=false,controlsSignature='',contextUsageByRole=new Map();
    let mouseDownStart=null;
    let initialFocusDone=false;
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
          assets.set(path,img);draw();
          if(path.startsWith('characters/'))refreshAvatarPreview();
          resolve();
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
      const sprite=actorSprite(role);
      const charY=seat.y-CHAR_H+7,charX=seat.x-CHAR_W/2;
      if(sprite){
        // Exact 112x96 upstream sprite sheet: 3 directions x 7 frames.
        const frame=role.state==='working'&&!reduced?3+(animationTick%2):0;
        ctx.drawImage(sprite,frame*CHAR_W,0,CHAR_W,CHAR_H,charX,charY,CHAR_W,CHAR_H);
      }else{
        ctx.fillStyle='#bcb4a5';ctx.fillRect(charX+4,charY+7,8,21);
      }
      if(sprite&&prefs.outline&&(role.id===selectedId||role.id===hoveredId)){
        const alpha=role.id===selectedId?1:.55;
        const frame=role.state==='working'&&!reduced?3+(animationTick%2):0;
        const key=appearanceOf(role)+':'+frame;
        let outline=outlineCache.get(key);
        if(outline===undefined){
          outline=null;
          try{
            const temp=document.createElement('canvas');temp.width=CHAR_W;temp.height=CHAR_H;
            const t=temp.getContext('2d',{willReadFrequently:true});
            t.drawImage(sprite,frame*CHAR_W,0,CHAR_W,CHAR_H,0,0,CHAR_W,CHAR_H);
            const pixels=t.getImageData(0,0,CHAR_W,CHAR_H).data;
            const edge=document.createElement('canvas');edge.width=CHAR_W+2;edge.height=CHAR_H+2;
            const e=edge.getContext('2d');e.fillStyle='#dcfaff';
            const solid=(x,y)=>x>=0&&x<CHAR_W&&y>=0&&y<CHAR_H&&pixels[(y*CHAR_W+x)*4+3]>16;
            for(let y=0;y<CHAR_H;y++)for(let x=0;x<CHAR_W;x++)if(solid(x,y))
              for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])
                if(!solid(x+dx,y+dy))e.fillRect(x+dx+1,y+dy+1,1,1);
            outline=edge;
          }catch(_){/* WebViews lacking pixel readback keep Role focus accessible. */}
          outlineCache.set(key,outline);
        }
        if(outline){ctx.save();ctx.globalAlpha=alpha;
          ctx.drawImage(outline,Math.round(charX)-1,Math.round(charY)-1);ctx.restore();}
      }
      if(role.state==='waiting'||role.attention>0){
        ctx.fillStyle='#ffdb85';ctx.fillRect(seat.x+7,charY-7,10,10);
        ctx.font='bold 9px monospace';ctx.fillStyle='#533f24';ctx.fillText('!',seat.x+10,charY+1);
      }
    }
    function syncContextWarnings(){
      const gauge=window.CrewContextUsage;
      contextUsageByRole=new Map();
      let warnings=0;
      if(gauge){
        for(const role of roles){
          const description=gauge.describe(gauge.get(role.id));
          contextUsageByRole.set(role.id,description);
          if(description.tone==='warning'||description.tone==='critical')warnings++;
        }
      }
      note.dataset.contextWarningCount=String(warnings);
    }
    function worldToScreen(x,y){
      return{x:width/2+(x-panX)*zoom,y:height/2+(y-panY)*zoom};
    }
    function snapCamera(){
      if(!layout)return;
      const worldW=layout.cols*TILE*Math.max(1,Math.ceil(roles.length/positions.length));
      // Clamp world origin independently from screen size; don't trap the camera
      // off-screen on narrow phones or prevent centering on the first desk.
      const mx=Math.min(96,width/(zoom*2)),my=Math.min(96,height/(zoom*2));
      panX=Math.min(worldW+mx,Math.max(-mx,panX));
      panY=Math.min(layout.rows*TILE+my,Math.max(-my,panY));
    }
    function focusInitialCamera(){
      if(initialFocusDone||!layout||!selectedId||
        Number.isFinite(initial?.panX)||Number.isFinite(initial?.panY))return;
      const index=roles.findIndex(role=>role.id===selectedId);
      if(index<0)return;
      const seat=roleSeat(roles[index],index);
      panX=seat.x+(seat.col<layout.cols/2?45:-45);
      panY=seat.y+22;
      snapCamera();
      initialFocusDone=true;
    }
    function redrawControls(){
      if(disposed||paused||!layout)return;
      board.dataset.labelMode=prefs.labelMode;
      board.dataset.editing=String(editMode);
      const signature=JSON.stringify([roles.map(role=>[role.id,role.name,role.state,role.attention]),
        selectedId,prefs.labelMode,editMode,Math.round(panX*100)/100,Math.round(panY*100)/100,
        Math.round(zoom*1000)/1000,width,height]);
      if(signature===controlsSignature)return;
      controlsSignature=signature;
      layer.replaceChildren();
      roles.forEach((role,index)=>{
        const seat=rolePosition(role,index),point=worldToScreen(seat.x,seat.y);
        if(point.x < -80||point.x>width+80||point.y< -100||point.y>height+100)return;
        const button=document.createElement('button');
        button.type='button';button.className='crew-pixel-role';
        button.dataset.state=role.state;
        button.dataset.attention=String(role.attention>0);
        button.dataset.labelMode=prefs.labelMode;
        const context=contextUsageByRole.get(role.id);
        button.dataset.contextTone=context?.tone||'unknown';
        button.title=role.name+' · '+labelFor[role.state]+
          (context?.known?' · Context '+context.label:'');
        button.style.left=point.x+'px';button.style.top=(point.y+30*zoom)+'px';
        button.setAttribute('aria-pressed',String(role.id===selectedId));
        button.setAttribute('aria-label',role.name+' · '+labelFor[role.state]+' · 切換對話');
        const dot=document.createElement('span');dot.className='crew-pixel-state';dot.setAttribute('aria-hidden','true');
        const name=document.createElement('strong');name.textContent=role.name;
        if(context?.known&&(context.tone==='warning'||context.tone==='critical')){
          const warning=document.createElement('span');
          warning.className='crew-pixel-context';warning.textContent=context.label;
          warning.setAttribute('aria-label','Context '+context.label);
          button.append(warning);
        }
        button.append(dot,name);
        button.addEventListener('click',()=>{if(!editMode)selectRole(role.id,{open:true});});
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
        const seat=rolePosition(role,index);
        drawables.push({depth:seat.y+TILE/2+.1,draw:()=>drawActor(role,index,seat)});
      });
      if(prefs.showPets){
        const pet=getAsset('pets/gitcat/pet.png'),friend=getAsset('pets/claudio/pet.png');
        const pets=[pet,friend];
        for(let i=0;i<pets.length;i++){
          if(!pets[i])continue;
          const px=170+i*32,py=270+i*19;
          drawables.push({depth:py,draw:()=>ctx.drawImage(pets[i],(animationTick%3)*16,0,16,32,px,py-32,16,32)});
        }
      }
      drawables.sort((a,b)=>a.depth-b.depth).forEach(entry=>entry.draw());
      if(editMode){
        ctx.save();ctx.lineWidth=.25;ctx.strokeStyle='rgba(175,223,251,.22)';
        const n=Math.max(1,Math.ceil(roles.length/positions.length));
        for(let r=0;r<n;r++){
          const offset=r*layout.cols*TILE;
          for(let x=0;x<=layout.cols;x++){
            ctx.beginPath();ctx.moveTo(offset+x*TILE,0);
            ctx.lineTo(offset+x*TILE,layout.rows*TILE);ctx.stroke();
          }
          for(let y=0;y<=layout.rows;y++){
            ctx.beginPath();ctx.moveTo(offset,y*TILE);
            ctx.lineTo(offset+layout.cols*TILE,y*TILE);ctx.stroke();
          }
        }
        const selected=layout.furniture.find(f=>f.uid===selectedFurnitureUid);
        if(selected){
          const dim=config?.shape(selected)||[1,1];
          const room=roles.findIndex(role=>role.id===selectedId);
          const offset=Math.max(0,Math.floor(Math.max(0,room)/positions.length))*layout.cols*TILE;
          ctx.lineWidth=1;ctx.strokeStyle='#b6fbff';
          ctx.strokeRect(offset+selected.col*TILE,selected.row*TILE,dim[0]*TILE,dim[1]*TILE);
        }
        ctx.restore();
      }
      ctx.restore();
      redrawControls();
    }
    function focusSelected(){
      const index=roles.findIndex(role=>role.id===selectedId);
      if(index<0||!layout)return;
      const seat=rolePosition(roles[index],index);
      panX=seat.x;panY=seat.y+10;snapCamera();draw();
    }
    function selectRole(id,{open=true}={}){
      const role=roles.find(entry=>entry.id===id);
      if(disposed||!role)return false;
      const same=selectedId===id;
      selectedId=id;
      if(prefs.followSelection)focusSelected();
      else draw();
      syncControls();
      if(open&&(prefs.interaction==='direct'||same))
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
        if(layout&&config){
          const stable=config.allocateRoles(roles.map(role=>role.id),layout,placements);
          const needsUpdate=JSON.stringify(stable)!==JSON.stringify(
            Object.fromEntries(roles.map(r=>[r.id,placements[r.id]])));
          placements=stable;
          if(needsUpdate)persist();
        }
        if(selectedId&&!roles.some(role=>role.id===selectedId))selectedId=null;
        focusInitialCamera();
        syncContextWarnings();
        syncControls();
        if(diff)draw();
        note.textContent=roles.length?
          'CREW OFFICE · '+roles.length+' ROLES · '+roles.filter(r=>r.state==='working').length+' WORKING':
          'CREW OFFICE · 尚無 Role';
      }catch(_){
        if(disposed||paused)return;
        synced=false;roles=roles.map(role=>({...role,state:'unknown',work:'',attention:0}));
        syncContextWarnings();
        note.textContent='CREW OFFICE · Runtime 未同步';
        draw();
      }finally{polling=false;}
    }
    function gesturePoint(event){
      const rect=canvas.getBoundingClientRect();
      return{x:event.clientX-rect.left,y:event.clientY-rect.top};
    }
    function onPointerDown(event){
      if(disposed||paused)return;
      event.preventDefault();canvas.setPointerCapture?.(event.pointerId);
      const point=gesturePoint(event);
      if(pointers.size===0){lastGesture.dragged=false;mouseDownStart=point;}
      else lastGesture.dragged=true;
      pointers.set(event.pointerId,point);
    }
    function onPointerMove(event){
      if(disposed||paused)return;
      if(!pointers.has(event.pointerId)){
        if(event.pointerType==='mouse'&&!editMode&&layout){
          const point=gesturePoint(event);
          const wx=panX+(point.x-width/2)/zoom,wy=panY+(point.y-height/2)/zoom;
          const hovered=roles.findIndex((role,index)=>{
            const seat=rolePosition(role,index);
            return Math.abs(wx-seat.x)<=11&&Math.abs(wy-(seat.y-9))<19;
          });
          const id=hovered>=0?roles[hovered].id:null;
          if(id!==hoveredId){hoveredId=id;draw();}
        }
        return;
      }
      const point=gesturePoint(event),prev=pointers.get(event.pointerId);
      if(pointers.size===1){
        const dx=point.x-prev.x,dy=point.y-prev.y;
        if(mouseDownStart&&Math.hypot(point.x-mouseDownStart.x,point.y-mouseDownStart.y)>7)
          lastGesture.dragged=true;
        if(lastGesture.dragged){panX-=dx/zoom;panY-=dy/zoom;}
      }else if(pointers.size===2){
        const other=[...pointers].find(([k])=>k!==event.pointerId)?.[1];
        if(other){
          const oldDistance=Math.hypot(prev.x-other.x,prev.y-other.y);
          const newDistance=Math.hypot(point.x-other.x,point.y-other.y);
          if(oldDistance>5){
            const anchor={x:(point.x+other.x)/2,y:(point.y+other.y)/2};
            const wx=panX+(anchor.x-width/2)/zoom,wy=panY+(anchor.y-height/2)/zoom;
            zoom=Math.max(.25,Math.min(5,zoom*newDistance/oldDistance));
            panX=wx-(anchor.x-width/2)/zoom;
            panY=wy-(anchor.y-height/2)/zoom;
          }
          lastGesture.dragged=true;
        }
      }
      pointers.set(event.pointerId,point);snapCamera();draw();
    }
    function onPointerUp(event){
      if(!pointers.has(event.pointerId))return;
      const point=gesturePoint(event);pointers.delete(event.pointerId);
      if(disposed||paused||lastGesture.dragged||pointers.size||!layout)return;
      const x=panX+(point.x-width/2)/zoom,y=panY+(point.y-height/2)/zoom;
      if(editMode){applyEdit(x,y);return;}
      const nearest=roles.map((r,i)=>{
        const seat=rolePosition(r,i);
        return{r,d:Math.hypot(seat.x-x,seat.y-9-y)};
      }).sort((a,b)=>a.d-b.d)[0];
      if(nearest&&nearest.d<21)selectRole(nearest.r.id,{open:true});
    }

    // Editing is separate from Crew Runtime: only cosmetic browser-local data.
    const byId=id=>document.getElementById(id);
    const settingPanel=byId('crew-pixel-settings'),editorPanel=byId('crew-pixel-editor');
    const toggleSettings=byId('crew-pixel-settings-toggle'),closeSettings=byId('crew-pixel-settings-close');
    const toggleEdit=byId('crew-pixel-edit-toggle'),doneEdit=byId('crew-pixel-edit-done');
    const labelInput=byId('crew-pixel-label-mode'),outlineInput=byId('crew-pixel-outline');
    const followInput=byId('crew-pixel-follow'),interactionInput=byId('crew-pixel-interaction');
    const appearanceInput=byId('crew-pixel-appearance'),petsInput=byId('crew-pixel-pets');
    const editToolInput=byId('crew-pixel-edit-tool'),furnitureInput=byId('crew-pixel-furniture-type');
    const editRoleInput=byId('crew-pixel-edit-role');
    const preview=byId('crew-pixel-avatar-preview');
    const modeFurniture=byId('crew-pixel-mode-furniture'),modeRole=byId('crew-pixel-mode-role'),
      modeTile=byId('crew-pixel-mode-tile');
    const addFurniture=byId('crew-pixel-add'),deleteFurniture=byId('crew-pixel-delete');
    const furnitureActions=byId('crew-pixel-furniture-actions');
    const editRoleGroup=byId('crew-pixel-edit-role-group');
    const tileActions=byId('crew-pixel-tile-actions');
    const wallPaint=byId('crew-pixel-wall-paint'),floorPaint=byId('crew-pixel-floor-paint'),
      eraseTile=byId('crew-pixel-erase-tile');
    const floorInput=byId('crew-pixel-floor-type'),editHint=byId('crew-pixel-editor-hint');
    const undoButton=byId('crew-pixel-undo'),redoButton=byId('crew-pixel-redo');
    const rotateButton=byId('crew-pixel-rotate'),duplicateButton=byId('crew-pixel-duplicate');
    const resetLayoutButton=byId('crew-pixel-reset-layout');
    const exportButton=byId('crew-pixel-export'),importButton=byId('crew-pixel-import');
    const importFile=byId('crew-pixel-import-file');
    const floorGroup=byId('crew-pixel-floor-group'),furnitureGroup=byId('crew-pixel-furniture-group');
    let defaultLayout=null;
    const editorMode=()=>editTool==='role'?'role':
      ['floor','wall','erase'].includes(editTool)?'tile':'furniture';
    function refreshAvatarPreview(){
      const role=roles.find(r=>r.id===selectedId);
      const pctx=preview?.getContext?.('2d');
      if(!pctx||!role)return;
      pctx.setTransform?.(1,0,0,1,0,0);
      pctx.clearRect?.(0,0,48,96);
      pctx.imageSmoothingEnabled=false;
      const sprite=actorSprite(role);
      if(sprite)pctx.drawImage(sprite,0,0,16,32,0,0,48,96);
    }
    const controls=[];
    function listen(el,type,handler){
      if(!el)return;
      el.addEventListener(type,handler);controls.push([el,type,handler]);
    }
    function updateEditorHint(message){
      if(editHint)editHint.textContent=message;
    }
    function syncControls(){
      if(board.dataset){
        board.dataset.labelMode=prefs.labelMode;
        board.dataset.editing=String(editMode);
      }
      if(labelInput)labelInput.value=prefs.labelMode;
      if(outlineInput)outlineInput.checked=prefs.outline;
      if(followInput)followInput.checked=prefs.followSelection;
      if(interactionInput)interactionInput.value=prefs.interaction;
      if(petsInput)petsInput.checked=prefs.showPets;
      const selected=roles.find(role=>role.id===selectedId);
      if(editRoleInput){
        const signature=roles.map(r=>r.id+'\\u0001'+r.name).join('\\u0002');
        if(editRoleInput.dataset.signature!==signature){
          editRoleInput.replaceChildren();
          for(const role of roles){
            const o=document.createElement('option');
            o.value=role.id;o.textContent=role.name;
            editRoleInput.appendChild(o);
          }
          editRoleInput.dataset.signature=signature;
        }
        if(selectedId)editRoleInput.value=selectedId;
      }
      if(appearanceInput){
        appearanceInput.disabled=!selected;
        if(selected)appearanceInput.value=String(appearanceOf(selected));
      }
      refreshAvatarPreview();
      if(editToolInput)editToolInput.value=editTool;
      if(furnitureGroup)furnitureGroup.hidden=editTool!=='place';
      if(editRoleGroup)editRoleGroup.hidden=editorMode()!=='role';
      if(floorGroup)floorGroup.hidden=editTool!=='floor';
      if(furnitureActions)furnitureActions.hidden=editorMode()!=='furniture';
      if(tileActions)tileActions.hidden=editorMode()!=='tile';
      if(addFurniture)addFurniture.setAttribute('aria-pressed',String(editTool==='place'));
      if(modeFurniture)modeFurniture.setAttribute('aria-pressed',String(editorMode()==='furniture'));
      if(modeRole)modeRole.setAttribute('aria-pressed',String(editorMode()==='role'));
      if(modeTile)modeTile.setAttribute('aria-pressed',String(editorMode()==='tile'));
      if(wallPaint)wallPaint.setAttribute('aria-pressed',String(editTool==='wall'));
      if(floorPaint)floorPaint.setAttribute('aria-pressed',String(editTool==='floor'));
      if(eraseTile)eraseTile.setAttribute('aria-pressed',String(editTool==='erase'));
      if(undoButton)undoButton.disabled=!undoStack.length;
      if(redoButton)redoButton.disabled=!redoStack.length;
      if(rotateButton)rotateButton.disabled=!selectedFurnitureUid;
      if(duplicateButton)duplicateButton.disabled=!selectedFurnitureUid;
      if(deleteFurniture)deleteFurniture.disabled=!selectedFurnitureUid;
      if(toggleEdit)toggleEdit.setAttribute('aria-pressed',String(editMode));
    }
    const setPrefs=(key,value)=>{
      prefs[key]=value;persist();controlsSignature='';syncControls();draw();
    };
    function showSettings(show){
      if(settingPanel)settingPanel.hidden=!show;
      toggleSettings?.setAttribute('aria-expanded',String(show));
      if(show&&editorPanel)editorPanel.hidden=true;
      if(show&&editMode){editMode=false;selectedFurnitureUid=null;}
      syncControls();
    }
    function showEditor(show){
      if(editorPanel)editorPanel.hidden=!show;
      if(show&&settingPanel)showSettings(false);
      editMode=show;
      dragItem=null;selectedFurnitureUid=null;
      if(show)editTool='move';
      controlsSignature='';
      if(show)updateEditorHint('點家具後可旋轉、複製、刪除，或直接拖到新位置。');
      syncControls();draw();
    }
    listen(toggleSettings,'click',()=>showSettings(settingPanel?.hidden!==false));
    listen(closeSettings,'click',()=>showSettings(false));
    listen(toggleEdit,'click',()=>showEditor(!editMode));
    listen(doneEdit,'click',()=>showEditor(false));
    listen(labelInput,'change',()=>setPrefs('labelMode',labelInput.value));
    listen(outlineInput,'change',()=>setPrefs('outline',Boolean(outlineInput.checked)));
    listen(followInput,'change',()=>setPrefs('followSelection',Boolean(followInput.checked)));
    listen(interactionInput,'change',()=>setPrefs('interaction',interactionInput.value));
    listen(petsInput,'change',()=>{
      setPrefs('showPets',Boolean(petsInput.checked));
      if(petsInput.checked)loadPets();
    });
    listen(appearanceInput,'change',()=>{
      if(!selectedId||!Number.isInteger(Number(appearanceInput.value)))return;
      const next=Number(appearanceInput.value);
      if(next<0||next>23)return;
      prefs.appearance={...prefs.appearance,[selectedId]:next};
      persist();draw();refreshAvatarPreview();
    });
    listen(editRoleInput,'change',()=>{
      if(roles.some(r=>r.id===editRoleInput.value))
        selectRole(editRoleInput.value,{open:false});
      updateEditorHint('點地板可調整這位角色的座位');
    });
    function chooseEditorMode(mode){
      if(mode==='role'){
        editTool='role';updateEditorHint('從下方選角色，再點地圖空位安排新位置。');
      }else if(mode==='tile'){
        editTool='floor';updateEditorHint('選擇地板樣式，再點格子上色；也可改成蓋牆。');
      }else{
        editTool='move';updateEditorHint('點選家具後可旋轉／複製／刪除，拖曳家具可移動。');
      }
      selectedFurnitureUid=null;dragItem=null;
      controlsSignature='';syncControls();draw();
    }
    listen(modeFurniture,'click',()=>chooseEditorMode('furniture'));
    listen(modeRole,'click',()=>chooseEditorMode('role'));
    listen(modeTile,'click',()=>chooseEditorMode('tile'));
    listen(addFurniture,'click',()=>{
      editTool=editTool==='place'?'move':'place';
      selectedFurnitureUid=null;
      updateEditorHint(editTool==='place'?'選好家具後，點地圖空位放置；再次按「加家具」退出。':
        '已返回家具選取模式，點一下家具，或直接拖曳。');
      syncControls();draw();
    });
    listen(wallPaint,'click',()=>{editTool='wall';syncControls();updateEditorHint('點地圖格子蓋牆；角色所在處不能蓋牆。');});
    listen(floorPaint,'click',()=>{editTool='floor';syncControls();updateEditorHint('選擇地板樣式，再點要改的格子。');});
    listen(eraseTile,'click',()=>{editTool='erase';syncControls();updateEditorHint('點家具或牆壁擦除，不會刪除角色或對話。');});
    listen(editToolInput,'change',()=>{
      editTool=editToolInput.value;selectedFurnitureUid=null;syncControls();
      updateEditorHint(editTool==='role'?'點擊格子，把目前角色移動到該位置':
        editTool==='place'?'點擊空白位置，放置選擇的家具':
        editTool==='floor'?'點擊地板格子調整地板':
        editTool==='wall'?'點擊格子新增牆面':
        editTool==='erase'?'點擊家具或牆面進行擦除':
        '先點家具，再點想放置的位置');
    });
    const snapshot=()=>JSON.stringify({layout,placements});
    function capture(){
      if(!layout)return;
      undoStack.push(snapshot());
      if(undoStack.length>30)undoStack.shift();
      redoStack=[];
    }
    function applySnapshot(data){
      const next=JSON.parse(data);
      layout=config.validateLayout(next.layout);
      placements=next.placements||{};
      selectedFurnitureUid=null;
      prefs.layout=layout;persist();
      for(const f of layout.furniture){const ref=resolveFurniture(f.type);if(ref)scheduleAsset(ref.path);}
      syncControls();draw();
    }
    function undo(){
      if(!undoStack.length)return;
      redoStack.push(snapshot());applySnapshot(undoStack.pop());
    }
    function redo(){
      if(!redoStack.length)return;
      undoStack.push(snapshot());applySnapshot(redoStack.pop());
    }
    listen(undoButton,'click',undo);
    listen(redoButton,'click',redo);
    const rotations={DESK_FRONT:'DESK_SIDE',DESK_SIDE:'DESK_FRONT',
      SMALL_TABLE_FRONT:'SMALL_TABLE_SIDE',SMALL_TABLE_SIDE:'SMALL_TABLE_FRONT',
      SOFA_FRONT:'SOFA_SIDE',SOFA_SIDE:'SOFA_FRONT',
      WOODEN_CHAIR_FRONT:'WOODEN_CHAIR_SIDE',WOODEN_CHAIR_SIDE:'WOODEN_CHAIR_FRONT',
      CUSHIONED_CHAIR_FRONT:'CUSHIONED_CHAIR_SIDE',
      CUSHIONED_CHAIR_SIDE:'CUSHIONED_CHAIR_FRONT'};
    listen(rotateButton,'click',()=>{
      if(!layout||!selectedFurnitureUid)return;
      const f=layout.furniture.find(e=>e.uid===selectedFurnitureUid);
      if(!f)return;
      const type=rotations[f.type.split(':')[0]];
      if(!type||!canPutFurniture({...f,type},f.col,f.row,f.uid))
        return updateEditorHint('此家具無法旋轉或空間不足');
      capture();f.type=type;prefs.layout=layout;persist();
      const asset=resolveFurniture(type);if(asset)scheduleAsset(asset.path);
      draw();syncControls();updateEditorHint('家具已旋轉');
    });
    listen(deleteFurniture,'click',()=>{
      if(!layout||!selectedFurnitureUid)return;
      const target=layout.furniture.find(f=>f.uid===selectedFurnitureUid);
      if(!target)return;
      capture();layout.furniture=layout.furniture.filter(f=>f.uid!==target.uid);
      selectedFurnitureUid=null;prefs.layout=layout;persist();
      syncControls();draw();updateEditorHint('已刪除家具，可按「復原」還原。');
    });
    listen(duplicateButton,'click',()=>{
      if(!layout||!selectedFurnitureUid)return;
      const f=layout.furniture.find(e=>e.uid===selectedFurnitureUid);
      if(!f)return;
      const col=f.col+1,row=f.row+1;
      if(!canPutFurniture(f,col,row))return updateEditorHint('附近空間不足，無法複製');
      capture();const item={...f,uid:'f-copy-'+Date.now(),col,row};
      layout.furniture.push(item);selectedFurnitureUid=item.uid;
      prefs.layout=layout;persist();draw();syncControls();updateEditorHint('已複製家具');
    });
    listen(resetLayoutButton,'click',()=>{
      if(!layout||!defaultLayout)return;
      capture();layout=config.validateLayout(defaultLayout);
      prefs.layout=null;placements={};prefs.placements={};persist();
      const stable=config.allocateRoles(roles.map(r=>r.id),layout,{});
      placements={...stable};prefs.layout=layout;persist();
      syncControls();draw();updateEditorHint('已重設為原版辦公室配置。');
    });
    listen(exportButton,'click',()=>{
      if(!layout||!config)return;
      const payload={format:'crew-pocket-pixel-office',version:1,
        layout:config.validateLayout(layout),placements,appearance:prefs.appearance};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;
      link.download='crew-pocket-office-layout.json';link.click();
      URL.revokeObjectURL(url);
    });
    listen(importButton,'click',()=>importFile?.click());
    listen(importFile,'change',async()=>{
      const file=importFile.files?.[0];if(!file)return;
      try{
        if(file.size>180000)throw Error('佈局檔案過大');
        const incoming=JSON.parse(await file.text());
        if(incoming.format!=='crew-pocket-pixel-office')throw Error('不是 Crew Pocket 佈局檔案');
        const next=config.validateLayout(incoming.layout);
        capture();layout=next;
        placements=config.allocateRoles(roles.map(r=>r.id),layout,
          config.normalize({placements:incoming.placements}).placements);
        prefs.appearance=config.normalize({appearance:incoming.appearance}).appearance;
        prefs.layout=next;persist();
        for(const f of layout.furniture){const ref=resolveFurniture(f.type);if(ref)scheduleAsset(ref.path);}
        syncControls();draw();updateEditorHint('匯入成功');
      }catch(error){updateEditorHint('匯入失敗：'+error.message);}
      finally{importFile.value='';}
    });
    function furnitureAt(col,row){
      // Reverse order: top-most item receives the click.
      return [...layout.furniture].reverse().find(f=>{
        const dim=config?.shape(f);
        return dim&&col>=f.col&&col<f.col+dim[0]&&row>=f.row&&row<f.row+dim[1];
      });
    }
    function canPutFurniture(f,col,row,excluding=null){
      const dim=config?.shape(f);
      if(!dim||col<0||row<0||col+dim[0]>layout.cols||row+dim[1]>layout.rows)return false;
      for(let dy=0;dy<dim[1];dy++)for(let dx=0;dx<dim[0];dx++){
        const tile=layout.tiles[(row+dy)*layout.cols+col+dx];
        if(tile===0||tile===255)return false;
      }
      // Furniture occupies grid cells, but a coffee cup/PC can sit on a desk.
      if(/^(PC_|COFFEE$)/.test(f.type))return true;
      for(const other of layout.furniture){
        if(other.uid===excluding||/^(PC_|COFFEE$)/.test(other.type))continue;
        const odim=config.shape(other);
        if(odim&&col<other.col+odim[0]&&col+dim[0]>other.col&&
          row<other.row+odim[1]&&row+dim[1]>other.row)return false;
      }
      return true;
    }
    function applyEdit(x,y){
      if(!editMode||!layout||!config)return;
      const room=Math.floor(x/(layout.cols*TILE));
      const col=Math.floor(x/TILE)-room*layout.cols;
      const row=Math.floor(y/TILE);
      if(room<0||room>3||col<0||col>=layout.cols||row<0||row>=layout.rows)return;
      if(editTool==='role'){
        if(!selectedId)return updateEditorHint('請先選取角色');
        const next=config.moveRole(selectedId,{room,col,row},placements,layout);
        if(!next)return updateEditorHint('此位置不可用，可能是牆面或已有角色');
        capture();placements=next;persist();draw();updateEditorHint('已移動角色');
        return;
      }
      const found=furnitureAt(col,row);
      if(editTool==='move'){
        if(found&&found.uid!==selectedFurnitureUid){
          selectedFurnitureUid=found.uid;syncControls();draw();
          updateEditorHint('家具已選取：可拖曳移動，或使用下方旋轉、複製、刪除。');
          return;
        }
        if(!selectedFurnitureUid){
          if(!found)return updateEditorHint('點一下家具即可選取，按住家具拖曳可直接移動。');
          selectedFurnitureUid=found.uid;syncControls();draw();
          updateEditorHint('家具已選取：可拖曳移動，或使用下方旋轉、複製、刪除。');
          return;
        }
        if(found&&found.uid===selectedFurnitureUid)return;
        const moving=layout.furniture.find(f=>f.uid===selectedFurnitureUid);
        if(!moving){selectedFurnitureUid=null;return;}
        if(!canPutFurniture(moving,col,row,moving.uid))
          return updateEditorHint('位置不適合，請選別處');
        capture();layout.furniture=layout.furniture.map(f=>f.uid===moving.uid?{...f,col,row}:f);
        selectedFurnitureUid=null;prefs.layout=layout;persist();draw();updateEditorHint('已移動家具');
      }else if(editTool==='place'){
        const type=furnitureInput?.value||'PLANT';
        const item={uid:'f-'+Date.now()+'-'+Math.floor(Math.random()*100000),type,col,row};
        if(!canPutFurniture(item,col,row))return updateEditorHint('這個格子無法放置家具');
        capture();layout.furniture.push(item);prefs.layout=layout;persist();
        const ref=resolveFurniture(item.type);if(ref)scheduleAsset(ref.path);
        draw();updateEditorHint('已放置家具');
      }else if(editTool==='erase'){
        if(found){
          capture();layout.furniture=layout.furniture.filter(f=>f.uid!==found.uid);
        }else if(layout.tiles[row*layout.cols+col]===0){
          capture();layout.tiles[row*layout.cols+col]=1;
        }else return;
        prefs.layout=layout;persist();draw();
      }else if(editTool==='floor'||editTool==='wall'){
        const value=editTool==='wall'?0:Number(floorInput?.value||1);
        if(layout.tiles[row*layout.cols+col]===value)return;
        // Do not bury durable Role locations under newly painted walls.
        if(value===0&&Object.values(placements).some(p=>p.room===room&&p.col===col&&p.row===row))
          return updateEditorHint('角色正站在此處，無法蓋牆');
        capture();layout.tiles[row*layout.cols+col]=value;
        prefs.layout=layout;persist();draw();
      }
      syncControls();
    }
    function updateWalkers(){
      if(!layout||reduced||editMode)return;
      for(const [index,role] of roles.entries()){
        const seat=roleSeat(role,index);
        if(role.state!=='idle'){walkers.delete(role.id);continue;}
        let w=walkers.get(role.id);
        if(!w)w={x:seat.x,y:seat.y,path:[],pause:hash(role.id)%13};
        if(w.path.length){
          const next=w.path.shift();
          w.x=(seat.room*layout.cols+next.col+.5)*TILE;
          w.y=(next.row+.5)*TILE;
        }else if(--w.pause<=0){
          w.pause=12+(hash(role.id+String(animationTick))%17);
          const x=Math.floor(w.x/TILE)%layout.cols,y=Math.floor(w.y/TILE);
          const possibles=[
            {col:seat.col,row:seat.row},
            {col:seat.col+1,row:seat.row},{col:seat.col-1,row:seat.row},
            {col:seat.col,row:seat.row+1},{col:seat.col,row:seat.row-1}
          ].filter(p=>config.walkable(layout,p.col,p.row));
          const next=possibles[hash(role.id+String(animationTick))%Math.max(1,possibles.length)];
          if(next)w.path=config.findPath(layout,{col:x,row:y},next);
        }
        walkers.set(role.id,w);
      }
    }
    function loadPets(){
      if(!prefs.showPets)return;
      scheduleAsset('pets/gitcat/pet.png');scheduleAsset('pets/claudio/pet.png');
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
      const rooms=Math.max(1,Math.ceil(roles.length/positions.length));
      const worldW=layout.cols*TILE*rooms;
      zoom=Math.min(3,Math.max(.25,Math.min((width-30)/worldW,(height-60)/(layout.rows*TILE))));
      panX=worldW/2;panY=layout.rows*TILE/2;snapCamera();draw();
    }
    function zoomBy(factor){zoom=Math.min(5,Math.max(.25,zoom*factor));snapCamera();draw();}
    const handleReset=()=>resetCamera(),handleIn=()=>zoomBy(1.25),handleOut=()=>zoomBy(.8);
    const focusButton=document.getElementById('world-focus');
    const handleFocus=()=>focusSelected();
    focusButton?.addEventListener('click',handleFocus);
    reset?.addEventListener('click',handleReset);
    zoomIn?.addEventListener('click',handleIn);
    zoomOut?.addEventListener('click',handleOut);
    function onContextUpdated(){
      if(disposed||paused)return;
      syncContextWarnings();draw();
    }
    window.addEventListener('crew:context-usage-updated',onContextUpdated);
    window.addEventListener('resize',onResize);
    if(window.ResizeObserver){observer=new window.ResizeObserver(onResize);observer.observe(board);}
    function stopTimers(){
      window.clearInterval(refreshTimer);window.clearInterval(frameTimer);
      refreshTimer=null;frameTimer=null;
    }
    function startTimers(){
      if(disposed)return;
      stopTimers();
      paused=false;
      refreshTimer=window.setInterval(()=>{void sync();},5500);
      if(!reduced)frameTimer=window.setInterval(()=>{
        if(roles.some(role=>role.state==='working'||role.state==='idle')&&layout){
          animationTick++;
          updateWalkers();
          draw();
        }
      },FRAME_TIME);
      void sync();
      void window.CrewContextUsage?.load?.();
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
        defaultLayout=data;
        layout=prefs.layout||data;
        if(config){
          const stable=config.allocateRoles(roles.map(role=>role.id),layout,placements);
          const incomplete=roles.some(role=>!placements[role.id]);
          placements={...placements,...stable};
          if(incomplete)persist();
        }
        focusInitialCamera();
        for(let i=0;i<6;i++)scheduleAsset('characters/char_'+i+'.png');
        for(let i=0;i<9;i++)scheduleAsset('floors/floor_'+i+'.png');
        scheduleAsset('walls/wall_0.png');
        for(const f of layout.furniture){
          const ref=resolveFurniture(f.type);if(ref)scheduleAsset(ref.path);
        }
        for(let i=1;i<=3;i++)scheduleAsset('furniture/PC/PC_FRONT_ON_'+i+'.png');
        ready=true;syncControls();loadPets();draw();
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
      for(const [el,event,handler] of controls)el.removeEventListener?.(event,handler);
      canvas.removeEventListener('pointerdown',onPointerDown);
      canvas.removeEventListener('pointermove',onPointerMove);
      canvas.removeEventListener('pointerup',onPointerUp);
      canvas.removeEventListener('pointercancel',onPointerCancel);
      reset?.removeEventListener('click',handleReset);
      zoomIn?.removeEventListener('click',handleIn);
      zoomOut?.removeEventListener('click',handleOut);
      focusButton?.removeEventListener('click',handleFocus);
      window.removeEventListener('resize',onResize);
      window.removeEventListener('crew:context-usage-updated',onContextUpdated);
      board.hidden=true;
    };
    dispose.pause=()=>{paused=true;stopTimers();};
    dispose.resume=()=>{if(!disposed&&paused){board.hidden=false;startTimers();}};
    dispose.getCameraState=()=>({selectedId,panX,panY,zoom});
    dispose.selectRole=selectRole;
    startTimers();
    void start();
    return dispose;
  }
  window.CrewPixelOffice={projectRoles,resolveFurniture,seatFor};
  window.mountCrewPixelOfficeScene=mount;
})();
