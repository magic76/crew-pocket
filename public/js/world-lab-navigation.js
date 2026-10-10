/* Deterministic continuous-town geometry and grounded walking routes.
 * Same lot/street coordinates feed WorldLabKit and the visitor navigator.
 * No island centres, bridge hops, NavMesh download or remote data. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorldLabNavigation=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const SPACING=10;
  const FRONT_Z=2.65;
  const FOOT_Y=.43;
  const MAX_POINTS=256;
  const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  function dimensions(count){
    const n=Math.max(1,Math.min(36,Math.floor(count)||1));
    const cols=Math.ceil(Math.sqrt(n));
    return{cols,rows:Math.ceil(n/cols),spacing:SPACING};
  }
  function lotPosition(index,count){
    const {cols,rows}=dimensions(count);
    const col=index%cols,row=Math.floor(index/cols);
    return{x:(col-(cols-1)/2)*SPACING,
      z:(row-(rows-1)/2)*SPACING,col,row};
  }
  function uniqueLots(roles){
    const map=new Map();
    for(const r of roles||[]){
      if(!r)continue;
      const id=r.districtId||r.id;
      if(id&&!map.has(id))map.set(id,{id,x:r.islandX,z:r.islandZ,
        col:r.townCol,row:r.townRow,projectId:r.projectId});
    }
    return [...map.values()];
  }
  function nearestLot(point,lots){
    if(!finite(point)||!Array.isArray(lots)||!lots.length)return null;
    let near=null,min=Infinity;
    for(const lot of lots){
      if(!finite(lot))continue;
      const d=distance(lot,point);
      if(d<min){near=lot;min=d;}
    }
    // The ground is continuous, but tapping far outside the miniature
    // town is not a valid walking destination.
    return min<=SPACING*.78?near:null;
  }
  function isSafeGround(point,lot){
    if(!finite(point)||!lot)return false;
    const dx=point.x-lot.x,dz=point.z-lot.z;
    if(Math.abs(dx)>SPACING/2||Math.abs(dz)>SPACING/2)return false;
    // The front of each building is north of the shared sidewalk.
    return !(dx>-2.1&&dx<2.1&&dz>-3.2&&dz<-.25);
  }
  function nearestWalkSpot(point,lot){
    if(!finite(point)||!lot)return null;
    // Snap taps to the visible pedestrian frontage, never through houses.
    const x=lot.x+Math.min(4.30,Math.max(-4.30,point.x-lot.x));
    return{x,z:lot.z+FRONT_Z};
  }
  const close=(a,b)=>distance(a,b)<.025;
  function planWalk({lots,islands,from,to,fromDistrict,toDistrict}={}){
    const sites=lots||islands||[];
    if(!finite(from)||!finite(to)||!fromDistrict||!toDistrict)return null;
    const byId=new Map(sites.map(lot=>[lot.id,lot]));
    const start=byId.get(fromDistrict),finish=byId.get(toDistrict);
    if(!start||!finish||!Number.isInteger(start.col)||!Number.isInteger(start.row)||
       !Number.isInteger(finish.col)||!Number.isInteger(finish.row))return null;
    const waypoints=[{x:from.x,z:from.z,y:FOOT_Y,districtId:start.id}];
    function push(x,z,id){
      if(!Number.isFinite(x)||!Number.isFinite(z)||waypoints.length>=MAX_POINTS)return;
      const point={x,z,y:FOOT_Y,districtId:id};
      if(!close(waypoints[waypoints.length-1],point))waypoints.push(point);
    }
    // Same-block visits stay on the shared front sidewalk. Do not walk all
    // the way around a street junction simply to talk to a neighbor.
    if(start.id===finish.id){
      push(from.x,start.z+FRONT_Z,start.id);
      push(to.x,finish.z+FRONT_Z,finish.id);
      push(to.x,to.z,finish.id);
      return{waypoints,steps:[],distance:waypoints.reduce((d,p,i)=>
        i?d+distance(p,waypoints[i-1]):0,0)};
    }
    // The front strip connects each character to the right-hand intersection.
    const sx=start.x+SPACING/2,sz=start.z+SPACING/2;
    const fx=finish.x+SPACING/2,fz=finish.z+SPACING/2;
    push(from.x,start.z+FRONT_Z,start.id);
    push(sx,start.z+FRONT_Z,start.id);
    push(sx,sz,start.id);
    // Each step is along a REAL rendered horizontal or vertical street.
    let col=start.col,row=start.row;
    const steps=[];
    while(col!==finish.col){
      const next=col+Math.sign(finish.col-col);
      push(sx+(next-start.col)*SPACING,sz,start.id);
      steps.push({fromCol:col,fromRow:row,toCol:next,toRow:row});
      col=next;
    }
    while(row!==finish.row){
      const next=row+Math.sign(finish.row-row);
      push(fx,sz+(next-start.row)*SPACING,start.id);
      steps.push({fromCol:col,fromRow:row,toCol:col,toRow:next});
      row=next;
    }
    push(fx,finish.z+FRONT_Z,finish.id);
    push(to.x,finish.z+FRONT_Z,finish.id);
    push(to.x,to.z,finish.id);
    if(waypoints.length>=MAX_POINTS)return null;
    return{waypoints,steps,distance:waypoints.reduce((d,p,i)=>
      i?d+distance(p,waypoints[i-1]):0,0)};
  }
  function streetEdges(lots){
    if(!lots?.length)return[];
    const {cols,rows}=dimensions(lots.length);
    const at=(col,row)=>({
      id:'street-'+col+'-'+row,col,row,
      x:(col-(cols-1)/2)*SPACING+SPACING/2,
      z:(row-(rows-1)/2)*SPACING+SPACING/2
    });
    const edges=[];
    // Include street junctions beside empty lots on the final row. Their
    // streets are painted in the scene even where no workshop is built.
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      if(col+1<cols)edges.push({a:at(col,row),b:at(col+1,row),length:SPACING});
      if(row+1<rows)edges.push({a:at(col,row),b:at(col,row+1),length:SPACING});
    }
    return edges;
  }
  function streetLines(lots){
    if(!lots?.length)return[];
    const xs=[...new Set(lots.map(l=>l.x))].sort((a,b)=>a-b);
    const zs=[...new Set(lots.map(l=>l.z))].sort((a,b)=>a-b);
    const minX=xs[0]-SPACING/2,maxX=xs[xs.length-1]+SPACING/2;
    const minZ=zs[0]-SPACING/2,maxZ=zs[zs.length-1]+SPACING/2;
    return[
      ...xs.map(x=>({x:x+SPACING/2,z:(minZ+maxZ)/2,width:1.8,length:maxZ-minZ+1,vertical:true})),
      ...zs.map(z=>({x:(minX+maxX)/2,z:z+SPACING/2,width:1.8,length:maxX-minX+1,vertical:false}))
    ];
  }
  return{SPACING,FRONT_Z,FOOT_Y,dimensions,lotPosition,uniqueLots,
    nearestLot,locateIsland:nearestLot,isSafeGround,nearestWalkSpot,
    planWalk,streetEdges,streetLines};
});
