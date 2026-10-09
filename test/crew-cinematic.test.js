const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');
const cinematic = require('../public/js/crew-cinematic.js');

const snapshot = {
  verified:true, activeRoleId:'dev',
  roles:[
    {id:'dev',name:'Pocket Dev',project:'crew-pocket',
      status:{state:'working',busy:true}},
    {id:'teacher',name:'Teacher Dev',project:'crew-teacher',
      status:{state:'waiting',queuedRequestCount:1}},
    {id:'story',name:'Story Dev',project:'crew-story',status:{state:'idle'}}
  ]
};
const now=Date.now();
assert.equal(cinematic.toneFor(snapshot.roles[0]),'pocket');
assert.equal(cinematic.toneFor(snapshot.roles[1]),'teacher');
assert.equal(cinematic.toneFor(snapshot.roles[2]),'story');
assert.equal(cinematic.toneFor({name:'Fortune Dev'}),'fortune');
assert.equal(cinematic.toneFor({name:'Helper Dev'}),'helper');
assert.equal(cinematic.toneFor({name:'General'}),'general');
assert.equal(cinematic.toneFor({id:'new-identity'}),cinematic.toneFor({id:'new-identity'}));
assert.equal(cinematic.toneFor({id:'new-identity'}),cinematic.toneFor({id:'new-identity',name:'x'}));

const a={x:0,y:12},b={x:200,y:20};
assert.deepEqual(cinematic.bezier(a,b,0),a);
assert.deepEqual(cinematic.bezier(a,b,1),b);
assert.ok(cinematic.bezier(a,b,.5).y < 12,'handoff arcs over cards');
const event={id:'message-1',fromRoleId:'dev',toRoleId:'teacher',createdAt:now};
assert.equal(cinematic.validHandoff(event,snapshot,now),true);
assert.equal(cinematic.validHandoff(event,{...snapshot,verified:false},now),false);
assert.equal(cinematic.validHandoff({...event,id:''},snapshot,now),false);
assert.equal(cinematic.validHandoff({...event,createdAt:now-100000},snapshot,now),false);
assert.equal(cinematic.validHandoff({...event,createdAt:now+100000},snapshot,now),false);
assert.equal(cinematic.validHandoff({...event,toRoleId:'dev'},snapshot,now),false);
assert.equal(cinematic.validHandoff({...event,toRoleId:'unknown'},snapshot,now),false);
assert.equal(cinematic.validHandoff({...event,fromRoleId:'missing'},snapshot,now),false);

// Android-WebView-like harness verifies DOM lifecycle, not just source text.
function mockNode(attrs={}) {
  const listeners={};
  const flags=new Set();
  return {
    ...attrs, dataset:attrs.dataset||{}, style:{}, listeners, children:[],
    isConnected:true,
    classList:{
      add(x){flags.add(x);},
      remove(x){flags.delete(x);},
      contains(x){return flags.has(x);},
      toggle(x,enabled){if(enabled)flags.add(x);else flags.delete(x);}
    },
    addEventListener(type,fn){listeners[type]=fn;},
    getBoundingClientRect(){return attrs.rect||{left:0,top:0,width:48,height:48};},
    remove(){this.isConnected=false;},
    setAttribute(){},
    appendChild(child){this.children.push(child);}
  };
}
const dev=mockNode({dataset:{roleCardId:'dev'},rect:{left:28,top:160,width:160,height:162}});
const teacher=mockNode({dataset:{roleCardId:'teacher'},rect:{left:205,top:340,width:150,height:158}});
const roster=mockNode();
roster.querySelectorAll=sel=>sel==='[data-role-card-id]'?[dev,teacher]:[];
roster.contains=target=>[dev,teacher].includes(target);
const stateLabel=mockNode();
const header=mockNode({rect:{left:62,top:8,width:42,height:42}});
const elements={'role-nav-list':roster,'workspace-selector-btn':header,
  'crew-chat-role-state':stateLabel};
