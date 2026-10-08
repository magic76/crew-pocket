const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-role-queue-'));
  const storagePath = path.join(tempDir, 'queue.json');
  const { RoleMessageQueueStore } = require('../lib/role-message-queue');

  try {
    const store = new RoleMessageQueueStore({ storagePath });
    const first = await store.enqueue({ roleId: 'role-a', providerId: 'codex', conversationId: 'thread-a', text: 'first', source: 'live' });
    const second = await store.enqueue({ roleId: 'role-a', providerId: 'codex', conversationId: 'thread-a', text: 'second', source: 'chat' });
    await store.enqueue({ roleId: 'role-b', providerId: 'antigravity', conversationId: 'thread-b', text: 'other role' });

    assert.deepEqual((await store.list('role-a')).map(item => item.text), ['first', 'second']);

    // New store instance simulates WebView/runtime process reload.
    const reloaded = new RoleMessageQueueStore({ storagePath });
    assert.deepEqual((await reloaded.list('role-a')).map(item => item.id), [first.id, second.id]);

    const removed = await reloaded.remove('role-a', first.id);
    assert.equal(removed.text, 'first');
    assert.deepEqual((await reloaded.list('role-a')).map(item => item.text), ['second']);

    assert.equal(await reloaded.clearRole('role-a'), 1);
    assert.equal((await reloaded.list('role-a')).length, 0);
    assert.equal((await reloaded.list('role-b')).length, 1, 'clearing one Role must not affect another');
    console.log('role-message-queue tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
