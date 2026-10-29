'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('CTXAgent-inspired sidecar archives complete readable outputs with role/session isolation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-context-'));
  process.env.CREW_CONTEXT_ARCHIVE_DIR = root;
  const store = require('../lib/context/self-managed');
  const owner = { roleId: 'role-a', provider: 'codex', conversationId: 'thread-a' };
  const foreign = { roleId: 'role-b', provider: 'codex', conversationId: 'thread-a' };
  const differentThread = { ...owner, conversationId: 'thread-b' };
  const original = 'command output: value-123\n'.repeat(300);
  try {
    const history = { active_messages: [
      { role: 'user', content: 'work' },
      { role: 'assistant', tools: [
        { name: 'exec', args: { command: 'echo value' }, output: original },
        { name: 'other', args: {}, output: 'short result' },
        { name: 'huge', args: {}, output: 'x'.repeat(store.MAX_OUTPUT_BYTES + 1) }
      ] }
    ] };
    const captured = await store.captureToolOutputs(owner, history);
    assert.equal(captured.added, 2);
    assert.equal(captured.skipped, 1);
    assert.equal((await store.captureToolOutputs(owner, history)).added, 0);
    const listing = await store.listArchive(owner);
    assert.equal(listing.total, 2);
    assert.equal(listing.segments.some(s => s.name === 'huge'), false);
    const entry = listing.segments.find(s => s.name === 'exec');
    assert.equal(entry.bytes, Buffer.byteLength(original));
    assert.ok(/^[a-f0-9]{64}$/.test(entry.id));
    const partial = await store.recallArchive(owner, { id: entry.id, maxChars: 100 });
    assert.equal(partial.text, original.slice(0, 100));
    assert.equal(partial.nextOffset, 100);
    const next = await store.recallArchive(owner, { id: entry.id, offset: 100, maxChars: 12000 });
    assert.equal(partial.text + next.text, original);
    assert.equal(next.nextOffset, null);

    await assert.rejects(store.recallArchive(foreign, { id: entry.id }), /not found/);
    await assert.rejects(store.recallArchive(differentThread, { id: entry.id }), /not found/);
    await assert.rejects(store.curateArchive(owner, { items: [
      { id: entry.id, note: 'done' }, { id: '0'.repeat(64), note: 'not real' }
    ] }), /not found/);
    assert.equal((await store.listArchive(owner)).segments.find(s => s.id === entry.id).note, null);
    const curated = await store.curateArchive(owner, { items: [
      { id: entry.id, note: 'Already inspected and tested the output' }
    ] });
    assert.equal(curated.nativeContextChanged, false);
    assert.match((await store.recallArchive(owner, { id: entry.id })).note, /inspected/);
    const stat = await fs.stat(path.join(root,'role-a','codex','thread-a','index.json'));
    assert.equal(stat.mode & 0o077, 0);

    const pending = await store.proposeCompaction(owner, {
      summary: 'Goal is finished. Changes were tested and verified. Keep current Role and open issues.'
    });
    assert.equal(pending.status, 'pending');
    assert.equal((await store.pendingCompaction(owner)).id, pending.proposalId);
    assert.equal(await store.pendingCompaction(foreign), null);
    assert.deepEqual(await store.settleCompaction(owner, 'not-the-id', 'applied'), { matched: false });
    await store.settleCompaction(owner, pending.proposalId, 'applied');
    assert.equal(await store.pendingCompaction(owner), null);
    await assert.rejects(store.proposeCompaction(owner, { summary: 'short' }), /summary/);
    await assert.rejects(store.listArchive({ ...owner, conversationId: '../outside' }), /identity/);
    await assert.rejects(store.listArchive({ ...owner, roleId: '..' }), /identity/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('sidecar leaves provider-managed context unchanged and integrates only via post-turn gate', async () => {
  const fsSync = require('node:fs');
  const root = path.join(__dirname, '..');
  const server = fsSync.readFileSync(path.join(root, 'server.js'), 'utf8');
  const codex = fsSync.readFileSync(path.join(root, 'lib/providers/codex.js'), 'utf8');
  assert.ok(server.includes('function agentCompactionEligible('));
  assert.ok(server.includes('assessment.decision.safeNow'));
  assert.ok(server.includes('captureToolOutputs(identity, bundle.history)'));
  assert.ok(server.includes("source: freshProposal ? 'agent_proposal' : 'auto_compact'"));
  assert.ok(server.includes('performSafeContextCompact(providerId, conversationId'));
  assert.ok(codex.includes("this.request('thread/compact/start'"));
});
