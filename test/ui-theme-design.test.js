const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const assets = read('public/assets.html');
const css = read('public/css/design-system.css');
const lightCss = read('public/css/theme-light.css');
const theme = read('public/js/theme.js');
const ui = read('public/js/ui.js');
const premium = read('public/css/style-premium.css');

for (const page of [html, assets]) {
  assert.match(page, /src="\/js\/theme\.js"/);
  assert.match(page, /href="\/css\/design-system\.css"/);
  assert.match(page, /href="\/css\/theme-light\.css"/);
}
assert.ok(html.indexOf('/js/theme.js') < html.indexOf('/vendor/tailwindcss.js'), 'prevent flash on startup');
assert.match(html, /data-theme-choice="dark"/);
assert.match(html, /data-theme-choice="light"/);
assert.match(html, /data-theme-choice="system"/);
assert.ok(!html.includes('id="primary-bottom-nav"'));
assert.ok(html.includes('id="crew-open-settings-btn"'));
assert.equal(html.includes('<span class="primary-tab-icon">💬</span>'), false);
assert.ok(ui.includes('data-selected="'));
assert.ok(html.includes('href="/css/crew-home.css"'));
assert.match(css, /--cp-accent:/);
assert.match(css, /--cp-live:/);
assert.match(css, /--cp-text:/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(lightCss, /data-crew-theme="light"/);
assert.match(lightCss, /bg-slate-950\/95/);
// AI replies have their own dark-mode foregrounds; check the light-only
// bridge covers both regular/streaming Markdown and long-form result views.
assert.match(lightCss, /#messages-container \.assistant-article :is\(\.msg-content, \.visual-answer-content\) \{\s*color: var\(--cp-text\) !important;/);
assert.match(lightCss, /#messages-container \.assistant-article :is\(\.msg-content, \.visual-answer-content\) :is\(h1, h2, h3, h4, strong\) \{\s*color: var\(--cp-text\) !important;/);
assert.match(lightCss, /#messages-container \.assistant-article \.msg-content tr:nth-child\(even\) \{\s*background: var\(--cp-surface-2\);/);
assert.match(lightCss, /\.visual-answer-panel\[data-section-kind="summary"\]/);
assert.match(lightCss, /#messages-container \.assistant-article \.msg-content pre \{\s*background: #172338 !important;\s*color: #e2e8f0 !important;/);
assert.match(lightCss, /\.msg-content a:is\(\[href\*="maps.google.com"\], \[href\*="google.com\/maps"\]\)/);
assert.equal(premium.includes('starfield-drift'), false, 'continuous background effect removed');
assert.equal(premium.includes('scanner-sweep-premium'), false, 'rainbow scanners removed');

function createHarness(initialStorage, darkSystem) {
  const state = new Map(Object.entries(initialStorage || {}));
  const callbacks = new Map();
  let mediaCallback;
  const media = {
    matches: darkSystem,
    addEventListener: (_name, callback) => { mediaCallback = callback; }
  };
  const elements = ['dark', 'light', 'system'].map(themeChoice => ({
    dataset: { themeChoice },
    pressed: null,
    active: false,
    classList: { toggle: function (_name, active) { this.active = active; } },
    setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; },
    addEventListener(name, callback) { callbacks.set(themeChoice + ':' + name, callback); }
  }));
  const meta = { color: null, setAttribute(name, value) { if (name === 'content') this.color = value; } };
  const doc = {
    readyState: 'loading',
    documentElement: {
      dataset: {}, style: {}, dark: null,
      classList: { toggle: (_name, active) => { doc.documentElement.dark = active; } }
    },
    querySelector: () => meta,
    querySelectorAll: () => elements,
    addEventListener(name, callback) { callbacks.set(name, callback); },
    dispatchEvent() {}
  };
  const window = {
    localStorage: {
      getItem: key => state.get(key) || null,
      setItem: (key, value) => state.set(key, value)
    },
    matchMedia: () => media
  };
  vm.runInNewContext(theme, { document: doc, window, CustomEvent: class {} }, { filename: 'theme.js' });
  callbacks.get('DOMContentLoaded')();
  return { doc, window, meta, media, elements, state,
    choose: mode => callbacks.get(mode + ':click')(),
    systemChanged: matches => { media.matches = matches; mediaCallback(); } };
}

const initial = createHarness({}, true);
assert.equal(initial.doc.documentElement.dataset.crewTheme, 'dark');
assert.equal(initial.doc.documentElement.dark, true);
assert.equal(initial.meta.color, '#0B1020');
initial.choose('light');
assert.equal(initial.doc.documentElement.dataset.crewTheme, 'light');
assert.equal(initial.doc.documentElement.dark, false);
assert.equal(initial.state.get('crew_theme'), 'light');
assert.equal(initial.meta.color, '#F5F7FB');
assert.equal(initial.elements.find(x => x.dataset.themeChoice === 'light').pressed, 'true');
initial.choose('system');
initial.systemChanged(false);
assert.equal(initial.doc.documentElement.dataset.crewTheme, 'light');
initial.systemChanged(true);
assert.equal(initial.doc.documentElement.dataset.crewTheme, 'dark');
const persisted = createHarness({ crew_theme: 'light' }, true);
assert.equal(persisted.doc.documentElement.dataset.crewTheme, 'light');
const invalid = createHarness({ crew_theme: 'other' }, false);
assert.equal(invalid.doc.documentElement.dataset.crewTheme, 'dark');

console.log('ui-theme-design tests: ok');
