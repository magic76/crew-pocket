const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeAvatar, normalizeRole, RoleStore } = require('../lib/roles');
const { portraitMarkup, resolvedAvatar } = require('../public/js/crew-room');

async function run() {
  const engineer = { id: 'role-engineer', name: 'Pocket Developer', projectId: 'project-pocket' };
  const first = portraitMarkup(engineer);
  assert.match(first, /viewBox="0 0 48 48"/, 'Q portrait should have 48x48 logical pixels');
  assert.match(first, /class="crew-avatar-face"/, 'Face must be a distinct chibi silhouette');
  assert.match(first, /class="crew-avatar-eye"/, 'Large eyes retain blinking hook');
  assert.match(first, /class="crew-pixel-hand"/, 'Existing Crew Room contract remains intact');
  for (let hair = 0; hair < 6; hair++) {
    assert.match(portraitMarkup({ ...engineer, avatar: { hair: String(hair) } }), /viewBox="0 0 48 48"/);
  }
  const hairSprites = new Set(Array.from({ length: 6 }, (_, hair) =>
    portraitMarkup({ ...engineer, avatar: { hair: String(hair), accessory: 'none' } })));
  assert.equal(hairSprites.size, 6, 'All six hairstyles should be visually distinct');
  const faceSprites = new Set(Array.from({ length: 3 }, (_, face) =>
    portraitMarkup({ ...engineer, avatar: { face: String(face), accessory: 'none' } })));
  assert.equal(faceSprites.size, 3, 'All three face silhouettes should differ');
  const outfitSprites = new Set(['engineer','researcher','planner','designer','assistant','explorer']
    .map(outfit => portraitMarkup({ ...engineer, avatar: { outfit, accessory: 'none' } })));
  assert.equal(outfitSprites.size, 6, 'Different jobs should have recognizable outfits');
  const accessorySprites = new Set(['none','glasses','headphones','cap','earpiece']
    .map(accessory => portraitMarkup({ ...engineer, avatar: { accessory } })));
  assert.equal(accessorySprites.size, 5, 'Accessories should have distinct silhouettes');
  const spriteRectangles = [...first.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)];
  assert.ok(spriteRectangles.length >= 20, 'Chibi portrait should contain facial and clothing detail');
  assert.ok(spriteRectangles.every(([,x,y,w,h]) => +x >= 0 && +y >= 0 &&
    +w > 0 && +h > 0 && +x + +w <= 48 && +y + +h <= 48), 'All pixels stay in viewBox');
  assert.equal(first, portraitMarkup({ ...engineer }), 'Auto avatar must be stable by ID');
  assert.match(first, /data-avatar-outfit="engineer"/);
  assert.match(portraitMarkup({ id: 'role-lab', name: 'Research Agent' }), /data-avatar-outfit="researcher"/);
  assert.match(portraitMarkup({ id: 'role-design', name: 'UI Designer' }), /data-avatar-outfit="designer"/);
  assert.equal(resolvedAvatar(engineer).palette, resolvedAvatar(engineer).palette);
  assert.notEqual(first, portraitMarkup({ ...engineer, avatar: { hair: '3', outfit: 'planner', accessory: 'glasses', palette: '4', face: '2' } }));
  assert.match(portraitMarkup({ ...engineer, avatar: { outfit: 'planner', accessory: 'glasses' } }), /data-avatar-accessory="glasses"/);

  assert.equal(normalizeAvatar({}), null, 'Default should not lock in an avatar');
  assert.deepEqual(normalizeAvatar({
    outfit: 'designer', hair: '3', face: '2', accessory: 'cap', palette: '5'
  }), {
    outfit: 'designer', hair: '3', face: '2', accessory: 'cap', palette: '5'
  });
  assert.deepEqual(normalizeAvatar({
    outfit: '<img onerror=alert(1)>', hair: '8', palette: {}, face: null, accessory: 'headphones'
  }), { outfit: 'auto', hair: 'auto', face: 'auto', accessory: 'headphones', palette: 'auto' });
  assert.doesNotMatch(portraitMarkup({
    ...engineer, avatar: { outfit: '" onload="alert(1)', accessory: '<script>' }
  }), /onload=|<script>/);
  assert.equal(normalizeRole({ id: 'role-test', avatar: [] }).avatar, null);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-avatar-'));
  try {
    const file = path.join(dir, 'roles.json');
    const config = { storagePath: file, projectProvider: { listProjects: async () => [], getProject: async () => null } };
    const store = new RoleStore(config);
    const saved = await store.save({
      id: 'role-studio', name: 'Designer',
      avatar: { outfit: 'designer', hair: '4', face: '1', accessory: 'none', palette: '2' }
    });
    assert.equal(saved.avatar.outfit, 'designer');
    assert.equal((await new RoleStore(config).get('role-studio')).avatar.hair, '4');
    await store.save({ id: 'role-studio', name: 'Designer Updated' });
    assert.equal((await store.get('role-studio')).avatar.hair, '4', 'Name edits must preserve avatar');
    await store.save({ id: 'role-studio', avatar: null });
    assert.equal((await store.get('role-studio')).avatar, null, 'Reset must restore auto mode');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const style = await fs.readFile(path.join(__dirname, '../public/css/role-avatar.css'), 'utf8');
  assert.match(style, /width: 76px; height: 76px/, 'Editor preview should show more detail');
  assert.match(style, /color-scheme: light/, 'Keep the recently fixed light-theme select contrast');
  assert.match(style, /prefers-reduced-motion: reduce/, 'Honor reduced-motion setting');
  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const key of ['role-avatar-preview', 'role-avatar-random', 'role-avatar-reset', 'role-avatar-outfit', 'role-avatar-hair']) {
    assert.ok(html.includes('id="' + key + '"'), key + ' should exist in Role editor');
  }
  console.log('role-avatar tests: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
