const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(tag = 'div', className = '', value = '') {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.value = value;
    this.children = [];
    this.dataset = {};
    this.parentNode = null;
    this.handlers = {};
    this.classList = {
      add: (...items) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...items])].join(' '); },
      contains: name => this.className.split(' ').includes(name)
    };
  }
  get textContent() { return this.value || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.value = String(value); }
  get childNodes() { return this.children; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.children.indexOf(ref);
    assert.notEqual(index, -1, 'insertBefore reference should exist');
    child.parentNode = this;
    this.children.splice(index, 0, child);
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const term = part.trim();
      return term.startsWith('.') ? this.classList.contains(term.slice(1)) : this.tagName === term.toUpperCase();
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = parent => {
      for (const node of parent.children) {
        if (node.matches(selector)) matches.push(node);
        visit(node);
      }
    };
    visit(this);
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  dispatch(name) { for (const handler of this.handlers[name] || []) handler(); }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/visual-answer.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'public/css/visual-answer.css'), 'utf8');
const created = [];
const window = {};
vm.runInNewContext(source, {
  window,
  document: {
    createElement(tag) {
      created.push(tag);
      return new FakeElement(tag);
    }
  }
});

const longText = 'This is a detailed, source-based explanation of the behavior. '.repeat(9);
const markdown = `# Findings\n\nIntroduction.\n\n## 摘要\n\n${longText}\n\n## 比較\n\n${longText}\n\n## 結論\n\nFinal recommendation.`;
function fixture({ execution = false, lazy = false } = {}) {
  const root = new FakeElement('div');
  const article = root.appendChild(new FakeElement('div', 'assistant-article'));
  let host = article;
  let card = null;
  if (execution) {
    card = article.appendChild(new FakeElement('details', 'execution-result-card'));
    if (!lazy) host = card.appendChild(new FakeElement('section', 'execution-result-response'));
  }
  if (!lazy) {
    const body = host.appendChild(new FakeElement('div', 'msg-content'));
    body.appendChild(new FakeElement('h1', '', 'Findings'));
    body.appendChild(new FakeElement('p', '', 'Introduction.'));
    body.appendChild(new FakeElement('h2', '', '摘要'));
    body.appendChild(new FakeElement('p', '', longText));
    const table = body.appendChild(new FakeElement('table'));
    table.appendChild(new FakeElement('tr', '', 'Row A'));
    body.appendChild(new FakeElement('h2', '', '比較'));
    body.appendChild(new FakeElement('p', '', longText));
    body.appendChild(new FakeElement('h2', '', '結論'));
    body.appendChild(new FakeElement('p', '', 'Final recommendation.'));
  }
  return { root, article, card, host };
}

// Short chat messages remain untouched, and no extra reader is appended.
const short = fixture();
window.attachVisualAnswerAction(short.root, 'hello');
assert.equal(short.root.querySelector('.visual-answer-panel'), null);

assert.equal(window.visualAnswerEligible(markdown), true);
assert.equal(window.visualAnswerSectionKind('摘要'), 'summary');
assert.equal(window.visualAnswerSectionKind('比較'), 'comparison');
assert.equal(window.visualAnswerSectionKind('結論'), 'conclusion');
assert.equal(window.visualAnswerSectionKind('Risks'), 'risks');
assert.equal(window.visualAnswerSectionKind('Random notes'), 'detail');

const regular = fixture();
const body = regular.root.querySelector('.msg-content');
const before = body.textContent;
const firstTable = body.querySelector('table');
window.attachVisualAnswerAction(regular.root, markdown);
assert.ok(body.classList.contains('visual-answer-content'));
assert.equal(body.querySelectorAll('.visual-answer-panel').length, 3, 'report groups all H2 sections in place');
assert.equal(body.querySelectorAll('table').length, 1, 'table is moved rather than copied');
assert.equal(body.querySelector('table'), firstTable);
assert.equal(body.textContent, before, 'the original rendered answer remains semantically identical');
assert.equal(body.querySelector('.visual-answer-table').querySelector('table'), firstTable);
assert.equal(body.querySelectorAll('iframe, button').length, 0, 'do not add duplicate readers or controls');
window.attachVisualAnswerAction(regular.root, markdown);
assert.equal(body.querySelectorAll('.visual-answer-panel').length, 3, 'rehydration is idempotent');

// Structured execution reports decorate the existing response in the task card.
const execution = fixture({ execution: true });
window.attachVisualAnswerAction(execution.root, markdown);
assert.equal(execution.article.children.length, 1);
assert.equal(execution.root.querySelector('.execution-result-response').querySelectorAll('.visual-answer-panel').length, 3);

// Historical task cards are not hydrated until they are opened.
const history = fixture({ execution: true, lazy: true });
window.attachVisualAnswerAction(history.root, markdown);
assert.equal(history.card.querySelector('.msg-content'), null);
const response = history.card.appendChild(new FakeElement('section', 'execution-result-response'));
response.appendChild(new FakeElement('div', 'msg-content'))
  .appendChild(new FakeElement('p', '', longText));
history.card.open = true;
history.card.dispatch('toggle');
assert.ok(response.querySelector('.msg-content').classList.contains('visual-answer-content'));
history.card.dispatch('toggle');
assert.equal(response.querySelectorAll('.visual-answer-panel').length, 0);

const failed = fixture();
window.attachVisualAnswerAction(failed.root, markdown, { failed: true });
assert.equal(failed.root.querySelector('.visual-answer-panel'), null);
assert.ok(!created.includes('iframe'), 'native rendering must not create an iframe');
assert.match(style, /overflow-y: visible/, 'only tables may scroll horizontally');
assert.doesNotMatch(style, /height:\s*min\(62dvh/, 'fixed-height nested scrolling must stay removed');
console.log('visual-answer-inline regression tests passed');
