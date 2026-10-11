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
  // A deterministic miniature village: central plaza, gently bending radial
  // lanes and varied workshops on both sides. The same edge polylines are
  // painted here AND supplied to WorldLabNavigation for actual player travel.
  const TOWN_SPACING=8.7;
  const FRONT_Z=2.65;
  const branchCount=count=>Math.min(6,Math.max(2,Math.ceil(Math.max(1,count)/4)));
  function lanePoint(branch,depth,branches){
    const angle=-Math.PI/2+2*Math.PI*branch/branches+
      .095*Math.sin(branch*2.4+.5);
    const ux=Math.cos(angle),uz=Math.sin(angle);
    const vx=-uz,vz=ux;
    const radius=13.5+TOWN_SPACING*depth;
    const bend=.9*Math.sin(depth*.9+branch*1.2);
    return {x:radius*ux+bend*vx,z:radius*uz+bend*vz,
      ux,uz,vx,vz,angle};
  }
  function districtPosition(index,count){
    const branches=branchCount(count),branch=index%branches,depth=Math.floor(index/branches);
    const lane=lanePoint(branch,depth,branches);
    // Alternate per *distance band*, not per neighboring avenue: opposite
    // sides on adjacent 60° spokes can otherwise overlap at the plaza.
    const side=depth%2===0?1:-1;
    const lateral=5.9+.35*Math.sin(index*1.71);
    const x=lane.x+lane.vx*side*lateral,z=lane.z+lane.vz*side*lateral;
    const towards={x:lane.x-x,z:lane.z-z};
    const baseRotation=Math.atan2(towards.x,towards.z);
    const rotation=baseRotation+.07*Math.sin(index*2.53);
    return{x,z,branch,depth,rotation,roadX:lane.x,roadZ:lane.z,
      frontX:x+Math.sin(rotation)*3.30,
      frontZ:z+Math.cos(rotation)*3.30};
  }
  function districtNodes(roleDefs){
    const unique=new Map();
    for(const role of roleDefs||[]){
      const id=role.districtId||role.id;
      if(id&&!unique.has(id))unique.set(id,{
        id,x:role.islandX,z:role.islandZ,
        branch:role.townBranch,depth:role.townDepth,
        rotation:role.townRotation,
        frontX:role.townFrontX,frontZ:role.townFrontZ,
        roadX:role.townRoadX,roadZ:role.townRoadZ,role
      });
    }
    return [...unique.values()];
  }
  const lengthOf=points=>points.reduce((sum,p,i)=>i?sum+
    Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z):0,0);
  function planRoadNetwork(roleDefs=roles){
    const lots=districtNodes(roleDefs);
    if(!lots.length)return[];
    const branches=branchCount(lots.length);
    const center={id:'plaza',x:0,z:0};
    const edges=[],laneMap=new Map();
    const add=(a,b,points)=>{
      const line=points||[{x:a.x,z:a.z},{x:b.x,z:b.z}];
      const length=lengthOf(line);
      if(length>.08)edges.push({a,b,points:line,length});
    };
    for(let branch=0;branch<branches;branch++){
      const laneLots=lots.filter(l=>l.branch===branch).sort((a,b)=>a.depth-b.depth);
      let previous=center;
      for(const lot of laneLots){
        const node={id:'lane-'+branch+'-'+lot.depth,x:lot.roadX,z:lot.roadZ};
        laneMap.set(node.id,node);
        // Every leg begins and ends exactly at a rendered junction.
        add(previous,node);
        const curb={id:lot.id,x:lot.frontX,z:lot.frontZ};
        add(node,curb);
        previous=node;
      }
    }
    // The first junctions form a curved village loop, not a grid. These
    // additional walkable shortcuts make travel around the plaza natural.
    if(branches>=3){
      for(let branch=0;branch<branches;branch++){
        const next=(branch+1)%branches;
        const from=laneMap.get('lane-'+branch+'-0');
        const to=laneMap.get('lane-'+next+'-0');
        if(!from||!to)continue;
        let start=Math.atan2(from.z,from.x);
        let finish=Math.atan2(to.z,to.x);
        while(finish<=start)finish+=Math.PI*2;
        const points=[{x:from.x,z:from.z}];
        for(let j=1;j<6;j++){
          const t=j/6,theta=start+(finish-start)*t;
          const r=13.5;
          points.push({x:Math.cos(theta)*r,z:Math.sin(theta)*r});
        }
        points.push({x:to.x,z:to.z});
        add(from,to,points);
      }
    }
    return edges;
  }
  function roadSegment(scene,a,b,width,color,y=.385){
    const dx=b.x-a.x,dz=b.z-a.z,dist=Math.hypot(dx,dz);
    if(dist<.04)return;
    const mesh=box(scene,color,width,.036,dist,(a.x+b.x)/2,y,(a.z+b.z)/2);
    mesh.rotation.y=Math.atan2(dx,dz);
  }
  function buildTown(scene,lots,roads){
    if(!lots.length)return;
    const boundX=Math.max(15,...lots.map(l=>Math.abs(l.x)+7));
    const boundZ=Math.max(15,...lots.map(l=>Math.abs(l.z)+7));
    box(scene,'#748b80',boundX*2+6,.70,boundZ*2+6,0,-.43,0);
    box(scene,'#a8cba8',boundX*2+6,.22,boundZ*2+6,0,.24,0);
    // Road surfaces follow actual navigation polylines, including bends
    // and the curved ring. Small round joints prevent visual corner gaps.
    for(const edge of roads){
      for(let i=1;i<edge.points.length;i++){
        roadSegment(scene,edge.points[i-1],edge.points[i],1.95,'#d9c3a8');
        roadSegment(scene,edge.points[i-1],edge.points[i],1.38,'#f3e1bf',.412);
      }
      for(let i=1;i<edge.points.length-1;i++){
        cylinder(scene,'#f3e1bf',.76,.76,.032,edge.points[i].x,.418,edge.points[i].z,12);
      }
    }
    for(const edge of roads){
      for(const node of [edge.a,edge.b]){
        cylinder(scene,'#f3e1bf',.85,.85,.032,node.x,.417,node.z,12);
      }
    }
    // Distinct curved-edge public square, kept free for walking.
    cylinder(scene,'#bfa995',4.25,4.25,.037,0,.415,0,24);
    cylinder(scene,'#e2d0b4',3.95,3.95,.04,0,.44,0,24);
    const ring=part(scene,new T.TorusGeometry(3.35,.06,5,32),'#fbefdb',0,.470,0);
    ring.rotation.x=-Math.PI/2;
    for(let i=0;i<6;i++){
      const angle=i*Math.PI/3+.21,x=Math.cos(angle)*5.3,z=Math.sin(angle)*5.3;
      cylinder(scene,'#96816d',.10,.12,.72,x,.71,z,7);
      sphere(scene,i%2?'#78b49b':'#629f89',.58,x,1.28,z);
    }
    // Each building gets its own locally rotated frontage and threshold.
    for(const lot of lots){
      const group=new T.Group();
      group.position.set(lot.x,0,lot.z);
      group.rotation.y=lot.rotation;
      scene.add(group);
      box(group,'#e8ddc9',6.8,.034,.78,0,.387,FRONT_Z);
      box(group,'#ead9c0',1.0,.03,.94,0,.397,3.18);
    }
    // Peripheral greenery preserves the tiny-town feel without obstructing
    // either the avenue centre-lines or the visible Role entrances.
    for(const lot of lots){
      const group=new T.Group();
      group.position.set(lot.x,0,lot.z);group.rotation.y=lot.rotation;scene.add(group);
      cylinder(group,'#987c65',.12,.14,.64,-3.33,.64,-1.3,7);
      sphere(group,'#77b59c',.64,-3.33,1.16,-1.3);
      cylinder(group,'#987c65',.09,.11,.52,3.3,.58,-1.55,7);
      sphere(group,'#6fa589',.50,3.3,1.08,-1.55);
    }
  }
  // Six genuinely different silhouettes, not the same box recolored.
  // Building front is local +Z; rotation faces each workshop's lane.
  function districtBuilding(scene,role,index){
    const kind=profession(role);
    const paint=['#b8d6e9','#ead0d9','#eadbb5','#d4c8e8','#c3d9c6','#e6c9af'];
    const roofs=['#668bb6','#bd7598','#b99468','#8c76ba','#6b9d92','#b97f62'];
    const salt=Array.from(String(role.projectId||role.id)).reduce((v,c)=>v+c.charCodeAt(0),0);
    const variant=(index*7+salt)%6;
    const wall=paint[variant],roof=roofs[variant];
    const group=new T.Group();
    group.position.set(role.islandX,0,role.islandZ);
    group.rotation.y=role.townRotation||0;
    scene.add(group);
    // Distinct base proportions and separate window/roof/entrance grammar.
    if(variant===0){ // creative cottage with pitched two-piece roof
      box(group,wall,3.7,1.85,2.65,0,1.25,-1.70);
      for(const side of [-1,1]){
        const slope=box(group,roof,2.50,.23,3.2,side*.95,2.42,-1.7);
        slope.rotation.z=side*.43;
      }
      box(group,'#f1e9d8',1.02,.31,.36,-1.2,2.04,-.13);
    }else if(variant===1){ // stacked research townhouse
      box(group,wall,3.25,3.15,2.54,0,1.94,-1.72);
      box(group,roof,3.56,.28,2.86,0,3.67,-1.72);
      box(group,'#fff0d7',1.28,.24,.22,0,3.27,-.30);
      for(const side of [-1,1])box(group,'#84c4d9',.55,.48,.1,side*.91,2.58,-.39);
    }else if(variant===2){ // glass conservatory / language academy
      box(group,'#d0e9e7',4.0,1.80,2.80,0,1.27,-1.65);
      box(group,'#82bfc3',3.45,.95,.07,0,1.31,-.19);
      for(let j=-1;j<=1;j++)box(group,'#e9f2e9',.09,1.65,.10,j*1.08,1.30,-.13);
      const canopy=box(group,roof,4.35,.24,1.32,0,2.35,-.78);
      canopy.rotation.z=.08;
    }else if(variant===3){ // corner shop / low pavilion
      box(group,wall,4.25,1.64,2.30,0,1.12,-1.65);
      box(group,roof,4.72,.27,2.82,0,2.11,-1.65);
      box(group,'#f6e3c8',4.4,.22,.90,0,1.89,-.13);
      for(let j=-1;j<=1;j++)box(group,['#eec5aa','#cad9ed','#e6d0e5'][j+1],
        1.19,.18,.60,j*1.42,1.81,.14);
    }else if(variant===4){ // observatory / fortune turret
      cylinder(group,wall,1.80,1.92,2.75,0,1.75,-1.70,9);
      part(group,new T.ConeGeometry(2.16,1.2,9),roof,0,3.68,-1.70);
      cylinder(group,'#d6edf0',1.06,1.12,.60,0,3.24,-1.70,9);
      box(group,'#ece4d8',1.1,.36,.3,0,2.25,-.12);
    }else{ // studio with asymmetric modern monitor roof
      box(group,wall,4.0,1.91,2.65,-.22,1.28,-1.70);
      box(group,roof,4.44,.25,2.93,-.25,2.44,-1.70);
      box(group,'#9ad1d9',1.50,1.19,.07,1.02,1.39,-.32);
      box(group,'#cad9e6',1.20,.42,.45,-1.3,2.67,-1.42);
    }
    // Every type has a visible doorway and a reachable front standing area.
    box(group,'#f5ebd7',.86,1.20,.08,-.12,.98,-.27);
    box(group,'#607982',.65,.98,.09,-.12,.88,-.20);
    sphere(group,'#f5d9a4',.065,.15,.91,-.135);
    box(group,role.accent,1.30,.14,.22,0,2.01,-.11);
    for(const side of [-1,1]){
      if(variant!==1&&variant!==2){
        box(group,'#fff3e5',.70,.72,.07,side*1.17,1.35,-.30);
        box(group,'#8fc1d0',.52,.56,.075,side*1.17,1.35,-.25);
      }
    }
    if(kind==='teacher'){
      box(group,'#f6e4e9',1.05,.46,.08,-2.0,.96,-.26);
      box(group,'#d697bd',.75,.11,.09,-2.0,.97,-.20);
    }else if(kind==='story'){
      for(let j=0;j<3;j++)box(group,['#f2cd88','#a8c0dc','#abd7c6'][j],
        .20,.58,.26,-1.94+j*.22,.64,-.24);
    }else if(kind==='fortune'){
      part(group,new T.OctahedronGeometry(.36),'#c4a9ea',1.94,.78,-.10);
    }else if(kind==='developer'){
      box(group,'#2d5576',.72,.51,.11,1.98,1.05,-.17);
      box(group,role.accent,.59,.37,.12,1.98,1.05,-.10);
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
    const roads=planRoadNetwork(roleDefs);
    buildTown(scene,districts,roads);
    districts.forEach((district,i)=>districtBuilding(scene,district.role,i));
    const actors=roleDefs.map((role,index)=>character(scene,role,index));
    actors.roadVisuals=roads;
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
          districtIndex,districtSize:spacing,
          townBranch:pos.branch,townDepth:pos.depth,townRotation:pos.rotation,
          townRoadX:pos.roadX,townRoadZ:pos.roadZ,
          townFrontX:pos.frontX,townFrontZ:pos.frontZ,
          islandX:pos.x,islandZ:pos.z,
          x:pos.x+Math.cos(pos.rotation)*offset+Math.sin(pos.rotation)*FRONT_Z,
          z:pos.z-Math.sin(pos.rotation)*offset+Math.cos(pos.rotation)*FRONT_Z});
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

  // Standalone demo uses the same plaza, streets and house orientation.
  roles.forEach((role,index)=>{
    const pos=districtPosition(index,roles.length);
    Object.assign(role,{districtId:role.id,
      townBranch:pos.branch,townDepth:pos.depth,townRotation:pos.rotation,
      townRoadX:pos.roadX,townRoadZ:pos.roadZ,
      townFrontX:pos.frontX,townFrontZ:pos.frontZ,
      islandX:pos.x,islandZ:pos.z,
      x:pos.x+Math.sin(pos.rotation)*FRONT_Z,
      z:pos.z+Math.cos(pos.rotation)*FRONT_Z});
  });
  function releaseMaterials(){cache.clear();}
  root.WorldLabKit={roles,create,createPlayer,createPaperPlane,disposePaperPlane,makeLiveRoles,mapExtent,planRoadNetwork,districtPosition,releaseMaterials,MAX_WORLD_ROLES,MEMBERS_PER_DISTRICT};
})(window);
