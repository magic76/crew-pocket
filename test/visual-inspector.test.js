const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/js/visual-inspector.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/visual-inspector.css'), 'utf8');
const native = fs.readFileSync(path.join(root,
  'android-wrapper/app/src/main/java/com/crewpocket/app/MainActivity.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root,
  'android-wrapper/app/src/main/AndroidManifest.xml'), 'utf8');

for (const id of ['visual-inspector-modal', 'visual-inspector-canvas',
  'visual-inspector-stage', 'visual-inspector-note', 'visual-inspector-note-details',
  'visual-inspector-zoom-out', 'visual-inspector-zoom-in', 'visual-inspector-fit',
  'visual-inspector-zoom-label', 'visual-inspector-file', 'attach-opt-visual',
  'visual-inspector-role', 'visual-inspector-send', 'visual-inspector-attach']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing visual UI: ' + id);
}
assert.match(html, /data-visual-tool="pan" aria-pressed="true"/);
assert.match(html, /\/js\/visual-inspector\.js/);
assert.match(css, /min-height:\s*0/);
assert.match(css, /touch-action:\s*none/);
assert.match(manifest, /android\.intent\.action\.SEND/);
assert.match(manifest, /android:mimeType="image\/\*"/);
assert.match(native, /captureSharedImageIntent\(intent\)/);
assert.match(native, /dispatchPendingSharedImage\(\)/);
assert.match(native, /runCatching \{ uploadSharedImage\(uri\) \}/);
assert.ok(!native.includes('MediaProjection'), 'Quick Share needs no silent screen recording');

class Element {
  constructor() {
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.attrs = {};
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 200;
    this.clientHeight = 100;
    this.classList = {
      values: new Set(['hidden']),
      add: value => this.classList.values.add(value),
      remove: value => this.classList.values.delete(value),
      contains: value => this.classList.values.has(value)
    };
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  dispatch(type, event = {}) { return this.listeners[type]?.(event); }
  dispatchEvent() {}
  setAttribute(name, value) { this.attrs[name] = value; }
  focus() { this.focused = true; }
  replaceChildren() { this.children = []; this.value = ''; }
  appendChild(child) { (this.children ||= []).push(child); return child; }
  remove() { this.removed = true; }
  querySelectorAll() { return []; }
}

const ids = ['visual-inspector-modal', 'visual-inspector-canvas', 'visual-inspector-stage',
  'visual-inspector-tools', 'visual-inspector-note', 'visual-inspector-note-details',
  'visual-inspector-zoom-out', 'visual-inspector-zoom-in', 'visual-inspector-fit',
  'visual-inspector-zoom-label', 'visual-inspector-status', 'visual-inspector-undo',
  'visual-inspector-attach', 'visual-inspector-close', 'visual-inspector-clear',
  'visual-inspector-file', 'visual-inspector-role', 'visual-inspector-send', 'prompt-input'];
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
const rectangles = [];
const ctx = {
  save() {}, restore() {}, clearRect() {}, drawImage() {},
  strokeRect(...args) { rectangles.push(args); },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
};
const canvas = elements['visual-inspector-canvas'];
canvas.getContext = () => ctx;
canvas.getBoundingClientRect = () => {
  const width = Number.parseFloat(canvas.style.width) || canvas.width || 200;
  return { left: 0, top: 0, width, height: width * canvas.height / canvas.width };
};
canvas.setPointerCapture = () => {};
canvas.toDataURL = () => 'data:image/jpeg;base64,YWJj';

const document = {
  readyState: 'complete',
  getElementById: id => elements[id] || null,
  addEventListener() {},
  createElement: () => new Element(), body: new Element()
};
class Screenshot {
  set src(value) {
    this.currentSource = value;
    this.naturalWidth = 1000;
    this.naturalHeight = 2000; // long screenshot should be vertically scrollable
    this.onload();
  }
}
let chosenTab = null;
let uploadCalls = 0;
let reuseCalls = 0;
let currentRole = 'role-general';
const window = {
  location: { origin: 'http://127.0.0.1:8000' },
  addEventListener() {},
  crypto: require('node:crypto').webcrypto,
  getCurrentRoleId: () => currentRole,
  openCrewCockpitRole: async id => { currentRole = id; },
  showToast: text => { window.lastToast = text; },
  setPrimaryTab: tab => { chosenTab = tab; },
  attachExistingImagePath: (imagePath, imageUrl) => {
    assert.ok(['/tmp/shared.jpg', '/tmp/visual-inspector.jpg'].includes(imagePath));
    assert.match(imageUrl, /api\/image\?/);
    reuseCalls++;
    return imagePath;
  },
  processAndUploadImageBase64: async (data, name) => {
    assert.match(data, /^data:image\/jpeg;base64,/);
    assert.equal(name, 'visual-inspector.jpg');
    uploadCalls++;
    return '/tmp/visual-inspector.jpg';
  }
};
let submitted = []; let submitError = null; let responsePromise = null;
const fetch = async (url, options = {}) => {
  if (url === '/api/roles') return { ok: true, json: async () => ({ success: true, roles: [
    { id: 'role-general', name: 'General' }, { id: 'role-teacher', name: 'Teacher Dev' }
  ] }) };
  if (url === '/api/upload') {
    uploadCalls++; return { ok: true, json: async () => ({ success: true, filePath: '/tmp/visual-inspector.jpg' }) };
  }
  assert.equal(url, '/api/role-submit');
  const body = JSON.parse(options.body); submitted.push(body);
  if (responsePromise) await responsePromise;
  if (submitError) throw submitError;
  return { ok: true, status: 202, json: async () => ({ success: true, submission: { status: 'queued' } }) };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const runtime = { window, document, URL, Image: Screenshot, fetch, setTimeout, clearTimeout, AbortController,
  Event: class { constructor(type) { this.type = type; } },
  module: { exports: {} } };
vm.runInNewContext(source, runtime, { filename: 'visual-inspector.js' });
const visual = window.CrewVisualInspector;

assert.equal(visual.openFromSharedScreen('https://attacker.test/api/image?path=x'), false);
assert.equal(visual.openFromSharedScreen('/api/not-image?path=x'), false);
assert.equal(visual.openFromSharedScreen('%invalid-url'), false);
const sharedUrl = '/api/image?path=%2Ftmp%2Fshared.jpg';
assert.equal(visual.openFromSharedScreen(sharedUrl), true);
assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), false);
assert.equal(elements['visual-inspector-modal'].dataset.entry, 'shared');
assert.equal(elements['visual-inspector-note-details'].open, false);
assert.equal(elements['visual-inspector-stage'].scrollTop, 0);
assert.equal(elements['visual-inspector-zoom-label'].textContent, '100%');
assert.equal(canvas.style.width, '200px', 'image fits screen width initially');

