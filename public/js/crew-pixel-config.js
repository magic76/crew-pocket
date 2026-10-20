/*
 * Crew Pocket office preferences, editable room layout and Role ID placements.
 * No provider, Context, Memory or Conversation writes. User data stays local
 * to this browser unless exported as JSON and imported on another device.
 */
(() => {
  'use strict';
  const STORAGE_KEY='crew-pocket:pixel-office:v2';
  const DEFAULTS=Object.freeze({
    labelMode:'selected',outline:true,followSelection:true,
    interaction:'direct',showPets:false,appearance:{},placements:{},layout:null
  });
  const SEATS=[[3,16],[3,18],[7,16],[7,18],[3,14],[7,14],[13,14],[14,16],[14,13]];
  const CATALOG={
    DESK_FRONT:[3,2],DESK_SIDE:[1,4],
    CUSHIONED_BENCH:[1,1],CUSHIONED_CHAIR_FRONT:[1,1],CUSHIONED_CHAIR_BACK:[1,1],
    CUSHIONED_CHAIR_SIDE:[1,1],WOODEN_CHAIR_BACK:[1,1],
    WOODEN_CHAIR_FRONT:[1,1],WOODEN_CHAIR_SIDE:[1,1],
    TABLE_FRONT:[3,2],SMALL_TABLE_FRONT:[3,2],SMALL_TABLE_SIDE:[1,3],
    SOFA_FRONT:[2,1],SOFA_BACK:[2,1],SOFA_SIDE:[1,2],
    COFFEE_TABLE:[2,1],PC_FRONT_OFF:[1,2],PC_FRONT_ON_1:[1,2],
    PC_FRONT_ON_2:[1,2],PC_FRONT_ON_3:[1,2],PC_BACK:[1,2],PC_SIDE:[1,2],
    COFFEE:[1,1],BIN:[1,1],PLANT:[1,2],PLANT_2:[1,2],
    LARGE_PLANT:[2,3],CACTUS:[1,2],POT:[1,1],BOOKSHELF:[1,2],
    DOUBLE_BOOKSHELF:[2,2],HANGING_PLANT:[1,2],CLOCK:[1,2],
    WHITEBOARD:[3,2],SMALL_PAINTING:[1,1],SMALL_PAINTING_2:[1,1],
    LARGE_PAINTING:[2,2],WOODEN_BENCH:[2,1]
  };
  function shape(item){
    if(!item)return null;
    return CATALOG[String(item.type||'').split(':')[0]]||null;
  }
  function validateLayout(input){
    if(!input||typeof input!=='object'||input.cols!==21||input.rows!==22||
      !Array.isArray(input.tiles)||input.tiles.length!==462||
      !Array.isArray(input.furniture)||input.furniture.length>180)throw Error('辦公室尺寸或家具資料不正確');
    if(!input.tiles.every(tile=>Number.isInteger(tile)&&(tile===255||(tile>=0&&tile<=9))))
      throw Error('地板資料不正確');
    const uids=new Set();
    const furniture=input.furniture.map((item,index)=>{
      const s=shape(item);
      if(!s||!Number.isInteger(item.col)||!Number.isInteger(item.row)||
        item.col<0||item.row<0||item.col+s[0]>21||item.row+s[1]>22)
        throw Error('無效家具位置或種類');
      const uid=typeof item.uid==='string'&&item.uid.length<90&&item.uid.length>0
        ?item.uid:'f-'+index;
      if(uids.has(uid))throw Error('重複家具 ID');
      uids.add(uid);
      return {uid,type:String(item.type),col:item.col,row:item.row};
    });
    return {version:1,cols:21,rows:22,tiles:input.tiles.slice(),furniture};
  }
  function normalize(input){
    const s={...DEFAULTS,appearance:Object.create(null),placements:Object.create(null)};
    if(!input||typeof input!=='object')return s;
    if(['always','selected','hidden'].includes(input.labelMode))s.labelMode=input.labelMode;
    if(typeof input.outline==='boolean')s.outline=input.outline;
    if(typeof input.followSelection==='boolean')s.followSelection=input.followSelection;
    if(typeof input.showPets==='boolean')s.showPets=input.showPets;
    if(['direct','two-tap'].includes(input.interaction))s.interaction=input.interaction;
    if(input.appearance&&typeof input.appearance==='object'){
      for(const [id,value] of Object.entries(input.appearance).slice(0,60))
        if(id.length<=120&&!['__proto__','prototype','constructor'].includes(id)&&
          Number.isInteger(value)&&value>=0&&value<24)s.appearance[id]=value;
    }
    if(input.placements&&typeof input.placements==='object'){
      for(const [id,p] of Object.entries(input.placements).slice(0,60))
        if(id.length<=120&&!['__proto__','prototype','constructor'].includes(id)&&p&&Number.isInteger(p.room)&&p.room>=0&&p.room<=3&&
          Number.isInteger(p.col)&&p.col>=0&&p.col<21&&
          Number.isInteger(p.row)&&p.row>=0&&p.row<22)
          s.placements[id]={room:p.room,col:p.col,row:p.row};
    }
    if(input.layout)try{s.layout=validateLayout(input.layout);}catch(_){/* use official default */}
    return s;
  }
  function read(){
    try{return normalize(JSON.parse(window.localStorage?.getItem(STORAGE_KEY)||'null'));}
    catch(_){return normalize(null);}
  }
  function write(next){
    const data=normalize(next);
    try{window.localStorage?.setItem(STORAGE_KEY,JSON.stringify(data));}
    catch(_){/* storage may be disabled; current scene still works */}
    return data;
  }
  function seatFor(index,layout){
    const room=Math.floor(index/SEATS.length),seat=SEATS[index%SEATS.length];
    return {segment:room,room,col:seat[0],row:seat[1],
      x:(room*layout.cols+seat[0]+.5)*16,y:(seat[1]+.5)*16};
  }
  function seatWorld(p,layout){
    return{segment:p.room,room:p.room,col:p.col,row:p.row,
      x:(p.room*layout.cols+p.col+.5)*16,y:(p.row+.5)*16};
  }
  function walkable(layout,col,row,{furniture=true}={}){
    if(col<0||row<0||col>=layout.cols||row>=layout.rows)return false;
    const tile=layout.tiles[row*layout.cols+col];
    if(tile===0||tile===255)return false;
    if(!furniture)return true;
    return !layout.furniture.some(f=>{
      const dim=shape(f);if(!dim)return false;
      const id=f.type.split(':')[0];
      // Seats are traversable; furniture's upper decorative rows do not block.
      if(/CHAIR|BENCH/.test(id))return false;
      const skip=/DESK|TABLE|PLANT|PAINTING|PC/.test(id)?1:0;
      return col>=f.col&&col<f.col+dim[0]&&row>=f.row+skip&&row<f.row+dim[1];
    });
  }
  function allocateRoles(ids,layout,existing={}){
    const result=Object.create(null);
    const used=new Set();
    const valid=(p)=>p&&p.room>=0&&p.room<4&&walkable(layout,p.col,p.row,{furniture:false});
    const mark=p=>p.room+':'+p.col+':'+p.row;
    for(const id of ids){
      const p=existing[id];
      if(valid(p)&&!used.has(mark(p))){result[id]={room:p.room,col:p.col,row:p.row};used.add(mark(p));}
    }
    for(const id of ids){
      if(Object.prototype.hasOwnProperty.call(result,id))continue;
      let found=null;
      for(let i=0;i<36;i++){
        const seat=seatFor(i,layout),p={room:seat.room,col:seat.col,row:seat.row};
        if(!used.has(mark(p))&&valid(p)){found=p;break;}
      }
      if(!found)break;
      result[id]=found;used.add(mark(found));
    }
    return result;
  }
  function moveRole(roleId,p,placements,layout){
    if(!roleId||['__proto__','prototype','constructor'].includes(roleId)||
      !p||!Number.isInteger(p.room)||!Number.isInteger(p.col)||!Number.isInteger(p.row)||
      p.room<0||p.room>3||!walkable(layout,p.col,p.row,{furniture:false}))return null;
    if(Object.entries(placements).some(([id,other])=>id!==roleId&&
      other.room===p.room&&other.col===p.col&&other.row===p.row))return null;
    const result=Object.assign(Object.create(null),placements);
    Object.defineProperty(result,roleId,{value:{room:p.room,col:p.col,row:p.row},
      enumerable:true,writable:true,configurable:true});
    return result;
  }
  function findPath(layout,from,to){
    const start=from.col+','+from.row,end=to.col+','+to.row;
    if(!walkable(layout,to.col,to.row,{furniture:false}))return [];
    const frontier=[from],seen=new Set([start]),parents=new Map();
    while(frontier.length){
      const p=frontier.shift(),key=p.col+','+p.row;
      if(key===end){
        const result=[];let k=key;
        while(k!==start){const [col,row]=k.split(',').map(Number);result.unshift({col,row});k=parents.get(k);}
        return result;
      }
      for(const [dc,dr] of [[0,1],[0,-1],[1,0],[-1,0]]){
        const q={col:p.col+dc,row:p.row+dr},k=q.col+','+q.row;
        if(seen.has(k)||!walkable(layout,q.col,q.row))continue;
        seen.add(k);parents.set(k,key);frontier.push(q);
      }
    }
    return [];
  }
  window.CrewPixelConfig={STORAGE_KEY,DEFAULTS,CATALOG,shape,normalize,read,write,
    validateLayout,seatFor,seatWorld,walkable,allocateRoles,moveRole,findPath};
})();
