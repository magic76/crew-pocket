const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const rawFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { LocalMemoryProvider, MAX_MEMORY_REVISIONS } = require('../lib/memory/local-memory-provider');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-memory-xray-'));
  try {
    const storagePath = path.join(dir, 'records.json');
    await fs.writeFile(storagePath, JSON.stringify({
      version: 1,
      records: [{ id: 'legacy', scope: 'ROLE', roleId: 'role-a', text: 'Legacy A',
        createdAt: 100, updatedAt: 110 }]
    }) + '\n');
    const store = new LocalMemoryProvider({ storagePath });
    let role = await store.inspectRole('role-a');
    assert.equal(role.records.length, 1);
    assert.equal(role.revisions.length, 0,
      'legacy memories must not invent historical versions');

    await store.retain({ id: 'm1', scope: 'ROLE', roleId: 'role-a',
      text: 'First decision', status: 'active',
      provenance: { derivation: 'USER_EXPLICIT', sources: [{ type: 'message', id: 'msg-a' }] } });
    let state = await store.readState();
    assert.equal(state.revisions.length, 1);
    assert.equal(state.revisions[0].action, 'created');
    assert.equal(state.revisions[0].record.text, 'First decision');
    assert.equal(state.revisions[0].record.provenance.derivation, 'USER_EXPLICIT');
    assert.equal(state.revisions[0].roleId, 'role-a');

    // "Retain" can refresh updatedAt without creating a false semantic revision.
    await store.retain({ id: 'm1', scope: 'ROLE', roleId: 'role-a',
      text: 'First decision', status: 'active',
      provenance: { derivation: 'USER_EXPLICIT', sources: [{ type: 'message', id: 'msg-a' }] } });
    assert.equal((await store.inspectRole('role-a')).revisions.length, 1);

    await store.retain({ id: 'm1', scope: 'ROLE', roleId: 'role-a',
      text: 'Revised decision', confidence: .8 });
    role = await store.inspectRole('role-a');
    assert.equal(role.revisions.length, 2);
    assert.equal(role.revisions[0].action, 'updated');
    assert.equal(role.revisions[0].record.text, 'Revised decision');
    assert.equal(role.revisions[1].record.text, 'First decision');
    assert.equal(role.records.find(x => x.id === 'm1').text, 'Revised decision');

    await store.retain({ id: 'm2', scope: 'ROLE', roleId: 'role-a',
      text: 'A replacement decision', supersedes: ['m1'],
      provenance: { derivation: 'TOOL_OBSERVED', sources: [{ type: 'git', id: 'sha-1' }] } });
    role = await store.inspectRole('role-a');
    assert.equal(role.records.find(x => x.id === 'm1').status, 'superseded');
    assert.equal(role.revisions[0].action, 'superseded');
    assert.equal(role.revisions[0].recordId, 'm1');
    assert.equal(role.revisions[0].causedBy, 'm2');
    assert.equal(role.revisions[1].recordId, 'm2');
    assert.equal(role.revisions[1].action, 'created');

    await store.retain({ id: 'other', scope: 'ROLE', roleId: 'role-b', text: 'Sensitive Role B context' });
    const isolated = await store.inspectRole('role-a');
    assert.equal(isolated.records.some(x => x.id === 'other'), false);
    assert.equal(isolated.revisions.some(x => x.recordId === 'other'), false);
    assert.equal(JSON.stringify(isolated).includes('Sensitive Role B context'), false);

    await store.forget('m1');
    const deleted = await store.inspectRole('role-a');
    assert.equal(deleted.records.some(x => x.id === 'm1'), false);
    assert.equal(deleted.revisions.some(x => x.recordId === 'm1'), false,
      'forget must erase snapshots, not just current state');

    const preserved = await store.inspectRole('role-b');
    assert.equal(preserved.records.length, 1);
    await store.forgetRole('role-a');
    const forgottenRole = await store.inspectRole('role-a');
    assert.equal(forgottenRole.records.length, 0);
    assert.equal(forgottenRole.revisions.length, 0);
    assert.equal((await store.inspectRole('role-b')).records.length, 1);

    const persisted = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    assert.equal(persisted.version, 2);
    assert.ok(Array.isArray(persisted.revisions));
    assert.equal(persisted.revisions.some(x => x.roleId === 'role-a'), false);
    await assert.rejects(() => store.inspectRole('../etc'), /Invalid role id/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-memory-bounds-'));
  try {
    const p = new LocalMemoryProvider({ storagePath: path.join(dir2, 'bounded.json') });
    await assert.rejects(() => p.inspectRole('wrong/id'), /Invalid role id/);
    const record = { id:'bounded', scope:'ROLE', roleId:'role-bound', text:'A' };
    const revisions = Array.from({ length: MAX_MEMORY_REVISIONS + 3 }, (_, n) => ({
      id: 'revision-' + n, roleId:'role-bound', recordId:'bounded',
      action:'updated', at: n + 1, record
    }));
    await p.writeState({ records: [record], revisions });
    const state = await p.readState();
    assert.equal(state.revisions.length, MAX_MEMORY_REVISIONS);
    assert.equal(state.revisions[0].id, 'revision-3');
    assert.equal(state.historyTruncated, true);
    const audit = await p.inspectRole('role-bound', { limit: 2 });
    assert.equal(audit.revisions.length, 2);
    assert.equal(audit.revisions[0].id, 'revision-' + (MAX_MEMORY_REVISIONS + 2));
    assert.equal(audit.historyTruncated, true);
  } finally {
    await fs.rm(dir2, { recursive: true, force: true });
  }

  const root = path.join(__dirname, '..');
  const html = rawFs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const ui = rawFs.readFileSync(path.join(root, 'public/js/ui.js'), 'utf8');
  const script = rawFs.readFileSync(path.join(root, 'public/js/memory-xray.js'), 'utf8');
  const css = rawFs.readFileSync(path.join(root, 'public/css/memory-xray.css'), 'utf8');
  const server = rawFs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const id of ['memory-xray-note','memory-xray-filter','memory-xray-search',
    'memory-xray-refresh','role-memory-list']) assert.ok(html.includes('id="' + id + '"'));
  assert.match(html, /data-memory-xray-tab="timeline"/);
  assert.match(html, /src="\/js\/memory-xray\.js"/);
  assert.match(html, /href="\/css\/memory-xray\.css"/);
  assert.ok(html.indexOf('/js/ui.js') < html.indexOf('/js/memory-xray.js'));
  assert.ok(ui.includes('window.RoleMemoryXRay?.open({ id: role.id, name: role.name })'));
  assert.ok(server.includes("pathname === '/api/role-memory-inspect'"));
  assert.ok(server.includes('defaultMemoryProvider.inspectRole(role.id'));
  assert.ok(server.includes('const role = await getRole(roleId)'));
  assert.ok(server.indexOf("if (pathname.startsWith('/api/'))") <
    server.indexOf("pathname === '/api/role-memory-inspect'"), 'API must be authenticated');
  assert.match(css, /data-status="superseded"/);
  assert.match(script, /encodeURIComponent\(roleId\)/);
  assert.match(script, /pending\?\.abort\(\)/);
  assert.ok(!script.includes('setInterval('));

  // Render the UI without browser APIs to verify safe escaping, filtering and recorded diffs.
  const nodes = new Map();
  function node(id) {
    const n = {
      id, value: '', innerHTML: '', textContent: '', listeners: {},
      dataset: {}, classList: { contains: () => false, toggle() {} },
      addEventListener(kind, cb) { this.listeners[kind] = cb; },
      querySelector: () => null,
      setAttribute() {}
    };
    nodes.set(id, n);
    return n;
  }
  const modal = node('role-memory-modal');
  const list = node('role-memory-list');
  const note = node('memory-xray-note');
  const search = node('memory-xray-search');
  const filter = node('memory-xray-filter');
  const refresh = node('memory-xray-refresh');
  node('close-role-memory-btn');
  const tabs = ['overview','timeline'].map(mode => ({
    dataset: { memoryXrayTab:mode },
    classList: { toggle() {} },
    listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; },
    setAttribute() {}
  }));
  const dom = {
    getElementById: id => nodes.get(id) || null,
    querySelectorAll: () => tabs,
    addEventListener() {}
  };
  const source = {
    id:'ui-id', text:'<script>bad()</script>', kind:'experience',
    status:'active', roleId:'role-a', createdAt:1000, updatedAt:3000,
    source:'manual', confidence:0.7,
    provenance: { derivation:'USER_EXPLICIT', sources:[{
      type:'message', id:'<img src=x onerror=alert(1)>'
    }] }
  };
  const original = { ...source, text:'Previous content', updatedAt:1000 };
  const data = {
    success:true, roleId:'role-a', records:[source],
    revisions:[
      { id:'revised', recordId:'ui-id', roleId:'role-a',
        action:'updated',at:3000,record:source },
      { id:'initial', recordId:'ui-id', roleId:'role-a',
        action:'created',at:1000,record:original }
    ]
  };
  let requests = 0;
  const fetch = async (_url, options) => {
    requests++;
    assert.equal(options.cache, 'no-store');
    return { ok:true, json:async()=>data };
  };
  const window = { getCrewLocale:()=> 'zh-TW' };
  vm.runInNewContext(script, { document:dom, window, fetch, AbortController, Date,
    encodeURIComponent }, { filename:'memory-xray.js' });
  assert.ok(window.RoleMemoryXRay);
  window.RoleMemoryXRay.open({ id:'role-a', name:'Role A' });
  await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(requests, 1);
  assert.match(list.innerHTML, /&lt;script&gt;bad/);
  assert.match(list.innerHTML, /&lt;img src=x onerror/);
  assert.doesNotMatch(list.innerHTML, /<script>/);
  tabs[1].listeners.click();
  assert.match(list.innerHTML, /Previous content/);
  assert.match(list.innerHTML, /&lt;script&gt;bad/);
  assert.match(list.innerHTML, /此版本/);
  search.value = 'not-found';
  search.listeners.input();
  assert.match(list.innerHTML, /尚無此條件的版本事件/);
  window.RoleMemoryXRay.close();
  console.log('memory-xray tests: ok');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