function gesture(type, pointerId, clientX, clientY) {
  canvas.dispatch(type, { pointerId, clientX, clientY, preventDefault() {} });
}
const stage = elements['visual-inspector-stage'];
gesture('pointerdown', 4, 90, 100);
gesture('pointermove', 4, 90, 25);
gesture('pointerup', 4, 90, 25);
assert.equal(stage.scrollTop, 75, 'one finger pans downward through tall screenshot');
assert.equal(rectangles.length, 0, 'panning never creates an annotation');

gesture('pointerdown', 7, 55, 50);
gesture('pointerdown', 8, 115, 50);
gesture('pointermove', 8, 175, 50);
assert.ok(canvas.getBoundingClientRect().width > 200, 'two finger pinch zoom works');
const scrollBeforeTwoFingerDrag = stage.scrollTop;
gesture('pointermove', 7, 55, 15);
gesture('pointermove', 8, 175, 15);
assert.ok(stage.scrollTop > scrollBeforeTwoFingerDrag, 'two fingers pan the long screenshot');
gesture('pointerup', 8, 175, 15);
gesture('pointerup', 7, 55, 15);
elements['visual-inspector-fit'].dispatch('click');
assert.equal(canvas.style.width, '200px', 'fit control restores width');
assert.equal(stage.scrollTop, 0, 'fit restores top of long capture');

