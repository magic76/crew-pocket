const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../public/js/cockpit-model.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/crew-home.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public/js/cockpit.js'), 'utf8');

assert.ok(html.includes('id="crew-attention-panel"'));
assert.ok(html.includes('id="cockpit-status-line"'));
assert.ok(html.includes('id="cockpit-refresh-btn"'));
assert.ok(html.includes('data-primary-tab="crew"'));
assert.ok(html.indexOf('id="role-nav-list"') > html.indexOf('id="crew-attention-panel"'));
assert.ok(!html.includes('id="cockpit-switch"'), 'no redundant Focus/Command choice');
assert.ok(!html.includes('id="cockpit-command-panel"'));
assert.ok(!html.includes('id="cockpit-focus-panel"'));
assert.ok(css.includes('body[data-primary-tab="crew"] #messages-container'));
assert.ok(css.includes('#drawer.crew-home-view'));
assert.match(css, /prefers-reduced-motion: reduce/);

const roles = [
 {id:'helper',name:'Helper <script>alert(1)</script>',project:'Helper',icon:'🧠',
  status:{state:'working',queuedRequestCount:1,queuedMessageCount:1,unreadReplyCount:1,
   lastActivityAt:20,currentWork:{title:'Fix login <bad>'}}},
 {id:'story',name:'Story Dev',project:'Story',icon:'📚',
  status:{state:'waiting',queuedMessageCount:1,unreadReplyCount:0,currentWork:{title:'Cover'}}},
 {id:'teacher',name:'Teacher Dev',project:'Teacher',icon:'🎓',
  status:{state:'idle',queuedMessageCount:0,unreadReplyCount:0}}
];
const snapshot={verified:true,updatedAt:Date.now(),activeRoleId:'helper',roles};
const computed=model.project(snapshot);
assert.equal(computed.totals.working,1);
assert.equal(computed.totals.waiting,1);
assert.equal(computed.totals.attention,4);
assert.equal(computed.attention.length,2);
assert.equal(model.project({...snapshot,verified:false}).totals,null);

const callbacks=new Map();
const makeNode=()=>({
 innerHTML:'',textContent:'',dataset:{},listeners:{},
 addEventListener(type,fn){this.listeners[type]=fn;},
 querySelectorAll(){return [];},contains(){return true;}
});
const elements={
 'crew-attention-panel':makeNode(),
 'cockpit-status-line':makeNode(),
 'cockpit-refresh-btn':makeNode()
};
const document={activeElement:{dataset:{}},getElementById:id=>elements[id]||null,
 addEventListener(type,cb){callbacks.set('doc:'+type,cb);}};
let current={...snapshot,verified:false};
let opened=null,refreshed=0;
const window={
 CrewCockpitModel:model,
 getCrewCockpitSnapshot:()=>current,
 getCrewLocale:()=> 'zh-TW',
 openCrewCockpitRole:id=>{opened=id;},
 loadCrewStatus:async()=>{refreshed++;},
 addEventListener(type,cb){callbacks.set(type,cb);}
};
vm.runInNewContext(controller,{window,document}, {filename:'cockpit.js'});
assert.equal(elements['crew-attention-panel'].innerHTML,'','unknown Runtime must not invent attention');
assert.match(elements['cockpit-status-line'].textContent,/尚未同步/);
current=snapshot;
callbacks.get('crew:status-updated')();
const output=elements['crew-attention-panel'].innerHTML;
assert.match(output,/待你處理/);
assert.match(output,/Helper &lt;script&gt;alert/);
assert.doesNotMatch(output,/<script>/);
assert.equal((output.match(/class="crew-attention-row"/g)||[]).length,2);
assert.ok(!output.includes('teacher'), 'idle roles are not repeated');
elements['crew-attention-panel'].listeners.click({target:{
 closest:()=>({dataset:{crewAttentionRole:'story'}})
}});
assert.equal(opened,'story');
elements['cockpit-refresh-btn'].listeners.click();
assert.equal(refreshed,1);
current={...snapshot,roles:[roles[2]]};
callbacks.get('crew:status-updated')();
assert.equal(elements['crew-attention-panel'].innerHTML,'','empty list occupies no vertical space');
console.log('crew-cockpit tests: ok');
