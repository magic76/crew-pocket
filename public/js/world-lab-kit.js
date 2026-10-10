/* Geometry/characters for isolated Crew World visual lab (Three.js r148). */
(function (root) {
  'use strict';
  const T = root.THREE;
  const roles = [
    { id:'pocket', short:'Pocket', name:'Pocket Developer', initial:'P',
      color:'#2B7BFF', skin:'#f0c49c', hair:'#232941', coat:'#2455D9', accent:'#8DDEFF',
      description:'冷色工作室 · 藍色外套 · 程式開發 Role', x:-5.6,z:2.5, islandX:-6.1,islandZ:1.6 },
    { id:'teacher', short:'Teacher', name:'Teacher Developer', initial:'T',
      color:'#FF4B9C', skin:'#f1c6aa', hair:'#74335D', coat:'#D82880', accent:'#FFD0EE',
      description:'粉色教學區 · 波浪短髮 · 語言教學 Role', x:5.65,z:2.4,islandX:6.1,islandZ:1.6 },
    { id:'story', short:'Story', name:'Story Developer', initial:'S',
      color:'#F5A223', skin:'#cf9d77', hair:'#312642', coat:'#B96614', accent:'#FFE19B',
      description:'暖色創作區 · 圓框眼鏡 · 故事設計 Role', x:-.7,z:-6.1,islandX:0,islandZ:-6.9 }
  ];
  const cache = new Map();
  function material(color) {
    if (!cache.has(color)) cache.set(color, new T.MeshStandardMaterial({
      color, flatShading:true, roughness:.77, metalness:.03
    }));
    return cache.get(color);
  }
  function part(parent, geometry, color, x=0,y=0,z=0) {
    const mesh = new T.Mesh(geometry, material(color));
    mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true;
    parent.add(mesh); return mesh;
  }
  function box(p,c,w,h,d,x=0,y=0,z=0) {
    return part(p,new T.BoxGeometry(w,h,d),c,x,y,z);
  }
  function sphere(p,c,r,x=0,y=0,z=0,sx=1,sy=1,sz=1) {
    const m=part(p,new T.SphereGeometry(r,12,9),c,x,y,z);
    m.scale.set(sx,sy,sz);return m;
  }
  function cylinder(p,c,a,b,h,x=0,y=0,z=0,sides=9) {
    return part(p,new T.CylinderGeometry(a,b,h,sides),c,x,y,z);
  }
  function island(scene,role,index) {
    const x=role.islandX,z=role.islandZ;
    const sides=['#638ba7','#a17f9c','#9a866e'];
    const tops=['#91cbd0','#e6b0c6','#d2bf8e'];
    cylinder(scene,sides[index%sides.length],3.64,3.05,1.15,x,-.55,z,10);
    cylinder(scene,tops[index%tops.length],3.54,3.58,.30,x,.16,z,10);
    cylinder(scene,'#f9efdb',3.34,3.34,.05,x,.335,z,10);
    for(let i=0;i<8;i++){
      const angle=Math.PI*2*i/8;
      sphere(scene,i%2?'#d2f0d4':'#e5e2b4',.13,
        x+Math.cos(angle)*2.95,.44,z+Math.sin(angle)*2.95);
    }
    const group=new T.Group();group.position.set(x,0,z);scene.add(group);
    const walls=['#a7d7ed','#eac1d5','#e8d8b3'];
    const roofs=['#638bc1','#c779a8','#ba9268'];
    box(group,walls[index % walls.length],2.22,1.82,1.55,.65,1.35,-1.55);
    box(group,roofs[index % roofs.length],2.48,.36,1.92,.65,2.40,-1.55);
    box(group,'#fff8e9',.70,.85,.10,-.12,1.31,-.73);
    box(group,role.accent,.50,.62,.06,-.12,1.30,-.66);
    box(group,'#25374d',.9,.67,.1,1.25,1.48,-.70);
    box(group,role.color,.75,.51,.04,1.25,1.48,-.63);
    box(group,'#725e68',1.45,.18,.73,.91,.82,.55);
    box(group,'#654d5b',.12,.75,.12,.33,.49,.55);
    box(group,'#654d5b',.12,.75,.12,1.49,.49,.55);
    box(group,'#25374d',.92,.68,.10,.88,1.34,.20);
    box(group,role.accent,.78,.53,.03,.88,1.34,.265);
    box(group,'#d2babc',.66,.05,.24,.88,.96,.73);
    box(group,'#fff2d2',.24,.45,.17,-1.62,.58,-.8);
    sphere(group,role.color,.4,-1.62,.93,-.8,1,1.1,1);
    for(const side of [-2.7,2.7]){
      cylinder(group,'#d8c6a3',.055,.055,.76,side,.76,1.35,7);
      sphere(group,'#fff1b5',.17,side,1.20,1.35);
    }
  }
  function bridge(scene,a,b) {
    const dx=b[0]-a[0],dz=b[1]-a[1];
    const len=Math.hypot(dx,dz),rotation=Math.atan2(dx,dz);
    for(const [width,height,y,color] of [
      [1.6,.23,.18,'#c5a78b'],[1.48,.05,.32,'#f4dcb0']]){
      const road=box(scene,color,width,height,len,(a[0]+b[0])/2,y,(a[1]+b[1])/2);
      road.rotation.y=rotation;
    }
    for(const edge of [-.82,.82]){
      const rail=box(scene,'#f3e4c6',.09,.28,len,(a[0]+b[0])/2,.59,(a[1]+b[1])/2);
      rail.rotation.y=rotation;
      rail.position.x+=Math.cos(rotation)*edge;
      rail.position.z-=Math.sin(rotation)*edge;
    }
  }
  // Every Role uses the same body rig with distinct, lightweight identity props.
  function profession(role) {
    const text=(String(role.name||'')+' '+String(role.projectId||'')).toLowerCase();
    if(/teacher|老師|教學/.test(text))return 'teacher';
    if(/story|故事|創作/.test(text))return 'story';
    if(/fortune|占星|命理|星盤/.test(text))return 'fortune';
    if(/helper|助理|助手/.test(text))return 'helper';
    if(/pocket|developer|程式|開發/.test(text))return 'developer';
    return 'general';
  }
  function accessory(body,role,kind) {
    const prop=new T.Group();prop.position.set(0,.79,.58);body.add(prop);
    if(kind==='developer'){
      box(prop,'#263950',.69,.07,.43,0,-.08,.04);
      box(prop,role.accent,.69,.53,.06,0,.19,-.15);
    }else if(kind==='teacher'){
      const a=box(prop,'#fff3d9',.43,.07,.52,-.22,.05,0);
      const b=box(prop,'#fff3d9',.43,.07,.52,.22,.05,0);
      a.rotation.z=.17;b.rotation.z=-.17;
      box(prop,role.color,.08,.10,.53,0,.00,0);
    }else if(kind==='story'){
      box(prop,'#fff4dc',.66,.06,.50,0,.02,0);
      const brush=cylinder(prop,'#71513b',.03,.03,.73,.31,.32,.15,7);
      brush.rotation.z=.55;
      sphere(prop,role.color,.10,.13,.61,.15);
    }else if(kind==='fortune'){
      part(prop,new T.OctahedronGeometry(.35),role.accent,0,.28,-.05);
      cylinder(prop,'#ae9cd1',.36,.32,.11,0,-.08,0,9);
    }else if(kind==='helper'){
      box(prop,'#344657',.54,.40,.12,-.09,.10,.04);
      sphere(prop,'#abefe2',.18,.32,.30,.04);
    }else{
      box(prop,'#e3ecf5',.54,.68,.10,0,.18,0);
      box(prop,role.color,.29,.07,.12,0,.45,.04);
    }
    return prop;
  }
  function character(scene,role,index) {
    const root=new T.Group();root.position.set(role.x,.43,role.z);scene.add(root);
    const body=new T.Group();root.add(body);
    // Solid accent plinth + matching halo maintain identity when zoomed out.
    const plinth=cylinder(root,role.color,.61,.68,.11,0,-.06,0,12);
    plinth.material.emissive=new T.Color(role.color);
    plinth.material.emissiveIntensity=.16;
    const ring=part(root,new T.TorusGeometry(.77,.08,6,24),role.accent,0,.025,0);
    ring.rotation.x=-Math.PI/2;
    const kind=profession(role);
    cylinder(body,role.coat,.38,.43,.72,0,.72,0,10);
    box(body,role.color,.61,.10,.12,0,.96,.27); // strong shoulder band
    box(body,role.accent,.18,.45,.03,0,.76,.38);
    const legs=[];
    for(const side of [-1,1]){
      const leg=cylinder(body,'#39475b',.12,.15,.39,side*.19,.23,0,8);
      sphere(body,role.color,.19,side*.19,.09,.14,1.08,.48,1.5);
      legs.push({mesh:leg,side});
    }
    const arms=[];
    for(const side of [-1,1]){
      const arm=new T.Group();arm.position.set(side*.39,1,0);body.add(arm);
      cylinder(arm,role.coat,.13,.115,.44,side*.04,-.20,0,8);
      sphere(arm,role.skin,.115,side*.05,-.44,.01);
      arms.push(arm);
    }
    sphere(body,role.skin,.52,0,1.63,0,1,1.03,.94);
    sphere(body,role.hair,.54,0,1.96,-.065,1.04,.54,.94);
    for(let j=0;j<4;j++){
      sphere(body,role.hair,.18,-.36+j*.235,1.92+((j+index)%2)*.07,.32,1.05,.73,.85);
    }
    if(index===1)for(const side of [-1,1]){
      sphere(body,role.hair,.29,side*.48,1.59,-.1,.8,1.45,.85);
    }
    if(kind==='teacher'){
      for(const side of [-1,1])sphere(body,role.hair,.28,side*.48,1.56,-.11,.82,1.38,.85);
    }else if(kind==='story'){
      sphere(body,role.hair,.24,-.20,2.23,.0,1.2,.65,.85);
    }else if(kind==='fortune'){
      const crown=cylinder(body,role.color,.34,.47,.20,0,2.22,0,8);
      crown.rotation.z=.05;
    }else if(kind==='helper'){
      sphere(body,role.accent,.23,.15,2.19,-.15);
    }else{
      sphere(body,role.hair,.22,.07,2.25,-.05,.80,1.10,1.0);
    }
    for(const side of [-1,1]){
      sphere(body,'#fffaf4',.105,side*.19,1.68,.455,.84,1.1,.35);
      sphere(body,'#293147',.058,side*.19,1.68,.485,.86,1,.57);
      sphere(body,'#ed9f9e',.11,side*.35,1.52,.389,1,.45,.37);
    }
    sphere(body,'#b27567',.042,0,1.53,.492,1,.48,.42);
    if(kind==='story'){
      for(const side of [-1,1]){
        const frame=part(body,new T.TorusGeometry(.126,.019,5,12),'#433c4b',side*.19,1.675,.49);
        frame.scale.y=.81;
      }
      box(body,'#433c4b',.15,.022,.03,0,1.68,.49);
    }
    const prop=accessory(body,role,kind);
    root.traverse(mesh=>{if(mesh.isMesh)mesh.userData.roleId=role.id;});
    return {role,root,body,arms,legs,mode:'idle',expires:0};
  }
  function create(scene, roleDefs=roles) {
    const hub=[0,-.8];
    // A neighborhood is a project district (up to 3 Roles), not one island
    // per Role. Preserve all individual characters/click targets/conversations.
    const districts=[...new Map(roleDefs.map(role=>[
      role.districtId||role.id,role
    ])).values()];
    districts.forEach(role=>bridge(scene,[role.islandX,role.islandZ],hub));
    districts.forEach((role,i)=>island(scene,role,i));
    cylinder(scene,'#d4b6df',1.05,1.2,.65,0,-.14,-.8,10);
    cylinder(scene,'#7bcadf',.86,.9,.15,0,.28,-.8,12);
    sphere(scene,'#a7e5ee',.55,0,1,-.8,1,1.1,1);
    for(const [x,z,color] of [[-8.3,-.2,'#68c6a5'],[8.35,.15,'#f0a5bb'],[2.25,-8.85,'#efc47b']]){
      cylinder(scene,'#7d7180',.1,.14,1.2,x,.86,z,7);
      sphere(scene,color,.75,x,1.82,z,1,1.2,1);
      sphere(scene,color,.52,x+.32,1.65,z+.25);
    }
    return roleDefs.map((role,index)=>character(scene,role,index));
  }

  // Roles are read-only projections of verified /api/crew-status metadata.
  // Deterministic palette and positioning, no message body / shared context.
  const LIVE_COLORS=[
    {color:'#246EFF',coat:'#214BD4',accent:'#A2D8FF',hair:'#25304D',skin:'#EEC39B'},
    {color:'#F72E93',coat:'#CE1977',accent:'#FFD1E9',hair:'#73365D',skin:'#F1C6AA'},
    {color:'#FFAA18',coat:'#B85F09',accent:'#FFEAAC',hair:'#393146',skin:'#CF9D77'},
    {color:'#8C57EF',coat:'#6437C8',accent:'#E5C8FF',hair:'#28244A',skin:'#EAC8AA'},
    {color:'#00BB9E',coat:'#078776',accent:'#A0F8E9',hair:'#293B40',skin:'#DDB395'},
    {color:'#F56647',coat:'#BD412D',accent:'#FFD1AE',hair:'#3F3143',skin:'#D3A487'}
  ];
  function liveIndex(role, fallback) {
    const text=String(role.roleName||'')+' '+String(role.projectId||'');
    if(/teacher|老師|教學/i.test(text))return 1;
    if(/story|故事/i.test(text))return 2;
    if(/fortune|星盤|占星|命理/i.test(text))return 3;
    if(/helper|助手|助理/i.test(text))return 4;
    if(/pocket/i.test(text))return 0;
    return fallback%LIVE_COLORS.length;
  }
  const MAX_WORLD_ROLES=36;
  const MEMBERS_PER_DISTRICT=3;
  function districtPosition(index,count){
    // Compact three-ring town: 6 inner districts, 12 middle, up to 18 outer.
    // Avoid overlapping 7.3-unit island footprints as the town grows.
    const ring=index<6?0:index<18?1:2;
    const offset=ring===0?0:ring===1?6:18;
    const capacity=[6,12,18][ring];
    const size=Math.min(capacity,count-offset);
    const ordinal=index-offset;
    const angle=(Math.PI*2*(ordinal+.25*(ring%2)))/Math.max(size,1)-Math.PI/2;
    const radius=count===1?6:[11.5,22.5,33.5][ring];
    return {x:Math.cos(angle)*radius,z:Math.sin(angle)*radius};
  }
  function makeLiveRoles(input) {
    if(!Array.isArray(input))return [];
    const seen=new Set();
    const members=input.filter(role=>{
      if(!role||typeof role.roleId!=='string'||!role.roleId.trim()||seen.has(role.roleId))return false;
      seen.add(role.roleId);return true;
    }).slice(0,MAX_WORLD_ROLES);
    if(!members.length)return [];
    const buckets=new Map();
    for(const member of members){
      const key=String(member.projectId||'general').trim()||'general';
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(member);
    }
    const districts=[];
    for(const [key,items] of buckets){
      for(let start=0;start<items.length;start+=MEMBERS_PER_DISTRICT){
        districts.push({key,id:key+'#'+Math.floor(start/MEMBERS_PER_DISTRICT),
          members:items.slice(start,start+MEMBERS_PER_DISTRICT)});
      }
    }
    // Map from immutable ID to project district and individual standing spot.
    const positions=new Map();
    districts.forEach((district,districtIndex)=>{
      const pos=districtPosition(districtIndex,districts.length);
      district.members.forEach((member,slot)=>{
        const spacing=district.members.length;
        const offset=spacing===1?0:spacing===2?(slot===0?-1.3:1.3):(slot-1)*1.8;
        positions.set(member.roleId,{districtId:district.id,
          districtIndex,districtSize:spacing,islandX:pos.x,islandZ:pos.z,
          x:pos.x+offset,z:pos.z+1.65});
      });
    });
    const assigned=new Set();
    return members.map((value,index)=>{
      let style;
      if(index<LIVE_COLORS.length){
        let paletteIndex=liveIndex(value,index);
        while(assigned.has(paletteIndex))paletteIndex=(paletteIndex+1)%LIVE_COLORS.length;
        assigned.add(paletteIndex);
        style=LIVE_COLORS[paletteIndex];
      }else{
        // Beyond six, procedural hues keep each visible identity distinct.
        const hue=Math.round((index*137.508+17)%360);
        style={color:'hsl('+hue+',81%,55%)',coat:'hsl('+hue+',62%,37%)',
          accent:'hsl('+hue+',94%,80%)',hair:'#303449',skin:'#e7b795'};
      }
      const name=String(value.roleName||'Role').slice(0,80);
      const position=positions.get(value.roleId);
      return {
        ...style,...position,id:value.roleId,name,
        short:name.length>13?name.slice(0,12)+'…':name,
        initial:Array.from(name)[0]||'R',
        description:'Role 小隊成員 · '+(String(value.projectId||'General').slice(0,60))+
          ' 區域（每位 Role 的 Context 獨立）',
        projectId:String(value.projectId||''),live:true,
        state:['working','waiting','idle','new'].includes(value.state)?value.state:'unknown',
        workTitle:value.state==='working'&&typeof value.currentWork?.title==='string'
          ?value.currentWork.title.slice(0,75):'',
        attention:Number.isSafeInteger(value.attentionCount)
          ?Math.max(0,Math.min(999,value.attentionCount)):0
      };
    });
  }
  function mapExtent(roleDefs){
    const islands=[...new Map(roleDefs.map(r=>[r.districtId||r.id,r])).values()];
    return Math.max(10,...islands.map(r=>Math.hypot(r.islandX,r.islandZ)+4));
  }

  function releaseMaterials(){cache.clear();}
  root.WorldLabKit={roles,create,makeLiveRoles,mapExtent,releaseMaterials,MAX_WORLD_ROLES,MEMBERS_PER_DISTRICT};
})(window);
