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
  // Continuous miniature town: one grass slab with aligned streets,
  // sidewalks and small project workshops. No islands, docks or bridges.
  const TOWN_SPACING=10;
  function districtNodes(roleDefs){
    const unique=new Map();
    for(const role of roleDefs||[]){
      const id=role.districtId||role.id;
      if(!unique.has(id))unique.set(id,{
        id,x:role.islandX,z:role.islandZ,
        col:role.townCol,row:role.townRow,role
      });
    }
    return [...unique.values()];
  }
  function planRoadNetwork(roleDefs=roles){
    const lots=districtNodes(roleDefs);
    if(!lots.length)return[];
    const columns=Math.ceil(Math.sqrt(lots.length));
    const rows=Math.ceil(lots.length/columns);
    const at=(col,row)=>({
      id:'street-'+col+'-'+row,col,row,
      x:(col-(columns-1)/2)*TOWN_SPACING+TOWN_SPACING/2,
      z:(row-(rows-1)/2)*TOWN_SPACING+TOWN_SPACING/2
    });
    const edges=[];
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      if(col+1<columns)edges.push({a:at(col,row),b:at(col+1,row),length:TOWN_SPACING});
      if(row+1<rows)edges.push({a:at(col,row),b:at(col,row+1),length:TOWN_SPACING});
    }
    return edges;
  }
  function buildTown(scene,lots){
    if(!lots.length)return;
    const cols=Math.ceil(Math.sqrt(lots.length));
    const rows=Math.ceil(lots.length/cols);
    const w=cols*TOWN_SPACING+4,d=rows*TOWN_SPACING+4;
    box(scene,'#687b78',w,.75,d,0,-.47,0);
    box(scene,'#a9caa8',w,.24,d,0,.23,0); // ground top .35
    // Brick-edged pedestrian routes are continuous across the entire lawn.
    for(let col=0;col<cols;col++){
      const x=(col-(cols-1)/2)*TOWN_SPACING+TOWN_SPACING/2;
      box(scene,'#e4d2b2',1.95,.04,d-3,x,.375,0);
      box(scene,'#fbebce',1.35,.016,d-3,x,.405,0);
    }
    for(let row=0;row<rows;row++){
      const z=(row-(rows-1)/2)*TOWN_SPACING+TOWN_SPACING/2;
      box(scene,'#e4d2b2',w-3,.04,1.95,0,.376,z);
      box(scene,'#f7e8d2',w-3,.016,1.38,0,.407,z);
    }
    for(const lot of lots){
      // All Role avatar slots stand on this connected building frontage.
      box(scene,'#e9deca',9.25,.036,.78,lot.x,.389,lot.z+2.65);
      box(scene,'#eee1ce',.88,.034,2.46,
        lot.x+TOWN_SPACING/2,.390,lot.z+3.8);
    }
    // Small communal green at the perimeter, deliberately outside streets.
    const parkX=-(cols*TOWN_SPACING)/2-1.2;
    const parkZ=-(rows*TOWN_SPACING)/2-1.2;
    sphere(scene,'#628f79',.76,parkX,.86,parkZ,1,1.05,1);
    cylinder(scene,'#8c795e',.11,.12,.67,parkX,.55,parkZ,7);
    for(const side of [-1,1]){
      const x=side*(w/2-1.0),z=d/2-1.0;
      cylinder(scene,'#8f7b6b',.08,.10,.64,x,.67,z,7);
      sphere(scene,'#589c7e',.54,x,1.12,z);
    }
  }
  function districtBuilding(scene,role,index){
    const x=role.islandX,z=role.islandZ;
    const type=profession(role);
    const wall=['#b3d8e8','#f2ccdb','#e3dab7','#d6c5ea','#c8dfc4'];
    const roof=['#6284b7','#bf7096','#ba8e62','#8372ae','#6d9b89'];
    const group=new T.Group();group.position.set(x,0,z);scene.add(group);
    const paint=wall[index%wall.length],accent=roof[index%roof.length];
    // Workshop occupies northern half of each lot; the south sidewalk is
    // reserved for 1–3 Role avatars and never overlaps any building.
    box(group,paint,3.45,1.76,2.54,0,1.25,-1.6);
    box(group,accent,3.85,.42,2.92,0,2.35,-1.6);
    box(group,'#f8f2dd',.78,1.11,.06,0,1.04,-.30);
    box(group,'#65818b',.54,.74,.09,0,.86,-.255);
    for(const side of [-1,1]){
      box(group,'#f8f3e7',.69,.72,.09,side*1.10,1.35,-.27);
      box(group,'#80b8c2',.53,.55,.10,side*1.10,1.35,-.21);
    }
    // An identity-colored roof signal, but never a fabricated work status.
    box(group,role.accent,1.22,.16,.18,0,2.02,-.1);
    for(const p of [.32,1.02]){
      box(group,'#eee3cd',.9,.048,.44,0,.392,p);
    }
    // Small lot decorations, kept clear of the player-facing walking lane.
    cylinder(group,'#9b826a',.1,.12,.72,-3.25,.65,-1.1,7);
    sphere(group,'#6ca792',.62,-3.25,1.21,-1.1);
    cylinder(group,'#9b826a',.10,.12,.57,3.2,.62,-1.5,7);
    sphere(group,'#81b99a',.51,3.2,1.08,-1.5);
    box(group,'#927960',1.25,.12,.40,3.08,.64,1.15);
    box(group,'#927960',.12,.55,.12,2.58,.37,1.15);
    box(group,'#927960',.12,.55,.12,3.58,.37,1.15);
    if(type==='teacher'){
      box(group,'#e0b8cd',1.28,.72,.13,-2.55,1.1,-.2);
      box(group,'#f8f0e5',1.05,.45,.14,-2.55,1.1,-.12);
    }else if(type==='story'){
      for(let i=0;i<3;i++)box(group,['#f1c77d','#b7afd8','#a5c8b7'][i],
        .23,.5,.35,-2.95+i*.27,.6,-.15);
    }else if(type==='fortune'){
      part(group,new T.OctahedronGeometry(.48),'#b5a1d9',-2.8,.85,-.15);
    }else if(type==='developer'){
      box(group,'#76bbdf',1.24,.82,.13,-2.6,1.13,-.13);
      box(group,'#274365',.99,.6,.14,-2.6,1.13,-.08);
    }else{
      sphere(group,'#a7d1c5',.42,-2.65,.75,-.18);
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
    // Runtime working is the only event allowed to light this work ring.
    // A separate material is intentional so 36 Roles remain independent.
    const workHalo=new T.Mesh(new T.TorusGeometry(.95,.048,5,28),
      new T.MeshBasicMaterial({color:'#7ff2c5',transparent:true,opacity:0,depthWrite:false}));
    workHalo.rotation.x=-Math.PI/2;workHalo.position.y=.035;root.add(workHalo);
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
    return {role,root,body,arms,legs,workHalo,mode:'idle',expires:0,reactionUntil:0};
  }
  // Folded low-poly paper plane. Tiny per-flight meshes, no image assets,
  // model downloads or additional renderer. Local forward is +Z.
  function createPaperPlane(scene,kind='handoff'){
    const reply=kind==='reply';
    const paper=reply?'#dafff0':'#e5f5ff';
    const fold=reply?'#64db9b':'#8cbcff';
    const root=new T.Group();
    const surface=new T.BufferGeometry();
    const wingTriangles=[
      // Left and right open wings
      0,.02,.76,  -.51,-.08,-.34,  0,.17,-.24,
      0,.02,.76,   0,.17,-.24,    .51,-.08,-.34,
      // Folded tail panels add an origami crease
      0,.02,.76,   0,.17,-.24,    0,.025,-.61,
      0,.02,.76,   0,.025,-.61,   0,.17,-.24
    ];
    surface.setAttribute('position',new T.Float32BufferAttribute(wingTriangles,3));
    surface.computeVertexNormals();
    const wings=new T.Mesh(surface,new T.MeshBasicMaterial({
      color:paper,side:T.DoubleSide,transparent:true,opacity:.98
    }));
    root.add(wings);
    const stripe=new T.Mesh(new T.BoxGeometry(.045,.025,.48),
      new T.MeshBasicMaterial({color:fold}));
    stripe.position.set(0,.15,-.12);
    root.add(stripe);
    root.scale.setScalar(.8);
    scene.add(root);
    const trails=[];
    for(let i=0;i<3;i++){
      const bead=new T.Mesh(
        new T.SphereGeometry(.085-i*.014,6,4),
        new T.MeshBasicMaterial({
          color:fold,transparent:true,opacity:0,depthWrite:false
        })
      );
      scene.add(bead);
      trails.push(bead);
    }
    return {root,trails,kind};
  }
  function disposePaperPlane(scene,plane){
    if(!plane)return;
    for(const object of [plane.root,...plane.trails]){
      scene.remove(object);
      object.traverse(mesh=>{
        mesh.geometry?.dispose?.();
        if(Array.isArray(mesh.material))mesh.material.forEach(m=>m?.dispose?.());
        else mesh.material?.dispose?.();
      });
    }
  }
  // The human-controlled visitor is distinct from every AI Role, and never
  // carries roleId so map raycasting cannot mistake the visitor for an agent.
  function createPlayer(scene,point){
    const root=new T.Group();
    root.position.set(point.x,.43,point.z);scene.add(root);
    const body=new T.Group();root.add(body);
    const base=cylinder(root,'#d5f6fc',.49,.53,.085,0,-.045,0,12);
    const ring=part(root,new T.TorusGeometry(.69,.07,5,20),'#ffe6a4',0,.02,0);
    ring.rotation.x=-Math.PI/2;
    cylinder(body,'#187e91',.34,.4,.66,0,.72,0,10);
    box(body,'#f3e7cb',.23,.08,.13,0,.97,.30);
    const legs=[],arms=[];
    for(const side of [-1,1]){
      const leg=cylinder(body,'#344259',.13,.13,.38,side*.18,.22,0,8);
      legs.push({mesh:leg,side});
      const arm=new T.Group();arm.position.set(side*.34,1.0,0);body.add(arm);
      cylinder(arm,'#187e91',.12,.12,.43,side*.045,-.19,0,8);
      sphere(arm,'#f1c5a2',.125,side*.045,-.42,.02);
      arms.push(arm);
    }
    sphere(body,'#f1c5a2',.46,0,1.62,0);
    sphere(body,'#314263',.47,0,1.88,-.07,1,.54,.9);
    const pointer=part(root,new T.ConeGeometry(.28,.45,4),'#ffdc86',0,2.65,0);
    pointer.rotation.x=Math.PI; // arrowhead points toward the visitor
    return{root,body,legs,arms};
  }
  function create(scene, roleDefs=roles) {
    const districts=districtNodes(roleDefs);
    buildTown(scene,districts);
    districts.forEach((district,i)=>districtBuilding(scene,district.role,i));
    const actors=roleDefs.map((role,index)=>character(scene,role,index));
    // Town roads are at shared street intersections, not island bridges.
    actors.roadVisuals=planRoadNetwork(roleDefs);
    return actors;
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
    const cols=Math.ceil(Math.sqrt(Math.max(1,count)));
    const rows=Math.ceil(count/cols);
    const col=index%cols,row=Math.floor(index/cols);
    return{x:(col-(cols-1)/2)*TOWN_SPACING,
      z:(row-(rows-1)/2)*TOWN_SPACING,col,row};
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
          districtIndex,districtSize:spacing,townCol:pos.col,townRow:pos.row,
          islandX:pos.x,islandZ:pos.z,
          x:pos.x+offset,z:pos.z+2.65});
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

  // Standalone demo must use exactly the same continuous-town grid as live
  // data, otherwise the visitor would spawn outside the rendered lawn.
  roles.forEach((role,index)=>{
    const pos=districtPosition(index,roles.length);
    Object.assign(role,{districtId:role.id,townCol:pos.col,townRow:pos.row,
      islandX:pos.x,islandZ:pos.z,x:pos.x,z:pos.z+2.65});
  });
  function releaseMaterials(){cache.clear();}
  root.WorldLabKit={roles,create,createPlayer,createPaperPlane,disposePaperPlane,makeLiveRoles,mapExtent,planRoadNetwork,districtPosition,releaseMaterials,MAX_WORLD_ROLES,MEMBERS_PER_DISTRICT};
})(window);
