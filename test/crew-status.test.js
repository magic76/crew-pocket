const assert = require('node:assert/strict');
const { buildCrewStatus } = require('../lib/crew-status');

async function run() {
  const roles = [
    { id: 'role-a', name: 'Role A', projectId: null },
    { id: 'role-b', name: 'Role B', projectId: 'project-b' },
    { id: 'role-c', name: 'Role C', projectId: null }
  ];
  const runtimes = [
    { roleId: 'role-a', providerId: 'codex', conversationId: 'thread-a', model: 'gpt-a', effort: 'high', workspace: '/a', activatedAt: 100, updatedAt: 330 },
    { roleId: 'role-b', providerId: 'codex', conversationId: 'thread-b', model: 'gpt-b', effort: 'medium', workspace: '/b', activatedAt: 110, updatedAt: 250 }
  ];
  const inboxByRole = {
    'role-a': [
      { id: 'req-1', fromRoleId: 'role-b', toRoleId: 'role-a', content: 'queued request', replyToId: null, createdAt: 310 },
      { id: 'reply-1', fromRoleId: 'role-b', toRoleId: 'role-a', content: 'unread reply', replyToId: 'old', createdAt: 320 }
    ],
    'role-b': [],
    'role-c': []
  };
  const activityByRole = {
    'role-a': [{ id: 'reply-1', direction: 'incoming', fromRoleId: 'role-b', fromRoleName: 'Role B', toRoleId: 'role-a', toRoleName: 'Role A', content: 'unread reply', replyToId: 'old', createdAt: 320 }],
    'role-b': [],
    'role-c': []
  };
  const durableQueue = [
    { id: 'roleq-1', roleId: 'role-a', providerId: 'codex', conversationId: 'thread-a', text: 'next message', createdAt: 340 }
  ];

  const status = await buildCrewStatus({
    listRoles: async () => roles,
    listRoleRuntimes: async () => runtimes,
    getConversationSettings: async (_provider, conversationId) => conversationId === 'thread-a'
      ? { title: 'Active A', model: 'gpt-a', effort: 'high', workspace: '/a' }
      : { title: 'Active B', model: 'gpt-b', effort: 'medium', workspace: '/b' },
    getCrewInbox: async roleId => inboxByRole[roleId] || [],
    getCrewMessageActivity: async roleId => activityByRole[roleId] || [],
    getProvider: () => ({ getStatus: conversationId => ({ isBusy: conversationId === 'thread-a' }) }),
    listRoleQueuedMessages: async () => durableQueue
  });

  const byId = new Map(status.roles.map(item => [item.roleId, item]));
  const a = byId.get('role-a');
  assert.equal(a.state, 'working');
  assert.equal(a.busy, true);
  assert.equal(a.currentWork.title, 'Active A');
  assert.equal(a.currentWork.conversationId, 'thread-a');
  assert.equal(a.queuedMessageCount, 1);
  assert.equal(a.queuedRequestCount, 1);
  assert.equal(a.unreadReplyCount, 1);
  assert.equal(a.attentionCount, 3);
  assert.equal(a.lastActivityAt, 340);

  const b = byId.get('role-b');
  assert.equal(b.state, 'idle');
  assert.equal(b.currentWork.title, 'Active B');

  const c = byId.get('role-c');
  assert.equal(c.state, 'new');
  assert.equal(c.runtime, null);
  assert.equal(c.currentWork, null);

  const pendingNew = await buildCrewStatus({
    listRoles: async () => [{ id: 'role-n', name: 'Role N' }],
    listRoleRuntimes: async () => [{ roleId: 'role-n', providerId: 'codex', conversationId: null, pendingNew: true, model: 'gpt-next', effort: 'medium', updatedAt: 25 }],
    getConversationSettings: async () => null,
    getCrewInbox: async () => [],
    getCrewMessageActivity: async () => [],
    getProvider: () => ({ getStatus: () => ({ isBusy: false }) }),
    listRoleQueuedMessages: async () => []
  });
  assert.equal(pendingNew.roles[0].state, 'new');
  assert.equal(pendingNew.roles[0].currentWork.title, '新工作');

  const waiting = await buildCrewStatus({
    listRoles: async () => [{ id: 'role-w', name: 'Role W' }],
    listRoleRuntimes: async () => [{ roleId: 'role-w', providerId: 'codex', conversationId: 'thread-w', updatedAt: 10 }],
    getConversationSettings: async () => ({ title: 'Waiting work' }),
    getCrewInbox: async () => [],
    getCrewMessageActivity: async () => [],
    getProvider: () => ({ getStatus: () => ({ isBusy: false }) }),
    listRoleQueuedMessages: async () => [{ id: 'q', roleId: 'role-w', providerId: 'codex', conversationId: 'thread-w', text: 'queued', createdAt: 20 }]
  });
  assert.equal(waiting.roles[0].state, 'waiting');
  assert.equal(waiting.roles[0].queuedMessageCount, 1);

  console.log('crew-status tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
