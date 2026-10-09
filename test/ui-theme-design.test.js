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
