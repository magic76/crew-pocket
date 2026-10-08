const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareVisualDraft, renderVisualAnswer } = require('../lib/visual-answer');

(async function testVisualAnswer() {
  assert.throws(() => prepareVisualDraft(''), /沒有可以/);
  assert.throws(() => prepareVisualDraft('a'.repeat(48001)), /過長/);

  const normal = prepareVisualDraft('This is a long explanation with no headings.');
  assert.match(normal, /^---\ntitle: 視覺化閱讀/m);
  assert.match(normal, /## 回覆內容/);
  assert.match(normal, /This is a long explanation/);

  const withHeadings = prepareVisualDraft('## 一\n解釋\n\n## 二\n結論');
  assert.doesNotMatch(withHeadings, /## 回覆內容/);
  assert.match(withHeadings, /## 二/);

  const fence = String.fromCharCode(96).repeat(3);
  const untrusted = prepareVisualDraft([
    '## 圖片',
    '![secret](/data/data/private.png)',
    '![sensitive][local]',
    '[local]: /home/user/private.jpg',
    '<img src="/home/user/private.jpg">',
    fence + 'html',
    '<img src="/home/user/private.jpg">',
    fence
  ].join('\n'));
  assert.doesNotMatch(untrusted, /!\[secret\]/);
  assert.doesNotMatch(untrusted, /!\[sensitive\]/);
  assert.doesNotMatch(untrusted, /<img\b/i);
  assert.match(untrusted, new RegExp(fence + 'text'));
  assert.match(untrusted, /圖片：secret/);

  const result = await renderVisualAnswer('## 方案 A\n重點一。\n\n## 方案 B\n重點二。');
  assert.match(result.html, /class="am-doc/);
  assert.match(result.html, /Content-Security-Policy/);
  assert.match(result.html, /default-src 'none'/);
  assert.doesNotMatch(result.html, /<div class="am-toolbar">/);
  const cached = await renderVisualAnswer('## 方案 A\n重點一。\n\n## 方案 B\n重點二。');
  assert.equal(cached.cached, true);

  const root = path.resolve(__dirname, '..');
  const chat = fs.readFileSync(path.join(root, 'public/js/chat.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const visualUi = fs.readFileSync(path.join(root, 'public/js/visual-answer.js'), 'utf8');
  assert.match(chat, /attachVisualAnswerAction\(msgDiv, content\)/);
  assert.match(chat, /attachVisualAnswerAction\(assistantMsgDiv, accumulatedText\)/);
  assert.ok(index.indexOf('src="/js/visual-answer.js"') < index.indexOf('src="/js/chat.js"'));
  assert.match(visualUi, /sandbox=""/);
  assert.match(visualUi, /visualAnswerEligible/);
  console.log('visual answer regression tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
