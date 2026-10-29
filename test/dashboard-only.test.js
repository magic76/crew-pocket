'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/js/app.js');
const roleUi = read('public/js/ui.js');
const roleVisual = read('public/js/crew-room.js');

for (const id of ['crew-home-header-host', 'drawer', 'role-nav-list', 'crew-activity-list',
  'crew-attention-panel', 'chat-composer-footer', 'crew-open-settings-btn']) {
  assert.ok(html.includes('id="' + id + '"'), id + ' must stay accessible');
}
assert.ok(html.includes('CREW DASHBOARD'));
assert.ok(app.includes("setPrimaryTab('crew', { hapticFeedback: false, recordHistory: false })"));
assert.ok(app.includes("drawer?.classList.toggle('hidden', primaryTab !== 'crew')"));
assert.equal(app.includes('CrewWorldHost'), false, 'home should never depend on the map');
assert.ok(roleUi.includes('expectedRoleId: role.id'), 'Role conversations must remain owner-checked');
assert.ok(roleVisual.includes('portraitMarkup'), 'inline Role portraits stay available');

for (const marker of ['crew-world-open-btn', 'crew-world-modal', 'crew-pixel-office',
  '/js/crew-world-launcher.js', '/js/crew-pixel-config.js', '/js/crew-pixel-office.js',
  '/css/crew-world-launcher.css', '/css/crew-pixel-office.css']) {
  assert.ok(!html.includes(marker), marker + ' must not be loaded by the UI');
}
for (const retired of [
  'public/js/crew-world-launcher.js', 'public/js/crew-pixel-config.js',
  'public/js/crew-pixel-office.js', 'public/css/crew-world-launcher.css',
  'public/css/crew-pixel-office.css', 'public/css/crew-pixel-shell.css',
  'public/vendor/pixel-agents', 'scripts/sync-pixel-assets.mjs'
]) {
  assert.equal(fs.existsSync(path.join(root, retired)), false, retired + ' is retired');
}
console.log('dashboard-only: map UI retired without changing Role or Chat routes');
