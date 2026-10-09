const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/js/visual-inspector.js'), 'utf8');
const native = fs.readFileSync(path.join(root,
  'android-wrapper/app/src/main/java/com/crewpocket/app/MainActivity.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root,
  'android-wrapper/app/src/main/AndroidManifest.xml'), 'utf8');

for (const id of ['visual-inspector-modal', 'visual-inspector-canvas',
  'visual-inspector-note', 'visual-inspector-file', 'attach-opt-visual',
  'visual-inspector-attach']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing visual UI: ' + id);
}
assert.match(html, /\/js\/visual-inspector\.js/);
assert.match(manifest, /android\.intent\.action\.SEND/);
assert.match(manifest, /android:mimeType="image\/\*"/);
assert.match(native, /captureSharedImageIntent\(intent\)/);
assert.match(native, /dispatchPendingSharedImage\(\)/);
assert.match(native, /runCatching \{ uploadSharedImage\(uri\) \}/);
assert.ok(!native.includes('MediaProjection'), 'P0 must require no automatic screen recording');

class Element {
  constructor() {
    this.listeners = {};
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.attrs = {};
    this.classList = {
      values: new Set(['hidden']),
      add: value => this.classList.values.add(value),
      remove: value => this.classList.values.delete(value),
      contains: value => this.classList.values.has(value)
    };
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  dispatch(type, event = {}) { return this.listeners[type]?.(event); }
  dispatchEvent() {}
  setAttribute(name, value) { this.attrs[name] = value; }
  focus() { this.focused = true; }
  querySelectorAll() { return []; }
}

const ids = ['visual-inspector-modal', 'visual-inspector-canvas',
  'visual-inspector-tools', 'visual-inspector-note',
  'visual-inspector-status', 'visual-inspector-undo',
  'visual-inspector-attach', 'visual-inspector-close',
  'visual-inspector-clear', 'visual-inspector-file', 'prompt-input'];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
const rectangles = [];
const ctx = {
  save() {}, restore() {}, clearRect() {}, drawImage() {},
  strokeRect(...args) { rectangles.push(args); },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
};
const canvas = elements['visual-inspector-canvas'];
canvas.getContext = () => ctx;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
canvas.setPointerCapture = () => {};
canvas.toDataURL = () => 'data:image/jpeg;base64,YWJj';

const document = {
  readyState: 'complete',
  getElementById: id => elements[id] || null,
  addEventListener() {}
};
class Screenshot {
  set src(value) {
    this.currentSource = value;
    this.naturalWidth = 1000;
    this.naturalHeight = 500;
    this.onload();
  }
}
let chosenTab = null;
let uploadCalls = 0;
const window = {
  location: { origin: 'http://127.0.0.1:8000' },
  setPrimaryTab: tab => { chosenTab = tab; },
  processAndUploadImageBase64: async (data, name) => {
    assert.match(data, /^data:image\/jpeg;base64,/);
    assert.equal(name, 'visual-inspector.jpg');
    uploadCalls++;
    return '/tmp/visual-inspector.jpg';
  }
};
const runtime = { window, document, URL, Image: Screenshot,
  Event: class { constructor(type) { this.type = type; } },
  module: { exports: {} } };
vm.runInNewContext(source, runtime, { filename: 'visual-inspector.js' });
const visual = window.CrewVisualInspector;

assert.equal(visual.openFromSharedScreen('https://attacker.test/api/image?path=x'), false);
assert.equal(visual.openFromSharedScreen('/api/not-image?path=x'), false);
assert.equal(visual.openFromSharedScreen('/api/image?path=%2Ftmp%2Fshared.jpg'), true);
assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), false);

const mapped = visual.pointOnCanvas({ clientX: 100, clientY: 50 }, canvas);
assert.equal(mapped.x, 500);
assert.equal(mapped.y, 250);
canvas.dispatch('pointerdown', {
  pointerId: 4, clientX: 20, clientY: 10, preventDefault() {}
});
canvas.dispatch('pointermove', {
  pointerId: 4, clientX: 150, clientY: 75, preventDefault() {}
});
canvas.dispatch('pointerup', {
  pointerId: 4, clientX: 150, clientY: 75, preventDefault() {}
});
assert.ok(rectangles.length > 0, 'drawing should render a rectangle');
assert.equal(elements['visual-inspector-undo'].disabled, false);
elements['visual-inspector-undo'].dispatch('click');
assert.equal(elements['visual-inspector-undo'].disabled, true);

(async () => {
  elements['visual-inspector-note'].value = '縮小這個按鈕';
  await elements['visual-inspector-attach'].dispatch('click');
  assert.equal(uploadCalls, 1);
  assert.equal(chosenTab, 'chat');
  assert.match(elements['prompt-input'].value, /縮小這個按鈕/);
  assert.match(elements['prompt-input'].value, /沒有原始碼/);
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), true);
  assert.equal(elements['prompt-input'].focused, true);
  console.log('visual-inspector: all checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
