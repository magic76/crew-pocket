const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { presentationKind, buildInteractiveReplyGuide } =
  require('../lib/interactive-reply-guide');
const { maskStreaming, parseSpec } = require('../public/js/crew-interactive');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'public/js/chat.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/crew-interactive.css'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/interactive-replies.md'), 'utf8');

assert.match(server, /buildInteractiveReplyGuide\(prompt,\s*\{/);
assert.match(server, /executionMode:\s*executionPolicy\?\.mode/);
assert.match(server, /background:\s*Boolean\(body\.is_btw/);
assert.match(server, /finalPrompt = '<ADDITIONAL_METADATA>/);
assert.match(chat, /!turnFinalized && !isBtwQuery\) window\.CrewInteractive\?\.maskStreaming\(contentElem\)/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.match(css, /crew-interactive-placeholder/);
assert.doesNotMatch(css, /position:\s*fixed|overflow-y:\s*auto/i);
assert.match(docs, /P3/);

const cases = [
  ['比較這兩個方案的優缺點', 'scenario'],
  ['Can you compare these options?', 'scenario'],
  ['請把歷年的數據畫成折線圖', 'chart'],
  ['Plot this trend as a chart', 'chart'],
  ['每月費用幫我試算一下', 'calculator'],
  ['用參數和滑桿看不同成本', 'calculator'],
  ['幫我做一份可勾選的待辦清單', null], // action request intentionally excluded
  ['給我可勾選的待辦清單', 'checklist'],
  ['checklist of QA steps', 'checklist'],
  ['我今天心情還不錯', null],
  ['繼續', null],
  ['merge', null],
  ['合併後比較一下', null],
  ['幫我實作方案比較 UI', null],
  ['比較方案後直接幫我修改程式碼', null],
  ['請提供完整 tsx 程式碼和比較分析', null],
  ['對比選項並建立 PR', null],
  ['請畫圖表並部署網站', null],
  ['分析圖片裡面的比較數據', 'scenario']
];
for (const [prompt, expected] of cases) {
  assert.equal(presentationKind(prompt), expected, prompt);
  const guide = buildInteractiveReplyGuide(prompt);
  assert.equal(Boolean(guide), Boolean(expected), 'guide should be optional: ' + prompt);
  if (expected) {
    assert.match(guide, /JSON/);
    assert.match(guide, /not.*invent/i);
    assert.match(guide, /one card/i);
    assert.ok(guide.length < 1300, 'token overhead must stay bounded');
  }
}
const options = [
  { executionMode: 'BUILD' },
  { executionMode: 'SURGICAL_EDIT' },
  { executionMode: 'DEBUG' },
  { imagePath: '/tmp/image.png' },
  { background: true }
];
for (const option of options) {
  assert.equal(presentationKind('比較方案 A 和 B', option), null);
  assert.equal(buildInteractiveReplyGuide('比較方案 A 和 B', option), '');
}
assert.equal(presentationKind('比較方案 A 和 B', { executionMode: 'INSPECT' }), 'scenario');
assert.equal(presentationKind('比較方案 A 和 B', { executionMode: 'CHAT' }), 'scenario');
assert.equal(presentationKind('比較方案 A 和 B', { executionMode: '' }), 'scenario');
assert.equal(presentationKind('比較'.repeat(1600)), null, 'no hint for oversized user input');

const created = [];
const originalDocument = global.document;
global.document = {
  createElement(tag) {
    created.push(tag);
    return {
      className: '', attrs: {}, textContent: '',
      setAttribute(key, value) { this.attrs[key] = value; }
    };
  }
};
const valid = { version: 1, type: 'choice', title: '選擇', options: [
  { label: 'A', value: 'A' }, { label: 'B', value: 'B' }
] };
const code = { textContent: JSON.stringify(valid) };
const pre = {
  replaced: false,
  replaceWith(newNode) { this.replaced = true; this.replacement = newNode; }
};
code.parentElement = pre;
const partial = { textContent: '{"version":1,"type":"chart"' };
const partialPre = {
  replaceWith(newNode) { this.replacement = newNode; }
};
partial.parentElement = partialPre;
const container = {
  querySelectorAll(selector) {
    return selector === 'pre > code.language-crew-ui' ? [code, partial] : [];
  }
};
assert.equal(maskStreaming(container), 2);
assert.equal(pre.replaced, true);
assert.equal(pre.replacement.attrs.role, 'status');
assert.equal(pre.replacement.textContent, '正在準備互動卡片…');
assert.equal(partialPre.replacement.className, 'crew-interactive-placeholder');
assert.equal(created.filter(tag => tag === 'div').length, 2);
assert.equal(parseSpec(code.textContent).type, 'choice',
  'streaming mask does not modify stored Markdown or final hydration');
assert.equal(parseSpec(partial.textContent), null,
  'incomplete blocks must stay invalid until completed');
assert.equal(maskStreaming(null), 0);
global.document = originalDocument;

console.log('interactive-reply P3 guidance and streaming tests passed');
