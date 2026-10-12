/* Verified-only, side-effect-free planner for saved Role message metadata.
 * Historical records establish a baseline; they never trigger a new movement.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){
    root.WorldLabEvents=api;
    installCharacterVariety(root);
  }

  // WorldLabKit intentionally owns one lightweight animation rig. Layering
  // deterministic silhouette pieces on that rig gives each Role a stable
  // identity without adding models, textures, downloads or another render loop.
  function installCharacterVariety(host){
    const T=host.THREE,kit=host.WorldLabKit;
    if(!T||!kit||typeof kit.create!=='function'||kit.create.__crewVariety)return;
    const original=kit.create;
    const hash=text=>{
      let value=2166136261;
      for(const char of String(text||'Role')){
        value^=char.codePointAt(0);value=Math.imul(value,16777619);
      }
      return value>>>0;
    };
    const materialCache=new Map();
    const material=color=>{
      if(!materialCache.has(color))materialCache.set(color,new T.MeshStandardMaterial({
        color,flatShading:true,roughness:.78,metalness:.03
      }));
      return materialCache.get(color);
    };
    const mesh=(parent,geometry,color,x=0,y=0,z=0)=>{
      const value=new T.Mesh(geometry,material(color));
      value.position.set(x,y,z);value.castShadow=true;value.receiveShadow=true;
      parent.add(value);return value;
    };
    const sphere=(p,c,r,x,y,z,sx=1,sy=1,sz=1)=>{
      const value=mesh(p,new T.SphereGeometry(r,9,7),c,x,y,z);
      value.scale.set(sx,sy,sz);return value;
    };
    const box=(p,c,w,h,d,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),c,x,y,z);
    const cylinder=(p,c,a,b,h,x,y,z,sides=7)=>
      mesh(p,new T.CylinderGeometry(a,b,h,sides),c,x,y,z);
    const cone=(p,c,r,h,x,y,z,sides=6)=>mesh(p,new T.ConeGeometry(r,h,sides),c,x,y,z);
    const bodyShapes=[
      [.92,1.08,.92],[1.06,.93,1.02],[.86,1.16,.88],[1.12,.90,1.08],
      [.96,1.00,.96],[.90,1.12,.94],[1.08,.96,.92],[.94,1.05,1.10],
      [.96,1.02,.96],[1.04,.98,1.04],[.92,1.04,.94],[1.08,.94,1.02]
    ];
    function human(body,role,variant,seed){
      const hair=role.hair||'#303449',accent=role.accent||role.color||'#9bdff2';
      const style=seed%6;
      if(style===0){
        // Beanie: strong round silhouette.
        const cap=cylinder(body,role.color,.38,.48,.20,0,2.19,-.02,9);
        cap.rotation.z=.04;sphere(body,accent,.11,.20,2.34,-.02);
      }else if(style===1){
        // High ponytail.
        sphere(body,hair,.25,.38,2.02,-.12,.82,1.32,.82);
        sphere(body,hair,.19,.48,1.78,-.15,.78,1.45,.78);
      }else if(style===2){
        // Side swept fringe.
        for(let i=0;i<3;i++)sphere(body,hair,.20,-.29+i*.18,2.07,.28,1.0,.58,.72);
      }else if(style===3){
        // Wide brim hat.
        cylinder(body,'#4b5265',.55,.55,.07,0,2.17,0,12);
        cylinder(body,role.color,.31,.35,.27,0,2.31,0,9);
      }else if(style===4){
        // Headphones make a recognizable side silhouette.
        const band=new T.Mesh(new T.TorusGeometry(.46,.055,5,12,Math.PI),material(accent));
        band.position.set(0,1.94,.02);band.rotation.z=Math.PI;body.add(band);
        for(const side of [-1,1])box(body,role.color,.13,.31,.18,side*.48,1.82,.02);
      }else{
        // Small shoulder bag + short hair tuft.
        sphere(body,hair,.20,.20,2.19,-.04,1.05,.62,.86);
        const strap=box(body,accent,.055,.79,.035,.18,.88,.43);strap.rotation.z=-.39;
        box(body,role.color,.31,.29,.12,.30,.60,.44);
      }
      if(variant===6||variant===7){
        // Glasses are intentionally reserved for only a subset of people.
        for(const side of [-1,1]){
          const frame=new T.Mesh(new T.TorusGeometry(.13,.018,4,10),material('#3d4658'));
          frame.position.set(side*.19,1.68,.505);frame.scale.y=.82;body.add(frame);
        }
        box(body,'#3d4658',.13,.02,.025,0,1.68,.505);
      }
    }
    function robot(body,role,variant){
      // Cover the shared face with a deliberately non-human head shell.
      const shell=box(body,variant===8?'#d9e5e8':'#bfc9d9',.92,.78,.78,0,1.70,.01);
      shell.rotation.y=variant===8?.04:-.05;
      box(body,'#26384c',.68,.25,.08,0,1.72,.42);
      for(const side of [-1,1])sphere(body,role.accent,.075,side*.20,1.73,.48);
      cylinder(body,'#66778b',.035,.045,.37,0,2.27,0,6);
      sphere(body,role.color,.095,0,2.48,0);
      if(variant===9){
        for(const side of [-1,1])box(body,role.color,.17,.38,.22,side*.55,1.70,.01);
        box(body,role.accent,.42,.08,.07,0,1.45,.43);
      }
    }
    function animal(body,role,variant){
      const fur=variant===10?'#d99a62':'#8796a7';
      // A fur mask, ears and muzzle fully change the head read at map scale.
      sphere(body,fur,.55,0,1.64,.015,1.02,1.02,.96);
      for(const side of [-1,1]){
        const ear=cone(body,fur,.25,.52,side*.35,2.13,-.03,5);
        ear.rotation.z=side*-.14;
        sphere(body,'#f0b5a4',.10,side*.35,2.11,.08,.75,1.12,.55);
        sphere(body,'#17263a',.052,side*.19,1.70,.49,.9,1,.55);
      }
      sphere(body,variant===10?'#f1c39e':'#c7ced5',.25,0,1.51,.47,1.15,.70,.58);
      sphere(body,'#3b3540',.055,0,1.57,.61,1,.70,.55);
      if(variant===10){
        // Fox tail visible from oblique map angles.
        const tail=cone(body,fur,.22,.78,-.43,.77,-.35,7);
        tail.rotation.z=-.72;
      }else{
        // Cat whisker bars stay low-poly and cheap.
        for(const side of [-1,1]){
          const whisker=box(body,'#e9eef0',.32,.018,.018,side*.31,1.50,.57);
          whisker.rotation.z=side*.10;
        }
      }
      box(body,role.accent,.55,.08,.07,0,1.18,.42);
    }
    function decorate(actor,index){
      if(!actor?.body||!actor?.role)return;
      const seed=hash(actor.role.id),variant=seed%12;
      actor.role.characterVariant=variant;
      const shape=bodyShapes[variant];
      actor.body.scale.set(shape[0],shape[1],shape[2]);
      if(variant<8)human(actor.body,actor.role,variant,seed);
      else if(variant<10)robot(actor.body,actor.role,variant);
      else animal(actor.body,actor.role,variant);
      // Keep the selected/working halo independent from body proportions.
      actor.root.userData.characterVariant=variant;
    }
    const wrapped=function(scene,roles){
      const actors=original.call(kit,scene,roles);
      actors.forEach(decorate);
      return actors;
    };
    wrapped.__crewVariety=true;
    wrapped.__crewOriginal=original;
    kit.create=wrapped;

    // At overview zoom the selected Role badge and the green Project status pin
    // share the same projection. Lift only the selected Role badge instead of
    // hiding verified project state. This fixes the overlap visible on phones.
    if(host.document&&!host.document.getElementById('crew-world-character-variety-style')){
      const style=host.document.createElement('style');
      style.id='crew-world-character-variety-style';
      style.textContent=`
        .world-stage-frame:has(#world-stage[data-zoom-tier="overview"]) .world-label[data-selected="true"]{
          transform:translate(-50%,calc(-100% - 46px));
          z-index:5;
        }
        .world-stage-frame:has(#world-stage[data-zoom-tier="overview"]) .world-label[data-selected="true"] .world-speech-bubble{
          bottom:calc(100% + 12px);
        }
        @media(max-width:540px){
          .world-stage-frame:has(#world-stage[data-zoom-tier="overview"]) .world-label[data-selected="true"]{
            transform:translate(-50%,calc(-100% - 42px));
          }
        }
      `;
      host.document.head.appendChild(style);
    }
  }
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const MAX_AGE_MS=45000;
  const MAX_FUTURE_MS=5000;
  function observe(events,previousIds,roleIds,now=Date.now()){
    const records=Array.isArray(events)?events:[];
    const allowed=new Set(roleIds||[]);
    const valid=records.filter(item=>item&&typeof item.id==='string'&&item.id.length>0&&
      typeof item.fromRoleId==='string'&&typeof item.toRoleId==='string'&&
      allowed.has(item.fromRoleId)&&allowed.has(item.toRoleId)&&
      item.fromRoleId!==item.toRoleId&&Number.isFinite(item.createdAt)&&item.createdAt>0);
    const seenIds=new Set(valid.map(item=>item.id));
    if(previousIds===null)return{seenIds,arrivals:[]};
    const unique=new Set();
    const arrivals=valid.filter(item=>{
      if(previousIds.has(item.id)||unique.has(item.id)||
         item.createdAt<now-MAX_AGE_MS||item.createdAt>now+MAX_FUTURE_MS)return false;
      unique.add(item.id);return true;
    }).sort((a,b)=>a.createdAt-b.createdAt).slice(-3).map(item=>({
      id:item.id,fromRoleId:item.fromRoleId,toRoleId:item.toRoleId,
      kind:item.kind==='reply'?'reply':'handoff',createdAt:item.createdAt
    }));
    return{seenIds,arrivals};
  }
  // Evidence tray uses the SAME saved-event metadata as paper flights.
  // No body or delivery status is available here: never infer either.
  function traceableEvents(events,roleIds,limit=6,now=Date.now()){
    const allowed=new Set(roleIds||[]),seen=new Set();
    const count=Math.max(0,Math.min(12,Math.floor(Number(limit)||0)));
    return (Array.isArray(events)?events:[]).filter(item=>{
      if(!item||typeof item.id!=='string'||!item.id||seen.has(item.id)||
         !allowed.has(item.fromRoleId)||!allowed.has(item.toRoleId)||
         item.fromRoleId===item.toRoleId||!Number.isFinite(item.createdAt)||
         item.createdAt<=0||item.createdAt>now+MAX_FUTURE_MS)return false;
      seen.add(item.id);return true;
    }).sort((a,b)=>b.createdAt-a.createdAt).slice(0,count).map(item=>({
      id:item.id,fromRoleId:item.fromRoleId,toRoleId:item.toRoleId,
      kind:item.kind==='reply'?'reply':'handoff',createdAt:item.createdAt
    }));
  }
  // P12 attention is only an observation of known Runtime counts and newly
  // seen response signatures. Never infer failed tasks, unread receipts or
  // an event from the initial baseline.
  function attentionItems(roles,freshReplies,now=Date.now()){
    if(!Array.isArray(roles))return[];
    return roles.map((role,index)=>{
      const count=Number.isSafeInteger(role?.attention)&&role.attention>0
        ?Math.min(role.attention,999):0;
      const candidate=freshReplies instanceof Map?freshReplies.get(role?.id):null;
      const age=now-Number(candidate?.at);
      const reply=candidate&&typeof candidate.signature==='string'&&
        candidate.signature.length>0&&Number.isFinite(age)&&age>=0&&age<300000
        ?candidate:null;
      return{role,index,reply,count};
    }).filter(item=>item.role?.id&&(item.count>0||item.reply));
  }
  // P14 arcs use only the traceable, already-validated event metadata.
  // The optional selected Role filter does not create or modify messages.
  // Connections are recent activity cues, never permanent relationships.
  // Historical evidence remains in traceableEvents independently.
  const COLLABORATION_LINK_WINDOW_MS=MAX_AGE_MS;
  function collaborationConnections(rows,roleId,onlySelected=false,limit=3,now=Date.now()){
    const max=Math.max(0,Math.min(6,Math.floor(Number(limit)||0)));
    return (Array.isArray(rows)?rows:[]).filter(event=>{
      if(!event||typeof event.id!=='string'||!event.id||
        typeof event.fromRoleId!=='string'||typeof event.toRoleId!=='string'||
        event.fromRoleId===event.toRoleId||!Number.isFinite(event.createdAt)||
        event.createdAt<=0)return false;
      const age=now-event.createdAt;
      return age>=-MAX_FUTURE_MS&&age<COLLABORATION_LINK_WINDOW_MS&&
        (!onlySelected||event.fromRoleId===roleId||event.toRoleId===roleId);
    }).slice(0,max);
  }
  // A packet of light can travel only along bridges that physically exist.
  // Nodes are *districts*, not Roles. Same-district messages stay local.
  function roadRoute(roads,fromDistrict,toDistrict){
    if(!Array.isArray(roads)||!fromDistrict||!toDistrict||
       fromDistrict===toDistrict)return [];
    const graph=new Map();
    roads.forEach((road,index)=>{
      if(!road?.a?.id||!road?.b?.id||road.a.id===road.b.id)return;
      for(const [from,to] of [[road.a.id,road.b.id],[road.b.id,road.a.id]]){
        if(!graph.has(from))graph.set(from,[]);
        graph.get(from).push({to,index});
      }
    });
    const visited=new Set([fromDistrict]),queue=[fromDistrict],previous=new Map();
    for(let at=0;at<queue.length;at++){
      const node=queue[at];
      if(node===toDistrict)break;
      for(const edge of graph.get(node)||[]){
        if(visited.has(edge.to))continue;
        visited.add(edge.to);
        previous.set(edge.to,{from:node,index:edge.index});
        queue.push(edge.to);
      }
    }
    if(!visited.has(toDistrict))return [];
    const route=[];
    for(let node=toDistrict;node!==fromDistrict;){
      const step=previous.get(node);
      if(!step)return [];
      route.push(step.index);
      node=step.from;
    }
    return route.reverse();
  }
  // A whole bridge briefly glows in turn, rather than teleporting an actor or
  // claiming that a virtual courier has physically delivered the message.
  function roadPulse(route,edgeIndex,elapsed,duration){
    if(!Array.isArray(route)||!route.length||!Number.isFinite(elapsed)||
       !Number.isFinite(duration)||duration<=0||elapsed<0||elapsed>=duration)return 0;
    const progress=elapsed/duration*route.length;
    let opacity=0;
    route.forEach((index,step)=>{
      if(index!==edgeIndex)return;
      const distance=Math.abs(progress-(step+.5));
      opacity=Math.max(opacity,Math.max(0,1-distance/.67));
    });
    return Math.min(.75,opacity*.75);
  }
  // A paper plane is a visual metaphor for a saved Role-to-Role message,
  // never proof that the receiver has read or processed the message.
  // It flies independently of the decorative bridge graph.
  function paperFlightDuration(start,end){
    const distance=Math.hypot((end?.x||0)-(start?.x||0),(end?.z||0)-(start?.z||0));
    // Long enough to read on mobile, capped to avoid lingering aircraft.
    return Math.round(Math.max(2050,Math.min(3200,1750+distance*33)));
  }
  function paperFlightPoint(start,end,progress){
    const t=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
    if(t===0)return{x:start.x,y:start.y,z:start.z};
    if(t===1)return{x:end.x,y:end.y,z:end.z};
    const e=t*t*(3-2*t);
    const distance=Math.hypot(end.x-start.x,end.z-start.z);
    const rise=Math.max(.65,Math.min(6.2,distance*.19));
    return {
      x:start.x+(end.x-start.x)*e,
      z:start.z+(end.z-start.z)*e,
      y:start.y+(end.y-start.y)*e+Math.sin(Math.PI*t)*rise
    };
  }
  return{observe,traceableEvents,attentionItems,collaborationConnections,COLLABORATION_LINK_WINDOW_MS,roadRoute,roadPulse,paperFlightDuration,paperFlightPoint};
});
