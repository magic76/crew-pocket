'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class Node {
  constructor(id,doc){this.id=id;this.doc=doc;this.parentNode=null;this.children=[];
    this.hidden=['crew-world-modal','crew-world-chat-panel','crew-world-focus-bar'].includes(id);
    this.events=new Map();this.textContent='';this.className='';this.value='';
    this.style={values:{},setProperty(k,v){this.values[k]=v;},removeProperty(k){delete this.values[k];}};
    this.classList={set:new Set(),add(...keys){for(const k of keys)this.set.add(k);},
      remove(...keys){for(const k of keys)this.set.delete(k);},
      contains(k){return this.set.has(k);},
      toggle(k){if(this.set.has(k)){this.set.delete(k);return false;}this.set.add(k);return true;}};
    this.dataset={};this.scrollHeight=220;this.scrollTop=0;
  }
  appendChild(node){node.parentNode?.removeChild(node);this.children.push(node);node.parentNode=this;return node;}
  removeChild(node){this.children.splice(this.children.indexOf(node),1);node.parentNode=null;}
  replaceChildren(...items){for(const node of this.children)node.parentNode=null;this.children=[];for(const node of items)this.appendChild(node);}
  querySelectorAll(){return [];}
  replaceWith(node){const p=this.parentNode;if(!p)throw Error('missing parent');
    const i=p.children.indexOf(this);node.parentNode?.removeChild(node);
    p.children[i]=node;node.parentNode=p;this.parentNode=null;}
  addEventListener(name,fn){const set=this.events.get(name)||[];set.push(fn);this.events.set(name,set);}
  trigger(name){for(const fn of this.events.get(name)||[])fn({key:'',preventDefault(){}});}
  setAttribute(k,v){this[k]=v;}
  focus(){this.doc.activeElement=this;}
  click(){if(!this.disabled)this.trigger('click');}
}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  const doc={activeElement:null,body:{dataset:{primaryTab:'crew'},classList:{
    set:new Set(),add(k){this.set.add(k);},remove(k){this.set.delete(k);}
  }},events:new Map()};
  const ids=['crew-world-open-btn','crew-home-dashboard-btn','crew-home-view-toggle','crew-home-header','crew-home-header-host','crew-world-modal',
    'crew-world-chat-panel','crew-world-chat-messages-slot','crew-world-chat-composer-slot',
    'messages-container','chat-composer-footer','crew-world-chat-hide','crew-world-chat-expand',
    'world-chat-open','crew-world-chat-role-name','crew-back-home-btn','world-stage',
    'crew-world-focus-bar','crew-world-focus-back','crew-world-focus-name',
    'crew-world-focus-full','crew-world-focus-context','context-pill','world-reset',
    'crew-world-command-role','crew-world-command-state','crew-world-command-read',
    'crew-world-result-peek','crew-world-result-peek-kind','crew-world-result-peek-text',
    'prompt-input'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id,doc)]));
  nodes['crew-home-header-host'].appendChild(nodes['crew-home-header']);
  nodes['crew-home-header'].appendChild(nodes['crew-home-view-toggle']);
  const base=new Node('base',doc),originalMessages=new Node('messages-parent',doc),
    originalComposer=new Node('composer-parent',doc);
  originalMessages.appendChild(nodes['messages-container']);
  originalComposer.appendChild(nodes['chat-composer-footer']);
  let mountCount=0,disposeCount=0,pauseCount=0,resumeCount=0,roleNavigations=[];
  let contextOpenCount=0,collaborationVisit=null;
  nodes['context-pill'].addEventListener('click',()=>contextOpenCount++);
  let width=810;
  const win={
    innerHeight:810,visualViewport:{offsetTop:0,height:810,addEventListener(){}},
    addEventListener(){},requestAnimationFrame(fn){fn();},
    mountCrewWorldScene(){mountCount++;const dispose=()=>disposeCount++;
      dispose.pause=()=>pauseCount++;dispose.resume=()=>resumeCount++;return dispose;},
    getCrewCockpitSnapshot(){return{roles:[{id:'pocket',name:'Pocket'},{id:'teacher',name:'Teacher'}]};},
    getCurrentRoleId(){return roleNavigations.at(-1);},
    async openCrewCockpitRole(id){
      roleNavigations.push(id);doc.body.dataset.primaryTab='chat';
      // Match the existing Role navigation's actual behavior: history restore
      // clears the native textarea before the commander restores its draft.
      nodes['prompt-input'].value='';
    },
    openCrewCollaboration(id,eventId){collaborationVisit={id,eventId};}
  };
  doc.getElementById=id=>nodes[id]||null;
  doc.createComment=text=>new Node('#comment',doc);
  doc.createElement=tag=>new Node(tag,doc);
  doc.addEventListener=()=>{};
  nodes['crew-back-home-btn'].addEventListener('click',()=>doc.body.dataset.primaryTab='crew');
  nodes['world-reset'].addEventListener('click',()=>win.CrewWorldHost.exitFocus());
  const file=fs.readFileSync(path.join(__dirname,'..','public/js/crew-world-launcher.js'),'utf8');
  vm.runInNewContext(file,{window:win,document:doc,console});
  nodes['crew-world-open-btn'].click();
  assert.equal(nodes['crew-world-modal'].hidden,false);
  assert.strictEqual(nodes['crew-home-header'].parentNode,nodes['crew-home-header-host']);
  assert.equal(nodes['crew-home-view-toggle'].dataset.view,'map');
  assert.equal(nodes['crew-world-open-btn']['aria-pressed'],'true');
  assert.equal(nodes['crew-home-dashboard-btn']['aria-pressed'],'false');
  await tick();await tick();
  assert.equal(mountCount,1);
  assert.equal(nodes['crew-world-command-role'].children.length,2,'all real Roles are targets');
  assert.equal(nodes['crew-world-command-role'].value,'pocket','active Role selected by default');
  assert.equal(nodes['crew-world-chat-panel'].hidden,false);
  assert.strictEqual(nodes['messages-container'].parentNode,nodes['crew-world-chat-messages-slot']);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  assert.deepEqual(roleNavigations,['pocket'],'the original Role selector is used');
  assert.equal(nodes['crew-world-chat-role-name'].textContent,'Pocket');
  assert.equal(nodes['crew-world-chat-composer-slot'].children.length,1,'no duplicated composer');
  nodes['crew-world-chat-hide'].click();
  assert.strictEqual(nodes['messages-container'].parentNode,nodes['crew-world-chat-messages-slot']);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot'],
    'collapsing floating chat leaves the global command dock usable');
  assert.equal(nodes['crew-world-modal'].hidden,false,'collapsing chat keeps world alive');
  // A single global unsent draft follows the target Role without a second input.
  nodes['prompt-input'].value='檢查這個 UI';
  nodes['crew-world-command-role'].value='teacher';
  nodes['crew-world-command-role'].trigger('change');
  await tick();await tick();
  assert.equal(nodes['prompt-input'].value,'檢查這個 UI',
    'Role navigation must preserve the original unsent command text');
  assert.deepEqual(roleNavigations,['pocket','teacher']);
  assert.equal(nodes['crew-world-command-role'].value,'teacher');
  win.CrewWorldHost.focusRole('teacher','Teacher');
  assert.equal(nodes['crew-world-modal'].classList.contains('is-role-focused'),true);
  assert.equal(nodes['crew-world-focus-bar'].hidden,false);
  assert.equal(nodes['crew-world-focus-name'].textContent,'Teacher');
  assert.equal(doc.body.classList.set.has('crew-world-focused'),true,
    'immersive focus hides the ordinary Chat and Crew headers');
  assert.equal(nodes['crew-world-focus-context'].disabled,false,
    'Context is enabled only for the active mounted Role');
  nodes['crew-world-focus-context'].click();
  assert.equal(contextOpenCount,1,'focus Context opens the ORIGINAL Context Health control');
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),true);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  nodes['crew-world-chat-expand'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),false,
    'expand reveals the existing chat messages without duplicating the composer');
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('expanded'),false,
    'first expand opens half-height reading mode');
  nodes['crew-world-chat-expand'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('expanded'),true,
    'second expand enters full-screen chat');
  nodes['crew-world-chat-hide'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),true,
    'collapse returns to compact composer instead of closing the map');
  nodes['crew-world-focus-back'].click();
  assert.equal(nodes['crew-world-modal'].classList.contains('is-role-focused'),false);
  assert.equal(nodes['crew-world-focus-bar'].hidden,true);
  assert.equal(doc.body.classList.set.has('crew-world-focused'),false,
    'overview restores ordinary headers');
  assert.equal(nodes['crew-world-focus-context'].disabled,true,
    'no stale Role context shortcut after focus closes');
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot'],
    'returning to overview keeps the persistent single composer docked');
  assert.equal(nodes['crew-world-modal'].hidden,false,'returning to overview keeps map open');
  nodes['crew-home-dashboard-btn'].click();
  assert.equal(nodes['crew-world-open-btn']['aria-pressed'],'false');
  assert.equal(nodes['crew-home-dashboard-btn']['aria-pressed'],'true');
  assert.equal(pauseCount,1,'switching to Dashboard pauses the existing world');
  assert.strictEqual(nodes['crew-home-header'].parentNode,nodes['crew-home-header-host']);
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  assert.equal(doc.body.dataset.primaryTab,'crew','return to original home tab');
  nodes['crew-world-open-btn'].click();
  await tick();await tick();
  assert.equal(mountCount,1,'reopening resumes the existing scene');
  assert.equal(resumeCount,1,'reopening resumes the paused world');
  nodes['crew-home-dashboard-btn'].click();
  assert.equal(pauseCount,2,'Dashboard switch pauses the scene again');
  assert.equal(disposeCount,0,'Dashboard switches preserve the scene for reuse');

  nodes['crew-world-open-btn'].click();
  await tick();await tick();
  win.CrewWorldHost.onSelectedRole('pocket','Pocket');
  win.CrewWorldHost.focusRole('pocket','Pocket');
  assert.equal(nodes['crew-world-focus-context'].disabled,true,
    'newly focused Role cannot show the previous Role context while loading');
  await tick();await tick();
  assert.equal(nodes['crew-world-focus-context'].disabled,false,
    'Context shortcut activates after the target Role conversation loads');
  nodes['crew-world-focus-context'].click();
  assert.equal(contextOpenCount,2);
  nodes['crew-world-focus-full'].click();
  assert.equal(nodes['crew-world-modal'].hidden,true,
    'full conversation exits the map instead of duplicating Chat');
  assert.equal(doc.body.classList.set.has('crew-world-focused'),false,
    'full Chat restores its standard header');
  assert.equal(nodes['crew-world-focus-context'].disabled,true);
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  assert.equal(doc.body.dataset.primaryTab,'chat');

  nodes['crew-world-open-btn'].click();
  await tick();await tick();
  win.CrewWorldHost.focusRole('pocket','Pocket');
  await tick();await tick();
  win.CrewWorldHost.expandFocusedChat();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),false,
    'activity ribbon expands the same original Chat DOM');
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  win.CrewWorldHost.openCollaboration('teacher','m2');
  assert.equal(nodes['crew-world-modal'].hidden,true,'jumping to evidence closes World');
  assert.equal(doc.body.classList.set.has('crew-world-focused'),false);
  assert.deepEqual(collaborationVisit,{id:'teacher',eventId:'m2'},
    'a saved event selects recipient-scoped original collaboration without sending anything');
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  console.log('Crew World portal: verified activity expansion, original message evidence, one Chat DOM passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
