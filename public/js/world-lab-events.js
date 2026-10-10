/* Verified-only, side-effect-free planner for saved Role message metadata.
 * Historical records establish a baseline; they never trigger a new movement.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorldLabEvents=api;
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
    return Math.round(Math.max(820,Math.min(1650,780+distance*17)));
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
  return{observe,roadRoute,roadPulse,paperFlightDuration,paperFlightPoint};
});
