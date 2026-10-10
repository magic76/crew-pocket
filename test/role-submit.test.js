'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RoleMessageQueueStore } = require('../lib/role-message-queue');
const { createRoleSubmitter, runChatInBackground } = require('../lib/role-submit');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-submit-'));
  try {
    const storagePath = path.join(dir, 'queue.json');
    const store = new RoleMessageQueueStore({ storagePath });
    const runtimes = new Map([
      ['teacher', { roleId: 'teacher', providerId: 'codex', conversationId: 'teacher-conv', model: 'teacher-model', effort: 'high', workspace: '/teacher' }],
      ['writer', { roleId: 'writer', providerId: 'antigravity', pendingNew: true, conversationId: null, model: 'writer-model', workspace: '/writer' }]
    ]);
    let busy = false; let reserved = false; let calls = []; let race = false;
    const deps = {
      store, getRole: async id => ['teacher', 'writer', 'fresh'].includes(id) ? { id } : null,
      validateImage: async p => { assert.equal(p, '/uploaded/screen.jpg'); },
      listProviders: () => [{ id: 'antigravity' }, { id: 'codex' }],
      getProviderConversationSettings: async id => new Map(id === 'codex' ? [['teacher-conv', { roleId: 'teacher', workspace: '/teacher', model: 'teacher-model' }]] : []),
      getDefaultModel: id => 'default-' + id,
      getRoleRuntime: async id => runtimes.get(id) || null,
      activateRoleConversation: async runtime => { runtimes.set(runtime.roleId, runtime); return runtime; },
      clearRoleConversation: async id => runtimes.delete(id),
      getProvider: () => ({ getStatus: () => ({ isBusy: busy }) }),
      isRoleReserved: () => reserved,
      runChat: async body => {
        calls.push(body);
        if (race) return { error: 'busy', code: 'CONVERSATION_BUSY', started: false };
        // Stand-in for handleChat's provider-start persistence, never sender state.
        const conversationId = body.conversation_id || body.role_id + '-new';
        runtimes.set(body.role_id, { roleId: body.role_id, providerId: body.provider, conversationId,
          model: body.model, workspace: body.workspace });
        return { conversation_id: conversationId, response: 'done' };
      }
    };
    const submitter = createRoleSubmitter(deps);
    const payload = { request_id: 'test-request-000001', role_id: 'teacher', image_path: '/uploaded/screen.jpg', prompt: 'source + annotations + user request',
      conversation_id: 'sender-conv', provider: 'antigravity', workspace: '/sender', model: 'sender-model', context: 'sender memory' };
    const [first, duplicate] = await Promise.all([submitter.submit(payload), submitter.submit(payload)]);
    assert.equal(first.requestId, duplicate.requestId);
    assert.equal((await store.list()).length, 1, 'concurrent duplicate submission only queues once');
    assert.equal(first.providerId, 'codex'); assert.equal(first.conversationId, 'teacher-conv');
    await assert.rejects(() => submitter.submit({ ...payload, prompt: 'different' }), /另一項需求/);
    busy = true; await submitter.drain('teacher'); assert.equal(calls.length, 0, 'busy Role is never interrupted');
    busy = false; reserved = true; await submitter.drain('teacher'); assert.equal(calls.length, 0);
    reserved = false; race = true; await submitter.drain('teacher');
    assert.equal((await store.readReceipts())[payload.request_id].status, 'queued', 'provider-lock race safely retries');
    race = false; await submitter.drain('teacher');
    const sent = calls.at(-1);
    assert.equal(sent.conversation_id, 'teacher-conv'); assert.equal(sent.provider, 'codex');
    assert.equal(sent.model, 'teacher-model'); assert.equal(sent.effort, 'high'); assert.equal(sent.workspace, '/teacher');
    assert.equal(sent.context, undefined); assert.equal(sent.image_path, payload.image_path); assert.equal(sent.prompt, payload.prompt);
    assert.equal((await store.list()).length, 0);
    const restartedStore = new RoleMessageQueueStore({ storagePath });
    const restarted = createRoleSubmitter({ ...deps, store: restartedStore });
    assert.equal((await restarted.submit(payload)).status, 'completed');
    const count = calls.length; await restarted.drain('teacher'); assert.equal(calls.length, count, 'completed receipts survive restart and never rerun');

    const writer = { ...payload, request_id: 'test-request-000002', role_id: 'writer' };
    await submitter.submit(writer); await submitter.drain('writer');
    assert.equal(calls.at(-1).conversation_id, null, 'pending-new Role starts its own fresh thread');
    assert.equal(calls.at(-1).provider, 'antigravity'); assert.equal(calls.at(-1).workspace, '/writer');
    assert.equal((await store.readReceipts())[writer.request_id].conversationId, 'writer-new');
    await assert.rejects(() => submitter.submit({ ...writer, role_id: 'missing', request_id: 'test-request-000003' }), /不存在/);
    await submitter.submit({ ...writer, role_id: 'fresh', request_id: 'test-request-000004' });
    await submitter.drain('fresh'); assert.equal(calls.at(-1).conversation_id, null);
    assert.equal(calls.at(-1).model, 'default-antigravity', 'no-runtime bootstrap follows existing resolver defaults');

    // Keep queue ordering with existing chat messages.
    await store.enqueue({ roleId: 'teacher', providerId: 'codex', text: 'earlier chat' });
    await submitter.submit({ ...payload, request_id: 'test-request-000005' });
    const before = calls.length; await submitter.drain('teacher'); assert.equal(calls.length, before);
    assert.equal((await store.list('teacher')).length, 2);

    await store.remove('teacher', (await store.list('teacher'))[0].id);
    await store.updateSubmission('test-request-000005', { status: 'running' });
    await restarted.recoverInterrupted();
    assert.equal((await restarted.submit({ ...payload, request_id: 'test-request-000005' })).status, 'unknown');
    assert.equal((await store.list('teacher')).length, 0, 'uncertain crash never replays an accepted request');
    await submitter.submit({ ...payload, request_id: 'test-request-000006' });
    await store.clearRole('teacher');
    assert.equal((await submitter.submit({ ...payload, request_id: 'test-request-000006' })).status, 'cancelled');

    // Text-only 3D Role message must bypass filesystem image validation.
    const plain = { ...payload, request_id: 'test-request-000007',
      image_path: '', prompt: 'Hello from the 3D map' };
    const textReceipt = await submitter.submit(plain);
    assert.equal(textReceipt.status, 'queued');
    const textQueued = (await store.list('teacher')).find(item => item.id === plain.request_id);
    assert.equal(textQueued.text, plain.prompt);
    assert.equal(textQueued.imagePath, null);
    assert.equal((await submitter.submit(plain)).requestId, plain.request_id,
      'text-only submission is still idempotent');

    // Detached chat uses the actual HTTP/SSE contract and waits for end,
    // rather than considering an init event or startTurn return a success.
    const result = await runChatInBackground(async (req, res, body) => {
      assert.deepEqual(req.headers, {}); assert.equal(body.role_id, 'teacher');
      res.writeHead(200); res.write('event: init\ndata: {"conversation_id":"own-thread"}\n\n');
      await Promise.resolve();
      res.write('event: done\ndata: {"response":"ok"}\n\n'); res.end();
    }, { role_id: 'teacher' });
    assert.equal(result.conversation_id, 'own-thread'); assert.equal(result.started, true);
    const rejected = await runChatInBackground(async (_, res) => {
      res.writeHead(409); res.end(JSON.stringify({ error: 'busy', code: 'CONVERSATION_BUSY' }));
    }, {});
    assert.equal(rejected.started, false); assert.equal(rejected.code, 'CONVERSATION_BUSY');
    console.log('role-submit: isolation, busy queue, new conversation, restart dedupe and SSE adapter passed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
