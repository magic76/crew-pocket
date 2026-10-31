const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeAvatar, normalizeRole, RoleStore } = require('../lib/roles');
const { portraitMarkup, resolvedAvatar } = require('../public/js/crew-room');

async function run() {
  const engineer = { id: 'role-engineer', name: 'Pocket Developer', projectId: 'project-pocket' };
  const first = portraitMarkup(engineer);
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

  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const key of ['role-avatar-preview', 'role-avatar-random', 'role-avatar-reset', 'role-avatar-outfit', 'role-avatar-hair']) {
    assert.ok(html.includes('id="' + key + '"'), key + ' should exist in Role editor');
  }
  console.log('role-avatar tests: ok');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
