'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class Node {
  constructor(id,doc){this.id=id;this.doc=doc;this.parentNode=null;this.children=[];
    this.hidden=['crew-world-modal','crew-world-chat-panel'].includes(id);
    this.events=new Map();this.textContent='';this.className='';
    this.style={values:{},setProperty(k,v){this.values[k]=v;},removeProperty(k){delete this.values[k];}};
    this.classList={set:new Set(),add(k){this.set.add(k);},remove(k){this.set.delete(k);},
      toggle(k){if(this.set.has(k)){this.set.delete(k);return false;}this.set.add(k);return true;}};
    this.dataset={};this.scrollHeight=220;this.scrollTop=0;
  }
  appendChild(node){node.parentNode?.removeChild(node);this.children.push(node);node.parentNode=this;return node;}
  removeChild(node){this.children.splice(this.children.indexOf(node),1);node.parentNode=null;}
  replaceWith(node){const p=this.parentNode;if(!p)throw Error('missing parent');
    const i=p.children.indexOf(this);node.parentNode?.removeChild(node);
    p.children[i]=node;node.parentNode=p;this.parentNode=null;}
  addEventListener(name,fn){const set=this.events.get(name)||[];set.push(fn);this.events.set(name,set);}
  trigger(name){for(const fn of this.events.get(name)||[])fn({key:'',preventDefault(){}});}
  setAttribute(k,v){this[k]=v;}
  focus(){this.doc.activeElement=this;}
  click(){this.trigger('click');}
}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  const doc={activeElement:null,body:{dataset:{primaryTab:'crew'},classList:{
    set:new Set(),add(k){this.set.add(k);},remove(k){this.set.delete(k);}
  }},events:new Map()};
  const ids=['crew-world-open-btn','crew-home-dashboard-btn','crew-world-dashboard-btn','crew-world-map-btn','crew-world-modal',
    'crew-world-chat-panel','crew-world-chat-messages-slot','crew-world-chat-composer-slot',
    'messages-container','chat-composer-footer','crew-world-chat-hide','crew-world-chat-expand',
    'world-chat-open','crew-world-chat-role-name','crew-back-home-btn','world-stage'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id,doc)]));
  const base=new Node('base',doc),originalMessages=new Node('messages-parent',doc),
    originalComposer=new Node('composer-parent',doc);
  originalMessages.appendChild(nodes['messages-container']);
  originalComposer.appendChild(nodes['chat-composer-footer']);
  let mountCount=0,disposeCount=0,roleNavigations=[];
  let width=810;
  const win={
    innerHeight:810,visualViewport:{offsetTop:0,height:810,addEventListener(){}},
    addEventListener(){},requestAnimationFrame(fn){fn();},
    mountCrewWorldScene(){mountCount++;return()=>disposeCount++;},
    getCrewCockpitSnapshot(){return{roles:[{id:'pocket',name:'Pocket'},{id:'teacher',name:'Teacher'}]};},
    getCurrentRoleId(){return roleNavigations.at(-1);},
    async openCrewCockpitRole(id){roleNavigations.push(id);doc.body.dataset.primaryTab='chat';}
  };
  doc.getElementById=id=>nodes[id]||null;
  doc.createComment=text=>new Node('#comment',doc);
  doc.addEventListener=()=>{};
  nodes['crew-back-home-btn'].addEventListener('click',()=>doc.body.dataset.primaryTab='crew');
  const file=fs.readFileSync(path.join(__dirname,'..','public/js/crew-world-launcher.js'),'utf8');
  vm.runInNewContext(file,{window:win,document:doc,console});
  nodes['crew-world-open-btn'].click();
  assert.equal(nodes['crew-world-modal'].hidden,false);
  assert.equal(nodes['crew-world-open-btn']['aria-pressed'],'true');
  assert.equal(nodes['crew-home-dashboard-btn']['aria-pressed'],'false');
  assert.equal(nodes['crew-world-map-btn']['aria-pressed'],'true');
  await tick();
  assert.equal(mountCount,1);
  win.CrewWorldHost.onSelectedRole('pocket','Pocket');
  nodes['world-chat-open'].click();
  await tick();await tick();
  assert.equal(nodes['crew-world-chat-panel'].hidden,false);
  assert.strictEqual(nodes['messages-container'].parentNode,nodes['crew-world-chat-messages-slot']);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  assert.deepEqual(roleNavigations,['pocket'],'the original Role selector is used');
  assert.equal(nodes['crew-world-chat-role-name'].textContent,'Pocket');
  assert.equal(nodes['crew-world-chat-composer-slot'].children.length,1,'no duplicated composer');
  nodes['crew-world-chat-hide'].click();
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  assert.equal(nodes['crew-world-modal'].hidden,false,'collapsing chat keeps world alive');
  win.CrewWorldHost.onSelectedRole('teacher','Teacher');
  nodes['world-chat-open'].click();
  await tick();await tick();
  assert.deepEqual(roleNavigations,['pocket','teacher']);
  nodes['crew-world-dashboard-btn'].click();
  assert.equal(nodes['crew-world-open-btn']['aria-pressed'],'false');
  assert.equal(nodes['crew-home-dashboard-btn']['aria-pressed'],'true');
  assert.equal(disposeCount,1,'closing world must dispose one WebGL instance');
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  assert.equal(doc.body.dataset.primaryTab,'crew','return to original home tab');
  nodes['crew-world-open-btn'].click();
  await tick();
  nodes['crew-world-dashboard-btn'].click();
  assert.equal(disposeCount,2,'reopening and closing must not leak scene');
  console.log('Crew World portal: one Chat DOM, Role navigation, collapse and GPU cleanup passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
