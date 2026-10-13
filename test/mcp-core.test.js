const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCrewMcpTools } = require('../lib/mcp/agent-tools');
const { MemoryCandidateStore } = require('../lib/mcp/memory-candidates');
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { CrewMessageStore } = require('../lib/crew-messages');

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-mcp-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const roles = [
    { id: 'role-a', name: 'A', projectId: 'project-a', systemContext: 'Private A' },
    { id: 'role-b', name: 'B', projectId: 'project-b', systemContext: 'Private B' }
  ];
  const roleProvider = {
    listRoles: async () => roles,
    getRole: async id => roles.find(role => role.id === id) || null
  };
  const memoryProvider = new LocalMemoryProvider({ storagePath: path.join(tempDir, 'memories.json') });
  const candidateStore = new MemoryCandidateStore({ storageDir: path.join(tempDir, 'candidates') });
  const messages = new CrewMessageStore({
    storagePath: path.join(tempDir, 'messages.json'),
    roleProvider
  });
  const toolsFor = roleId => createCrewMcpTools({
    roleId, resolveRole: roleProvider.getRole, resolveRoles: roleProvider.listRoles,
    resolveRuntime: async id => ({
      providerId: 'codex',
      conversationId: id === 'role-a' ? 'session-a' : 'session-b',
      model: 'test-model',
      workspace: '/tmp/test'
    }),
    memoryProvider,
    candidateStore,
    sendMessage: input => messages.send(input),
    getInbox: (id, options) => messages.inbox(id, options)
  });
  return { tempDir, roles, roleProvider, memoryProvider, candidateStore, messages, toolsFor };
}

test('MCP binds identity and does not reveal other Roles private context', async t => {
  const fx = await fixture(t);
  const a = fx.toolsFor('role-a');
  const self = await a.crew_whoami();
  assert.equal(self.role.id, 'role-a');
  assert.equal(self.role.systemContext, 'Private A');
  const publicRoles = await a.crew_list_roles();
  assert.equal(publicRoles.roles.length, 2);
  assert.equal(publicRoles.roles.find(item => item.id === 'role-b').systemContext, undefined);
  await assert.rejects(fx.toolsFor('missing-role').crew_whoami(), /does not exist/);
  assert.throws(() => fx.toolsFor('role-a;rm -rf'), /Invalid bound Role ID/);
});

test('MCP recall restricts Role, Project and Session scopes using bound identity', async t => {
  const fx = await fixture(t);
  const provider = fx.memoryProvider;
  for (const row of [
    { text: 'shared note', scope: 'GLOBAL' },
    { text: 'alpha secret', scope: 'ROLE', roleId: 'role-a' },
    { text: 'beta secret', scope: 'ROLE', roleId: 'role-b' },
    { text: 'alpha project', scope: 'PROJECT', projectId: 'project-a' },
    { text: 'beta project', scope: 'PROJECT', projectId: 'project-b' },
    { text: 'alpha session', scope: 'SESSION', conversationId: 'session-a' },
    { text: 'beta session', scope: 'SESSION', conversationId: 'session-b' }
  ]) await provider.retain(row);

  const hits = (await fx.toolsFor('role-a').crew_recall({
    query: '', limit: 10, roleId: 'role-b', projectId: 'project-b',
    conversationId: 'session-b', scopes: ['GLOBAL','ROLE','PROJECT','SESSION']
  })).memories;
  const content = hits.map(hit => hit.text);
  assert.deepEqual([...content].sort(), ['shared note', 'alpha secret', 'alpha project', 'alpha session'].sort());
  assert.equal(content.some(text => /beta/.test(text)), false);
  assert.ok(hits.every(hit => hit.text && hit.provenance !== undefined));
});

test('MCP messaging always uses bound sender; inbox limited to recipient', async t => {
  const fx = await fixture(t);
  const a = fx.toolsFor('role-a');
  const b = fx.toolsFor('role-b');
  await assert.rejects(a.crew_send_message({ toRoleId: '*', message: 'broadcast' }), /different concrete Role/);
  await assert.rejects(a.crew_send_message({ toRoleId: 'role-a', message: 'self' }), /different concrete Role/);
  const sent = await a.crew_send_message({
    toRoleId: 'role-b', message: 'Please review', fromRoleId: 'role-b'
  });
  assert.equal(sent.fromRoleId, 'role-a');
  assert.equal(sent.status, 'queued');
  assert.equal((await a.crew_get_inbox()).messages.length, 0);
  const inbox = (await b.crew_get_inbox({ roleId: 'role-a' })).messages;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].fromRoleId, 'role-a');
  assert.equal(inbox[0].content, 'Please review');
  assert.equal(inbox[0].deliveredAt, null);
});

test('MCP memory proposals stage and deduplicate without modifying canonical memory', async t => {
  const fx = await fixture(t);
  const a = fx.toolsFor('role-a');
  const input = {
    text: 'Tool retry after timeout improved reliability.',
    kind: 'failure_recovery',
    tags: ['retry'],
    evidence: [{ type: 'git', id: 'abc123' }]
  };
  const first = await a.crew_propose_memory(input);
  assert.equal(first.status, 'pending_review');
  assert.ok(first.candidateId.startsWith('mcp-memory-'));
  const again = await a.crew_propose_memory(input);
  assert.equal(again.candidateId, first.candidateId);
  assert.equal(again.duplicate, true);
  const names = await fs.readdir(path.join(fx.tempDir, 'candidates'));
  assert.equal(names.length, 1);
  const stored = JSON.parse(await fs.readFile(path.join(fx.tempDir, 'candidates', names[0]), 'utf8'));
  assert.equal(stored.roleId, 'role-a');
  assert.equal(stored.provenance.sources[0].id, 'abc123');
  assert.equal((await fx.memoryProvider.readAll()).length, 0);
  await assert.rejects(a.crew_propose_memory({ text: 'a'.repeat(2001) }), /max 2000/);
});

test('MCP proposals serialize concurrent duplicate writes', async t => {
  const fx = await fixture(t);
  const a = fx.toolsFor('role-a');
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    a.crew_propose_memory({ text: 'Repeated race condition' })));
  assert.equal(new Set(results.map(x => x.candidateId)).size, 1);
  assert.equal((await fx.candidateStore.readAll()).length, 1);
});
