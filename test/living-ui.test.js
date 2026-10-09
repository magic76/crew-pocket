const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize, render, changeTab, install, stateOf } = require('../public/js/living-ui.js');

const rootPath = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(rootPath, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(rootPath, 'public/css/living-ui.css'), 'utf8');
const chat = fs.readFileSync(path.join(rootPath, 'public/js/chat.js'), 'utf8');

assert.ok(html.includes('href="/css/living-ui.css"'), 'workbench stylesheet loaded');
assert.ok(html.includes('src="/js/living-ui.js"'), 'workbench controller loaded');
assert.ok(html.indexOf('/js/living-ui.js') < html.indexOf('/js/chat.js'),
  'workbench loads before chat render code');
assert.match(chat, /window\.CrewLivingUI\?\.render/, 'chat must use trusted renderer');
assert.match(chat, /toolRows: groupedTools\.length/, 'use already coalesced tool events');
assert.match(chat, /execution-result-response/, 'preserve original report for legacy fallback');
assert.match(chat, /lazy-result-card/, 'deferred rendering stays intact');
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /data-living-panel="report"/);

const complete = {
  kind: 'execution', status: 'completed', execution_mode: 'BUILD',
  duration_ms: 9932, tool_count: 2, executions: 4, polls: 1,
  changed_files: ['src/x.ts', 'src/x.ts', 'apps/<script>alert(1)</script>.tsx', 'docs/a"b.md'],
  checks: [
    { label: 'node --check', status: 'passed' },
    { name: 'TypeScript', state: 'failed' },
    { label: 'Unverified', status: 'pending' }
  ],
  commit: { hash: 'af01bcd12345' }
};
const normalized = normalize({ turnResult: complete, toolRows: 3 });
assert.equal(normalized.state, 'completed');
assert.equal(normalized.files.length, 3, 'deduplicate paths');
assert.deepEqual(normalized.checks.map(x=>x.status), ['passed', 'failed', 'unknown']);
assert.equal(normalized.commit, 'af01bcd12345');
assert.equal(normalized.duration, 9932);
assert.equal(normalized.tools, 2);
assert.equal(normalized.executions, 4);
assert.equal(normalized.toolRows, 3);

const output = render({
  turnResult: complete,
  responseHtml: '<p>Original sanitized response</p>',
  changedFilesHtml: '<div>legacy file list</div>',
  checksHtml: '<section class="execution-result-section"><div class="execution-result-check" data-check-state="passed">PASS</div></section>',
  executionHtml: '<details class="execution-result-section"><summary>Actual tools</summary><div>shell</div></details>',
  summaryBits: ['建置','4 次操作'],
  structuredCommit: 'af01bcd12345',
  toolRows: 3
});
assert.match(output, /CREW WORKBENCH/);
assert.match(output, /data-living-panel="report"/);
assert.match(output, /data-living-panel="files"/);
assert.match(output, /data-living-panel="checks"/);
assert.match(output, /data-living-panel="tools"/);
assert.match(output, /Original sanitized response/);
assert.equal(output.match(/Original sanitized response/g).length, 1, 'report rendered exactly once');
assert.match(output, /data-file-search="src\/x\.ts"/);
assert.match(output, /src\/x\.ts/);
assert.match(output, /apps\/&lt;script&gt;alert\(1\)&lt;\/script&gt;\.tsx/);
assert.match(output, /docs\/a&quot;b\.md/);
assert.doesNotMatch(output, /<script>/, 'file path must always be escaped');
assert.match(output, /已記錄驗證/);
assert.match(output, /data-check-state="passed"/);
assert.match(output, /已複製路徑|複製檔案路徑/);
assert.match(output, /af01bcd123/, 'trusted commit is displayed');
assert.match(output, /不等於測試或建置通過/, 'completion wording must not claim tests passed');
assert.equal(output.match(/data-living-tab=/g).length, 4);

const unconfirmed = render({
  turnResult: {
    kind: 'execution', status: 'weird', changed_files: [],
    checks: [], executions: null,
    commit: { hash: 'not-an-actual-commit' }
  },
  responseHtml: '<p>Partial answer</p>',
  summaryBits: []
});
assert.match(unconfirmed, /終態未知/);
assert.ok(!unconfirmed.includes('data-living-panel="files"'));
assert.ok(!unconfirmed.includes('data-living-panel="checks"'));
assert.ok(!unconfirmed.includes('data-living-panel="tools"'));
assert.ok(!unconfirmed.includes('not-an-actual-commit'));
assert.equal(unconfirmed.match(/data-living-tab=/g).length, 1);
assert.equal(stateOf({ status: 'failed' }), 'failed');
assert.equal(stateOf({ status: 'interrupted' }), 'interrupted');
assert.equal(stateOf({}), 'unknown');
assert.equal(normalize({ turnResult: {} }).executions, null,
  'missing statistics are not rendered as measured zero');
assert.equal(normalize({ turnResult: { checks: [{ label: 'unknown', status: 'completed?' }] } })
  .checks[0].status, 'unknown', 'unknown checks cannot be promoted to passing');

// Verify scoped, keyboard-accessible controls without a browser runtime.
function node(kind, id) {
  return {
    dataset: { [kind]: id }, hidden: id !== 'report', attrs: {},
    classList: { toggle(name, on) { this[name] = on; } },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() { this.focused = true; }
  };
}
const tabs = ['report', 'files', 'checks', 'tools'].map(id=>node('livingTab', id));
const panels = ['report', 'files', 'checks', 'tools'].map(id=>node('livingPanel', id));
const rows = [
  { dataset: { fileSearch: 'src/login.ts' }, hidden: false },
  { dataset: { fileSearch: 'lib/role.js' }, hidden: false }
];
const noMatch = { hidden: true };
const feedback = { textContent: '' };
const host = {
  querySelectorAll(sel) {
    return sel === '[data-living-tab]' ? tabs
      : sel === '[data-living-panel]' ? panels
      : sel === '[data-living-file-row]' ? rows : [];
  },
  querySelector(sel) {
    return sel === '.living-file-no-match' ? noMatch
      : sel === '[data-living-feedback]' ? feedback : null;
  }
};
const listeners = {};
install({ addEventListener(name, fn) { listeners[name] = fn; } });
assert.ok(listeners.click && listeners.input && listeners.keydown);
changeTab(host, 'files');
assert.equal(tabs[1].attrs['aria-selected'], 'true');
assert.equal(panels[1].hidden, false);
assert.equal(panels[0].hidden, true);
changeTab(host, 'missing');
assert.equal(panels[1].hidden, false, 'unsupported panels cannot activate');
const focusTarget = tabs[1];
focusTarget.closest = selector =>
  selector === '[data-living-tab]' ? focusTarget
    : selector === '.living-workbench' ? host : null;
listeners.keydown({ key: 'ArrowRight', target: focusTarget, preventDefault() { this.handled = true; } });
assert.equal(panels[2].hidden, false);
assert.equal(tabs[2].focused, true);
const searchTarget = {
  value: 'login',
  matches: selector => selector === '[data-living-file-search]',
  closest: selector => selector === '.living-workbench' ? host : null
};
listeners.input({ target: searchTarget });
assert.equal(rows[0].hidden, false);
assert.equal(rows[1].hidden, true);
assert.equal(noMatch.hidden, true);
searchTarget.value = 'notfound';
listeners.input({ target: searchTarget });
assert.equal(noMatch.hidden, false);

console.log('living-ui tests: ok');
