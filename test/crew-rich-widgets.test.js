const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rich = require('../public/js/crew-rich-widgets.js');
const main = require('../public/js/crew-interactive.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/crew-rich-widgets.css'), 'utf8');
const existing = fs.readFileSync(path.join(root, 'public/js/crew-interactive.js'), 'utf8');
assert.ok(html.includes('/css/crew-rich-widgets.css'));
assert.ok(html.indexOf('/js/crew-rich-widgets.js') < html.indexOf('/js/crew-interactive.js'));
assert.match(existing, /richApi\(\)\?\.mount\(pre, spec, context, fillComposer\)/);
assert.match(css, /max-width: 420px/);
assert.doesNotMatch(css, /position:\s*fixed|overflow-y:\s*auto/i);

const chart = { version: 1, type: 'chart', title: 'Latency', kind: 'bar',
  unit: 'ms', items: [{ label: 'Before', value: 85 }, { label: 'After', value: 42 }] };
const line = { ...chart, kind: 'line', items: [
  { label: 'Week 1', value: 5 }, { label: 'Week 2', value: 9 },
  { label: 'Week 3', value: 4 }] };
const scenario = { version: 1, type: 'scenario', title: '方向評估', options: [
  { label: '保守', description: '只調整 UI，不改流程', facts: [
    { label: '風險', value: '低' }, { label: '預估時間', value: '短' }] },
  { label: '積極', description: '優化完整操作流程', facts: [
    { label: '風險', value: '中' }] }
] };
const calculator = { version: 1, type: 'calculator', title: '成本示意',
  assumption: '固定每單位 12 元，不含額外成本',
  input: { label: '使用量', unit: '次', min: 10, max: 100, step: 10, value: 30 },
  output: { label: '估計成本', unit: '元', base: 360, perUnit: 12, precision: 0 } };

for (const item of [chart, line, scenario, calculator]) {
  const a = rich.normalizeSpec(item);
  assert.ok(a, 'valid P2 spec: ' + item.type);
  assert.equal(main.parseSpec(JSON.stringify(item)).type, item.type,
    'old crew-ui parser must support P2');
  assert.equal(main.normalizeSpec(item).type, item.type);
  assert.equal(a.type, item.type);
  assert.ok(rich.widgetHtml(a).includes('AI 回覆資料 · 未驗證'));
}
assert.match(rich.chartHtml(rich.normalizeSpec(chart)), /50?\.?\d*%|49\.41%/);
assert.match(rich.chartHtml(rich.normalizeSpec(line)), /<svg/);
assert.match(rich.chartHtml(rich.normalizeSpec(line)), /<polyline/);
assert.match(rich.chartHtml(rich.normalizeSpec(chart)), /<details/);
assert.equal(rich.calculate(rich.normalizeSpec(calculator), 30), 360);
assert.equal(rich.calculate(rich.normalizeSpec(calculator), 100), 1200);
assert.equal(rich.calculate(rich.normalizeSpec(calculator), 5), null);
assert.match(rich.buildDraft(rich.normalizeSpec(scenario), 1), /積極/);
assert.equal(rich.buildDraft(rich.normalizeSpec(scenario), 3), '');
assert.match(rich.buildDraft(rich.normalizeSpec(calculator), 40), /480/);
assert.match(rich.buildDraft(rich.normalizeSpec(calculator), 40), /先核實假設/);

for (const spec of [
  { ...chart, kind: 'pie' },
  { ...chart, items: [] },
  { ...chart, items: [...chart.items, chart.items[0]] },
  { ...chart, items: [{ label: 'x', value: Infinity }, chart.items[1]] },
  { ...chart, items: [{ label: 'x', value: NaN }, chart.items[1]] },
  { ...chart, items: [{ label: 'x', value: -1 }, chart.items[1]] },
  { ...chart, items: [{ label: 'x', value: '7' }, chart.items[1]] },
  { ...chart, items: Array(11).fill({ label: 'same', value: 1 }) },
  { ...scenario, options: [scenario.options[0]] },
  { ...scenario, options: [scenario.options[0], scenario.options[0]] },
  { ...scenario, options: [{ ...scenario.options[0], facts: [{}] }, scenario.options[1]] },
  { ...calculator, assumption: '' },
  { ...calculator, input: { ...calculator.input, step: 0 } },
  { ...calculator, input: { ...calculator.input, max: 10 } },
  { ...calculator, input: { ...calculator.input, value: 9999 } },
  { ...calculator, output: { ...calculator.output, precision: 8 } },
  { ...calculator, output: { ...calculator.output, perUnit: 1e200 } },
  { ...calculator, input: { ...calculator.input, min: 0, max: 1000, step: 0.01 } },
]) assert.equal(rich.normalizeSpec(spec), null, 'reject malformed model-controlled data');

