/* Pure ground navigation for Crew World. Coordinates use the same island
 * centres and bridge endpoints as the rendered geometry; no over-water hops. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorldLabNavigation=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const WALK_RING=3.0;
  const FOOT_Y=.43;
  const MAX_POINTS=256;
  const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  function locateIsland(point,islands,maxRadius=3.95){
    if(!finite(point))return null;
    let result=null,closest=maxRadius;
    for(const island of islands||[]){
      const d=distance(point,island);
      if(d<=closest){closest=d;result=island;}
    }
    return result;
  }
  function isSafeGround(point,island){
    if(!finite(point)||!island)return false;
    const dx=point.x-island.x,dz=point.z-island.z;
    const r=Math.hypot(dx,dz);
    if(r>3.10||r<.28)return false;
    // House extends over southeast side of an island. Prevent walking inside
    // its walls; the ring bypasses it on the outer perimeter.
    if(dx>-.68&&dx<1.96&&dz>-2.6&&dz<-.58&&r<2.87)return false;
    return true;
  }
  function nearestWalkSpot(point,island){
    if(!finite(point)||!island)return null;
    const dx=point.x-island.x,dz=point.z-island.z;
    const len=Math.hypot(dx,dz);
    if(len<.001)return{x:island.x,z:island.z+WALK_RING};
    if(isSafeGround(point,island))return{x:point.x,z:point.z};
    return{x:island.x+dx/len*WALK_RING,z:island.z+dz/len*WALK_RING};
  }
  function graphRoute(roads,fromId,toId){
    if(fromId===toId)return[];
    if(!fromId||!toId||!Array.isArray(roads))return null;
    const graph=new Map();
    roads.forEach((e,index)=>{
      for(const [a,b] of [[e?.a?.id,e?.b?.id],[e?.b?.id,e?.a?.id]]){
        if(!a||!b)return;
        if(!graph.has(a))graph.set(a,[]);
        graph.get(a).push({to:b,index});
      }
    });
    const queue=[fromId],seen=new Set(queue),previous=new Map();
    for(let n=0;n<queue.length;n++){
      if(queue[n]===toId)break;
      for(const edge of graph.get(queue[n])||[]){
        if(seen.has(edge.to))continue;
        seen.add(edge.to);previous.set(edge.to,{from:queue[n],index:edge.index});
        queue.push(edge.to);
      }
    }
    if(!seen.has(toId))return null;
    const steps=[];
    for(let node=toId;node!==fromId;){
      const step=previous.get(node);
      if(!step)return null;
      steps.push({edgeIndex:step.index,fromId:step.from,toId:node});
      node=step.from;
    }
    return steps.reverse();
  }
  function planWalk({roads=[],islands=[],from,to,fromDistrict,toDistrict}={}){
    if(!finite(from)||!finite(to)||!fromDistrict||!toDistrict)return null;
    const nodes=new Map([{id:'hub',x:0,z:-.8,shore:1.05},...(islands||[])].map(n=>[n.id,n]));
    if(!nodes.has(fromDistrict)||!nodes.has(toDistrict))return null;
    const steps=graphRoute(roads,fromDistrict,toDistrict);
    if(!steps)return null;
    const waypoints=[{x:from.x,z:from.z,y:FOOT_Y,districtId:fromDistrict}];
    const push=(p,districtId)=>{
      if(!finite(p)||waypoints.length>=MAX_POINTS)return;
      const last=waypoints[waypoints.length-1];
      if(distance(last,p)<.025)return;
      waypoints.push({x:p.x,z:p.z,y:FOOT_Y,districtId});
    };
    const pointAt=(node,angle,radius)=>({
      x:node.x+Math.cos(angle)*radius,
      z:node.z+Math.sin(angle)*radius
    });
    function onLand(node,fromPoint,toPoint){
      if(node.id==='hub'){
        push({x:node.x,z:node.z},node.id);
        push(toPoint,node.id);
        return;
      }
      const startAngle=Math.atan2(fromPoint.z-node.z,fromPoint.x-node.x);
      const endAngle=Math.atan2(toPoint.z-node.z,toPoint.x-node.x);
      const first=pointAt(node,startAngle,WALK_RING);
      const last=pointAt(node,endAngle,WALK_RING);
      push(first,node.id);
      let diff=(endAngle-startAngle+Math.PI*3)%(Math.PI*2)-Math.PI;
      const count=Math.ceil(Math.abs(diff)/(.18));
      for(let i=1;i<=count;i++)push(pointAt(node,startAngle+diff*i/count,WALK_RING),node.id);
      push(last,node.id);
      push(toPoint,node.id);
    }
    let currentPoint=from,currentDistrict=fromDistrict;
    for(const step of steps){
      const edge=roads[step.edgeIndex];
      const origin=nodes.get(step.fromId),target=nodes.get(step.toId);
      if(!edge||!origin||!target||currentDistrict!==origin.id)return null;
      const dx=target.x-origin.x,dz=target.z-origin.z,d=Math.hypot(dx,dz);
      if(d<origin.shore+target.shore+.3)return null;
      const ux=dx/d,uz=dz/d;
      const departure={x:origin.x+ux*origin.shore,z:origin.z+uz*origin.shore};
      const arrival={x:target.x-ux*target.shore,z:target.z-uz*target.shore};
      onLand(origin,currentPoint,departure);
      push(arrival,target.id); // ONLY the real existing bridge spans water.
      currentDistrict=target.id;
      currentPoint=arrival;
    }
    onLand(nodes.get(toDistrict),currentPoint,to);
    if(waypoints.length>=MAX_POINTS)return null;
    const total=waypoints.reduce((sum,p,i)=>i?sum+distance(waypoints[i-1],p):0,0);
    return{waypoints,distance:total,steps};
  }
  return{WALK_RING,FOOT_Y,locateIsland,isSafeGround,nearestWalkSpot,graphRoute,planWalk};
});
