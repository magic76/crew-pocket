'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/role-dna.js'), 'utf8');
const ids = ['role-dna-modal', 'role-dna-list', 'role-dna-summary', 'role-dna-title', 'role-dna-refresh'];
const nodes = Object.fromEntries(ids.map(id => [id, {
  innerHTML: '', textContent: '', listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; }
}]));
let payload;
const sandbox = {
  window: {},
  document: { getElementById: id => nodes[id] || null },
  AbortController,
  console,
  fetch: async () => ({ ok: true, json: async () => ({ success: true, skills: [payload] }) })
};
vm.runInNewContext(source, sandbox);

const example = {
  id: 'skill-abc', roleId: 'developer', title: 'Safe <script>alert(1)</script>',
  problem: 'CI failure triage', triggers: ['CI'], steps: ['Check tests'],
  checks: ['npm test'], sourceConversationIds: ['conv-source'],
  evidence: [], usage: [], verification: null, status: 'candidate'
};
const render = async partial => {
  payload = { ...example, ...partial };
  sandbox.window.RoleDNA.open({ id: 'developer', name: 'Developer' });
  await new Promise(resolve => setImmediate(resolve));
  return nodes['role-dna-list'].innerHTML;
};
(async () => {
  let html = await render({});
  assert.match(html, /等待適合任務/);
  assert.match(html, /尚無匹配的 Provider 回合紀錄/);
  assert.doesNotMatch(html, /<script>/, 'untrusted skill title is escaped');

  const use = { turnId: 'request-usage-12345678', conversationId: 'conv-1',
    providerId: 'codex', delivery: 'injected', at: 1780000000000, check: null, categories: [] };
  html = await render({ usage: [use] });
  assert.match(html, /已送入 Context · 1 次/);
  assert.match(html, /最近使用紀錄 · 1 回合/);
  assert.match(html, /conv-1/);
  assert.match(html, /尚無可辨識檢查/);
  assert.match(html, /不代表 AI 照步驟執行/);

  html = await render({ usage: [{ ...use, check: 'passed', categories: ['test'] }],
    evidence: [{ kind: 'runtime-check', outcome: 'passed', reference: 'turn:request-usage-12345678' }] });
  assert.match(html, /驗證中 · 1\/2/);
  assert.match(html, /同回合檢查通過/);
  assert.match(html, /測試/);

  html = await render({ evidence: [{ kind: 'runtime-check', outcome: 'failed', reference: 'x' }],
    usage: [{ ...use, check: 'failed', categories: ['test'] }] });
  assert.match(html, /需重新驗證/);

  html = await render({ status: 'active', verification: { method: 'runtime-observed', successfulTurns: 2 } });
  assert.match(html, /已自動啟用 · 兩回合檢查通過/);
  assert.match(nodes['role-dna-summary'].textContent, /已啟用/);
  console.log('role-skill-ui: idle, injected, check 1/2, failed, active, safe escaping passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