const dirty = { ...scenario, title: '<img src=x onerror=alert(1)>',
  options: [{ ...scenario.options[0], description: '<script>alert(1)</script>' },
    scenario.options[1]] };
const markup = rich.widgetHtml(rich.normalizeSpec(dirty));
assert.ok(!markup.includes('<img'));
assert.ok(!markup.includes('<script'));
assert.match(markup, /&lt;img/);
assert.match(markup, /&lt;script/);
assert.doesNotMatch(rich.widgetHtml(rich.normalizeSpec(chart)), /<iframe|<script/);
assert.ok(!rich.widgetHtml(rich.normalizeSpec(calculator)).includes('onclick='));
assert.ok(!rich.widgetHtml(rich.normalizeSpec(scenario)).includes('onclick='));
assert.equal(main.parseSpec(JSON.stringify({
  ...scenario, options: [
    { ...scenario.options[0], description: 'x'.repeat(6000) }, scenario.options[1]]
})), null, 'reject large model payloads');

// Stub DOM: handlers only modify the current visual state and call the supplied
// already-existing guarded draft callback (never submit, never execute tools).
class FakeNode {
  constructor() {
    this.attrs = {}; this.handlers = {}; this.dataset = {};
    this.innerHTML = ''; this.textContent = ''; this.value = '';
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { this.handlers[key] = fn; }
  focus() { this.focused = true; }
}
function prepare(kind) {
  const node = new FakeNode();
  const tabNodes = [new FakeNode(), new FakeNode()];
  const panel = new FakeNode(), apply = new FakeNode(), slider = new FakeNode();
  const inputValue = new FakeNode(), outputValue = new FakeNode();
  node.querySelectorAll = selector => selector === '[data-rich-tab]' ? tabNodes : [];
  node.querySelector = selector => ({
    '.crew-rich-scenario-panel': panel, '[data-rich-apply]': apply,
    '[data-rich-range]': slider, '[data-rich-input-value]': inputValue,
    '[data-rich-output-value]': outputValue
  })[selector] || null;
  const pre = { replaceWith(element) { this.replacement = element; } };
  const requests = [];
  const context = { roleId: 'tester', provider: 'codex', conversationId: 'id-3' };
  const fill = (message, received, widget) => {
    assert.equal(received, context);
    assert.equal(widget, node);
    requests.push(message);
    return true;
  };
  const originalCreate = global.document.createElement;
  global.document.createElement = () => node;
  let accepted;
  try {
    accepted = rich.mount(pre, rich.normalizeSpec(kind), context, fill);
  } finally {
    global.document.createElement = originalCreate;
  }
  assert.equal(accepted, true);
  assert.equal(pre.replacement, node);
  return { node, tabNodes, panel, apply, slider, inputValue, outputValue, requests };
}
const originalDocument = global.document;
global.document = { createElement() { return new FakeNode(); } };
let tabs = prepare(scenario);
assert.match(tabs.panel.innerHTML, /只調整 UI/);
tabs.tabNodes[1].handlers.click();
assert.match(tabs.panel.innerHTML, /優化完整操作流程/);
assert.equal(tabs.tabNodes[1].attrs['aria-selected'], 'true');
assert.equal(tabs.tabNodes[0].attrs['aria-selected'], 'false');
tabs.apply.handlers.click();
assert.match(tabs.requests[0], /積極/);
let prevented = false;
tabs.tabNodes[1].handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(tabs.tabNodes[0].focused, true);
tabs.apply.handlers.click();
assert.match(tabs.requests[1], /保守/);
let calc = prepare(calculator);
calc.slider.value = '50';
calc.slider.handlers.input();
assert.match(calc.outputValue.textContent, /600/);
calc.apply.handlers.click();
assert.match(calc.requests[0], /600/);
assert.match(calc.requests[0], /使用量：50 次/);
let staticChart = prepare(chart);
assert.equal(staticChart.requests.length, 0, 'chart is read only');
global.document = originalDocument;

console.log('crew-rich-widgets P2 tests passed');