elements['visual-inspector-note'].value = '幫我分析這個頁面';
(async () => {
  await flush();
  await elements['visual-inspector-attach'].dispatch('click');
  assert.equal(reuseCalls, 1, elements['visual-inspector-status'].textContent);
  assert.equal(uploadCalls, 0);
  assert.equal(chosenTab, 'chat');
  assert.match(elements['prompt-input'].value, /幫我分析這個頁面/);
  assert.match(elements['prompt-input'].value, /否則只分析/);
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), true);
  assert.equal(elements['prompt-input'].focused, true);

  // Reopen shared screen and draw only after an explicit annotation tool switch.
  assert.equal(visual.openFromSharedScreen(sharedUrl), true);
  const mapped = visual.pointOnCanvas({ clientX: 100, clientY: 50 }, canvas);
  assert.equal(mapped.x, 500);
  assert.equal(mapped.y, 250);
  const selectedTool = { dataset: { visualTool: 'rect' }, setAttribute() {} };
  elements['visual-inspector-tools'].dispatch('click', {
    target: { closest: () => selectedTool }
  });
  gesture('pointerdown', 10, 20, 10);
  gesture('pointermove', 10, 150, 75);
  gesture('pointerup', 10, 150, 75);
  assert.ok(rectangles.length > 0, 'explicit markup mode draws a rectangle');
  assert.equal(elements['visual-inspector-undo'].disabled, false);
  elements['visual-inspector-undo'].dispatch('click');
  assert.equal(elements['visual-inspector-undo'].disabled, true);
  gesture('pointerdown', 11, 20, 10);
  gesture('pointermove', 11, 150, 75);
  gesture('pointerup', 11, 150, 75);
  await flush();
  await elements['visual-inspector-attach'].dispatch('click');
  assert.match(elements['prompt-input'].value, /請分析我標註的位置/);
  assert.equal(reuseCalls, 2, 'annotated attachment uses the newly uploaded bytes');
  assert.equal(uploadCalls, 1);
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), true);
  // Direct submission stays on the viewed Role, with no composer mutation.
  visual.openFromSharedScreen(sharedUrl); await flush();
  assert.equal(elements['visual-inspector-role'].value, 'role-general');
  elements['visual-inspector-role'].value = 'role-teacher';
  const previousComposer = elements['prompt-input'].value;
  chosenTab = null;
  const uploadsBefore = uploadCalls;
  let release; responsePromise = new Promise(resolve => { release = resolve; });
  const sending = elements['visual-inspector-send'].dispatch('click');
  await flush();
  await elements['visual-inspector-send'].dispatch('click');
  assert.equal(submitted.length, 1, 'double tap cannot create two submissions');
  assert.equal(elements['visual-inspector-send'].disabled, true);
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), false);
  release(); await sending; responsePromise = null;
  assert.equal(submitted[0].role_id, 'role-teacher');
  assert.equal(submitted[0].image_path, '/tmp/shared.jpg');
  assert.match(submitted[0].prompt, /來源：Android/);
  assert.equal(uploadCalls, uploadsBefore, 'unmarked shared screenshot does not upload again');
  assert.equal(chosenTab, null, 'direct send must not navigate');
  assert.equal(elements['prompt-input'].value, previousComposer);
  assert.equal(window.lastToast, '已送給 Teacher Dev');
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), true);

  visual.openFromSharedScreen(sharedUrl); await flush();
  elements['visual-inspector-note'].value = 'keep this request';
  submitError = new Error('network timeout');
  await elements['visual-inspector-send'].dispatch('click');
  const failedBody = submitted.at(-1);
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), false);
  assert.equal(elements['visual-inspector-note'].value, 'keep this request');
  assert.match(elements['visual-inspector-status'].textContent, /未確認/);
  assert.equal(elements['visual-inspector-send'].disabled, false);
  assert.equal(elements['visual-inspector-note'].disabled, true, 'uncertain retry freezes the original payload');
  submitError = null;
  await elements['visual-inspector-send'].dispatch('click');
  assert.deepEqual(submitted.at(-1), failedBody, 'timeout retry uses the same id and exact payload');
  assert.equal(elements['visual-inspector-modal'].classList.contains('hidden'), true);
  visual.openFromSharedScreen(sharedUrl); await flush();
  elements['visual-inspector-role'].value = 'role-teacher';
  await elements['visual-inspector-attach'].dispatch('click');
  assert.equal(currentRole, 'role-teacher', 'later send selects its intended recipient through existing Role navigation');
  assert.equal(chosenTab, 'chat');
  console.log('visual-inspector quick-share: all checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
