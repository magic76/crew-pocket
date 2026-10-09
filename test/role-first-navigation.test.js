const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const html = read('public/index.html');
const app = read('public/js/app.js');
const chat = read('public/js/chat.js');
const ui = read('public/js/ui.js');
const css = read('public/css/crew-home.css');
const premium = read('public/css/style-premium.css');
const android = read('android-wrapper/app/src/main/java/com/crewpocket/app/MainActivity.kt');

assert.ok(!html.includes('id="primary-bottom-nav"'), 'persistent footer nav is removed');
assert.ok(!html.includes('class="primary-tab'), 'no invisible primary-tab controls remain');
for (const id of ['crew-open-settings-btn','crew-settings-back-btn','crew-back-home-btn',
  'crew-main-layout','chat-composer-footer','tools-menu-dropdown']) {
  assert.ok(html.includes('id="' + id + '"'), id + ' must remain reachable');
}
assert.ok(html.includes('<body data-primary-tab="crew"'));
assert.ok(html.includes('id="tools-menu-dropdown" class="crew-settings-view'));
assert.ok(html.indexOf('id="tools-menu-dropdown"') < html.indexOf('id="crew-main-layout"'),
  'settings must occupy the body flex region independently');
assert.ok(css.includes('body[data-primary-tab="settings"] #tools-menu-dropdown.crew-settings-view'));
assert.ok(css.includes('body[data-primary-tab="settings"] #crew-main-layout'));
assert.ok(css.includes('body[data-primary-tab="settings"] #chat-composer-footer'));
assert.ok(css.includes('padding-bottom: max(24px, env(safe-area-inset-bottom'));
assert.ok(premium.includes('--crew-primary-nav-height: 0px'));
assert.ok(!premium.includes('.primary-tab'), 'remove dead tab styles');
assert.ok(app.includes('await loadConversationHistory(target.id, { preserveCrewHome: true })'),
  'app restores conversation data without navigating out of Crew Home');
assert.ok(chat.includes('if (!preserveCrewHome) toggleDrawer(false)'),
  'normal Role selection still enters chat');
assert.ok(ui.includes("window.CrewNavigation?.openOverlay('role-detail')"));
assert.ok(ui.includes("window.addEventListener('crew:navigation-popstate'"));
assert.ok(android.includes('if (webView.canGoBack()) webView.goBack()'),
  'Android Back should use the same in-WebView history without updating APK');

// Execute the real page router within a small WebView-like navigation harness.
const start = app.indexOf('  // Role-first navigation.');
const end = app.indexOf('  // 📦 Browser Extension Export listeners', start);
assert.ok(start >= 0 && end > start, 'must locate real router implementation');
const makeElement = () => {
  const items = new Set();
  return { dataset: {}, listeners: {}, classList: {
    toggle(value,on) { if (on) items.add(value); else items.delete(value); },
    contains(value) {return items.has(value);}
  }, addEventListener(name,fn) {this.listeners[name] = fn;} };
};
const elements = Object.fromEntries([
 'chat-composer-footer','crew-back-home-btn','crew-open-settings-btn','crew-settings-back-btn'
].map(id=>[id,makeElement()]));
const drawer = makeElement();
const document = {
  body: {dataset:{}},
  documentElement: {style:{setProperty(){}}},
  getElementById(id){return elements[id]||null;},
  querySelector(selector){ return selector==='header'
    ? {getBoundingClientRect:()=>({height:58})} : null; }
};
const callbacks = {};
const states=[{}]; let index=0;
const history = {
  get state(){return states[index];},
  pushState(value){states.splice(++index);states.push(value);},
  replaceState(value){states[index]=value;},
  back(){if(index>0){ index--; callbacks.popstate?.({state:states[index]}); }}
};
let settingsVisible=false;let crewRenders=0;
const window = {
  history, setTimeout:()=>0,
  addEventListener(name,fn){callbacks[name]=fn;},
  dispatchEvent(){},
  renderRoleNavigation(){crewRenders++;}
};
const customEvent = class {constructor(type,init){this.type=type;this.detail=init?.detail;}};
vm.runInNewContext(app.slice(start,end),{
 window, document, drawer, Date, CustomEvent:customEvent,
 setSettingsViewOpen(open){settingsVisible=open;},
 loadWorkspaces:async()=>[], loadCrewStatus:async()=>[], loadConversations:async()=>[]
},{filename:'app-role-first-router.js'});
assert.equal(document.body.dataset.primaryTab,'crew');
assert.equal(history.state.crewPage,'crew');
assert.equal(drawer.classList.contains('hidden'),false);
assert.equal(elements['chat-composer-footer'].classList.contains('hidden'),true);
assert.equal(settingsVisible,false);
elements['crew-open-settings-btn'].listeners.click();
assert.equal(document.body.dataset.primaryTab,'settings');
assert.equal(settingsVisible,true);
assert.equal(history.state.crewPage,'settings');
elements['crew-settings-back-btn'].listeners.click();
assert.equal(document.body.dataset.primaryTab,'crew');
assert.equal(settingsVisible,false);

window.setPrimaryTab('chat');
assert.equal(document.body.dataset.primaryTab,'chat');
assert.equal(elements['chat-composer-footer'].classList.contains('hidden'),false);
window.CrewNavigation.openOverlay('role-detail');
assert.equal(history.state.crewOverlay,'role-detail');
const count=states.length;
window.CrewNavigation.openOverlay('role-memory-modal');
assert.equal(states.length,count,'opening Memory from Role menu replaces its history entry');
assert.equal(history.state.crewOverlay,'role-memory-modal');
window.CrewNavigation.back();
assert.equal(document.body.dataset.primaryTab,'chat');
assert.equal(history.state.crewOverlay,null);
elements['crew-back-home-btn'].listeners.click();
assert.equal(document.body.dataset.primaryTab,'crew');
assert.equal(elements['chat-composer-footer'].classList.contains('hidden'),true);

window.CrewNavigation.openOverlay('role-editor-modal');
const count2=states.length;
window.CrewNavigation.openOverlay('role-delete-modal');
assert.equal(states.length,count2+1,'nested confirmation has its own Back level');
window.CrewNavigation.back();
assert.equal(history.state.crewOverlay,'role-editor-modal');
window.CrewNavigation.back();
assert.equal(document.body.dataset.primaryTab,'crew');

console.log('role-first-navigation tests: ok');
