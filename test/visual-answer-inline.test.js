const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.hidden = false;
    this.isConnected = true;
    this.children = [];
    this.attrs = {};
    this.handlers = {};
    this.textContent = '';
    this.disabled = false;
  }

  set innerHTML(html) {
    this.html = html;
    this.children = [];
    const child = (tag, cls) => {
      const el = new FakeElement(tag);
      el.className = cls;
      this.appendChild(el);
      return el;
    };
    if (html.includes('visual-answer-inline-toolbar')) {
      child('button', 'visual-answer-inline-copy');
      child('button', 'visual-answer-inline-fullscreen');
      child('div', 'visual-answer-inline-status');
      child('iframe', '');
    } else if (html.includes('visual-answer-toolbar')) {
      child('button', 'visual-answer-back');
      child('button', 'visual-answer-copy');
      child('iframe', '');
    }
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  querySelector(selector) {
    const match = node => selector === 'iframe'
      ? node.tagName === 'IFRAME'
      : selector[0] === '.' && node.className.split(' ').includes(selector.slice(1));
    for (const node of this.children) {
      if (match(node)) return node;
      const nested = node.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] || null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, cb) { (this.handlers[name] ||= []).push(cb); }
  click() {
    for (const fn of this.handlers.click || []) fn({ currentTarget: this });
  }
  focus() {}
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

(async function run() {
  const document = { body: new FakeElement('body'), createElement: tag => new FakeElement(tag) };
  const window = { getCurrentRoleId: () => 'roleA', addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/visual-answer.js'), 'utf8');
  const clipboard = [];
  let renders = 0;

  vm.runInNewContext(source, {
    window, document, navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
    fetch: async (_url, options) => {
      renders++;
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).content.length > 200, true);
      return { ok: true, json: async () => ({ success: true, html: '<html><body>Rendered</body></html>' }) };
    },
    AbortController, setTimeout, clearTimeout, console
  });

  const markdownA = '## Architecture\n\n' + 'Describe the architecture and relationships. '.repeat(21);
  const markdownB = '## Plan\n\n' + 'Explain the workstreams and timeline. '.repeat(22);
  const article = () => {
    const message = new FakeElement();
    const content = new FakeElement();
    content.className = 'assistant-article';
    message.appendChild(content);
    return { message, content };
  };
  const optionsA = { roleId: 'roleA', provider: 'codex', conversationId: 'conv1' };
  const optionsB = { roleId: 'roleB', provider: 'codex', conversationId: 'conv1' };

  const short = article();
  window.attachVisualAnswerAction(short.message, 'hello', optionsA);
  assert.equal(short.content.children.length, 0, 'short answers should stay plain');

  const a = article();
  window.attachVisualAnswerAction(a.message, markdownA, optionsA);
  const launchA = a.content.querySelector('.visual-answer-launch');
  const panelA = a.content.querySelector('.visual-answer-inline');
  assert.ok(launchA && panelA);
  assert.equal(panelA.hidden, true, 'readers start collapsed');
  assert.equal(launchA.getAttribute('aria-expanded'), 'false');

  launchA.click();
  await tick();
  assert.equal(panelA.hidden, false, 'click expands inline');
  assert.equal(launchA.getAttribute('aria-expanded'), 'true');
  assert.equal(panelA.querySelector('iframe').srcdoc.includes('Rendered'), true);
  assert.equal(renders, 1);
  const fullscreen = panelA.querySelector('.visual-answer-inline-fullscreen');
  assert.equal(fullscreen.disabled, false, 'fullscreen enabled on successful render');
  fullscreen.click();
  const modal = document.body.children[0];
  assert.equal(modal.hidden, false, 'fullscreen remains optional');
  modal.querySelector('.visual-answer-back').click();
  assert.equal(modal.hidden, true, 'fullscreen returns without closing inline');
  assert.equal(panelA.hidden, false);

  launchA.click();
  assert.equal(panelA.hidden, false, 'collapse animates before hiding the panel');
  assert.equal(panelA.getAttribute('data-expanded'), 'false', 'collapse begins a CSS height transition');
  launchA.click();
  await tick();
  assert.equal(renders, 1, 'second expand uses cached HTML');
  assert.equal(panelA.getAttribute('data-expanded'), 'true', 'rapid reopen cancels the collapse');
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.equal(panelA.hidden, false, 'stale collapse timeout must not hide a reopened panel');

  const a2 = article();
  window.attachVisualAnswerAction(a2.message, markdownB, optionsA);
  a2.content.querySelector('.visual-answer-launch').click();
  await tick();
  assert.equal(panelA.getAttribute('data-expanded'), 'false', 'previous reader collapses when another opens');
  assert.equal(a2.content.querySelector('.visual-answer-inline').hidden, false);
  assert.equal(renders, 2);

  const b = article();
  window.attachVisualAnswerAction(b.message, markdownA, optionsB);
  b.content.querySelector('.visual-answer-launch').click();
  await tick();
  assert.equal(renders, 3, 'Role B has a separate cache/scope');
  a2.content.querySelector('.visual-answer-inline').isConnected = false;
  b.content.querySelector('.visual-answer-inline').isConnected = false;

  const restoredA = article();
  window.attachVisualAnswerAction(restoredA.message, markdownB, optionsA);
  await tick();
  assert.equal(restoredA.content.querySelector('.visual-answer-inline').hidden, false,
    'Role A restores its own expanded response');
  assert.equal(renders, 3, 'restoring does not rerender AI content');

  const restoredB = article();
  window.attachVisualAnswerAction(restoredB.message, markdownA, optionsB);
  await tick();
  assert.equal(restoredB.content.querySelector('.visual-answer-inline').hidden, false,
    'Role B restores its own expanded response');
  assert.equal(renders, 3);
  restoredB.content.querySelector('.visual-answer-inline-copy').click();
  await tick();
  assert.equal(clipboard[0], markdownA, 'original Markdown is copied, not HTML');

  // Execution cards should show one reply surface with a text/visual switch
  // inside the expanded details, not another viewer below the whole card.
  const execution = article();
  const executionCard = new FakeElement('details');
  executionCard.className = 'execution-result-card';
  const response = new FakeElement('section');
  response.className = 'execution-result-response';
  const responseHeading = new FakeElement('div');
  responseHeading.className = 'execution-result-section-title';
  const original = new FakeElement('div');
  original.className = 'msg-content';
  response.appendChild(responseHeading);
  response.appendChild(original);
  executionCard.appendChild(response);
  execution.content.appendChild(executionCard);
  window.attachVisualAnswerAction(execution.message, markdownB, {
    roleId: 'roleA', provider: 'codex', conversationId: 'execution1'
  });
  assert.equal(execution.content.children.length, 1, 'no duplicate reader appended after result card');
  const modeSwitch = responseHeading.querySelector('.visual-answer-launch');
  assert.ok(modeSwitch, 'reading mode switch lives in the execution response heading');
  assert.equal(response.querySelector('.visual-answer-inline').hidden, true);
  modeSwitch.click();
  await tick();
  assert.equal(response.getAttribute('data-reading-mode'), 'visual');
  assert.equal(response.querySelector('.visual-answer-inline').getAttribute('data-expanded'), 'true');
  modeSwitch.click();
  assert.equal(response.querySelector('.visual-answer-inline').getAttribute('data-expanded'), 'false');
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.equal(response.getAttribute('data-reading-mode'), 'text', 'original response restores after collapse');

  // Lazy history cards hydrate the execution response only when first opened.
  const lazy = article();
  const lazyCard = new FakeElement('details');
  lazyCard.className = 'execution-result-card';
  lazy.content.appendChild(lazyCard);
  window.attachVisualAnswerAction(lazy.message, markdownA, {
    roleId: 'roleA', provider: 'codex', conversationId: 'execution-lazy'
  });
  assert.equal(lazy.content.querySelector('.visual-answer-launch'), null);
  const lazyResponse = new FakeElement('section');
  lazyResponse.className = 'execution-result-response';
  const lazyHeading = new FakeElement('div');
  lazyHeading.className = 'execution-result-section-title';
  lazyResponse.appendChild(lazyHeading);
  lazyCard.appendChild(lazyResponse);
  lazyCard.open = true;
  for (const handler of lazyCard.handlers.toggle || []) handler();
  assert.ok(lazyHeading.querySelector('.visual-answer-launch'),
    'visual mode mounts after lazy execution details are hydrated');

  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/visual-answer.css'), 'utf8');
  assert.match(css, /\.visual-answer-inline\[hidden\]/);
  assert.match(source, /sandbox=""/);
  assert.match(css, /grid-template-rows: 0fr/);
  assert.match(css, /grid-template-rows: 1fr/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /data-reading-mode="visual"/);
  console.log('visual-answer-inline regression tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
