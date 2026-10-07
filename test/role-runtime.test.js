const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RoleRuntimeStore } = require('../lib/role-runtime');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-role-runtime-'));
  const storagePath = path.join(tempDir, 'role-runtime.json');
  const store = new RoleRuntimeStore({ storagePath });

  try {
    assert.equal(await store.get('role-a'), null);

    const first = await store.activate({
      roleId: 'role-a',
      providerId: 'codex',
      conversationId: 'thread-1',
      model: 'gpt-test',
      effort: 'medium',
      workspace: '/tmp/a'
    });
    assert.equal(first.roleId, 'role-a');
    assert.equal(first.conversationId, 'thread-1');
    const activatedAt = first.activatedAt;

    const same = await store.activate({
      roleId: 'role-a',
      providerId: 'codex',
      conversationId: 'thread-1',
      model: 'gpt-new'
    });
    assert.equal(same.activatedAt, activatedAt);
    assert.equal(same.model, 'gpt-new');

    const switched = await store.activate({
      roleId: 'role-a',
      providerId: 'antigravity',
      conversationId: 'agy-2',
      model: 'gemini-test'
    });
    assert.equal(switched.providerId, 'antigravity');
    assert.equal(switched.conversationId, 'agy-2');
    assert.ok(switched.activatedAt >= activatedAt);

    await store.activate({
      roleId: 'role-b',
      providerId: 'codex',
      conversationId: 'thread-shared',
      model: 'gpt-test'
    });
    await store.activate({
      roleId: 'role-c',
      providerId: 'codex',
      conversationId: 'thread-shared',
      model: 'gpt-test'
    });
    assert.equal(await store.clearConversation('codex', 'thread-shared'), 2);
    assert.equal(await store.get('role-b'), null);
    assert.equal(await store.get('role-c'), null);

    assert.equal(await store.clearRole('role-a'), true);
    assert.equal(await store.get('role-a'), null);

    const stored = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.roles, {});

    console.log('role-runtime tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
