const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const root = path.join(__dirname, '..');
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const ui = await fs.readFile(path.join(root, 'public', 'js', 'ui.js'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'css', 'style-premium.css'), 'utf8');
  const { RoleStore, DEFAULT_ROLE_NAME, developerRoleNameForProject } = require('../lib/roles');

  assert.equal(DEFAULT_ROLE_NAME, 'General');
  assert.equal(developerRoleNameForProject({ name: 'crew-helper' }), 'Helper Dev');
  assert.equal(developerRoleNameForProject({ name: 'crew-teacher' }), 'Teacher Dev');
  assert.equal(developerRoleNameForProject({ name: 'crew-story' }), 'Story Dev');
  assert.equal(developerRoleNameForProject({ name: 'crew-fortune' }), 'Fortune Dev');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-roster-'));
  const storagePath = path.join(tempDir, 'roles.json');
  try {
    await fs.writeFile(storagePath, JSON.stringify({
      version: 2,
      bootstrapped: true,
      roles: [
        { id: 'role-general', name: 'General Developer', source: 'default', createdAt: 1, updatedAt: 1 },
        { id: 'role-helper', name: 'Crew Helper Developer', projectId: 'project-helper', source: 'project', createdAt: 1, updatedAt: 1 }
      ]
    }), 'utf8');

    const store = new RoleStore({
      storagePath,
      projectProvider: {
        listProjects: async () => [],
        getProject: async id => id === 'project-helper' ? { id, name: 'crew-helper' } : null
      }
    });
    const loaded = await store.list();
    assert.equal(loaded.find(role => role.id === 'role-general')?.name, 'General');
    assert.equal(loaded.find(role => role.id === 'role-helper')?.name, 'Helper Dev');
    assert.equal(loaded.find(role => role.name === 'Helper Dev')?.id, 'role-helper');

    const persisted = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    assert.equal(persisted.roles.find(role => role.id === 'role-general')?.name, 'General');
    assert.equal(persisted.roles.find(role => role.id === 'role-helper')?.name, 'Helper Dev');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  assert.ok(html.includes('auto-rows-max grid-cols-2'));
  assert.ok(html.includes('id="drawer-new-role-btn"'));
  assert.equal(html.includes('Role 是長期身份；工作只是暫時 Context'), false);
  assert.equal(html.includes('>✓ 任務中心</button>'), false);
  assert.equal(html.includes('General Developer'), false);
  assert.ok(ui.includes('role-nav-card relative'));
  assert.ok(ui.includes('absolute right-1.5 top-1.5'));
  assert.ok(ui.includes('crew-role-task'));
  assert.ok(css.includes('.crew-role-task'));

  console.log('crew-roster-grid tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
