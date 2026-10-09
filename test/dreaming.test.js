const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DreamingManager, normalizeSettings, eligible } = require('../lib/memory/dreaming');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-dreaming-'));
  let clock = 1000000000;
  const stored = new Map();
  const requests = [];
  const provider = {
    async summarizeMemoryEvents(input) {
      requests.push(input);
      return [{ text: 'A durable implementation decision, verified only as a reported work outcome.' }];
    }
  };
  const manager = new DreamingManager({
    storagePath: path.join(dir, 'dreaming.json'),
    now: () => clock,
    memoryProvider: { async retain(memory) { stored.set(memory.id, memory); } },
    getRole: async roleId => roleId === 'role-pocket' ? { id: roleId, name: 'Pocket Dev', projectId: 'project-pocket' } : null,
    getProvider: id => {
      assert.equal(id, 'codex');
      return provider;
    },
    logger: { warn() {} }
  });
  try {
    const sample = i => ({
      roleId: 'role-pocket',
      projectId: 'project-pocket',
      providerId: 'codex',
      conversationId: 'thread-one',
      prompt: 'Improve Role memory evidence number ' + i,
      response: 'Completed a concrete implementation that improves memory evidence handling, with supporting steps ' + i
    });
    assert.equal(await manager.recordTurn(sample(1)), true);
    assert.equal(await manager.recordTurn(sample(1)), false, 'identical event is deduplicated');
    assert.equal(stored.get('working-role-pocket').kind, 'working');
    assert.equal(stored.get('working-role-pocket').provenance.derivation, 'MODEL_INFERRED');
    assert.equal((await manager.getStatus()).roles['role-pocket'].pending, 1);
    await manager.runDue();
    assert.equal(requests.length, 0, 'minimum events blocks Dreaming');
    clock += 60000;
    await manager.recordTurn(sample(2));
    await manager.runDue();
    assert.equal(requests.length, 0, 'idle threshold blocks immediate Dreaming');
    clock += 16 * 60000;
    await manager.runDue();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'gpt-6-luna');
    assert.equal(requests[0].effort, 'low');
    assert.equal(requests[0].events.length, 2);
    const firstMemory = [...stored.values()].find(value => value.kind === 'experience');
    assert.ok(firstMemory);
    assert.equal(firstMemory.roleId, 'role-pocket');
    assert.equal(firstMemory.provenance.sources.length, 2);
    assert.equal((await manager.getStatus()).roles['role-pocket'].pending, 0);

    clock += 60000;
    await manager.recordTurn(sample(3));
    await manager.recordTurn(sample(4));
    clock += 16 * 60000;
    await manager.runDue();
    assert.equal(requests.length, 1, 'second Dreaming is blocked by rolling daily budget');

    await manager.configure({ enabled: false, model: 'gpt-7-luna', idleMinutes: 5, dailyLimit: 1 });
    clock += 24 * 60 * 60000;
    await manager.runDue();
    assert.equal(requests.length, 1, 'disabled means no provider call');
    const persisted = new DreamingManager({
      storagePath: path.join(dir, 'dreaming.json'),
      now: () => clock,
      memoryProvider: { async retain(memory) { stored.set(memory.id, memory); } },
      getRole: async id => ({ id, name: id }),
      getProvider: () => provider
    });
    assert.equal((await persisted.getStatus()).settings.model, 'gpt-7-luna', 'future models persist');
    assert.equal((await persisted.getStatus()).settings.enabled, false);
    assert.throws(() => normalizeSettings({ model: '../bad/model' }), /Invalid/);
    assert.equal(eligible({ pending: [], lastEventAt: clock }, normalizeSettings({ enabled: true }), clock + 600000), false);

    await manager.configure({ enabled: true });
    await manager.runDue();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].model, 'gpt-7-luna');
    const count = stored.size;
    assert.equal(await manager.forgetRole('role-pocket'), true);
    await manager.runDue();
    assert.equal(stored.size, count);
    assert.equal((await manager.getStatus()).roles['role-pocket'], undefined);
    console.log('dreaming tests: ok');
  } finally {
    manager.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
