const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeSpec, parseSpec, buildDraft, widgetHtml, enhance } =
  require('../public/js/crew-interactive.js');

const repo = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'public/index.html'), 'utf8');
const visual = fs.readFileSync(path.join(repo, 'public/js/visual-answer.js'), 'utf8');
const chat = fs.readFileSync(path.join(repo, 'public/js/chat.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'public/css/crew-interactive.css'), 'utf8');
assert.ok(index.includes('/css/crew-interactive.css'));
assert.ok(index.indexOf('/js/crew-interactive.js') < index.indexOf('/js/visual-answer.js'));
assert.ok(index.indexOf('/js/crew-interactive.js') < index.indexOf('/js/chat.js'));
assert.match(visual, /CrewInteractive\?\.enhance/, 'original renderer must enhance completed replies');
assert.match(chat, /crewInteractiveContextMatches/, 'Role/conversation guard must be available');
assert.doesNotMatch(css, /position:\s*fixed|overflow-y:\s*auto/i, 'keep single chat scroll');

const choice = { version: 1, type: 'choice', title: '下一步', question: '要先處理哪項？',
  options: [{ label: '介面', value: '先修改 UI' }, { label: '測試', value: '先補測試' }] };
assert.deepEqual(normalizeSpec(choice), choice);
assert.equal(parseSpec(JSON.stringify(choice)).type, 'choice');
assert.equal(buildDraft(choice, [1]), '針對上一則回覆的「下一步」：\n要先處理哪項？\n我選擇：先補測試');
assert.equal(buildDraft(choice, []), '');
const list = { version: 1, type: 'checklist', title: '待辦', question: '',
  items: ['跑測試', '檢查 UI', '建立 PR'] };
assert.deepEqual(normalizeSpec(list), list);
assert.equal(buildDraft(list, [0, 2]), '針對上一則回覆的「待辦」：\n請協助處理以下項目：\n- 跑測試\n- 建立 PR');
const metrics = { version: 1, type: 'metrics', title: '測試摘要', question: '',
  items: [{ label: '通過', value: '22' }, { label: '失敗', value: '1' }] };
assert.deepEqual(normalizeSpec(metrics), metrics);
assert.match(widgetHtml(metrics), /22/);
assert.ok(!widgetHtml(metrics).includes('data-crew-draft-action'));

const dirty = { ...choice, title: '<img src=x onerror="alert(1)">' };
const markup = widgetHtml(normalizeSpec(dirty));
assert.ok(!markup.includes('<img'), 'model text is never used as HTML');
assert.match(markup, /&lt;img/);
assert.equal(normalizeSpec({ ...choice, version: 2 }), null);
assert.equal(normalizeSpec({ ...choice, type: 'script' }), null);
assert.equal(normalizeSpec({ ...choice, options: [{ label: 'only one' }] }), null);
assert.equal(normalizeSpec({ ...choice, options: [{ label: 'x', value: 'a'.repeat(400) }, { label: 'y' }] }), null);
assert.equal(parseSpec('{bad json'), null);
assert.equal(parseSpec('x'.repeat(5001)), null);
assert.equal(parseSpec(JSON.stringify({ ...list, items: Array(20).fill('too many') })), null);
assert.ok(!widgetHtml(choice).includes('<script'), 'no script is generated');
assert.ok(!widgetHtml(choice).includes('<iframe'), 'no independent renderer is generated');

// Minimal DOM verifies one in-place replacement and explicit draft-only interaction.
const emitted = [];
const input = {
  value: '', focus() { this.focused = true; },
  dispatchEvent(event) { emitted.push(event.type); }
};
let allowed = true;
global.window = { crewInteractiveContextMatches: () => allowed };
global.document = {
  getElementById(id) { return id === 'prompt-input' ? input : null; },
  createElement(tag) {
    assert.equal(tag, 'section');
    return {
      dataset: {}, attrs: {}, handlers: {},
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(kind, handler) { this.handlers[kind] = handler; },
      querySelectorAll(selector) {
        if (selector === 'input[data-crew-selection]:checked') return this.selected || [];
        return [];
      },
      querySelector(selector) {
        if (selector === '.crew-interactive-feedback') return this.feedback;
        return null;
      },
      feedback: { textContent: '' }
    };
  }
};
global.Event = class { constructor(type) { this.type = type; } };
const code = { textContent: JSON.stringify(choice) };
const pre = { dataset: {}, replaceWith(element) { this.replacement = element; } };
code.parentElement = pre;
const container = {
  querySelectorAll(selector) {
    return selector === 'pre > code.language-crew-ui' ? [code] : [];
  }
};
assert.equal(enhance(container, { roleId: 'role-one' }), 1);
const widget = pre.replacement;
assert.equal(widget.dataset.crewInteractive, 'choice');
assert.equal(enhance(container), 0, 'only one replacement for a completed block');
const click = () => widget.handlers.click({
  target: { closest: selector => selector === '[data-crew-draft-action="selection"]' ? {} : null }
});
click();
assert.match(widget.feedback.textContent, /請先選擇/);
widget.selected = [{ dataset: { crewSelection: '1' } }];
allowed = false;
click();
assert.equal(input.value, '', 'switched Role must not receive an old message draft');
allowed = true;
click();
assert.equal(input.value, buildDraft(choice, [1]));
assert.equal(input.focused, true);
assert.deepEqual(emitted, ['input']);
input.value = '我原本的草稿';
click();
assert.equal(input.value, '我原本的草稿', 'never overwrite an unsent draft');
assert.match(widget.feedback.textContent, /已有草稿/);
delete global.window;
delete global.document;
delete global.Event;

console.log('crew-interactive P0 tests passed');
