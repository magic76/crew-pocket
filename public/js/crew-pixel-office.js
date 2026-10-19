/* Crew Pixel Office P0: no external assets, no simulated Runtime events.
 * Inspired by Pixel Agents (MIT), but not a port or import of its sprites.
 * All office occupants map to durable Crew Role IDs and verified status.
 */
(() => {
  'use strict';
  const STATES=new Set(['working','waiting','idle','new']);
  const labels={working:'工作中',waiting:'待確認',idle:'待命',new:'新加入',unknown:'未同步'};
  const palettes=[
    ['#6db4c9','#263c61','#f2c5a3'],['#e2ac5b','#634b65','#deb492'],
    ['#b99edd','#4b496f','#f0c8a0'],['#90c9a5','#446854','#ecc39e'],
    ['#e798a0','#613e57','#d9aa88'],['#91b7e8','#405579','#f5cfad']
  ];
  function projectRoles(rows) {
    if(!Array.isArray(rows))return [];
    const seen=new Set();
    return rows.filter(row=>{
      if(!row||typeof row.roleId!=='string'||!row.roleId.trim()||seen.has(row.roleId))return false;
      seen.add(row.roleId);return true;
    }).slice(0,36).map((row,index)=>{
      const state=STATES.has(row.state)?row.state:'unknown';
      return {
        id:row.roleId,name:String(row.roleName||'Role').slice(0,80),
        project:String(row.projectId||''),state,
        work:state==='working'&&typeof row.currentWork?.title==='string'
          ?row.currentWork.title.slice(0,80):'',
        attention:Number.isSafeInteger(row.attentionCount)?Math.max(0,Math.min(999,row.attentionCount)):0,
        palette:palettes[index%palettes.length]
      };
    });
  }
  function mount(initial={}) {
    const board=document.getElementById('crew-pixel-office');
    const room=document.getElementById('crew-pixel-room');
    const canvas=document.getElementById('crew-pixel-canvas');
    const layer=document.getElementById('crew-pixel-roles');
    const feedback=document.getElementById('crew-pixel-feedback');
    if(!board||!room||!canvas||!layer||!feedback)return null;
    let disposed=false,paused=false,fetching=false,roles=[],synced=false;
    let selectedId=initial?.selectedId||window.getCurrentRoleId?.()||null;
    let syncTimer=null,animTimer=null,observer=null,width=0,height=0;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
    board.hidden=false;
    function statusText(role) {
      return role.state==='working'&&role.work?role.work
        :labels[role.state]+(role.attention>0?' · '+role.attention+' 項':'');
    }
    function draw() {
      if(disposed||paused||board.hidden)return;
      const rect=board.getBoundingClientRect();
      const nextWidth=Math.max(260,Math.floor(rect.width||board.clientWidth||320));
      const cols=nextWidth>=820?5:nextWidth>=560?3:2;
      const cellW=nextWidth/cols;
      const rows=Math.ceil(roles.length/cols);
      const startY=164;
      const cellH=152;
      const nextHeight=Math.max(Math.floor(rect.height||board.clientHeight||600),
        startY+rows*cellH+175);
      if(width!==nextWidth||height!==nextHeight){
        width=nextWidth;height=nextHeight;
        room.style.height=height+'px';
        const dpr=Math.min(1.5,window.devicePixelRatio||1);
        canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
        canvas.style.width=width+'px';canvas.style.height=height+'px';
      }
      const ctx=canvas.getContext('2d');
      if(!ctx){feedback.textContent='Canvas 無法使用，請使用上方角色選單';return;}
      ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
      ctx.imageSmoothingEnabled=false;
      const fill=(c,x,y,w,h)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
      fill('#192c3f',0,0,width,height);
      for(let y=0;y<height;y+=32)for(let x=0;x<width;x+=32)
        fill(((x+y)/32)%2===0?'#2e4455':'#314959',x,y,32,32);
      fill('#203146',0,0,width,112);fill('#334d5c',0,112,width,10);
      fill('#54758a',0,122,width,4);
      fill('#7b9bab',14,128,width-28,4);
      // Real room furniture is decorative; it does not represent tool events.
      for(let x=16;x<width;x+=80){
        fill('#304e58',x,22,54,52);fill('#8dc4c1',x+6,28,42,8);
        fill('#517c7b',x+6,44,42,22);
      }
      fill('#233847',0,132,width,20);
      // Nameplate and status read from the same verified roster as the chips.
      ctx.font='bold 14px monospace';ctx.fillStyle='#d8f4e9';
      ctx.fillText('CREW  /  PIXEL OFFICE',16,147);
      const clock=(window.performance?.now?.()||0);
      roles.forEach((role,index)=>{
        const col=index%cols,row=Math.floor(index/cols);
        const cx=cellW*(col+.5),y=startY+row*cellH;
        const palette=role.palette;
        const deskX=cx-36;
        // Floor shadow, table, computer, keyboard, stool.
        fill('#142838',deskX-12,y+75,98,9);
        fill('#765a4c',deskX-38,y+44,76,27);
        fill('#b49b75',deskX-38,y+39,76,9);
        fill('#543f43',deskX-7,y+17,32,26);
        fill(role.state==='working'?'#5cc89b':'#7090a1',deskX-4,y+20,26,18);
        fill('#c2e7dc',deskX+7,y+43,4,7);
        fill('#2a3f57',deskX-15,y+48,45,8);
        fill('#805e50',deskX-24,y+77,46,13);
        // Working animation only when the Runtime reports working.
        const typing=role.state==='working'&&!reduced&&Math.floor(clock/600)%2===0;
        const bob=typing?2:0;
        fill('#182b3a',cx-21,y+48,39,37);
        fill(palette[1],cx-19,y+49+bob,35,27);
        fill(palette[2],cx-10,y+34+bob,18,17);
        fill(palette[0],cx-13,y+25+bob,24,11);
        fill('#1c293b',cx-8,y+41+bob,4,4);
        fill('#1c293b',cx+5,y+41+bob,4,4);
        fill(palette[2],cx-24,y+60+bob,7,12);
        fill(palette[2],cx+18,y+60-bob,7,12);
        fill('#223245',cx-15,y+76,12,10);fill('#223245',cx+4,y+76,12,10);
        // Only verified waiting/attention is represented by alert icons.
        if(role.state==='waiting'||role.attention>0){
          fill('#f4c76e',cx+24,y+26,22,23);
          ctx.fillStyle='#3a2c22';ctx.font='bold 17px monospace';ctx.fillText('!',cx+29,y+44);
        }
        if(role.id===selectedId){
          fill('#b9f7fa',cx-28,y+89,56,4);
          fill('#b9f7fa',cx-28,y+24,4,15);fill('#b9f7fa',cx+25,y+24,4,15);
        }
      });
    }
    function updateButtons(){
      const widthHint=Math.max(260,board.clientWidth||320);
      const cols=widthHint>=820?5:widthHint>=560?3:2, cellW=widthHint/cols;
      layer.replaceChildren();
      roles.forEach((role,index)=>{
        const col=index%cols,row=Math.floor(index/cols);
        const button=document.createElement('button');
        button.type='button';button.className='crew-pixel-role';
        button.style.left=((col+.5)*cellW)+'px';
        button.style.top=(164+row*152+105)+'px';
        button.style.width=Math.min(180,cellW-14)+'px';
        button.dataset.state=role.state;
        button.setAttribute('aria-pressed',String(role.id===selectedId));
        button.setAttribute('aria-label',role.name+' · '+statusText(role)+' · 切換對話');
        const name=document.createElement('strong');name.textContent=role.name;
        const sub=document.createElement('small');sub.textContent=statusText(role);
        button.append(name,sub);
        button.addEventListener('click',()=>selectRole(role.id));
        layer.appendChild(button);
      });
      draw();
    }
    function selectRole(id){
      const role=roles.find(item=>item.id===id);
      if(!role||disposed)return false;
      selectedId=id;
      for(const button of layer.children)
        button.setAttribute('aria-pressed',String(button.getAttribute('aria-label')?.startsWith(role.name+' ·')&&
          button===layer.children[roles.indexOf(role)]));
      draw();
      window.CrewWorldHost?.onSelectedRole?.(role.id,role.name);
      return true;
    }
    async function sync(){
      if(disposed||paused||fetching||document.hidden)return;
      fetching=true;
      try{
        const response=await fetch('/api/crew-status',{cache:'no-store',credentials:'same-origin'});
        if(!response.ok)throw Error('crew-status HTTP '+response.status);
        const data=await response.json();
        if(data.success!==true||!Array.isArray(data.roles))throw Error('Invalid crew-status');
        if(disposed||paused)return;
        const next=projectRoles(data.roles);
        const changed=JSON.stringify(next)!==JSON.stringify(roles);
        roles=next;synced=true;
        if(selectedId&&!roles.some(role=>role.id===selectedId))selectedId=null;
        feedback.textContent=roles.length
          ?'同步中 · '+roles.filter(role=>role.state==='working').length+' 位工作 · '+roles.length+' 位 Role'
          :'目前沒有角色，請從上方新增 Role';
        if(changed)updateButtons();else draw();
      }catch(error){
        if(disposed||paused)return;
        synced=false;
        roles=roles.map(role=>({...role,state:'unknown',work:'',attention:0}));
        if(!roles.length){
          // A verified Crew snapshot is a roster fallback, never a work claim.
          const snapshot=window.getCrewCockpitSnapshot?.();
          roles=(snapshot?.roles||[]).map((role,index)=>({
            id:role.id,name:role.name,project:role.project||'',state:'unknown',
            work:'',attention:0,palette:palettes[index%palettes.length]
          })).filter(role=>typeof role.id==='string'&&role.id);
        }
        feedback.textContent='Runtime 未同步 · 狀態未知';
        updateButtons();
      }finally{fetching=false;}
    }
    function resize(){if(!disposed&&!paused)updateButtons();}
    function start(){
      paused=false;board.hidden=false;
      resize();void sync();
      syncTimer=window.setInterval(()=>{void sync();},5500);
      if(!reduced)animTimer=window.setInterval(()=>{
        if(roles.some(role=>role.state==='working'))draw();
      },600);
    }
    function stop(){
      window.clearInterval(syncTimer);window.clearInterval(animTimer);
      syncTimer=null;animTimer=null;
    }
    const onResize=()=>resize();
    window.addEventListener('resize',onResize);
    if(window.ResizeObserver){
      observer=new window.ResizeObserver(onResize);observer.observe(board);
    }
    start();
    function dispose(){
      if(disposed)return;
      disposed=true;stop();observer?.disconnect();
      window.removeEventListener('resize',onResize);
      board.hidden=true;layer.replaceChildren();
    }
    dispose.pause=()=>{paused=true;stop();};
    dispose.resume=()=>{if(!disposed&&paused)start();};
    dispose.selectRole=selectRole;
    dispose.getCameraState=()=>({selectedId});
    return dispose;
  }
  window.CrewPixelOffice={projectRoles};
  window.mountCrewPixelOfficeScene=mount;
})();
