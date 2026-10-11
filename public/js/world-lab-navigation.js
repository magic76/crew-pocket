/* Crew World's deterministic real-street walker. The drawing layer owns
 * the lane edges; this navigator follows exactly those polylines. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorldLabNavigation=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const FOOT_Y=.43;
  const FRONT_Z=2.65;
  const MAX_POINTS=256;
  const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  function uniqueLots(roles){
    const map=new Map();
    for(const role of roles||[]){
      if(!role)continue;
      const id=role.districtId||role.id;
      if(id&&!map.has(id))map.set(id,{
        id,x:role.islandX,z:role.islandZ,
        branch:role.townBranch,depth:role.townDepth,
        rotation:role.townRotation||0,
        roadX:role.townRoadX,roadZ:role.townRoadZ,
        frontX:role.townFrontX,frontZ:role.townFrontZ,
        projectId:role.projectId
      });
    }
    return [...map.values()];
  }
  function nearestLot(point,lots,maxDistance=8.0){
    if(!finite(point)||!Array.isArray(lots))return null;
    let chosen=null,best=maxDistance;
    for(const lot of lots){
      if(!finite(lot))continue;
      const d=distance(lot,point);
      if(d<=best){chosen=lot;best=d;}
    }
    return chosen;
  }
  function nearestStreetNode(point,roads,maxDistance=2.4){
    if(!finite(point)||!Array.isArray(roads))return null;
    let best=maxDistance,chosen=null;
    const seen=new Set();
    for(const edge of roads)for(const node of [edge?.a,edge?.b]){
      if(!node?.id||seen.has(node.id)||!finite(node))continue;
      seen.add(node.id);
      const d=distance(point,node);
      if(d<=best){best=d;chosen=node;}
    }
    return chosen;
  }
  function localOffset(point,lot){
    const dx=point.x-lot.x,dz=point.z-lot.z,r=lot.rotation||0;
    return{x:Math.cos(r)*dx-Math.sin(r)*dz,
      z:Math.sin(r)*dx+Math.cos(r)*dz};
  }
  function frontPoint(lot,x,z=FRONT_Z){
    const r=lot.rotation||0;
    return{x:lot.x+Math.cos(r)*x+Math.sin(r)*z,
      z:lot.z-Math.sin(r)*x+Math.cos(r)*z};
  }
  function isSafeGround(point,lot){
    if(!finite(point)||!lot)return false;
    const p=localOffset(point,lot);
    return Math.abs(p.x)<3.8&&Math.abs(p.z)<4.0&&
      !(p.x>-2.25&&p.x<2.25&&p.z>-3.2&&p.z<-.18);
  }
  function nearestWalkSpot(point,lot){
    if(!finite(point)||!lot)return null;
    const local=localOffset(point,lot);
    return frontPoint(lot,Math.min(2.80,Math.max(-2.80,local.x)));
  }
  function planWalk({roads=[],lots,islands,from,to,fromDistrict,toDistrict}={}){
    const sites=lots||islands||[];
    if(!finite(from)||!finite(to)||!fromDistrict||!toDistrict)return null;
    const byId=new Map(sites.map(l=>[l.id,l]));
    const networkNodes=new Map();
    for(const edge of roads){
      if(edge?.a?.id)networkNodes.set(edge.a.id,edge.a);
      if(edge?.b?.id)networkNodes.set(edge.b.id,edge.b);
    }
    // Plaza/intersection nodes are valid ground destinations too, not
    // artificial buildings. A visitor can later walk FROM a plaza as well.
    const start=byId.get(fromDistrict)||networkNodes.get(fromDistrict);
    const finish=byId.get(toDistrict)||networkNodes.get(toDistrict);
    if(!start||!finish)return null;
    const waypoints=[{x:from.x,z:from.z,y:FOOT_Y,districtId:fromDistrict}];
    const push=(point,districtId)=>{
      if(!finite(point)||waypoints.length>=MAX_POINTS)return;
      if(distance(waypoints[waypoints.length-1],point)<.025)return;
      waypoints.push({x:point.x,z:point.z,y:FOOT_Y,districtId});
    };
    if(fromDistrict===toDistrict){
      // Both Roles are outside the same house on a shared front sidewalk.
      push(to,toDistrict);
      const total=waypoints.reduce((v,p,i)=>i?v+distance(p,waypoints[i-1]):0,0);
      return{waypoints,steps:[],distance:total};
    }
    const connections=new Map();
    for(const [edgeIndex,edge] of roads.entries()){
      if(!edge?.a?.id||!edge?.b?.id||!Array.isArray(edge.points)||edge.points.length<2)continue;
      for(const [fromNode,toNode,reverse] of [[edge.a.id,edge.b.id,false],
        [edge.b.id,edge.a.id,true]]){
        if(!connections.has(fromNode))connections.set(fromNode,[]);
        connections.get(fromNode).push({to:toNode,edgeIndex,reverse,
          weight:edge.length});
      }
    }
    const distances=new Map([[fromDistrict,0]]);
    const parents=new Map(),visited=new Set();
    while(true){
      let current=null,best=Infinity;
      for(const [id,cost] of distances)if(!visited.has(id)&&cost<best){
        best=cost;current=id;
      }
      if(current===null||current===toDistrict)break;
      visited.add(current);
      for(const edge of connections.get(current)||[]){
        const candidate=best+edge.weight;
        if(candidate<(distances.get(edge.to)??Infinity)){
          distances.set(edge.to,candidate);
          parents.set(edge.to,{from:current,...edge});
        }
      }
    }
    if(!distances.has(toDistrict))return null; // Never cut across missing streets.
    const steps=[];
    for(let cursor=toDistrict;cursor!==fromDistrict;){
      const step=parents.get(cursor);
      if(!step)return null;
      steps.push(step);
      cursor=step.from;
    }
    steps.reverse();
    const startCurb={
      x:Number.isFinite(start.frontX)?start.frontX:start.x,
      z:Number.isFinite(start.frontZ)?start.frontZ:start.z
    };
    const finishCurb={
      x:Number.isFinite(finish.frontX)?finish.frontX:finish.x,
      z:Number.isFinite(finish.frontZ)?finish.frontZ:finish.z
    };
    if(!finite(startCurb)||!finite(finishCurb))return null;
    push(startCurb,fromDistrict);
    for(const step of steps){
      const edge=roads[step.edgeIndex];
      const points=step.reverse?[...edge.points].reverse():edge.points;
      for(let j=1;j<points.length;j++)push(points[j],step.to);
    }
    push(finishCurb,toDistrict);
    push(to,toDistrict);
    if(waypoints.length>=MAX_POINTS)return null;
    const total=waypoints.reduce((v,p,i)=>i?v+distance(p,waypoints[i-1]):0,0);
    return{waypoints,steps,distance:total};
  }
  return{FRONT_Z,FOOT_Y,MAX_POINTS,uniqueLots,nearestLot,nearestStreetNode,
    locateIsland:nearestLot,isSafeGround,nearestWalkSpot,localOffset,
    frontPoint,planWalk};
});
