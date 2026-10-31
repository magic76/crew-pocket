const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { optionLabel, optionCandidates, checklistCandidates, choiceDraft,
  checklistDraft, enhance } = require('../public/js/crew-reply-discovery.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'public/js/crew-interactive.js'), 'utf8');
assert.ok(html.indexOf('/js/crew-reply-discovery.js') < html.indexOf('/js/crew-interactive.js'));
assert.match(renderer, /CrewReplyDiscovery\?\.enhance\(container, context, fillComposer\)/);
assert.match(renderer, /if \(!count\)/, 'explicit crew-ui controls take priority');
assert.equal(optionLabel('方案 A：保留現在架構'), '方案 A：保留現在架構');
assert.equal(optionLabel('Option B - mobile UI'), 'Option B - mobile UI');
assert.equal(optionLabel('這只是一般解釋'), null);
assert.equal(optionLabel('方案 Z：不是可辨識方案'), null);
assert.equal(optionLabel('方案 A'.repeat(50)), null);
assert.match(choiceDraft('比較', '方案 A'), /選擇「方案 A」/);
assert.match(checklistDraft('下一步', ['修 UI', '測試']), /- 修 UI\n- 測試/);

class Node {
  constructor(tag = 'div', content = '') {
    this.tagName = tag.toUpperCase(); this._text = content; this.children = [];
    this.dataset = {}; this.attrs = {}; this.handlers = {}; this.parentNode = null;
    this.className = ''; this.checked = false;
    this.classList = {
      add: item => { this.className += ' ' + item; },
      contains: item => this.className.split(/\s+/).includes(item)
    };
  }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set textContent(value) { this._text = String(value); }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    child.parentNode = this;
    const index = ref == null ? -1 : this.children.indexOf(ref);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(kind, handler) { this.handlers[kind] = handler; }
  click() { this.handlers.click?.(); }
  matches(selector) {
    return selector.split(',').some(token => {
      const key = token.trim();
      if (key.startsWith('.')) return this.classList.contains(key.slice(1));
      return this.tagName === key.toUpperCase();
    });
  }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches(selector)) return node; node = node.parentNode; }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = item => {
      for (const child of item.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const el=(tag,text='',parent=null)=>{
  const node=new Node(tag,text);
  if (parent) parent.appendChild(node);
  return node;
};
const panel = (title, kind) => {
  const p = el('section'); p.className = 'visual-answer-panel';
  p.dataset.sectionKind = kind; el('h2',title,p); return p;
};

const comparison = panel('方案比較','comparison');
el('h3','方案 A：沿用目前架構',comparison);
el('p','維持原本的 Markdown',comparison);
el('h3','方案 B：全面改寫',comparison);
assert.deepEqual(optionCandidates(comparison).labels,
  ['方案 A：沿用目前架構','方案 B：全面改寫']);
const unrelated = panel('分析結果', 'detail');
el('p', '這裡只是一般的研究結論，不是選項。', unrelated);
assert.equal(optionCandidates(unrelated), null);
assert.equal(checklistCandidates(unrelated), null);

const tablePanel = panel('比較', 'comparison');
const table=el('table','',tablePanel);
for(const [tag,label] of [['th','方案'],['td','方案 A'],['td','方案 B']]) {
  const row=el('tr','',table); el(tag,label,row);
}
assert.deepEqual(optionCandidates(tablePanel).labels,['方案 A','方案 B']);

const next = panel('下一步','conclusion');
const ul=el('ul','',next);
const labels=['修復手機佈局','測試 Role 切換','整理回歸測試'];
for(const label of labels) el('li',label,ul);
assert.deepEqual(checklistCandidates(next).labels, labels);
const unsafe=panel('行動項目','conclusion');
const unsafeList=el('ul','',unsafe);
el('li','先執行命令',unsafeList).appendChild(el('code','rm -rf'));
el('li','再做測試',unsafeList);
assert.equal(checklistCandidates(unsafe),null,'no automatic checkbox for code-heavy instructions');

const docNodes=[];
global.document={createElement(tag){docNodes.push(tag); return new Node(tag);}};
const rootNode=el('div');
rootNode.appendChild(comparison);rootNode.appendChild(next);
const requests=[];
let permitted=true;
const draft=(message,context,widget)=>{
  assert.equal(context.roleId,'dev');
  assert.ok(widget.querySelector('.crew-interactive-feedback'));
  if (!permitted) return false;
  requests.push(message); return true;
};
assert.equal(enhance(rootNode,{roleId:'dev'},draft),2);
assert.equal(rootNode.textContent.includes('維持原本的 Markdown'),true,
  'original explanation remains in place');
const choiceBar=comparison.querySelector('.crew-auto-actions');
const chips=choiceBar.querySelectorAll('button');
assert.equal(chips.length,2);
assert.equal(chips[0].attrs['aria-pressed'],'false');
permitted=false;chips[0].click();
assert.equal(chips[0].attrs['aria-pressed'],'false','rejected draft does not select');
permitted=true;chips[1].click();
assert.equal(requests.length,1);
assert.match(requests[0], /方案 B：全面改寫/);
assert.equal(chips[1].attrs['aria-pressed'],'true');

const taskBar=next.querySelector('.crew-auto-actions');
const checkboxes=next.querySelectorAll('input');
assert.equal(checkboxes.length,3);
assert.equal(ul.querySelectorAll('li').length,3,'original list remains');
taskBar.querySelector('button').click();
assert.equal(requests.length,1,'unchecked tasks must not submit');
assert.match(taskBar.querySelector('.crew-interactive-feedback').textContent,/請先勾選/);
checkboxes[0].checked=true;checkboxes[2].checked=true;
taskBar.querySelector('button').click();
assert.equal(requests.length,2);
assert.match(requests[1], /- 修復手機佈局\n- 整理回歸測試/);
assert.ok(!requests[1].includes('測試 Role 切換'));
assert.equal(enhance(rootNode,{roleId:'dev'},draft),0,'history rehydration stays idempotent');

const explicit=panel('比較','comparison');
el('div','',explicit).className='crew-interactive';
el('h3','方案 A',explicit); el('h3','方案 B',explicit);
assert.equal(enhance(explicit,{roleId:'dev'},draft),0,'explicit widget takes precedence');
assert.equal(docNodes.includes('iframe'),false);
assert.equal(docNodes.includes('script'),false);
delete global.document;
console.log('crew-reply-discovery P1 tests passed');
