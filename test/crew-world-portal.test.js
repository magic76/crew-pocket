'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class Node {
  constructor(id,doc){this.id=id;this.doc=doc;this.parentNode=null;this.children=[];
    this.hidden=['crew-world-modal','crew-world-chat-panel',
      'crew-world-role-spinner','crew-world-command-retry'].includes(id);
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
  trigger(name,payload={}){for(const fn of this.events.get(name)||[])fn({
    key:'',preventDefault(){},...payload
  });}
  setAttribute(k,v){this[k]=v;}
  focus(){this.doc.activeElement=this;}
  click(){if(!this.disabled)this.trigger('click');}
}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  const doc={activeElement:null,body:{dataset:{primaryTab:'crew'},classList:{
    set:new Set(),add(k){this.set.add(k);},remove(k){this.set.delete(k);}
  }},events:new Map()};
  const ids=['crew-world-open-btn','crew-home-dashboard-btn','crew-open-settings-btn','crew-home-view-toggle','crew-home-header','crew-home-header-host','crew-world-modal',
    'crew-world-chat-panel','crew-world-chat-messages-slot','crew-world-chat-composer-slot',
    'messages-container','chat-composer-footer','crew-world-chat-hide','crew-world-chat-expand',
    'world-chat-open','crew-world-chat-role-name','crew-back-home-btn','world-stage',
    'context-pill','world-reset',
    'crew-world-command-role','crew-world-command-state','crew-world-command-read',
    'crew-world-command-context',
    'crew-world-role-spinner','crew-world-command-retry','send-btn',
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
  let historyRestores=0;
  let contextOpenCount=0,collaborationVisit=null;
  let blockedNavigation=null,failNavigationId=null,clockIndex=0;
  const scheduled=new Map();
  const advanceSwitchTimers=()=>{
    const due=[...scheduled.entries()].filter(([,task])=>task.ms===200);
    for(const [id,task] of due){scheduled.delete(id);task.fn();}
  };
  nodes['context-pill'].addEventListener('click',()=>contextOpenCount++);
  let width=810;
  const win={
    history:{
      state:{crewPage:'crew'},
      replaceState(state){this.state=state;historyRestores++;}
    },
    syncPrimaryTabChrome(tab){doc.body.dataset.primaryTab=tab;},
    innerHeight:810,visualViewport:{offsetTop:0,height:810,addEventListener(){}},
    addEventListener(){},requestAnimationFrame(fn){fn();},
    setTimeout(fn,ms){const id=++clockIndex;scheduled.set(id,{fn,ms});return id;},
    clearTimeout(id){scheduled.delete(id);},
    mountCrewWorldScene(){mountCount++;const dispose=()=>disposeCount++;
      dispose.pause=()=>pauseCount++;dispose.resume=()=>resumeCount++;return dispose;},
    getCrewCockpitSnapshot(){return{roles:[{id:'pocket',name:'Pocket'},{id:'teacher',name:'Teacher'}]};},
    getCurrentRoleId(){return roleNavigations.at(-1);},
    async openCrewCockpitRole(id){
      if(blockedNavigation&&blockedNavigation.roleId===id)await blockedNavigation.promise;
      if(failNavigationId===id)throw Error('Role navigation failed');
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
  let overviewClicks=0;
  nodes['world-reset'].addEventListener('click',()=>overviewClicks++);
  const file=fs.readFileSync(path.join(__dirname,'..','public/js/crew-world-launcher.js'),'utf8');
  vm.runInNewContext(file,{window:win,document:doc,console});
  // The production router now opens World immediately on cold launch,
  // before provider history finishes restoring its active Conversation.
  win.CrewWorldHost.deferInitialRole();
  win.CrewWorldHost.restoreHomeView();
  assert.equal(nodes['crew-world-modal'].hidden,false);
  assert.strictEqual(nodes['crew-home-header'].parentNode,nodes['crew-home-header-host']);
  assert.equal(nodes['crew-home-view-toggle'].dataset.view,'map');
  assert.equal(nodes['crew-world-open-btn']['aria-pressed'],'true');
  assert.equal(nodes['crew-home-dashboard-btn']['aria-pressed'],'false');
  await tick();await tick();
  assert.equal(mountCount,1);
  assert.deepEqual(roleNavigations,[],'initial World must not navigate a Role before history restore');
  win.CrewWorldHost.onBootstrapReady();
  await tick();await tick();
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

  // No secondary focused mode: Context stays on the commander; the same
  // original floating chat exposes its existing full-screen expand control.
  assert.equal(nodes['crew-world-command-context'].disabled,false);
  nodes['crew-world-command-context'].click();
  assert.equal(contextOpenCount,1,'Context delegates to ORIGINAL Context Health');
  assert.strictEqual(nodes['crew-home-view-toggle'].parentNode,nodes['crew-home-header']);
  assert.equal(nodes['crew-world-modal'].classList.contains('is-role-focused'),false);
  assert.equal(doc.body.classList.set.has('crew-world-active'),true,
    'selecting or reading a Role never leaves the active World');
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),true);
  assert.equal(nodes['crew-world-command-read'].textContent,'對話',
    'the command bar starts with one clear conversation entry');
  nodes['crew-world-command-read'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),false,
    'conversation command opens the original floating Chat DOM');
  assert.equal(nodes['crew-world-command-read'].textContent,'收合',
    'the same command becomes a collapse action');
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('expanded'),false);
  nodes['crew-world-chat-expand'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('expanded'),true,
    'existing floating Chat expand control provides full reading without a duplicate dock button');
  assert.equal(nodes['crew-world-modal'].hidden,false);
  nodes['crew-world-chat-hide'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),true,
    'collapse returns to one persistent composer');
  assert.equal(nodes['crew-world-command-read'].textContent,'對話',
    'the entry resets once the floating reader closes');
  nodes['world-reset'].click();
  assert.equal(overviewClicks,1,'overview camera control stays available');
  assert.equal(nodes['crew-world-modal'].hidden,false,'returning to full town does not change Role');
  assert.equal(nodes['crew-world-command-context'].disabled,false);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  // Return through the SAME visible nav used by Dashboard (not a second
  // World-specific exit button).
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

  assert.strictEqual(nodes['crew-home-view-toggle'].parentNode,nodes['crew-home-header'],
    'map always preserves shared Dashboard / Map navigation');
  assert.equal(resumeCount,1,'reopening resumes the paused world');
  nodes['crew-home-dashboard-btn'].click();
  assert.equal(pauseCount,2,'Dashboard switch pauses the scene again');
  assert.equal(disposeCount,0,'Dashboard switches preserve the scene for reuse');

  nodes['crew-world-open-btn'].click();
  await tick();await tick();

  win.CrewWorldHost.onSelectedRole('pocket','Pocket');
  assert.equal(nodes['crew-world-command-context'].disabled,true,
    'Context stays disabled during navigation to a different Role');
  await tick();await tick();
  assert.equal(nodes['crew-world-command-context'].disabled,false,
    'Context re-enables only after the selected Role is actually mounted');
  nodes['crew-world-command-context'].click();
  assert.equal(contextOpenCount,2);
  win.CrewWorldHost.openFullChat('pocket');
  assert.equal(nodes['crew-world-modal'].hidden,true,
    'explicit go-to-Chat still opens the original full Chat page');
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  assert.equal(doc.body.dataset.primaryTab,'chat');

  nodes['crew-world-open-btn'].click();
  await tick();await tick();

  nodes['crew-world-command-read'].click();
  assert.equal(nodes['crew-world-chat-panel'].classList.contains('compact'),false,
    'open reply stays in same original Chat DOM');
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot']);
  win.CrewWorldHost.openCollaboration('teacher','m2');
  assert.equal(nodes['crew-world-modal'].hidden,true,'jumping to evidence closes World');
  assert.equal(doc.body.classList.set.has('crew-world-active'),false);
  assert.deepEqual(collaborationVisit,{id:'teacher',eventId:'m2'},
    'a saved event selects recipient-scoped original collaboration without sending anything');
  assert.strictEqual(nodes['messages-container'].parentNode,originalMessages);
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  nodes['crew-world-open-btn'].click();
  await tick();await tick();
  assert.equal(nodes['crew-world-modal'].hidden,false,'reopened for switch safety test');
  // Rapid Role switches must not create spinner flicker or dim the composer.
  assert.equal(nodes['crew-world-role-spinner'].hidden,true);
  assert.equal(nodes['send-btn'].disabled,false);
  assert.equal(scheduled.size,0,'quick initial navigation cancels delayed spinner');
  // A slow switch still permits editing the draft and selecting another
  // character; only sending and stale conversation-reading are guarded.
  let resolveSlow;
  blockedNavigation={roleId:'teacher',promise:new Promise(resolve=>{resolveSlow=resolve;})};
  nodes['prompt-input'].value='原本草稿';
  nodes['crew-world-command-role'].value='teacher';
  nodes['crew-world-command-role'].trigger('change');
  await tick();
  assert.equal(nodes['crew-world-role-spinner'].hidden,true,
    'no spinner is painted before the 200ms threshold');
  assert.equal(nodes['send-btn'].disabled,true,
    'native send click is blocked until intended Role is confirmed');
  assert.equal(nodes['crew-world-command-context'].disabled,true);
  assert.equal(nodes['crew-world-command-read'].disabled,true);
  assert.equal(nodes['crew-world-command-role'].disabled,false,
    'Role picker stays interactive while a history request is pending');
  nodes['prompt-input'].value='載入時繼續編輯';
  nodes['prompt-input'].trigger('input');
  let prevented=false,interrupted=false;
  nodes['prompt-input'].trigger('keydown',{
    key:'Enter',ctrlKey:true,preventDefault(){prevented=true;},
    stopImmediatePropagation(){interrupted=true;}
  });
  assert.equal(prevented,true,'Ctrl+Enter cannot send to the previous Role');
  assert.equal(interrupted,true,'stop the existing app keydown send handler');
  advanceSwitchTimers();
  assert.equal(nodes['crew-world-role-spinner'].hidden,false,
    'slow navigation shows only inline Role spinner');
  assert.equal(nodes['crew-world-command-state'].textContent,'切換中…');
  resolveSlow();blockedNavigation=null;
  await tick();await tick();
  assert.equal(nodes['crew-world-role-spinner'].hidden,true);
  assert.equal(nodes['send-btn'].disabled,false);
  assert.equal(nodes['prompt-input'].value,'載入時繼續編輯',
    'even edits typed during a slow history load survive');
  assert.equal(nodes['crew-world-command-context'].disabled,false);

  // Failed navigation exposes retry; it never enables send for the stale Role.
  failNavigationId='pocket';
  nodes['crew-world-command-role'].value='pocket';
  nodes['crew-world-command-role'].trigger('change');
  await tick();await tick();
  assert.equal(nodes['crew-world-command-retry'].hidden,false);
  assert.equal(nodes['crew-world-command-state'].textContent,'角色未就緒');
  assert.equal(nodes['send-btn'].disabled,true);
  failNavigationId=null;
  nodes['crew-world-command-retry'].click();
  await tick();await tick();
  assert.equal(nodes['crew-world-command-retry'].hidden,true);
  assert.equal(nodes['send-btn'].disabled,false);
  assert.equal(nodes['crew-world-command-context'].disabled,false);
  assert.equal(nodes['crew-world-role-spinner'].hidden,true);
  nodes['crew-home-dashboard-btn'].click();
  assert.equal(nodes['send-btn'].disabled,false,
    'switch safety lock is released when leaving World');
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,originalComposer);
  // An explicit Dashboard choice remains secondary until the user selects
  // World again. Leaving World for Chat/Settings must not discard map-first
  // preference on subsequent returns to Crew.
  doc.body.dataset.primaryTab='crew';
  win.CrewWorldHost.restoreHomeView();
  assert.equal(nodes['crew-world-modal'].hidden,true,
    'returning from another page must respect an explicit Dashboard choice');
  nodes['crew-world-open-btn'].click();
  await tick();await tick();
  const previousRestores=historyRestores;
  nodes['crew-open-settings-btn'].click();
  assert.equal(nodes['crew-world-modal'].hidden,true);
  assert.equal(doc.body.dataset.primaryTab,'crew',
    'Settings opens from the Crew route, not the hidden Role Chat page');
  assert.ok(historyRestores>previousRestores,
    'closing World restores Crew history synchronously before Settings can push');
  assert.equal(win.history.state.crewPage,'crew');
  win.CrewWorldHost.restoreHomeView();
  assert.equal(nodes['crew-world-modal'].hidden,false,
    'returning to Crew restores map when it was the most recent home surface');
  await tick();await tick();
  assert.strictEqual(nodes['chat-composer-footer'].parentNode,nodes['crew-world-chat-composer-slot'],
    'the original Chat is restored after async map resume');
  assert.equal(disposeCount,0,'view changes should pause/resume the existing 3D scene, not rebuild it');
  console.log('Non-blocking Role switch: fast/slow, draft safety, keyboard guard, failure retry OK');
  console.log('Crew World modeless portal: original Context, full reading, navigation and one Chat DOM passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
