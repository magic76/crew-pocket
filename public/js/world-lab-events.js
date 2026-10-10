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
  function trail(start,end,progress,hub={x:0,z:-.8}){
    const t=Math.max(0,Math.min(1,progress));
    if(t===0)return{x:start.x,z:start.z};
    if(t===1)return{x:end.x,z:end.z};
    if(t===.5)return{x:hub.x,z:hub.z};
    const route=t<=.5?t*2:(t-.5)*2;
    const from=t<=.5?start:hub,to=t<=.5?hub:end;
    const ease=route*route*(3-2*route);
    return{x:from.x+(to.x-from.x)*ease,z:from.z+(to.z-from.z)*ease};
  }
  return{observe,trail};
});