const docListeners={};
const overlays=[];
const winListeners={};
const rafCallbacks=new Map();
let seq=0,reduced=false,visible=true;
const doc={
  documentElement:{clientWidth:390,clientHeight:820},
  hidden:false,
  body:{
    dataset:{primaryTab:'crew'},
    classList:{toggle(x,on){this[x]=on;}},
    appendChild(node){overlays.push(node);}
  },
  getElementById:id=>elements[id]||null,
  addEventListener(type,fn){docListeners[type]=fn;},
  createElementNS:()=>mockNode()
};
const win={
  getCrewCockpitSnapshot:()=>snapshot,
  matchMedia:()=>({matches:reduced}),
  addEventListener(type,fn){winListeners[type]=fn;},
  requestAnimationFrame(fn){const id=++seq;rafCallbacks.set(id,fn);return id;},
  cancelAnimationFrame(id){rafCallbacks.delete(id);},
  setTimeout() {}
};
const app=cinematic.init(win,doc);
assert.ok(app);
assert.equal(dev.dataset.crewTone,'pocket');
assert.equal(teacher.dataset.crewTone,'teacher');
assert.equal(doc.body.dataset.crewTone,'pocket');
assert.equal(stateLabel.textContent,'工作中');
assert.equal(stateLabel.dataset.state,'working');
assert.equal(app.handoff(event),true);
assert.equal(app.handoff(event),false,'same saved handoff never replays');
assert.equal(overlays.length,1,'one short neural link, no global canvas');
assert.equal(teacher.classList.contains('crew-handoff-target'),true);
assert.equal(dev.classList.contains('crew-handoff-source'),true);
for(const ts of [0,500,950,1100]){
 const current=[...rafCallbacks.entries()];rafCallbacks.clear();
 for(const [,fn] of current)fn(ts);
}
assert.equal(overlays[0].isConnected,false,'overlay removed after choreography');
assert.equal(app.handoff({...event,id:'old',createdAt:now-100000}),false);
doc.hidden=true;
assert.equal(app.handoff({...event,id:'hidden'}),false);
doc.hidden=false;
reduced=true;
assert.equal(app.handoff({...event,id:'reduced'}),true);
assert.equal(overlays.length,1,'reduced-motion never creates new neon animation');
winListeners['crew:streaming-state']({detail:{
 streaming:true,roleId:'teacher'
}});
assert.equal(doc.body.classList['crew-role-streaming'],false,
 'stream from another Role cannot affect current Role header');
winListeners['crew:streaming-state']({detail:{
 streaming:true,roleId:'dev'
}});
assert.equal(doc.body.classList['crew-role-streaming'],true);
winListeners['crew:streaming-state']({detail:{
 streaming:false,roleId:'dev'
}});
assert.equal(doc.body.classList['crew-role-streaming'],false);
app.close();

const html=read('public/index.html');
const ui=read('public/js/ui.js');
const room=read('public/js/crew-room.js');
const css=read('public/css/crew-cinematic.css');
assert.ok(html.indexOf('/js/crew-cinematic.js')<html.indexOf('/js/ui.js'),
 'identity tone must be available when Role card markup is built');
assert.ok(html.includes('window.CrewCinematic?.init(window, document)'));
assert.ok(html.includes('id="crew-chat-role-state"'));
assert.ok(html.includes('href="/css/crew-cinematic.css"'));
assert.ok(ui.includes('data-crew-tone='));
assert.ok(ui.includes('crew-role-eyebrow'));
assert.ok(room.includes("new win.CustomEvent('crew:handoff-observed'"));
assert.ok(room.includes("win.getCrewCockpitSnapshot?.()?.verified === true"));
assert.match(css,/prefers-reduced-motion:reduce/);
assert.match(css,/data-selected="true"/);
assert.match(css,/--cp-text/);
assert.match(css,/data-crew-theme="light"/);
assert.match(css,/\.living-workbench/);
assert.doesNotMatch(css,/canvas|office-map|pathfinding/i);
console.log('crew-cinematic tests: ok');
